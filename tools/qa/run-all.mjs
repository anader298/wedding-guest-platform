// WEDDING GUEST PLATFORM: ALL AUTOMATIC CHECKS IN ONE COMMAND (tools/qa/run-all.mjs, run by `npm run qa`)
// What it is:  starts a throwaway copy of the whole website on this computer with the REAL functions and an empty
//              database of its own, puts the demo wedding in it, runs the journey tests (journeys.mjs) on an iPhone
//              and an Android phone, stops it, then runs the page tests (pages-smoke.mjs, pretend backend).
// Who uses it: whoever changes anything, before proposing the change. One command: `npm run qa`.
//              `node tools/qa/run-all.mjs --serve` only starts the throwaway site and prints its address and owner
//              password (Ctrl+C stops it and deletes everything), for clicking around or running one test file.
// What it reads/writes: a new temporary folder: a copy of this folder's files (what is on disk now, without .git,
//              .env, .data, .netlify, node_modules), and inside it the database, uploads and backups that `netlify dev`
//              makes. Deleted at the end unless KEEP=1. It never touches .data/, .env, the live site or any Netlify
//              setting, and runs `netlify dev --offline`, so the Netlify CLI does not even talk to Netlify.
// Must not change, and why:
//   - The copy in a temp folder is what keeps the test database, pictures and backups out of this folder, and stops
//     `netlify dev` from reloading in the middle of a run when someone edits a file.
//   - DB_DRIVER=pg here means "the database `netlify dev` starts for this copy" (it sets NETLIFY_DB_URL itself, to a
//     local server under the copy's .netlify/db). Do not switch it to pglite: several functions opening the same PGlite
//     folder at once crash under netlify dev (RuntimeError: Aborted), see tools/qa/README.md.
// //notes: needs the Netlify CLI (`npm i -g netlify-cli`, else `npx netlify-cli`) and Playwright (README).
//          ONLY=iPhone / ONLY=Pixel is passed on to both test files. SKIP_SMOKE=1 runs only the journeys.
//          The owner password is made up for each run and only lives in this process's memory.
//          The database address is found by trying each port the netlify dev process group listens on with `pg`.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SERVE = process.argv.includes("--serve");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "twp-qa-"));
const APP = path.join(TMP, "app");
const OWNER_PASSWORD = "qa-" + crypto.randomBytes(9).toString("hex");
const log = (m) => console.log(`[qa] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });

// A copy of what is on disk now: tracked files plus new files that are not ignored (.env, .data, .netlify stay out).
function copyApp() {
  let files;
  try { files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().split("\0").filter(Boolean); }
  catch {   // not a git checkout: walk the folder, skipping what .gitignore keeps out
    const skip = new Set([".git", "node_modules", ".netlify", ".data", "backups", ".env", ".DS_Store"]);
    const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => skip.has(e.name) || e.name.startsWith(".env.") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    files = walk("");
  }
  for (const f of files) {
    const from = path.join(ROOT, f);
    if (!fs.existsSync(from) || fs.statSync(from).isDirectory()) continue;   // deleted but not yet committed, or a submodule
    fs.mkdirSync(path.dirname(path.join(APP, f)), { recursive: true });
    fs.copyFileSync(from, path.join(APP, f));
  }
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(APP, "node_modules"), "dir");
  return files.length;
}

// The address of the database netlify dev started: one of the ports its process group listens on answers `select 1`.
async function findDb(pgid, sitePort) {
  const { Client } = createRequire(path.join(ROOT, "x.js"))("pg");
  for (let round = 0; round < 30; round++) {
    const out = spawnSync("lsof", ["-nP", "-a", "-g", String(pgid), "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" }).stdout || "";
    const ports = [...new Set([...out.matchAll(/:(\d+) \(LISTEN\)/g)].map((m) => Number(m[1])))].filter((p) => !sitePort.includes(p));
    for (const p of ports) {
      const url = `postgres://localhost:${p}/postgres`;
      const c = new Client({ connectionString: url, connectionTimeoutMillis: 1500 });
      try { await c.connect(); await c.query("select 1"); await c.end(); return url; } catch { await c.end().catch(() => {}); }
    }
    await sleep(1000);
  }
  return "";
}

let server = null;
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch {}
  for (let i = 0; i < 40 && server.exitCode === null; i++) await sleep(250);
  try { process.kill(-server.pid, "SIGKILL"); } catch {}
}
const cleanup = async () => { await stopServer(); if (process.env.KEEP === "1") log(`kept ${TMP}`); else fs.rmSync(TMP, { recursive: true, force: true }); };
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

let code = 0;
try {
  // 0. never a loud browser: every script must get its browsers from _browser.mjs (muted)
  const quiet = spawnSync(process.execPath, ["--test", "tests/journeys/qa-silent.test.mjs"], { cwd: ROOT, encoding: "utf8" });
  if (quiet.status !== 0) throw new Error("a QA script opens browsers without tools/qa/_browser.mjs (they could play sound), nothing was run:\n" + quiet.stdout.slice(-1200));
  log("QA browsers are all muted (tests/journeys/qa-silent.test.mjs)");
  log(`copied ${copyApp()} files to ${APP}`);
  const env = { ...process.env, DB_DRIVER: "pg", OWNER_PASSWORD, NETLIFY_DB_URL: "", NETLIFY_DATABASE_URL: "", BROWSER: "none" };

  // 1. the real site (netlify dev, offline) on a free port, from the copy
  const port = await freePort(), fnPort = await freePort(), staticPort = await freePort();   // netlify dev's static server is always 3999 unless given: a second copy (or `npm run dev`) would clash
  const [cmd, args] = has("netlify") ? ["netlify", []] : ["npx", ["--yes", "netlify-cli"]];
  const devLog = path.join(TMP, "netlify-dev.log");
  const out = fs.openSync(devLog, "w");
  server = spawn(cmd, [...args, "dev", "--offline", "--port", String(port), "--functions-port", String(fnPort), "--staticServerPort", String(staticPort)], { cwd: APP, env, stdio: ["ignore", out, out], detached: true });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && server.exitCode === null; i++) {
    try { const r = await fetch(base + "/api/manage/health"); if (r.status === 401 || r.ok) { up = true; break; } } catch {}
    await sleep(1000);
  }
  if (!up) throw new Error(`netlify dev did not start (KEEP=1 keeps its log):\n` + fs.readFileSync(devLog, "utf8").slice(-1500));
  log(`site running at ${base}`);

  // 2. the demo wedding, in netlify dev's own throwaway database
  const dbUrl = await findDb(server.pid, [port, fnPort, staticPort]);
  if (!dbUrl) throw new Error("could not find the database netlify dev started (is lsof available?)");
  const seed = spawnSync(process.execPath, ["--import", "tsx", "tools/seed.ts"], { cwd: APP, env: { ...env, NETLIFY_DB_URL: dbUrl, SEED_ALLOW_REMOTE: "1" }, encoding: "utf8" });
  if (seed.status !== 0) throw new Error("the seed failed:\n" + seed.stdout + seed.stderr);
  log("seeded karim-and-maya (local throwaway database)");

  if (SERVE) {
    log(`ready. Address: ${base}   Owner password: ${OWNER_PASSWORD}   Helpers' password of karim-and-maya: wedding`);
    log(`try: OWNER_PASSWORD=${OWNER_PASSWORD} node tools/qa/journeys.mjs ${base}`);
    log("Ctrl+C stops it and deletes the copy.");
    await new Promise((r) => server.on("exit", r));
  } else {
    // 3. the journeys, against the real functions
    const j = spawnSync(process.execPath, [path.join(HERE, "journeys.mjs"), base], { cwd: ROOT, env: { ...process.env, OWNER_PASSWORD }, stdio: "inherit" });
    if (j.status !== 0) code = 1;
    if (/RuntimeError|status 500/.test(fs.readFileSync(devLog, "utf8"))) log(`the server log has errors: ${devLog} (KEEP=1 keeps it)`);
    await stopServer();

    // 4. the page tests (pretend backend, pixel checks against the untouched template)
    if (process.env.SKIP_SMOKE !== "1") {
      log("page tests (pages-smoke.mjs)");
      const s = spawnSync(process.execPath, [path.join(HERE, "pages-smoke.mjs")], { cwd: ROOT, env: process.env, stdio: "inherit" });
      if (s.status !== 0) code = 1;
    }
  }
} catch (e) {
  console.error("[qa] " + (e.message || e));
  code = 1;
} finally {
  await cleanup();
}
if (!SERVE) log(code ? "SOMETHING FAILED (see above)" : "everything passed");
process.exit(code);
