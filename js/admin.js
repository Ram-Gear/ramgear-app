/* Local (per-device) admin account. Only a salted PBKDF2-SHA-256 hash of the PIN is stored - never the PIN. */
const Admin = (() => {
  const ITER = 250000, MAX_FAILS = 5, LOCK_MS = 30000;
  const b64 = u8 => btoa(String.fromCharCode.apply(null, Array.from(u8)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(pin, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, key, 256));
  }
  const validPin = p => /^\d{4,8}$/.test(p || '');
  async function makeRecord(name, pin, prev) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(pin, salt, ITER);
    return {key: 'admin', name, algo: 'PBKDF2-SHA-256', iterations: ITER, salt: b64(salt), hash: b64(hash),
            createdAt: prev ? prev.createdAt : Date.now(), updatedAt: Date.now()};
  }
  async function verify(rec, pin) {
    if (!rec || !validPin(pin)) return false;
    const h = await derive(pin, unb64(rec.salt), rec.iterations), ref = unb64(rec.hash);
    let diff = h.length ^ ref.length;
    for (let i = 0; i < Math.min(h.length, ref.length); i++) diff |= h[i] ^ ref[i];   // constant-time compare
    return diff === 0;
  }
  const get = () => DB.get('settings', 'admin');
  async function lockState() { return (await DB.get('settings', 'lockout')) || {key: 'lockout', fails: 0, until: 0}; }
  /* Returns {ok} or {ok:false, locked:ms} or {ok:false, left:n}. Lockout is persisted so a reload does not reset it. */
  async function check(pin) {
    const rec = await get(), ls = await lockState(), now = Date.now();
    if (ls.until > now) return {ok: false, locked: ls.until - now};
    if (await verify(rec, pin)) { await DB.put('settings', {key: 'lockout', fails: 0, until: 0}); return {ok: true, admin: rec}; }
    ls.fails = (ls.fails || 0) + 1;
    if (ls.fails >= MAX_FAILS) { ls.fails = 0; ls.until = now + LOCK_MS; await DB.put('settings', ls); return {ok: false, locked: LOCK_MS, justLocked: true}; }
    await DB.put('settings', ls); return {ok: false, left: MAX_FAILS - ls.fails};
  }
  return {get, makeRecord, verify, check, validPin, lockState, MAX_FAILS, LOCK_MS};
})();
