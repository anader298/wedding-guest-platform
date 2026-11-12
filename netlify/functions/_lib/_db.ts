// =====================================================================================================
// _db.ts: the one door to the database.
//
// What it is for: every other function reads and writes Postgres through query() / tx() from this file.
// Who calls it: all files in netlify/functions/, tools/seed.ts, tools/migrate.ts and the tests.
// What it reads/writes: the Postgres database (Netlify Database on the live site, a local copy on a laptop)
//   and, in migrate(), the files in migrations/*.sql.
//
// Which database is used:
//   - On Netlify: the connection string in NETLIFY_DB_URL (Netlify Database) or NETLIFY_DATABASE_URL
//     (older name), using the "pg" driver.
//   - On a laptop or in tests: PGlite, a real Postgres that runs inside Node. Its data lives in .data/pglite/
//     (or wherever PGLITE_DIR points; "memory://" keeps it in memory, which is what the tests use).
//   - DB_DRIVER=pg or DB_DRIVER=pglite forces one of the two.
//
// What NOT to change and why:
//   - Always pass values as parameters ($1, $2, ...), never glue them into the SQL text. That is what stops
//     a family name like "O'Brien" (or something nastier) from breaking or rewriting a query.
//   - Inside tx(fn), use ONLY the `q` handed to fn. Calling the global query() from inside a transaction
//     waits for the transaction to finish, which never happens (the request hangs) on PGlite.
//   - migrate() must stay safe to run on every cold start: it only applies files not yet listed in
//     schema_version, inside one transaction, under an advisory lock so two cold starts cannot race.
//   - Never edit a migration file that already ran somewhere. Add migrations/NNN_<what>.sql instead.
//
//notes:
// - Rows come back as plain objects. Dates are turned into ISO strings and 64-bit integers into numbers
//   here, so every caller sees the same shapes on both drivers.
// - Sums/averages come back as text from Postgres; cast them in SQL (sum(x)::int) when you need numbers.
// - The migrations folder is found by looking in MIGRATIONS_DIR, the current folder, and next to this
//   file. netlify.toml ships it with every function (included_files).
// =====================================================================================================
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Row = Record<string, any>;
export interface Q {
  /** Runs one parameterised statement and returns its rows. */
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs SQL text that may hold several statements and no parameters (migrations only). */
  exec(sql: string): Promise<void>;
}

type Driver = Q & { tx<T>(fn: (q: Q) => Promise<T>): Promise<T>; close(): Promise<void> };

function normalize(v: any): any {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (Array.isArray(v)) return v.map(normalize);
  return v;
}
function normRows(rows: any[]): any[] {
  for (const r of rows) for (const k of Object.keys(r)) r[k] = normalize(r[k]);
  return rows;
}

export function connectionString() {
  return process.env.NETLIFY_DB_URL || process.env.NETLIFY_DATABASE_URL || "";
}
export function driverName(): "pg" | "pglite" {
  const d = (process.env.DB_DRIVER || "").toLowerCase();
  if (d === "pg" || d === "pglite") return d;
  return connectionString() ? "pg" : "pglite";
}

async function makePg(): Promise<Driver> {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(20, (v: string) => Number(v)); // int8 -> number (ids and counts are far below 2^53)
  const pool = new pg.Pool({ connectionString: connectionString(), max: 3, idleTimeoutMillis: 10_000 });
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<any> }): Q => ({
    async query(sql, params = []) { return normRows((await c.query(sql, params as any[])).rows); },
    async exec(sql) { await c.query(sql); },
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn(wrap(client));
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}

async function makePglite(): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  let dir = process.env.PGLITE_DIR || ".data/pglite";
  if (!dir.startsWith("memory://")) { dir = resolve(dir); mkdirSync(dir, { recursive: true }); }
  const db = new PGlite(dir);
  const wrap = (c: any): Q => ({
    async query(sql, params = []) { return normRows((await c.query(sql, params)).rows); },
    async exec(sql) { await c.exec(sql); },
  });
  return {
    ...wrap(db),
    async tx(fn) { return db.transaction(async (t: any) => fn(wrap(t))); },
    async close() { await db.close(); },
  };
}

let driverP: Promise<Driver> | null = null;
let migrated: Promise<number> | null = null;
function driver() {
  if (!driverP) driverP = driverName() === "pg" ? makePg() : makePglite();
  return driverP;
}

/** Makes sure the database is migrated (once per cold start), then returns the driver. */
async function ready() {
  const d = await driver();
  if (!migrated) migrated = migrateWith(d).catch((e) => { migrated = null; throw e; });
  await migrated;
  return d;
}

/** Runs one parameterised statement; returns the rows. */
export async function query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await ready()).query<T>(sql, params);
}
/** First row or null. */
export async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(sql, params))[0] ?? null;
}
/** Runs fn inside one transaction: everything in it is saved together or not at all. Use only `q` inside. */
export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return (await ready()).tx(fn);
}
/** A Q that runs outside any transaction (for helpers that accept either). */
export const db: Q = { query: (s, p) => query(s, p), exec: async (s) => { await (await ready()).exec(s); } };

function migrationsDir() {
  const here = (() => { try { return dirname(fileURLToPath(import.meta.url)); } catch { return ""; } })();
  const candidates = [
    process.env.MIGRATIONS_DIR || "",
    join(process.cwd(), "migrations"),
    here && join(here, "..", "..", "..", "migrations"),   // netlify/functions/_lib/ -> repo root
    here && join(here, "..", "..", "migrations"),
    here && join(here, "migrations"),
    "/var/task/migrations",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("The migrations folder was not found. Looked in: " + candidates.join(", "));
}

/** Lists migrations/NNN_*.sql in order: [{ version, file, sql }]. */
export function migrationFiles() {
  const dir = migrationsDir();
  return readdirSync(dir)
    .filter((f) => /^\d{3,}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: parseInt(f, 10), file: f, sql: readFileSync(join(dir, f), "utf8") }));
}

async function migrateWith(d: Driver): Promise<number> {
  const files = migrationFiles();
  return d.tx(async (q) => {
    await q.query("select pg_advisory_xact_lock(727274)"); // one migrator at a time across all cold starts
    const exists = (await q.query("select to_regclass('public.schema_version') as t"))[0]?.t;
    const done = new Set<number>(exists ? (await q.query("select version from schema_version")).map((r) => Number(r.version)) : []);
    let applied = 0;
    for (const m of files) {
      if (done.has(m.version)) continue;
      await q.exec(m.sql);
      await q.query("insert into schema_version (version) values ($1)", [m.version]);
      applied++;
    }
    return applied;
  });
}

/** Applies any migration not applied yet. Safe to call again and again; returns how many were applied this call. */
export async function migrate(): Promise<number> {
  const d = await driver();
  const n = await migrateWith(d);
  migrated = Promise.resolve(0);
  return n;
}

/** Highest applied migration number. */
export async function schemaVersion(): Promise<number> {
  const r = await one<{ v: number }>("select coalesce(max(version), 0)::int as v from schema_version");
  return r?.v ?? 0;
}

/** Closes the connection (tests and command-line tools). The next query opens a new one. */
export async function closeDb() {
  if (driverP) { const d = await driverP; driverP = null; migrated = null; await d.close(); }
}

/** True when err is Postgres "unique value already exists" (code 23505). */
export function isUniqueViolation(err: any) { return err && (err.code === "23505" || /duplicate key/.test(String(err.message))); }
