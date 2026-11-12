-- 001_init.sql: the first database layout of Wedding Guest Platform (data model: README.md).
-- Applied once by netlify/functions/_db.ts migrate(), which records it in schema_version.
-- NEVER edit this file after it has run anywhere: add migrations/002_<what>.sql instead.
-- Every row belongs to one wedding (wedding_id, directly or through its family).
--notes: (developers) timestamps are timestamptz (UTC); the wedding's own zone is weddings.timezone.
--   Soft deletes (families.removed_at) keep tokens unique per wedding, so a put-back family keeps its link.
create table weddings (
  id bigserial primary key, slug text unique not null, groom text not null, bride text not null,
  event_at timestamptz not null, timezone text not null default 'Asia/Beirut',
  status text not null default 'live' check (status in ('live','archived')),
  password_hash text not null,            -- scrypt: "scrypt$<salt hex>$<hash hex>"
  session_version int not null default 1, -- bump to log that wedding's helpers out
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table families (
  id bigserial primary key, wedding_id bigint not null references weddings(id) on delete cascade,
  token text not null, name text not null, name_key text not null,   -- name_key = lower, whitespace collapsed
  side text not null check (side in ('a','b')), max_guests int not null check (max_guests between 1 and 50),
  message text, phone text, email text,
  created_at timestamptz not null default now(), created_by text not null default '',
  updated_at timestamptz not null default now(), updated_by text not null default '',
  removed_at timestamptz, removed_by text,
  unique (wedding_id, token));
create unique index families_name_live on families (wedding_id, name_key) where removed_at is null;
create table rsvps (                       -- one row per answer; latest = current
  id bigserial primary key, family_id bigint not null references families(id) on delete cascade,
  attending boolean not null, guests int not null, guest_names jsonb not null default '[]', note text not null default '',
  at timestamptz not null default now(), cleared_at timestamptz);   -- cleared_at set by reset (kept for undo)
create index rsvps_family on rsvps (family_id, at desc);
create table sends (                       -- outbound: invite / reminder marks and wa.me / mailto taps
  id bigserial primary key, family_id bigint not null references families(id) on delete cascade,
  kind text not null check (kind in ('invite','reminder')), channel text not null default 'copy'
    check (channel in ('copy','whatsapp','email')), by_name text not null, at timestamptz not null default now(),
  undone_at timestamptz, cleared_at timestamptz);
create index sends_family on sends (family_id, at);
create table opens (family_id bigint primary key references families(id) on delete cascade,
  first_at timestamptz not null, last_at timestamptz not null, count int not null default 1, cleared_at timestamptz);
create table activity (id bigserial primary key, wedding_id bigint not null references weddings(id) on delete cascade,
  at timestamptz not null default now(), by_name text not null, action text not null,
  family_id bigint, family_name text, side text, details jsonb not null default '{}');
create index activity_w_at on activity (wedding_id, at desc);
create table helpers (wedding_id bigint not null references weddings(id) on delete cascade, name_key text not null,
  name text not null, first_seen timestamptz not null, last_active timestamptz not null,
  invites int not null default 0, reminders int not null default 0, edits int not null default 0, logins int not null default 0,
  primary key (wedding_id, name_key));
create table settings (wedding_id bigint not null references weddings(id) on delete cascade, key text not null,
  value text not null, updated_at timestamptz, updated_by text, primary key (wedding_id, key));
  -- keys: wa_message_a, wa_message_b, wa_reminder_a, wa_reminder_b (+ reply_by, YYYY-MM-DD)
create table invites (wedding_id bigint primary key references weddings(id) on delete cascade,
  draft jsonb not null, live jsonb not null, draft_updated_at timestamptz, draft_updated_by text,
  published_at timestamptz, published_by text);
create table assets (id bigserial primary key, wedding_id bigint not null references weddings(id) on delete cascade,
  name text not null, content_type text not null, bytes int not null, blob_key text not null,
  uploaded_at timestamptz not null default now(), uploaded_by text not null, unique (wedding_id, name));
create table resets (id bigserial primary key, wedding_id bigint not null references weddings(id) on delete cascade,
  kind text not null check (kind in ('family','all')), family_id bigint, at timestamptz not null default now(),
  by_name text not null, snapshot jsonb not null, undone_at timestamptz, undone_by text);
create table backups (id bigserial primary key, at timestamptz not null default now(), blob_key text not null,
  weddings int not null, families int not null, bytes int not null, ok boolean not null, error text);
create table schema_version (version int primary key, applied_at timestamptz not null default now());
