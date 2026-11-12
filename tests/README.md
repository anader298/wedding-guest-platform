# tests/

Automatic checks. Run them all with `npm test` (no internet, no Netlify account needed). Each file runs in its own
process with a fresh, empty, in-memory database and in-memory file storage, and calls the functions directly.

| File | What it checks |
|---|---|
| `_env.ts` | Not a test. Points the app at the in-memory database/storage. Imported first by every test. |
| `_helpers.ts` | Not a test. Calls a function with a request, keeps cookies, creates a wedding, logs a helper in. |
| `db.test.ts` | Migrations apply twice safely, transactions roll back, dates/texts reproduce the template, password hashing, input checks, design checks, the template config equals `site/app/app.js`. |
| `public.test.ts` | Guest page: lookup, opens, RSVP rules (clamping, names required, preview), a token only works in its own wedding, the public design never leaks contacts, archived = 410. |
| `admin.test.ts` | Helper admin: login rules, families (duplicates, validation, edit, below-answer, delete/restore), upload, mark-sent/undo, messages with conflict check, activity, reset-family/reset-all/undo, design draft/publish/discard with conflict check, uploads, owner cookie, change-password, export. |
| `lockout.test.ts` | Wrong-password lockout: 5 wrong tries lock that IP for 15 minutes (helper login, x-wedding-key, owner login), other IPs unaffected, old tries expire, a right password clears the count. |
| `netlify-toml.test.ts` | `netlify.toml`: no redirect that only adds/removes a final slash (it would loop on Netlify), every template file has its root rewrite, only `site/` is published. |
| `safety.test.ts` | Code-and-safety review: a broken design never shows another couple's details, cross-wedding tokens are 404 everywhere, upload name clashes never overwrite, broken addresses and unreadable times give sentences not server errors, lockout on change-password, archived = 410 for every write, backup snapshot + restore races, store names in health, the activity index, helpers live in `netlify/functions/_lib/`. |
| `manage.test.ts` | Owner manager: login fails closed, create (rules and defaults), copy from another wedding, update, set-password, counts, data filters, check report, nightly + manual backup, restore into a new address and over the same one (preview lists missing pictures), delete, health. |
| `meta.test.ts` | Link previews (what WhatsApp shows): the Edge Function writes each wedding's names, date, place, preview picture (uploaded = 1200×630 JPG, else the default envelope) and address without the guest code into the page's head lines, escapes odd names, leaves every other byte of the template alone, copes with missing lines, works with and without the final slash, keeps the headers, sends the page unchanged on any doubt; an archived wedding keeps its names. |
| `backup-github.test.ts` | How long backups are kept (90 days of nightly copies, the first of each month and every manual / before-restore / archive copy for ever), the backup taken when a wedding is archived, and the copy to GitHub against a fake GitHub (create, update with sha, skip unchanged, bad token, missing repository, busy/retries, network down, token end date on the Health line). |

When you change behaviour on purpose, change the test in the same commit and say why in plain words.
