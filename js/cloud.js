/* Cloud sync (Rev 1.2): offline-first. IndexedDB stays the primary store; when online and signed in, local changes are pushed
   and remote changes pulled. Backend: Supabase (URL + publishable key in js/config.js). No secret key in the app: user
   administration goes through the rg-admin Edge Function, which checks that the caller is an Admin.
   Change tracking: settings 'syncstate' keeps a hash of the last synced version of every record, so a record whose hash differs is
   "changed here" and gets pushed. Pull uses server updated_at cursors (with a 60 s overlap; hashes make re-reads harmless). */
const Cloud = (() => {
  const C = (self.RG_CONFIG && self.RG_CONFIG.cloud) || {};
  const configured = !!(C.url && C.publishableKey && self.supabase);
  const BUCKET = C.bucket || 'ramgear-files', FN = C.adminFunction || 'rg-admin', LOCK_MIN = 30;
  let sb = null, cfg = null, running = null, again = false, timer = null, lastError = '', lastSyncAt = 0, pending = 0, online = navigator.onLine, problem = '';
  const LOCKS = {}, listeners = new Set(), held = new Map();
  let TABLETS = [], hooks = {tablet: () => '', user: () => null, onRemote: () => {}, audit: async () => {}};
  const client = () => sb || (sb = supabase.createClient(C.url, C.publishableKey, {auth: {persistSession: true, autoRefreshToken: true, storageKey: 'rg-cloud-auth'}}));
  const norm = u => String(u || '').trim().toLowerCase();
  const hex = s => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('');
  const emailFor = u => `u${hex(norm(u))}@users.invalid`;   // same mapping as the Edge Function
  const cloudPw = s => `rg1:${s}`;
  // stable JSON (sorted keys) so a record hashes the same locally and after a round trip through Postgres jsonb
  const stable = v => v === null || typeof v !== 'object' ? JSON.stringify(v === undefined ? null : v)
    : Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : `{${Object.keys(v).filter(k => v[k] !== undefined && !(v[k] instanceof Blob)).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}`;
  function hash(v) { const s = stable(v); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + ':' + s.length; }
  const plain = o => JSON.parse(stable(o));                    // drops Blob fields and undefined
  const jobCore = j => { const {forms, ...rest} = j; return rest; };
  const blobFields = o => Object.keys(o).filter(k => o[k] instanceof Blob);

  async function loadCfg() { cfg = (await DB.get('settings', 'cloud')) || {key: 'cloud', enabled: false}; return cfg; }
  async function saveCfg(patch) { cfg = {...(cfg || await loadCfg()), ...patch, key: 'cloud'}; await DB.put('settings', cfg); emit(); return cfg; }
  async function getState() { return (await DB.get('settings', 'syncstate')) || {key: 'syncstate', h: {}, cur: {}}; }
  const saveState = st => DB.put('settings', st);
  const enabled = () => !!(configured && cfg && cfg.enabled);
  const deviceId = () => cfg && cfg.deviceId;
  function emit() { const s = status(); listeners.forEach(f => { try { f(s); } catch (e) { /* ignore */ } }); }
  function status() { return {configured, enabled: enabled(), online, running: !!running, lastSyncAt, lastError, problem, pending, email: cfg && cfg.email, connectedAt: cfg && cfg.connectedAt}; }

  async function session() { if (!configured) return null; try { const {data} = await client().auth.getSession(); return data.session; } catch (e) { return null; } }
  async function fn(action, body = {}) {
    const s = await session();
    const r = await fetch(`${C.url}/functions/v1/${FN}`, {method: 'POST', headers: {'Content-Type': 'application/json', apikey: C.publishableKey,
      Authorization: `Bearer ${s ? s.access_token : C.publishableKey}`}, body: JSON.stringify({action, ...body})});
    const j = await r.json().catch(() => ({ok: false, error: `HTTP ${r.status}`}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  /* sign in to the cloud with the same username + password/PIN as on the tablet. Users imported from a tablet get their
     cloud account on first sign-in ("activate": the server checks the password against the stored PBKDF2 hash). */
  async function signIn(username, secret) {
    if (!configured) throw new Error('Cloud is not configured (js/config.js).');
    const creds = {email: emailFor(username), password: cloudPw(secret)};
    let {data, error} = await client().auth.signInWithPassword(creds);
    if (error && /invalid login credentials/i.test(error.message)) {
      try { await fn('activate', {username: norm(username), password: secret}); ({data, error} = await client().auth.signInWithPassword(creds)); } catch (e) { error = e; }
    }
    if (error) throw new Error(/invalid login|wrong username/i.test(error.message) ? 'Wrong username or password/PIN for the cloud account.' : error.message);
    return data.session;
  }
  async function signOut() { if (!configured) return; await releaseAll(); try { await client().auth.signOut({scope: 'local'}); } catch (e) { /* offline */ } emit(); }
  async function me() {
    const s = await session(); if (!s) return null;
    const {data} = await client().from('members').select('*').eq('auth_user_id', s.user.id).maybeSingle();
    return data;
  }
  const remoteUser = u => ({id: u.id, username: u.username, displayName: u.displayName, role: u.role, disabled: !!u.disabled,
    secret: u.hash ? {algo: u.algo, iterations: u.iterations, salt: u.salt, hash: u.hash} : null});

  /* ---------- push ---------- */
  async function upsertRows(table, items, st, conflict) {
    for (let i = 0; i < items.length; i += 100) {
      const chunk = items.slice(i, i + 100);
      const {error} = await client().from(table).upsert(chunk.map(x => x.row), conflict ? {onConflict: conflict} : undefined);
      if (error) throw new Error(`${table}: ${error.message}`);
      for (const x of chunk) { if (x.del) delete st.h[x.k]; else st.h[x.k] = x.h; }
    }
  }
  async function push(st) {
    const dev = deviceId(), tab = hooks.tablet(), H = st.h, conflicts = [];
    // customers + jobs (+ tombstones for records deleted on this tablet)
    const customers = await DB.all('customers'), jobs = await DB.all('jobs');
    for (const [table, list, key, extra] of [['customers', customers, 'customers', () => ({})], ['jobs', jobs, 'jobs', j => ({customer_id: j.customerId || 'unassigned'})]]) {
      const items = [], ids = new Set();
      for (const r of list) {
        ids.add(r.id); const data = key === 'jobs' ? plain(jobCore(r)) : plain(r), h = hash(data), k = `${key}:${r.id}`;
        if (H[k] !== h) items.push({k, h, row: {id: r.id, data, deleted: false, updated_tablet: dev, ...extra(r)}});
      }
      for (const k of Object.keys(H)) if (k.startsWith(key + ':') && !ids.has(k.slice(key.length + 1)))
        items.push({k, del: true, row: {id: k.slice(key.length + 1), data: {deleted: true}, deleted: true, updated_tablet: dev, ...(key === 'jobs' ? {customer_id: 'deleted'} : {})}});
      await upsertRows(table, items, st); await saveState(st);
    }
    // forms: one row per job form; the server refuses changes to finalized forms and to forms checked out by another tablet
    for (const j of jobs) for (const [fk, fs] of Object.entries(j.forms || {})) {
      const k = `forms:${j.id}:${fk}`, data = plain(fs), h = hash(data);
      if (H[k] === h) continue;
      const {error} = await client().from('forms').upsert({job_id: j.id, form_key: fk, data, status: fs.status === 'completed' ? 'completed' : 'draft',
        revision: fs.revision || 1, deleted: false, updated_tablet: dev}, {onConflict: 'job_id,form_key'});
      if (!error) { H[k] = h; continue; }
      if (!/RG_(LOCKED|FINALIZED|STALE)/.test(error.message)) throw new Error(`forms: ${error.message}`);
      // conflict: keep the server version, record what this tablet had in the audit log
      const {data: remote} = await client().from('forms').select('*').eq('job_id', j.id).eq('form_key', fk).maybeSingle();
      const why = /RG_LOCKED/.test(error.message) ? `it is in use on ${remote && (remote.lock_tablet_name || remote.lock_tablet)}` : 'it was finalized on another tablet';
      await hooks.audit('Sync conflict – changes from this tablet not applied', `WO ${j.wo} ${fk}: ${why}. Local values: ${JSON.stringify(fs.values || {}).slice(0, 1500)}`, 'conflict');
      if (remote) { const fresh = await DB.get('jobs', j.id); if (fresh) { fresh.forms[fk] = remote.data; await DB.put('jobs', fresh); hooks.onRemote('form', j.id, fk, remote.data); } H[k] = hash(plain(remote.data)); }
      conflicts.push({job: j, key: fk, why});
    }
    await saveState(st);
    // photos + saved PDFs: blobs to the private bucket, metadata to files
    for (const [store, kind] of [['photos', 'photo'], ['docs', 'pdf']]) {
      const list = await DB.all(store), ids = new Set();
      for (const r of list) {
        ids.add(r.id); const meta = plain(r), bf = blobFields(r), k = `files:${r.id}`, h = hash({meta, bf});
        if (H[k] === h) continue;
        if (!H['blob:' + r.id]) {
          for (const f of bf) {
            const {error} = await client().storage.from(BUCKET).upload(`${r.jobId}/${r.id}/${f}`, r[f], {upsert: true, contentType: r[f].type || 'application/octet-stream'});
            if (error) throw new Error(`upload: ${error.message}`);
          }
          H['blob:' + r.id] = 1;
        }
        const {error} = await client().from('files').upsert({id: r.id, job_id: r.jobId, kind, path: `${r.jobId}/${r.id}`, meta: {...meta, _store: store, _blobs: bf}, deleted: false, updated_tablet: dev});
        if (error) throw new Error(`files: ${error.message}`);
        H[k] = h; await saveState(st);
      }
      for (const k of Object.keys(H)) if (k.startsWith('files:')) {
        const id = k.slice(6); if (ids.has(id)) continue;
        const other = store === 'photos' ? await DB.get('docs', id) : await DB.get('photos', id); if (other) continue;
        if (store === 'docs') continue;   // tombstones handled once, on the photos pass (checks both stores)
        const {data: row} = await client().from('files').select('path, meta').eq('id', id).maybeSingle();
        await client().from('files').update({deleted: true, updated_tablet: dev}).eq('id', id);
        if (row) await client().storage.from(BUCKET).remove((row.meta._blobs || ['blob']).map(f => `${row.path}/${f}`));
        delete H[k]; delete H['blob:' + id];
      }
      await saveState(st);
    }
    // audit log (append-only)
    const aud = (await DB.all('audit')).filter(a => !H['audit:' + a.id]);
    for (let i = 0; i < aud.length; i += 200) {
      const chunk = aud.slice(i, i + 200);
      const {error} = await client().from('audit').upsert(chunk.map(a => ({id: a.id, at: new Date(a.at || Date.now()).toISOString(), data: plain(a)})), {ignoreDuplicates: true});
      if (error) throw new Error(`audit: ${error.message}`);
      chunk.forEach(a => { H['audit:' + a.id] = 1; });
    }
    await saveState(st);
    await client().from('tablets').upsert({id: dev, name: tab, last_seen_at: new Date().toISOString(), last_user: (hooks.user() || {}).displayName || '', app_rev: self.APP_REV_LABEL || ''});
    return conflicts;
  }

  /* ---------- pull ---------- */
  async function rowsSince(table, st) {
    const out = []; let since = st.cur[table] ? new Date(Date.parse(st.cur[table]) - 60000).toISOString() : '1970-01-01T00:00:00Z';
    for (;;) {
      const {data, error} = await client().from(table).select('*').gt('updated_at', since).order('updated_at').limit(500);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...data); if (data.length < 500) break; since = data[data.length - 1].updated_at;
    }
    if (out.length) st.cur[table] = out[out.length - 1].updated_at;
    return out;
  }
  async function pullMembers(st) {
    const rows = await rowsSince('members', st), local = await DB.all('users');
    for (const m of rows) {
      const cur = local.find(u => u.id === m.id);
      for (const dup of local.filter(u => u.username === m.username && u.id !== m.id)) await DB.del('users', dup.id);   // same person, cloud id wins
      const u = {...(cur || {createdAt: Date.parse(m.created_at) || Date.now(), lastLoginAt: 0}), id: m.id, username: m.username, displayName: m.display_name,
        role: m.role, disabled: m.disabled, createdBy: m.created_by || (cur && cur.createdBy) || '', cloud: !!m.auth_user_id,
        ...(m.secret && m.secret.hash ? {algo: m.secret.algo, iterations: m.secret.iterations, salt: m.secret.salt, hash: m.secret.hash} : {})};
      const sig = x => stable([x.username, x.displayName, x.role, !!x.disabled, x.hash, x.salt, x.iterations, !!x.cloud]);
      if (!cur || sig(cur) !== sig(u)) { u.updatedAt = Date.now(); await DB.put('users', u); hooks.onRemote('user', m.id, null, u); }
    }
  }
  async function pull(st) {
    const H = st.h, changed = [];
    await pullMembers(st);
    for (const r of await rowsSince('customers', st)) {
      const k = `customers:${r.id}`, local = await DB.get('customers', r.id);
      if (r.deleted) { if (local && H[k] !== undefined && hash(plain(local)) === H[k]) { await DB.del('customers', r.id); changed.push(['customer', r.id]); } delete H[k]; continue; }   // local edits / never-synced records are kept (and pushed again)
      const h = hash(r.data); if (H[k] === h) continue;
      if (local && H[k] !== undefined && hash(plain(local)) !== H[k]) continue;   // changed here too: this tablet's version is pushed next
      await DB.put('customers', r.data); H[k] = h; changed.push(['customer', r.id]); hooks.onRemote('customer', r.id, null, r.data);
    }
    for (const r of await rowsSince('jobs', st)) {
      const k = `jobs:${r.id}`, local = await DB.get('jobs', r.id);
      if (r.deleted) { if (local && H[k] !== undefined && hash(plain(jobCore(local))) === H[k]) { await DB.deleteJob(r.id); changed.push(['job', r.id]); hooks.onRemote('jobdeleted', r.id); } delete H[k]; continue; }
      const h = hash(r.data); if (H[k] === h) continue;
      if (local && H[k] !== undefined && hash(plain(jobCore(local))) !== H[k]) continue;
      await DB.put('jobs', {...r.data, forms: (local && local.forms) || {}}); H[k] = h; changed.push(['job', r.id]); hooks.onRemote('job', r.id, null, r.data);
    }
    for (const r of await rowsSince('forms', st)) {
      LOCKS[`${r.job_id}:${r.form_key}`] = r.lock_tablet && Date.parse(r.lock_until) > Date.now() ? {tablet: r.lock_tablet, name: r.lock_tablet_name, user: r.lock_user, until: Date.parse(r.lock_until)} : null;
      const k = `forms:${r.job_id}:${r.form_key}`, h = hash(r.data); if (H[k] === h) continue;
      const job = await DB.get('jobs', r.job_id); if (!job) continue;
      const lf = job.forms && job.forms[r.form_key];
      if (lf && H[k] !== undefined && hash(plain(lf)) !== H[k]) continue;
      job.forms = job.forms || {}; job.forms[r.form_key] = r.data; await DB.put('jobs', job); H[k] = h; changed.push(['form', r.job_id, r.form_key]);
      hooks.onRemote('form', r.job_id, r.form_key, r.data);
    }
    for (const r of await rowsSince('files', st)) {
      const store = (r.meta && r.meta._store) || (r.kind === 'pdf' ? 'docs' : 'photos'), k = `files:${r.id}`;
      if (r.deleted) { if (H[k] !== undefined && await DB.get(store, r.id)) { await DB.del(store, r.id); changed.push(['file', r.job_id]); hooks.onRemote('file', r.job_id); } delete H[k]; delete H['blob:' + r.id]; continue; }
      const {_store, _blobs = [], ...meta} = r.meta || {}, h = hash({meta, bf: _blobs});
      if (H[k] === h) continue;
      const local = await DB.get(store, r.id), rec = {...meta};
      for (const f of _blobs) {
        if (local && local[f] instanceof Blob) { rec[f] = local[f]; continue; }
        const {data, error} = await client().storage.from(BUCKET).download(`${r.path}/${f}`);
        if (error) throw new Error(`download: ${error.message}`);
        rec[f] = data;
      }
      await DB.put(store, rec); H[k] = h; H['blob:' + r.id] = 1; changed.push(['file', r.job_id]); hooks.onRemote('file', r.job_id);
    }
    for (const r of await rowsSince('audit', st)) { if (!H['audit:' + r.id]) { if (!await DB.get('audit', r.id)) await DB.put('audit', r.data); H['audit:' + r.id] = 1; } }
    const {data: tabs} = await client().from('tablets').select('*').order('last_seen_at', {ascending: false}); TABLETS = tabs || [];
    await saveState(st);
    return changed;
  }
  async function countPending() {
    if (!enabled()) { pending = 0; return 0; }
    const st = await getState(), H = st.h; let n = 0;
    for (const c of await DB.all('customers')) if (H['customers:' + c.id] !== hash(plain(c))) n++;
    for (const j of await DB.all('jobs')) {
      if (H['jobs:' + j.id] !== hash(plain(jobCore(j)))) n++;
      for (const [fk, fs] of Object.entries(j.forms || {})) if (H[`forms:${j.id}:${fk}`] !== hash(plain(fs))) n++;
    }
    for (const s of ['photos', 'docs']) for (const r of await DB.all(s)) if (H['files:' + r.id] !== hash({meta: plain(r), bf: blobFields(r)})) n++;
    pending = n; emit(); return n;
  }
  /* Rev 1.4.1: before syncing, make sure the cloud still knows this account. A cloud that lost its data (reset / emptied) or this
     user's membership never causes anything to be deleted on this device: sync simply stops with a clear message, and an Admin
     can "Re-upload all data from this device". Records missing from the cloud are never deleted locally (only explicit
     tombstones for records this device synced unchanged). */
  const MSG = {
    reset: 'The company cloud is empty (it was reset or its data was removed). Everything on this device is safe and nothing was deleted here. An Admin taps Admin › Cloud sync › Re-upload all data from this device.',
    nomember: 'Your cloud account no longer exists in the company cloud. Everything on this device is safe. An Admin taps Admin › Cloud sync › Re-upload all data from this device (or re-adds your account).',
    disabled: 'Your cloud account is disabled. Everything on this device is safe. Ask an Admin.'};
  async function diagnose(signedIn) {
    if (signedIn) {
      let mine = null, err = null;
      try { mine = await me(); } catch (e) { err = e; }
      if (err) throw err;
      if (mine && !mine.disabled) return;
      if (mine && mine.disabled) { problem = 'disabled'; throw new Error(MSG.disabled); }
    }
    let boot = true; try { boot = await bootstrapped(); } catch (e) { if (!signedIn) return; throw e; }
    if (!boot) { problem = 'reset'; throw new Error(MSG.reset); }
    if (signedIn) { problem = 'nomember'; throw new Error(MSG.nomember); }
    problem = 'signin';
  }
  /* one sync cycle: push, then pull. Runs one at a time; a request during a run schedules one more run. */
  async function sync(reason) {
    if (!enabled()) return {skipped: 'off'};
    if (running) { again = true; return running; }
    running = (async () => {
      let result = {};
      do {
        again = false; emit();
        try {
          if (!navigator.onLine) { online = false; throw new Error('offline'); }
          problem = '';
          if (!await session()) { await diagnose(false); throw new Error('Not signed in to the cloud. Log out and sign in again while online. Your data on this device is safe.'); }
          await diagnose(true);   // stops here (no push, no pull) if the cloud lost this account or was reset
          const st = await getState();
          const conflicts = await push(st), changed = await pull(st);
          online = true; lastError = ''; lastSyncAt = Date.now(); await saveCfg({lastSyncAt});
          result = {conflicts, changed};
        } catch (e) {
          online = navigator.onLine && !/Failed to fetch|NetworkError|Load failed|offline/i.test(e.message); if (!online) problem = '';
          lastError = e.message === 'offline' ? '' : e.message; result = {error: e.message};
          if (lastError) console.warn('sync', e);
        }
        await countPending();
      } while (again);
      return result;
    })();
    try { return await running; } finally { running = null; emit(); }
  }
  let debounce = null;
  function soon(ms = 1500) { if (!enabled()) return; clearTimeout(debounce); debounce = setTimeout(() => sync('change'), ms); }
  function start() {
    clearInterval(timer); if (!enabled()) return;
    timer = setInterval(() => { if (hooks.user()) sync('timer'); }, 15000);
  }
  window.addEventListener('online', () => { online = true; emit(); if (hooks.user()) sync('online'); });
  window.addEventListener('offline', () => { online = false; emit(); });
  window.addEventListener('rg-local-change', () => { if (hooks.user()) { soon(); countPending(); } });

  /* ---------- check-out lock ---------- */
  async function checkout(jobId, key) {
    if (!enabled() || !navigator.onLine || !await session()) return {ok: true, offline: true};
    try {
      await Promise.race([sync('checkout'), new Promise(r => setTimeout(r, 6000))]);   // make sure the form row exists
      const tab = hooks.tablet(), u = hooks.user();
      const {data, error} = await client().rpc('checkout_form', {p_job: jobId, p_form: key, p_tablet: deviceId(), p_tablet_name: tab, p_user: u ? u.displayName : '', p_minutes: LOCK_MIN});
      if (error) throw error;
      const r = data && data[0]; if (!r) return {ok: true, noRow: true};
      if (r.ok) { held.set(`${jobId}:${key}`, Date.now()); return {ok: true}; }
      if (r.status === 'completed') return {ok: true, completed: true};
      return {ok: false, by: {name: r.lock_tablet_name || 'another tablet', user: r.lock_user, until: Date.parse(r.lock_until)}};
    } catch (e) { console.warn('checkout', e); return {ok: true, offline: true, error: e.message}; }
  }
  async function release(jobId, key) {
    const k = `${jobId}:${key}`; if (!held.has(k)) return; held.delete(k);
    try { await sync('release'); await client().rpc('release_form', {p_job: jobId, p_form: key, p_tablet: deviceId()}); } catch (e) { /* expires by itself */ }
  }
  async function releaseAll() { for (const k of [...held.keys()]) { const [j, f] = k.split(':'); await release(j, f); } }
  setInterval(() => { for (const k of held.keys()) { const [j, f] = k.split(':'); checkout(j, f); } }, 4 * 60000);   // heartbeat keeps the lock while the form is open

  /* ---------- connect / users ---------- */
  // forget which records were already synced, so the next sync uploads everything on this device again (nothing is deleted anywhere)
  async function resetState() { await saveState({key: 'syncstate', h: {}, cur: {}}); problem = ''; lastError = ''; emit(); }
  async function connect({email, reupload = false}) {
    const id = (cfg && cfg.deviceId) || (crypto.randomUUID ? crypto.randomUUID() : DB.uid() + DB.uid());
    if (reupload) await resetState();
    await saveCfg({enabled: true, deviceId: id, connectedAt: Date.now(), email});
    start(); return cfg;
  }
  async function disconnect() { await signOut(); await saveCfg({enabled: false}); clearInterval(timer); }
  const bootstrapped = async () => (await fn('status')).bootstrapped;
  const bootstrap = (setupCode, u, password) => fn('bootstrap', {setupCode, user: remoteUser(u), password});
  const importUsers = users => fn('import_users', {users: users.map(remoteUser)});
  const upsertUser = (u, password) => fn('upsert_user', {user: remoteUser(u), password: password || undefined});
  const setOwnPassword = (u, password) => fn('set_own_password', {password, secret: remoteUser(u).secret});
  async function init(h) { hooks = {...hooks, ...h}; await loadCfg(); if (enabled()) start(); countPending(); return cfg; }
  return {configured, init, status, onStatus: f => { listeners.add(f); f(status()); }, sync, soon, signIn, signOut, session, me, connect, disconnect,
    bootstrapped, bootstrap, importUsers, upsertUser, setOwnPassword, checkout, release, releaseAll, lockOf: (j, k) => LOCKS[`${j}:${k}`] || null,
    isHeld: (j, k) => held.has(`${j}:${k}`), tablets: () => TABLETS, enabled, countPending, resetState, emailFor, hash, _state: getState};
})();
