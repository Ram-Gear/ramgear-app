/* Local (per-device) user accounts + session. No self sign-up: only an Admin creates users.
   Secrets (password or PIN) are stored only as salted PBKDF2-SHA-256 hashes (Admin.derive). All offline. */
const Auth = (() => {
  const ITER = 250000, MAX_FAILS = 5, LOCK_MS = 30000, SKEY = 'rg-session';
  const b64 = u8 => btoa(String.fromCharCode.apply(null, Array.from(u8)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const norm = u => String(u || '').trim().toLowerCase();
  /* A secret is either a 4–8 digit PIN or a password of at least 8 characters. */
  const validSecret = s => /^\d{4,8}$/.test(s || '') || (typeof s === 'string' && s.length >= 8 && !/^\d+$/.test(s));
  const secretRule = 'Use a 4–8 digit PIN or a password of at least 8 characters.';
  async function hashSecret(secret) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return {algo: 'PBKDF2-SHA-256', iterations: ITER, salt: b64(salt), hash: b64(await Admin.derive(secret, salt, ITER))};
  }
  async function verify(u, secret) {
    if (!u || !u.hash || typeof secret !== 'string' || !secret) return false;
    const h = await Admin.derive(secret, unb64(u.salt), u.iterations), ref = unb64(u.hash);
    let diff = h.length ^ ref.length;
    for (let i = 0; i < Math.min(h.length, ref.length); i++) diff |= h[i] ^ ref[i];   // constant-time compare
    return diff === 0;
  }
  const all = () => DB.all('users');
  const byUsername = async name => (await all()).find(u => u.username === norm(name)) || null;
  async function create({username, displayName, role, secret, createdBy}) {
    const u = {id: DB.uid(), username: norm(username), displayName: displayName.trim(), role: role === 'admin' ? 'admin' : 'technician',
      disabled: false, createdAt: Date.now(), updatedAt: Date.now(), createdBy: createdBy || '', lastLoginAt: 0, ...(await hashSecret(secret))};
    await DB.put('users', u); return u;
  }
  async function setSecret(u, secret) { Object.assign(u, await hashSecret(secret), {updatedAt: Date.now(), secretChangedAt: Date.now()}); await DB.put('users', u); return u; }
  /* Migration: the pre-login admin account (settings 'admin': name + PIN hash) becomes the first Admin user.
     Same salt/hash/iterations, so the admin signs in with their existing name and PIN. */
  async function migrate() {
    if ((await all()).length) return null;
    const a = await DB.get('settings', 'admin'); if (!a || !a.hash) return null;
    const u = {id: DB.uid(), username: norm(a.name), displayName: a.name, role: 'admin', disabled: false, createdAt: a.createdAt || Date.now(), updatedAt: Date.now(),
      createdBy: 'migrated from admin PIN', lastLoginAt: 0, algo: a.algo, iterations: a.iterations, salt: a.salt, hash: a.hash};
    await DB.put('users', u); return u;
  }
  /* ---- failed-login rate limit (per device, persisted): 5 failures -> 30 s lockout ---- */
  async function lockState() { return (await DB.get('settings', 'loginLockout')) || {key: 'loginLockout', fails: 0, until: 0}; }
  async function login(username, secret) {
    const ls = await lockState(), now = Date.now();
    if (ls.until > now) return {ok: false, locked: ls.until - now};
    const u = await byUsername(username);
    const ok = u && !u.disabled && await verify(u, secret);
    if (!ok && u === null) await Admin.derive(secret || 'x', new Uint8Array(16), ITER);   // same cost whether or not the user exists
    if (ok) { await DB.put('settings', {key: 'loginLockout', fails: 0, until: 0}); u.lastLoginAt = now; await DB.put('users', u); return {ok: true, user: u}; }
    ls.fails = (ls.fails || 0) + 1;
    if (ls.fails >= MAX_FAILS) { ls.fails = 0; ls.until = now + LOCK_MS; await DB.put('settings', ls); return {ok: false, locked: LOCK_MS, justLocked: true, user: u}; }
    await DB.put('settings', ls); return {ok: false, left: MAX_FAILS - ls.fails, user: u, disabled: !!(u && u.disabled)};
  }
  /* ---- session: tab-scoped (sessionStorage); expires after the idle timeout even across reloads ---- */
  const getSession = () => { try { return JSON.parse(sessionStorage.getItem(SKEY)) || null; } catch (e) { return null; } };
  const setSession = s => s ? sessionStorage.setItem(SKEY, JSON.stringify(s)) : sessionStorage.removeItem(SKEY);
  async function idleMinutes() { const s = await DB.get('settings', 'session'); return s && s.idleMinutes > 0 ? s.idleMinutes : 15; }
  return {all, byUsername, create, setSecret, verify, migrate, login, lockState, validSecret, secretRule, norm, getSession, setSession, idleMinutes, MAX_FAILS, LOCK_MS};
})();
