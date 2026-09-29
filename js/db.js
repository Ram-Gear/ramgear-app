/* IndexedDB storage (v3): customers > jobs; settings (admin PIN hash) and audit log; photos (blobs) and docs (saved final PDFs) keyed by job. All on-device. */
const DB = (() => {
  const NAME = 'ramgear', VER = 3;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = e => {
        const db = r.result, t = r.transaction;
        if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', {keyPath: 'id'});
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', {keyPath: 'key'});   // admin hash, lockout
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
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => console.warn('DB upgrade blocked by another open tab');
    });
    return dbp;
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
  const api = {
    put: (store, obj) => tx(store, 'readwrite', s => p(s.put(obj))),
    get: (store, id) => tx(store, 'readonly', s => p(s.get(id))),
    del: (store, id) => tx(store, 'readwrite', s => p(s.delete(id))),
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
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    },
    async deleteCustomer(customerId) {
      for (const j of await api.byCustomer(customerId)) await api.deleteJob(j.id);
      await api.del('customers', customerId);
    },
    migrateJob, unassigned,
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  };
  return api;
})();
