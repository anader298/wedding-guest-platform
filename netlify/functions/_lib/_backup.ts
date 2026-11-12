// =====================================================================================================
// _backup.ts: making full backups of the database, keeping them, and reading them back.
//
// What it is for: runBackup() writes a full JSON copy of the weddings into Blobs store "backups", records
//   it in the backups table, and (when the two GitHub settings exist) also writes a readable copy of every
//   wedding to the owner's private GitHub repository (_github-backup.ts). prune() removes old nightly copies.
// Who calls it: backup-nightly.ts (every night at 03:00 UTC) and manage.ts ("Back up now", the safety copy
//   taken just before a restore, and the copy taken when a wedding is archived).
// What it reads/writes: all wedding tables (read), table backups (write), Blobs store "backups", GitHub.
//
// How long backups are kept (plain words in docs/BACKUPS.md):
//   - nightly (<date>/all.json): every one for KEEP_DAYS (90) days; after that only the FIRST nightly
//     backup of each calendar month is kept, for ever.
//   - manual ("Back up now"), before-restore and archive backups: kept for ever.
//
// What NOT to change and why:
//   - The file format ("twp-backup", version 1) and key layout <YYYY-MM-DD>/<file>.json: restore reads
//     old files by exactly this shape. Only ever ADD fields.
//   - Only <date>/all.json files are ever deleted by prune(). Never widen that: the others were made on
//     purpose (by the owner, or just before something risky).
//   - A failed backup is still recorded (ok = false, error = the reason) so the Health line shows it.
//   - The GitHub copy can never make a backup fail: its result goes into the row's github column.
//
//notes:
// - Uploaded pictures are not copied into backups (they stay in the "assets" store).
// - Backups hold password HASHES (needed to restore logins), never plain passwords. The GitHub copy holds neither.
// - Ages are counted by the date in the key (UTC), like the files themselves.
// =====================================================================================================
import { query, tx } from "./_db.ts";
import { blobs } from "./_blobs.ts";
import { exportWedding } from "./_data.ts";
import { syncToGitHub } from "./_github-backup.ts";
import type { Wedding } from "./_wedding.ts";

export const KEEP_DAYS = 90;
export const BACKUP_KEY_RE = /^\d{4}-\d{2}-\d{2}\/[\w.-]{1,120}\.json$/;
export type BackupKind = "nightly" | "manual" | "before-restore" | "archive";
const NIGHTLY_RE = /^\d{4}-\d{2}-\d{2}\/all\.json$/;

const hms = (d: Date) => d.toISOString().slice(11, 19).replace(/:/g, "");

/** The kind of a backup, from its file name (works for rows made before the kind column existed). */
export function kindOfKey(key: string): BackupKind {
  const f = key.slice(11);
  return f === "all.json" ? "nightly" : f.startsWith("before-restore-") ? "before-restore" : f.startsWith("archive-") ? "archive" : "manual";
}

/** Builds the backup document for the given weddings (all when omitted). */
export async function dump(weddings?: Wedding[]) {
  // One read-only snapshot: an answer or a new family arriving half-way through can never give a backup whose
  // tables disagree (e.g. an answer for a family the file does not hold). Only `q` may be used inside.
  return tx(async (q) => {
    await q.query("set transaction isolation level repeatable read read only");
    const ws = weddings
      ? await q.query<Wedding>("select * from weddings where id = any($1::bigint[]) order by id", [weddings.map((w) => w.id)])
      : await q.query<Wedding>("select * from weddings order by id");
    const out: any[] = [];
    for (const w of ws) out.push(await exportWedding(w, true, q));
    const [v] = await q.query<{ v: number }>("select coalesce(max(version), 0)::int as v from schema_version");
    return { format: "twp-backup", version: 1, at: new Date().toISOString(), schema_version: v?.v ?? 0, weddings: out };
  });
}

const liveFamilies = (ws: any[]) => ws.reduce((n: number, w: any) => n + w.families.filter((f: any) => !f.removed_at).length, 0);
const siteAddress = () => (process.env.PUBLIC_BASE_URL || process.env.URL || "").replace(/\/+$/, "") || null;

/**
 * Writes a backup and records it. kind "nightly" -> <date>/all.json, "manual" -> <date>/manual-<HHMMSS>.json,
 * "before-restore" -> <date>/before-restore-<slug>-<HHMMSS>.json and "archive" -> <date>/archive-<slug>-<HHMMSS>.json
 * (those two hold only that wedding). After a successful nightly, manual or archive backup the weddings in it
 * are also copied to GitHub (when set up).
 */
export async function runBackup(kind: BackupKind, only?: Wedding) {
  const d = new Date();
  const day = d.toISOString().slice(0, 10);
  const key = kind === "nightly" ? `${day}/all.json` : kind === "manual" ? `${day}/manual-${hms(d)}.json` : `${day}/${kind}-${only!.slug}-${hms(d)}.json`;
  let weddings = 0, families = 0, bytes = 0, ok = true, error: string | null = null, doc: any = null;
  try {
    doc = await dump(only ? [only] : undefined);
    weddings = doc.weddings.length;
    families = doc.weddings.reduce((n: number, w: any) => n + w.families.length, 0);
    const text = JSON.stringify(doc);
    bytes = Buffer.byteLength(text);
    await blobs("backups").set(key, text);
  } catch (e: any) {
    ok = false; error = String(e?.message || e).slice(0, 500);
    console.error("backup failed", e);
  }
  // the row is recorded first, so a slow GitHub can never lose the record of a good backup
  let [row] = await query("insert into backups (blob_key, weddings, families, bytes, ok, error, kind) values ($1,$2,$3,$4,$5,$6,$7) returning *",
    [key, weddings, families, bytes, ok, error, kind]);
  let github: any = null;
  if (ok && kind !== "before-restore") {
    try {
      let summary = { weddings, families: liveFamilies(doc.weddings), site: siteAddress() };
      if (only) {
        const [c] = await query<any>("select (select count(*)::int from weddings) as w, (select count(*)::int from families where removed_at is null) as f");
        summary = { ...summary, weddings: c.w, families: c.f };
      }
      github = await syncToGitHub(doc.weddings, summary);
    } catch (e: any) { // syncToGitHub never throws; this only guards the count query
      github = { ok: false, at: new Date().toISOString(), error: `The copy to GitHub failed: ${String(e?.message || e).slice(0, 200)}`, files: 0, unchanged: 0 };
    }
    if (github && !github.ok) console.error("github backup:", github.error);
    if (github) [row] = await query("update backups set github = $2::jsonb where id = $1 returning *", [row.id, JSON.stringify(github)]);
  }
  if (kind === "nightly") await prune().catch((e) => console.error("prune failed", e));
  return row;
}

/**
 * Which nightly keys are kept for ever: the first nightly file of each calendar month (by the date in the key).
 * `keys` = the nightly files that exist.
 */
export function firstOfMonth(keys: string[]): Set<string> {
  const first = new Map<string, string>();
  for (const k of keys) if (NIGHTLY_RE.test(k)) { const m = k.slice(0, 7); if (!first.has(m) || k < first.get(m)!) first.set(m, k); }
  return new Set(first.values());
}
/** The day (YYYY-MM-DD) before which nightly backups are no longer kept, unless first of their month. */
export const cutoffDay = (now = new Date()) => new Date(now.getTime() - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);

/**
 * Deletes nightly backup files older than KEEP_DAYS days that are not the first of their month, and their rows
 * (also rows of failed nightly runs older than that). Manual, before-restore and archive backups are never touched.
 */
export async function prune(now = new Date()) {
  const cutoff = cutoffDay(now);
  const store = blobs("backups");
  const nightly = (await store.list("")).filter((k) => NIGHTLY_RE.test(k));
  const keep = firstOfMonth(nightly);
  const gone: string[] = [];
  for (const k of nightly) if (k.slice(0, 10) < cutoff && !keep.has(k)) { await store.delete(k); gone.push(k); }
  if (gone.length) await query("delete from backups where blob_key = any($1::text[])", [gone]);
  await query("delete from backups where ok = false and blob_key like '____-__-__/all.json' and substr(blob_key, 1, 10) < $1", [cutoff]);
  return { deleted: gone };
}

/** Adds kind, kept_forever and kept_until (YYYY-MM-DD, or null when kept for ever) to backup rows. */
export function describeBackups(rows: any[]) {
  const keep = firstOfMonth(rows.filter((r) => r.ok).map((r) => r.blob_key));
  return rows.map((r) => {
    const kind: BackupKind = r.kind || kindOfKey(r.blob_key);
    const forever = kind !== "nightly" || keep.has(r.blob_key);
    const until = forever ? null : new Date(Date.parse(r.blob_key.slice(0, 10) + "T00:00:00Z") + KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
    return { ...r, kind, kept_forever: forever, kept_until: until };
  });
}

/** Reads one backup file, or null. */
export async function readBackup(key: string): Promise<any | null> {
  if (!BACKUP_KEY_RE.test(key)) return null;
  const b = await blobs("backups").get(key);
  if (!b) return null;
  try { return JSON.parse(new TextDecoder().decode(b)); } catch { return null; }
}
