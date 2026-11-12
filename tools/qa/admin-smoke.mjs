// ADMIN SMOKE TEST (one wedding's admin page)
// What it does, in plain words: opens the wedding's admin page on a simulated iPhone, logs in with the
// name "QA check" and the wedding password, then visits every tab (Send invites, Dashboard, Messages,
// Activity, Design, Settings) and takes a screenshot of each. It reports anything missing and any page error.
// It presses no Save, Publish, Send, Remove or Reset button. The only thing it leaves behind is one
// "login" line in the wedding's Activity tab under the name "QA check".
//
// Usage:   node tools/qa/admin-smoke.mjs <base-url> <slug>
// Example: node tools/qa/admin-smoke.mjs http://localhost:8888 karim-and-maya
// Password from WEDDING_PASSWORD (default "wedding"). Screenshots go to the folder printed at the end.
// Needs Playwright (see tools/qa/README.md). Exit code 0 = fine, 1 = problems found.
//notes: (developers) on http:// it falls back to Chromium at iPhone size (WebKit drops Secure cookies on http).
import { playwright, launchQuiet } from "./_browser.mjs";   // silent browsers only
const { webkit, chromium, devices } = playwright;
import os from "node:os"; import path from "node:path"; import fs from "node:fs";

const [base0, slug] = process.argv.slice(2);
if (!base0 || !slug) { console.error("usage: node tools/qa/admin-smoke.mjs <base-url> <slug>"); process.exit(2); }
const base = base0.replace(/\/+$/, "");
const password = process.env.WEDDING_PASSWORD || "wedding";
const out = path.join(os.tmpdir(), "twp-qa"); fs.mkdirSync(out, { recursive: true });
const shot = (p, n) => p.screenshot({ path: path.join(out, `${slug}-admin-${n}.png`) });

// Safari's engine refuses "Secure" login cookies on plain http://localhost, so on a local http address we use
// Chrome's engine with the iPhone's screen size. On https (previews, the live site) it is the real iPhone engine.
const engine = base.startsWith("http://") ? chromium : webkit;
const { defaultBrowserType, ...iphone } = devices["iPhone 15"];
const b = await launchQuiet(engine); const ctx = await b.newContext(engine === webkit ? devices["iPhone 15"] : iphone);
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const problems = [];
await p.goto(`${base}/${slug}/admin/`, { waitUntil: "load" }); await p.waitForTimeout(1500);
await shot(p, "0-login");
await p.getByPlaceholder(/first name/i).fill("QA check");
await p.locator('input[type="password"]:visible').first().fill(password);
await p.keyboard.press("Enter");
await p.waitForTimeout(2500);
await shot(p, "1-send");
const body = await p.textContent("body");
const checks = {
  loggedIn: /Log out/i.test(body),
  sendTab: /Send invites/.test(body),
  copyInviteButtons: await p.getByText(/Copy invite/i).count(),
  previewButtons: await p.getByText(/Preview invite/i).count(),
};

// Visit each tab by its visible label (works whatever data-tab names the page uses).
const tabs = ["Dashboard", "Messages", "Activity", "Design", "Settings", "Send invites"];
for (const [i, label] of tabs.entries()) {
  const btn = p.locator("[data-tab]", { hasText: new RegExp(`^\\s*${label}\\s*$`, "i") }).first();
  if (!(await btn.count())) { problems.push(`tab "${label}" not found`); continue; }
  await btn.click(); await p.waitForTimeout(1500);
  await shot(p, `${i + 2}-${label.toLowerCase().replace(/\s+/g, "-")}`);
  const t = await p.textContent("body");
  if (label === "Dashboard" && !/Download Excel/i.test(t)) problems.push("Dashboard: no Download Excel button");
  if (label === "Design") {
    if (!(await p.locator("iframe").count())) problems.push("Design: no preview frame");
    if (!/Publish/i.test(t)) problems.push("Design: no Publish button");
    if (!/Save draft/i.test(t)) problems.push("Design: no Save draft button");
  }
  if (label === "Settings" && !/password/i.test(t)) problems.push("Settings: no change-password section");
}
if (!checks.loggedIn) problems.push("login did not work (no Log out button)");
console.log({ slug, ...checks, problems, pageErrors: errs, screenshots: out });
await b.close();
process.exit(problems.length || errs.length ? 1 : 0);
