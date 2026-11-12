// =====================================================================================================
// manage.ts: /api/manage/<action>   (the owner only: the person who runs Wedding Guest Platform)
//
// What it is for: the manager page: log in, list weddings with their numbers, create / edit / archive /
//   delete a wedding, set a wedding's password, all-weddings data view, the consistency check, backups
//   and restore, health. Full contract: docs/API.md section 3.
// Who calls it: site/manage/index.html (owner cookie twp_owner).
// What it reads/writes: every table; Blobs stores "assets" (copy/delete a wedding's files) and "backups".
//
// What NOT to change and why:
//   - No OWNER_PASSWORD on Netlify = every login is refused (fails closed). Do not add a fallback password.
//   - Login keeps the wrong-password lockout (429 after 5 wrong tries in 10 minutes, for 15 minutes).
//   - delete needs confirm = the slug, and restoring OVER an existing wedding needs confirm = its slug.
//     Restore always previews first (preview defaults to true) and saves a safety copy before replacing.
//   - delete returns the full export so the page can download it before anything is gone for good.
//
//notes:
// - The owner's actions inside a wedding are logged with by = "Owner".
// - archive also takes a backup of that wedding (kind "archive", kept for ever); backups lists every kept
//   backup with kind / kept_forever / kept_until; health includes github_backup (the copy to GitHub).
// - Changing names or the date here also updates those fields in the wedding's draft AND live design;
//   the WhatsApp texts are NOT rewritten (helpers may have edited them).
// =====================================================================================================
import type { Config } from "@netlify/functions";
import { query, one, tx, schemaVersion, isUniqueViolation } from "./_lib/_db.ts";
import { isOwner, checkOwnerPassword, ownerPassword, ownerCookie, clearOwnerCookie, isHttps, hashPassword, OWNER_NAME, isLockedOut, recordFailure, clearFailures, LOCKED_MESSAGE } from "./_lib/_auth.ts";
import {
  json, Bad, errorReply, readBody, getWedding, NO_WEDDING, NOT_FOUND_ACTION, logEvent, links, weddingView, vSlug, vCoupleName,
  vDate, vTime, vTimezone, zonedToUtc, localParts, dateConfig, replyByTexts, defaultReplyBy, fillCouple, isIntlPhone, sideName,
  type Wedding,
} from "./_lib/_wedding.ts";
import { insertWedding, retargetInvite, loadFamilies, sentOf, readSettings, exportWedding, importWedding, exportCounts } from "./_lib/_data.ts";
import { blobs, storeName, deployInfo } from "./_lib/_blobs.ts";
import { runBackup, readBackup, describeBackups, BACKUP_KEY_RE } from "./_lib/_backup.ts";
import { githubConfig } from "./_lib/_github-backup.ts";

const pad = (n: number) => String(n).padStart(2, "0");

async function weddingBySlug(v: unknown) {
  const w = await getWedding(String(v ?? "").trim().toLowerCase());
  if (!w) throw NO_WEDDING();
  return w;
}
async function replyByOf(w: Wedding) { return (await readSettings(w.id)).reply_by; }

async function copyAssets(fromSlug: string, fromId: number, toSlug: string, toId: number, by: string) {
  const store = blobs("assets");
  for (const a of await query("select name, content_type, bytes, blob_key from assets where wedding_id = $1", [fromId])) {
    const data = await store.get(a.blob_key);
    if (!data) continue;
    await store.set(`${toSlug}/${a.name}`, data);
    await query("insert into assets (wedding_id, name, content_type, bytes, blob_key, uploaded_by) values ($1,$2,$3,$4,$5,$6) on conflict do nothing",
      [toId, a.name, a.content_type, a.bytes, `${toSlug}/${a.name}`, by]);
  }
  void fromSlug;
}

const familiesState = `
  select f.wedding_id, f.max_guests,
    exists (select 1 from sends s where s.family_id = f.id and s.kind = 'invite' and s.undone_at is null and s.cleared_at is null) as sent,
    exists (select 1 from opens o where o.family_id = f.id and o.cleared_at is null) as opened,
    r.attending, r.guests
  from families f
  left join lateral (select attending, guests from rsvps where family_id = f.id and cleared_at is null order by at desc, id desc limit 1) r on true
  where f.removed_at is null`;

/** The Health line's GitHub part: is it set up, when did it last work, what is wrong (or about to be). */
function githubHealth(gh: any) {
  const cfg = githubConfig();
  const last = gh?.last ?? null;
  const token_expires_at: string | null = gh?.token_expires_at ?? null;
  let last_error: string | null = null;
  if (cfg.half) last_error = "Only one of the two GitHub settings (BACKUP_GITHUB_REPO, BACKUP_GITHUB_TOKEN) is on Netlify, so no copy is made.";
  else if (cfg.configured && last && !last.ok) last_error = String(last.error || "The last copy to GitHub failed.");
  else if (cfg.configured && token_expires_at) {
    const days = Math.floor((Date.parse(token_expires_at) - Date.now()) / 86400_000);
    if (days < 0) last_error = "The GitHub token has expired. Make a new one (see docs/BACKUPS.md).";
    else if (days < 30) last_error = `The GitHub token stops working in ${days} ${days === 1 ? "day" : "days"} (${token_expires_at.slice(0, 10)}). Make a new one (see docs/BACKUPS.md).`;
  }
  return { configured: cfg.configured, last_ok_at: cfg.configured ? gh?.last_ok_at ?? null : null, last_error, token_expires_at: cfg.configured ? token_expires_at : null };
}

async function handle(req: Request, action: string): Promise<Response> {
  const M = req.method;
  const qs = new URL(req.url).searchParams;
  const body = () => readBody(req);
  const by = OWNER_NAME;

  if (action === "me" && M === "GET") return json({ ok: true, owner: true });

  if (action === "weddings" && M === "GET") {
    const ws = await query<Wedding>("select * from weddings order by (status = 'archived'), event_at, slug");
    const counts = new Map((await query(
      `select wedding_id, count(*)::int as families, count(*) filter (where sent)::int as sent, count(*) filter (where opened)::int as opened,
         count(*) filter (where attending is not null)::int as answered, count(*) filter (where attending)::int as coming,
         count(*) filter (where attending = false)::int as not_coming, coalesce(sum(max_guests), 0)::int as seats,
         coalesce(sum(guests) filter (where attending), 0)::int as guests_coming
       from (${familiesState}) x group by wedding_id`)).map((r) => [r.wedding_id, r]));
    const last = new Map((await query(
      "select distinct on (wedding_id) wedding_id, by_name as by, action, at from activity order by wedding_id, id desc")).map((r) => [r.wedding_id, r]));
    const pub = new Map((await query("select wedding_id, published_at from invites")).map((r) => [r.wedding_id, r.published_at]));
    const replyBy = new Map((await query("select wedding_id, value from settings where key = 'reply_by'")).map((r) => [r.wedding_id, r.value]));
    const zero = { families: 0, sent: 0, opened: 0, answered: 0, coming: 0, not_coming: 0, seats: 0, guests_coming: 0 };
    return json({ weddings: ws.map((w) => {
      const c = counts.get(w.id); const l = last.get(w.id);
      const { wedding_id: _x, ...cc } = c || ({} as any);
      return { ...weddingView(w, replyBy.get(w.id) ?? null), counts: c ? cc : zero, last_activity: l ? { by: l.by, action: l.action, at: l.at } : null,
        published_at: pub.get(w.id) ?? null, links: links(req, w.slug) };
    }) });
  }

  if (action === "create" && M === "POST") {
    const b = await body();
    const slug = vSlug(b.slug);
    const groom = vCoupleName(b.groom, "groom"), bride = vCoupleName(b.bride, "bride");
    const date = vDate(b.event_date, "wedding date"), time = vTime(b.event_time), tz = vTimezone(b.timezone);
    const replyBy = b.reply_by ? vDate(b.reply_by, "reply-by date") : defaultReplyBy(date);
    const password = b.password === undefined || b.password === null || b.password === "" ? "wedding" : String(b.password);
    if (password.trim().length < 4) throw new Bad("The password must have at least 4 characters.", 400, { code: "too_short" });
    if (await one("select 1 from weddings where slug = $1", [slug])) throw new Bad("A wedding with this web address already exists.", 409, { code: "slug_taken" });
    const src = b.copy_from_slug ? await weddingBySlug(b.copy_from_slug) : null;
    const eventAt = zonedToUtc(date, time, tz);
    let invite: { draft: any; live: any } | undefined;
    if (src) {
      const si = await one<any>("select draft, live from invites where wedding_id = $1", [src.id]);
      if (si) {
        const t = { groom, bride, event_at: eventAt, timezone: tz };
        invite = { draft: retargetInvite(si.draft, t), live: retargetInvite(si.live, t) };
        const r = replyByTexts(replyBy);
        for (const d of [invite.draft, invite.live]) { d.config.rsvp.replyByEn = r.replyByEn; d.config.rsvp.replyByAr = r.replyByAr; }
      }
    }
    let w: Wedding;
    try {
      w = await tx((q) => insertWedding(q, { slug, groom, bride, event_at: eventAt, timezone: tz, reply_by: replyBy, password, notes: b.notes ? String(b.notes).slice(0, 2000) : null, by }, invite));
    } catch (e: any) {
      if (/duplicate key/.test(String(e?.message))) throw new Bad("A wedding with this web address already exists.", 409, { code: "slug_taken" });
      throw e;
    }
    if (src) await copyAssets(src.slug, src.id, slug, w.id, by);
    await logEvent(w.id, { by, action: "wedding_created", details: { copied_from: src?.slug ?? null } });
    return json({ ok: true, wedding: weddingView(w, replyBy), links: { ...links(req, slug), password } });
  }

  if (action === "update" && M === "POST") {
    const b = await body();
    const w = await weddingBySlug(b.slug);
    const p = localParts(w.event_at, w.timezone);
    const groom = b.groom !== undefined ? vCoupleName(b.groom, "groom") : w.groom;
    const bride = b.bride !== undefined ? vCoupleName(b.bride, "bride") : w.bride;
    const date = b.event_date !== undefined ? vDate(b.event_date, "wedding date") : `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    const time = b.event_time !== undefined ? vTime(b.event_time) : `${pad(p.h)}:${pad(p.mi)}`;
    const tz = b.timezone !== undefined ? vTimezone(b.timezone) : w.timezone;
    const replyBy = b.reply_by !== undefined && b.reply_by !== null && b.reply_by !== "" ? vDate(b.reply_by, "reply-by date") : null;
    const notes = b.notes !== undefined ? (b.notes === null ? null : String(b.notes).slice(0, 2000)) : w.notes;
    const eventAt = zonedToUtc(date, time, tz);
    const namesChanged = groom !== w.groom || bride !== w.bride;
    const dateChanged = eventAt !== w.event_at || tz !== w.timezone;
    const changes: string[] = [];
    if (groom !== w.groom) changes.push(`groom ${w.groom} → ${groom}`);
    if (bride !== w.bride) changes.push(`bride ${w.bride} → ${bride}`);
    if (dateChanged) changes.push("date or time changed");
    if (replyBy) changes.push(`reply-by ${replyBy}`);
    if (notes !== w.notes) changes.push("notes changed");
    const nw = await tx(async (q) => {
      const [row] = await q.query<Wedding>("update weddings set groom = $2, bride = $3, event_at = $4, timezone = $5, notes = $6, updated_at = now() where id = $1 returning *",
        [w.id, groom, bride, eventAt, tz, notes]);
      if (replyBy) await q.query(
        `insert into settings (wedding_id, key, value, updated_at, updated_by) values ($1,'reply_by',$2,now(),$3)
         on conflict (wedding_id, key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`, [w.id, replyBy, by]);
      if (namesChanged || dateChanged || replyBy) {
        const [inv] = await q.query("select draft, live from invites where wedding_id = $1 for update", [w.id]);
        if (inv) {
          for (const d of [inv.draft, inv.live]) {
            if (namesChanged) fillCouple(d, groom, bride);
            if (dateChanged) d.config.date = dateConfig(eventAt, tz);
            if (replyBy) { const r = replyByTexts(replyBy); d.config.rsvp.replyByEn = r.replyByEn; d.config.rsvp.replyByAr = r.replyByAr; }
          }
          await q.query("update invites set draft = $2::jsonb, live = $3::jsonb where wedding_id = $1", [w.id, JSON.stringify(inv.draft), JSON.stringify(inv.live)]);
        }
      }
      return row;
    });
    if (changes.length) await logEvent(w.id, { by, action: "wedding_updated", details: { changes } });
    return json({ ok: true, wedding: weddingView(nw, await replyByOf(nw)), invite_updated: namesChanged || dateChanged || !!replyBy });
  }

  if (action === "set-password" && M === "POST") {
    const b = await body();
    const w = await weddingBySlug(b.slug);
    const pw = String(b.password ?? "");
    if (pw.trim().length < 4) throw new Bad("The password must have at least 4 characters.", 400, { code: "too_short" });
    if (pw.length > 200) throw new Bad("The password is too long.", 400, { code: "too_long" });
    await query("update weddings set password_hash = $2, session_version = session_version + 1, updated_at = now() where id = $1", [w.id, await hashPassword(pw)]);
    await logEvent(w.id, { by, action: "password_set" });
    return json({ ok: true });
  }

  if ((action === "archive" || action === "unarchive") && M === "POST") {
    const b = await body();
    const w = await weddingBySlug(b.slug);
    const [nw] = await query<Wedding>("update weddings set status = $2, updated_at = now() where id = $1 returning *", [w.id, action === "archive" ? "archived" : "live"]);
    if (nw.status !== w.status) await logEvent(w.id, { by, action: action === "archive" ? "archived" : "unarchived" });
    // archiving takes a backup of that wedding, kept for ever (and copied to GitHub when set up); a failed backup never blocks archiving
    let backup: any = null;
    if (action === "archive" && nw.status !== w.status) {
      const row = await runBackup("archive", nw).catch((e) => { console.error("archive backup failed", e); return null; });
      backup = row ? { ok: row.ok, blob_key: row.blob_key, error: row.error } : { ok: false, blob_key: null, error: "The backup could not be recorded." };
    }
    return json({ ok: true, wedding: weddingView(nw, await replyByOf(nw)), ...(backup ? { backup } : {}) });
  }

  if (action === "export" && M === "GET") return json(await exportWedding(await weddingBySlug(qs.get("slug"))));

  if (action === "delete" && M === "POST") {
    const b = await body();
    const w = await weddingBySlug(b.slug);
    if (String(b.confirm ?? "") !== w.slug) throw new Bad(`To delete, type the web address exactly: ${w.slug}`, 400, { code: "confirm_required" });
    const exp = await exportWedding(w);
    await query("delete from weddings where id = $1", [w.id]);
    const store = blobs("assets");
    for (const k of await store.list(`${w.slug}/`)) await store.delete(k).catch((e) => console.error("asset not deleted", k, e));
    return json({ ok: true, export: exp });
  }

  if (action === "data" && M === "GET") {
    const slug = qs.get("slug"), side = qs.get("side"), status = qs.get("status"), q = (qs.get("q") || "").trim().toLowerCase();
    if (status && !["not_sent", "sent", "opened", "answered", "coming", "not_coming"].includes(status)) throw new Bad("Unknown status filter.");
    if (side && side !== "a" && side !== "b") throw new Bad('Side must be "a" or "b".');
    const ws = slug ? [await weddingBySlug(slug)] : await query<Wedding>("select * from weddings order by event_at, slug");
    const base = links(req, "x").invite_base.replace(/\/x\/$/, "");
    const rows: any[] = [];
    for (const w of ws) {
      const label = `${w.groom} & ${w.bride}`;
      for (const f of await loadFamilies(w.id)) {
        if (side && f.side !== side) continue;
        const sent = sentOf(f.sends);
        const r = f.response;
        if (status === "not_sent" && sent?.invite_at) continue;
        if (status === "sent" && !sent?.invite_at) continue;
        if (status === "opened" && !f.opened) continue;
        if (status === "answered" && !r) continue;
        if (status === "coming" && !r?.attending) continue;
        if (status === "not_coming" && (!r || r.attending)) continue;
        if (q && !f.name.toLowerCase().includes(q) && !label.toLowerCase().includes(q) && !w.slug.includes(q)) continue;
        rows.push({ wedding: label, slug: w.slug, family: f.name, side: f.side, side_name: sideName(f.side, w), seats: f.max_guests,
          sent_at: sent?.invite_at ?? null, sent_by: sent?.invite_by ?? null, opened_count: f.opened?.count ?? 0,
          answer: r ? (r.attending ? "coming" : "not_coming") : null, guests: r?.guests ?? 0, guest_names: r?.guest_names ?? [], note: r?.note ?? "",
          answered_at: r?.at ?? null, link: `${base}/${w.slug}/?t=${f.token}`, phone: f.phone, email: f.email });
      }
    }
    return json({ rows });
  }

  if (action === "check" && M === "GET") {
    const slug = qs.get("slug");
    const ws = slug ? [await weddingBySlug(slug)] : await query<Wedding>("select * from weddings where status = 'live' order by event_at, slug");
    const issues: any[] = [];
    const nowMs = Date.now();
    for (const w of ws) {
      if (w.status !== "live") continue;
      const fams = await loadFamilies(w.id);
      const replyBy = await replyByOf(w);
      const groups = new Map<string, typeof fams>();
      for (const f of fams) {
        const k = f.name_key.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\b(the|family|families)\b/g, " ").replace(/\s+/g, " ").trim();
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(f);
      }
      for (const g of groups.values()) if (g.length > 1)
        issues.push({ slug: w.slug, family: g.map((f) => f.name).join(", "), kind: "duplicate_name", text: `These look like the same family: ${g.map((f) => `"${f.name}"`).join(" and ")}.` });
      const deadline = replyBy ? Date.parse(zonedToUtc(replyBy, "23:59", w.timezone)) + 59_999 : null;
      for (const f of fams) {
        const r = f.response;
        if (r?.attending && r.guests > f.max_guests)
          issues.push({ slug: w.slug, family: f.name, token: f.token, kind: "over_capacity", text: `${f.name} answered for ${r.guests} guests but has only ${f.max_guests} seats.` });
        const firstInvite = f.sends.find((s) => s.kind === "invite");
        if (firstInvite && !f.opened && nowMs - Date.parse(firstInvite.at) > 14 * 86400_000)
          issues.push({ slug: w.slug, family: f.name, token: f.token, kind: "never_opened", text: `${f.name} was sent the invitation more than 2 weeks ago and has not opened it.` });
        if (r && deadline && Date.parse(r.at) > deadline)
          issues.push({ slug: w.slug, family: f.name, token: f.token, kind: "late_answer", text: `${f.name} answered after the reply-by date (${replyBy}).` });
        if (f.phone && !isIntlPhone(f.phone))
          issues.push({ slug: w.slug, family: f.name, token: f.token, kind: "bad_phone", text: `${f.name}'s phone number has no country code (it should start with +), so the WhatsApp button may not work.` });
      }
      const ev = Date.parse(w.event_at);
      if (ev > nowMs && ev - nowMs <= 7 * 86400_000) {
        const h = await one("select 1 from helpers where wedding_id = $1 and last_active > now() - interval '7 days' limit 1", [w.id]);
        if (!h) issues.push({ slug: w.slug, kind: "no_helpers", text: "The wedding is less than a week away and no helper has used the admin page in the last 7 days." });
      }
      const inv = await one<any>("select published_at from invites where wedding_id = $1", [w.id]);
      if (!inv?.published_at) issues.push({ slug: w.slug, kind: "not_published", text: "The invite design was never published, so guests see the starting design." });
    }
    return json({ issues });
  }

  if (action === "backup-now" && M === "POST") {
    const row = await runBackup("manual");
    return json({ ok: row.ok, backup: row }, row.ok ? 200 : 500);
  }
  if (action === "backups" && M === "GET") {
    // every backup still kept (prune removes old nightly rows with their files), with how long each one is kept
    return json({ backups: describeBackups(await query("select * from backups order by at desc, id desc")) });
  }

  if (action === "restore" && M === "POST") {
    const b = await body();
    const key = String(b.blob_key ?? "");
    if (!BACKUP_KEY_RE.test(key)) throw new Bad("This backup was not found.", 404, { code: "not_found" });
    const doc = await readBackup(key);
    if (!doc || !Array.isArray(doc.weddings)) throw new Bad("This backup was not found or cannot be read.", 404, { code: "not_found" });
    const slug = String(b.slug ?? "").trim().toLowerCase();
    const data = doc.weddings.find((x: any) => x?.wedding?.slug === slug);
    if (!data) throw new Bad("This wedding is not inside that backup.", 404, { code: "not_found" });
    const target = b.into_slug && String(b.into_slug).trim().toLowerCase() !== slug ? vSlug(b.into_slug) : slug;
    const intoNew = target !== slug;
    const current = await getWedding(target);
    if (intoNew && current) throw new Bad("A wedding with this web address already exists. Pick a new address to restore into.", 409, { code: "slug_taken" });

    const store = blobs("assets");
    const present = new Set<string>(), missing: string[] = [];
    for (const a of data.assets || []) ((await store.get(a.blob_key || `${slug}/${a.name}`)) ? present.add(a.name) : missing.push(a.name));

    if (b.preview !== false) {
      const cur = current ? await exportWedding(current) : null;
      const names = (d: any) => new Map<string, string>((d?.families || []).filter((f: any) => !f.removed_at).map((f: any) => [f.token, f.name]));
      const bn = names(data), cn = names(cur);
      const ans = (d: any) => {
        const m = new Map<string, string>();
        for (const r of d?.rsvps || []) if (!r.cleared_at) m.set(r.token, `${r.attending}:${r.guests}`); // rows are in time order; the last wins
        return m;
      };
      const ba = ans(data), ca = ans(cur);
      let differ = 0;
      for (const t of new Set([...ba.keys(), ...ca.keys()])) if (bn.has(t) && cn.has(t) && ba.get(t) !== ca.get(t)) differ++;
      return json({ ok: true, preview: true, target, exists: !!current, backup_at: doc.at, backup: exportCounts(data), current: cur ? exportCounts(cur) : null,
        will_add: [...bn].filter(([t]) => !cn.has(t)).map(([, n]) => n).sort(), will_remove: [...cn].filter(([t]) => !bn.has(t)).map(([, n]) => n).sort(),
        answers_differ: differ, missing_pictures: missing });
    }

    let safety: any = null;
    if (current) {
      if (String(b.confirm ?? "") !== target) throw new Bad(`Restoring replaces everything in this wedding. To go ahead, type the web address exactly: ${target}`, 400, { code: "confirm_required" });
      safety = await runBackup("before-restore", current);
      if (!safety.ok) throw new Bad("A safety copy of the current data could not be made, so nothing was restored.", 500, { code: "backup_failed" });
    }
    let r: Awaited<ReturnType<typeof importWedding>>;
    try {
      r = await tx(async (q) => {
        if (current) {
          // the wedding we checked (and typed the confirm for) must still be the one at this address
          const [still] = await q.query("delete from weddings where id = $1 and slug = $2 returning id", [current.id, target]);
          if (!still) throw new Bad("This wedding changed while you were restoring. Please look at the preview again.", 409, { code: "changed" });
        }
        return importWedding(q, data, target, present);
      });
    } catch (e) {
      // two restores into the same new address at once: the second one finds the address taken
      if (isUniqueViolation(e)) throw new Bad("A wedding with this web address already exists. Pick a new address to restore into.", 409, { code: "slug_taken" });
      throw e;
    }
    // copy the pictures only once the new address is really ours (copying first could write into a wedding that won a race)
    if (intoNew) for (const name of present) {
      const a = data.assets.find((x: any) => x.name === name);
      const bytes = await store.get(a.blob_key || `${slug}/${name}`);
      if (bytes) await store.set(`${target}/${name}`, bytes);
    }
    await logEvent(r.wedding.id, { by, action: "restored_from_backup", details: { backup: key, from: slug } });
    return json({ ok: true, preview: false, target, families: r.families, safety_backup: safety?.blob_key ?? null, missing_pictures: missing });
  }

  if (action === "health" && M === "GET") {
    let db_ok = true, version = 0, weddings = 0, families = 0, last_backup = null, gh: any = null;
    try {
      version = await schemaVersion();
      weddings = (await one<any>("select count(*)::int as n from weddings"))!.n;
      families = (await one<any>("select count(*)::int as n from families where removed_at is null"))!.n;
      last_backup = await one("select at, ok, blob_key, error from backups order by id desc limit 1");
      gh = await one<any>(`select
          (select github from backups where github is not null order by id desc limit 1) as last,
          (select max(github->>'at') from backups where github->>'ok' = 'true') as last_ok_at,
          (select github->>'token_expires_at' from backups where github->>'token_expires_at' is not null order by id desc limit 1) as token_expires_at`);
    } catch (e) { console.error(e); db_ok = false; }
    // which file stores this deploy writes to: "assets"/"backups" on the live site, their own copies on a preview
    const d = deployInfo();
    const storage = { context: d?.context ?? null, assets: storeName("assets"), backups: storeName("backups") };
    return json({ ok: db_ok, db_ok, version, weddings, families, last_backup, storage, github_backup: githubHealth(gh) });
  }

  throw NOT_FOUND_ACTION();
}

export default async (req: Request) => {
  try {
    const action = new URL(req.url).pathname.split("/").filter(Boolean)[2] || "";
    if (action === "login" && req.method === "POST") {
      const b = await readBody(req);
      if (!ownerPassword()) return json({ error: "Owner login is switched off because OWNER_PASSWORD is not set on Netlify.", code: "owner_password_missing" }, 503);
      if (await isLockedOut("owner", req)) return json({ error: LOCKED_MESSAGE, code: "locked" }, 429);
      if (!checkOwnerPassword(String(b.password ?? ""))) {
        if (await recordFailure("owner", req)) return json({ error: LOCKED_MESSAGE, code: "locked" }, 429);
        return json({ error: "Wrong password. Try again.", code: "wrong_password" }, 401);
      }
      await clearFailures("owner", req);
      return json({ ok: true }, 200, { "set-cookie": ownerCookie(isHttps(req)) });
    }
    if (action === "logout") return json({ ok: true }, 200, { "set-cookie": clearOwnerCookie(isHttps(req)) });
    if (!isOwner(req)) return json({ error: "Please log in again.", code: "unauthorized" }, 401);
    return await handle(req, action);
  } catch (e) { return errorReply(e); }
};

export const config: Config = { path: "/api/manage/:action" };
