-- 002_login_attempts.sql: remembers wrong passwords so a guesser gets locked out.
-- Used by netlify/functions/_auth.ts (checkLockout / recordFailure / clearFailures).
-- scope = 'wedding:<slug>' (helper login and x-wedding-key) or 'owner' (manager login).
-- key   = the visitor's IP address (one bad phone never locks out the other helpers).
-- 5 wrong passwords within 10 minutes lock that scope+key for 15 minutes.
-- NEVER edit this file after it has run anywhere: add migrations/003_<what>.sql instead.
--notes: (developers) rows older than the window are ignored, not deleted; the table stays tiny (one row per scope+IP).
create table login_attempts (
  scope text not null, key text not null,
  failures int not null default 0, first_failed_at timestamptz not null default now(), locked_until timestamptz,
  primary key (scope, key));
