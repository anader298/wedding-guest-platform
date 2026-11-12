# tools/

Command-line helpers, run from the app folder.

| File | Command | What it does |
|---|---|---|
| `seed.ts` | `npm run seed` | Creates the demo wedding `karim-and-maya` (password `wedding`) with 3 fake families in the LOCAL database (`.data/pglite/`). Safe to run again. Refuses to touch a real database. |
| `sample-guests.mjs` | `node tools/sample-guests.mjs <base-url>` | Fills the local demo wedding with 16 invented families, four helpers, sends, opens and answers (used for the README screenshots). Local sites only. |
| `migrate.ts` | `npm run migrate` | Applies database migrations that have not run yet. Optional: the functions do it by themselves. |
| `qa/` | see `qa/README.md` | Browser checks against a running site. |

The owner and the helpers never need anything in this folder. Nothing here runs on the live site by itself.

Rules for anything added here:
- Plain-words comment at the top: what it does, whether it changes anything, how to run it.
- Never read or write the production database directly. Use the admin API with the `x-wedding-key` header, the way the QA scripts do.
- Never put a password or a database address in a file. Read them from environment variables.
