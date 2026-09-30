/* IndexedDB storage (v4): customers > jobs; settings (admin PIN hash) and audit log; photos (blobs) and docs (saved final PDFs) keyed by job. All on-device. */
const DB = (() => {
  const NAME = 'ramgear', VER = 4;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = e => {
        const db = r.result, t = r.transaction;
        if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', {keyPath: 'id'});
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', {keyPath: 'key'});   // admin hash, lockout
        if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', {keyPath: 'id'});   // v4: local user accounts (hashes only)
        if (!db.objectStoreNames.contains('audit')) db.createObjectStore('audit', {keyPath: 'id'});
        const jobs = db.objectStoreNames.contains('jobs') ? t.objectStore('jobs') : db.createObjectStore('jobs', {keyPath: 'id'});
        if (!jobs.indexNames.contains('customerId')) jobs.createIndex('customerId', 'customerId');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', {keyPath: 'id'}).createIndex('jobId', 'jobId');
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', {keyPath: 'id'}).createIndex('jobId', 'jobId');
        if (e.oldVersion > 0 && e.oldVersion < 2) {
          // v1 had jobs only: move every existing job into an "Unassigned" customer.
          let moved = 0;
          jobs.openCursor().onsuccess = ev => {
            const c = ev.target.result;
            if (c) { const j = migrateJob(c.value); if (j) { c.update(j); moved++; } c.continue(); }
            else if (moved) t.objectStore('customers').put(unassigned());
          };
        }
      };
      r.onsuccess = () => {
        const db = r.result;
        // A newer version of the app (another tab, or after an update) wants to upgrade: release the connection so it is not blocked.
        db.onversionchange = () => { db.close(); dbp = null; window.dispatchEvent(new CustomEvent('rg-db-versionchange')); };
        res(db);
      };
      r.onerror = () => { dbp = null; rej(r.error || new Error('IndexedDB open failed')); };
      r.onblocked = () => { console.warn('DB upgrade blocked by another open tab'); window.dispatchEvent(new CustomEvent('rg-db-blocked')); };
    });
    return dbp;
  }
  /* One read-only look at what is stored, used at start-up. Throws on any storage error (never treated as "empty"). */
  async function health() {
    const db = await open(), stores = ['users', 'customers', 'jobs', 'settings'];
    for (const st of stores) if (!db.objectStoreNames.contains(st)) throw new Error(`Storage is missing the "${st}" store`);
    return new Promise((res, rej) => {
      const t = db.transaction(stores, 'readonly'), out = {};
      for (const st of ['users', 'customers', 'jobs']) { const q = t.objectStore(st).count(); q.onsuccess = () => { out[st] = q.result; }; }
      const a = t.objectStore('settings').get('admin'); a.onsuccess = () => { out.legacyAdmin = !!(a.result && a.result.hash); };
      const m = t.objectStore('settings').get('accounts'); m.onsuccess = () => { if (m.result) out.hadAccounts = true; };
      // jobs made by Rev 1.0+ carry a createdBy stamp, so accounts existed on this device even without the marker
      const c = t.objectStore('jobs').openCursor(); c.onsuccess = () => { const cur = c.result; out.hadAccounts = out.hadAccounts || false; if (!cur) return; if (cur.value.createdBy) out.hadAccounts = true; else cur.continue(); };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Storage read aborted'));
    });
  }
  function unassigned() {
    return {id: 'unassigned', name: 'Unassigned', contact: '', phone: '', email: '', address: '',
            notes: 'Jobs created before customer files existed. Open each job and use "Move to customer".', createdAt: Date.now(), updatedAt: Date.now()};
  }
  function migrateJob(j) {
    if (j.customerId) return null;
    j.customerId = 'unassigned';
    if (j.customer) j.legacyCustomer = j.customer;
    delete j.customer;
    j.date = j.date || new Date(j.createdAt || Date.now()).toISOString().slice(0, 10);
    return j;
  }
  function p(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode); let out;
      Promise.resolve(fn(t.objectStore(store))).then(v => { out = v; });
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  /* Backup reminder bookkeeping: settings record 'backup' = {lastBackupAt, lastChangeAt, intervalDays, snoozeUntil}.
     Any write to a data store stamps lastChangeAt. Read-modify-write happens inside one transaction, so it is atomic. */
  const DATA = new Set(['customers', 'jobs', 'photos', 'docs']);
  const META_DEFAULT = {key: 'backup', lastBackupAt: 0, lastChangeAt: 0, intervalDays: 3, snoozeUntil: 0};
  const updateMeta = fn => tx('settings', 'readwrite', async s => {
    const cur = {...META_DEFAULT, ...(await p(s.get('backup')) || {})}, next = {...cur, ...fn(cur), key: 'backup'};
    await p(s.put(next)); return next;
  });
  const touch = store => {
    if (DATA.has(store) || store === 'audit') window.dispatchEvent(new CustomEvent('rg-local-change', {detail: {store}}));   // cloud sync picks it up
    return DATA.has(store) ? updateMeta(() => ({lastChangeAt: Date.now()})) : null;
  };
  const api = {
    async put(store, obj) { const r = await tx(store, 'readwrite', s => p(s.put(obj))); await touch(store); return r; },
    getMeta: async () => ({...META_DEFAULT, ...(await api.get('settings', 'backup') || {})}),
    updateMeta,
    get: (store, id) => tx(store, 'readonly', s => p(s.get(id))),
    async del(store, id) { const r = await tx(store, 'readwrite', s => p(s.delete(id))); await touch(store); return r; },
    all: (store) => tx(store, 'readonly', s => p(s.getAll())),
    byJob: (store, jobId) => tx(store, 'readonly', s => p(s.index('jobId').getAll(jobId))),
    byCustomer: (customerId) => tx('jobs', 'readonly', s => p(s.index('customerId').getAll(customerId))),
    async deleteJob(jobId) {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction(['jobs', 'photos', 'docs'], 'readwrite');
        t.objectStore('jobs').delete(jobId);
        for (const st of ['photos', 'docs']) {
          const idx = t.objectStore(st).index('jobId').openKeyCursor(IDBKeyRange.only(jobId));
          idx.onsuccess = () => { const c = idx.result; if (c) { t.objectStore(st).delete(c.primaryKey); c.continue(); } };
        }
        t.oncomplete = () => touch('jobs').then(res, rej); t.onerror = () => rej(t.error);
      });
    },
    async deleteCustomer(customerId) {
      for (const j of await api.byCustomer(customerId)) await api.deleteJob(j.id);
      await api.del('customers', customerId);
    },
    migrateJob, unassigned, health,
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  };
  return api;
})();
