# netlify/functions/

The server side of Wedding Guest Platform. Each `.ts` file in this folder is one Netlify Function with its own
web address (declared at the bottom of the file in `config`). The shared helpers live in `_lib/`: Netlify turns
EVERY file at the top of this folder into a deployed function (a leading `_` does not stop it), but it ignores a
folder that has no `_lib.ts`/`index.ts` inside. So never put a helper file at the top level, and never add an
`index.ts` to `_lib/` (`tests/safety.test.ts` checks both). The full contract of every address is `docs/API.md`.

| File | Address | What it does |
|---|---|---|
| `wedding-guest.ts` | `GET /<slug>/api/guest` | Public. Who is this guest (name, seats, earlier answer). Counts opens. |
| `wedding-rsvp.ts` | `POST /<slug>/api/rsvp` | Public. Saves a guest's answer. |
| `wedding-invite.ts` | `GET /<slug>/api/invite` | Public. The wedding's published design (texts, colours, pictures). Draft for logged-in helpers. |
| `wedding-asset.ts` | `GET /<slug>/asset/<name>` | Public. Serves an uploaded picture, song or video. |
| `wedding-admin.ts` | `/<slug>/api/admin/<action>` | The helpers' admin page: guest list, sending, messages, activity, resets, design, uploads, password, export. |
| `manage.ts` | `/api/manage/<action>` | The owner's manager page: all weddings, create/edit/archive/delete, data, check, backups, restore, health. |
| `backup-nightly.ts` | (none, runs at 03:00 UTC) | Nightly full backup into Blobs store `backups` (nightly copies kept 90 days, the first of each month for ever), plus the copy to GitHub when set up. |
| `_lib/_db.ts` | | The database connection (`query`, `tx`, `migrate`). Postgres on Netlify, PGlite on a laptop. |
| `_lib/_auth.ts` | | Password hashing (scrypt) and the signed login cookies (helpers and owner). |
| `_lib/_wedding.ts` | | Shared helpers: replies, plain-English errors, input checks, tokens, dates, default texts, template config, activity log. |
| `_lib/_invite.ts` | | Checks an invite design before saving it; turns it into URLs for the guest page. |
| `_lib/_data.ts` | | Families with their state, creating a wedding, export and import of a whole wedding. |
| `_lib/_backup.ts` | | Writing, pruning and reading backups (used by `backup-nightly.ts` and `manage.ts`). |
| `_lib/_github-backup.ts` | | The copy of every wedding to the owner's private GitHub repository (`BACKUP_GITHUB_REPO`, `BACKUP_GITHUB_TOKEN`), after each backup. |
| `_lib/_blobs.ts` | | Netlify Blobs (uploaded files and backup files), with a memory/file stand-in for tests and laptops. Deploy previews write to their own stores (`assets-<context>-<deploy id>`, from Netlify's runtime `Netlify.context.deploy`, because `CONTEXT` is not set for functions) and only read the live ones. |

Rules that keep this safe:
- Values always go into SQL as `$1, $2` parameters, never glued into the text.
- Multi-row changes run inside `tx(...)`; inside it only the `q` it hands you may be used.
- `by` (who did it) comes from the login, never from the page.
- Error messages are shown to helpers as they are: plain English sentences.
- After any change: `npm test` must stay green.
