/* Ram Gear Jobs - tablet-first offline forms app. Customers > Jobs > Forms. No backend; all data in IndexedDB on this device. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const view = $('#view');
  let FORMS = null, FORM_BY_ID = {}, BASE_DEF = {}, BASES = [], KINDS = {}, REQS = {}, CALCS = {};   // defs per id 'teardown@3'; BASES: form keys in display order
  let urls = [];            // object URLs to revoke on navigation
  let pendingPhoto = null;  // {jobId, scope, label}
  let current = {customer: null, job: null, formKey: null};
  let saveTimer = null;
  const P = {
    home: () => '#/',
    cust: c => `#/c/${encodeURIComponent(c)}`,
    job: (c, j) => `#/c/${encodeURIComponent(c)}/j/${encodeURIComponent(j)}`,
    form: (c, j, k) => `#/c/${encodeURIComponent(c)}/j/${encodeURIComponent(j)}/f/${k}`,
    parts: (c, j) => `#/c/${encodeURIComponent(c)}/j/${encodeURIComponent(j)}/parts`,
  };

  const fmtDate = t => t ? new Date(t).toLocaleString([], {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : '';
  const fmtDay = t => t ? new Date(t).toLocaleDateString([], {year: 'numeric', month: 'short', day: 'numeric'}) : '';
  const HOME_LABEL = 'Industrial Gearbox Data', APP_TITLE = 'Ram-Gear Manufacturing Incorporated';
  const REV = self.APP_REV || '?', BUILD = self.APP_BUILD || '?', REV_LABEL = `Rev ${REV} (build ${BUILD})`;   // from js/version.js
  /* ---------- Tablet ID (device name, settings key 'device') ---------- */
  let TABLET = '';
  const loadTablet = async () => { TABLET = ((await DB.get('settings', 'device')) || {}).tabletId || ''; return TABLET; };
  const saveTablet = async id => { await DB.put('settings', {key: 'device', tabletId: id, updatedAt: Date.now()}); TABLET = id; };
  const tabletInput = (val, label = 'Tablet ID (name of this device)') => `<label class="fld"><span>${label}</span><input name="tablet" required maxlength="60" autocomplete="off" placeholder="e.g. Shop Tablet 2" value="${esc(val || '')}"></label>`;
  /* ---------- backup reminder ---------- */
  const DAY = 86400000, INTERVALS = [1, 3, 7];
  const lastBackupText = m => m.lastBackupAt ? fmtDate(m.lastBackupAt) : 'Never';
  function daysAgo(t) { const d = Math.floor((Date.now() - t) / DAY); return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; }
  function backupDue(m, now = Date.now()) {
    const changed = m.lastChangeAt > (m.lastBackupAt || 0);
    const old = !m.lastBackupAt || now - m.lastBackupAt >= (INTERVALS.includes(m.intervalDays) ? m.intervalDays : 3) * DAY;
    return changed && old && !(m.snoozeUntil > now);
  }
  async function showBackupBanner() {
    const host = $('#backupBanner'); if (!host) return;
    const m = await DB.getMeta();
    if (!backupDue(m)) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = `<div class="bb-text"><b>Last backup: ${m.lastBackupAt ? daysAgo(m.lastBackupAt) : 'Never'}.</b> Back up now to keep your data safe.</div>
      <div class="bb-actions"><button class="btn primary big" id="bbNow">Back up now</button><button class="btn" id="bbLater">Remind me later</button></div>`;
    $('#bbNow').onclick = backup;
    $('#bbLater').onclick = async () => { await DB.updateMeta(() => ({snoozeUntil: Date.now() + DAY})); host.hidden = true; host.innerHTML = ''; toast('We’ll remind you again in 24 hours'); };
  }
  async function showStorageBanner() {
    const host = $('#storageBanner'); if (!host) return;
    const st = await storageStatus(false), pref = (await DB.get('settings', 'storageWarn')) || {};
    if (st.persisted !== false || pref.dismissedUntil > Date.now()) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = `${storageNotice(st, false)}<div class="bb-actions"><button class="btn primary" id="sbPersist">Keep data on this device</button><button class="btn" id="sbLater">Hide for 14 days</button></div>`;
    $('#sbPersist').onclick = async () => {
      const r = await storageStatus(true);
      await audit('Persistent storage requested', `${r.browser}: ${r.persisted ? 'granted' : 'not granted'}`, 'done');
      if (r.persisted) { toast('Persistent storage granted – the browser will keep this data'); host.hidden = true; }
      else toast(`${r.browser} did not grant persistent storage. Follow the steps shown to add an exception.`, 5000);
    };
    $('#sbLater').onclick = async () => { await DB.put('settings', {key: 'storageWarn', dismissedUntil: Date.now() + 14 * DAY}); host.hidden = true; };
  }
  async function refreshBackupInfo() {
    const m = await DB.getMeta();
    $$('[data-lastbk]').forEach(el => { el.textContent = `Last backup: ${lastBackupText(m)}`; });
    if (!backupDue(m)) { const h = $('#backupBanner'); if (h) { h.hidden = true; h.innerHTML = ''; } }
  }
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  function objUrl(blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; }
  function hideToast() { $('#toast').classList.remove('show'); }
  function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }

  /* ---------- dialogs ---------- */
  function modal(html, buttons, opts = {}) {
    const dlg = $('#dlg'), f = $('#dlgForm'); f.onclick = null; hideToast();
    f.innerHTML = `<div class="dlg-body">${html}</div><div class="dlg-actions">${buttons.map(b =>
      `<button value="${esc(b.value)}" class="btn ${b.cls || ''}" ${b.value === 'cancel' || b.novalidate ? 'formnovalidate' : ''}>${esc(b.label)}</button>`).join('')}</div>`;
    dlg.className = [opts.wide ? 'wide' : '', opts.cls || ''].join(' ').trim();
    // Enter in a text field activates the dialog's main button (browsers would otherwise pick the FIRST button, usually Cancel)
    f.onkeydown = ev => {
      if (ev.key !== 'Enter' || ev.isComposing || ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const t = ev.target; if (!t.matches || !t.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]),select')) return;
      const btns = [...f.querySelectorAll('.dlg-actions button')], def = btns.find(b => /\b(primary|danger)\b/.test(b.className)) || btns.filter(b => b.value !== 'cancel').pop();
      ev.preventDefault(); if (def && !def.disabled) def.click();
    };
    dlg.oncancel = opts.mandatory ? ev => ev.preventDefault() : null;
    dlg.onkeydown = opts.mandatory ? ev => { if (ev.key === 'Escape') ev.preventDefault(); } : null;
    return new Promise(res => {
      const done = () => { dlg.removeEventListener('close', done); res(dlg.returnValue || 'cancel'); };
      dlg.addEventListener('close', done);
      dlg.returnValue = ''; dlg.showModal();
      if (opts.onOpen) opts.onOpen(f, dlg);
      const first = $('input,textarea,select', f);
      if (first && !opts.noFocus) setTimeout(() => { if (dlg.open && !f.contains(document.activeElement)) first.focus(); }, 50);   // never steal focus from a field the user is already typing in
    });
  }
  const confirmBox = (title, msg, okLabel = 'OK', danger = false) =>
    modal(`<h2>${esc(title)}</h2><p>${msg}</p>`, [{label: 'Cancel', value: 'cancel'}, {label: okLabel, value: 'ok', cls: danger ? 'danger' : 'primary'}]).then(v => v === 'ok');

  /* ---------- sharing ---------- */
  // Web Share with files: iPad/Android/Chrome+Edge on Windows. Desktop Firefox (and some desktop browsers) can't share files,
  // so there the Share buttons are replaced by Download.
  const CAN_SHARE_FILES = (() => { try { return !!(navigator.canShare && navigator.canShare({files: [new File(['x'], 'x.pdf', {type: 'application/pdf'})]})); } catch (e) { return false; } })();
  const shareBtns = () => CAN_SHARE_FILES ? [{label: 'Download', value: 'dl'}, {label: 'Share', value: 'share', cls: 'primary'}] : [{label: 'Download', value: 'dl', cls: 'primary'}];
  const SHARE_FINAL = CAN_SHARE_FILES ? 'Share final PDF' : 'Download final PDF', SHARE = CAN_SHARE_FILES ? 'Share' : 'Download';
  async function shareOrDownload(blob, filename, title) {
    const file = new File([blob], filename, {type: blob.type || 'application/octet-stream'});
    if (navigator.canShare && navigator.canShare({files: [file]})) {
      try { await navigator.share({files: [file], title: title || filename}); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelled'; console.warn('share failed, downloading', e); }
    }
    download(blob, filename); return 'downloaded';
  }
  function download(blob, filename) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  function openBlob(blob) {
    const u = URL.createObjectURL(blob); setTimeout(() => URL.revokeObjectURL(u), 600000);
    const w = window.open(u, '_blank'); if (!w) location.href = u;
  }
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function printPdf(blob, filename) {
    if (isIOS()) { toast('On iPad: use Share, then Print', 3500); return shareOrDownload(blob, filename || 'print.pdf'); }
    const u = URL.createObjectURL(blob), fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
    fr.src = u; document.body.appendChild(fr);
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { openBlob(blob); } setTimeout(() => { fr.remove(); URL.revokeObjectURL(u); }, 120000); };
  }
  async function fileReady(blob, filename, heading, isPdf = true) {
    // Separate tap so the share sheet keeps the user gesture (required on iPad Safari).
    const v = await modal(`<h2>${esc(heading || 'File ready')}</h2><p class="mono">${esc(filename)}</p><p class="muted">${(blob.size / 1024).toFixed(0)} KB</p>`,
      [{label: 'Close', value: 'cancel'}].concat(isPdf ? [{label: 'Open', value: 'open'}, {label: 'Print', value: 'print'}] : [])
        .concat(shareBtns()));
    if (v === 'share') await shareOrDownload(blob, filename);
    else if (v === 'dl') download(blob, filename);
    else if (v === 'open') openBlob(blob);
    else if (v === 'print') printPdf(blob, filename);
  }

  /* ---------- storage persistence (warn when the browser may delete this app's data) ---------- */
  const BROWSER = /Firefox\//.test(navigator.userAgent) ? 'Firefox' : /Edg\//.test(navigator.userAgent) ? 'Edge' : /Chrome\//.test(navigator.userAgent) ? 'Chrome' : /Safari\//.test(navigator.userAgent) ? 'Safari' : 'this browser';
  let STORAGE = {persisted: null, supported: !!(navigator.storage && navigator.storage.persisted), browser: BROWSER};
  async function storageStatus(request) {
    if (!STORAGE.supported) return STORAGE;
    try {
      let ok = await navigator.storage.persisted();
      if (!ok && request && navigator.storage.persist) ok = await navigator.storage.persist();
      STORAGE = {...STORAGE, persisted: ok, checkedAt: Date.now()};
    } catch (e) { STORAGE = {...STORAGE, persisted: null, error: e.message}; }
    return STORAGE;
  }
  const HOST = location.origin;
  function storageHelp() {
    if (BROWSER === 'Firefox') return `<b>Firefox:</b> open <b>Settings › Privacy &amp; Security › Cookies and Site Data</b>. Either turn off <b>“Delete cookies and site data when Firefox is closed”</b>, or click <b>Manage Exceptions…</b>, enter <code>${esc(HOST)}</code>, click <b>Allow</b> (not “Allow for Session”), then <b>Save Changes</b>. Also check that <b>History</b> is not set to “Never remember history”, and that this is not a Private Window.`;
    if (BROWSER === 'Edge') return `<b>Edge:</b> open <b>Settings › Cookies and site permissions › Manage and delete cookies and site data</b>. Turn off <b>“Clear cookies and site data when you close all windows”</b>, or add <code>${esc(HOST)}</code> under <b>Allow</b>. Don't use an InPrivate window. Installing the app (⊕ in the address bar) also keeps its data.`;
    if (BROWSER === 'Chrome') return `<b>Chrome:</b> open <b>Settings › Privacy and security › Site settings › Additional content settings › On-device site data</b>. Choose <b>“Allow sites to save data on your device”</b>, or add <code>${esc(HOST)}</code> under <b>Allowed to save data on your device</b>. Don't use an Incognito window. Installing the app also keeps its data.`;
    return 'Allow this site to keep its data in the browser settings, and do not use a private window.';
  }
  function storageNotice(st, setup) {
    if (st.persisted === true && !setup) return '';   // note: persistent storage does not stop "delete site data on close" settings, so setup always explains
    return `<div class="store-warn" role="note"><b>${setup ? 'Seeing this setup screen again?' : 'Your data may be deleted when the browser closes.'}</b>
      ${setup ? ` Then ${esc(st.browser)} deleted this app's data (accounts, jobs, photos) when it was closed, usually because of a privacy setting.` : ` ${esc(st.browser)} has not granted persistent storage to this app.`}
      To keep your data: ${storageHelp()}</div>`;
  }
  function showFatal(title, html) {
    document.body.classList.add('locked'); const scr = $('#login'); scr.hidden = false;
    $('#loginForm').innerHTML = `<img class="login-logo" src="img/ramgear-logo.jpg" alt="Ram-Gear Manufacturing Inc logo" width="383" height="92">
      <h1 class="login-company">Ram-Gear Manufacturing Incorporated</h1><div class="store-error" id="storageError" role="alert"><h2>${esc(title)}</h2>${html}</div>
      <button class="btn primary big" type="button" id="retryBtn">Try again</button><p class="login-rev">${esc(REV_LABEL)}</p>`;
    $('#retryBtn').onclick = () => location.reload();
  }
  function storageError(e) {
    showFatal("Can't open this app's storage", `<p>The app could not read its data on this device, so it will <b>not</b> ask you to set it up again (that could hide your existing accounts and jobs).</p>
      <p class="muted small">Details: ${esc((e && (e.name ? e.name + ': ' : '') + (e.message || e)) || 'unknown error')}</p>
      <ul><li>Close other tabs or windows that have this app open, then tap <b>Try again</b>.</li><li>Don't use a private / InPrivate / Incognito window. Private windows may block or discard storage.</li><li>${storageHelp()}</li></ul>`);
  }
  window.addEventListener('rg-db-versionchange', () => { if (USER) toast('The app was updated in another tab – reloading…', 4000); setTimeout(() => location.reload(), 800); });

  /* ---------- users, session, admin approval (local, per device) ---------- */
  let USER = null;            // signed-in user record
  let lastActive = Date.now(), lastPersist = 0;
  const ROLE_LABEL = {admin: 'Admin', technician: 'Technician'};
  const isAdmin = () => !!USER && USER.role === 'admin';
  const userName = () => USER ? USER.displayName : '';
  async function audit(action, item, result = 'approved', adminName) {
    await DB.put('audit', {id: DB.uid(), at: Date.now(), action, item: item || '', admin: adminName || userName(), user: userName(), result, tablet: TABLET});
  }
  const secretInput = (name, label, autocomplete = 'off') => `<label class="fld"><span>${label}</span><input name="${name}" type="password" autocomplete="${autocomplete}" autocapitalize="none" spellcheck="false" required class="pin"></label>`;
  const pinInput = secretInput;
  /* Admin approval: an active Admin re-enters their password/PIN (the signed-in Admin, or any Admin for a Technician).
     5 wrong attempts lock approval for 30 s (persisted). Every attempt is written to the audit log. */
  async function checkApproval(uname, secret) {
    const ls = await Admin.lockState(), now = Date.now();
    if (ls.until > now) return {ok: false, locked: ls.until - now};
    const u = await Auth.byUsername(uname);
    if (u && u.role === 'admin' && !u.disabled && await Auth.verify(u, secret)) { await DB.put('settings', {key: 'lockout', fails: 0, until: 0}); return {ok: true, user: u}; }
    ls.fails = (ls.fails || 0) + 1;
    if (ls.fails >= Admin.MAX_FAILS) { ls.fails = 0; ls.until = now + Admin.LOCK_MS; await DB.put('settings', ls); return {ok: false, locked: Admin.LOCK_MS, justLocked: true}; }
    await DB.put('settings', ls); return {ok: false, left: Admin.MAX_FAILS - ls.fails};
  }
  async function requireAdmin(action, item) {
    let msg = '';
    for (;;) {
      const ls = await Admin.lockState(), lockedMs = ls.until - Date.now();
      const lockMsg = lockedMs > 0 ? `Too many wrong PINs. Try again in ${Math.ceil(lockedMs / 1000)} s.` : '';
      const v = await modal(`<h2>🔐 Admin approval required</h2>
        <p><b>${esc(action)}</b>${item ? `<br><span class="muted">${esc(item)}</span>` : ''}</p>
        ${isAdmin() ? `<p class="muted small">Approving as <b>${esc(USER.displayName)}</b> (Admin). Re-enter your password or PIN.</p>`
          : `<p class="muted small">Only an Admin can approve this. Ask an Admin to enter their username and password or PIN.</p>
             <label class="fld"><span>Admin username</span><input name="auser" required autocomplete="off" autocapitalize="none" spellcheck="false"></label>`}
        ${pinInput('pin', 'Admin password or PIN')}
        ${msg || lockMsg ? `<p class="pin-error" role="alert">${esc(lockMsg || msg)}</p>` : ''}`,
        [{label: 'Cancel', value: 'cancel'}, {label: 'Approve', value: 'ok', cls: 'primary'}], {cls: 'approval'});
      if (v !== 'ok') { toast('Not approved – nothing was changed'); return false; }
      const f = $('#dlgForm'), uname = isAdmin() ? USER.username : f.auser.value;
      const r = await checkApproval(uname, f.pin.value), who = (r.user && r.user.displayName) || (isAdmin() ? USER.displayName : Auth.norm(uname));
      if (r.ok) { await audit(action, item, 'approved', who); return true; }
      if (r.locked) { await audit(action, item, r.justLocked ? 'wrong PIN – locked 30 s' : 'blocked (locked out)', who); msg = `Too many wrong PINs. Locked for ${Math.ceil(r.locked / 1000)} s.`; }
      else { await audit(action, item, 'wrong PIN', who); msg = `Incorrect PIN or password. ${r.left} attempt${r.left === 1 ? '' : 's'} left before a 30 s lockout.`; }
    }
  }
  /* New-secret dialog (first-run admin, change own secret, new user, reset). */
  function secretError(p1, p2) { return !Auth.validSecret(p1) ? Auth.secretRule : p1 !== p2 ? 'The two entries do not match.' : ''; }
  async function firstRunSetup() {
    let err = '', prev = {name: '', tablet: TABLET};
    for (;;) {
      const sn = await storageStatus(false);
      const choice = await modal(`<h2>Create the first Admin account</h2>${storageNotice(sn, true)}${Cloud.configured ? `<p class="infobar">Additional tablet? Tap <b>Connect to company cloud</b> and sign in with your existing username and password/PIN – accounts and jobs are downloaded.</p>` : ''}<p class="small"><a href="help.html" target="_blank" rel="noopener" id="setupHelp">Help &amp; setup guide</a></p><p class="muted">This tablet has no user accounts yet. The first account is an <b>Admin</b>: it signs in, manages users (Admin screen › Users) and approves deleting, reopening and restoring. There is no self sign-up. Passwords/PINs are stored only as salted hashes on this device and cannot be recovered.</p>
        <label class="fld"><span>Admin name (also the username)</span><input name="aname" required autocomplete="off" value="${esc(prev.name)}"></label>
        ${!TABLET ? tabletInput(prev.tablet) : ''}
        <div class="grid2">${secretInput('pin1', 'Password or PIN', 'new-password')}${secretInput('pin2', 'Enter it again', 'new-password')}</div>
        <p class="muted small">${Auth.secretRule}</p>
        ${err ? `<p class="pin-error" role="alert">${esc(err)}</p>` : ''}`,
        (Cloud.configured ? [{label: 'Connect to company cloud', value: 'cloud', cls: 'accent', novalidate: true}] : []).concat([{label: 'Create admin account', value: 'ok', cls: 'primary'}]), {mandatory: true});
      if (choice === 'cloud') { if (await cloudJoin()) return; err = ''; continue; }
      const f = $('#dlgForm'), name = f.aname.value.trim(), tablet = f.tablet ? f.tablet.value.trim() : null;
      prev = {name, tablet: tablet ?? TABLET};
      err = !name ? 'Enter the admin name.' : tablet === '' ? 'Enter a Tablet ID for this device (e.g. Shop Tablet 2).' : secretError(f.pin1.value, f.pin2.value);
      if (err) continue;
      const persistP = storageStatus(true);   // ask the browser to keep this site's data (Firefox shows a prompt); runs with the click gesture
      if (tablet) await saveTablet(tablet);
      const u = await Auth.create({username: name, displayName: name, role: 'admin', secret: f.pin1.value, createdBy: 'first-run setup'});
      await DB.put('settings', {key: 'accounts', createdAt: Date.now(), by: 'first-run setup'});
      persistP.then(st => audit('Persistent storage requested', `${st.browser}: ${st.persisted ? 'granted' : 'not granted'}`, 'done')).catch(() => {});
      startSession(u);
      await audit('Admin account created', `${u.displayName} (username "${u.username}")`, 'done');
      if (tablet) await audit('Tablet ID set', tablet, 'done');
      toast('Admin account created'); return;
    }
  }
  /* ---------- login screen ---------- */
  function startSession(u) {
    USER = u; lastActive = Date.now(); Auth.setSession({userId: u.id, lastActive});
    document.body.classList.remove('locked'); $('#login').hidden = true; renderUserBox();
  }
  function renderUserBox() {
    const box = $('#userBox'); if (!box) return;
    renderCloudChip(Cloud.status());
    box.innerHTML = USER ? `<span class="user-chip" title="Signed in on ${esc(TABLET)}"><span aria-hidden="true">👤</span> <b id="userName">${esc(USER.displayName)}</b> <span class="role-tag">${ROLE_LABEL[USER.role]}</span></span><button class="btn ghost" id="logoutBtn">Log out</button>` : '';
    if (USER) $('#logoutBtn').onclick = logout;
  }
  function showLogin(message, username, recovery) {
    return new Promise(res => {
      const rb = $('#loginRestoreBtn'); rb.hidden = !recovery; rb.onclick = () => $('#fileRestore').click();
      const scr = $('#login'), f = $('#loginForm');
      document.body.classList.add('locked'); scr.hidden = false;
      $('#loginTablet').textContent = TABLET ? `Tablet: ${TABLET}` : '';
      $('#loginRev').textContent = REV_LABEL;
      const m = $('#loginMsg'); m.textContent = message || ''; m.hidden = !message;
      const err = $('#loginErr'); err.hidden = true; err.textContent = '';
      f.username.value = username || ''; f.secret.value = '';
      setTimeout(() => { if (!f.contains(document.activeElement)) (username ? f.secret : f.username).focus(); }, 60);   // never move the cursor once the user has started typing
      f.onsubmit = async e => {
        e.preventDefault();
        const btn = $('#loginBtn'); btn.disabled = true;
        const uname = f.username.value, secret = f.secret.value;
        let r = await Auth.login(uname, secret);
        if (!r.ok && !r.locked && Cloud.enabled() && navigator.onLine) {
          // not known here (yet): a user added or a password changed on another tablet – check the cloud, download accounts, retry
          try { $('#loginErr').hidden = true; await Cloud.signIn(uname, secret); await Cloud.sync('login'); r = await Auth.login(uname, secret); } catch (e) { console.warn('cloud sign-in', e); }
        }
        btn.disabled = false; f.secret.value = '';
        if (r.ok) {
          startSession(r.user); await audit('Signed in', r.user.username, 'done');
          if (Cloud.enabled()) Cloud.signIn(uname, secret).then(() => Cloud.sync('login')).catch(e => console.warn('cloud sign-in', e.message));
          f.onsubmit = null; res(r.user); return;
        }
        const who = r.user ? r.user.displayName : Auth.norm(uname);
        await DB.put('audit', {id: DB.uid(), at: Date.now(), action: 'Sign-in failed', item: Auth.norm(uname), admin: '', user: who, tablet: TABLET,
          result: r.locked ? (r.justLocked ? 'wrong password – locked 30 s' : 'blocked (locked out)') : r.disabled ? 'account disabled' : 'wrong username or password'});
        err.textContent = r.locked ? `Too many failed sign-ins. Try again in ${Math.ceil(r.locked / 1000)} s.`
          : `Wrong username or password/PIN. ${r.left} attempt${r.left === 1 ? '' : 's'} left before a 30 s lockout.`;
        err.hidden = false; f.secret.focus();
      };
    });
  }
  function closeOverlays() {
    if (Camera.isOpen()) Camera.close();
    const d = $('#dlg'); if (d.open) d.close('cancel');
    const vw = $('.viewer'); if (vw) vw.remove();
  }
  async function endSession(reason) {
    await flushSave(); closeOverlays();
    if (Cloud.enabled()) { await Promise.race([Cloud.sync('logout'), new Promise(r => setTimeout(r, 5000))]); await Cloud.signOut(); }
    const was = USER; USER = null; Auth.setSession(null); renderUserBox();
    return was;
  }
  async function logout() {
    await audit('Signed out', USER.username, 'done');
    await endSession('logout');
    location.hash = P.home();
    view.innerHTML = '';
    const u = await showLogin('You have been signed out.');
    await afterLogin(u, null); route();
  }
  async function idleLock() {
    if (!USER) return;
    const mins = await Auth.idleMinutes();
    await audit('Auto-locked (idle)', `${USER.username} – ${mins} min without activity`, 'done');
    const was = await endSession('idle');
    view.innerHTML = '';
    const u = await showLogin(`Locked after ${mins} minutes without activity. Sign in to continue.`, was.username);
    await afterLogin(u, was); route();
  }
  async function afterLogin(u, prevUser) {
    await ensureTablet();
    if (prevUser && prevUser.id !== u.id) location.hash = P.home();   // a different person unlocked: start at home
  }
  /* idle tracking */
  function touchActivity() {
    lastActive = Date.now();
    if (USER && lastActive - lastPersist > 5000) { lastPersist = lastActive; Auth.setSession({userId: USER.id, lastActive}); }
  }
  ['pointerdown', 'keydown', 'input', 'touchstart', 'wheel'].forEach(ev => document.addEventListener(ev, touchActivity, {capture: true, passive: true}));
  let idleMs = 15 * 60000;
  const refreshIdle = async () => { idleMs = (await Auth.idleMinutes()) * 60000; };
  async function checkIdle() { if (USER && Date.now() - lastActive >= idleMs) await idleLock(); }
  setInterval(checkIdle, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkIdle(); else if (USER) Auth.setSession({userId: USER.id, lastActive}); });
  /* On app open: resume this tab's session only if it has not been idle longer than the timeout. */
  async function resumeSession() {
    const s = Auth.getSession(); if (!s) return null;
    const u = (await Auth.all()).find(x => x.id === s.userId);
    if (!u || u.disabled || Date.now() - (s.lastActive || 0) >= idleMs) { Auth.setSession(null); return null; }
    startSession(u); return u;
  }

  /* Devices set up before Tablet IDs existed: ask once (no PIN needed to set it the first time). */
  async function ensureTablet() {
    if (TABLET) return;
    let err = '';
    for (;;) {
      await modal(`<h2>Name this tablet</h2><p class="muted">The Tablet ID is stamped on every new job and on each form when it is finalized ("Inspected on"). Changing it later needs the admin PIN.</p>${tabletInput('')}${err ? `<p class="pin-error" role="alert">${esc(err)}</p>` : ''}`,
        [{label: 'Save Tablet ID', value: 'ok', cls: 'primary'}], {mandatory: true});
      const id = $('#dlgForm').tablet.value.trim();
      if (id) { await saveTablet(id); await audit('Tablet ID set', id, 'done'); toast(`Tablet ID: ${id}`); return; }
      err = 'Enter a Tablet ID (e.g. Shop Tablet 2).';
    }
  }
  async function changeTablet() {
    const old = TABLET;
    if (!await requireAdmin('Change Tablet ID', old || '(not set)')) return;
    const v = await modal(`<h2>Change Tablet ID</h2><p class="muted">New jobs and forms finalized from now on will show the new name. Existing jobs and saved PDFs keep the name they were stamped with.</p>${tabletInput(old)}`,
      [{label: 'Cancel', value: 'cancel'}, {label: 'Save', value: 'ok', cls: 'primary'}]);
    const id = v === 'ok' ? $('#dlgForm').tablet.value.trim() : '';
    if (!id || id === old) { toast('Tablet ID unchanged'); return; }
    await saveTablet(id); await audit('Tablet ID changed', `${old} → ${id}`, 'done');
    toast(`Tablet ID changed to ${id}`); renderSettings();
  }
  async function newSecretDialog(title, intro) {
    let err = '';
    for (;;) {
      const v = await modal(`<h2>${esc(title)}</h2><p class="muted">${intro}</p>
        <div class="grid2">${secretInput('pin1', 'New password or PIN', 'new-password')}${secretInput('pin2', 'Enter it again', 'new-password')}</div>
        <p class="muted small">${Auth.secretRule}</p>${err ? `<p class="pin-error" role="alert">${esc(err)}</p>` : ''}`,
        [{label: 'Cancel', value: 'cancel'}, {label: 'Save', value: 'ok', cls: 'primary'}]);
      if (v !== 'ok') return null;
      const f = $('#dlgForm'); err = secretError(f.pin1.value, f.pin2.value);
      if (!err) return f.pin1.value;
    }
  }
  async function changePin() {
    if (!await requireAdmin('Change my password / PIN', USER.displayName)) return;
    const s = await newSecretDialog('Change my password / PIN', `Signed in as <b>${esc(USER.displayName)}</b>. Enter the new password or PIN twice.`);
    if (!s) return;
    if (Cloud.enabled() && !await cloudReady('change your password / PIN')) return;
    await Auth.setSecret(USER, s);
    if (Cloud.enabled()) { try { await Cloud.setOwnPassword(USER, s); } catch (e) { modal(`<h2>Cloud update failed</h2><p>The new password/PIN works on this tablet, but the cloud account was not updated: ${esc(e.message)}</p>`, [{label: 'Close', value: 'cancel'}]); } }
    await audit('Password/PIN changed', USER.displayName, 'done');
    toast('Password / PIN changed'); renderSettings();
  }
  /* ---------- cloud sync (Rev 1.2) ---------- */
  const syncText = s => !s.enabled ? '' : s.running ? '☁ Syncing…' : !s.online ? `☁ Offline${s.pending ? ` · ${s.pending} change${s.pending === 1 ? '' : 's'} waiting` : ''}`
    : s.problem === 'reset' ? '☁ Cloud empty – re-upload needed' : s.problem === 'nomember' ? '☁ Cloud account missing' : s.problem === 'disabled' ? '☁ Cloud account disabled' : s.problem === 'signin' ? '☁ Sign in again' : s.lastError ? '☁ Sync problem' : s.pending ? `☁ ${s.pending} to sync` : s.lastSyncAt ? `☁ Synced ${new Date(s.lastSyncAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}` : '☁ Connected';
  function renderCloudChip(s) {
    const c = $('#cloudChip'); if (!c) return;
    c.hidden = !s.enabled || !USER; c.textContent = syncText(s);
    c.classList.toggle('bad', !!s.lastError); c.classList.toggle('off', !s.online); c.title = s.lastError || 'Cloud sync';
    const line = $('#cloudStatus'); if (line) line.textContent = syncText(s) + (s.lastError && !s.problem ? ` – ${s.lastError}` : '');
    const pb = $('#cloudProblem'); if (pb) { pb.hidden = !(s.problem && s.lastError); pb.textContent = s.problem ? s.lastError : ''; }
    const rb = $('#cloudReuploadBtn'); if (rb) rb.classList.toggle('primary', s.problem === 'reset' || s.problem === 'nomember');
  }
  async function cloudProgress(title, work) {
    const dlg = modal(`<h2>${esc(title)}</h2><p class="muted" id="cloudProg">Working… keep this screen open.</p>`, [], {mandatory: true, noFocus: true});
    try { return await work(); } finally { const d = $('#dlg'); if (d.open) d.close('cancel'); await dlg; }
  }
  const cloudErr = (title, e) => modal(`<h2>${esc(title)}</h2><p>${esc(e.message || e)}</p><p class="muted small">Check the internet connection and try again.</p>`, [{label: 'Close', value: 'cancel'}]);
  /* New tablet: sign in with an existing cloud account and download users + data. */
  async function cloudJoin() {
    let err = '', prev = {u: '', t: TABLET};
    for (;;) {
      const v = await modal(`<h2>Connect to company cloud</h2><p class="muted">Sign in with <b>your existing username and password/PIN</b> (the same you use on the other tablets). Accounts, customers, jobs, photos and saved PDFs are downloaded to this tablet, and changes sync automatically from now on.</p>
        <label class="fld"><span>Username</span><input name="cuser" required autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(prev.u)}"></label>
        ${secretInput('csecret', 'Password or PIN', 'current-password')}
        ${!TABLET ? tabletInput(prev.t) : ''}
        ${err ? `<p class="pin-error" role="alert">${esc(err)}</p>` : ''}`,
        [{label: 'Back', value: 'cancel'}, {label: 'Connect', value: 'ok', cls: 'primary'}], {mandatory: true});
      if (v !== 'ok') return null;
      const f = $('#dlgForm'), uname = Auth.norm(f.cuser.value), secret = f.csecret.value, tablet = f.tablet ? f.tablet.value.trim() : TABLET;
      prev = {u: uname, t: tablet};
      if (!uname || !secret) { err = 'Enter your username and password/PIN.'; continue; }
      if (!tablet) { err = 'Enter a Tablet ID for this device (e.g. Shop Tablet 3).'; continue; }
      if (!navigator.onLine) { err = 'This tablet is offline. Connect to Wi-Fi first.'; continue; }
      try {
        const u = await cloudProgress('Connecting…', async () => {
          await Cloud.signIn(uname, secret);
          await saveTablet(tablet);
          await Cloud.connect({email: uname});
          const r = await Cloud.sync('join'); if (r.error) throw new Error(r.error);
          const lu = await Auth.byUsername(uname);
          if (!lu || !await Auth.verify(lu, secret)) throw new Error('Signed in, but the account could not be set up on this tablet. Ask an Admin to reset your password/PIN.');
          return lu;
        });
        await DB.put('settings', {key: 'accounts', createdAt: Date.now(), by: 'cloud join'});
        storageStatus(true);
        startSession(u); await audit('Tablet connected to cloud', `${tablet} – signed in as ${u.username}`, 'done'); if (tablet) await audit('Tablet ID set', tablet, 'done');
        toast('Connected – company data downloaded'); return u;
      } catch (e) { await Cloud.disconnect().catch(() => {}); err = e.message; }
    }
  }
  /* Existing tablet (signed-in Admin): connect and upload this tablet's data. The very first tablet also needs the setup code. */
  async function cloudConnect(opts = {}) {
    const re = !!opts.reupload;
    if (!navigator.onLine) return cloudErr('Offline', 'Connect to the internet first.');
    let first;
    try { first = !(await Cloud.bootstrapped()); } catch (e) { return cloudErr('Cloud not reachable', e); }
    let err = '';
    for (;;) {
      const v = await modal(`<h2>${re ? 'Re-upload all data from this device' : 'Connect this tablet to the cloud'}</h2>
        ${re ? `<p>Uploads <b>everything on this device</b> to the company cloud again: users, customers, jobs, forms, photos and saved PDFs. Nothing is deleted, here or in the cloud; records that are already in the cloud are updated with this device's version.</p>` : ''}
        ${first ? `<p>This is the <b>first tablet</b> to connect. It creates the company's cloud Admin account (<b>${esc(USER.username)}</b>, same password/PIN as here) and uploads all users, customers, jobs, photos and saved PDFs from this tablet.</p>
          <label class="fld"><span>Setup code (one-time, from the cloud setup)</span><input name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false"></label>`
          : `<p>Sign in with your cloud account. This tablet's customers, jobs, photos and saved PDFs are uploaded and merged with the company data; its users are added to the cloud (existing usernames keep the cloud account).</p>`}
        ${secretInput('csecret', `Your password or PIN (${esc(USER.username)})`, 'current-password')}
        ${err ? `<p class="pin-error" role="alert">${esc(err)}</p>` : ''}`,
        [{label: 'Cancel', value: 'cancel'}, {label: re ? 'Re-upload' : 'Connect', value: 'ok', cls: 'primary'}]);
      if (v !== 'ok') return;
      const f = $('#dlgForm'), secret = f.csecret.value, code = f.code ? f.code.value.trim() : '';
      if (first && !code) { err = 'Enter the setup code.'; continue; }
      if (!await Auth.verify(USER, secret)) { err = 'Wrong password or PIN.'; continue; }
      try {
        const res = await cloudProgress(re ? 'Re-uploading…' : 'Connecting and uploading…', async () => {
          if (first) await Cloud.bootstrap(code, USER, secret);
          await Cloud.signIn(USER.username, secret);
          const mine = await Cloud.me(); if (!mine) throw new Error('This cloud account is not an active member.');
          let imported = [];
          if (mine.role === 'admin') imported = (await Cloud.importUsers((await Auth.all()).filter(u => u.id !== mine.id))).results || [];
          await Cloud.connect({email: USER.username, reupload: true});   // always upload everything this device has (Rev 1.4.1)
          const r = await Cloud.sync(re ? 'reupload' : 'connect'); if (r.error) throw new Error(r.error);
          return {imported, mine};
        });
        await audit(re ? 'All data re-uploaded to cloud' : 'Tablet connected to cloud', `${TABLET} – ${first ? 'first tablet (cloud Admin created)' : 'joined'}; users: ${res.imported.map(x => `${x.username} ${x.result}`).join(', ') || 'none'}`, 'done');
        toast(re ? 'Re-upload finished – the cloud has everything from this device' : 'Connected – this tablet now syncs with the cloud', 4500); renderSettings(); return;
      } catch (e) { if (!re) await Cloud.disconnect().catch(() => {}); err = e.message; }
    }
  }
  async function cloudCard() {
    if (!Cloud.configured) return '';
    const s = Cloud.status(), tabs = Cloud.tablets();
    if (!s.enabled) return `<section class="card" id="cloudCard"><div class="card-head"><h2>Cloud sync</h2><span class="badge off">Off</span></div>
      <p>Keep all tablets in step and keep a copy of everything off the tablet: users, customers, jobs, forms, photos and saved PDFs sync through the company cloud when online. The tablet keeps working offline; changes are sent when it is back online.</p>
      <div class="fr-actions" style="justify-content:flex-start"><button class="btn primary" id="cloudConnectBtn">Connect this tablet to the cloud</button></div></section>`;
    return `<section class="card" id="cloudCard"><div class="card-head"><h2>Cloud sync</h2><span class="badge done">On</span></div>
      <div class="details"><div><div class="muted small">Status</div><div id="cloudStatus">${esc(syncText(s))}</div></div>
        <div><div class="muted small">Connected</div><div>${esc(fmtDate(s.connectedAt))}</div></div><div><div class="muted small">This tablet</div><div>${esc(TABLET)}</div></div></div>
      ${tabs.length ? `<div class="tablewrap"><table class="tbl"><thead><tr><th>Tablet</th><th>Last seen</th><th>Last user</th><th>App</th></tr></thead><tbody>${tabs.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(fmtDate(Date.parse(t.last_seen_at)))}</td><td>${esc(t.last_user || '')}</td><td>${esc(t.app_rev || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="muted small">Forms are checked out while open ("In use on …"), so two tablets can't overwrite each other. Finalized forms are locked on every tablet. User accounts are managed here and apply to all tablets (needs internet).</p>
      <p class="store-warn" id="cloudProblem" role="status" ${s.problem && s.lastError ? '' : 'hidden'}>${esc(s.problem ? s.lastError : '')}</p>
      <div class="fr-actions" style="justify-content:flex-start"><button class="btn primary" id="cloudSyncBtn">Sync now</button><button class="btn ${s.problem === 'reset' || s.problem === 'nomember' ? 'primary' : ''}" id="cloudReuploadBtn">Re-upload all data from this device</button><button class="btn danger-outline" id="cloudOffBtn">Disconnect this tablet</button></div></section>`;
  }
  function wireCloudCard() {
    const c = $('#cloudConnectBtn'); if (c) c.onclick = cloudConnect;
    const ru = $('#cloudReuploadBtn'); if (ru) ru.onclick = () => cloudConnect({reupload: true});
    const sn = $('#cloudSyncBtn'); if (sn) sn.onclick = async () => { const r = await Cloud.sync('manual'); toast(r.error ? `Sync problem: ${r.error}` : 'Synced', 3500); renderSettings(); };
    const off = $('#cloudOffBtn'); if (off) off.onclick = async () => {
      if (!await requireAdmin('Disconnect this tablet from the cloud', TABLET)) return;
      await Cloud.disconnect(); await audit('Tablet disconnected from cloud', TABLET, 'done'); toast('Disconnected – data stays on this tablet'); renderSettings();
    };
  }
  /* remote changes arrive while the app is open: patch the open job, refresh the screen (never while typing) */
  let rerenderT = null;
  function rerenderSoon() {
    clearTimeout(rerenderT);
    rerenderT = setTimeout(async () => {
      const a = document.activeElement;
      if (!USER || $('#dlg').open || Camera.isOpen() || $('.viewer') || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && view.contains(a))) return rerenderSoon();
      const y = window.scrollY; REMOTE_RERENDER = true;
      try { await route(); } finally { REMOTE_RERENDER = false; }
      window.scrollTo(0, y);
    }, 600);
  }
  let REMOTE_RERENDER = false;
  function onRemote(kind, id, key, data) {
    if (!USER) return;
    const cj = current.job;
    if (kind === 'user') { if (id === USER.id) { if (data.disabled) { toast('Your account was disabled by an Admin'); logout(); return; } USER = {...USER, ...data}; renderUserBox(); } return; }
    if (cj && cj.id === id) {
      const vf = current.formKey, heldHere = !!vf && Cloud.isHeld(id, vf);   // heldHere: this tablet is editing that form
      if (kind === 'form') { if (vf === key && heldHere) return; cj.forms[key] = data; normalizeJob(cj); if (vf && vf !== key) return; }
      else if (kind === 'job') { const forms = cj.forms; Object.keys(cj).forEach(k => { if (k !== 'forms') delete cj[k]; }); Object.assign(cj, data, {forms}); normalizeJob(cj); if (heldHere) return; }
      else if (kind === 'file' && current.formKey) { fillPhotoPanels(cj); return; }
    } else if (current.formKey) return;   // editing a form: changes elsewhere show when leaving it
    rerenderSoon();
  }

  /* ---------- Users (Admin screen) ---------- */
  const activeAdmins = users => users.filter(u => u.role === 'admin' && !u.disabled);
  async function userDialog(u) {
    const isNew = !u; let err = '', vals = u ? {dname: u.displayName, uname: u.username, role: u.role} : {dname: '', uname: '', role: 'technician'};
    for (;;) {
      const v = await modal(`<h2>${isNew ? 'New user' : `Edit ${esc(u.displayName)}`}</h2>
        <div class="grid2"><label class="fld"><span>Full name</span><input name="dname" required autocomplete="off" value="${esc(vals.dname)}"></label>
        <label class="fld"><span>Username</span><input name="uname" required autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(vals.uname)}" ${isNew ? '' : 'readonly'}></label></div>
        <label class="fld"><span>Role</span><select name="role"><option value="technician" ${vals.role === 'technician' ? 'selected' : ''}>Technician – create, edit and finalize</option><option value="admin" ${vals.role === 'admin' ? 'selected' : ''}>Admin – also manages users and approves admin actions</option></select></label>
        ${isNew ? `<div class="grid2">${secretInput('pin1', 'Password or PIN', 'new-password')}${secretInput('pin2', 'Enter it again', 'new-password')}</div><p class="muted small">${Auth.secretRule}</p>` : ''}
        ${err ? `<p class="pin-error" role="alert">${esc(err)}</p>` : ''}`,
        [{label: 'Cancel', value: 'cancel'}, {label: isNew ? 'Create user' : 'Save', value: 'ok', cls: 'primary'}], {wide: true});
      if (v !== 'ok') return null;
      const f = $('#dlgForm'), users = await Auth.all();
      vals = {dname: f.dname.value.trim(), uname: Auth.norm(f.uname.value), role: f.role.value};
      if (!vals.dname || !vals.uname) { err = 'Enter a full name and a username.'; continue; }
      if (isNew && users.some(x => x.username === vals.uname)) { err = `The username "${vals.uname}" is already taken on this device.`; continue; }
      if (!isNew && u.role === 'admin' && vals.role !== 'admin' && activeAdmins(users).filter(x => x.id !== u.id).length === 0) { err = 'This is the only active Admin. Make another user an Admin first.'; continue; }
      if (isNew) { err = secretError(f.pin1.value, f.pin2.value); if (err) continue; }
      return {...vals, secret: isNew ? f.pin1.value : null};
    }
  }
  async function cloudReady(what) {
    if (!Cloud.enabled()) return true;
    if (navigator.onLine && await Cloud.session()) return true;
    await modal(`<h2>Internet needed</h2><p>Cloud sync is on, so user accounts are managed in the cloud. Connect to the internet (and sign in again if needed) to ${esc(what)}.</p>`, [{label: 'Close', value: 'cancel'}]);
    return false;
  }
  async function cloudUser(u, password) {   // send one user to the cloud (rg-admin Edge Function); false + message on failure
    if (!Cloud.enabled()) return true;
    try { await Cloud.upsertUser(u, password); Cloud.soon(200); return true; }
    catch (e) { await modal(`<h2>Cloud update failed</h2><p>${esc(e.message)}</p>`, [{label: 'Close', value: 'cancel'}]); return false; }
  }
  async function manageUser(action, id) {
    if (!isAdmin()) { toast('Only an Admin can manage users'); return; }
    if (!await cloudReady('add or change users')) return;
    const users = await Auth.all(), u = users.find(x => x.id === id);
    if (action === 'new') {
      const r = await userDialog(null); if (!r) return;
      const nu = await Auth.create({username: r.uname, displayName: r.dname, role: r.role, secret: r.secret, createdBy: USER.displayName});
      if (!await cloudUser(nu, r.secret)) { await DB.del('users', nu.id); return renderSettings(); }
      await audit('User created', `${nu.displayName} (${nu.username}, ${ROLE_LABEL[nu.role]})`, 'done'); toast(`User ${nu.username} created`);
    } else if (action === 'edit') {
      const r = await userDialog(u); if (!r) return;
      const changes = [r.dname !== u.displayName ? `name ${u.displayName} → ${r.dname}` : '', r.role !== u.role ? `role ${ROLE_LABEL[u.role]} → ${ROLE_LABEL[r.role]}` : ''].filter(Boolean).join(', ');
      const before = {...u};
      Object.assign(u, {displayName: r.dname, role: r.role, updatedAt: Date.now()});
      if (!await cloudUser(u)) { await DB.put('users', before); return renderSettings(); }
      await DB.put('users', u);
      if (u.id === USER.id) { USER = u; renderUserBox(); }
      await audit('User edited', `${u.username}${changes ? ': ' + changes : ' (no change)'}`, 'done'); toast('User saved');
    } else if (action === 'reset') {
      const s = await newSecretDialog(`Reset password / PIN – ${u.displayName}`, `Set a new password or PIN for <b>${esc(u.username)}</b> and tell them in person.`); if (!s) return;
      const before = {...u}; await Auth.setSecret(u, s);
      if (!await cloudUser(u, s)) { await DB.put('users', before); return renderSettings(); }
      await audit('User password/PIN reset', u.username, 'done'); toast(`Password / PIN reset for ${u.username}`);
    } else if (action === 'disable' || action === 'enable') {
      if (action === 'disable') {
        if (u.id === USER.id) { toast('You cannot disable your own account'); return; }
        if (u.role === 'admin' && activeAdmins(users).filter(x => x.id !== u.id).length === 0) { toast('You cannot disable the only active Admin'); return; }
        if (!await confirmBox('Disable user?', `<b>${esc(u.displayName)}</b> (${esc(u.username)}) will no longer be able to sign in on this device. Their jobs, forms and audit entries are kept. You can enable the account again later.`, 'Disable user', true)) return;
      }
      u.disabled = action === 'disable'; u.updatedAt = Date.now();
      if (!await cloudUser(u)) { u.disabled = !u.disabled; return renderSettings(); }
      await DB.put('users', u);
      await audit(action === 'disable' ? 'User disabled' : 'User enabled', u.username, 'done'); toast(`User ${u.username} ${action}d`);
    }
    renderSettings();
  }
  function adminOnly() {
    bar([crumbHome, {label: 'Admin & settings'}], '', {label: HOME_LABEL, href: P.home()});
    view.innerHTML = `<section class="card" id="adminOnly"><h2>Admin only</h2><p>User management and device settings can only be opened by an Admin. You are signed in as <b>${esc(userName())}</b> (${ROLE_LABEL[USER.role]}).</p><a class="btn primary" href="${P.home()}">${HOME_LABEL}</a></section>`;
  }
  async function renderSettings() {
    current = {customer: null, job: null, formKey: null};
    if (!isAdmin()) return adminOnly();
    bar([crumbHome, {label: 'Admin & settings'}], '', {label: HOME_LABEL, href: P.home()});
    const users = (await Auth.all()).sort((a, b) => (a.disabled - b.disabled) || (a.role !== b.role ? (a.role === 'admin' ? -1 : 1) : a.displayName.localeCompare(b.displayName)));
    const log = (await DB.all('audit')).sort((a, b) => b.at - a.at), meta = await DB.getMeta(), idle = await Auth.idleMinutes();
    view.innerHTML = `
      <section class="card" id="adminCard">
        <div class="card-head"><h2>Admin</h2><span class="badge done">Protected</span></div>
        <div class="details"><div><div class="muted small">Signed in as</div><div><b>${esc(USER.displayName)}</b> (${esc(USER.username)})</div></div>
          <div><div class="muted small">Role</div><div>${ROLE_LABEL[USER.role]}</div></div>
          <div><div class="muted small">App revision</div><div id="adminRev"><b>${esc(REV_LABEL)}</b></div></div>
          <div><div class="muted small">Password/PIN storage</div><div>${esc(`${USER.algo}, ${USER.iterations.toLocaleString()} iterations, random salt`)}</div></div></div>
        <p class="muted small">Admin approval (an Admin's password or PIN) is required to delete customers, jobs, photos or saved PDFs, to reopen a completed form, to restore a backup, and to change the Tablet ID or your password. 5 wrong entries lock approval for 30 seconds. All of this is local to this device.</p>
        <div class="fr-actions" style="justify-content:flex-start"><button class="btn primary" id="changePinBtn">Change my password / PIN</button></div>
      </section>
      ${await cloudCard()}
      <section class="card" id="usersCard">
        <div class="card-head"><h2>Users</h2><span class="muted small">${users.length} account${users.length === 1 ? '' : 's'} ${Cloud.enabled() ? 'for all tablets (cloud)' : 'on this device'} · no self sign-up</span><button class="btn primary right" id="newUserBtn">+ New user</button></div>
        <div class="tablewrap"><table class="tbl users"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>
          ${users.map(u => `<tr data-user="${esc(u.username)}" class="${u.disabled ? 'off' : ''}"><td><b>${esc(u.displayName)}</b>${u.id === USER.id ? ' <span class="muted small">(you)</span>' : ''}</td><td>${esc(u.username)}</td><td>${ROLE_LABEL[u.role]}</td>
            <td>${u.disabled ? '<span class="badge off">Disabled</span>' : '<span class="badge done">Active</span>'}</td><td>${esc(u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'Never')}</td>
            <td><div class="uactions"><button class="btn" data-uact="edit" data-uid="${u.id}">Edit</button><button class="btn" data-uact="reset" data-uid="${u.id}">Reset password</button>
              ${u.disabled ? `<button class="btn" data-uact="enable" data-uid="${u.id}">Enable</button>` : `<button class="btn danger-outline" data-uact="disable" data-uid="${u.id}" ${u.id === USER.id ? 'disabled' : ''}>Disable</button>`}</div></td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted small">Technicians can create, edit and finalize. Admins can also manage users and approve admin-only actions. Only salted hashes of passwords/PINs are stored, and they are included in backups.</p>
        <label class="fld bk-interval"><span>Auto-lock after inactivity</span>
          <select id="idleMin">${[5, 10, 15, 30, 60].map(m => `<option value="${m}" ${m === idle ? 'selected' : ''}>${m} minutes</option>`).join('')}</select></label>
      </section>
      <section class="card" id="tabletCard">
        <div class="card-head"><h2>This tablet</h2></div>
        <div class="details"><div><div class="muted small">Tablet ID</div><div><b id="tabletIdVal">${esc(TABLET || '—')}</b></div></div></div>
        <p class="muted small">Stamped on each new job ("Created on") and on each form at finalize ("Inspected on"), shown on the Completion record of final PDFs and in the job summary. Changing it needs admin approval and is written to the audit log.</p>
        <div class="fr-actions" style="justify-content:flex-start"><button class="btn" id="changeTabletBtn">Change Tablet ID</button></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Data</h2></div>
        <div class="store-line" id="storeLine"><b>Storage:</b> ${STORAGE.persisted === true ? `✓ persistent (${esc(STORAGE.browser)} will keep this data)` : STORAGE.persisted === false ? `⚠ not persistent – ${esc(STORAGE.browser)} may delete this data` : 'status unknown'}
          <button class="btn" id="sPersist" type="button">Request persistent storage</button></div>
        ${STORAGE.persisted === false ? storageNotice(STORAGE, false) : ''}
        <div class="fr-actions" style="justify-content:flex-start;align-items:center"><button class="btn" id="sBackup">Backup all data</button><span class="muted" data-lastbk>Last backup: ${esc(lastBackupText(meta))}</span></div>
        <label class="fld bk-interval"><span>Backup reminder</span>
          <select id="bkInterval">${INTERVALS.map(d => `<option value="${d}" ${d === meta.intervalDays ? 'selected' : ''}>Every ${d} day${d > 1 ? 's' : ''}</option>`).join('')}</select></label>
        <p class="muted small">The home screen shows a reminder when data has changed since the last backup and the last backup is older than this (or there has never been one).</p>
        <div class="fr-actions" style="justify-content:flex-start"><button class="btn" id="sRestore">Restore from backup</button><button class="btn" id="sBlank">Blank PDFs</button></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Audit log</h2><span class="muted small">${log.length} entr${log.length === 1 ? 'y' : 'ies'} · included in backups</span></div>
        ${log.length ? `<div class="tablewrap"><table class="tbl audit"><thead><tr><th>When</th><th>Action</th><th>Item</th><th>User</th><th>Approved by</th><th>Tablet</th><th>Result</th></tr></thead><tbody>
          ${log.map(a => `<tr class="${a.result === 'approved' || a.result === 'done' ? '' : 'bad'}"><td>${esc(fmtDate(a.at))}</td><td>${esc(a.action)}</td><td>${esc(a.item)}</td><td>${esc(a.user || '')}</td><td>${esc(a.result === 'done' ? '' : a.admin)}</td><td>${esc(a.tablet || '')}</td><td>${esc(a.result)}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">No entries yet.</p>'}
      </section>`;
    $('#changePinBtn').onclick = changePin; $('#changeTabletBtn').onclick = changeTablet; wireCloudCard();
    $('#newUserBtn').onclick = () => manageUser('new');
    $$('[data-uact]').forEach(b => b.onclick = () => manageUser(b.dataset.uact, b.dataset.uid));
    $('#idleMin').onchange = async e => { const m = +e.target.value; await DB.put('settings', {key: 'session', idleMinutes: m}); await refreshIdle(); await audit('Auto-lock changed', `${m} minutes`, 'done'); toast(`Auto-lock after ${m} minutes`); };
    $('#bkInterval').onchange = async e => { const d = +e.target.value; await DB.updateMeta(() => ({intervalDays: d})); toast(`Backup reminder: every ${d} day${d > 1 ? 's' : ''}`); };
    $('#sBackup').onclick = backup; $('#sRestore').onclick = () => $('#fileRestore').click(); $('#sBlank').onclick = blankPdfs;
    $('#sPersist').onclick = async () => { const r = await storageStatus(true); await audit('Persistent storage requested', `${r.browser}: ${r.persisted ? 'granted' : 'not granted'}`, 'done'); toast(r.persisted ? 'Persistent storage granted' : `${r.browser} did not grant persistent storage`, 4000); renderSettings(); };
  }

  /* ---------- gearboxes (Rev 1.5) ----------
     A job holds one or more gearboxes: job.gearboxes = [{id:'g1', stages, locked, lockedAt, lockedBy, manufacturer, model, serial, removed?}].
     stages is the gearbox TYPE CODE: 1 | 2 | 3 = Single / Double / Triple reduction (helical), 'p1' … 'p4' = Planetary with 1-4
     planetary stages (Rev 1.6). Form definitions are keyed by it ('teardown@3', 'assembly@p2').
     Gearbox 1's manufacturer/model/serial stay on the job itself (job.manufacturer …) so devices on older revisions keep working.
     Form keys: 'teardown' / 'assembly' for gearbox 1, '<gearbox id>.teardown' … for the others. Added gearboxes get a unique id
     (two tablets can add one offline at the same time) and are ordered by creation time. Each form state also stores its
     gearbox id, stage count and a copy of the gearbox entry, so a gearbox dropped by a concurrent job edit is rebuilt. */
  const RTYPE = {1: 'Single', 2: 'Double', 3: 'Triple'}, STAGE_N = [1, 2, 3], P_N = [1, 2, 3, 4], TYPE_CODES = [1, 2, 3, 'p1', 'p2', 'p3', 'p4'];
  const isPl = t => typeof t === 'string' && /^p[1-4]$/.test(t), pN = t => +String(t).slice(1);
  const rtype = t => isPl(t) ? `Planetary ${pN(t)}-stage` : (RTYPE[t] || 'Double');              // short: tags, zip folder ("Planetary 2-stage", "Triple")
  const typeLabel = t => isPl(t) ? `Planetary ${pN(t)}-stage` : `${rtype(t)} reduction`;         // "Triple reduction" / "Planetary 2-stage"
  const stagesText = t => isPl(t) ? `${pN(t)} planetary stage${pN(t) > 1 ? 's' : ''}` : `${t} stage${t > 1 ? 's' : ''}`;
  function parseKey(k) { const m = /^([^.]+)\.(.+)$/.exec(k || ''); return m ? {gid: m[1], base: m[2]} : {gid: 'g1', base: k}; }
  const fkey = (gid, base) => gid === 'g1' ? base : `${gid}.${base}`;
  const newGid = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const gbOrder = (a, b) => (a.id === 'g1' ? -1 : b.id === 'g1' ? 1 : 0) || (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  /* Existing jobs (before Rev 1.5) become one Double-reduction gearbox. Idempotent; also rebuilds a gearbox entry
     that a concurrent edit on another tablet dropped (its forms carry the gearbox id and stage count). */
  function normalizeJob(job) {
    if (!job) return job;
    job.forms = job.forms || {};
    if (!Array.isArray(job.gearboxes) || !job.gearboxes.length) {
      const st = job.forms.teardown || job.forms.assembly;
      job.gearboxes = [{id: 'g1', stages: (st && st.stages) || 2, locked: true, lockedAt: job.createdAt || Date.now(), lockedBy: job.createdBy || '', migrated: true}];
    }
    for (const [k, st] of Object.entries(job.forms)) {
      const {gid} = parseKey(k);
      if (!job.gearboxes.some(g => g.id === gid)) job.gearboxes.push({...((st && st.gb) || {}), id: gid, stages: (st && st.stages) || 2, locked: true, recovered: true,
        createdAt: (st && st.gb && st.gb.createdAt) || (st && st.createdAt) || Date.now()});
    }
    job.gearboxes.sort(gbOrder);
    return job;
  }
  const activeGbs = job => normalizeJob(job).gearboxes.filter(g => !g.removed);
  const gbById = (job, gid) => normalizeJob(job).gearboxes.find(g => g.id === gid) || null;
  function gbInfo(job, gid) {   // manufacturer/model/serial of one gearbox
    const g = gbById(job, gid) || {};
    return gid === 'g1' ? {manufacturer: job.manufacturer || '', model: job.model || '', serial: job.serial || ''} : {manufacturer: g.manufacturer || '', model: g.model || '', serial: g.serial || ''};
  }
  function setGbInfo(job, gid, k, v) { if (gid === 'g1') job[k] = v; else { const g = gbById(job, gid); if (g) g[k] = v; } }
  function gbMeta(job, gid) {   // {index, count, label 'Gearbox 1 of 2', reduction 'Triple', stages, serial}
    const act = activeGbs(job), i = act.findIndex(g => g.id === gid), g = gbById(job, gid) || {stages: 2}, info = gbInfo(job, gid);
    return {id: gid, index: i + 1, count: act.length, label: i < 0 ? `Removed gearbox ${job.gearboxes.indexOf(g) + 1}` : `Gearbox ${i + 1} of ${act.length}`,
            reduction: rtype(g.stages), typeLabel: typeLabel(g.stages || 2), stagesText: stagesText(g.stages || 2), planetary: isPl(g.stages), stages: g.stages || 2, serial: info.serial, removed: !!g.removed, locked: g.locked !== false};
  }
  const gbTitle = (m, withSerial = true) => `${m.label} · ${m.typeLabel}${withSerial && m.serial ? ` · S/N ${m.serial}` : ''}`;
  const gbFolder = m => [m.label, m.reduction, m.serial ? 'SN ' + PdfExport.safe(m.serial) : ''].filter(Boolean).join(' - ');   // zip subfolder, e.g. "Gearbox 1 of 2 - Triple - SN 4471-A"
  /* form definition for a form key of a job: the variant matching the gearbox's (locked) stage count */
  function fdef(job, key) {
    const {gid, base} = parseKey(key), st = job.forms[key], g = gbById(job, gid);
    const n = (g && g.stages) || (st && st.stages) || 2;
    return FORM_BY_ID[`${base}@${n}`] || FORM_BY_ID[`${base}@2`] || null;
  }
  const kindsOf = (job, key) => KINDS[fdef(job, key).id], reqsOf = (job, key) => REQS[fdef(job, key).id];
  const titleOf = key => (BASE_DEF[parseKey(key).base] || {}).title || key;
  function newFormState(key, gid = 'g1', stages = 2, gb = null) {
    const values = {}, d = BASE_DEF[parseKey(key).base], sf = d && d.signedByField;
    if (sf && USER) values[sf] = USER.displayName;   // prefill "Inspected by" with the signed-in user
    const st = {enabled: true, status: 'draft', revision: 1, values, na: {}, history: [], createdAt: Date.now(), createdBy: userName(), tabletUsed: TABLET, gearboxId: gid, stages};
    if (gb && gid !== 'g1') st.gb = {manufacturer: gb.manufacturer || '', model: gb.model || '', serial: gb.serial || '', createdAt: gb.createdAt, createdBy: gb.createdBy, lockedAt: gb.lockedAt, lockedBy: gb.lockedBy};
    return st;
  }
  // display/sort order: gearbox order, then form order (Teardown Evaluation first)
  const formIdx = (job, k) => { const {gid, base} = parseKey(k), i = BASES.indexOf(base), gi = normalizeJob(job).gearboxes.findIndex(g => g.id === gid); return (gi < 0 ? 999 : gi) * 10 + (i < 0 ? 9 : i); };
  /* enabled forms of the job's active gearboxes: [{key, gid, base, def, st}] in display order */
  function formStates(job) {
    const out = [];
    for (const g of activeGbs(job)) for (const base of BASES) {
      const key = fkey(g.id, base), st = job.forms[key];
      if (st && st.enabled) out.push({key, gid: g.id, base, def: fdef(job, key), st, title: BASE_DEF[base].title});
    }
    return out;
  }
  function jobStatus(job) {
    const fs = formStates(job); if (!fs.length) return 'draft';
    return fs.every(f => f.st.status === 'completed') ? 'completed' : 'draft';
  }
  const badge = st => st === 'completed' ? '<span class="badge done">Completed</span>' : '<span class="badge draft">Draft</span>';
  function custName(job, cust) { return (cust && cust.id === 'unassigned' && job.legacyCustomer) ? job.legacyCustomer : (cust ? cust.name : ''); }
  /* Values that auto-fill into the gearbox's forms (customer name comes from the customer file, gearbox info from the gearbox). */
  function ctx(job, cust, gid = 'g1') {
    const m = gbMeta(job, gid);
    return {customer: custName(job, cust), wo: job.wo || '', ...gbInfo(job, gid), date: job.date || '', gearbox: m.label, gearboxId: gid, gearboxCount: m.count, reduction: m.reduction, typeLabel: m.typeLabel, stagesText: m.stagesText, stages: m.stages, gbTag: m.index > 0 ? `_GB${m.index}` : ''};
  }
  const pdfGb = c => ({label: c.gearbox, count: c.gearboxCount, reduction: c.reduction, typeLabel: c.typeLabel || typeLabel(c.stages || 2), stagesText: c.stagesText || stagesText(c.stages || 2), serial: c.serial});
  function getVal(job, key, name) {
    const k = kindsOf(job, key)[name] || {}, st = job.forms[key];
    if (k.link) return (st.status === 'completed' && st.snapshot ? st.snapshot : ctx(job, current.customer, parseKey(key).gid))[k.link];
    return st.values[name];
  }
  const filled = v => v === true || (typeof v === 'string' && v.trim() !== '');
  function reqState(job, key, req) {
    const st = job.forms[key];
    if (req.onlyIf && !filled(st.values[req.onlyIf])) return 'skip';
    if (req.ifCount && !(parseInt(st.values[req.ifCount.field], 10) >= req.ifCount.min)) return 'skip';   // e.g. planet rows above the number of planets
    if (st.na[req.id]) return 'na';
    const okAll = (req.all || []).every(n => filled(getVal(job, key, n)));
    const okAny = !req.any || req.any.some(n => filled(getVal(job, key, n)));
    return okAll && okAny ? 'done' : 'missing';
  }
  function progress(job, key) {
    let done = 0, total = 0; const missing = [];
    for (const r of reqsOf(job, key)) {
      const s = reqState(job, key, r.req); if (s === 'skip') continue;
      total++; if (s === 'done' || s === 'na') done++; else missing.push(r);
    }
    return {done, total, missing};
  }
  async function saveJob(job) { job.updatedAt = Date.now(); await DB.put('jobs', job); }
  async function saveCustomer(c) { c.updatedAt = Date.now(); await DB.put('customers', c); }
  // The debounced save keeps the job it was scheduled for: a late 'change' event (blur while leaving a form) may arrive
  // after navigation has already replaced current.job.
  let saveJobRef = null;
  function scheduleSave(job = current.job) {
    if (!job) return;
    const ind = $('#saveInd'); if (ind) ind.textContent = 'Saving…';
    clearTimeout(saveTimer); saveJobRef = job;
    saveTimer = setTimeout(async () => {
      saveTimer = null; const j = saveJobRef; saveJobRef = null;
      if (j) await saveJob(j);
      const i = $('#saveInd'); if (i) i.textContent = 'Saved ' + new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
    }, 400);
  }
  async function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; const j = saveJobRef || current.job; saveJobRef = null; if (j) await saveJob(j); } }
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('#backupBanner')) showBackupBanner(); });

  /* ---------- app bar with breadcrumbs ---------- */
  function bar(crumbs, actionsHtml, back) {
    // crumbs: [{label, href}] - last one is the current page
    $('#appbarSub').innerHTML = `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => i < crumbs.length - 1
      ? `<a href="${esc(c.href)}">${esc(c.label)}</a><span class="sep">›</span>` : `<span class="cur">${esc(c.label)}</span>`).join('')}</nav>`;
    $('#appbarActions').innerHTML = actionsHtml || '';
    const b = $('#backBtn'); b.hidden = !back;
    setBarH && setTimeout(setBarH, 0);
    if (back) { b.innerHTML = `<span class="chev">‹</span><span class="blabel">${esc(back.label)}</span>`; b.onclick = () => { location.hash = back.href; }; }
  }
  const crumbHome = {label: HOME_LABEL, href: P.home()};
  const setBarH = () => document.documentElement.style.setProperty('--appbar-h', $('.appbar').offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(setBarH).observe($('.appbar')); else window.addEventListener('resize', setBarH);

  /* ---------- router ---------- */
  // Renders run one at a time: a hash change during a slow render (e.g. Admin screen) re-renders once it finishes,
  // instead of two renders writing into the view at the same time.
  let routing = null, routeAgain = false;
  async function route() {
    if (routing) { routeAgain = true; return routing; }
    routing = (async () => { do { routeAgain = false; await routeOnce(); } while (routeAgain); })();
    try { await routing; } finally { routing = null; }
  }
  async function routeOnce() {
    if (!USER) return;   // login screen is showing
    await flushSave();
    const nextHash = location.hash;
    if (current.job && current.formKey && Cloud.isHeld(current.job.id, current.formKey) && !nextHash.endsWith(`/j/${encodeURIComponent(current.job.id)}/f/${current.formKey}`) && !nextHash.endsWith(`/j/${current.job.id}/f/${current.formKey}`))
      Cloud.release(current.job.id, current.formKey);
    urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
    const h = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    window.scrollTo(0, 0);
    document.title = APP_TITLE;
    try {
      if (h[0] === 'c' && h[1] && h[2] === 'j' && h[3] && h[4] === 'f' && h[5]) await renderForm(h[1], h[3], h[5]);
      else if (h[0] === 'c' && h[1] && h[2] === 'j' && h[3] && h[4] === 'parts') await renderParts(h[1], h[3]);
      else if (h[0] === 'c' && h[1] && h[2] === 'j' && h[3]) await renderJob(h[1], h[3]);
      else if (h[0] === 'c' && h[1]) await renderCustomer(h[1]);
      else if (h[0] === 'settings') await renderSettings();
      else await renderHome();
    } catch (e) { console.error(e); view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a class="btn" href="#/">${HOME_LABEL}</a></div>`; }
    view.focus({preventScroll: true});
  }
  window.addEventListener('hashchange', route);
  async function load(cid, jid) {
    const customer = await DB.get('customers', cid); if (!customer) { location.hash = P.home(); return {}; }
    if (!jid) return {customer};
    const job = normalizeJob(await DB.get('jobs', jid)); if (!job || job.customerId !== cid) { location.hash = P.cust(cid); return {}; }
    return {customer, job};
  }

  /* ---------- home: customers ---------- */
  async function renderHome() {
    current = {customer: null, job: null, formKey: null};
    document.title = `${HOME_LABEL} – ${APP_TITLE}`;
    bar([{label: HOME_LABEL}], `<button class="btn ghost" id="blankBtn">Blank PDFs</button><span class="lastbk" data-lastbk></span><button class="btn ghost" id="backupBtn">Backup</button><button class="btn ghost" id="restoreBtn">Restore</button>${isAdmin() ? '<a class="btn ghost" id="adminBtn" href="#/settings">🔐 Admin</a>' : ''}`);
    let customers = (await DB.all('customers')).sort((a, b) => (a.id === 'unassigned') - (b.id === 'unassigned') || a.name.localeCompare(b.name));
    const jobs = await DB.all('jobs'), byC = {};
    jobs.forEach(j => (byC[j.customerId] = byC[j.customerId] || []).push(j));
    customers = customers.filter(c => c.id !== 'unassigned' || (byC[c.id] || []).length);   // hide empty Unassigned
    view.innerHTML = `
      <section class="backup-banner" id="backupBanner" role="status" aria-live="polite" hidden></section>
      <section class="storage-banner" id="storageBanner" hidden></section>
      <section class="home-head">
        <div><h1>${HOME_LABEL}</h1><p class="muted">${customers.length} customer${customers.length === 1 ? '' : 's'} · ${jobs.length} job${jobs.length === 1 ? '' : 's'} · data stays on this tablet · back up regularly</p></div>
        <button class="btn primary big" id="newCustBtn">+ New customer</button>
      </section>
      <input type="search" id="custSearch" class="search" placeholder="Search customers, contacts, phone or work order">
      <div class="joblist" id="custList">${customers.length ? customers.map(c => {
        const js = byC[c.id] || [], nd = js.filter(j => jobStatus(j) === 'draft').length, nc = js.length - nd;
        const last = js.reduce((m, j) => Math.max(m, j.updatedAt || 0), c.updatedAt || 0);
        return `<a class="jobcard custcard ${c.id === 'unassigned' ? 'unassigned' : ''}" href="${P.cust(c.id)}" data-search="${esc([c.name, c.contact, c.phone, Phone.format(c.phone), Phone.digits(c.phone), c.email, ...js.map(j => j.wo)].join(' ').toLowerCase())}">
          <div class="jc-main"><div class="jc-wo">${esc(c.name)}</div><div class="jc-cust muted">${esc([c.contact, Phone.format(c.phone)].filter(Boolean).join(' · ') || ' ')}</div>
          <div class="jc-forms">${nd ? `<span class="formtag">${nd} ${badge('draft')}</span>` : ''}${nc ? `<span class="formtag">${nc} ${badge('completed')}</span>` : ''}</div></div>
          <div class="jc-side"><div class="jobcount">${js.length} job${js.length === 1 ? '' : 's'}</div><div class="muted small">Updated ${esc(fmtDay(last))}</div></div></a>`;
      }).join('') : `<div class="empty"><p>No customers yet.</p><p class="muted">Tap <b>New customer</b>, then add jobs to the customer's file.</p></div>`}</div>
      <p class="muted small center" id="storageInfo"></p>`;
    $('#newCustBtn').onclick = async () => { const c = await editCustomer(null); if (c) location.hash = P.cust(c.id); };
    refreshBackupInfo(); showBackupBanner(); showStorageBanner();
    $('#blankBtn').onclick = blankPdfs; $('#backupBtn').onclick = backup; $('#restoreBtn').onclick = () => $('#fileRestore').click();
    const s = $('#custSearch'); s.oninput = () => { const q = s.value.toLowerCase().trim(); $$('.custcard').forEach(c => c.hidden = !c.dataset.search.includes(q)); };
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(async e => {
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      const el = $('#storageInfo'); if (el) el.textContent = `Storage used: ${(e.usage / 1048576).toFixed(1)} MB${e.quota ? ' of ~' + (e.quota / 1073741824).toFixed(1) + ' GB' : ''} · ${persisted ? 'persistent storage granted' : 'storage not marked persistent (back up regularly)'}`;
    });
  }
  function blankPdfs() {
    modal(`<h2>Blank PDF forms</h2><p class="muted">Fillable PDFs, the same templates the app fills in. One set per gearbox type.</p>
      ${TYPE_CODES.map(n => `<h4 class="subhead">${typeLabel(n)} (${stagesText(n)})</h4><ul class="linklist">${BASES.map(b => FORM_BY_ID[`${b}@${n}`]).filter(Boolean).map(f => `<li><a class="btn" href="${esc(f.template)}" download data-blank="${esc(f.id)}">${esc(f.title)}</a> <span class="muted small">${esc(f.docTitle)}</span></li>`).join('')}</ul>`).join('')}`,
      [{label: 'Close', value: 'cancel'}], {noFocus: true});
  }
  async function editCustomer(c) {
    const isNew = !c; c = c || {id: DB.uid(), name: '', contact: '', phone: '', email: '', address: '', notes: '', createdAt: Date.now()};
    const v = await modal(`<h2>${isNew ? 'New customer' : 'Edit customer'}</h2>
      <div class="custform">
      <label class="fld"><span>Customer name *</span><input name="name" type="text" required autocomplete="off" value="${esc(c.name)}"></label>
      <div class="grid2"><label class="fld"><span>Contact name</span><input name="contact" type="text" autocomplete="off" value="${esc(c.contact)}"></label>
      <label class="fld"><span>Phone</span><input name="phone" type="tel" inputmode="tel" autocomplete="off" value="${esc(Phone.format(c.phone))}"></label></div>
      <label class="fld"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="off" value="${esc(c.email)}"></label>
      <label class="fld"><span>Address</span><textarea name="address" rows="1" class="autogrow">${esc(c.address)}</textarea></label>
      <label class="fld"><span>Notes</span><textarea name="notes" rows="3">${esc(c.notes)}</textarea></label></div>`,
      [{label: 'Cancel', value: 'cancel'}, {label: isNew ? 'Create customer' : 'Save', value: 'ok', cls: 'primary'}],
      {onOpen: f => {
        Phone.attach(f.phone);
        for (const t of $$('textarea.autogrow', f)) { const fit = () => { t.style.height = ''; if (t.scrollHeight > t.clientHeight) t.style.height = t.scrollHeight + 2 + 'px'; }; t.addEventListener('input', fit); fit(); }
      }});
    if (v !== 'ok') return null;
    const f = $('#dlgForm'), shown = Phone.format(c.phone);
    for (const k of ['name', 'contact', 'email', 'address', 'notes']) c[k] = f[k].value.trim();
    const ph = f.phone.value.trim(); if (ph !== shown) c.phone = ph;   // untouched: keep exactly what was stored (e.g. a number with an extension)
    await saveCustomer(c);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    toast(isNew ? 'Customer created' : 'Customer saved');
    return c;
  }

  /* ---------- customer file ---------- */
  async function renderCustomer(cid) {
    const {customer} = await load(cid); if (!customer) return;
    current = {customer, job: null, formKey: null};
    bar([crumbHome, {label: customer.name}], `<button class="btn ghost" id="editCustBtn">Edit</button><button class="btn ghost" id="delCustBtn">Delete customer</button>`, {label: HOME_LABEL, href: P.home()});
    const jobs = (await DB.byCustomer(cid)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt);
    const detail = (l, v, href) => v ? `<div><div class="muted small">${l}</div><div>${href ? `<a href="${esc(href)}">${esc(v)}</a>` : esc(v).replace(/\n/g, '<br>')}</div></div>` : '';
    view.innerHTML = `
      <section class="card custfile">
        <div class="card-head"><h1>${esc(customer.name)}</h1><span class="muted small right">Customer file · ${jobs.length} job${jobs.length === 1 ? '' : 's'}</span></div>
        <div class="details">${detail('Contact', customer.contact)}${detail('Phone', Phone.format(customer.phone), customer.phone && Phone.href(customer.phone))}${detail('Email', customer.email, customer.email && 'mailto:' + customer.email)}${detail('Address', customer.address)}${detail('Notes', customer.notes)}
          ${[customer.contact, customer.phone, customer.email, customer.address, customer.notes].some(Boolean) ? '' : '<p class="muted">No contact details yet. Tap <b>Edit</b> to add them.</p>'}</div>
      </section>
      <section class="home-head"><div><h2>Jobs</h2></div><button class="btn primary big" id="newJobBtn">+ New job</button></section>
      <div class="joblist">${jobs.length ? jobs.map(j => { const gbs = activeGbs(j); return `
        <a class="jobcard" href="${P.job(cid, j.id)}" data-jobcard="${esc(j.id)}">
          <div class="jc-main"><div class="jc-wo">WO ${esc(j.wo || '—')}</div><div class="jc-cust">${esc([j.manufacturer, j.model].filter(Boolean).join(' ') || 'Gearbox')}${j.serial ? ` <span class="muted small">S/N ${esc(j.serial)}</span>` : ''}${j.legacyCustomer ? ` <span class="muted small">(was: ${esc(j.legacyCustomer)})</span>` : ''}</div>
          <div class="jc-types" data-jobtypes>${gbs.length > 1 ? `<span class="muted small">${gbs.length} gearboxes:</span> ` : ''}${gbs.map((g, i) => `<span class="typetag">${gbs.length > 1 ? `GB${i + 1} ` : ''}${typeLabel(g.stages)}</span>`).join('')}</div>
          <div class="jc-forms">${formStates(j).map(f => `<span class="formtag">${gbs.length > 1 ? `GB${gbMeta(j, f.gid).index} · ` : ''}${esc(f.title)} ${badge(f.st.status)}</span>`).join('')}</div></div>
          <div class="jc-side">${badge(jobStatus(j))}<div class="muted small">${esc(j.date ? fmtDay(j.date + 'T12:00') : '')}</div></div></a>`; }).join('')
        : `<div class="empty"><p>No jobs for this customer yet.</p><p class="muted">Tap <b>New job</b> to start a teardown evaluation or assembly verification.</p></div>`}</div>`;
    $('#newJobBtn').onclick = () => newJob(customer);
    $('#editCustBtn').onclick = async () => { if (await editCustomer(customer)) renderCustomer(cid); };
    $('#delCustBtn').onclick = async () => {
      let np = 0, nd = 0; for (const j of jobs) { np += (await DB.byJob('photos', j.id)).length; nd += (await DB.byJob('docs', j.id)).length; }
      if (!await confirmBox('Delete customer?', `This permanently deletes <b>${esc(customer.name)}</b> and <b>all of their jobs (${jobs.length}), photos (${np}) and saved PDFs (${nd})</b> from this device. This cannot be undone. Consider a backup first.`, 'Delete customer and all jobs', true)) return;
      if (!await requireAdmin('Delete customer', `${customer.name} (${jobs.length} jobs, ${np} photos, ${nd} saved PDFs)`)) return;
      await DB.deleteCustomer(cid); toast('Customer deleted'); location.hash = P.home();
    };
  }
  /* Gearbox fields + reduction type (required), shared by "New job" and "Add gearbox". */
  /* type picker: Single / Double / Triple / Planetary; Planetary also needs the number of planetary stages (1-4) */
  const typeRadios = (sel, name = 'stages') => `<fieldset class="fld rtype ${isPl(sel) || sel === 'p' ? 'pl' : ''}"><legend>Gearbox type * <span class="muted small">(locked after you confirm)</span></legend><div class="choices seg">${STAGE_N.map(n =>
    `<label class="chk pill" data-rtype="${n}"><input type="radio" name="${name}" value="${n}" ${String(sel) === String(n) ? 'checked' : ''}><span class="box"></span><span class="txt"><b>${rtype(n)}</b> <span class="muted small">${n} stage${n > 1 ? 's' : ''}</span></span></label>`).join('')}
    <label class="chk pill" data-rtype="planetary"><input type="radio" name="${name}" value="p" data-pl="1" ${isPl(sel) || sel === 'p' ? 'checked' : ''}><span class="box"></span><span class="txt"><b>Planetary</b> <span class="muted small">1-4 stages</span></span></label></div>
    <div class="pstages"><span class="pstages-label">Planetary stages *</span><div class="choices seg">${P_N.map(k => `<label class="chk pill" data-pstages="${k}"><input type="radio" name="${name}_p" value="${k}" ${isPl(sel) && pN(sel) === k ? 'checked' : ''}><span class="box"></span><span class="txt"><b>${k}</b></span></label>`).join('')}</div></div></fieldset>`;
  /* type code from the picker: 1|2|3, 'p1'…'p4', 'p' (planetary without stage count) or 0 (nothing chosen) */
  const readType = (f, name = 'stages') => { const v = (f.querySelector(`input[name=${name}]:checked`) || {}).value; if (!v) return 0; if (v !== 'p') return +v;
    const k = (f.querySelector(`input[name=${name}_p]:checked`) || {}).value; return k ? `p${k}` : 'p'; };
  const typeError = t => !t ? 'Select the gearbox type (Single, Double, Triple or Planetary).' : t === 'p' ? 'Select the number of planetary stages (1-4).' : '';
  document.addEventListener('change', e => { const fs = e.target.closest && e.target.closest('fieldset.rtype'); if (fs) fs.classList.toggle('pl', !!fs.querySelector('input[data-pl]:checked')); });
  const gbFields = v => `<div class="row cols3"><label class="fld"><span>Gearbox manufacturer</span><input name="manufacturer" autocomplete="off" value="${esc(v.manufacturer || '')}"></label>
      <label class="fld"><span>Model</span><input name="model" autocomplete="off" value="${esc(v.model || '')}"></label>
      <label class="fld"><span>Serial number</span><input name="serial" autocomplete="off" value="${esc(v.serial || '')}"></label></div>
      ${typeRadios(v.stages)}
      <fieldset class="fld"><legend>Forms</legend>${BASES.map(b => `<label class="chk inline"><input type="checkbox" name="form_${b}" ${!v.forms || v.forms.includes(b) ? 'checked' : ''}><span class="box"></span><span>${esc(BASE_DEF[b].title)}</span></label>`).join('')}</fieldset>`;
  const readGb = f => ({manufacturer: f.manufacturer.value.trim(), model: f.model.value.trim(), serial: f.serial.value.trim(),
    stages: readType(f), forms: BASES.filter(b => f['form_' + b].checked)});
  /* "Finalize the selection": the reduction type is confirmed in a separate step and then locked. */
  const confirmType = (n, what) => modal(`<h2>Confirm gearbox type</h2><p class="rtype-confirm"><b>${typeLabel(n)}</b> · ${stagesText(n)}</p>
      <p>${esc(what)} uses the ${isPl(n) ? `planetary forms: ${pN(n) === 1 ? 'one planetary stage' : `a section for each of the ${pN(n)} planetary stages`} (sun gear, planets, ring gear, carrier, ratio, backlash, endplay), plus input and output shafts, housing, lubrication and shims` : `${rtype(n).toLowerCase()}-reduction forms: ${n === 1 ? 'input and output shafts, one gear mesh' : n === 2 ? 'input, intermediate and output shafts, two gear meshes' : 'input, two intermediate and output shafts, three gear meshes'}`}.</p>
      <p class="muted small">After you confirm, the type is <b>locked</b> 🔒. Changing it later needs Admin approval and is only possible while none of this gearbox's forms has been finalized.</p>`,
    [{label: 'Back', value: 'cancel'}, {label: `Confirm ${isPl(n) ? `Planetary ${pN(n)}-stage` : rtype(n)} & lock`, value: 'ok', cls: 'primary'}]).then(v => v === 'ok');
  async function newJob(customer) {
    let vals = {wo: '', date: today(), stages: 0}, err = '';
    for (;;) {
      const v = await modal(`<h2>New job for ${esc(customer.name)}</h2>
        <div class="grid2"><label class="fld"><span>Work order number *</span><input name="wo" required autocomplete="off" value="${esc(vals.wo)}"></label>
        <label class="fld"><span>Date</span><input name="date" type="date" value="${esc(vals.date)}"></label></div>
        <h4 class="subhead">Gearbox 1 <span class="muted small">(add more gearboxes to the job later in the job folder)</span></h4>
        ${gbFields(vals)}${err ? `<p class="pin-error" role="alert">${esc(err)}</p>` : ''}`,
        [{label: 'Cancel', value: 'cancel'}, {label: 'Create job', value: 'ok', cls: 'primary'}], {wide: true});
      if (v !== 'ok') return;
      const f = $('#dlgForm'); vals = {wo: f.wo.value.trim(), date: f.date.value, ...readGb(f)};
      if (typeError(vals.stages)) { err = typeError(vals.stages); continue; }
      if (!await confirmType(vals.stages, 'Gearbox 1')) { err = ''; continue; }
      break;
    }
    const now = Date.now();
    const job = {id: DB.uid(), customerId: customer.id, wo: vals.wo, date: vals.date, manufacturer: vals.manufacturer, model: vals.model, serial: vals.serial,
                 createdAt: now, updatedAt: now, tabletId: TABLET, createdBy: userName(), forms: {},
                 gearboxes: [{id: 'g1', stages: vals.stages, locked: true, lockedAt: now, lockedBy: userName(), createdAt: now, createdBy: userName()}]};
    for (const b of vals.forms) job.forms[b] = newFormState(b, 'g1', vals.stages);
    await saveJob(job); await saveCustomer(customer);
    await audit('Reduction type locked', `WO ${job.wo} – Gearbox 1 of 1: ${typeLabel(vals.stages)}`, 'done');
    location.hash = P.job(customer.id, job.id);
  }
  async function addGearbox(job, cid) {
    if (jobStatus(job) === 'completed') { toast('All forms of this job are finalized – reopen a form first to add a gearbox', 4000); return; }
    const n = activeGbs(job).length + 1;
    let vals = {stages: 0}, err = '';
    for (;;) {
      const v = await modal(`<h2>Add gearbox ${n} to WO ${esc(job.wo)}</h2><p class="muted">The new gearbox gets its own forms (Teardown Evaluation and Assembly Verification) with its own gearbox type.</p>
        ${gbFields(vals)}${err ? `<p class="pin-error" role="alert">${esc(err)}</p>` : ''}`,
        [{label: 'Cancel', value: 'cancel'}, {label: 'Add gearbox', value: 'ok', cls: 'primary'}], {wide: true});
      if (v !== 'ok') return;
      vals = readGb($('#dlgForm'));
      if (typeError(vals.stages)) { err = typeError(vals.stages); continue; }
      if (!await confirmType(vals.stages, `Gearbox ${n}`)) { err = ''; continue; }
      break;
    }
    await flushSave();
    const now = Date.now(), gid = newGid(), entry = {id: gid, stages: vals.stages, locked: true, lockedAt: now, lockedBy: userName(), manufacturer: vals.manufacturer, model: vals.model, serial: vals.serial, createdAt: now, createdBy: userName(), tabletId: TABLET};
    normalizeJob(job).gearboxes.push(entry);
    for (const b of vals.forms) job.forms[fkey(gid, b)] = newFormState(fkey(gid, b), gid, vals.stages, entry);
    await saveJob(job);
    const m = gbMeta(job, gid);
    await audit('Gearbox added to job', `WO ${job.wo} – ${m.label}: ${m.typeLabel} (locked)${vals.serial ? `, S/N ${vals.serial}` : ''}`, 'done');
    toast(`${m.label} added – ${m.typeLabel}`); renderJob(cid, job.id);
  }
  /* blocks a type change / removal while a form of the gearbox is open on another tablet */
  function inUseElsewhere(job, gid) {
    if (!Cloud.enabled()) return null;
    for (const b of BASES) { const l = Cloud.lockOf(job.id, fkey(gid, b)); if (l && l.until > Date.now() && l.tablet !== Cloud.deviceId() && !Cloud.isHeld(job.id, fkey(gid, b))) return {base: b, ...l}; }
    return null;
  }
  async function changeType(job, gid, cid) {
    const m = gbMeta(job, gid), fs = BASES.map(b => job.forms[fkey(gid, b)]).filter(Boolean);
    const fin = fs.filter(st => st.status === 'completed' || (st.history || []).length);
    if (fin.length) {
      await modal(`<h2>Gearbox type is locked</h2><p><b>${esc(gbTitle(m))}</b></p><p>The type can't be changed because ${fin.length === 1 ? 'a form of this gearbox has' : 'forms of this gearbox have'} already been finalized (final PDFs exist). Finalized PDFs are permanent records of the ${esc(m.typeLabel.toLowerCase())} forms.</p><p class="muted small">If the type was wrong, remove this gearbox (Admin) and add it again with the correct type.</p>`, [{label: 'Close', value: 'cancel'}]);
      return;
    }
    const busy = inUseElsewhere(job, gid);
    if (busy) { await modal(`<h2>Form in use</h2><p>${esc(titleOf(busy.base))} of ${esc(m.label)} is open on <b>${esc(busy.name || 'another tablet')}</b>. Change the type when it is closed there.</p>`, [{label: 'Close', value: 'cancel'}]); return; }
    const v = await modal(`<h2>Change gearbox type</h2><p><b>${esc(gbTitle(m))}</b> 🔒</p>${typeRadios(m.stages, 'nstages')}
      <p class="muted small">The forms of this gearbox switch to the new type. Values already entered stay; fields that don't exist in the new type are no longer shown or printed. Needs Admin approval and is recorded in the audit log.</p>`,
      [{label: 'Cancel', value: 'cancel'}, {label: 'Continue', value: 'ok', cls: 'primary'}], {wide: true});
    if (v !== 'ok') return;
    const n = readType($('#dlgForm'), 'nstages');
    if (n === 'p') { toast('Select the number of planetary stages – type unchanged', 4000); return; }
    if (!n || n === m.stages) { toast('Gearbox type unchanged'); return; }
    if (!await confirmType(n, m.label)) { toast('Gearbox type unchanged'); return; }
    if (!await requireAdmin('Change gearbox reduction type', `WO ${job.wo} – ${m.label}${m.serial ? ` (S/N ${m.serial})` : ''}: ${m.typeLabel} → ${typeLabel(n)}`)) return;
    await flushSave();
    const g = gbById(job, gid), now = Date.now();
    Object.assign(g, {stages: n, locked: true, lockedAt: now, lockedBy: userName(), typeChangedAt: now, typeChangedBy: userName(), previousStages: m.stages}); delete g.migrated;
    for (const b of BASES) { const st = job.forms[fkey(gid, b)]; if (st) st.stages = n; }
    await saveJob(job);
    await audit('Reduction type changed', `WO ${job.wo} – ${m.label}: ${m.typeLabel} → ${typeLabel(n)} (locked)`, 'done');
    toast(`${m.label}: ${typeLabel(n)}`); renderJob(cid, job.id);
  }
  async function removeGearbox(job, gid, cid) {
    const m = gbMeta(job, gid);
    if (m.count < 2) { toast('A job needs at least one gearbox'); return; }
    const busy = inUseElsewhere(job, gid);
    if (busy) { await modal(`<h2>Form in use</h2><p>${esc(titleOf(busy.base))} of ${esc(m.label)} is open on <b>${esc(busy.name || 'another tablet')}</b>. Remove the gearbox when it is closed there.</p>`, [{label: 'Close', value: 'cancel'}]); return; }
    const nd = (await DB.byJob('docs', job.id)).filter(d => parseKey(d.formKey).gid === gid).length;
    if (!await confirmBox('Remove gearbox?', `Remove <b>${esc(gbTitle(m))}</b> from WO ${esc(job.wo)}? Its forms are no longer shown, counted or exported. Saved final PDFs (${nd}) and photos are kept and listed as “removed gearbox”. The other gearboxes are renumbered.`, 'Remove gearbox', true)) return;
    if (!await requireAdmin('Remove gearbox from job', `WO ${job.wo} – ${gbTitle(m)}`)) return;
    await flushSave();
    Object.assign(gbById(job, gid), {removed: true, removedAt: Date.now(), removedBy: userName()});
    await saveJob(job);
    await audit('Gearbox removed from job', `WO ${job.wo} – ${gbTitle(m)} (${nd} saved PDF${nd === 1 ? '' : 's'} kept)`, 'done');
    toast(`${m.label} removed`); renderJob(cid, job.id);
  }

  /* ---------- job folder ---------- */
  async function renderJob(cid, jid) {
    const {customer, job} = await load(cid, jid); if (!job) return;
    current = {customer, job, formKey: null};
    bar([crumbHome, {label: customer.name, href: P.cust(cid)}, {label: `WO ${job.wo}`}], `<button class="btn ghost" id="delJobBtn">Delete job</button>`, {label: customer.name, href: P.cust(cid)});
    const docs = (await DB.byJob('docs', jid)).sort((a, b) => formIdx(job, a.formKey) - formIdx(job, b.formKey) || b.revision - a.revision || b.createdAt - a.createdAt);
    const gbs = activeGbs(job), docGb = d => { const m = gbMeta(job, parseKey(d.formKey).gid); return m.removed ? `${m.label}` : gbs.length > 1 ? m.label : ''; };
    const customers = (await DB.all('customers')).sort((a, b) => a.name.localeCompare(b.name));
    const jf = (k, label, type = 'text') => `<label class="fld"><span>${label}</span><input data-job="${k}" type="${type}" value="${esc(job[k] || '')}" autocomplete="off"></label>`;
    view.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>Job folder</h2>${badge(jobStatus(job))}<span class="muted small right" id="saveInd"></span></div>
        <div class="row cols2">${jf('wo', 'Work order number')}${jf('date', 'Date', 'date')}</div>
        <div class="row cols2" style="margin-top:12px"><label class="fld"><span>Customer</span><select id="moveCust">${customers.map(c => `<option value="${esc(c.id)}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          ${job.legacyCustomer ? `<div class="muted small" style="align-self:end">Customer name on this job before upgrade: <b>${esc(job.legacyCustomer)}</b></div>` : ''}</div>
        <p class="muted small">Customer name and work order fill in automatically on every form; manufacturer, model and serial on the forms of their gearbox.</p>
        <div class="muted small" id="gbSummary">${gbs.length} gearbox${gbs.length === 1 ? '' : 'es'}: ${gbs.map(g => esc(`${gbMeta(job, g.id).label} · ${rtype(g.stages)}`)).join(' · ')}</div>
        <div class="details job-tablet"><div><div class="muted small">Created on</div><div><b data-jobtablet>${esc(job.tabletId || '—')}</b></div></div><div><div class="muted small">Created by</div><div><b data-jobuser>${esc(job.createdBy || '—')}</b></div></div><div><div class="muted small">Created</div><div>${esc(fmtDate(job.createdAt))}</div></div></div>
      </section>
      ${gbs.map(g => { const m = gbMeta(job, g.id), info = gbInfo(job, g.id), gi = (k, label) => `<label class="fld"><span>${label}</span><input ${g.id === 'g1' ? `data-job="${k}"` : `data-gb="${g.id}" data-gbf="${k}"`} type="text" value="${esc(info[k])}" autocomplete="off"></label>`;
        return `<section class="card gbcard" data-gbcard="${g.id}">
        <div class="card-head"><h2>${esc(m.label)}</h2><span class="typetag big" data-gbtype="${g.id}" title="Locked ${esc(fmtDate(g.lockedAt))}${g.lockedBy ? ' by ' + esc(g.lockedBy) : ''}">🔒 ${esc(m.typeLabel)} <span class="muted small">${esc(m.stagesText)}</span></span>${g.migrated ? '<span class="muted small" title="Jobs created before Rev 1.5 are Double reduction">(default for jobs before Rev 1.5)</span>' : ''}
          <span class="right gb-actions"><button class="btn ghost" data-gbchange="${g.id}">Change type</button>${gbs.length > 1 ? `<button class="btn ghost danger-text" data-gbremove="${g.id}">Remove gearbox</button>` : ''}</span></div>
        <div class="row cols3">${gi('manufacturer', 'Gearbox manufacturer')}${gi('model', 'Model')}${gi('serial', 'Serial number')}</div>
        <div class="formlist" style="margin-top:12px">${BASES.map(b => {
          const key = fkey(g.id, b), st = job.forms[key], f = fdef(job, key) || BASE_DEF[b];
          if (!st || !st.enabled) return `<div class="formrow off"><div><b>${esc(f.title)}</b><div class="muted small">${esc(f.docTitle)}</div></div><button class="btn" data-addform="${esc(key)}">+ Add form</button></div>`;
          const p = progress(job, key);
          return `<div class="formrow" data-formrow="${esc(key)}"><div class="fr-main"><div><b>${esc(f.title)}</b> ${badge(st.status)} <span class="muted small">rev ${st.revision}</span></div>
              <div class="muted small">${esc(f.docTitle)}</div>
              <div class="bar"><i style="width:${p.total ? Math.round(100 * p.done / p.total) : 0}%"></i></div>
              <div class="muted small">${p.done} of ${p.total} required items complete${st.status === 'completed' ? ` · completed ${esc(fmtDate(st.completedAt))} by ${esc(st.signedBy)}${st.finalizedBy ? ` · finalized by ${esc(st.finalizedBy)}` : ''}${st.inspectedOn ? ` · Inspected on: ${esc(st.inspectedOn)}` : ''}` : ` · Tablet: ${esc(st.tabletUsed ?? TABLET)}`}</div></div>
            <div class="fr-actions"><button class="btn" data-export="${esc(key)}">${st.status === 'completed' ? SHARE_FINAL : 'Export PDF'}</button><a class="btn primary" href="${P.form(cid, jid, key)}">${st.status === 'completed' ? 'View' : 'Open'}</a></div></div>`;
        }).join('')}</div>
      </section>`; }).join('')}
      <section class="card addgb">${jobStatus(job) === 'completed' ? `<p class="muted small">All forms are finalized. To add another gearbox, an Admin reopens a form first.</p>` : `<div class="fr-actions" style="justify-content:flex-start"><button class="btn" id="addGbBtn">+ Add gearbox</button><span class="muted small" style="align-self:center">Each gearbox gets its own reduction type and its own Teardown Evaluation and Assembly Verification.</span></div>`}</section>
      <section class="card" id="partsCard">
        <div class="card-head"><h2>Parts Summary</h2><span class="muted small">Bad pieces and quantities needed, from the Teardown Evaluation and the shim choices</span></div>
        <div class="muted small" id="partsBrief">${esc(partsBrief(job))}</div>
        <div class="fr-actions" style="justify-content:flex-start;margin-top:8px"><a class="btn primary" id="partsBtn" href="${P.parts(cid, jid)}">Parts Summary</a><button class="btn" id="partsPdfBtn">Download Parts Summary</button></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Job photos</h2><span class="muted small">Included on the photo pages of every form export</span></div>
        ${photoPanel('job', 'Job photo', false)}
      </section>
      <section class="card">
        <div class="card-head"><h2>Saved documents</h2><span class="muted small">Final PDFs created when a form is finalized · all revisions kept</span></div>
        ${docs.length ? `<div class="doclist">${docs.map(d => `<div class="docrow"><div><b>${esc(d.filename)}</b><div class="muted small">${docGb(d) ? `<b>${esc(docGb(d))}</b> · ` : ''}${esc(titleOf(d.formKey))}${d.reduction ? ` (${esc(d.typeLabel || d.reduction + ' reduction')})` : ''} · revision ${d.revision} · ${esc(fmtDate(d.createdAt))} · signed by ${esc(d.signedBy)}${d.inspectedOn ? ` · inspected on ${esc(d.inspectedOn)}` : ''} · ${d.pages} pages · ${(d.size / 1024).toFixed(0)} KB</div></div>
          <div class="fr-actions"><button class="btn" data-docview="${d.id}">View</button><button class="btn" data-docprint="${d.id}">Print</button><button class="btn primary" data-docshare="${d.id}">${SHARE}</button><button class="btn danger-outline" data-docdel="${d.id}" aria-label="Delete saved PDF">Delete</button></div></div>`).join('')}</div>`
          : '<p class="muted">No saved documents yet. Finalize a form to save its PDF here.</p>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>Export job folder</h2></div>
        <p class="muted small">Zip: every saved final PDF (all revisions), all photos (stored copies, max 1600 px) with captions, a job summary, and the combined PDF. Combined PDF: the latest final of each form (or a flattened draft if not finalized yet) in one file.</p>
        <div class="fr-actions" style="justify-content:flex-start"><button class="btn primary" id="zipBtn">Export zip</button><button class="btn" id="combinedBtn">Combined PDF</button></div>
      </section>`;
    $$('[data-job]').forEach(i => i.oninput = () => { job[i.dataset.job] = i.value; scheduleSave(); });
    $$('[data-gb]').forEach(i => i.oninput = () => { setGbInfo(job, i.dataset.gb, i.dataset.gbf, i.value); scheduleSave(); });
    $$('[data-gbchange]').forEach(b => b.onclick = () => changeType(job, b.dataset.gbchange, cid));
    $$('[data-gbremove]').forEach(b => b.onclick = () => removeGearbox(job, b.dataset.gbremove, cid));
    const ag = $('#addGbBtn'); if (ag) ag.onclick = () => addGearbox(job, cid);
    $('#moveCust').onchange = async e => {
      const to = customers.find(c => c.id === e.target.value);
      if (!await confirmBox('Move job?', `Move WO ${esc(job.wo)} with its forms, photos and saved PDFs to <b>${esc(to.name)}</b>? Finalized PDFs keep the customer name they were signed with.`, 'Move job')) { e.target.value = cid; return; }
      job.customerId = to.id; if (to.id !== 'unassigned') delete job.legacyCustomer;
      await saveJob(job); toast('Job moved'); location.hash = P.job(to.id, job.id);
    };
    $('#delJobBtn').onclick = async () => {
      if (!await confirmBox('Delete job?', `This permanently deletes <b>WO ${esc(job.wo)}</b> for ${esc(customer.name)} from this device, including all form data, photos and saved PDFs. This cannot be undone. Consider a backup first.`, 'Delete job', true)) return;
      if (!await requireAdmin('Delete job', `WO ${job.wo} – ${customer.name}`)) return;
      clearTimeout(saveTimer); saveTimer = null; saveJobRef = null;
      await DB.deleteJob(job.id); toast('Job deleted'); location.hash = P.cust(cid);
    };
    $$('[data-addform]').forEach(b => b.onclick = async () => { const k = b.dataset.addform, gid = parseKey(k).gid; job.forms[k] = job.forms[k] || newFormState(k, gid, gbMeta(job, gid).stages, gbById(job, gid)); job.forms[k].enabled = true; await saveJob(job); renderJob(cid, jid); });
    $$('[data-export]').forEach(b => b.onclick = () => exportForm(job, b.dataset.export));
    const docById = i => docs.find(d => d.id === i);
    $$('[data-docview]').forEach(b => b.onclick = () => viewDoc(docById(b.dataset.docview)));
    $$('[data-docprint]').forEach(b => b.onclick = () => { const d = docById(b.dataset.docprint); printPdf(d.blob, d.filename); });
    $$('[data-docshare]').forEach(b => b.onclick = () => { const d = docById(b.dataset.docshare); shareOrDownload(d.blob, d.filename); });
    $$('[data-docdel]').forEach(b => b.onclick = async () => {
      const d = docById(b.dataset.docdel);
      if (!await confirmBox('Delete saved PDF?', `Permanently delete <b>${esc(d.filename)}</b> (revision ${d.revision}) from this job? The form data is kept.`, 'Delete PDF', true)) return;
      if (!await requireAdmin('Delete saved PDF revision', `${d.filename} (rev ${d.revision}) – WO ${job.wo}`)) return;
      await DB.del('docs', d.id);
      const h = ((job.forms[d.formKey] || {}).history || []).find(x => x.docId === d.id); if (h) { h.pdfDeleted = Date.now(); await saveJob(job); }
      toast('Saved PDF deleted'); renderJob(cid, jid);
    });
    $('#zipBtn').onclick = () => exportJobZip(job, customer);
    $('#partsPdfBtn').onclick = () => downloadParts(job, customer);
    $('#combinedBtn').onclick = async () => { const r = await combinedPdf(job, customer); if (r) fileReady(r.blob, r.filename, 'Combined job PDF ready'); };
    await fillPhotoPanels(job);
  }
  function viewDoc(d) {
    const u = objUrl(d.blob);
    const ov = document.createElement('div'); ov.className = 'viewer';
    ov.innerHTML = `<div class="viewer-bar"><b>${esc(d.filename)}</b><span class="grow"></span><button class="btn" data-a="open">Open in new tab</button><button class="btn" data-a="print">Print</button><button class="btn" data-a="share">${SHARE}</button><button class="btn primary" data-a="close">Close</button></div><iframe src="${u}" title="PDF preview"></iframe>`;
    document.body.appendChild(ov);
    ov.onclick = e => { const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'close') ov.remove(); else if (a === 'open') openBlob(d.blob); else if (a === 'print') printPdf(d.blob, d.filename); else if (a === 'share') shareOrDownload(d.blob, d.filename); };
  }

  /* ---------- photos ---------- */
  function photoPanel(scope, label, locked, suggest, catchAll) {
    return `<div class="photos" data-scope="${esc(scope)}" data-label="${esc(label)}" ${locked ? 'data-locked="1"' : ''} ${suggest ? `data-suggest="${esc(suggest)}"` : ''} ${catchAll ? `data-catchall="${esc(catchAll)}"` : ''}>
      ${locked ? '' : `<div class="photo-btns"><button type="button" class="btn cam" data-cam="1" data-scope="${esc(scope)}" data-label="${esc(label)}">📷 Take photo</button><label class="btn" for="fileGallery" data-scope="${esc(scope)}" data-label="${esc(label)}">🖼 Choose from gallery</label></div>`}
      <div class="thumbs"></div></div>`;
  }
  async function fillPhotoPanels(job) {
    const photos = (await DB.byJob('photos', job.id)).sort((a, b) => a.createdAt - b.createdAt);
    const plan = current.formKey && fdef(job, current.formKey) ? photoPlan(job, current.formKey) : null;
    for (const panel of $$('.photos')) {
      // a form's catch-all panel (teardown L / assembly "Additional photos") also shows photos whose section is unknown (Rev 1.6.1)
      const catchAll = panel.dataset.catchall && plan, own = p => p.scope === panel.dataset.scope || (catchAll && p.scope.startsWith(panel.dataset.catchall + ':') && !plan.known[p.scope]);
      const list = photos.filter(own), locked = !!panel.dataset.locked;
      $('.thumbs', panel).innerHTML = list.map(p => `<figure class="thumb" data-id="${p.id}"><img src="${objUrl(p.thumb || p.blob)}" alt="${esc(p.caption || 'photo')}" data-full="${p.id}">
        ${locked ? `<figcaption>${esc(p.caption)}</figcaption>` : `<input class="cap" placeholder="Caption" value="${esc(p.caption)}" data-cap="${p.id}" maxlength="120" autocomplete="off" ${panel.dataset.suggest ? `list="${esc(panel.dataset.suggest)}"` : ''}><button class="del" data-delphoto="${p.id}" aria-label="Delete photo">✕</button>`}</figure>`).join('')
        || (locked ? '<p class="muted small">No photos.</p>' : '');
      const det = panel.closest('details'), summary = det && $('.pcount', det); if (summary) summary.textContent = list.length ? `(${list.length})` : '';
      if (det && list.length && !det.dataset.seen) { det.open = true; det.dataset.seen = '1'; }   // Rev 1.6.1: a section's own photos are shown right there
    }
    view.onclick = viewClick(photos);
  }
  function viewClick(photos) {
    return async e => {
      const t = e.target;
      if (t.matches('label[for="fileCamera"],label[for="fileGallery"]')) { pendingPhoto = {jobId: current.job.id, scope: t.dataset.scope, label: t.dataset.label}; return; }
      const camBtn = t.closest && t.closest('[data-cam]');
      if (camBtn) { const pn = camBtn.closest('.photos'); pendingPhoto = {jobId: current.job.id, scope: camBtn.dataset.scope, label: camBtn.dataset.label, suggest: pn && pn.dataset.suggest}; openCamera(pendingPhoto); return; }
      if (t.dataset.full) { const p = photos.find(x => x.id === t.dataset.full) || await DB.get('photos', t.dataset.full); if (p) modal(`<img class="full" src="${objUrl(p.blob)}" alt=""><p>${esc(p.caption || '')}</p><p class="muted small">${esc(p.label)} · ${p.w}×${p.h}</p>`, [{label: 'Close', value: 'cancel'}], {wide: true, noFocus: true}); return; }
      if (t.dataset.delphoto) {
        if (!await confirmBox('Delete photo?', 'This photo will be removed from the job.', 'Delete', true)) return;
        const ph = photos.find(x => x.id === t.dataset.delphoto) || await DB.get('photos', t.dataset.delphoto) || {};
        if (!await requireAdmin('Delete photo', `WO ${current.job.wo} – ${ph.label || ''}${ph.caption ? ': ' + ph.caption : ''}`)) return;
        await DB.del('photos', t.dataset.delphoto); t.closest('.thumb').remove(); toast('Photo deleted'); return;
      }
    };
  }
  document.addEventListener('change', async e => {
    if (e.target.dataset && e.target.dataset.cap) {
      const p = await DB.get('photos', e.target.dataset.cap); if (p) { p.caption = e.target.value; await DB.put('photos', p); toast('Caption saved', 1200); }
    }
  });
  async function savePhoto(target, file, caption) {
    const c = await Photos.compress(file);
    await DB.put('photos', {id: DB.uid(), jobId: target.jobId, scope: target.scope, label: target.label, caption: caption || '', blob: c.blob, thumb: c.thumb, w: c.w, h: c.h, createdAt: Date.now(), source: file.name ? 'file' : 'camera'});
    return c.thumb;
  }
  function openCamera(target) {
    Camera.open({
      title: `${target.label} – WO ${current.job ? current.job.wo : ''}`, captionList: target.suggest || '',
      onUse: (blob, caption) => savePhoto(target, blob, caption),
      onClose: async n => { if (current.job && n) { current.job.updatedAt = Date.now(); await DB.put('jobs', current.job); await fillPhotoPanels(current.job); toast(`${n} photo${n > 1 ? 's' : ''} added`); } },
      onUnavailable: err => cameraFallback(target, err),
    });
  }
  function cameraFallback(target, err) {
    const why = err && err.name === 'NotAllowedError' ? 'Camera permission was denied. To use the in-app camera, allow camera access for this site in the browser or system settings (on Windows: Settings › Privacy & security › Camera), then try again.'
      : err && err.name === 'NotFoundError' ? 'No camera was found on this device.'
      : err && err.name === 'NotReadableError' ? 'The camera is in use by another app. Close the other app and try again.'
      : window.isSecureContext === false ? 'The camera needs a secure (https) connection.'
      : err && err.name === 'NotSupportedError' ? 'This browser does not support the in-app camera.'
      : `The in-app camera is not available (${esc(err && (err.name || err.message) || 'unknown error')}).`;
    modal(`<h2>Camera not available</h2><p>${why}</p><p class="muted small">You can still add a photo with the device's own camera app or pick an image file:</p>
      <label class="btn primary fallback-pick">📷 Use device camera / pick a file<input type="file" accept="image/*" capture="environment" class="vh" data-fallback="1"></label>`,
      [{label: 'Close', value: 'cancel'}], {noFocus: true, onOpen: (f, dlg) => {
        const inp = $('input[data-fallback]', f);
        inp.onchange = async () => { pendingPhoto = target; const files = Array.from(inp.files || []); dlg.close('picked'); await onFiles({files, value: ''}); };
      }});
  }
  async function onFiles(input) {
    const files = Array.from(input.files || []); input.value = '';
    if (!files.length || !pendingPhoto) return;
    const target = pendingPhoto; toast(`Processing ${files.length} photo${files.length > 1 ? 's' : ''}…`, 5000);
    let n = 0;
    for (const f of files) {
      try {
        await savePhoto(target, f, '');
        n++;
      } catch (err) { console.error(err); toast('Could not read one image: ' + err.message, 4000); }
    }
    if (current.job) { current.job.updatedAt = Date.now(); await DB.put('jobs', current.job); await fillPhotoPanels(current.job); }
    if (n) toast(`${n} photo${n > 1 ? 's' : ''} added`);
  }
  $('#fileCamera').addEventListener('change', e => onFiles(e.target));
  $('#fileGallery').addEventListener('change', e => onFiles(e.target));

  /* ---------- form rendering ---------- */
  function reqAttr(b) { return b.req ? `data-req="${esc(b.req.id)}"` : ''; }
  function naBtn(b, locked) { return b.req && !locked ? `<button type="button" class="na-btn" data-na="${esc(b.req.id)}" title="Mark not applicable">N/A</button>` : ''; }
  function input(f, val, opts = {}) {
    const n = esc(f.name), dis = opts.locked ? 'disabled' : '', link = f.link ? `data-link="${f.link}"` : '';
    const ro = f.link === 'customer' ? 'readonly title="Edit the name in the customer file"' : '';
    if (f.multiline) return `<textarea data-name="${n}" ${link} rows="${f.rows || 3}" ${dis} aria-label="${esc(f.label || '')}">${esc(val)}</textarea>`;
    const type = f.input === 'date' ? 'date' : 'text', extra = `${f.input === 'number' ? 'inputmode="decimal"' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.suggest ? `list="dl-${esc(f.suggest)}"` : ''}`;
    const calc = f.calc ? 'readonly class="calc" tabindex="-1" title="Calculated from the tooth counts"' : '';
    return `<input type="${type}" data-name="${n}" ${link} ${ro} ${calc} value="${esc(val)}" ${dis} ${extra} autocomplete="off" aria-label="${esc(f.label || opts.aria || '')}">`;
  }
  function renderBlock(job, key, b, locked) {
    const v = n => getVal(job, key, n) || '', chk = n => job.forms[key].values[n] ? 'checked' : '', dis = locked ? 'disabled' : '';
    const fieldBox = f => `<label class="fld"><span>${esc(f.label)}${f.link ? ' <i class="auto">auto-filled from job</i>' : ''}</span><div class="with-suffix">${input(f, v(f.name), {locked})}${f.suffix ? `<em>${esc(f.suffix)}</em>` : ''}</div></label>`;
    const cbox = (name, label, cls = '') => `<label class="chk ${cls}"><input type="checkbox" data-name="${esc(name)}" ${chk(name)} ${dis}><span class="box"></span><span class="txt">${esc(label)}</span></label>`;
    switch (b.type) {
      case 'subhead': return `<h4 class="subhead">${esc(b.text)}</h4>`;
      case 'field': return `<div class="blk" ${reqAttr(b)}>${fieldBox(b)}${naBtn(b, locked)}</div>`;
      case 'row': return `<div class="blk" ${reqAttr(b)}><div class="row cols${b.fields.length}">${b.fields.map(fieldBox).join('')}</div>${naBtn(b, locked)}</div>`;
      case 'check': return `<div class="blk item" ${reqAttr(b)}><div class="item-line">${cbox(b.name, b.label)}${naBtn(b, locked)}</div>
          ${b.fields.length ? `<div class="row sub cols${b.fields.length}">${b.fields.map(f => `<label class="fld"><span>${esc(f.label)}</span>${input(f, v(f.name), {locked})}</label>`).join('')}</div>` : ''}
          ${b.notes ? `<label class="fld sub"><span>Notes</span>${input({name: b.notes, label: 'Notes'}, v(b.notes), {locked})}</label>` : ''}</div>`;
      case 'choice': return `<div class="blk item" ${reqAttr(b)}><div class="item-line">${b.label ? `<span class="choice-label">${esc(b.label)}</span>` : ''}${naBtn(b, locked)}</div>
          <div class="choices ${b.exclusive ? 'seg' : ''}" ${b.exclusive ? 'data-exclusive="1"' : ''}>${b.options.map(o => cbox(o.name, o.label, 'pill') + (o.text ? `<input class="other-text" type="text" data-name="${esc(o.text)}" value="${esc(v(o.text))}" placeholder="Specify" ${dis}>` : '')).join('')}</div>
          ${b.notes ? `<label class="fld sub"><span>Notes</span>${input({name: b.notes, label: 'Notes'}, v(b.notes), {locked})}</label>` : ''}</div>`;
      case 'table': return `<div class="blk tablewrap"><h4 class="subhead">${esc(b.title)}</h4><table class="tbl"><thead><tr>${b.columns.map(c => `<th>${esc(c)}</th>`).join('')}<th class="na-col"></th></tr></thead><tbody>
          ${b.rows.map(r => `<tr ${reqAttr(r)}>${r.label.map((l, i) => `<td class="${i ? '' : 'rowlabel'}">${esc(l)}</td>`).join('')}${r.cells.map(c => c.kind === 'choice'
            ? `<td class="cc"><div class="choices seg rr" data-exclusive="1" role="radiogroup" aria-label="${esc(c.options.map(o => o.label).join(' / '))}">${c.options.map(o => cbox(o.name, o.label, 'pill ' + o.label.toLowerCase())).join('')}</div></td>`
            : c.kind === 'check' ? `<td class="c">${cbox(c.name, '', 'solo')}</td>` : `<td>${input({name: c.name}, v(c.name), {locked, aria: c.name})}</td>`).join('')}<td class="na-col">${naBtn(r, locked)}</td></tr>`).join('')}</tbody></table></div>`;
      case 'component': return `<div class="blk comp" ${reqAttr(b)} id="comp-${esc(b.id)}">
          <div class="comp-head">${b.nameField ? `<label class="other-name"><span>Other:</span>${input({name: b.nameField, label: 'Other component name'}, v(b.nameField), {locked})}</label>` : `<b>${esc(b.name)}</b>`}
            <div class="choices seg" data-exclusive="1">${b.options.map(o => cbox(o.name, o.label, 'pill ' + o.label.toLowerCase())).join('')}</div>${naBtn(b, locked)}</div>
          <div class="comp-body"><div class="row cols${b.fields.length + 1}">${b.fields.map(f => `<label class="fld ${f.appOnly ? 'apponly' : ''}"><span>${esc(f.label)}${f.appOnly ? ' <i class="auto">for Parts Summary</i>' : ''}</span>${input(f.appOnly && /_qty$/.test(f.name) && b.parts ? {...f, placeholder: `default ${Parts.qtyHint(b.parts)}`} : f, v(f.name), {locked})}</label>`).join('')}</div>
            <label class="fld"><span>Findings</span>${input({name: b.findings, label: 'Findings', multiline: true, rows: 2}, v(b.findings), {locked})}</label>
            <details class="comp-photos"><summary>Photos <span class="pcount"></span></summary>${photoPanel(`${key}:${b.id}`, b.name, locked)}</details></div></div>`;
      case 'photos': {   // Rev 1.6: L. Teardown photos (optional; printed in this section of the PDF)
        const dl = `capsuggest-${b.id}`, comps = fdef(job, key).sections.flatMap(s => s.blocks).filter(x => x.type === 'component' && !x.nameField).map(x => x.name);
        return `<div class="blk tphotos" id="blk-${esc(b.id)}"><p class="muted small">${esc(b.help || '')}</p>
          <datalist id="${dl}">${[...(b.suggest || []), ...comps].map(o => `<option value="${esc(o)}"></option>`).join('')}</datalist>
          ${photoPanel(`${key}:${b.scope}`, b.label, locked, dl, key)}</div>`;
      }
    }
    return '';
  }
  async function renderForm(cid, jid, key) {
    const {customer, job} = await load(cid, jid); if (!job) return;
    const gid = parseKey(key).gid, gb = gbById(job, gid);
    if (!job.forms[key] || !gb || gb.removed || !fdef(job, key)) { location.hash = P.job(cid, jid); return; }
    const form = fdef(job, key), gm = gbMeta(job, gid);
    current = {customer, job, formKey: key};
    let st = job.forms[key], inUse = null, offlineEdit = false;
    if (st.status !== 'completed' && Cloud.enabled()) {
      const lk = REMOTE_RERENDER && Cloud.isHeld(jid, key) ? {ok: true} : await Cloud.checkout(jid, key);
      if (!lk.ok) inUse = lk.by; else offlineEdit = !!lk.offline;
      const fresh = await DB.get('jobs', jid); if (fresh && fresh.forms[key]) { job.forms[key] = fresh.forms[key]; st = fresh.forms[key]; }   // newest copy after the pre-checkout sync
    }
    const completed = st.status === 'completed', locked = completed || !!inUse;
    bar([crumbHome, {label: customer.name, href: P.cust(cid)}, {label: `WO ${job.wo}`, href: P.job(cid, jid)}, {label: gm.count > 1 ? `${form.title} – Gearbox ${gm.index}` : form.title}],
      `<span class="save-ind" id="saveInd"></span><button class="btn ghost" id="exportBtn">${completed ? SHARE_FINAL : 'Export PDF'}</button>` +
      (completed ? `<button class="btn warn" id="reopenBtn">Reopen</button>` : inUse ? `<button class="btn" id="lockRetryBtn">Check again</button>` : `<button class="btn accent" id="finalizeBtn">Finalize</button>`), {label: `WO ${job.wo}`, href: P.job(cid, jid)});
    view.innerHTML = `
      <div class="form-top">
        <div class="form-meta"><h1>${esc(form.docTitle)}</h1><div class="gb-line" id="gbLine">${esc(gm.label)} · <b>${esc(gm.typeLabel)}</b> 🔒${gm.serial ? ` · S/N ${esc(gm.serial)}` : ''}</div><div>${badge(st.status)} <span class="muted small">rev ${st.revision}</span> <span class="muted small" id="progTxt"></span></div></div>
        ${locked ? '' : `<div class="tablet-row"><label class="fld"><span>Tablet used for inspection</span><input id="tabletUsed" type="text" maxlength="60" autocomplete="off" value="${esc(st.tabletUsed ?? TABLET)}"></label></div>`}
        ${inUse ? `<div class="lockbar inuse" id="inUseBar">🔒 <b>In use on ${esc(inUse.name)}</b>${inUse.user ? ` by <b>${esc(inUse.user)}</b>` : ''}. Read-only here so nobody overwrites the other tablet's work. It opens for editing when they leave the form (or automatically after ${esc(new Date(inUse.until).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}))} if that tablet went offline).</div>` : ''}
        ${offlineEdit ? `<div class="infobar" id="offlineBar">Offline: your changes are saved on this tablet and sync when it is back online. The form can't be checked out while offline, so if someone edits it on another tablet at the same time, the first to sync wins and the other's changes go to the audit log.</div>` : ''}
        ${completed ? `<div class="lockbar">🔒 Completed ${esc(fmtDate(st.completedAt))}, signed by <b>${esc(st.signedBy)}</b>${st.finalizedBy ? `, finalized by <b>${esc(st.finalizedBy)}</b>` : ''}${st.inspectedOn ? ` · Inspected on: <b>${esc(st.inspectedOn)}</b>` : ''}. This form is read-only. The final PDF is saved in the job's documents. Tap <b>Reopen</b> to start revision ${st.revision + 1}.</div>` : ''}
        ${st.history.length && !locked ? `<div class="infobar">Revision ${st.revision} (reopened). Earlier final PDFs are kept in the job's saved documents.</div>` : ''}
      </div>
      <nav class="chips">${form.sections.map(s => `<a href="#" data-jump="sec-${s.id}">${esc(/^[A-Z0-9]+\./.test(s.title) ? s.title.replace(/^([A-Z0-9]+)\.\s*/, '$1 · ') : s.title)}</a>`).join('')}${hasPhotoBlock(form) ? '' : `<a href="#" data-jump="sec-more">${MORE_TITLE}</a>`}<a href="#" data-jump="sec-photos-all">Photos</a></nav>
      <datalist id="dl-btypes">${(FORMS.bearingTypes || []).map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>
      <div class="formbody ${locked ? 'locked' : ''}" id="formBody">
        ${form.sections.map(s => `<section class="sec" id="sec-${s.id}"><h3 class="sec-title">${esc(s.title)}</h3>
          ${s.blocks.map(b => renderBlock(job, key, b, locked)).join('')}
          ${s.photos ? `<details class="sec-photos"><summary>Section photos <span class="pcount"></span></summary>${photoPanel(`${key}:${s.id}`, s.title, locked)}</details>` : ''}
        </section>`).join('')}
        ${hasPhotoBlock(form) ? '' : `<section class="sec" id="sec-more"><h3 class="sec-title">${MORE_TITLE}</h3><p class="muted small">General photos for this form. They print after the last section of the PDF. Photos taken in a section print right after that section.</p>${photoPanel(`${key}:more`, MORE_TITLE, locked, '', key)}</section>`}
        <section class="sec" id="sec-photos-all"><h3 class="sec-title">Job photos</h3><p class="muted small">Job-level photos (shared by all forms of this job) print at the end of every form's PDF. Section and component photos print right after their own section.</p>${photoPanel('job', 'Job photo', false)}</section>
      </div>`;
    const body = $('#formBody'); window.scrollTo(0, 0);
    if (!locked) recalc(job, key);
    refreshReqUI(job, key);
    $$('.chips a').forEach(a => a.onclick = e => { e.preventDefault(); jumpTo($('#' + a.dataset.jump)); });
    if (!locked) {
      $('#tabletUsed').oninput = e => { st.tabletUsed = e.target.value; scheduleSave(); };
      body.addEventListener('input', e => onField(e, job, key));
      body.addEventListener('change', e => onField(e, job, key));
      body.addEventListener('click', e => {
        const na = e.target.dataset && e.target.dataset.na; if (!na) return;
        e.preventDefault(); toggleNA(job, key, na);
      });
      $('#finalizeBtn').onclick = () => finalize(job, key);
    } else if (completed) {
      $('#reopenBtn').onclick = () => reopen(job, key);
    } else $('#lockRetryBtn').onclick = () => renderForm(cid, jid, key);
    $('#exportBtn').onclick = () => exportForm(job, key);
    await fillPhotoPanels(job);
  }
  function onField(e, job, key) {
    const t = e.target, name = t.dataset && t.dataset.name; if (!name) return;
    const st = job.forms[key];
    if (t.type === 'checkbox') {
      if (e.type !== 'change') return;
      st.values[name] = t.checked;
      const grp = t.closest('[data-exclusive]');
      if (grp && t.checked) $$('input[type=checkbox]', grp).forEach(o => { if (o !== t && o.checked) { o.checked = false; st.values[o.dataset.name] = false; } });
    } else if (t.dataset.link) {
      if (t.dataset.link === 'customer') return;   // edited in the customer file
      setGbInfo(job, parseKey(key).gid, t.dataset.link, t.value);   // gearbox-level value shared by both forms of that gearbox
    } else st.values[name] = t.value;
    recalc(job, key);
    scheduleSave(job); if (current.job === job) refreshReqUI(job, key);
  }
  /* Rev 1.6 calculated fields: planetary stage ratio = 1 + Z ring / Z sun from the tooth counts (stored, so PDFs print it) */
  const ratioTxt = r => isFinite(r) && r > 0 ? String(Math.round(r * 1000) / 1000) : '';
  function recalc(job, key) {
    const st = job.forms[key]; if (!st || st.status === 'completed') return;
    for (const c of CALCS[fdef(job, key).id] || []) {
      const ring = parseFloat(String(st.values[c.ring] || '').replace(',', '.')), sun = parseFloat(String(st.values[c.sun] || '').replace(',', '.'));
      const v = ring > 0 && sun > 0 ? ratioTxt(1 + ring / sun) : '';
      if ((st.values[c.name] || '') !== v) { st.values[c.name] = v; const el = document.querySelector(`#formBody [data-name="${CSS.escape(c.name)}"]`); if (el) el.value = v; }
    }
  }
  function toggleNA(job, key, id) {
    const st = job.forms[key]; if (st.na[id]) delete st.na[id]; else st.na[id] = true;
    scheduleSave(); refreshReqUI(job, key);
  }
  function refreshReqUI(job, key) {
    for (const r of reqsOf(job, key)) {
      const el = document.querySelector(`[data-req="${CSS.escape(r.req.id)}"]`); if (!el) continue;
      const s = reqState(job, key, r.req);
      el.classList.toggle('is-na', s === 'na'); el.classList.toggle('is-done', s === 'done'); el.classList.toggle('is-skip', s === 'skip');
      if (s !== 'missing') el.classList.remove('missing');
      const nb = $('.na-btn', el); if (nb) nb.classList.toggle('on', s === 'na');
    }
    const p = progress(job, key), t = $('#progTxt'); if (t) t.textContent = `· ${p.done}/${p.total} required complete`;
    return p;
  }
  function jumpTo(el) {
    if (!el) return;
    const d = el.closest('details'); if (d) d.open = true;
    const y = el.getBoundingClientRect().top + window.scrollY - (document.querySelector('.appbar').offsetHeight + 60);
    window.scrollTo({top: y, behavior: 'smooth'});
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
    const inp = el.querySelector('input:not([type=checkbox]):not([disabled]):not([readonly]),textarea:not([disabled])');
    if (inp) setTimeout(() => inp.focus({preventScroll: true}), 400);
  }

  /* ---------- finalize / reopen ---------- */
  async function finalize(job, key) {
    await flushSave();
    const form = fdef(job, key), st = job.forms[key], gid = parseKey(key).gid;
    for (;;) {
      const p = refreshReqUI(job, key);
      $$('.missing').forEach(e => e.classList.remove('missing'));
      p.missing.forEach(m => { const el = document.querySelector(`[data-req="${CSS.escape(m.req.id)}"]`); if (el) el.classList.add('missing'); });
      if (!p.missing.length) break;
      const v = await modal(`<h2>${p.missing.length} required item${p.missing.length > 1 ? 's' : ''} incomplete</h2>
        <p class="muted">Complete each item, or mark it <b>N/A</b> if it does not apply to this job. Items are highlighted in red on the form.</p>
        <ul class="missing-list">${p.missing.map(m => `<li><div><div class="small muted">${esc(m.section)}</div>${esc(m.req.label)}</div>
          <span class="ml-actions"><button type="button" class="btn" data-mgo="${esc(m.req.id)}">Go to</button><button type="button" class="btn" data-mna="${esc(m.req.id)}">N/A</button></span></li>`).join('')}</ul>`,
        [{label: 'Close', value: 'cancel'}, {label: 'Go to first', value: 'first', cls: 'primary'}], {wide: true, noFocus: true,
          onOpen: (f, dlg) => {
            f.onclick = e => {
              const go = e.target.dataset.mgo, na = e.target.dataset.mna;
              if (go) { dlg.close('go:' + go); }
              if (na) { st.na[na] = true; scheduleSave(); refreshReqUI(job, key); e.target.closest('li').remove();
                const left = $$('.missing-list li', f).length; $('h2', f).textContent = left ? `${left} required item${left > 1 ? 's' : ''} incomplete` : 'All required items complete';
                if (!left) dlg.close('recheck'); }
            };
          }});
      if (v === 'recheck') continue;
      if (v === 'first' || v.startsWith('go:')) {
        const id = v === 'first' ? p.missing[0].req.id : v.slice(3);
        jumpTo(document.querySelector(`[data-req="${CSS.escape(id)}"]`));
      }
      return;
    }
    await flushSave();
    const suggested = (st.values[form.signedByField] || '').trim() || userName();
    const now = new Date(), inspectedOn = (st.tabletUsed ?? TABLET ?? '').trim() || TABLET || 'Unknown';
    const v = await modal(`<h2>Finalize ${esc(form.title)}</h2>
      <p>All required items are complete${Object.keys(st.na).length ? ` (${Object.keys(st.na).length} marked N/A)` : ''}. Finalizing will:</p>
      <ul><li>lock this form (read-only, status <b>Completed</b>)</li><li>create a flattened final PDF (revision ${st.revision}) with photo pages</li><li>save it in this job's documents</li></ul>
      <label class="fld"><span>Signed by</span><input name="signedBy" required value="${esc(suggested)}" autocomplete="name"></label>
      <p class="muted small">Completion date: ${esc(fmtDate(now))} · Inspected on: <b>${esc(inspectedOn)}</b></p>`,
      [{label: 'Cancel', value: 'cancel'}, {label: 'Finalize & save PDF', value: 'ok', cls: 'accent'}]);
    if (v !== 'ok') return;
    const signedBy = $('#dlgForm').signedBy.value.trim() || suggested || 'Unknown';
    toast('Creating final PDF…', 8000);
    try {
      const c = ctx(job, current.customer, gid);
      const naLabels = reqsOf(job, key).filter(r => st.na[r.req.id] && reqState(job, key, r.req) !== 'skip').map(r => `${r.section}: ${r.req.label}`);
      const parts = parseKey(key).base === 'teardown' ? partsData(job, current.customer, [gid], false, gid) : null;
      const out = await PdfExport.build({form, job: c, state: st, gearbox: pdfGb(c), photos: await photosFor(job, key), groups: await photoGroups(job, key), parts, final: {signedBy, completedAt: fmtDate(now), revision: st.revision, naLabels, inspectedOn, finalizedBy: userName(), appRev: REV_LABEL}});
      const blob = new Blob([out.bytes], {type: 'application/pdf'});
      const filename = PdfExport.filename(c, form, `_FINAL-rev${st.revision}`);
      const doc = {id: DB.uid(), jobId: job.id, customerId: job.customerId, formKey: key, gearboxId: gid, gearbox: c.gearbox, stages: c.stages, reduction: c.reduction, typeLabel: c.typeLabel, revision: st.revision, filename, createdAt: now.getTime(), signedBy, inspectedOn, finalizedBy: userName(), appRev: REV_LABEL, pages: out.pages, partsPages: out.partsPages || 0, size: blob.size, blob};
      await DB.put('docs', doc);
      Object.assign(st, {status: 'completed', completedAt: now.getTime(), signedBy, inspectedOn, finalizedBy: userName(), tabletUsed: inspectedOn, snapshot: c, gearboxId: gid, stages: c.stages});
      st.history.push({revision: st.revision, completedAt: now.getTime(), signedBy, inspectedOn, finalizedBy: userName(), docId: doc.id});
      await saveJob(job);
      if (Cloud.enabled()) { await Cloud.release(job.id, key); Cloud.soon(100); }   // finalized: lock no longer needed (finalized forms are locked everywhere)
      await renderForm(job.customerId, job.id, key);
      await fileReady(blob, filename, `Completed – final PDF saved (rev ${doc.revision})`);
    } catch (e) { console.error(e); modal(`<h2>PDF failed</h2><p>${esc(e.message)}</p>`, [{label: 'Close', value: 'cancel'}]); }
  }
  async function reopen(job, key) {
    const st = job.forms[key];
    const ok = await confirmBox('Reopen form?', `This unlocks the form for editing as <b>revision ${st.revision + 1}</b>. The saved final PDF for revision ${st.revision} is kept unchanged in the job documents. You will need to finalize again to produce a new final PDF.`, `Reopen as rev ${st.revision + 1}`, true);
    if (!ok) return;
    if (!await requireAdmin('Reopen completed form', `${titleOf(key)}${activeGbs(job).length > 1 ? ' – ' + gbMeta(job, parseKey(key).gid).label : ''} rev ${st.revision} → rev ${st.revision + 1} – WO ${job.wo}`)) return;
    Object.assign(st, {status: 'draft', revision: st.revision + 1, reopenedAt: Date.now(), tabletUsed: TABLET});
    delete st.completedAt; delete st.signedBy; delete st.snapshot; delete st.inspectedOn; delete st.finalizedBy;
    await saveJob(job); toast(`Reopened as revision ${st.revision}`); renderForm(job.customerId, job.id, key);
  }

  /* ---------- Rev 1.7: Parts Summary ---------- */
  function gbParts(job, gid) {
    const tk = fkey(gid, 'teardown'), ak = fkey(gid, 'assembly'), ts = job.forms[tk], as = job.forms[ak];
    return Parts.gearbox({td: ts && ts.enabled ? fdef(job, tk) : null, tdVals: (ts && ts.values) || {}, as: as && as.enabled ? fdef(job, ak) : null, asVals: (as && as.values) || {}});
  }
  /* gids: null = all active gearboxes; finalGid: the teardown being finalized right now counts as FINAL */
  function partsData(job, customer, gids, withRoll, finalGid) {
    const list = (gids || activeGbs(job).map(g => g.id)).map(gid => {
      const m = gbMeta(job, gid), info = gbInfo(job, gid), ts = job.forms[fkey(gid, 'teardown')];
      return {gid, label: m.label, typeLabel: m.typeLabel, serial: info.serial, manufacturer: info.manufacturer, model: info.model, noTeardown: !(ts && ts.enabled),
              status: gid === finalGid || (ts && ts.enabled && ts.status === 'completed') ? 'FINAL' : 'DRAFT', summary: gbParts(job, gid)};
    });
    return {meta: {customer: custName(job, customer), wo: job.wo || '', date: job.date || '', tablet: TABLET || '-', rev: REV_LABEL, generated: fmtDate(Date.now()), user: userName()},
            gearboxes: list, roll: withRoll ? Parts.rollup(list) : null};
  }
  const partsRollOnly = (job, customer) => ({...partsData(job, customer, null, true), rollOnly: true});   // combined PDF: roll-up page only (gearbox pages follow each teardown)
  const partsName = (c, ext) => `WO-${PdfExport.safe(c.wo)}_${PdfExport.safe(c.customer)}_Parts-Summary.${ext}`;
  function partsBrief(job) {
    const gbs = activeGbs(job); let r = 0, p = 0, s = 0;
    for (const g of gbs) { const x = gbParts(job, g.id); r += x.replace.length; p += x.repair.length; s += x.shims.length; }
    return `${r} part line${r === 1 ? '' : 's'} to replace, ${p} to repair, ${s} shim pack${s === 1 ? '' : 's'} to replace (${gbs.length} gearbox${gbs.length === 1 ? '' : 'es'})`;
  }
  async function downloadParts(job, customer) {
    toast('Building Parts Summary…', 6000);
    try { const bytes = await PdfExport.partsPdf(partsData(job, customer, null, true)); await fileReady(new Blob([bytes], {type: 'application/pdf'}), partsName(ctx(job, customer), 'pdf'), 'Parts Summary PDF ready'); }
    catch (e) { console.error(e); modal(`<h2>PDF failed</h2><p>${esc(e.message)}</p>`, [{label: 'Close', value: 'cancel'}]); }
  }
  async function renderParts(cid, jid) {
    const {customer, job} = await load(cid, jid); if (!job) return;
    current = {customer, job, formKey: null};
    bar([crumbHome, {label: customer.name, href: P.cust(cid)}, {label: `WO ${job.wo}`, href: P.job(cid, jid)}, {label: 'Parts Summary'}], `<button class="btn primary" id="partsDlBtn">Download Parts Summary</button>`, {label: `WO ${job.wo}`, href: P.job(cid, jid)});
    const d = partsData(job, customer, null, true), q = Parts.fmtQty;
    const tbl = (cls, head, cols, rows, empty) => `<h4 class="subhead">${esc(head)}</h4>${rows.length ? `<div class="tablewrap"><table class="tbl parts ${cls}"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td${i === 2 && cols[2] === 'Qty' ? ' class="num"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="muted small">${esc(empty)}</p>`}`;
    const PC = ['Part / description', 'Location', 'Qty', 'Part no.', 'Failure mode / notes'];
    const prow = it => [it.desc + (it.type && !['Other', 'Gears', 'Shafts'].includes(it.cat) ? ` (${it.type})` : ''), it.loc, q(it.qty), it.pn || '', it.notes || ''];
    view.innerHTML = `
      <section class="card"><div class="card-head"><h2>Parts Summary</h2><span class="muted small">WO ${esc(job.wo)} · ${esc(d.meta.customer)} · Tablet ${esc(d.meta.tablet)} · ${esc(REV_LABEL)}</span></div>
        <p class="muted small">Built automatically from each gearbox's Teardown Evaluation (components marked Replace or Repair, planet rows) and the shim pack Replace / Reuse choices of both forms. It updates as the forms are filled in. Quantity: the <b>Qty needed</b> entered on a part row, otherwise the default (1, 2 for a shaft's bearing pair, per planet for planet parts).</p></section>
      ${d.gearboxes.map(g => `<section class="card partsgb" data-partsgb="${g.gid}">
        <div class="card-head"><h2>${esc(g.label)}</h2><span class="typetag">${esc(g.typeLabel)}</span>${g.serial ? `<span class="muted small">S/N ${esc(g.serial)}</span>` : ''}
          <span class="right"><span class="badge ${g.status === 'FINAL' ? 'done' : 'draft'} partsstatus">${g.status === 'FINAL' ? 'FINAL' : 'DRAFT'}</span></span></div>
        ${g.status !== 'FINAL' ? `<p class="muted small">${g.noTeardown ? 'This gearbox has no Teardown Evaluation.' : 'DRAFT until the Teardown Evaluation is finalized; quantities may still change.'}</p>` : ''}
        ${tbl('replace', 'Parts to replace', PC, g.summary.replace.map(prow), 'No components marked Replace.')}
        ${tbl('repair', 'Parts to repair', PC, g.summary.repair.map(prow), 'No components marked Repair.')}
        ${tbl('shims', 'Shim packs to replace', ['Item', 'Location', 'Qty', 'From'], g.summary.shims.map(x => [x.desc, x.loc, q(x.qty), x.src]), 'No shim packs marked Replace.')}
        ${tbl('totals', 'Totals by type', ['Type', 'Group', 'Qty'], g.summary.totals.map(t => [t.type, t.cat, q(t.qty)]), 'No bearings, seals, gaskets or shim packs to replace.')}
      </section>`).join('')}
      <section class="card" id="partsRoll"><div class="card-head"><h2>Job roll-up</h2><span class="muted small">All ${d.gearboxes.length} gearbox${d.gearboxes.length === 1 ? '' : 'es'}</span></div>
        ${tbl('rolltotals', 'Totals by type, all gearboxes', ['Type', 'Group', 'Qty'], d.roll.totals.map(t => [t.type, t.cat, q(t.qty)]), 'No bearings, seals, gaskets or shim packs to replace.')}
        ${tbl('rolllines', 'All parts to replace (same part merged)', ['Part / description', 'Part no.', 'Qty', 'Gearboxes'], d.roll.lines.map(l => [l.desc + (l.type ? ` (${l.type})` : ''), l.pn, q(l.qty), l.where.join(', ')]), 'Nothing to replace.')}
      </section>`;
    $('#partsDlBtn').onclick = () => downloadParts(job, customer);
  }

  /* ---------- export ---------- */
  /* Rev 1.6.1: where each photo of a form belongs. Section scope `${key}:<section id>`, component scope `${key}:<component id>`
     (printed with its section), teardown L `${key}:L`, assembly `${key}:more`. Unknown scopes (e.g. after a type change)
     go to the catch-all group: L for the Teardown Evaluation, "Additional photos" for the Assembly Verification. */
  const MORE_TITLE = 'Additional photos', hasPhotoBlock = form => form.sections.some(s => s.blocks.some(b => b.type === 'photos'));
  function photoPlan(job, key) {
    const form = fdef(job, key), groups = [], known = {};
    let catchAll = null;
    for (const s of form.sections) {
      const g = {secId: s.id, title: s.title, after: s.pages ? s.pages[1] : null, photos: []};
      known[`${key}:${s.id}`] = {g, sub: ''};
      for (const b of s.blocks) {
        if (b.type === 'component') known[`${key}:${b.id}`] = {g, sub: b.name, comp: b.id};
        if (b.type === 'photos') { known[`${key}:${b.scope}`] = {g, sub: ''}; catchAll = g; g.empty = 'No teardown photos were added.'; }
      }
      groups.push(g);
    }
    if (!catchAll) { catchAll = {secId: 'more', title: MORE_TITLE, after: form.templatePages || null, photos: []}; known[`${key}:more`] = {g: catchAll, sub: ''}; groups.push(catchAll); }
    return {groups, known, catchAll};
  }
  function photoPlace(job, key, scope, label) {   // -> {group, sub}
    const pl = photoPlan(job, key), k = pl.known[scope];
    return k ? {group: k.g, sub: k.sub, comp: k.comp} : {group: pl.catchAll, sub: label || ''};
  }
  async function photoGroups(job, key) {
    const pl = photoPlan(job, key), all = (await DB.byJob('photos', job.id)).filter(p => p.scope.startsWith(key + ':')).sort((a, b) => a.createdAt - b.createdAt);
    for (const p of all) { const k = pl.known[p.scope], g = k ? k.g : pl.catchAll; g.photos.push({blob: p.blob, w: p.w, h: p.h, caption: p.caption, sub: k ? k.sub : (p.label || '')}); }
    return pl.groups.filter(g => g.photos.length || g.empty).map(g => ({title: g.title, after: g.after, photos: g.photos, empty: g.empty}));
  }
  async function photosFor(job) {   // job photos (shared by all forms), printed at the end
    return (await DB.byJob('photos', job.id)).filter(p => p.scope === 'job').sort((a, b) => a.createdAt - b.createdAt).map(p => ({blob: p.blob, w: p.w, h: p.h, caption: p.caption}));
  }
  async function exportForm(job, key) {
    await flushSave();
    const form = fdef(job, key), st = job.forms[key];
    if (st.status === 'completed') {
      const docs = (await DB.byJob('docs', job.id)).filter(d => d.formKey === key).sort((a, b) => b.createdAt - a.createdAt);
      if (docs[0]) return fileReady(docs[0].blob, docs[0].filename, `Final PDF (rev ${docs[0].revision})`);
    }
    toast('Building PDF…', 8000);
    try {
      const c = ctx(job, current.customer, parseKey(key).gid);
      const out = await PdfExport.build({form, job: c, state: st, gearbox: pdfGb(c), photos: await photosFor(job, key), groups: await photoGroups(job, key), final: null});
      await fileReady(new Blob([out.bytes], {type: 'application/pdf'}), PdfExport.filename(c, form), 'Draft PDF ready (fields editable)');
    } catch (e) { console.error(e); modal(`<h2>PDF failed</h2><p>${esc(e.message)}</p>`, [{label: 'Close', value: 'cancel'}]); }
  }
  async function combinedPdf(job, customer) {
    await flushSave(); toast('Building combined PDF…', 10000);
    try {
      const c = ctx(job, customer), docs = await DB.byJob('docs', job.id), parts = [], gbs = activeGbs(job), fs = formStates(job);
      // grouped per gearbox (Teardown Evaluation before Assembly Verification); every group starts with a gearbox cover page (Rev 1.5.1: also for 1 gearbox)
      for (const g of gbs) {
        const mine = fs.filter(f => f.gid === g.id), gc = ctx(job, customer, g.id), m = gbMeta(job, g.id);
        parts.push({divider: {title: `${m.label}  -  ${m.typeLabel}`, sub: `Work order ${c.wo || '-'}   |   Customer: ${c.customer || '-'}`,
          lines: [`${m.planetary ? 'Gearbox type' : 'Reduction type'}: ${m.typeLabel} (${m.stagesText})`, `Manufacturer: ${gc.manufacturer || '-'}`, `Model: ${gc.model || '-'}`, `Serial number: ${gc.serial || '-'}`, '',
                  ...(mine.length ? mine.map(f => `${f.title}: ${f.st.status === 'completed' ? `Completed (final rev ${f.st.revision})` : `Draft (rev ${f.st.revision}, not finalized)`}`) : ['No forms for this gearbox'])]}});
        for (const f of mine) {
          const fin = docs.filter(d => d.formKey === f.key).sort((a, b) => b.revision - a.revision || b.createdAt - a.createdAt)[0];
          if (f.st.status === 'completed' && fin) parts.push({pdf: new Uint8Array(await fin.blob.arrayBuffer()), dropLast: fin.partsPages || 0});   // its own Parts Summary is replaced by the current one below
          else parts.push((await PdfExport.build({form: f.def, job: gc, state: f.st, gearbox: pdfGb(gc), photos: await photosFor(job, f.key), groups: await photoGroups(job, f.key), final: null, flatten: true})).bytes);
          if (f.base === 'teardown') parts.push(await PdfExport.partsPdf(partsData(job, customer, [g.id], false)));   // Rev 1.7
        }
      }
      if (!fs.length) { toast('This job has no forms'); return null; }
      if (fs.some(f => f.base === 'teardown')) parts.push(await PdfExport.partsPdf(partsRollOnly(job, customer)));   // job roll-up across all gearboxes
      const bytes = await PdfExport.combine(parts, `WO ${c.wo} - ${c.customer}`);
      return {blob: new Blob([bytes], {type: 'application/pdf'}), filename: `WO-${PdfExport.safe(c.wo)}_${PdfExport.safe(c.customer)}_Combined.pdf`, bytes};
    } catch (e) { console.error(e); modal(`<h2>PDF failed</h2><p>${esc(e.message)}</p>`, [{label: 'Close', value: 'cancel'}]); return null; }
  }
  async function exportJobZip(job, customer) {
    const c = ctx(job, customer), S = PdfExport.safe, folder = `WO-${S(c.wo)}_${S(c.customer)}`;
    const comb = await combinedPdf(job, customer); if (!comb) return;
    toast('Building zip…', 10000);
    const files = {}, store = {level: 0}, u8 = async b => new Uint8Array(await b.arrayBuffer());
    // Teardown Evaluation first: sort by form order, then revision; numeric prefixes keep that order in file browsers.
    const docs = (await DB.byJob('docs', job.id)).sort((a, b) => formIdx(job, a.formKey) - formIdx(job, b.formKey) || a.revision - b.revision || a.createdAt - b.createdAt);
    // One subfolder per gearbox ("Gearbox 1 of 2 - Triple - SN 123/" with its PDFs and Photos/), also for single-gearbox jobs (Rev 1.5.1).
    // Job photos stay in Photos/. Documents of a removed gearbox go to "Removed gearboxes/".
    const gbs = activeGbs(job);
    const gdir = gid => { const m = gbMeta(job, gid); return m.removed ? `Removed gearboxes/${m.label}` : gbFolder(m); };
    const docDir = d => { const g = gdir(parseKey(d.formKey).gid); return g ? `${folder}/${g}` : `${folder}/Saved documents`; };
    const cnt = {}; docs.forEach(d => { const k = docDir(d); cnt[k] = (cnt[k] || 0) + 1; d._zipName = `${String(cnt[k]).padStart(2, '0')}_${d.filename}`; d._zipPath = `${k}/${d._zipName}`; });
    for (const d of docs) files[d._zipPath] = [await u8(d.blob), store];
    files[`${folder}/${comb.filename}`] = [new Uint8Array(comb.bytes), store];
    { const pd = partsData(job, customer, null, true); files[`${folder}/${partsName(c, 'csv')}`] = [fflate.strToU8(Parts.csv(pd.meta, pd.gearboxes, pd.roll)), store];   // Rev 1.7
      files[`${folder}/${partsName(c, 'pdf')}`] = [new Uint8Array(await PdfExport.partsPdf(pd)), store]; }
    // Rev 1.6.1: photos in report order (job photos, then per form: section by section); file names start with the section, e.g. 03_Teardown-C_Oil-condition_<caption>.jpg
    const place = p => {
      if (p.scope === 'job') return null;
      const key = p.scope.slice(0, p.scope.lastIndexOf(':'));
      try { const f = fdef(job, key); if (!f) return null; const pl = photoPlan(job, key), k = pl.known[p.scope], g = k ? k.g : pl.catchAll;
        const tok = (/^([A-Z0-9]+)\./.exec(g.title) || [])[1];
        return {key, f, g, idx: pl.groups.indexOf(g), sub: k ? k.sub : (p.label || ''), prefix: `${f.fileTitle.split('-')[0]}-${tok || g.title}`, name: tok ? g.title.replace(/^[A-Z0-9]+\.\s*/, '') : ''};
      } catch (e) { return null; }
    };
    const photos = (await DB.byJob('photos', job.id)).map(p => ({p, pl: place(p)})).sort((a, b) => {
      const ra = a.p.scope === 'job' ? -1 : formIdx(job, a.p.scope.split(':')[0]), rb = b.p.scope === 'job' ? -1 : formIdx(job, b.p.scope.split(':')[0]);
      return ra - rb || (a.pl ? a.pl.idx : 999) - (b.pl ? b.pl.idx : 999) || a.p.createdAt - b.p.createdAt;
    }), capLines = [];
    const pcnt = {};
    for (const {p, pl} of photos) {
      const gid = p.scope === 'job' ? null : parseKey(p.scope.split(':')[0]).gid, g = gid ? gdir(gid) : '', dir = g ? `${folder}/${g}/Photos` : `${folder}/Photos`;
      pcnt[dir] = (pcnt[dir] || 0) + 1;
      const parts = p.scope === 'job' ? ['Job'] : pl ? [pl.prefix, pl.sub || pl.name] : [p.label];
      const name = `${String(pcnt[dir]).padStart(2, '0')}_${parts.filter(Boolean).map(S).join('_')}${p.caption ? '_' + S(p.caption) : ''}.jpg`, rel = dir.slice(folder.length + 1) + '/' + name;
      files[`${dir}/${name}`] = [await u8(p.blob), store];
      capLines.push(`${rel}\t${p.scope === 'job' ? 'Job photo' : `${gbMeta(job, gid).label} / ${titleOf(p.scope.split(':')[0])} / ${pl ? pl.g.title + (pl.sub ? ' / ' + pl.sub : '') : p.label}`}\t${p.caption || ''}`);
    }
    const summary = [`Ram-Gear Manufacturing Incorporated – job folder`, `Customer: ${c.customer}`, `Work order: ${c.wo}`, `Date: ${c.date}`, `Gearboxes: ${gbs.length}`, `Created on tablet: ${job.tabletId || '-'}`, `Created by: ${job.createdBy || '-'}`,
      customer.contact || customer.phone || customer.email ? `Contact: ${[customer.contact, Phone.format(customer.phone), customer.email].filter(Boolean).join(' / ')}` : '', '',
      ...gbs.flatMap(g => { const m = gbMeta(job, g.id), gi = gbInfo(job, g.id); return [`${m.label}: ${m.typeLabel} (${m.stagesText}, locked)  – folder "${gbFolder(m)}"`,
        `  Gearbox: ${[gi.manufacturer, gi.model].filter(Boolean).join(' ') || '-'}  S/N ${gi.serial || '-'}`,
        ...formStates(job).filter(f => f.gid === g.id).map(f => { const st = f.st; return `  ${f.title}: ${st.status === 'completed' ? `Completed rev ${st.revision} ${fmtDate(st.completedAt)} by ${st.signedBy}, finalized by ${st.finalizedBy || '-'}, Inspected on: ${st.inspectedOn || '-'}` : `Draft (rev ${st.revision}), Tablet used for inspection: ${st.tabletUsed ?? TABLET}`}`; }), '']; }),
      'Saved documents:', ...(docs.length ? docs.map(d => `  ${d._zipPath.slice(folder.length + 1)}  (rev ${d.revision}, ${fmtDate(d.createdAt)}, signed by ${d.signedBy}${d.inspectedOn ? `, inspected on ${d.inspectedOn}` : ''})`) : ['  none']),
      '', `Photos: ${photos.length}`, '', `Exported ${new Date().toString()} from ${TABLET || 'this device'} by ${userName() || '-'}`, `App: Industrial Gearbox Data ${REV_LABEL}`].join('\r\n');
    files[`${folder}/job-summary.txt`] = fflate.strToU8(summary);
    if (capLines.length) files[`${folder}/Photos/captions.tsv`] = fflate.strToU8('file\tsection\tcaption\r\n' + capLines.join('\r\n'));
    const zip = fflate.zipSync(files, {level: 6});
    await fileReady(new Blob([zip], {type: 'application/zip'}), `${folder}_Job.zip`, 'Job folder zip ready', false);
  }

  /* ---------- backup / restore ---------- */
  const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const dataURLToBlob = async d => (await fetch(d)).blob();
  /* Backup file name sorts by date and time and says which revision and tablet made it:
     ramgear-backup-2026-09-30-0858-Rev1.3-ShopTablet1.json (local time, 24 h). Restore accepts any file name. */
  function backupName(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    const tab = String(TABLET || '').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '').replace(/^[.-]+/, '').slice(0, 40);
    return `ramgear-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-Rev${String(REV).replace(/[^A-Za-z0-9.]/g, '')}${tab ? '-' + tab : ''}.json`;
  }
  // "Save as…" (choose folder and name): Chrome/Edge File System Access API; other browsers use Download/Share
  const CAN_SAVE_AS = typeof window.showSaveFilePicker === 'function';
  async function saveAs(blob, name) {
    try {
      const h = await window.showSaveFilePicker({suggestedName: name, types: [{description: 'Ram-Gear backup (JSON)', accept: {'application/json': ['.json']}}]});
      const w = await h.createWritable(); await w.write(blob); await w.close(); toast(`Saved ${h.name || name}`, 3000); return 'saved';
    } catch (e) {
      if (e.name === 'AbortError') { toast('Not saved'); return 'cancelled'; }
      console.warn('save as failed, downloading', e); download(blob, name); return 'downloaded';
    }
  }
  async function backup() {
    toast('Preparing backup…', 5000);
    const customers = await DB.all('customers'), jobs = await DB.all('jobs'), photos = await DB.all('photos'), docs = await DB.all('docs');
    const users = await Auth.all(), auditLog = await DB.all('audit');   // users: salted hashes only
    const meta = await DB.updateMeta(() => ({lastBackupAt: Date.now(), snoozeUntil: 0}));   // a backup file is being generated
    const backupSettings = {lastBackupAt: meta.lastBackupAt, lastChangeAt: meta.lastChangeAt, intervalDays: meta.intervalDays};
    const data = {app: 'ramgear-jobs', version: 3, exportedAt: new Date(meta.lastBackupAt).toISOString(), exportedBy: userName(), appRev: REV, appBuild: BUILD, users, audit: auditLog, backupSettings, device: {tabletId: TABLET}, customers, jobs,
      photos: await Promise.all(photos.map(async p => ({...p, blob: await blobToDataURL(p.blob), thumb: p.thumb ? await blobToDataURL(p.thumb) : null}))),
      docs: await Promise.all(docs.map(async d => ({...d, blob: await blobToDataURL(d.blob)})))};
    const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
    const name = backupName();
    refreshBackupInfo();
    const v = await modal(`<h2>Backup ready</h2><p>${customers.length} customers, ${jobs.length} jobs, ${photos.length} photos, ${docs.length} saved PDFs · ${(blob.size / 1048576).toFixed(1)} MB</p><p class="muted small">Save it to Files / Drive or send it to yourself. Restore it on any device with this app.</p>`,
      [{label: 'Cancel', value: 'cancel'}, ...(CAN_SAVE_AS ? [{label: 'Save as…', value: 'saveas'}] : []), ...shareBtns()]);
    if (v === 'share') shareOrDownload(blob, name); else if (v === 'dl') download(blob, name); else if (v === 'saveas') saveAs(blob, name);
  }
  $('#fileRestore').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'ramgear-jobs' || !Array.isArray(data.jobs)) throw new Error('Not a Ram Gear backup file');
      const customers = data.customers || [];
      for (const j of data.jobs) if (DB.migrateJob(j) && !customers.some(c => c.id === 'unassigned')) customers.push(DB.unassigned());   // v1 backups
      const existing = new Set((await DB.all('jobs')).map(j => j.id)), clash = data.jobs.filter(j => existing.has(j.id)).length;
      if (!await confirmBox('Restore backup?', `${customers.length} customers, ${data.jobs.length} jobs, ${(data.photos || []).length} photos, ${(data.docs || []).length} saved PDFs from ${esc(data.exportedAt)}.${clash ? ` <b>${clash} job(s) already on this device will be replaced</b> by the backup copy.` : ''} Other customers and jobs on this device are kept.${Array.isArray(data.users) && data.users.length ? ` The backup's ${data.users.length} user account(s) are restored; accounts with the same username are replaced by the backup copy (including their password/PIN).` : data.admin ? ` The backup's admin account (<b>${esc(data.admin.name)}</b>) and its PIN will replace the matching user's password/PIN.` : ''}`, 'Restore')) return;
      const recovery = !USER;   // only reachable from the login screen when this device has data but no user accounts at all
      if (recovery) { const h = await DB.health(); if (h.users > 0) throw new Error('Sign in first: this device already has user accounts.'); if (!Array.isArray(data.users) && !data.admin) throw new Error('This backup has no user accounts.'); }
      else if (!await requireAdmin('Restore backup (overwrites matching jobs)', `${f.name} – ${data.jobs.length} jobs from ${data.exportedAt}`)) return;
      for (const c of customers) await DB.put('customers', c);
      for (const j of data.jobs) { if (existing.has(j.id)) await DB.deleteJob(j.id); await DB.put('jobs', j); }
      for (const p of data.photos || []) await DB.put('photos', {...p, blob: await dataURLToBlob(p.blob), thumb: p.thumb ? await dataURLToBlob(p.thumb) : null});
      for (const d of data.docs || []) await DB.put('docs', {...d, blob: await dataURLToBlob(d.blob)});
      for (const a of data.audit || []) await DB.put('audit', a);
      if (data.device && data.device.tabletId && !TABLET) await saveTablet(data.device.tabletId);   // never rename a device that already has an ID
      const bs = data.backupSettings;
      if (bs) await DB.updateMeta(cur => ({   // never move lastBackupAt back to an older date
        lastBackupAt: Math.max(cur.lastBackupAt || 0, +bs.lastBackupAt || 0),
        intervalDays: INTERVALS.includes(+bs.intervalDays) ? +bs.intervalDays : cur.intervalDays}));
      // users: merge by username (backup copy wins); older backups carry a single admin PIN record instead
      const bUsers = Array.isArray(data.users) ? data.users.filter(u => u && u.username && u.hash && u.salt)
        : data.admin && data.admin.hash && data.admin.salt ? [{id: DB.uid(), username: Auth.norm(data.admin.name), displayName: data.admin.name, role: 'admin', disabled: false,
            createdAt: data.admin.createdAt || Date.now(), updatedAt: Date.now(), createdBy: 'restored admin PIN', lastLoginAt: 0, algo: data.admin.algo, iterations: data.admin.iterations, salt: data.admin.salt, hash: data.admin.hash}] : [];
      for (const bu of bUsers) {
        const ex = await Auth.byUsername(bu.username);
        if (ex && ex.id !== bu.id) await DB.del('users', ex.id);
        await DB.put('users', {...bu, id: ex && ex.id !== bu.id && USER && ex.id === USER.id ? ex.id : bu.id});
      }
      if (bUsers.length) await audit('User accounts restored from backup', bUsers.map(u => u.username).join(', ') + (recovery ? ' (recovery from login screen: no accounts on this device)' : ''), 'done');
      if (recovery) { toast('Backup restored – sign in'); setTimeout(() => location.reload(), 600); return; }
      const me = await Auth.byUsername(USER.username);
      if (me && !me.disabled) { USER = me; Auth.setSession({userId: me.id, lastActive: Date.now()}); renderUserBox(); }
      toast('Backup restored');
      if (!me || me.disabled || !(await activeAdmins(await Auth.all())).length) { await endSession('restore'); const u = await showLogin('Backup restored. Sign in again.'); await afterLogin(u, null); }
      route();
    } catch (err) { modal(`<h2>Restore failed</h2><p>${esc(err.message)}</p>`, [{label: 'Close', value: 'cancel'}]); }
  });

  /* ---------- revision / about ---------- */
  $('#aboutBtn').textContent = `Rev ${REV}`; $('#loginRev').textContent = REV_LABEL;
  $('#aboutBtn').onclick = () => modal(`<h2>About</h2><p><b>Industrial Gearbox Data</b><br>Ram-Gear Manufacturing Incorporated</p>
    <div class="details"><div><div class="muted small">Revision</div><div id="aboutRev"><b>${esc(REV_LABEL)}</b></div></div><div><div class="muted small">Tablet ID</div><div>${esc(TABLET || '—')}</div></div>
    <div><div class="muted small">Signed in as</div><div>${esc(USER ? `${USER.displayName} (${ROLE_LABEL[USER.role]})` : '—')}</div></div></div>
    <p class="muted small">Works offline. All data stays on this tablet. See CHANGELOG.md for what changed in each revision.</p>`, [{label: 'Close', value: 'cancel'}]);
  /* ---------- boot ---------- */
  async function boot() {
    FORMS = await (await fetch('forms.json')).json();
    for (const f of FORMS.forms) {   // forms.json v2: one definition per form and reduction type (id 'assembly@3')
      f.id = f.id || `${f.key}@${f.stages || 2}`;
      FORM_BY_ID[f.id] = f; KINDS[f.id] = PdfExport.fieldKinds(f); REQS[f.id] = [];
      if (!BASES.includes(f.key)) BASES.push(f.key);
      if (!BASE_DEF[f.key] || f.stages === 2) BASE_DEF[f.key] = f;
      for (const s of f.sections) for (const b of s.blocks) {
        if (b.req) REQS[f.id].push({req: b.req, section: s.title});
        if (b.type === 'table') for (const r of b.rows) if (r.req) REQS[f.id].push({req: r.req, section: s.title});
        for (const x of b.type === 'row' ? b.fields : [b]) if (x.calc && x.calc.planetRatio) (CALCS[f.id] = CALCS[f.id] || []).push({name: x.name, ring: x.calc.planetRatio[0], sun: x.calc.planetRatio[1]});
      }
    }
    window.RG = {FORMS, REQS, CALCS, normalizeJob, gbMeta, DB, Admin, Auth, Camera, Cloud, toast, whoami: () => USER && {username: USER.username, role: USER.role, name: USER.displayName}};  // for debugging/tests
    /* Start-up decision. Any storage error shows an error screen – it is never treated as "no admin yet".
       Setup runs only when the device has no users, no legacy admin PIN, no customers and no jobs. */
    let h, migrated = null;
    try {
      let blocked = null;
      const onBlocked = () => { blocked = setTimeout(() => storageError(new Error('Another tab with an older version of this app is blocking the update. Close the other tab.')), 4000); };
      window.addEventListener('rg-db-blocked', onBlocked, {once: true});
      h = await DB.health(); clearTimeout(blocked);
      await loadTablet(); await refreshIdle();
      if (!h.users && h.legacyAdmin) {
        migrated = await Auth.migrate();   // pre-login admin PIN -> first Admin user
        if (migrated) { await audit('Admin PIN migrated to user account', `${migrated.displayName} (username "${migrated.username}")`, 'done', migrated.displayName); await DB.put('settings', {key: 'accounts', createdAt: Date.now(), by: 'admin PIN migration'}); }
        h = await DB.health();
      }
    } catch (e) { console.error('storage', e); storageError(e); return; }
    window.RG.health = h; storageStatus(false);
    await Cloud.init({tablet: () => TABLET, user: () => USER, audit: (a, i, r) => audit(a, i, r), onRemote});
    Cloud.onStatus(renderCloudChip);
    $('#cloudChip').onclick = async () => { if (isAdmin()) { location.hash = '#/settings'; return; } const r = await Cloud.sync('manual'); toast(r.error ? `Sync problem: ${r.error}` : 'Synced', 3500); };
    if (!h.users && !h.hadAccounts) await firstRunSetup();   // new device, or data from the first version (before accounts/admin PIN existed)
    else if (!h.users) {   // data but no accounts (should not happen): never re-run setup; offer restore of accounts from a backup
      const u = await showLogin('This device has job data but no user accounts, so setup will not run again. Restore a backup that includes the user accounts, then sign in.', '', true); await afterLogin(u, null);
    }
    else if (!await resumeSession()) { const u = await showLogin(migrated ? `User accounts are now enabled. ${migrated.displayName}: sign in with your name and your existing admin PIN.` : ''); await afterLogin(u, null); }
    await ensureTablet();
    const meta = await DB.getMeta();
    if (!meta.lastChangeAt) {   // installs from before the reminder existed: treat existing data as unbacked-up changes
      const t = [...await DB.all('customers'), ...await DB.all('jobs')].reduce((m, x) => Math.max(m, x.updatedAt || x.createdAt || 0), 0);
      if (t) await DB.updateMeta(() => ({lastChangeAt: t}));
    }
    route();
  }
  boot();
})();
