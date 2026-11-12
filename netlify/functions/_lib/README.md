# netlify/functions/_lib/

Shared helpers used by the functions one folder up. Nothing here has a web address: Netlify deploys every file at the
top of `netlify/functions/` as a function, but ignores this folder because it has no `_lib.ts` or `index.ts`
(never add one). What each file does is described at the top of the file and in `../README.md`.

| File | What it does |
|---|---|
| `_db.ts` | The database connection (`query`, `tx`, `migrate`). Postgres on Netlify, PGlite on a laptop and in the tests. |
| `_auth.ts` | Password hashing (scrypt), the signed login cookies (helpers and owner), the wrong-password lockout. |
| `_wedding.ts` | Replies, plain-English errors, input checks, tokens, dates, default texts, template config, activity log. |
| `_invite.ts` | Checks an invite design before saving it; turns it into URLs for the guest page. |
| `_data.ts` | Families with their state, creating a wedding, export and import of a whole wedding. |
| `_backup.ts` | Writing (one consistent snapshot), pruning (keeping rules) and reading backups. |
| `_github-backup.ts` | Copies every wedding to the owner's private GitHub repository after each backup; never makes a backup fail. |
| `_blobs.ts` | Netlify Blobs (uploaded files and backup files), per-deploy store names, memory/file stand-ins. |
