// =====================================================================================================
// wedding-guest.ts: GET /<slug>/api/guest?t=TOKEN[&preview=1]   (public, the invite page calls it)
//
// What it is for: tells the invite page who the guest is: { name, max_guests, response }.
// Who calls it: site/app/app.js when a guest opens their personal link.
// What it reads: weddings, families, rsvps. What it writes: opens (first/last time, count) and, on the
//   first open, one "opened" line in activity.
//
// What NOT to change and why:
//   - Never add phone, e-mail or any other family field to the reply: this endpoint is public.
//   - preview=1 (the helpers' "Preview invite" button) must never record an open.
//   - A token only works under its own wedding's address; the lookup is by slug AND token.
//
//notes:
// - Archived weddings still answer (the page shows a thank-you card) but no longer count opens.
// - A failed open count never fails the page load.
// =====================================================================================================
import type { Config } from "@netlify/functions";
import { one, query } from "./_lib/_db.ts";
import { json, errorReply, slugFromPath, getWedding, logEvent, TOKEN_RE } from "./_lib/_wedding.ts";

export async function findGuest(slug: string, rawToken: unknown) {
  const t = String(rawToken ?? "").trim().toUpperCase();
  if (!TOKEN_RE.test(t)) return null;
  const w = await getWedding(slug);
  if (!w) return null;
  const fam = await one<{ id: number; name: string; side: string; max_guests: number }>(
    "select id, name, side, max_guests from families where wedding_id = $1 and token = $2 and removed_at is null", [w.id, t]);
  return fam ? { w, fam, token: t } : null;
}
export async function currentAnswer(familyId: number) {
  const r = await one<any>("select attending, guests, guest_names, note, at from rsvps where family_id = $1 and cleared_at is null order by at desc, id desc limit 1", [familyId]);
  return r ? { attending: r.attending, guests: r.guests, guest_names: r.guest_names || [], note: r.note || "", at: r.at } : null;
}

async function recordOpen(weddingId: number, fam: { id: number; name: string; side: string }) {
  const [r] = await query<{ count: number }>(
    `insert into opens (family_id, first_at, last_at, count) values ($1, now(), now(), 1)
     on conflict (family_id) do update set
       first_at = case when opens.cleared_at is null then opens.first_at else now() end,
       last_at = now(),
       count = case when opens.cleared_at is null then opens.count + 1 else 1 end,
       cleared_at = null
     returning count`, [fam.id]);
  if (r && r.count === 1) await logEvent(weddingId, { by: "Guest", action: "opened", family: fam });
}

export default async (req: Request) => {
  try {
    if (req.method !== "GET") return json({ error: "This action does not exist.", code: "not_found" }, 404);
    const q = new URL(req.url).searchParams;
    const g = await findGuest(slugFromPath(req), q.get("t"));
    if (!g) return json({ error: "unknown invitation" }, 404);
    if (q.get("preview") !== "1" && g.w.status === "live") await recordOpen(g.w.id, g.fam).catch((e) => console.error("open not recorded", e));
    return json({ name: g.fam.name, max_guests: g.fam.max_guests, response: await currentAnswer(g.fam.id) });
  } catch (e) { return errorReply(e); }
};

export const config: Config = { path: "/:slug/api/guest" };
