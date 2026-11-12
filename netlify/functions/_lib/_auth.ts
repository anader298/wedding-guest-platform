// =====================================================================================================
// _auth.ts: passwords and login cookies.
//
// What it is for: checking passwords, making and checking the signed login cookies.
// Who calls it: wedding-admin.ts (helpers), wedding-invite.ts (draft preview), manage.ts (the owner),
//   tools/seed.ts (hashing the demo password).
// What it reads: env OWNER_PASSWORD, SESSION_SECRET; the wedding row's password_hash and session_version.
// What it writes: the login_attempts table (wrong-password lockout); otherwise it only builds Set-Cookie values.
//
// How it works, in plain words:
//   - A wedding password is stored only as a scrypt hash: "scrypt$<salt hex>$<hash hex>". Never store or
//     log the plain password.
//   - Helper cookie "twp_<slug>" = base64url(helper name) "." HMAC-SHA256(name), keyed with
//     sha256(SESSION_SECRET + slug + password_hash + session_version). Changing the password or bumping
//     session_version changes the key, so every old cookie for that wedding stops working.
//   - Owner cookie "twp_owner" = same scheme, keyed with sha256(SESSION_SECRET + "owner" + OWNER_PASSWORD).
//     No OWNER_PASSWORD on Netlify = the owner can never log in (fails closed).
//   - Scripts may send header "x-wedding-key: <plain wedding password>" instead of a cookie.
//
// What NOT to change and why:
//   - Cookie names, the HMAC message and the key recipe: changing any of them logs everybody out.
//   - The timing-safe comparisons (timingSafeEqual): plain === would leak how many characters matched.
//
//notes:
// - SESSION_SECRET is optional; without it a secret is derived from OWNER_PASSWORD. Setting or changing
//   it logs everyone out once.
// - Cookies last 400 days (the browser maximum) so a helper's phone logs in once.
// - Cookies are always HttpOnly and SameSite=Lax; "Secure" is added only when the request came over https
//   (always on Netlify). On a plain http://localhost copy Safari would otherwise refuse the cookie.
// - Lockout: 5 wrong passwords within 10 minutes from one IP address lock that address out of that wedding
//   (or out of the manager) for 15 minutes: reply 429 "Too many wrong passwords. Try again in 15 minutes."
//   A right password clears the count. Other phones (other IP addresses) are not affected.
// =====================================================================================================
import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { query, one } from "./_db.ts";

const COOKIE_DAYS = 400;
const OWNER_COOKIE = "twp_owner";
export const OWNER_NAME = "Owner";

function scrypt(pw: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => scryptCb(pw.normalize("NFC"), salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
}

/** Turns a plain password into the stored form "scrypt$salt$hash". */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await scrypt(pw, salt)).toString("hex")}`;
}
/** True when `pw` matches the stored hash. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const m = /^scrypt\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(String(stored || ""));
  if (!m || typeof pw !== "string" || !pw) return false;
  const want = Buffer.from(m[2], "hex");
  const got = await scrypt(pw, Buffer.from(m[1], "hex"));
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The owner password from Netlify. Accepts the key in any capitalisation (OWNER_PASSWORD, owner_password,
 *  Owner_Password): a real owner typed it in lowercase on the first deploy and was locked out. */
export function ownerPassword() {
  // trim: a value pasted into Netlify with a trailing space or line break must still match what she types
  for (const k of Object.keys(process.env)) if (k.toLowerCase() === "owner_password" && (process.env[k] || "").trim()) return (process.env[k] as string).trim();
  return "";
}
function sessionSecret() {
  return process.env.SESSION_SECRET || createHash("sha256").update("twp-session:" + ownerPassword()).digest("hex");
}

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sha256 = (s: string) => createHash("sha256").update(s).digest();
const hmac = (key: Buffer, msg: string) => createHmac("sha256", key).update(msg).digest("base64url");
function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) { try { return decodeURIComponent(part.slice(i + 1)); } catch { return ""; } }
  }
  return "";
}
/** True when the request came over https (directly, or through a proxy that says so). */
export function isHttps(req: Request) {
  return new URL(req.url).protocol === "https:" || (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
}
const flags = (secure: boolean) => `HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax`;
function expires() {
  return `Max-Age=${COOKIE_DAYS * 86400}; Expires=${new Date(Date.now() + COOKIE_DAYS * 86400_000).toUTCString()}`;
}
/** Reads "base64url(name).signature" and returns the name when the signature matches `key`. */
function verifySigned(raw: string, key: Buffer): string | null {
  const dot = raw.indexOf(".");
  if (dot < 1) return null;
  let name = "";
  try { name = unb64u(raw.slice(0, dot)); } catch { return null; }
  if (!name) return null;
  return safeEq(raw.slice(dot + 1), hmac(key, name)) ? name : null;
}

// ---------- helpers (one wedding) ----------
export type WeddingAuth = { slug: string; password_hash: string; session_version: number };
export const helperCookieName = (slug: string) => `twp_${slug}`;
const helperKey = (w: WeddingAuth) => sha256(sessionSecret() + w.slug + w.password_hash + String(w.session_version));

export function helperCookie(w: WeddingAuth, name: string, secure = true) {
  return `${helperCookieName(w.slug)}=${b64u(name)}.${hmac(helperKey(w), name)}; Path=/${w.slug}; ${expires()}; ${flags(secure)}`;
}
export function clearHelperCookie(slug: string, secure = true) {
  return `${helperCookieName(slug)}=; Path=/${slug}; Max-Age=0; ${flags(secure)}`;
}

// ---------- owner (the whole site) ----------
const ownerKey = () => sha256(sessionSecret() + "owner" + ownerPassword());
export function ownerCookie(secure = true) {
  return `${OWNER_COOKIE}=${b64u(OWNER_NAME)}.${hmac(ownerKey(), OWNER_NAME)}; Path=/; ${expires()}; ${flags(secure)}`;
}
export function clearOwnerCookie(secure = true) { return `${OWNER_COOKIE}=; Path=/; Max-Age=0; ${flags(secure)}`; }
/** True when the request carries a valid owner cookie (always false without OWNER_PASSWORD). */
export function isOwner(req: Request) {
  if (!ownerPassword()) return false;
  return verifySigned(readCookie(req, OWNER_COOKIE), ownerKey()) === OWNER_NAME;
}
/** Checks the owner password typed on the login page. */
export function checkOwnerPassword(pw: unknown) {
  const want = ownerPassword();
  return !!want && typeof pw === "string" && safeEq(sha256(pw).toString("hex"), sha256(want).toString("hex"));
}

export type Session = { by: string; script: boolean; owner: boolean };
/**
 * Who is calling the admin API of wedding `w`: a helper (cookie), the owner (owner cookie, by = "Owner"),
 * a script (x-wedding-key, by = filled in later from the body), or null (not logged in).
 */
export async function adminSession(req: Request, w: WeddingAuth): Promise<Session | null> {
  const name = verifySigned(readCookie(req, helperCookieName(w.slug)), helperKey(w));
  if (name) return { by: name, script: false, owner: false };
  if (isOwner(req)) return { by: OWNER_NAME, script: false, owner: true };
  const key = req.headers.get("x-wedding-key");
  if (key) {
    const scope = "wedding:" + w.slug;
    if (await isLockedOut(scope, req)) return null;
    if (await verifyPassword(key, w.password_hash)) return { by: "", script: true, owner: false };
    await recordFailure(scope, req);
  }
  return null;
}

// ---------- wrong-password lockout ----------
export const LOCK_MAX_FAILURES = 5;
export const LOCK_WINDOW_MIN = 10;
export const LOCK_MINUTES = 15;
export const LOCKED_MESSAGE = "Too many wrong passwords. Try again in 15 minutes.";

/** The visitor's IP address as Netlify reports it (falls back to "unknown"). */
export function clientKey(req: Request) {
  const h = req.headers;
  return (h.get("x-nf-client-connection-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || h.get("x-real-ip") || "unknown").trim().slice(0, 100) || "unknown";
}
/** True while this scope+visitor is locked out. */
export async function isLockedOut(scope: string, req: Request) {
  const r = await one("select 1 from login_attempts where scope = $1 and key = $2 and locked_until > now()", [scope, clientKey(req)]);
  return !!r;
}
/** Counts one wrong password; locks after LOCK_MAX_FAILURES within LOCK_WINDOW_MIN minutes. Returns true when now locked. */
export async function recordFailure(scope: string, req: Request) {
  const [r] = await query<{ locked: boolean }>(
    `insert into login_attempts (scope, key, failures, first_failed_at) values ($1, $2, 1, now())
     on conflict (scope, key) do update set
       failures = case when login_attempts.first_failed_at < now() - interval '${LOCK_WINDOW_MIN} minutes' then 1 else login_attempts.failures + 1 end,
       first_failed_at = case when login_attempts.first_failed_at < now() - interval '${LOCK_WINDOW_MIN} minutes' then now() else login_attempts.first_failed_at end
     returning failures >= ${LOCK_MAX_FAILURES} as locked`, [scope, clientKey(req)]);
  if (r?.locked) await query(`update login_attempts set locked_until = now() + interval '${LOCK_MINUTES} minutes', failures = 0, first_failed_at = now() where scope = $1 and key = $2`, [scope, clientKey(req)]);
  await query("delete from login_attempts where first_failed_at < now() - interval '1 day' and (locked_until is null or locked_until < now())").catch(() => {});
  return !!r?.locked;
}
/** A right password: forget this visitor's wrong attempts. */
export async function clearFailures(scope: string, req: Request) {
  await query("delete from login_attempts where scope = $1 and key = $2", [scope, clientKey(req)]);
}
