# Wedding Guest Platform: API contract (as implemented)

This is the complete contract between the backend (`netlify/functions/`) and the pages (`site/`). It is
the reference for anyone changing either side.
If code and this file disagree, the code is wrong: fix the code, or change both on purpose.

## Environment variables (set on Netlify, Site configuration → Environment variables)

| Var | Meaning |
|---|---|
| `NETLIFY_DB_URL` | Set automatically by Netlify Database (provisioned because `@netlify/database` is in `package.json`). Postgres connection string. The older name `NETLIFY_DATABASE_URL` (deprecated Netlify DB extension) is accepted too; `NETLIFY_DB_URL` wins when both exist. |
| `DB_DRIVER` | `pg` (default when either URL above exists) or `pglite` (laptop and tests; data in `.data/pglite/`, or `PGLITE_DIR`; `memory://` = in memory). |
| `OWNER_PASSWORD` | The manager's password. Missing = the manager refuses every login (fails closed). |
| `PUBLIC_BASE_URL` | Optional, e.g. `https://invites.example.com`. Used to build guest links. Default = the address the request came to. |
| `SESSION_SECRET` | Optional. Default is derived from `OWNER_PASSWORD`. Changing it logs everyone out. |

| (none: the deploy context) | Not an environment variable. Netlify does **not** give functions `CONTEXT`/`BRANCH`/`DEPLOY_ID` at runtime (only `URL`, `SITE_NAME`, `SITE_ID`). `_lib/_blobs.ts` reads the runtime global `Netlify.context.deploy` (`{ context, id }`, the same as the handler's `context.deploy`); `process.env.CONTEXT` is only a fallback for scripts and tests. On `production` (or no context) the Blobs stores are `assets` and `backups`; on any other context (deploy-preview, branch-deploy, dev) writes and deletes go to `assets-<context>-<deploy id>` / `backups-<context>-<deploy id>`, and reads fall back to the live store (read-only), so a preview shows real pictures but never changes or deletes them. The database is separate per preview through Netlify Database branching. To check which stores a deploy uses, open manage `health` (`storage`). |

Migrations: our own `migrate()` applies `migrations/*.sql` on each cold start. `netlify/database/migrations/` must stay
empty, or Netlify would try to run migrations from there as well.

## Addresses that are not API calls
- `/<slug>` (no final slash) shows the invite too (Netlify matches `/:slug/*` with or without the slash). Its relative files then
  resolve at the site root, so `netlify.toml` rewrites `/style.css`, `/app.js`, `/envelope.jpg`, ... to `/app/<file>`.
  **There is no 301 to add the slash**: Netlify ignores the final slash when matching rules, so such a rule loops forever
  (`tests/netlify-toml.test.ts`).
- `/<slug>/` → the invite page; `/<slug>/admin/` → the helpers' page; `/manage/` → the manager page; `/` → landing page.

## Link previews (Edge Function `netlify/edge-functions/invite-meta.ts`)
- Runs on `GET /<slug>/` and `GET /<slug>` (any query, e.g. `?t=TOKEN`); not on `/`, `/manage/`, `/api/*`, `/app/*`, `/.netlify/*`,
  reserved words, or any file. It is not an API call: the reply is still the invite page (`site/app/index.html`), same status,
  same headers (`no-store`, `noindex`), no redirect, the `?t=` code is kept.
- It reads the live design from `GET /<slug>/api/invite` (no cookie) and rewrites only these `<head>` lines:
  `<title>` = `<Groom> & <Bride>`; `description` = `You are invited to the wedding of <Groom> & <Bride>, <date.en>, <venue.name>, <city before the first comma>.`;
  `og:title` = `<Groom> & <Bride> · You're invited`; `og:description` = `<date.en> · <venue.name>, <city>. Tap to open your invitation.`;
  `og:image` = absolute URL of `assets.og` (an upload becomes `<origin>/.netlify/images?url=/<slug>/asset/<name>&w=1200&h=630&fit=cover&fm=jpg&q=80`,
  the default is `<origin>/<slug>/og-envelope.jpg`); `og:image:width`/`height` = 1200/630; `og:type` = `website`;
  `og:url` = `<origin>/<slug>/` (no code; added, the template has none); `twitter:*` lines that exist get the same values.
  Values are HTML-escaped; every other byte of the page is unchanged.
- If the address is not a wedding, the page is not HTML/200, or the design cannot be read (404, error, timeout 4 s), the page
  is sent unchanged (Karim & Maya's lines). A crash in the function itself is bypassed by Netlify (`onError: "bypass"`).
- Archived weddings keep their couple's names (the design is still public).
- WhatsApp keeps the preview it already made for a link; a new picture shows on links pasted after Publish.

General rules
- Every reply is JSON (`content-type: application/json`, `cache-control: no-store`), except `/:slug/asset/*`.
- Every error is `{ error: "<plain English sentence>", code?: "<machine code>", ...extra }`. Show `error` to
  the person as is. Use `code` in page logic, never the wording.
- Times are ISO strings in UTC (`2026-11-02T18:04:11.000Z`).
- `:slug` is a wedding address, e.g. `karim-and-maya`. Unknown or reserved slug: 404 `{ error, code: "no_wedding" }`
  (the public guest/rsvp endpoints answer 404 `unknown invitation` instead, as before).
- Sides are `"a"` (groom's side) and `"b"` (bride's side). Show them as the groom's / bride's first name.
  Wherever a side is accepted, the groom's or bride's name (any case) is accepted too and turned into `a`/`b`.
- `by` (who did it) always comes from the session. Any `by` the page sends is ignored. Only scripts using the
  `x-wedding-key` header may name themselves (body `by`, default `"script"`; the reserved names Owner, Guest and script become `"script"`).
- Archived wedding: every admin write and the public RSVP answer 410
  `{ error: "This wedding is archived", code: "archived" }`. Reads keep working.
- Unknown action or wrong method: 404 `{ error: "This action does not exist.", code: "not_found" }`.
- Bad JSON body: 400 `{ error: "The request was not readable. Please reload the page and try again.", code: "bad_json" }`.
- Wrong-password lockout: 5 wrong passwords within 10 minutes from one IP address lock that IP out of that wedding
  (helper `login` and `x-wedding-key`) or out of the manager (`login`) for 15 minutes. While locked, even the right
  password gets 429 `{ error: "Too many wrong passwords. Try again in 15 minutes.", code: "locked" }`. Other phones are
  not affected; a right password clears the count. Stored in table `login_attempts` (migration 002).
- Unexpected server failure: 500 `{ error: "Something went wrong on the server. Please try again in a minute.", code: "server_error" }`.

## 1. Public: invite page (`site/app/index.html` + `app.js`)

### GET `/:slug/api/invite[?draft=1]`
```
200 { slug, status: "live"|"archived", mode: "template"|"slides",
      config: { couple, date, families, venue, rsvp, gift, music },      // shape of CONFIG in site/app/app.js
      show:   { kidsNote, gift, bismillah, countdown, maps, arabic, parents, timeLine },   // booleans, "What to show"
      theme:  { paper, paper2, gold, goldD, goldL, ink, inkSoft, serif, sans, arabic, baseSize },
      pages:  { envelope, welcome, families, countdown, gift, rsvp },  // each { serif?, sans?, arabic?, scale?, ink?, inkSoft?, gold?, shadow?, backdrop? }
      lines:  { "<page>.<line>": { font?, size?, color?, shadow?, weight?, italic?, letterSpacing?, hidden? } },   // one line of words; {} = none changed
      readability: { veil, photoBlur },                                // couple photo on page 2 (defaults 57.6, 2.5)
      timing: { envelopeOpenMs, revealSpeed },                         // defaults 2300, 1
      assets: { envelope, envelopeOpen, seal, couple, og, music },     // always a URL string (template default or upload)
      slides: [ { id, name, kind: "image"|"video", asset, open_asset?, type, overlays:[{kind,x,y,w,h,asset?,url?}], url, open_url? } ],
      published_at: ISO|null }
404 { error: "This wedding does not exist.", code: "no_wedding" }
401 { error: "Please log in to see the draft.", code: "unauthorized" }   // ?draft=1 without a helper or owner cookie
```
- Without `draft=1` it returns the **live** (published) design; with it the **draft**.
- Asset URLs: template defaults are `/<slug>/envelope.jpg`, `/<slug>/envelope-open.jpg`, `/<slug>/envelope-seal.webp`,
  `/<slug>/couple.jpg`, `/<slug>/og-envelope.jpg`, `/<slug>/music.m4a`. Uploaded images are
  `/.netlify/images?url=/<slug>/asset/<name>&w=1170&fm=webp&q=80`; uploaded audio/video are `/<slug>/asset/<name>`.
- Never contains phone numbers, e-mails or family data.
- If the wedding has no stored design, or the stored one can no longer be read, the reply is this wedding's starting design
  (its own names, date and reply-by; no parents, venue or gift account), never the raw template.
- `pages` (Design tab **Each page**): a missing or empty field = the theme (today's look). `serif`/`sans`/`arabic` = font
  strings like the theme's; `scale` 0.8–1.4 (zoom of that page's words; the `countdown` page at most 1.2, its four numbers would not fit a phone; designs saved
  earlier with 0.7–0.79 or a countdown above 1.2 are clamped into these bounds when read, never refused); `ink`/`inkSoft`/`gold` = `#hex`;
  `shadow` `"none"|"soft"|"strong"`; `backdrop` `"none"|"light"|"dark"` (dark turns the words light unless `ink` is set).
  `welcome` = page 2 (names over the couple photo).
- `lines` (Design tab **Each page** → **Fine-tune a line on this page**): one line of words, on top of its page. Every field is optional;
  none set = the line follows its page. `font` = a font string like the theme's; `size` 0.6–1.8 (times the line's own size in
  style.css); `color` `#hex`; `shadow` `"none"|"soft"|"strong"`; `weight` `"normal"|"bold"`; `italic` `true` (italic) / `false` (upright);
  `letterSpacing` −0.05–0.3 (em); `hidden: true` = not shown (`false` is dropped). An unknown line, an unknown field or a value out of
  range is refused with a 400 (below). The page writes these rules after the page rules, with `!important`, so a line wins over its page.
  The keys (stable: saved designs use them; source `LINE_LIST` in `netlify/functions/_lib/_wedding.ts`, selectors in `LINES` in app.js):

  | Page | Key | Shown to the owner as | Template element |
  |---|---|---|---|
  | Envelope | `envelope.names` | Names on the card | `.card-names` |
  | | `envelope.date` | Date on the card | `.card-date` |
  | | `envelope.arabic` | Arabic names on the card | `.card-ar` |
  | | `envelope.tapHint` | Tap to open | `.tap-hint` |
  | Names | `welcome.bismillah` | Bismillah (the calligraphy) | `.bismillah` (picture: size, colour, shadow, hide only) |
  | | `welcome.verse` | Verse under the Bismillah | `.ayah` |
  | | `welcome.names` | Names | `.names` |
  | | `welcome.invite` | "Invite you to celebrate" line | `.invite-line` |
  | | `welcome.dateEn` | Date (English) | `.date-en` |
  | | `welcome.dateAr` | Date (Arabic) | `.date-ar` |
  | | `welcome.time` | Time under the date | `#welcome .time-line` |
  | Families | `families.leadAr` | "The family of" (Arabic) | `.ar-lead` |
  | | `families.fathersAr` | Fathers' names (Arabic) | `.parents` |
  | | `families.inviteAr` | Invitation line (Arabic) | `.ar-body` |
  | | `families.namesAr` | Couple's names (Arabic) | `.ar-names` |
  | | `families.leadEn` | "The family of" (English) | `.block-en .label` |
  | | `families.fathersEn` | Fathers' names (English) | `.parents-en` |
  | | `families.inviteEn` | Invitation line (English) | `.en-body` |
  | | `families.namesEn` | Couple's names (English) | `.en-names` |
  | Countdown & venue | `countdown.small` | Small titles (Countdown, The place) | `#countdown .label` |
  | | `countdown.titles` | Big titles (Until the big day, Where we celebrate) | `#countdown .heading`, `.ar-sub` |
  | | `countdown.numbers` | Countdown numbers | `.num`, `.colon` (colour: numbers only) |
  | | `countdown.units` | Days, Hours, Minutes, Seconds | `.unit-label` |
  | | `countdown.dateTime` | Date and time under the countdown | `.cd-time` |
  | | `countdown.venue` | Venue name | `.venue` |
  | | `countdown.city` | Venue city | `.venue-city` |
  | | `countdown.venueAr` | Venue (Arabic) | `.venue-ar` |
  | | `countdown.maps` | Get directions button | `#mapsLink` |
  | Gift | `gift.small` | Small title (With gratitude) | `#gift .label` |
  | | `gift.heading` | Title (Gift registry) | `#gift .heading` |
  | | `gift.textEn` | Gift text (English) | `.gift-en` |
  | | `gift.textAr` | Gift text (Arabic) | `.gift-ar` |
  | | `gift.accountLabel` | Words above the account number | `.account .lbl` |
  | | `gift.number` | Account number | `.acct-num` |
  | | `gift.copy` | Tap to copy button | `#copyBtn` |
  | RSVP | `rsvp.heading` | RSVP title | `#rsvp .heading` |
  | | `rsvp.headingAr` | RSVP title (Arabic) | `.ar-title` |
  | | `rsvp.replyBy` | Reply by (English) | `.replyby` |
  | | `rsvp.replyByAr` | Reply by (Arabic) | `.replyby-ar` |
  | | `rsvp.guest` | Family name and seats | `.guest-name`, `.seats` |
  | | `rsvp.kidsAr` | Children's note (Arabic) | `.kids-ar` |
  | | `rsvp.kidsEn` | Children's note (English) | `.kids-en` |
  | | `rsvp.questions` | Questions on the form | `.bi` |
  | | `rsvp.buttons` | Answer buttons | `.choice button`, `.btn-gold` (colour: not the chosen button) |
  | | `rsvp.monogram` | Monogram at the bottom | `.foot-mono` |
  | | `rsvp.footDate` | Date at the bottom | `.foot-date` |
- `readability`: `veil` 0–100 (% of rgb(234,221,210) over the couple photo, template 57.6), `photoBlur` 0–6 px (template 2.5).
  With `veil` under 30 and no `pages.welcome.shadow` (and no backdrop), the page adds a glow behind the Names page's words by itself
  (layered text-shadow plus a feathered light panel, strength 0.5 × (30 − veil) / 30).
- `timing`: `envelopeOpenMs` 800–5000 (envelope animation and the wait before scrolling to page 2 are the same, template 2300),
  `revealSpeed` 0.5–2 (2 = lines fade in twice as fast; scales the `.reveal` transitions and their `--d` delays).
- `show`: `false` hides; `countdown` = the numbers and their title, `maps` = the Get directions button, `arabic` = every `[dir=rtl]`
  element, `parents` = "The family of" + the fathers' names, `timeLine` = the time under the date on page 2. Music on/off is `config.music.enabled`.
- The page applies `pages`/`lines`/`readability`/`timing` as one `<style id="twp-overrides">` (empty when everything is the template default).

### GET `/:slug/api/guest?t=TOKEN[&preview=1]`
```
200 { name, max_guests, response: null | { attending, guests, guest_names: [..], note, at } }
404 { error: "unknown invitation" }
```
Records an open (first/last time, count) unless `preview=1` or the wedding is archived. The first open is logged
as activity `opened` by `"Guest"`. Removed families answer 404. A token only works under its own wedding's slug.

### POST `/:slug/api/rsvp`
```
body { t, attending, guests, guest_names?: [..], note?, preview? }
200 { ok: true, preview, saved, name, max_guests, response: { attending, guests, guest_names, note, at } }
400 { error: "Please write the name of everyone coming.", code: "names_required", needed, given }
404 { error: "unknown invitation" }
410 { error: "This wedding is archived", code: "archived" }
```
- `attending` counts as yes for `true`, `1`, `"1"`, `"yes"`, `"true"`. Declining forces `guests` = 0.
- `guests` is clamped to 0..max_guests; attending with `guests` < 1 counts as 1 (before the names check).
- `guest_names`: trimmed, blanks dropped, each cut to 80 characters, at most `guests` kept. Required when attending.
- `note`: cut to 500 characters. Submitting again overwrites (the latest answer is the current one).
- `preview: true` returns the record without saving or logging. Logged as activity `answered` by `"Guest"`
  with `{ attending, guests, guest_names, changed, before? }`.

### GET `/:slug/asset/<name>`
Streams an uploaded file. `content-type` = the uploaded type, `cache-control: public, max-age=31536000, immutable`
(names carry a random suffix, so a new upload always has a new name). Supports `Range` (206) for audio/video.
404 (plain JSON `{ error: "This file does not exist.", code: "not_found" }`) otherwise. `<name>` may contain one
folder, e.g. `slides/page-1-k3f9.png`.

## 2. Helper admin page (`/:slug/api/admin/:action`)

Cookies are always `HttpOnly; SameSite=Lax`; `Secure` is added only when the request came over https (always the case
on Netlify), so logging in also works on a plain `http://localhost` copy in Safari.

Auth: helper cookie `twp_<slug>` (set by `login`), or the owner cookie `twp_owner` (then `by` = `"Owner"`),
or header `x-wedding-key: <plain wedding password>` for scripts. Otherwise 401
`{ error: "Please log in again.", code: "unauthorized" }`.

### Session
- POST `login` `{ name, password }` → `{ ok: true, name }` + `set-cookie: twp_<slug>=…; Path=/<slug>; Max-Age=400 days; HttpOnly; [Secure;] SameSite=Lax`.
  400 `name_required` ("Please type your name."), 400 `name_too_long` (more than 40 letters),
  400 `name_reserved` (the names Owner, Guest and script are kept for the system), 401 `wrong_password`
  ("Wrong password. Try again."), 429 `locked` (see the lockout rule above), 404 `no_wedding`. Logged as `login`. Works on archived weddings.
- POST `logout` → `{ ok: true }` and clears the cookie.
- GET `me` → `{ ok: true, name, owner: boolean, slug, status }`.

### Families
GET `families` →
```
{ now, settings: <same as GET settings>, removed_count,
  families: [ { token, name, side, max_guests, message, phone, email,
                created_at, created_by, updated_at, updated_by,
                link,              // <base>/<slug>/?t=TOKEN
                preview_link,      // link + &preview=1
                wa_link,           // https://wa.me/<digits>?text=<invite text>, null without phone
                wa_reminder_link,  // same with the reminder text, null without phone
                mail_link,         // mailto:<email>?subject=…&body=<invite text>, null without e-mail
                mail_reminder_link,
                sent: null | { invite_at?, invite_by?, invite_channel?, reminder_at?, reminder_by?, reminder_channel? },
                sends: [ { kind: "invite"|"reminder", channel: "copy"|"whatsapp"|"email", by, at } ],   // oldest first
                opened: null | { first_at, last_at, count },
                response: null | { attending, guests, guest_names, note, at } } ] }
```
Sorted by name (case-insensitive). `sent.invite_at` = the latest invite mark that is still standing.
The texts in the links are the family's own `message` (invite only) or the side's text, with `{name}` and `{link}` filled in.

POST `family` `{ name, side, max_guests, message?, phone?, email? }` → `{ ok, family }` (family as in `families`).
409 `{ code: "duplicate_name", existing: { token, name, side } }` if a family with the same name (case and spaces ignored) is on the list on either side.

PATCH `family` `{ token, name?, side?, max_guests?, message? (null clears), phone? (null or "" clears), email? (null or "" clears), force? }` → `{ ok, family }`.
409 `duplicate_name`; 409 `{ code: "below_answer", answered_guests }` when max_guests < the answered guest count and not `force`;
404 `not_found`. Never changes the stored answer. Name/seat/side/message changes log `family_edited { changes:[..], forced }`;
phone/e-mail changes log `contact_edited { changes: ["phone added"|"phone changed"|"phone removed", "e-mail …"] }` (the numbers themselves are not logged).

DELETE `family` `{ token, force? }` (or `?token=..&force=true`) → `{ ok }`; already removed → `{ ok, already_removed: true }`;
404 `not_found` for a token this wedding never had (e.g. another wedding's);
409 `{ code: "has_activity", sent, response }` if sent or answered and not `force`. The family is archived with its sends/opens/answer.

GET `removed` → `{ removed: [ { token, name, side, max_guests, message, removed_at, removed_by, sent, opened, response } ] }` newest first.
POST `restore` `{ token }` → `{ ok, family }` (same token/link, with its old sends/opens/answer). 409 `duplicate_name` `{ existing }`,
409 `already_restored`, 404 `not_found`.

POST `upload` `{ side, families: [ { name, max_guests, phone?, email? } ], dry_run? }` →
`{ ok, dry_run, added:[names], updated:[{ name, from, to }], unchanged, conflicts:[{ name, reason }] }`.
Adds new names, updates seats of same-name families on that side, never removes anyone. Conflicts (skipped): name on the other side,
invalid row (reason = the validation message), name repeated in the file (first row wins), a row that would lower seats below an answer,
a name someone added a moment ago. At most 2000 rows. `phone`/`email` on a row are used for new families only.

Validation (400 `{ error }`): name empty, over 120 characters, or containing `{` `}`; max_guests not a whole number 1..50 (strings like "4" fine);
side not a/b/groom/bride; message over 4000 characters or without `{link}` (empty string = null); phone not 6–15 digits
(spaces, dashes, dots, brackets ignored; a leading `+` or `00` is kept as `+`); e-mail not like `x@y.z` or over 200 characters.

### Sending
POST `mark-sent` `{ token, kind: "invite"|"reminder", channel?: "copy"|"whatsapp"|"email", undo? }` → `{ ok, sent, previous }`.
`sent`/`previous` have the `sent` shape above (null when nothing stands). `undo: true` takes back every standing mark of that kind.
Logs `invite_sent` / `reminder_sent` `{ kind, channel }` or `unmarked { kind }`. 404 `not_found`.

### Messages
GET `settings` → `{ wa_message_a, wa_message_b, wa_reminder_a, wa_reminder_b, meta: { <field>: { updated_at, updated_by } } }`
(`meta` has a field only after someone saved it).
PUT `settings` `{ <any of the 4 fields>, base?: { <field>: <meta[field].updated_at you started from, or null> }, force? }` → same as GET.
400 `{ code: "too_long", max: 4000, fields }` (checked first), 400 `{ code: "missing_link", fields }`;
409 `{ code: "changed", field, by, at, fields: [{ field, by, at, value }] }` when another helper changed that field since `base`
(a `base` time that cannot be read counts as changed; saving the same text is never a conflict; `force: true` saves anyway). Logs `message_saved { kind, forced }` per changed field (side set).

### Helpers and activity
POST `hello` `{}` → `{ ok }` (page-is-open ping; updates `last_active` at most every 2 minutes; never logged). Allowed on archived weddings.
GET `helpers` → `{ helpers: [ { name, first_seen, last_active, invites, reminders, edits, logins } ] }` newest activity first.
The owner (`"Owner"`) and scripts are not counted as helpers.
GET `activity[?limit=N][&since=KEY]` → `{ events: [ { key, at, by, action, token, family_name, side, details } ], latest }` newest first.
`key` is a 12-digit zero-padded string that sorts by time (compare as strings). limit default 2000, max 5000.
`since` returns only events after that key. `latest` = newest key returned, else `since`, else null.

Actions: `login`, `family_added {max_guests, special_message}`, `family_edited {changes, forced}`, `contact_edited {changes}`,
`family_removed {sent, opened, response}`, `family_restored {sent, response}`, `invite_sent {kind, channel}`, `reminder_sent {kind, channel}`,
`unmarked {kind}`, `reset_family {cleared}`, `reset_all {counts}`, `undo_reset {restored, skipped}`,
`upload {added, updated, unchanged, skipped}`, `message_saved {kind, forced}`, `invite_saved`, `invite_published`, `invite_discarded`,
`asset_uploaded {name, bytes}`, `asset_deleted {name}`, `password_changed`; guest: `opened`, `answered {…}`;
owner (from the manager): `wedding_created`, `wedding_updated {changes}`, `password_set`, `archived`, `unarchived`, `restored_from_backup`.

### Testing tools
POST `reset-family` `{ token }` → `{ ok, cleared: { sent, opened, response }, key, family }` (`key` = this reset, for `undo-reset`; null when nothing was cleared). Clears that family's sends/open/answer (kept for undo);
the family, its link and message stay. 404 `not_found`.
POST `reset-all` `{ confirm: "RESET" }` → `{ ok, counts: { sent, opened, answered }, snapshot: KEY }`. 400 `confirm_required` without the word.
GET `last-reset` → `{ last: null | { key, at, by, counts, undone_at, undone_by } }` (latest reset-all).
POST `undo-reset` `{ key }` → `{ ok, restored: [names], skipped: [{ name, reason }] }`. Works for a reset-all key and for a family reset key.
Families removed since, or with new sends/open/answer since, are skipped. 409 `already_undone`, 404 `not_found`.

### Invite design
GET `invite` → `{ draft, live, draft_updated_at, draft_updated_by, published_at, published_by, assets: [ { name, content_type, bytes, url, uploaded_at, uploaded_by } ] }`.
`draft`/`live` are the stored design objects `{ version: 1, mode, config, show, theme, pages, lines, readability, timing, assets: {…names or null}, slides }`.
PUT `invite` `{ draft, base? }` → `{ ok, draft, draft_updated_at, draft_updated_by }`. `base` = the `draft_updated_at` you started from;
if it differs from the stored one (or cannot be read as a time): 409 `{ error, code: "changed", by, at }` (nothing saved). No `base` = no check.
400 `{ error, code: "invalid_invite", field }` when the shape is wrong (unknown keys are dropped, missing keys get the template default),
or when the design points at a file that was not uploaded (picture slots, slide `asset`/`open_asset`, overlay `asset`).
Exception: in `pages`, `readability` and `timing` an unknown page or field, or a value out of range, is refused (not dropped), e.g.
`{ error: "The design could not be saved: The text size on the Names page must be between 80% and 140%.", code: "invalid_invite", field: "pages.welcome.scale" }`
(Countdown page: "…between 80% and 120%."). GET `invite` returns `draft`/`live` with page sizes already moved into these bounds
or `there is no page called "lobby"…` with `field: "pages.lobby"`.
The same for `lines`: `{ error: "The design could not be saved: The size of \"Date (English)\" on the Names page must be between 60% and 180% of the original.", field: "lines.welcome.dateEn.size" }`,
or `there is no line called "welcome.lobby"…` with `field: "lines.welcome.lobby"`.
Logs `invite_saved`.
POST `publish` `{}` → `{ ok, published_at, published_by }` (draft copied to live). Logs `invite_published`.
POST `discard-draft` `{}` → `{ ok, draft, draft_updated_at }` (live copied to draft). Logs `invite_discarded`.
POST `upload-asset` `{ name, content_type, data_base64 }` → `{ ok, name, url, bytes, content_type }`.
Types: `image/png`, `image/jpeg`, `image/webp`, `audio/mp4` (m4a, also `audio/x-m4a`, `audio/m4a`), `audio/mpeg` (mp3), `video/mp4`, `video/webm`.
At most 4 MB after decoding (400 `too_big`, "This file is larger than 4 MB."); unknown type 400 `bad_type`. Name: lower-cased, made safe, a short random suffix added,
the right extension forced; one folder allowed (`slides/page.png`). The name is claimed in the database before the file is
stored, so an upload can never replace an existing file (a name clash gets a new suffix). **Netlify limits a request to about 6 MB in total and base64 adds a third,
so 4 MB is the cap on both sides: the Design tab refuses bigger files before sending (pictures are shrunk first; videos and
music are not: "Videos must be under 4 MB. Export a shorter clip or a lower quality from Canva.").** Logs `asset_uploaded`.
DELETE `asset` `{ name }` → `{ ok }` (also when already gone). 409 `{ code: "in_use", where: ["draft"|"live"] }` if the draft or live design still uses it
(a picture slot, a slide's `asset` or `open_asset`, or an overlay's `asset`).
Logs `asset_deleted`.

### Settings tab
POST `change-password` `{ current, new }` → `{ ok }` + a fresh cookie for the caller. 401 `wrong_password` if current is wrong,
429 `locked` after 5 wrong `current` values (the same lockout and count as `login`)
(the owner may leave `current` empty), 400 `too_short` (new under 4 characters). Every other helper is logged out. Logs `password_changed`.
GET `export` → `{ format: "twp-wedding", version: 1, exported_at, wedding, families, rsvps, sends, opens, activity, settings, invite }`
(see §4 for the row shapes). Families include removed ones (`removed_at` set).

## 3. Owner manager (`/api/manage/:action`)

Auth: owner cookie `twp_owner` (Path=/). Without it 401 `{ error: "Please log in again.", code: "unauthorized" }`.

- POST `login` `{ password }` → `{ ok: true }` + cookie. 401 `wrong_password`; 429 `locked`; 503 `{ code: "owner_password_missing" }` when
  `OWNER_PASSWORD` is not set on Netlify (all logins refused).
- POST `logout` → `{ ok }`. GET `me` → `{ ok: true, owner: true }`.
- GET `weddings` → `{ weddings: [ { slug, groom, bride, event_at, event_date, event_time, timezone, reply_by, status, notes, created_at,
  counts: { families, sent, opened, answered, coming, not_coming, seats, guests_coming },
  last_activity: null | { by, action, at }, published_at, links: { invite_base, admin } } ] }` soonest event first.
- POST `create` `{ slug, groom, bride, event_date: "YYYY-MM-DD", event_time?: "HH:MM" (default 19:00), timezone? (default Asia/Beirut),
  reply_by?: "YYYY-MM-DD" (default 4 weeks before), password? (default "wedding"), copy_from_slug?, notes? }` →
  `{ ok, wedding, links: { invite_base, admin, password } }`. Errors: 400 `bad_slug`, `reserved_slug`, `bad_date`, `bad_time`,
  `bad_timezone` (only region names like `Europe/London` or `UTC`; stored in their proper spelling, `asia/beirut` → `Asia/Beirut`), `too_short`, name errors; 409 `slug_taken`; 404 `no_wedding` for an unknown `copy_from_slug`.
  Creates default WhatsApp texts from the names/date, and the invite draft + live = the template filled with the names/date
  (or a copy of `copy_from_slug`'s draft/live/pictures with this couple's names/date put in).
- POST `update` `{ slug, groom?, bride?, event_date?, event_time?, timezone?, reply_by?, notes? }` → `{ ok, wedding, invite_updated }`.
  A name change also updates `couple.groom/bride/monogram` in the draft and live design; a date/time/zone change regenerates `date.*`.
- POST `set-password` `{ slug, password }` → `{ ok }` (every helper of that wedding is logged out).
- POST `archive` / `unarchive` `{ slug }` → `{ ok, wedding }`.
- GET `export?slug=` → same JSON as admin `export`.
- POST `delete` `{ slug, confirm: "<slug>" }` → `{ ok, export }`. 400 `confirm_required` unless `confirm` equals the slug.
  Deletes every row and uploaded file of that wedding. The reply carries the export so the page can download it.
- GET `data[?slug=&side=&status=&q=]` → `{ rows: [ { wedding, slug, family, side, side_name, seats, sent_at, sent_by, opened_count,
  answer: "coming"|"not_coming"|null, guests, guest_names, note, answered_at, link, phone, email } ] }`.
  `status`: `not_sent|sent|opened|answered|coming|not_coming`. `q` matches family or wedding (case-insensitive). Live families only.
- GET `check[?slug=]` → `{ issues: [ { slug, family?, token?, kind, text } ] }` (live weddings only). Kinds:
  `duplicate_name`, `over_capacity`, `never_opened` (invite sent over 14 days ago, never opened), `late_answer` (answered after reply-by),
  `bad_phone` (no country code or wrong length), `no_helpers` (event within 7 days, no helper active in 7 days), `not_published`.
- POST `backup-now` → `{ ok, backup: { id, at, blob_key, weddings, families, bytes, ok, error } }`. Key `<YYYY-MM-DD>/manual-<HHMMSS>.json`.
- GET `backups` → `{ backups: [ same rows ] }` newest first, every kept backup (nightly 90 days; first-of-month, manual, before-restore and archive copies for ever). Each row also has `kind` (`nightly` | `manual` | `before-restore` | `archive`), `kept_forever`, `kept_until` (date a nightly copy is deleted, or null) and `github` (`null` | `{ ok, at, error?, files, unchanged, token_expires_at? }`). See `docs/BACKUPS.md`.
- POST `restore` `{ blob_key, slug, into_slug?, preview: true|false, confirm? }`.
  `preview: true` (the default) → `{ ok, preview: true, target, exists, backup_at, backup: { families, answered, sent },
  current: null | { families, answered, sent }, will_add: [names], will_remove: [names], answers_differ, missing_pictures: [names] }`.
  `missing_pictures` lists the uploaded files the backup refers to whose file no longer exists (backups hold no pictures);
  after restoring, those design slots fall back to the template picture.
  `preview: false` applies. Restoring over an existing wedding replaces all its data and needs `confirm: "<target slug>"`
  (400 `confirm_required`); a copy of the current data is saved first as backup `<date>/before-restore-<slug>-<HHMMSS>.json`.
  Into a new slug (`into_slug`) no confirm is needed; tokens (links) stay the same under the new address.
  404 `not_found` (no such backup or slug in it), 409 `slug_taken` (into_slug exists, also when two restores race for it),
  409 `changed` (the wedding at the target address changed between the check and the restore; nothing restored), 400 `bad_slug`/`reserved_slug`.
  Reply `{ ok, preview: false, target, families, safety_backup, missing_pictures }`.
- GET `health` → `{ ok, db_ok, version, weddings, families, github_backup: { configured, last_ok_at, last_error, token_expires_at }, last_backup: null | { at, ok, blob_key, error },
  storage: { context, assets, backups } }`. `storage` = the deploy context (null on a laptop / when Netlify does not say) and the
  Blobs store names this deploy writes to: `assets`/`backups` on production, `assets-deploy-preview-<id>`/... on a preview.

## 4. Export / backup JSON

Wedding export (admin `export`, manage `export`, inside `delete`):
```
{ format: "twp-wedding", version: 1, exported_at,
  wedding:  { slug, groom, bride, event_at, timezone, status, notes, created_at, updated_at },
  families: [ { token, name, side, max_guests, message, phone, email, created_at, created_by, updated_at, updated_by, removed_at, removed_by } ],
  rsvps:    [ { token, attending, guests, guest_names, note, at, cleared_at } ],
  sends:    [ { token, kind, channel, by, at, undone_at, cleared_at } ],
  opens:    [ { token, first_at, last_at, count, cleared_at } ],
  activity: [ { at, by, action, token, family_name, side, details } ],
  settings: { <key>: { value, updated_at, updated_by } },
  invite:   { draft, live, draft_updated_at, draft_updated_by, published_at, published_by } }
```
Backup file (Blobs store `backups`): `{ format: "twp-backup", version: 1, at, schema_version, weddings: [ <wedding export> +
  wedding.password_hash, wedding.session_version, helpers, assets, resets ] }`. Backups contain password hashes, never plain passwords.
Uploaded files are not inside backups; they stay in the `assets` store.
