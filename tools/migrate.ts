// =====================================================================================================
// tools/migrate.ts: `npm run migrate` applies any database migration that has not run yet.
//
// What it is for: preparing the local database (.data/pglite/) or, with NETLIFY_DB_URL set, a Postgres
//   database, by hand. Functions also do this by themselves on their first request, so this is optional.
// Who calls it: a developer, from the repository root.
// What it reads/writes: migrations/*.sql, the schema_version table.
// What NOT to change: nothing to tune here; the logic lives in netlify/functions/_lib/_db.ts migrate().
//notes:
// - Safe to run any number of times.
// =====================================================================================================
import { migrate, schemaVersion, closeDb, driverName } from "../netlify/functions/_lib/_db.ts";

const n = await migrate();
console.log(`Database (${driverName()}): ${n} migration(s) applied, now at version ${await schemaVersion()}.`);
await closeDb();
