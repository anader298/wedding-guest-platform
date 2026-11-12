// tests/_helpers.ts: small helpers shared by the tests: call a function handler with a Request, keep cookies,
// create a wedding through the manager API, log a helper in.
// The handlers are called directly (no server); the base address is http://test.local.
//notes: import "./_env.ts" before this file in every test.
import manage from "../netlify/functions/manage.ts";
import admin from "../netlify/functions/wedding-admin.ts";
import guest from "../netlify/functions/wedding-guest.ts";
import rsvp from "../netlify/functions/wedding-rsvp.ts";
import invite from "../netlify/functions/wedding-invite.ts";
import asset from "../netlify/functions/wedding-asset.ts";

export const BASE = "http://test.local";
export const handlers = { manage, admin, guest, rsvp, invite, asset };

export type Res = { status: number; body: any; setCookie: string | null; headers: Headers; raw: Response };
export async function call(handler: (r: Request) => Promise<Response>, method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await handler(new Request(BASE + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const text = await res.clone().text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body, setCookie: res.headers.get("set-cookie"), headers: res.headers, raw: res };
}
/** "name=value" part of a Set-Cookie header. */
export const cookieOf = (setCookie: string | null) => (setCookie || "").split(";")[0];

export async function ownerLogin() {
  const r = await call(manage, "POST", "/api/manage/login", { body: { password: "owner-secret" } });
  if (r.status !== 200) throw new Error("owner login failed " + JSON.stringify(r.body));
  return cookieOf(r.setCookie);
}
export async function createWedding(owner: string, extra: Record<string, unknown> = {}) {
  const r = await call(manage, "POST", "/api/manage/create", { cookie: owner, body: { slug: "test-wedding", groom: "Adam", bride: "Eve", event_date: "2027-06-05", event_time: "19:30", ...extra } });
  if (r.status !== 200) throw new Error("create failed " + JSON.stringify(r.body));
  return r.body;
}
export async function helperLogin(slug: string, name = "Rima", password = "wedding") {
  const r = await call(admin, "POST", `/${slug}/api/admin/login`, { body: { name, password } });
  if (r.status !== 200) throw new Error("helper login failed " + JSON.stringify(r.body));
  return cookieOf(r.setCookie);
}
/** Calls /<slug>/api/admin/<action>. */
export const A = (slug: string, cookie: string) => (method: string, action: string, body?: unknown) =>
  call(admin, method, `/${slug}/api/admin/${action}`, { cookie, body });
export async function addFamily(slug: string, cookie: string, name: string, side = "a", max_guests = 4, extra: Record<string, unknown> = {}) {
  const r = await A(slug, cookie)("POST", "family", { name, side, max_guests, ...extra });
  if (r.status !== 200) throw new Error("add family failed " + JSON.stringify(r.body));
  return r.body.family;
}
