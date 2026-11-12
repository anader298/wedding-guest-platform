// =====================================================================================================
// tools/seed.ts: `npm run seed` creates the demo wedding "karim-and-maya" on THIS laptop.
//
// What it is for: a ready-made wedding to click through locally (`npm run dev`, then open
//   /karim-and-maya/?demo=1 and /karim-and-maya/admin/ with password "wedding").
// Who calls it: a developer, from the repository root.
// What it reads/writes: the local database (.data/pglite/): one wedding, its texts, its invite and
//   3 demo families with obviously fake names.
//
// What NOT to change and why:
//   - The design is the template exactly (templateInvite()), so this wedding's invite looks identical to
//     site/app/index.html. Do not "improve" it here.
//   - It refuses to run against a real Postgres database (NETLIFY_DB_URL set) unless SEED_ALLOW_REMOTE=1,
//     so demo families never land on the live site by accident.
//   - Idempotent: running it again adds nothing that already exists and changes nothing else.
//
//notes:
// - The real guests' names are never in this repository. Only the three fake families below.
// =====================================================================================================
import { tx, one, query, closeDb, driverName } from "../netlify/functions/_lib/_db.ts";
import { insertWedding } from "../netlify/functions/_lib/_data.ts";
import { templateInvite, zonedToUtc, newToken, nameKey } from "../netlify/functions/_lib/_wedding.ts";

if (driverName() === "pg" && process.env.SEED_ALLOW_REMOTE !== "1") {
  console.error("Refusing to seed a real Postgres database. This tool is for the local copy only (set SEED_ALLOW_REMOTE=1 if you truly mean it).");
  process.exit(1);
}

const SLUG = "karim-and-maya";
const FAMILIES = [
  { name: "The Demo Family", side: "a", max_guests: 4 },
  { name: "Test Family Two", side: "b", max_guests: 2 },
  { name: "Sample Family Three", side: "a", max_guests: 3 },
];

let w = await one<any>("select * from weddings where slug = $1", [SLUG]);
if (!w) {
  const inv = templateInvite(); // = CONFIG from site/app/app.js + the template's colours/fonts
  w = await tx(async (q) => {
    const row = await insertWedding(q, {
      slug: SLUG, groom: "Karim", bride: "Maya", ar: "كريم و مايا",
      event_at: zonedToUtc("2027-06-19", "18:30", "Asia/Beirut"), timezone: "Asia/Beirut", reply_by: "2027-05-15",
      password: "wedding", notes: "Demo wedding created by tools/seed.ts", by: "seed",
    }, { draft: inv, live: inv });
    await q.query("update invites set published_at = now(), published_by = 'seed' where wedding_id = $1", [row.id]);
    return row;
  });
  console.log(`Created wedding ${SLUG} (password "wedding").`);
} else {
  console.log(`Wedding ${SLUG} already exists; leaving it as it is.`);
}

for (const f of FAMILIES) {
  const exists = await one("select 1 from families where wedding_id = $1 and name_key = $2", [w.id, nameKey(f.name)]);
  if (exists) continue;
  await query("insert into families (wedding_id, token, name, name_key, side, max_guests, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,'seed','seed')",
    [w.id, newToken(), f.name, nameKey(f.name), f.side, f.max_guests]);
  console.log(`  added ${f.name}`);
}
const rows = await query("select name, token from families where wedding_id = $1 and removed_at is null order by name", [w.id]);
console.log("Demo links (with `npm run dev` running):");
for (const r of rows) console.log(`  ${r.name}: http://localhost:8888/${SLUG}/?t=${r.token}`);
console.log(`Admin: http://localhost:8888/${SLUG}/admin/  (any name, password "wedding")`);
await closeDb();
