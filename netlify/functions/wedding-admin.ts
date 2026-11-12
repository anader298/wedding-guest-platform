// =====================================================================================================
// wedding-admin.ts: /<slug>/api/admin/<action>   (helpers of one wedding, and the owner)
//
// What it is for: everything the helpers' admin page does: log in, the guest list, sending marks,
//   WhatsApp texts, activity, helper counts, testing resets, the invite design and uploads, the password,
//   export. The full contract (every request, reply and error) is docs/API.md section 2.
// Who calls it: site/app/admin.html (cookie twp_<slug>), the manager page via the owner cookie, scripts
//   with header x-wedding-key.
// What it reads/writes: weddings (password), families, rsvps, sends, opens, activity, helpers, settings,
//   invites, assets, resets; Blobs store "assets".
//
// What NOT to change and why:
//   - `by` (who did it) comes ONLY from the session (see who()). Never read it from the page: helpers
//     trust the activity log to say who really did what.
//   - Every multi-row change runs inside tx(...) so it is all saved or nothing is.
//   - Guarded actions keep their guard: DELETE family needs force when sent/answered, PATCH needs force
//     to go below an answer, reset-all needs confirm "RESET", PUT settings/invite refuse to overwrite
//     another helper's newer change (409 changed) unless force.
//   - Archived weddings refuse every write with 410 (see ALWAYS_ALLOWED).
//   - Login (and x-wedding-key) keep the wrong-password lockout (429 after 5 wrong tries in 10 minutes).
//
//notes:
// - Logging (logEvent) happens after the transaction, never inside it.
// - A reset does not delete anything: it stamps cleared_at on the rows, and undo-reset removes the stamp.
// =====================================================================================================
import type { Config } from "@netlify/functions";
import { query, one, tx, isUniqueViolation } from "./_lib/_db.ts";
import { adminSession, verifyPassword, hashPassword, helperCookie, clearHelperCookie, isHttps, OWNER_NAME, isLockedOut, recordFailure, clearFailures, LOCKED_MESSAGE, type Session } from "./_lib/_auth.ts";
import {
  json, Bad, errorReply, readBody, getWedding, NO_WEDDING, ARCHIVED, NOT_FOUND_ACTION, baseUrl, logEvent, touchHelper, newToken,
  vName, vSide, vGuests, vMessage, vPhone, vEmail, vToken, cleanName, nameKey, sideName, SETTINGS_KEYS, MESSAGE_MAX, NAME_MAX_LOGIN, iso, safeDecode,
  type Wedding, type Side,
} from "./_lib/_wedding.ts";
import { loadFamilies, loadFamily, familyView, sentOf, readSettings, exportWedding, type FamilyRow } from "./_lib/_data.ts";
import { normalizeInvite, assetUrl, assetsUsed, ASSET_TYPES, clampStoredScales } from "./_lib/_invite.ts";
import { blobs } from "./_lib/_blobs.ts";

const MAX_UPLOAD = 4 * 1024 * 1024;   // 4 MB: base64 adds a third, and Netlify refuses requests over ~6 MB. Keep equal to admin.html
const RESERVED_HELPER_NAMES = new Set(["owner", "guest", "script"]);
/** Actions that change nothing and so stay allowed on an archived wedding. */
const ALWAYS_ALLOWED = new Set(["login", "logout", "hello"]);

const answeredGuests = (f: FamilyRow) => (f.response && f.response.attending ? f.response.guests : 0);
const activityKey = (id: number) => String(id).padStart(12, "0");
/** A `base` timestamp the page sent, as ISO. Unreadable = "unreadable" (never equal to a stored time: a conflict, never a crash). */
const baseTime = (v: unknown) => (v === null || v === undefined || v === "" ? null : iso(v) ?? "unreadable");
const famRef = (f: { id: number; name: string; side: string }) => ({ id: f.id, name: f.name, side: f.side });
const notFoundFamily = () => new Bad("This family no longer exists.", 404, { code: "not_found" });
const duplicate = (existing: any) => new Bad("A family with this name already exists.", 409, { code: "duplicate_name", existing });

async function existingByName(w: Wedding, name: string) {
  return one<{ token: string; name: string; side: Side }>(
    "select token, name, side from families where wedding_id = $1 and name_key = $2 and removed_at is null", [w.id, nameKey(name)]);
}

/** Adds a family. Throws 409 duplicate_name when the name is taken (also when another helper won a race). */
async function createFamily(w: Wedding, f: { name: string; side: Side; max_guests: number; message: string | null; phone: string | null; email: string | null }, who: string) {
  const ex = await existingByName(w, f.name);
  if (ex) throw duplicate(ex);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await query<{ id: number; token: string }>(
        `insert into families (wedding_id, token, name, name_key, side, max_guests, message, phone, email, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning id, token`,
        [w.id, newToken(), f.name, nameKey(f.name), f.side, f.max_guests, f.message, f.phone, f.email, who]);
      return row;
    } catch (e: any) {
      if (!isUniqueViolation(e)) throw e;
      const ex2 = await existingByName(w, f.name);
      if (ex2) throw duplicate(ex2);
      // otherwise the random token collided: try another one
    }
  }
  throw new Bad("Could not add the family just now. Please try again.", 500);
}

async function handle(req: Request, action: string, w: Wedding, sess: Session): Promise<Response> {
  const M = req.method;
  const base = baseUrl(req);
  let bodyCache: any;
  const body = async () => (bodyCache ??= M === "GET" ? {} : await readBody(req));
  /** Who did it: the session's name; scripts may name themselves in the body. */
  const who = async () => {
    if (!sess.script) return sess.by;
    const n = cleanName((await body()).by).slice(0, 60);
    return n && !RESERVED_HELPER_NAMES.has(n.toLowerCase()) ? n : "script";   // a script can never sign as "Owner" or "Guest"
  };
  const settings = () => readSettings(w.id);
  const view = async (token: string) => {
    const f = await loadFamily(w.id, token);
    return f ? familyView(f, w, base, (await settings()).messages) : null;
  };

  if (w.status === "archived" && M !== "GET" && !ALWAYS_ALLOWED.has(action)) throw ARCHIVED();

  // ---------------- session ----------------
  if (action === "me" && M === "GET") return json({ ok: true, name: sess.by, owner: sess.owner, slug: w.slug, status: w.status });

  // ---------------- families ----------------
  if (action === "families" && M === "GET") {
    const [fams, s, removed] = await Promise.all([
      loadFamilies(w.id), settings(),
      one<{ n: number }>("select count(*)::int as n from families where wedding_id = $1 and removed_at is not null", [w.id]),
    ]);
    return json({ now: new Date().toISOString(), settings: s.messages, removed_count: removed?.n ?? 0, families: fams.map((f) => familyView(f, w, base, s.messages)) });
  }

  if (action === "family" && M === "POST") {
    const b = await body(), by = await who();
    const input = { name: vName(b.name), side: vSide(b.side, w), max_guests: vGuests(b.max_guests), message: vMessage(b.message), phone: vPhone(b.phone), email: vEmail(b.email) };
    const row = await createFamily(w, input, by);
    await logEvent(w.id, { by, action: "family_added", family: { id: row.id, name: input.name, side: input.side }, details: { max_guests: input.max_guests, special_message: !!input.message } });
    return json({ ok: true, family: await view(row.token) });
  }

  if (action === "family" && M === "PATCH") {
    const b = await body(), by = await who();
    const token = vToken(b.token);
    const patch: Record<string, any> = {};
    if (b.name !== undefined) patch.name = vName(b.name);
    if (b.side !== undefined) patch.side = vSide(b.side, w);
    if (b.max_guests !== undefined) patch.max_guests = vGuests(b.max_guests);
    if ("message" in b) patch.message = vMessage(b.message);
    if ("phone" in b) patch.phone = vPhone(b.phone);
    if ("email" in b) patch.email = vEmail(b.email);
    let before: FamilyRow;
    try {
      before = await tx(async (q) => {
        await q.query("select id from families where wedding_id = $1 and token = $2 for update", [w.id, token]);
        const f = await loadFamily(w.id, token, q);
        if (!f || f.removed_at) throw notFoundFamily();
        if (patch.max_guests !== undefined && b.force !== true && patch.max_guests < answeredGuests(f))
          throw new Bad(`This family already answered for ${answeredGuests(f)} guests.`, 409, { code: "below_answer", answered_guests: answeredGuests(f) });
        const next = { name: f.name, side: f.side, max_guests: f.max_guests, message: f.message, phone: f.phone, email: f.email, ...patch };
        await q.query(
          `update families set name = $2, name_key = $3, side = $4, max_guests = $5, message = $6, phone = $7, email = $8, updated_at = now(), updated_by = $9 where id = $1`,
          [f.id, next.name, nameKey(next.name), next.side, next.max_guests, next.message, next.phone, next.email, by]);
        return f;
      });
    } catch (e: any) {
      if (isUniqueViolation(e)) throw duplicate(await existingByName(w, patch.name));
      throw e;
    }
    const after = (await loadFamily(w.id, token))!;
    const changes: string[] = [];
    if (before.name !== after.name) changes.push(`renamed ${before.name} → ${after.name}`);
    if (before.max_guests !== after.max_guests) changes.push(`seats ${before.max_guests} → ${after.max_guests}`);
    if (before.side !== after.side) changes.push(`side ${sideName(before.side, w)} → ${sideName(after.side, w)}`);
    if ((before.message ?? null) !== (after.message ?? null)) changes.push(after.message ? (before.message ? "special message changed" : "special message set") : "special message cleared");
    if (changes.length) await logEvent(w.id, { by, action: "family_edited", family: famRef(after), details: { changes, forced: b.force === true } });
    const contact: string[] = [];
    const word = (label: string, x: string | null, y: string | null) => { if ((x ?? null) !== (y ?? null)) contact.push(`${label} ${!x ? "added" : !y ? "removed" : "changed"}`); };
    word("phone", before.phone, after.phone);
    word("e-mail", before.email, after.email);
    if (contact.length) await logEvent(w.id, { by, action: "contact_edited", family: famRef(after), details: { changes: contact } });
    return json({ ok: true, family: familyView(after, w, base, (await settings()).messages) });
  }

  if (action === "family" && M === "DELETE") {
    const b = await body(), by = await who();
    const token = vToken(b.token);
    const f = await loadFamily(w.id, token);
    if (!f) throw notFoundFamily();   // never of this wedding (e.g. another wedding's link): not "already removed"
    if (f.removed_at) return json({ ok: true, already_removed: true });
    const sent = sentOf(f.sends);
    if ((sent || f.response) && b.force !== true && b.force !== "true")
      return json({ error: "This family was already sent the invitation or has answered.", code: "has_activity", sent, response: f.response }, 409);
    const [r] = await query("update families set removed_at = now(), removed_by = $2 where id = $1 and removed_at is null returning id", [f.id, by]);
    if (!r) return json({ ok: true, already_removed: true });
    await logEvent(w.id, { by, action: "family_removed", family: famRef(f),
      details: { sent: !!sent, opened: !!f.opened, response: f.response ? { attending: f.response.attending, guests: f.response.guests } : null } });
    return json({ ok: true });
  }

  if (action === "removed" && M === "GET") {
    const rows = (await loadFamilies(w.id, { removed: true })).sort((a, b) => String(b.removed_at).localeCompare(String(a.removed_at)));
    return json({ removed: rows.map((f) => ({ token: f.token, name: f.name, side: f.side, max_guests: f.max_guests, message: f.message,
      removed_at: f.removed_at, removed_by: f.removed_by || "", sent: sentOf(f.sends), opened: f.opened, response: f.response })) });
  }

  if (action === "restore" && M === "POST") {
    const b = await body(), by = await who();
    const token = vToken(b.token);
    const f = await loadFamily(w.id, token);
    if (!f) throw new Bad("This removed family was not found.", 404, { code: "not_found" });
    if (!f.removed_at) throw new Bad("This family is already back on the list.", 409, { code: "already_restored" });
    const ex = await existingByName(w, f.name);
    const taken = (e: any) => new Bad(`There is already a family called "${e?.name ?? f.name}" on the list.`, 409, { code: "duplicate_name", existing: e });
    if (ex) throw taken(ex);
    try {
      const [r] = await query("update families set removed_at = null, removed_by = null, updated_at = now(), updated_by = $2 where id = $1 and removed_at is not null returning id", [f.id, by]);
      if (!r) throw new Bad("This family is already back on the list.", 409, { code: "already_restored" });
    } catch (e) {
      if (isUniqueViolation(e)) throw taken(await existingByName(w, f.name));
      throw e;
    }
    await logEvent(w.id, { by, action: "family_restored", family: famRef(f), details: { sent: !!sentOf(f.sends), response: f.response ? { attending: f.response.attending, guests: f.response.guests } : null } });
    return json({ ok: true, family: await view(token) });
  }

  if (action === "upload" && M === "POST") {
    const b = await body(), by = await who();
    const side = vSide(b.side, w);
    if (!Array.isArray(b.families)) throw new Bad("The file has no list of families.");
    if (b.families.length > 2000) throw new Bad("The file has more than 2000 rows. Please split it in two.");
    const dry = b.dry_run === true;
    const existing = new Map<string, FamilyRow>();
    for (const f of await loadFamilies(w.id)) existing.set(f.name_key, f);
    const out = { ok: true, dry_run: dry, added: [] as string[], updated: [] as { name: string; from: number; to: number }[], unchanged: 0, conflicts: [] as { name: string; reason: string }[] };
    const seen = new Set<string>();
    type Job = { kind: "add"; name: string; max: number; phone: string | null; email: string | null } | { kind: "update"; fam: FamilyRow; max: number };
    const jobs: Job[] = [];
    for (const row of b.families) {
      const raw = cleanName(row?.name);
      let name: string, max: number, phone: string | null, email: string | null;
      try { name = vName(row?.name); max = vGuests(row?.max_guests); phone = vPhone(row?.phone); email = vEmail(row?.email); }
      catch (e: any) { out.conflicts.push({ name: raw, reason: e.message }); continue; }
      const k = nameKey(name);
      if (seen.has(k)) { out.conflicts.push({ name, reason: "This name appears more than once in the file; only the first row was used." }); continue; }
      seen.add(k);
      const ex = existing.get(k);
      if (!ex) { jobs.push({ kind: "add", name, max, phone, email }); continue; }
      if (ex.side !== side) { out.conflicts.push({ name, reason: `Already on ${sideName(ex.side, w)}'s side.` }); continue; }
      if (ex.max_guests === max) { out.unchanged++; continue; }
      if (max < answeredGuests(ex)) { out.conflicts.push({ name: ex.name, reason: `Already answered for ${answeredGuests(ex)} guests; change it on the family itself if you really mean it.` }); continue; }
      jobs.push({ kind: "update", fam: ex, max });
    }
    if (dry) {
      for (const j of jobs) j.kind === "add" ? out.added.push(j.name) : out.updated.push({ name: j.fam.name, from: j.fam.max_guests, to: j.max });
    } else {
      for (const j of jobs) {
        try {
          if (j.kind === "add") {
            await createFamily(w, { name: j.name, side, max_guests: j.max, message: null, phone: j.phone, email: j.email }, by);
            out.added.push(j.name);
          } else {
            const [r] = await query(
              `update families set max_guests = $2, updated_at = now(), updated_by = $3 where id = $1 and removed_at is null
               and $2 >= coalesce((select case when attending then guests else 0 end from rsvps where family_id = $1 and cleared_at is null order by at desc, id desc limit 1), 0)
               returning id`, [j.fam.id, j.max, by]);
            if (r) out.updated.push({ name: j.fam.name, from: j.fam.max_guests, to: j.max });
            else out.conflicts.push({ name: j.fam.name, reason: "This family changed a moment ago (removed or answered); please check it by hand." });
          }
        } catch (e: any) {
          const name = j.kind === "add" ? j.name : j.fam.name;
          if (e instanceof Bad && e.extra.code === "duplicate_name") {
            const ex: any = e.extra.existing;
            out.conflicts.push({ name, reason: ex?.side && ex.side !== side ? `Already on ${sideName(ex.side, w)}'s side.` : "Someone added this name a moment ago." });
          } else out.conflicts.push({ name, reason: e instanceof Bad ? e.message : "Could not be saved; please try this row again." });
        }
      }
      await logEvent(w.id, { by, action: "upload", side, details: { added: out.added.length, updated: out.updated.length, unchanged: out.unchanged, skipped: out.conflicts.length } });
    }
    out.added.sort((a, b) => a.localeCompare(b));
    out.updated.sort((a, b) => a.name.localeCompare(b.name));
    return json(out);
  }

  // ---------------- sending ----------------
  if (action === "mark-sent" && M === "POST") {
    const b = await body(), by = await who();
    const token = vToken(b.token);
    const kind = b.kind === "invite" || b.kind === "reminder" ? b.kind : null;
    if (!kind) throw new Bad('kind must be "invite" or "reminder".');
    const channel = b.channel === undefined || b.channel === null || b.channel === "" ? "copy" : b.channel;
    if (!["copy", "whatsapp", "email"].includes(channel)) throw new Bad('channel must be "copy", "whatsapp" or "email".');
    const undo = b.undo === true;
    const r = await tx(async (q) => {
      await q.query("select id from families where wedding_id = $1 and token = $2 for update", [w.id, token]);
      const f = await loadFamily(w.id, token, q);
      if (!f || f.removed_at) throw notFoundFamily();
      const previous = sentOf(f.sends);
      if (undo) await q.query("update sends set undone_at = now() where family_id = $1 and kind = $2 and undone_at is null and cleared_at is null", [f.id, kind]);
      else await q.query("insert into sends (family_id, kind, channel, by_name) values ($1,$2,$3,$4)", [f.id, kind, channel, by]);
      const after = await loadFamily(w.id, token, q);
      return { f, previous, sent: sentOf(after!.sends) };
    });
    await logEvent(w.id, { by, action: undo ? "unmarked" : kind === "invite" ? "invite_sent" : "reminder_sent", family: famRef(r.f), details: undo ? { kind } : { kind, channel } });
    return json({ ok: true, sent: r.sent, previous: r.previous });
  }

  // ---------------- messages ----------------
  if (action === "settings" && M === "GET") return json((await settings()).messages);
  if (action === "settings" && M === "PUT") {
    const b = await body(), by = await who();
    const upd: Record<string, string> = {};
    const noLink: string[] = [], tooLong: string[] = [];
    for (const k of SETTINGS_KEYS) {
      if (b[k] === undefined) continue;
      const v = String(b[k]);
      if (v.length > MESSAGE_MAX) tooLong.push(k);
      else if (!v.includes("{link}")) noLink.push(k);
      else upd[k] = v;
    }
    if (tooLong.length) return json({ error: `This message is too long. Please keep it under ${MESSAGE_MAX} characters.`, code: "too_long", max: MESSAGE_MAX, fields: tooLong }, 400);
    if (noLink.length) return json({ error: "Every message must contain {link}, or guests get no invitation link.", code: "missing_link", fields: noLink }, 400);
    const baseV = b.base && typeof b.base === "object" ? b.base : null;
    const res = await tx(async (q) => {
      const rows = await q.query("select key, value, updated_at, updated_by from settings where wedding_id = $1 for update", [w.id]);
      const cur = new Map(rows.map((r) => [r.key, r]));
      const conflicts: { field: string; by: string; at: string; value: string }[] = [];
      if (baseV && b.force !== true) {
        for (const k of Object.keys(upd)) {
          const c = cur.get(k);
          if (c?.updated_at && baseTime(baseV[k]) !== c.updated_at && c.value !== upd[k])
            conflicts.push({ field: k, by: c.updated_by || "", at: c.updated_at, value: c.value });
        }
        if (conflicts.length) return { conflicts, changed: [] as string[] };
      }
      const changed: string[] = [];
      for (const k of Object.keys(upd)) {
        if (cur.get(k)?.value === upd[k]) continue;
        await q.query(
          `insert into settings (wedding_id, key, value, updated_at, updated_by) values ($1,$2,$3,now(),$4)
           on conflict (wedding_id, key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`, [w.id, k, upd[k], by]);
        changed.push(k);
      }
      return { conflicts, changed };
    });
    if (res.conflicts.length) {
      const c = res.conflicts[0];
      return json({ error: `${c.by || "Someone"} changed this message since you opened it.`, code: "changed", by: c.by, at: c.at, field: c.field, fields: res.conflicts }, 409);
    }
    for (const k of res.changed)
      await logEvent(w.id, { by, action: "message_saved", side: k.endsWith("_b") ? "b" : "a", details: { kind: k.startsWith("wa_reminder") ? "reminder" : "invite", forced: b.force === true } });
    return json((await settings()).messages);
  }

  // ---------------- helpers and activity ----------------
  if (action === "hello" && M === "POST") {
    await touchHelper(w.id, await who(), "ping");
    return json({ ok: true });
  }
  if (action === "helpers" && M === "GET") {
    const rows = await query("select name, first_seen, last_active, invites, reminders, edits, logins from helpers where wedding_id = $1 order by last_active desc", [w.id]);
    return json({ helpers: rows });
  }
  if (action === "activity" && M === "GET") {
    const qs = new URL(req.url).searchParams;
    const limit = Math.max(1, Math.min(5000, Math.floor(Number(qs.get("limit"))) || 2000));
    const since = qs.get("since") || "";
    const sinceId = /^\d{1,15}$/.test(since) ? Number(since) : 0;
    const rows = await query(
      `select a.id, a.at, a.by_name, a.action, f.token, a.family_name, a.side, a.details from activity a
       left join families f on f.id = a.family_id where a.wedding_id = $1 and a.id > $2 order by a.id desc limit $3`, [w.id, sinceId, limit]);
    const events = rows.map((r) => ({ key: activityKey(r.id), at: r.at, by: r.by_name, action: r.action, token: r.token ?? null, family_name: r.family_name, side: r.side, details: r.details || {} }));
    return json({ events, latest: events[0]?.key || since || null });
  }

  // ---------------- testing tools ----------------
  if (action === "reset-family" && M === "POST") {
    const b = await body(), by = await who();
    const token = vToken(b.token);
    const r = await tx(async (q) => {
      const f = await loadFamily(w.id, token, q);
      if (!f || f.removed_at) throw notFoundFamily();
      const snap = await clearFamilyState(q, f);
      let key: string | null = null;
      if (snap) {
        const [row] = await q.query("insert into resets (wedding_id, kind, family_id, by_name, snapshot) values ($1,'family',$2,$3,$4::jsonb) returning id",
          [w.id, f.id, by, JSON.stringify({ names: { [f.token]: f.name }, families: [snap] })]);
        key = activityKey(row.id);
      }
      return { f, key, cleared: { sent: !!snap?.sent, opened: !!snap?.opened, response: !!snap?.response } };
    });
    if (r.key) await logEvent(w.id, { by, action: "reset_family", family: famRef(r.f), details: { cleared: r.cleared } });
    return json({ ok: true, cleared: r.cleared, key: r.key, family: await view(token) });
  }

  if (action === "reset-all" && M === "POST") {
    const b = await body(), by = await who();
    if (b.confirm !== "RESET") throw new Bad("Type RESET to confirm.", 400, { code: "confirm_required" });
    const r = await tx(async (q) => {
      const fams = await loadFamilies(w.id, { q });
      const snaps: any[] = [];
      for (const f of fams) { const s = await clearFamilyState(q, f); if (s) snaps.push(s); }
      const counts = { sent: snaps.filter((s) => s.sent).length, opened: snaps.filter((s) => s.opened).length, answered: snaps.filter((s) => s.response).length };
      const [row] = await q.query("insert into resets (wedding_id, kind, by_name, snapshot) values ($1,'all',$2,$3::jsonb) returning id",
        [w.id, by, JSON.stringify({ counts, names: Object.fromEntries(fams.map((f) => [f.token, f.name])), families: snaps })]);
      return { counts, key: activityKey(row.id) };
    });
    await logEvent(w.id, { by, action: "reset_all", details: { counts: r.counts } });
    return json({ ok: true, counts: r.counts, snapshot: r.key });
  }

  if (action === "last-reset" && M === "GET") {
    const r = await one<any>("select id, at, by_name, snapshot, undone_at, undone_by from resets where wedding_id = $1 and kind = 'all' order by id desc limit 1", [w.id]);
    return json({ last: r ? { key: activityKey(r.id), at: r.at, by: r.by_name, counts: r.snapshot?.counts ?? { sent: 0, opened: 0, answered: 0 }, undone_at: r.undone_at, undone_by: r.undone_by } : null });
  }

  if (action === "undo-reset" && M === "POST") {
    const b = await body(), by = await who();
    const key = String(b.key ?? "");
    if (!/^\d{1,15}$/.test(key)) throw new Bad("That reset was not found.", 404, { code: "not_found" });
    const res = await tx(async (q) => {
      const [r] = await q.query("select * from resets where wedding_id = $1 and id = $2 for update", [w.id, Number(key)]);
      if (!r) throw new Bad("That reset was not found.", 404, { code: "not_found" });
      if (r.undone_at) throw new Bad("That reset was already undone.", 409, { code: "already_undone" });
      const restored: string[] = [], skipped: { name: string; reason: string }[] = [];
      for (const s of r.snapshot?.families || []) {
        const [f] = await q.query("select id, name, removed_at from families where id = $1 and wedding_id = $2", [s.family_id, w.id]);
        const label = f?.name || r.snapshot?.names?.[s.token] || s.token;
        if (!f || f.removed_at) { skipped.push({ name: label, reason: "This family was removed since." }); continue; }
        const [busy] = await q.query(
          `select (exists (select 1 from rsvps where family_id = $1 and cleared_at is null)
                or exists (select 1 from sends where family_id = $1 and cleared_at is null and undone_at is null)
                or exists (select 1 from opens where family_id = $1 and cleared_at is null)) as busy`, [f.id]);
        if (busy?.busy) { skipped.push({ name: f.name, reason: "Has new activity since the reset (sent, opened or answered), so it was left as it is." }); continue; }
        if (s.rsvp_ids?.length) await q.query("update rsvps set cleared_at = null where family_id = $1 and id = any($2::bigint[])", [f.id, s.rsvp_ids]);
        if (s.send_ids?.length) await q.query("update sends set cleared_at = null where family_id = $1 and id = any($2::bigint[])", [f.id, s.send_ids]);
        if (s.opened) await q.query("update opens set first_at = $2, last_at = $3, count = $4, cleared_at = null where family_id = $1",
          [f.id, s.opened.first_at, s.opened.last_at, s.opened.count]);
        restored.push(f.name);
      }
      await q.query("update resets set undone_at = now(), undone_by = $2 where id = $1", [r.id, by]);
      restored.sort((x, y) => x.localeCompare(y));
      return { restored, skipped };
    });
    await logEvent(w.id, { by, action: "undo_reset", details: { restored: res.restored.length, skipped: res.skipped.length } });
    return json({ ok: true, ...res });
  }

  // ---------------- invite design ----------------
  if (action === "invite" && M === "GET") {
    const inv = await one<any>("select draft, live, draft_updated_at, draft_updated_by, published_at, published_by from invites where wedding_id = $1", [w.id]);
    const assets = await query("select name, content_type, bytes, uploaded_at, uploaded_by from assets where wedding_id = $1 order by id", [w.id]);
    const fixed = inv ? { ...inv, draft: clampStoredScales(inv.draft), live: clampStoredScales(inv.live) } : inv;   // old 70% / Countdown 140% sizes, moved into today's bounds
    return json({ ...fixed, assets: assets.map((a) => ({ ...a, url: assetUrl(w.slug, a.name) })) });
  }

  if (action === "invite" && M === "PUT") {
    const b = await body(), by = await who();
    const draft = normalizeInvite(b.draft);
    const used = [...assetsUsed(draft)];
    if (used.length) {
      const have = new Set((await query("select name from assets where wedding_id = $1", [w.id])).map((r) => r.name));
      const missing = used.find((n) => !have.has(n));
      if (missing) throw new Bad(`The design uses a file that was not uploaded (${missing}). Please upload it again.`, 400, { code: "invalid_invite", field: "assets" });
    }
    const r = await tx(async (q) => {
      const [cur] = await q.query("select draft_updated_at, draft_updated_by from invites where wedding_id = $1 for update", [w.id]);
      if ("base" in b && b.force !== true) {
        const baseIso = baseTime(b.base);
        if ((cur?.draft_updated_at ?? null) !== baseIso)
          return { conflict: { by: cur?.draft_updated_by || "", at: cur?.draft_updated_at } };
      }
      const [row] = await q.query(
        `insert into invites (wedding_id, draft, live, draft_updated_at, draft_updated_by) values ($1,$2::jsonb,$2::jsonb,now(),$3)
         on conflict (wedding_id) do update set draft = excluded.draft, draft_updated_at = now(), draft_updated_by = excluded.draft_updated_by
         returning draft, draft_updated_at, draft_updated_by`, [w.id, JSON.stringify(draft), by]);
      return { row };
    });
    if (r.conflict) return json({ error: `${r.conflict.by || "Someone"} changed the design since you opened it.`, code: "changed", by: r.conflict.by, at: r.conflict.at }, 409);
    await logEvent(w.id, { by, action: "invite_saved" });
    return json({ ok: true, ...r.row });
  }

  if (action === "publish" && M === "POST") {
    const by = await who();
    const [r] = await query("update invites set live = draft, published_at = now(), published_by = $2 where wedding_id = $1 returning published_at, published_by", [w.id, by]);
    if (!r) throw new Bad("There is no design to publish yet.", 404, { code: "not_found" });
    // The names on the published invitation are the wedding's names: keep the manager's list, the Data page and the
    // helpers' page title in step with what guests see (the Design tab is where couples get renamed).
    await query(`update weddings w set groom = coalesce(nullif(trim(i.live->'config'->'couple'->>'groom'), ''), w.groom),
                                     bride = coalesce(nullif(trim(i.live->'config'->'couple'->>'bride'), ''), w.bride), updated_at = now()
                 from invites i where i.wedding_id = w.id and w.id = $1`, [w.id]);
    await logEvent(w.id, { by, action: "invite_published" });
    return json({ ok: true, ...r });
  }

  if (action === "discard-draft" && M === "POST") {
    const by = await who();
    const [r] = await query("update invites set draft = live, draft_updated_at = now(), draft_updated_by = $2 where wedding_id = $1 returning draft, draft_updated_at", [w.id, by]);
    if (!r) throw new Bad("There is no design yet.", 404, { code: "not_found" });
    await logEvent(w.id, { by, action: "invite_discarded" });
    return json({ ok: true, ...r });
  }

  if (action === "upload-asset" && M === "POST") {
    const b = await body(), by = await who();
    const type = ASSET_TYPES[String(b.content_type || "").toLowerCase()];
    if (!type) throw new Bad("This kind of file cannot be used. Pictures: PNG, JPG or WebP. Music: M4A or MP3. Video: MP4 or WebM.", 400, { code: "bad_type" });
    const b64 = String(b.data_base64 || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    if (!b64 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(b64)) throw new Bad("The file is empty or could not be read.", 400, { code: "bad_file" });
    if (b64.length * 0.75 > MAX_UPLOAD + 4) throw new Bad("This file is larger than 4 MB. Please use a smaller one.", 400, { code: "too_big" });
    const data = new Uint8Array(Buffer.from(b64, "base64"));
    if (!data.byteLength) throw new Bad("The file is empty or could not be read.", 400, { code: "bad_file" });
    if (data.byteLength > MAX_UPLOAD) throw new Bad("This file is larger than 4 MB. Please use a smaller one.", 400, { code: "too_big" });
    if (type.kind === "image" && !looksLikeImage(data, type.ext)) throw new Bad("This file is not a real picture of that type.", 400, { code: "bad_file" });
    // Claim the name in the database FIRST (unique per wedding), then write the file. Writing first would let a
    // random-suffix collision silently replace a picture another design already uses (served as "immutable").
    let name = "", key = "", rowId = 0;
    for (let attempt = 0; attempt < 5 && !rowId; attempt++) {
      name = assetName(String(b.name || "file"), type.ext);
      key = `${w.slug}/${name}`;
      const [row] = await query<{ id: number }>(
        `insert into assets (wedding_id, name, content_type, bytes, blob_key, uploaded_by) values ($1,$2,$3,$4,$5,$6)
         on conflict (wedding_id, name) do nothing returning id`,
        [w.id, name, String(b.content_type).toLowerCase().replace("image/jpg", "image/jpeg"), data.byteLength, key, by]);
      if (row) rowId = row.id;
    }
    if (!rowId) throw new Bad("Could not save the file just now. Please try again.", 500, { code: "server_error" });
    try { await blobs("assets").set(key, data); }
    catch (e) { await query("delete from assets where id = $1", [rowId]).catch(() => {}); throw e; }
    await logEvent(w.id, { by, action: "asset_uploaded", details: { name, bytes: data.byteLength } });
    return json({ ok: true, name, url: assetUrl(w.slug, name), bytes: data.byteLength, content_type: String(b.content_type).toLowerCase() });
  }

  if (action === "asset" && M === "DELETE") {
    const b = await body(), by = await who();
    const name = String(b.name || "");
    const a = await one<any>("select id, blob_key from assets where wedding_id = $1 and name = $2", [w.id, name]);
    if (!a) return json({ ok: true, already_deleted: true });
    const inv = await one<any>("select draft, live from invites where wedding_id = $1", [w.id]);
    const where = [assetsUsed(inv?.draft).has(name) && "draft", assetsUsed(inv?.live).has(name) && "live"].filter(Boolean);
    if (where.length) return json({ error: "This file is still used by the design. Remove it from the design (and publish) first.", code: "in_use", where }, 409);
    await query("delete from assets where id = $1", [a.id]);
    await blobs("assets").delete(a.blob_key);
    await logEvent(w.id, { by, action: "asset_deleted", details: { name } });
    return json({ ok: true });
  }

  // ---------------- settings tab ----------------
  if (action === "change-password" && M === "POST") {
    const b = await body(), by = await who();
    if (!sess.owner) {
      // same wrong-password lockout as login: a borrowed phone must not be able to guess the password here
      const scope = "wedding:" + w.slug;
      if (await isLockedOut(scope, req)) return json({ error: LOCKED_MESSAGE, code: "locked" }, 429);
      if (!(await verifyPassword(String(b.current ?? ""), w.password_hash))) {
        if (await recordFailure(scope, req)) return json({ error: LOCKED_MESSAGE, code: "locked" }, 429);
        return json({ error: "The current password is not right.", code: "wrong_password" }, 401);
      }
    }
    const pw = String(b.new ?? "");
    if (pw.trim().length < 4) throw new Bad("The new password must have at least 4 characters.", 400, { code: "too_short" });
    if (pw.length > 200) throw new Bad("The new password is too long.", 400, { code: "too_long" });
    const [nw] = await query<Wedding>("update weddings set password_hash = $2, session_version = session_version + 1, updated_at = now() where id = $1 returning *",
      [w.id, await hashPassword(pw)]);
    await logEvent(w.id, { by, action: "password_changed" });
    const extra: Record<string, string> = sess.script || sess.owner ? {} : { "set-cookie": helperCookie(nw, sess.by, isHttps(req)) };
    return json({ ok: true }, 200, extra);
  }

  if (action === "export" && M === "GET") return json(await exportWedding(w));

  throw NOT_FOUND_ACTION();
}

/**
 * Stamps cleared_at on a family's current answer(s), standing sends and open. Returns what was cleared
 * (ids, so undo can bring exactly those rows back) or null when there was nothing to clear.
 */
async function clearFamilyState(q: import("./_lib/_db.ts").Q, f: FamilyRow) {
  const rsvp = await q.query("update rsvps set cleared_at = now() where family_id = $1 and cleared_at is null returning id", [f.id]);
  const sends = await q.query("update sends set cleared_at = now() where family_id = $1 and cleared_at is null and undone_at is null returning id", [f.id]);
  const open = await q.query("update opens set cleared_at = now() where family_id = $1 and cleared_at is null returning first_at, last_at, count", [f.id]);
  if (!rsvp.length && !sends.length && !open.length) return null;
  return {
    family_id: f.id, token: f.token, name: f.name,
    rsvp_ids: rsvp.map((r) => r.id), send_ids: sends.map((r) => r.id), opened: open[0] ?? null,
    sent: sentOf(f.sends), response: f.response,
  };
}

function looksLikeImage(d: Uint8Array, ext: string) {
  if (ext === "png") return d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47;
  if (ext === "jpg") return d[0] === 0xff && d[1] === 0xd8;
  if (ext === "webp") return String.fromCharCode(...d.slice(0, 4)) === "RIFF" && String.fromCharCode(...d.slice(8, 12)) === "WEBP";
  return true;
}
const safePart = (s: string, max: number) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
/** "Slides/My Page 1.PNG" -> "slides/my-page-1-k3f9.png" (one folder allowed, random suffix, forced extension). */
export function assetName(raw: string, ext: string) {
  const parts = raw.split("/").filter(Boolean);
  const file = (parts.pop() || "file").replace(/\.[^.]*$/, "");
  const folder = parts.length ? safePart(parts[parts.length - 1], 40) : "";
  const stem = safePart(file, 40) || "file";
  return `${folder ? folder + "/" : ""}${stem}-${newToken(4).toLowerCase()}.${ext}`;
}

export default async (req: Request) => {
  try {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const slug = safeDecode(parts[0] || "").toLowerCase();
    const action = parts[3] || "";
    const w = await getWedding(slug);
    if (!w) throw NO_WEDDING();

    if (action === "login" && req.method === "POST") {
      const b = await readBody(req);
      const name = cleanName(b.name);
      if (!name) return json({ error: "Please type your name.", code: "name_required" }, 400);
      if (name.length > NAME_MAX_LOGIN) return json({ error: `Your name is too long (at most ${NAME_MAX_LOGIN} letters).`, code: "name_too_long" }, 400);
      if (RESERVED_HELPER_NAMES.has(name.toLowerCase())) return json({ error: "Please use your own name.", code: "name_reserved" }, 400);
      const scope = "wedding:" + w.slug;
      if (await isLockedOut(scope, req)) return json({ error: LOCKED_MESSAGE, code: "locked" }, 429);
      if (!(await verifyPassword(String(b.password ?? ""), w.password_hash))) {
        if (await recordFailure(scope, req)) return json({ error: LOCKED_MESSAGE, code: "locked" }, 429);
        return json({ error: "Wrong password. Try again.", code: "wrong_password" }, 401);
      }
      await clearFailures(scope, req);
      await logEvent(w.id, { by: name, action: "login" });
      return json({ ok: true, name }, 200, { "set-cookie": helperCookie(w, name, isHttps(req)) });
    }
    if (action === "logout") return json({ ok: true }, 200, { "set-cookie": clearHelperCookie(w.slug, isHttps(req)) });

    const sess = await adminSession(req, w);
    if (!sess && req.headers.get("x-wedding-key") && (await isLockedOut("wedding:" + w.slug, req))) return json({ error: LOCKED_MESSAGE, code: "locked" }, 429);
    if (!sess) return json({ error: "Please log in again.", code: "unauthorized" }, 401);
    if (sess.owner) sess.by = OWNER_NAME;
    return await handle(req, action, w, sess);
  } catch (e) { return errorReply(e); }
};

export const config: Config = { path: "/:slug/api/admin/:action" };
