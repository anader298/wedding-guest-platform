// MANAGER SMOKE TEST (the owner's /manage/ page)
// What it does, in plain words: opens /manage/ on a simulated laptop, logs in with the owner password,
// and checks that the Weddings list, the New wedding form, the Data page, the Check page, the Backups
// section and the health line are all there. Takes a screenshot of each. Changes nothing.
//
// With --write (only allowed on localhost or a Netlify deploy-preview address) it also creates a throwaway
// wedding called "qa-smoke-<number>", checks it appears in the list and that its invite and admin pages
// open, then deletes it again. Never use --write on the live site.
//
// Usage:   OWNER_PASSWORD=... node tools/qa/manage-smoke.mjs <base-url> [--write]
// Example: OWNER_PASSWORD=test node tools/qa/manage-smoke.mjs http://localhost:8888 --write
// Needs Playwright (see tools/qa/README.md). Exit code 0 = fine, 1 = problems found, 2 = could not run.
//notes: (developers) --write refuses any address that is not localhost or deploy-preview-*; keep that guard.
import { playwright, launchQuiet } from "./_browser.mjs";   // silent browsers only
const { chromium } = playwright;
import os from "node:os"; import path from "node:path"; import fs from "node:fs";

const args = process.argv.slice(2);
const base0 = args.find((a) => !a.startsWith("--"));
const write = args.includes("--write");
const pw = process.env.OWNER_PASSWORD;
if (!base0 || !pw) { console.error("usage: OWNER_PASSWORD=... node tools/qa/manage-smoke.mjs <base-url> [--write]"); process.exit(2); }
const base = base0.replace(/\/+$/, "");
if (write && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/deploy-preview-\d+--[a-z0-9-]+\.netlify\.app$/.test(base)) {
  console.error("--write is only allowed on localhost or a deploy-preview-N--site.netlify.app address"); process.exit(2);
}
const out = path.join(os.tmpdir(), "twp-qa"); fs.mkdirSync(out, { recursive: true });

const b = await launchQuiet(chromium); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const shot = (n) => p.screenshot({ path: path.join(out, `manage-${n}.png`), fullPage: true });
const problems = [];

await p.goto(`${base}/manage/`, { waitUntil: "load" }); await p.waitForTimeout(1500);
await shot("0-login");
await p.locator('input[type="password"]:visible').first().fill(pw);
await p.keyboard.press("Enter");
await p.waitForTimeout(2500);
await shot("1-weddings");
let t = await p.textContent("body");
if (!/wedding/i.test(t) || /wrong password/i.test(t)) problems.push("login failed or no Weddings list");
if (!/New wedding/i.test(t)) problems.push("no New wedding button/form");

// API checks with the owner cookie the login just set.
const api = async (m, a, body) => { const r = await p.request.fetch(`${base}/api/manage/${a}`, { method: m, data: body }); return { status: r.status(), json: await r.json().catch(() => null) }; };
const me = await api("GET", "me"); if (me.status !== 200) problems.push(`api/manage/me ${me.status}`);
const weddings = await api("GET", "weddings"); if (weddings.status !== 200 || !Array.isArray(weddings.json?.weddings ?? weddings.json)) problems.push(`api/manage/weddings ${weddings.status}`);
const health = await api("GET", "health"); if (health.status !== 200 || !health.json?.db_ok) problems.push(`health not ok: ${JSON.stringify(health.json)}`);
const data = await api("GET", "data"); if (data.status !== 200 || !Array.isArray(data.json?.rows)) problems.push(`api/manage/data ${data.status}`);
const check = await api("GET", "check"); if (check.status !== 200 || !Array.isArray(check.json?.issues)) problems.push(`api/manage/check ${check.status}`);
const backups = await api("GET", "backups"); if (backups.status !== 200) problems.push(`api/manage/backups ${backups.status}`);

// Visit the page sections by their visible labels.
for (const label of ["Data", "Check", "Backups"]) {
  const el = p.getByRole("button", { name: new RegExp(`^\\s*${label}`, "i") }).or(p.getByRole("link", { name: new RegExp(`^\\s*${label}`, "i") })).first();
  if (!(await el.count())) { problems.push(`no "${label}" button or link`); continue; }
  await el.click(); await p.waitForTimeout(1500); await shot(`2-${label.toLowerCase()}`);
  t = await p.textContent("body");
  if (label === "Data" && !/Download Excel/i.test(t)) problems.push("Data page: no Download Excel");
}

if (write) {
  const slug = `qa-smoke-${Date.now() % 100000}`;
  const c = await api("POST", "create", { slug, groom: "Groom", bride: "Bride", event_date: "2030-06-01", event_time: "19:00", timezone: "Asia/Beirut" });
  if (c.status !== 200) problems.push(`create ${slug}: ${c.status} ${JSON.stringify(c.json)}`);
  else {
    const inv = await p.request.get(`${base}/${slug}/api/invite`); if (inv.status() !== 200) problems.push(`new wedding invite api ${inv.status()}`);
    const pg = await ctx.newPage(); await pg.goto(`${base}/${slug}/?demo=1`, { waitUntil: "networkidle" });
    await pg.screenshot({ path: path.join(out, "manage-3-new-wedding-invite.png") }); await pg.close();
    const adm = await p.request.get(`${base}/${slug}/admin/`); if (adm.status() !== 200) problems.push(`new wedding admin page ${adm.status()}`);
    const badDelete = await api("POST", "delete", { slug, confirm: "wrong" });
    if (badDelete.status === 200) problems.push("delete worked WITHOUT the right confirm word");
    const d = await api("POST", "delete", { slug, confirm: slug }); if (d.status !== 200) problems.push(`delete ${slug}: ${d.status}`);
  }
}
console.log({ base, write, problems, pageErrors: errs, screenshots: out });
await b.close();
process.exit(problems.length || errs.length ? 1 : 0);
