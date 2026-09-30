// rg-admin: user administration for Industrial Gearbox Data (Rev 1.2).
// The service-role key exists only here (Supabase injects it into Edge Functions); the app never has it.
// Deploy with JWT verification OFF (the function checks the caller itself); set the secret RG_SETUP_CODE for the one-time bootstrap.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SETUP_CODE = Deno.env.get("RG_SETUP_CODE") || "";
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class Fail extends Error { constructor(msg: string, public status = 400) { super(msg); } }

const norm = (u: unknown) => String(u ?? "").trim().toLowerCase();
const hex = (s: string) => Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, "0")).join("");
// Same mapping as js/cloud.js: username -> sign-in e-mail, secret -> Supabase password (padded so 4-digit PINs meet the 6-char minimum).
const emailFor = (username: string) => `u${hex(norm(username))}@users.invalid`;
const cloudPw = (secret: string) => `rg1:${secret}`;
const validSecret = (s: unknown) => typeof s === "string" && (/^\d{4,8}$/.test(s) || (s.length >= 8 && !/^\d+$/.test(s)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2(secret: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
async function verifySecret(rec: any, secret: string) {
  if (!rec || !rec.hash || !rec.salt || !(rec.iterations > 0)) return false;
  const h = await pbkdf2(secret, unb64(rec.salt), rec.iterations), ref = unb64(rec.hash);
  let d = h.length ^ ref.length; for (let i = 0; i < Math.min(h.length, ref.length); i++) d |= h[i] ^ ref[i];
  return d === 0;
}
const cleanSecret = (s: any) => s && s.hash && s.salt ? { algo: String(s.algo || "PBKDF2-SHA-256"), iterations: Number(s.iterations), salt: String(s.salt), hash: String(s.hash) } : null;
function cleanUser(u: any) {
  const username = norm(u?.username), display_name = String(u?.displayName ?? "").trim();
  if (!u?.id || !username || !display_name) throw new Fail("user needs id, username and displayName");
  return { id: String(u.id), username, display_name, role: u.role === "admin" ? "admin" : "technician", disabled: !!u.disabled };
}
async function memberCount() {
  const { count, error } = await admin.from("members").select("id", { count: "exact", head: true });
  if (error) throw new Fail(error.message, 500); return count ?? 0;
}
async function callerMember(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Fail("sign in first", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Fail("session expired – sign in again", 401);
  const { data: m } = await admin.from("members").select("*").eq("auth_user_id", data.user.id).maybeSingle();
  if (!m || m.disabled) throw new Fail("not an active member", 403);
  return m;
}
async function setAuthAccount(member: any, password?: string) {
  // create or update the Supabase Auth account that belongs to a member
  const attrs: any = { app_metadata: { rg_member: member.id, role: member.role }, ban_duration: member.disabled ? "876000h" : "none" };
  if (password) attrs.password = cloudPw(password);
  if (member.auth_user_id) {
    const { error } = await admin.auth.admin.updateUserById(member.auth_user_id, { ...attrs, email: emailFor(member.username), email_confirm: true });
    if (error) throw new Fail(error.message, 500); return member.auth_user_id;
  }
  if (!password) return null;
  const { data, error } = await admin.auth.admin.createUser({ email: emailFor(member.username), email_confirm: true, ...attrs });
  if (error) throw new Fail(error.message, 500);
  return data.user.id;
}
async function upsertMember(row: any, password?: string) {
  const { data: existing } = await admin.from("members").select("*").eq("id", row.id).maybeSingle();
  const { data: clash } = await admin.from("members").select("id").eq("username", row.username).maybeSingle();
  if (clash && clash.id !== row.id) throw new Fail(`The username "${row.username}" is already used by another account.`, 409);
  const merged = { ...(existing || {}), ...row };
  const authId = await setAuthAccount(merged, password);
  const { data, error } = await admin.from("members").upsert({ ...row, auth_user_id: authId ?? merged.auth_user_id ?? null }).select().single();
  if (error) throw new Fail(error.message, 500);
  return data;
}
const pub = (m: any) => ({ id: m.id, username: m.username, displayName: m.display_name, role: m.role, disabled: m.disabled, cloud: !!m.auth_user_id });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (action === "status") return out({ ok: true, bootstrapped: (await memberCount()) > 0 });

    if (action === "bootstrap") {   // first Admin of a brand-new project; needs the one-time setup code
      if (!SETUP_CODE) throw new Fail("Setup code is not configured on the server (RG_SETUP_CODE).", 500);
      if (String(body.setupCode || "").trim() !== SETUP_CODE) throw new Fail("Wrong setup code.", 403);
      if ((await memberCount()) > 0) throw new Fail("This cloud already has an Admin. Sign in with that account instead.", 409);
      const u = cleanUser(body.user); if (u.role !== "admin") throw new Fail("the first account must be an Admin");
      if (!validSecret(body.password)) throw new Fail("invalid password/PIN");
      const secret = cleanSecret(body.user.secret); if (!secret || !(await verifySecret(secret, body.password))) throw new Fail("password does not match the account");
      const m = await upsertMember({ ...u, disabled: false, secret, created_by: "cloud bootstrap" }, body.password);
      return out({ ok: true, member: pub(m) });
    }

    if (action === "activate") {    // a user imported from a tablet (hash only) signs in to the cloud for the first time
      const username = norm(body.username), password = String(body.password || "");
      const { data: m } = await admin.from("members").select("*").eq("username", username).maybeSingle();
      if (!m || m.disabled || !(await verifySecret(m.secret, password))) throw new Fail("Wrong username or password/PIN.", 403);
      if (m.auth_user_id) return out({ ok: true, already: true });
      const authId = await setAuthAccount(m, password);
      await admin.from("members").update({ auth_user_id: authId }).eq("id", m.id);
      return out({ ok: true, activated: true });
    }

    const me = await callerMember(req);
    if (action === "set_own_password") {
      if (!validSecret(body.password)) throw new Fail("invalid password/PIN");
      const secret = cleanSecret(body.secret); if (!secret || !(await verifySecret(secret, body.password))) throw new Fail("hash does not match");
      await setAuthAccount(me, body.password);
      await admin.from("members").update({ secret }).eq("id", me.id);
      return out({ ok: true });
    }
    if (me.role !== "admin") throw new Fail("Admin only", 403);

    if (action === "upsert_user") {   // create / edit / disable / reset password of one user
      const u = cleanUser(body.user), secret = cleanSecret(body.user.secret), password = body.password ? String(body.password) : undefined;
      if (password && (!validSecret(password) || !secret || !(await verifySecret(secret, password)))) throw new Fail("invalid password/PIN");
      const { data: others } = await admin.from("members").select("id, role, disabled");
      const adminsLeft = (others || []).filter((x: any) => x.role === "admin" && !x.disabled && x.id !== u.id).length;
      if ((u.role !== "admin" || u.disabled) && adminsLeft === 0) throw new Fail("This is the only active Admin.", 409);
      const row: any = { ...u }; if (secret) row.secret = secret;
      const { data: existing } = await admin.from("members").select("id").eq("id", u.id).maybeSingle();
      if (!existing) row.created_by = me.display_name;
      const m = await upsertMember(row, password);
      return out({ ok: true, member: pub(m) });
    }
    if (action === "import_users") {  // first sync of a tablet: local users become members (hash only; they activate on their first online sign-in)
      const res: any[] = [];
      for (const raw of (body.users || []).slice(0, 200)) {
        const u = cleanUser(raw), secret = cleanSecret(raw.secret);
        const { data: byName } = await admin.from("members").select("id").eq("username", u.username).maybeSingle();
        const { data: byId } = await admin.from("members").select("id").eq("id", u.id).maybeSingle();
        if (byName || byId) { res.push({ id: u.id, username: u.username, result: "exists" }); continue; }
        const { error } = await admin.from("members").insert({ ...u, secret, created_by: `import by ${me.display_name}` });
        res.push({ id: u.id, username: u.username, result: error ? error.message : "imported" });
      }
      return out({ ok: true, results: res });
    }
    throw new Fail("unknown action");
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    return out({ ok: false, error: e instanceof Error ? e.message : String(e) }, status);
  }
});
