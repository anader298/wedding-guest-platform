// =====================================================================================================
// _data.ts: reading families with their state, creating weddings, exporting and importing a wedding.
//
// What it is for:
//   - loadFamilies(): every family of a wedding with its current answer, standing sends and open count.
//   - familyView(): one family as the admin page sees it (links, WhatsApp / e-mail links, sent, ...).
//   - createWedding(): one new wedding with its default texts and invite (used by the manager and the seed).
//   - exportWedding(): the full JSON of one wedding (admin export, manager export/delete, backups).
//   - importWedding(): puts an exported wedding back into the database (manager restore).
// Who calls it: wedding-admin.ts, manage.ts, backup-nightly.ts, tools/seed.ts.
// What it reads/writes: every table except backups and schema_version.
//
// What NOT to change and why:
//   - "Current" means: the latest answer whose cleared_at is empty; sends whose undone_at and cleared_at
//     are empty; an open whose cleared_at is empty. Reset and undo depend on exactly this.
//   - exportWedding() output is what old backups contain. Only ever ADD fields to it, and keep
//     importWedding() able to read older files.
//
//notes:
// - Families point at rows by numeric id inside the database, but by token in exports: ids change when
//   a wedding is restored, tokens (the guests' links) never do.
// =====================================================================================================
import { query, one, tx, type Q } from "./_db.ts";
import { hashPassword } from "./_auth.ts";
import {
  Bad, iso, fillText, newWeddingInvite, defaultTexts, dateConfig, SETTINGS_KEYS, sideName, clone, fillCouple, nameKey,
  type Wedding, type SettingKey,
} from "./_wedding.ts";

export type FamilyRow = {
  id: number; wedding_id: number; token: string; name: string; name_key: string; side: "a" | "b"; max_guests: number;
  message: string | null; phone: string | null; email: string | null;
  created_at: string; created_by: string; updated_at: string; updated_by: string; removed_at: string | null; removed_by: string | null;
  response: { attending: boolean; guests: number; guest_names: string[]; note: string; at: string } | null;
  sends: { kind: "invite" | "reminder"; channel: string; by: string; at: string }[];
  opened: { first_at: string; last_at: string; count: number } | null;
};

const STATE_SQL = `
  (select row_to_json(r) from (select attending, guests, guest_names, note, at from rsvps
     where family_id = f.id and cleared_at is null order by at desc, id desc limit 1) r) as response,
  (select coalesce(json_agg(s order by s.at, s.id), '[]'::json) from (select id, kind, channel, by_name as by, at from sends
     where family_id = f.id and undone_at is null and cleared_at is null) s) as sends,
  (select row_to_json(o) from (select first_at, last_at, count from opens where family_id = f.id and cleared_at is null) o) as opened`;

function fixState(f: any): FamilyRow {
  if (f.response) f.response = { attending: !!f.response.attending, guests: Number(f.response.guests) || 0, guest_names: f.response.guest_names || [], note: f.response.note || "", at: iso(f.response.at) };
  f.sends = (f.sends || []).map((s: any) => ({ kind: s.kind, channel: s.channel, by: s.by, at: iso(s.at) }));
  if (f.opened) f.opened = { first_at: iso(f.opened.first_at), last_at: iso(f.opened.last_at), count: Number(f.opened.count) || 0 };
  return f;
}

/** Families of a wedding with their state. removed=false: the live list; true: the removed archive. */
export async function loadFamilies(weddingId: number, opts: { removed?: boolean; token?: string; q?: Q } = {}): Promise<FamilyRow[]> {
  const params: unknown[] = [weddingId];
  let where = `f.wedding_id = $1 and f.removed_at is ${opts.removed ? "not null" : "null"}`;
  if (opts.token) { params.push(opts.token); where = `f.wedding_id = $1 and f.token = $2`; }
  const run = opts.q ? opts.q.query.bind(opts.q) : query;
  const rows = await run(`select f.*, ${STATE_SQL} from families f where ${where} order by lower(f.name), f.token`, params);
  return rows.map(fixState);
}
export async function loadFamily(weddingId: number, token: string, q?: Q) {
  return (await loadFamilies(weddingId, { token, q }))[0] ?? null;
}

/** { invite_at, invite_by, invite_channel, reminder_at, ... } from the standing sends (latest per kind), or null. */
export function sentOf(sends: FamilyRow["sends"]) {
  const out: Record<string, string> = {};
  for (const s of sends) { out[`${s.kind}_at`] = s.at; out[`${s.kind}_by`] = s.by; out[`${s.kind}_channel`] = s.channel; }
  return Object.keys(out).length ? out : null;
}

export async function readSettings(weddingId: number, q?: Q) {
  const run = q ? q.query.bind(q) : query;
  const rows = await run("select key, value, updated_at, updated_by from settings where wedding_id = $1", [weddingId]);
  const out: Record<string, any> = {};
  const meta: Record<string, { updated_at: string; updated_by: string }> = {};
  for (const r of rows) {
    out[r.key] = r.value;
    if ((SETTINGS_KEYS as readonly string[]).includes(r.key) && r.updated_at) meta[r.key] = { updated_at: r.updated_at, updated_by: r.updated_by || "" };
  }
  const msgs: Record<string, any> = {};
  for (const k of SETTINGS_KEYS) msgs[k] = out[k] ?? "";
  return { messages: { ...msgs, meta }, reply_by: (out.reply_by as string) || null, raw: out };
}

/** One family as the admin page sees it. */
export function familyView(f: FamilyRow, w: Wedding, base: string, messages: Record<string, any>) {
  const link = `${base}/${w.slug}/?t=${f.token}`;
  const invText = fillText(f.message || messages[`wa_message_${f.side}`] || "{link}", f.name, link);
  const remText = fillText(messages[`wa_reminder_${f.side}`] || "{link}", f.name, link);
  const digits = f.phone ? f.phone.replace(/\D/g, "") : "";
  const wa = (t: string) => (digits ? `https://wa.me/${digits}?text=${encodeURIComponent(t)}` : null);
  const couple = `${w.groom} & ${w.bride}`;
  const mail = (subject: string, t: string) => (f.email ? `mailto:${f.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(t)}` : null);
  return {
    token: f.token, name: f.name, side: f.side, max_guests: f.max_guests, message: f.message, phone: f.phone, email: f.email,
    created_at: f.created_at, created_by: f.created_by, updated_at: f.updated_at, updated_by: f.updated_by,
    link, preview_link: `${link}&preview=1`,
    wa_link: wa(invText), wa_reminder_link: wa(remText),
    mail_link: mail(`${couple}: wedding invitation`, invText), mail_reminder_link: mail(`${couple}: a gentle reminder`, remText),
    sent: sentOf(f.sends), sends: f.sends, opened: f.opened, response: f.response,
  };
}

// ---------------- create ----------------
export type NewWedding = {
  slug: string; groom: string; bride: string; ar?: string; event_at: string; timezone: string; reply_by: string;
  password: string; notes?: string | null; by: string;
};
/** Creates the wedding, its default texts and invite, inside `q` (a transaction). Returns the row. */
export async function insertWedding(q: Q, o: NewWedding, invite?: { draft: any; live: any }) {
  const hash = await hashPassword(o.password);
  const [w] = await q.query<Wedding>(
    "insert into weddings (slug, groom, bride, event_at, timezone, password_hash, notes) values ($1,$2,$3,$4,$5,$6,$7) returning *",
    [o.slug, o.groom, o.bride, o.event_at, o.timezone, hash, o.notes ?? null],
  );
  const inv = newWeddingInvite({ groom: o.groom, bride: o.bride, ar: o.ar ?? `${o.groom} و ${o.bride}`, eventAt: o.event_at, timezone: o.timezone, replyBy: o.reply_by });
  const draft = invite?.draft ?? inv, live = invite?.live ?? inv;
  const texts = defaultTexts({ groom: o.groom, bride: o.bride, ar: draft.config.couple.ar, dateEn: draft.config.date.en, dateAr: draft.config.date.ar, replyBy: o.reply_by });
  for (const k of SETTINGS_KEYS) await q.query("insert into settings (wedding_id, key, value) values ($1,$2,$3)", [w.id, k, texts[k as SettingKey]]);
  await q.query("insert into settings (wedding_id, key, value, updated_at, updated_by) values ($1,'reply_by',$2,now(),$3)", [w.id, o.reply_by, o.by]);
  await q.query("insert into invites (wedding_id, draft, live) values ($1,$2::jsonb,$3::jsonb)", [w.id, JSON.stringify(draft), JSON.stringify(live)]);
  return w;
}

/** Puts this couple's names and date into a copied design (copy_from_slug). */
export function retargetInvite(inv: any, w: { groom: string; bride: string; event_at: string; timezone: string }) {
  const c = clone(inv);
  fillCouple(c, w.groom, w.bride, `${w.groom} و ${w.bride}`);
  c.config.date = dateConfig(w.event_at, w.timezone);
  return c;
}

// ---------------- export ----------------
/** Full JSON of one wedding. full=true (backups) also holds the password hash, helpers, uploads list and resets. */
export async function exportWedding(w: Wedding, full = false, q?: Q) {
  const run = q ? q.query.bind(q) : query;
  const id = w.id;
  const families = await run(
    `select token, name, side, max_guests, message, phone, email, created_at, created_by, updated_at, updated_by, removed_at, removed_by
     from families where wedding_id = $1 order by id`, [id]);
  const rsvps = await run(
    `select f.token, r.attending, r.guests, r.guest_names, r.note, r.at, r.cleared_at from rsvps r join families f on f.id = r.family_id
     where f.wedding_id = $1 order by r.id`, [id]);
  const sends = await run(
    `select f.token, s.kind, s.channel, s.by_name as by, s.at, s.undone_at, s.cleared_at from sends s join families f on f.id = s.family_id
     where f.wedding_id = $1 order by s.id`, [id]);
  const opens = await run(
    `select f.token, o.first_at, o.last_at, o.count, o.cleared_at from opens o join families f on f.id = o.family_id where f.wedding_id = $1`, [id]);
  const activity = await run(
    `select a.at, a.by_name as by, a.action, f.token, a.family_name, a.side, a.details from activity a left join families f on f.id = a.family_id
     where a.wedding_id = $1 order by a.id`, [id]);
  const settings: Record<string, any> = {};
  for (const r of await run("select key, value, updated_at, updated_by from settings where wedding_id = $1 order by key", [id]))
    settings[r.key] = { value: r.value, updated_at: r.updated_at, updated_by: r.updated_by };
  const invite = (await run("select draft, live, draft_updated_at, draft_updated_by, published_at, published_by from invites where wedding_id = $1", [id]))[0] ?? null;
  const out: any = {
    format: "twp-wedding", version: 1, exported_at: new Date().toISOString(),
    wedding: { slug: w.slug, groom: w.groom, bride: w.bride, event_at: w.event_at, timezone: w.timezone, status: w.status, notes: w.notes, created_at: w.created_at, updated_at: w.updated_at },
    families, rsvps, sends, opens, activity, settings, invite,
  };
  if (full) {
    out.wedding.password_hash = w.password_hash;
    out.wedding.session_version = w.session_version;
    out.helpers = await run("select name_key, name, first_seen, last_active, invites, reminders, edits, logins from helpers where wedding_id = $1", [id]);
    out.assets = await run("select name, content_type, bytes, blob_key, uploaded_at, uploaded_by from assets where wedding_id = $1 order by id", [id]);
    out.resets = await run(
      `select r.kind, f.token, r.at, r.by_name as by, r.snapshot, r.undone_at, r.undone_by from resets r left join families f on f.id = r.family_id
       where r.wedding_id = $1 order by r.id`, [id]);
  }
  return out;
}

// ---------------- import (restore) ----------------
/**
 * Creates wedding `slug` from an export (full or not) inside transaction `q`. Returns the new row.
 * Without a password hash in the file (a plain export) the password becomes "wedding".
 * `assetsPresent` = names of uploaded files that really exist for the new slug; design slots pointing at
 * missing files fall back to the template picture.
 */
export async function importWedding(q: Q, data: any, slug: string, assetsPresent: Set<string>) {
  const w0 = data?.wedding;
  if (!w0 || !Array.isArray(data.families)) throw new Bad("This backup file is not readable.", 400, { code: "bad_backup" });
  const hash = w0.password_hash || (await hashPassword("wedding"));
  const [w] = await q.query<Wedding>(
    `insert into weddings (slug, groom, bride, event_at, timezone, status, password_hash, session_version, notes, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10::timestamptz, now())) returning *`,
    [slug, w0.groom, w0.bride, w0.event_at, w0.timezone || "Asia/Beirut", w0.status === "archived" ? "archived" : "live", hash,
     (Number(w0.session_version) || 1) + 1, w0.notes ?? null, w0.created_at ?? null],
  );
  const ids = new Map<string, number>();
  for (const f of data.families) {
    const [r] = await q.query(
      `insert into families (wedding_id, token, name, name_key, side, max_guests, message, phone, email, created_at, created_by, updated_at, updated_by, removed_at, removed_by)
       values ($1,$2,$3,$15,$4,$5,$6,$7,$8,coalesce($9::timestamptz,now()),$10,coalesce($11::timestamptz,now()),$12,$13,$14) returning id`,
      [w.id, f.token, f.name, f.side, f.max_guests, f.message ?? null, f.phone ?? null, f.email ?? null, f.created_at ?? null, f.created_by ?? "",
       f.updated_at ?? null, f.updated_by ?? "", f.removed_at ?? null, f.removed_by ?? null, nameKey(f.name)],
    );
    ids.set(f.token, r.id);
  }
  for (const r of data.rsvps || []) if (ids.has(r.token))
    await q.query("insert into rsvps (family_id, attending, guests, guest_names, note, at, cleared_at) values ($1,$2,$3,$4::jsonb,$5,$6,$7)",
      [ids.get(r.token), !!r.attending, Number(r.guests) || 0, JSON.stringify(r.guest_names || []), r.note || "", r.at, r.cleared_at ?? null]);
  for (const s of data.sends || []) if (ids.has(s.token))
    await q.query("insert into sends (family_id, kind, channel, by_name, at, undone_at, cleared_at) values ($1,$2,$3,$4,$5,$6,$7)",
      [ids.get(s.token), s.kind, s.channel || "copy", s.by || "", s.at, s.undone_at ?? null, s.cleared_at ?? null]);
  for (const o of data.opens || []) if (ids.has(o.token))
    await q.query("insert into opens (family_id, first_at, last_at, count, cleared_at) values ($1,$2,$3,$4,$5)",
      [ids.get(o.token), o.first_at, o.last_at, Number(o.count) || 1, o.cleared_at ?? null]);
  for (const a of data.activity || [])
    await q.query("insert into activity (wedding_id, at, by_name, action, family_id, family_name, side, details) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [w.id, a.at, a.by || "", a.action, a.token ? ids.get(a.token) ?? null : null, a.family_name ?? null, a.side ?? null, JSON.stringify(a.details || {})]);
  for (const [k, v] of Object.entries<any>(data.settings || {}))
    await q.query("insert into settings (wedding_id, key, value, updated_at, updated_by) values ($1,$2,$3,$4,$5)", [w.id, k, String(v?.value ?? ""), v?.updated_at ?? null, v?.updated_by ?? null]);
  for (const h of data.helpers || [])
    await q.query("insert into helpers (wedding_id, name_key, name, first_seen, last_active, invites, reminders, edits, logins) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [w.id, h.name_key, h.name, h.first_seen, h.last_active, h.invites || 0, h.reminders || 0, h.edits || 0, h.logins || 0]);
  for (const a of data.assets || []) if (assetsPresent.has(a.name))
    await q.query("insert into assets (wedding_id, name, content_type, bytes, blob_key, uploaded_at, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7)",
      [w.id, a.name, a.content_type, a.bytes, `${slug}/${a.name}`, a.uploaded_at, a.uploaded_by || ""]);
  for (const r of data.resets || [])
    await q.query("insert into resets (wedding_id, kind, family_id, at, by_name, snapshot, undone_at, undone_by) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
      [w.id, r.kind, r.token ? ids.get(r.token) ?? null : null, r.at, r.by || "", JSON.stringify({ ...(r.snapshot || {}), stale_ids: true }), r.undone_at ?? new Date().toISOString(), r.undone_by ?? "restore"]);
  const inv = data.invite;
  const fix = (d: any) => {
    if (!d) return d;
    const c = clone(d);
    for (const k of Object.keys(c.assets || {})) if (c.assets[k] && !assetsPresent.has(c.assets[k])) c.assets[k] = null;
    return c;
  };
  if (inv) {
    await q.query(
      "insert into invites (wedding_id, draft, live, draft_updated_at, draft_updated_by, published_at, published_by) values ($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7)",
      [w.id, JSON.stringify(fix(inv.draft)), JSON.stringify(fix(inv.live)), inv.draft_updated_at ?? null, inv.draft_updated_by ?? null, inv.published_at ?? null, inv.published_by ?? null]);
  }
  return { wedding: w, families: ids.size };
}

/** Quick numbers of an export: families (live), answered, sent. */
export function exportCounts(data: any) {
  const live = new Set((data.families || []).filter((f: any) => !f.removed_at).map((f: any) => f.token));
  const answered = new Set((data.rsvps || []).filter((r: any) => !r.cleared_at && live.has(r.token)).map((r: any) => r.token));
  const sent = new Set((data.sends || []).filter((s: any) => !s.cleared_at && !s.undone_at && s.kind === "invite" && live.has(s.token)).map((s: any) => s.token));
  return { families: live.size, answered: answered.size, sent: sent.size };
}

export { sideName, one, tx };
