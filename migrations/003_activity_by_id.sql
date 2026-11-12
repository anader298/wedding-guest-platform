-- 003_activity_by_id.sql: makes the Activity tab's "what is new since…" question fast.
-- Every open admin page asks every 30 seconds for the activity lines after the last one it has
-- (wedding_id = … and id > …, newest first). The index from 001 is by time (at), which this question cannot use well.
-- The manager's weddings list ("last activity" of each wedding) uses the same index.
-- NEVER edit this file after it has run anywhere: add migrations/004_<what>.sql instead.
--notes: (developers) additive only; "if not exists" keeps it harmless if someone created it by hand.
create index if not exists activity_w_id on activity (wedding_id, id desc);
