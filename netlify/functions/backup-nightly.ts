// =====================================================================================================
// backup-nightly.ts: scheduled function, runs every night at 03:00 UTC.
//
// What it is for: a full JSON copy of every wedding, so a mistake (or a bad change) can be undone from the
//   manager's Backups page. Every nightly copy is kept 90 days; the first one of each month is kept for ever
//   (rules in _lib/_backup.ts and docs/BACKUPS.md). When BACKUP_GITHUB_REPO and BACKUP_GITHUB_TOKEN are set,
//   each wedding is also copied to the owner's private GitHub repository (_lib/_github-backup.ts).
// Who calls it: Netlify's scheduler (see `schedule` below). It has no web address.
// What it reads/writes: every wedding table (read); Blobs store "backups" key <YYYY-MM-DD>/all.json;
//   one row in the backups table (also when it fails); deletes old nightly copies (never manual, before-restore
//   or archive ones); the GitHub repository, when set up.
//
// What NOT to change and why:
//   - Keep the schedule daily. The Health line on the manager page warns when the last backup is old.
//   - The real work is in _backup.ts (shared with "Back up now" on the manager page). Change it there.
//
//notes:
// - Scheduled functions only run on the published site, not in deploy previews.
// - A failed GitHub copy does not make this run fail (status stays 200); it is shown on the Health line.
// =====================================================================================================
import type { Config } from "@netlify/functions";
import { runBackup } from "./_lib/_backup.ts";

export default async () => {
  const row = await runBackup("nightly");
  console.log("nightly backup", JSON.stringify(row));
  return new Response(JSON.stringify({ ok: row.ok }), { status: row.ok ? 200 : 500, headers: { "content-type": "application/json" } });
};

export const config: Config = { schedule: "0 3 * * *" };
