// =====================================================================================================
// wedding-invite.ts: GET /<slug>/api/invite[?draft=1]   (public; draft needs a helper or owner login)
//
// What it is for: gives the invite page the wedding's design: texts, colours, fonts, pictures, slides, and the
//   per-page looks, single-line looks, photo readability and timing (pages / lines / readability / timing, checked in _invite.ts).
// Who calls it: the loader at the top of site/app/app.js (and slides.js), and the Design tab preview.
// What it reads: weddings, invites. What it writes: nothing.
//
// What NOT to change and why:
//   - Only the published ("live") design is public. The draft is shown only to a logged-in helper of this
//     wedding or the owner, so half-finished designs never reach guests.
//   - Never add family data, phone numbers or e-mails here.
//
//notes:
// - If the stored design is missing or cannot be read, a starting design built from THIS wedding's names and
//   date is returned (never the raw template: that would show Karim & Maya's names, parents and gift
//   account number to another couple's guests).
// =====================================================================================================
import type { Config } from "@netlify/functions";
import { one } from "./_lib/_db.ts";
import { json, errorReply, slugFromPath, getWedding, newWeddingInvite, localParts, defaultReplyBy, type Wedding } from "./_lib/_wedding.ts";
import { adminSession } from "./_lib/_auth.ts";
import { resolveInvite } from "./_lib/_invite.ts";

/** A safe starting design for this wedding: its own names, date and reply-by; no parents, venue or gift account. */
async function fallbackInvite(w: Wedding) {
  const r = await one<{ value: string }>("select value from settings where wedding_id = $1 and key = 'reply_by'", [w.id]).catch(() => null);
  const p = localParts(w.event_at, w.timezone);
  const replyBy = /^\d{4}-\d{2}-\d{2}$/.test(r?.value || "") ? r!.value : defaultReplyBy(`${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`);
  return newWeddingInvite({ groom: w.groom, bride: w.bride, eventAt: w.event_at, timezone: w.timezone, replyBy });
}

export default async (req: Request) => {
  try {
    const slug = slugFromPath(req);
    const w = await getWedding(slug);
    if (!w) return json({ error: "This wedding does not exist.", code: "no_wedding" }, 404);
    const draft = new URL(req.url).searchParams.get("draft") === "1";
    if (draft && !(await adminSession(req, w))) return json({ error: "Please log in to see the draft.", code: "unauthorized" }, 401);
    const row = await one<any>("select draft, live, published_at from invites where wedding_id = $1", [w.id]);
    let resolved;
    const stored = draft ? row?.draft : row?.live;
    try { resolved = resolveInvite(w.slug, stored ?? (await fallbackInvite(w))); }
    catch (e) { console.error("stored invite unreadable, using this wedding's starting design", e); resolved = resolveInvite(w.slug, await fallbackInvite(w)); }
    return json({ slug, status: w.status, ...resolved, published_at: row?.published_at ?? null });
  } catch (e) { return errorReply(e); }
};

export const config: Config = { path: "/:slug/api/invite" };
