# migrations/

The database layout, as numbered SQL files. `netlify/functions/_lib/_db.ts` applies every file that has not run yet,
in number order, on the first request after a deploy (and `npm run migrate` does the same by hand). Each applied
number is recorded in the `schema_version` table.

| File | What it does |
|---|---|
| `001_init.sql` | Creates every table: weddings, families, rsvps, sends, opens, activity, helpers, settings, invites, assets, resets, backups, schema_version. |
| `002_login_attempts.sql` | Table `login_attempts`: counts wrong passwords per wedding (or the manager) and IP address, for the 15-minute lockout. |
| `003_activity_by_id.sql` | Index `activity (wedding_id, id desc)`: the Activity tab's every-30-seconds "anything new?" question and the manager's "last activity" column. |
| `004_backup_github.sql` | Columns `backups.kind` (nightly / manual / before-restore / archive, for the keeping rules) and `backups.github` (the result of the copy to GitHub). |

Rules:
- Never edit a file that has already run anywhere (the live site, a laptop). Add the next number instead,
  e.g. `002_add_table_numbers.sql`. Names: three digits, underscore, words with letters/digits/underscores/dashes.
- Prefer changes that only add (new table, new column with a default). Removing or renaming a column breaks
  the code still running until the deploy finishes, and makes old backups harder to restore.
- Run `npm test` after adding a migration: the first test applies all migrations twice.

Note: Netlify Database would also run SQL files placed in `netlify/database/migrations/`. Keep that folder empty;
this folder (`migrations/`) is the only place for migrations.
