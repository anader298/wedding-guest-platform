-- 004_backup_github.sql: two new facts about each backup, for the longer keeping rules and the GitHub copy.
--   kind   = what made the backup: 'nightly', 'manual' (Back up now), 'before-restore' or 'archive'.
--            Old rows get it from their file name. Only nightly backups are ever removed (see _lib/_backup.ts).
--   github = the result of copying that backup to the owner's GitHub repository, or empty when that is not set up:
--            { ok, at, error?, files, unchanged, token_expires_at? }. The manager's Health line reads the latest one.
-- NEVER edit this file after it has run anywhere: add migrations/005_<what>.sql instead.
--notes: (developers) additive only (two nullable columns + a backfill of the new column); "if not exists" keeps it harmless.
alter table backups add column if not exists kind text;
alter table backups add column if not exists github jsonb;
update backups set kind = case
    when blob_key like '%/all.json' then 'nightly'
    when blob_key like '%/before-restore-%' then 'before-restore'
    when blob_key like '%/archive-%' then 'archive'
    else 'manual' end
  where kind is null;
