// =====================================================================================================
// wedding-rsvp.ts: POST /<slug>/api/rsvp   (public, the invite page's form)
//
// What it is for: stores a family's answer { attending, guests, guest_names, note }. The latest answer wins.
// Who calls it: site/app/app.js when the guest presses Send.
// What it reads: weddings, families, rsvps. What it writes: one new row in rsvps, one "answered" line in activity.
//
// What NOT to change and why (helpers and guests rely on each rule; see docs/API.md section 1):
//   - attending accepts true, 1, "1", "yes", "true". Declining forces 0 guests.
//   - guests is clamped to 0..max_guests and to at least 1 when attending, BEFORE the names check.
//   - When attending, one name per guest is required (400 names_required).
//   - preview: true never saves and never logs.
//   - Archived wedding = 410, nothing saved.
//
//notes:
// - Every answer is a new row (history is kept); "current" = the newest row not cleared by a reset.
// =====================================================================================================
import type { Config } from "@netlify/functions";
import { query } from "./_lib/_db.ts";
import { json, errorReply, readBody, slugFromPath, logEvent, ARCHIVED, NOTE_MAX, GUEST_NAME_MAX } from "./_lib/_wedding.ts";
import { findGuest, currentAnswer } from "./wedding-guest.ts";

export default async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "This action does not exist.", code: "not_found" }, 404);
    const body = await readBody(req);
    const g = await findGuest(slugFromPath(req), body.t);
    if (!g) return json({ error: "unknown invitation" }, 404);
    if (g.w.status === "archived") throw ARCHIVED();

    const att = body.attending;
    const attending = att === true || att === 1 || att === "1" || att === "yes" || att === "true";
    let guests = Math.floor(Number(body.guests));
    if (!Number.isFinite(guests)) guests = attending ? 1 : 0;
    guests = Math.max(0, Math.min(g.fam.max_guests, guests));
    if (!attending) guests = 0;
    else if (guests < 1) guests = 1;
    const note = String(body.note ?? "").slice(0, NOTE_MAX);
    const guest_names: string[] = (Array.isArray(body.guest_names) ? body.guest_names : [])
      .map((n: unknown) => String(n ?? "").trim().slice(0, GUEST_NAME_MAX))
      .filter((n: string) => n)
      .slice(0, guests);
    if (attending && guest_names.length < guests)
      return json({ error: "Please write the name of everyone coming.", code: "names_required", needed: guests, given: guest_names.length }, 400);

    const preview = body.preview === true;
    let record = { attending, guests, guest_names, note, at: new Date().toISOString() };
    if (!preview) {
      const before = await currentAnswer(g.fam.id);
      const [r] = await query<any>("insert into rsvps (family_id, attending, guests, guest_names, note) values ($1,$2,$3,$4::jsonb,$5) returning at",
        [g.fam.id, attending, guests, JSON.stringify(guest_names), note]);
      record = { ...record, at: r.at };
      await logEvent(g.w.id, { by: "Guest", action: "answered", family: g.fam,
        details: { attending, guests, guest_names, changed: !!before, ...(before ? { before: { attending: before.attending, guests: before.guests } } : {}) } });
    }
    return json({ ok: true, preview, saved: !preview, name: g.fam.name, max_guests: g.fam.max_guests, response: record });
  } catch (e) { return errorReply(e); }
};

export const config: Config = { path: "/:slug/api/rsvp" };
