// WEDDING GUEST PLATFORM: JOURNEY TESTS (tools/qa/journeys.mjs)
// What it is:  the automatic replacement for hand-testing. It plays the owner, a helper and a guest, one after the
//              other, on an iPhone (Safari's engine, WebKit) and an Android phone (Chrome's engine, Pixel), against the
//              REAL functions (netlify dev on this computer, never the live site), and checks the result after every step:
//                1. Owner: wrong password, lockout after 5, right password; new wedding "qa-journey"; links + password;
//                   Data page empty; Check page runs.
//                2. Helper: logs in to /qa-journey/admin/, every tab opens.
//                3. Families: add by hand (phone + e-mail), duplicate refused, edit seats, Excel upload of 3 rows made
//                   from the template (dry run, confirm), remove + put back, reset + undo.
//                4. Sending: COPY INVITE, Send on WhatsApp (wa.me), Copy reminder only when sent and unanswered,
//                   Mark as not sent.
//                5. Guest: real link, envelope, seal, pages, accept with 2 names, reopen prefilled, decline,
//                   preview=1 saves nothing, unknown or other wedding's code gets the gentle message.
//                6. Dashboard: tiles, a tile scrolls to its list, Download Excel (Families/Summary/Activity, names match).
//                7. Design: never-published banner, names, gold, a page font, veil, timing, 3 switches, save, preview,
//                   publish, guest sees it, discard, "someone else changed it", 3000x4000 picture shrunk, delete refused
//                   while in use, Canva slides (3 slides, types, drag a box, publish, guest sees slides).
//                8. Settings: change the wedding password (old cookie dead, new login works, owner still gets in).
//                9. Owner: Data filters, Check issues, Back up now, archive (thank-you card, answers 410), export JSON,
//                   restore into qa-journey-2 (preview, apply), delete qa-journey-2 (typed), unarchive.
//               10. The nightly backup function, invoked directly: a backup row and a backup file.
//               11. Kept from pages-smoke.mjs, now against the real backend: Karim & Maya's invite is pixel-identical
//                   to the untouched original, the front page links + REPLACE ME badges, no page wider than the phone.
// Who uses it: whoever changes anything. `npm run qa` starts a throwaway local site and runs this plus
//              pages-smoke.mjs (tools/qa/run-all.mjs). Or by hand against a running `netlify dev`:
//                OWNER_PASSWORD=<.env value> node tools/qa/journeys.mjs http://127.0.0.1:8888
// What it changes: only the weddings "qa-journey" and "qa-journey-2" of the site it is pointed at (deleted and made
//              again at the start of each phone's run, so it can run any number of times), one backup per run, and a
//              lockout of the OTHER loopback address ([::1] when the address is 127.0.0.1) for 15 minutes. It refuses to
//              run against anything but this computer (localhost / 127.0.0.1 / [::1]).
// Output:      a table of steps with PASS / FAIL and timings; exit code 1 if anything failed. On a failure, pictures of
//              every open page are saved in the temporary folder under twp-journeys/ (the path is printed).
// Must not change, and why: it must never be pointed at the live site (it creates, archives and deletes weddings, and
//              the owner pays for the live site's credits). Keep the localhost guard. Never write a real password here.
// //notes: ONLY=iPhone or ONLY=Pixel runs one phone. JOURNEY_SLUG changes "qa-journey". Taps wait 0.45 s after a dialog
//          opens or closes and 0.75 s between card buttons, because the admin page ignores faster taps on purpose
//          (tap guard). The clipboard is replaced by a recorder (headless browsers have no real clipboard) and wa.me is
//          answered locally, so nothing leaves the computer except fonts and SheetJS from their CDNs.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { playwright, launchQuiet } from "./_browser.mjs";

const require = createRequire(process.env.NODE_PATH ? path.join(process.env.NODE_PATH, "x.js") : import.meta.url);
const { webkit, chromium, devices } = playwright;   // silent browsers only (_browser.mjs)
const { PNG } = require("pngjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

// ---------------- where, and the safety guard ----------------
const arg = process.argv[2];
if (!arg) { console.error("Usage: OWNER_PASSWORD=... node tools/qa/journeys.mjs <base-url>   (for example http://127.0.0.1:8888)"); process.exit(2); }
const OWNER_PW = process.env.OWNER_PASSWORD;
if (!OWNER_PW) { console.error("Set OWNER_PASSWORD (the one in your .env, or the one run-all.mjs made up)."); process.exit(2); }
const u0 = new URL(arg.replace(/\/+$/, ""));
if (!["localhost", "127.0.0.1", "[::1]"].includes(u0.hostname)) {
  console.error(`Refusing to run against ${u0.host}: this script creates, archives and deletes weddings. Only this computer (localhost) is allowed.`);
  process.exit(2);
}
// Two different loopback addresses = two different "phones" for the wrong-password lockout (it is per IP address).
// "localhost" can mean either one depending on the browser, so the main run always uses an explicit address.
const MAIN_HOST = u0.hostname === "[::1]" ? "[::1]" : "127.0.0.1";
const ALT_HOST = MAIN_HOST === "127.0.0.1" ? "[::1]" : "127.0.0.1";
const B = `${u0.protocol}//${MAIN_HOST}:${u0.port || 80}`;
const B_ALT = `${u0.protocol}//${ALT_HOST}:${u0.port || 80}`;
const SLUG = (process.env.JOURNEY_SLUG || "qa-journey").toLowerCase();
const SLUG2 = SLUG + "-2";
const PW1 = "qa-pass-1", PW2 = "qa-pass-2";   // throwaway passwords of the throwaway wedding
const OUT = path.join(os.tmpdir(), "twp-journeys", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(OUT, { recursive: true });

// ---------------- the step runner ----------------
const results = [];
const LIVE = new Set();            // browser contexts open right now (for failure screenshots)
let SKIP = "";                     // set when a step everything else depends on failed
class Soft extends Error {}
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(device, name, fn, { critical = false } = {}) {
  if (SKIP) { results.push({ device, name, ok: null, ms: 0, note: "skipped: " + SKIP }); return; }
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ device, name, ok: true, ms: Date.now() - t0, note: note || "" });
  } catch (e) {
    let pics = 0, seen = "";
    for (const ctx of LIVE) for (const p of ctx.pages()) {
      const file = path.join(OUT, `${device.split(" ")[0]}-${name.split(" ")[0]}-${++pics}.png`);
      await p.screenshot({ path: file }).catch(() => {});
      seen += await p.evaluate(() => { const t = (s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100);
        return ` [${location.pathname}${location.hash} dialog: ${t(".overlay:last-of-type .modal") || "none"} | toast: ${t("#toast") || "none"}]`; }).catch(() => "");
    }
    results.push({ device, name, ok: false, ms: Date.now() - t0, note: String(e.message || e).split("\n")[0].slice(0, 220) + seen + (pics ? ` (${pics} screenshots)` : "") });
    if (critical) SKIP = `"${name}" failed`;
  }
}

// ---------------- small helpers ----------------
async function json(ctxOrReq, method, url, body) {   // an API call with the cookies of that browser context
  const req = ctxOrReq.request || ctxOrReq;
  const r = await req.fetch(url.startsWith("http") ? url : B + url, { method, data: body === undefined ? undefined : body, headers: body === undefined ? {} : { "content-type": "application/json" }, failOnStatusCode: false });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status(), data };
}
const ownerApi = (ctx, method, action, body) => json(ctx, method, "/api/manage/" + action, body);
const adminApi = (ctx, method, action, body, slug = SLUG) => json(ctx, method, `/${slug}/api/admin/` + action, body);
async function families(ctx) {
  const r = await adminApi(ctx, "GET", "families");
  assert(r.status === 200, "families " + r.status);
  return r.data.families;
}
const famBy = async (ctx, name) => (await families(ctx)).find((f) => f.name === name);

// A button inside the top dialog. Waits out the tap guard (0.4 s) before and after.
async function dialogButton(page, text) {
  const btn = page.locator(".overlay .modal .mbtns button", { hasText: text }).last();
  await btn.waitFor({ timeout: 10000 });
  await page.waitForTimeout(450);
  await btn.click({ timeout: 10000 });
  await page.waitForTimeout(450);
}
async function dialogTitle(page, text, timeout = 10000) {
  await page.locator(".overlay .modal h2", { hasText: text }).last().waitFor({ timeout });
}
async function cardButton(page, token, action) {   // the admin page ignores a second card tap within 0.7 s
  await page.waitForTimeout(750);
  await page.locator(`#list .fam[data-t="${token}"] [data-a="${action}"]`).click();
}
const text = (page, sel) => page.locator(sel).first().textContent().then((t) => (t || "").replace(/\s+/g, " ").trim());
async function waitText(page, sel, re, timeout = 10000) {
  await page.waitForFunction(([s, src, fl]) => new RegExp(src, fl).test(document.querySelector(s)?.textContent || ""), [sel, re.source, re.flags], { timeout });
}
async function showAllFamilies(page) {
  await page.click('#sideSwitch button[data-side="both"]');
  await page.click('#filters button[data-f="all"]');
}
async function adminLogin(page, name, password, slug = SLUG, base = B) {
  await page.goto(`${base}/${slug}/admin/`);
  await page.waitForSelector("#login:not([hidden]), #app:not([hidden])");
  if (await page.isVisible("#app")) return;
  await page.fill("#loginName", name); await page.fill("#pw", password);
  await page.click("#loginForm button[type=submit]");
  await page.waitForSelector("#app:not([hidden])", { timeout: 10000 });
}
async function openTab(page, tab) {
  await page.click(`#tabs button[data-tab="${tab}"]`);
  await page.waitForSelector(`#tab-${tab}:not([hidden])`);
}
async function ownerTab(page, v) {
  await page.click(`#tabs button[data-v="${v}"]`);
  await page.waitForSelector(`#v-${v}:not([hidden])`);
}
async function weddingDetail(page, slug) {
  await ownerTab(page, "weddings");
  await page.locator(`#wList .wed[data-slug="${slug}"] [data-detail]`).click({ timeout: 10000 });
  await page.locator(".overlay .modal [data-c]").first().waitFor();
  await page.waitForTimeout(450);
}
// A PNG made in the page (canvas), returned as a Buffer. noise=true makes it big (several MB), like a phone photo.
async function makePng(page, w, h, label, noise) {
  const b64 = await page.evaluate(async ([w, h, label, noise]) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
    if (noise) {
      const im = g.createImageData(w, h);
      for (let i = 0; i < im.data.length; i++) im.data[i] = (i % 4 === 3) ? 255 : ((((i >> 2) % w) >> 4) + (Math.random() * 40 | 0)) & 255;
      g.putImageData(im, 0, 0);
    } else {
      g.fillStyle = ["#e8d9c4", "#d9e4d8", "#d8dcea"][label.length % 3]; g.fillRect(0, 0, w, h);
      g.fillStyle = "#4a3f2f"; g.font = `${Math.round(w / 8)}px Georgia`; g.textAlign = "center"; g.fillText(label, w / 2, h / 2);
    }
    const bl = await new Promise((r) => c.toBlob(r, "image/png"));
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(bl); });
  }, [w, h, label, noise]);
  return Buffer.from(b64, "base64");
}
async function readDownload(page, click) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), click()]);
  const file = path.join(OUT, `${Date.now()}-${dl.suggestedFilename()}`);
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(file) };
}

// ---------------- context set-up shared by every browser context ----------------
async function newCtx(browser, desc, extra = {}) {
  const ctx = await browser.newContext({ ...desc, reducedMotion: "reduce", acceptDownloads: true, ...extra });
  // Headless phones have no real clipboard: record what the page copies instead (window.__copied).
  await ctx.addInitScript(() => {
    window.__copied = [];
    const cb = { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); }, readText: () => Promise.resolve(window.__copied[window.__copied.length - 1] || "") };
    try { Object.defineProperty(Navigator.prototype, "clipboard", { get: () => cb, configurable: true }); } catch {}
  });
  // "Send on WhatsApp" opens wa.me in a new tab: answer it here, never on the internet.
  await ctx.route(/^https:\/\/(api\.)?wa\.me\//, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>WhatsApp (test stand-in)</title><p>WhatsApp would open here.</p>" }));
  LIVE.add(ctx);
  ctx.on("close", () => LIVE.delete(ctx));
  return ctx;
}

// ---------------- pixel helpers (ported from pages-smoke.mjs) ----------------
function pixelDiff(a, b, label) {
  const A = PNG.sync.read(a), Bp = PNG.sync.read(b);
  if (A.width !== Bp.width || A.height !== Bp.height) { fs.writeFileSync(path.join(OUT, label + "-raw.png"), a); fs.writeFileSync(path.join(OUT, label + "-new.png"), b); return { n: Infinity, total: 0, w: A.width, h: A.height, sizes: `${A.width}x${A.height} vs ${Bp.width}x${Bp.height}` }; }
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) if (A.data[i] !== Bp.data[i] || A.data[i + 1] !== Bp.data[i + 1] || A.data[i + 2] !== Bp.data[i + 2]) n++;
  if (n) { fs.writeFileSync(path.join(OUT, label + "-raw.png"), a); fs.writeFileSync(path.join(OUT, label + "-new.png"), b); }
  return { n, total: A.width * A.height, w: A.width, h: A.height };
}
const FROZEN = new Date("2026-11-06T10:00:00Z");
async function shot(ctx, url, full) {
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FROZEN);
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(500);
  const png = await page.screenshot({ fullPage: !!full, animations: "disabled", caret: "hide" });
  await page.close();
  return png;
}
let RAW = "";   // the untouched template (site/app/* with the original pre-loader script), in a temp folder (opened as file://)
function rawTemplate() {
  if (RAW) return RAW;
  RAW = fs.mkdtempSync(path.join(os.tmpdir(), "twp-journeys-raw-"));
  for (const f of fs.readdirSync(path.join(ROOT, "site/app"))) if (!f.endsWith(".md")) fs.copyFileSync(path.join(ROOT, "site/app", f), path.join(RAW, f));
  fs.copyFileSync(path.join(ROOT, "tools/qa/reference-template/app.js"), path.join(RAW, "app.js"));
  return RAW;
}

// ---------------- the journey, once per phone ----------------
const DEVICES = [["iPhone (WebKit)", webkit, devices["iPhone 13"]], ["Pixel (Chromium)", chromium, devices["Pixel 7"]]]
  .filter(([d]) => !process.env.ONLY || d.toLowerCase().includes(process.env.ONLY.toLowerCase()));
let lockoutDone = false;

for (const [dev, engine, desc] of DEVICES) {
  SKIP = "";
  const browser = await launchQuiet(engine);
  const S = {};   // what this run learned (tokens, links, counts)

  // ---- clean start: remove what an earlier run left (idempotent) ----
  await step(dev, "0.0 Clean start: remove old qa-journey weddings", async () => {
    const ctx = await newCtx(browser, desc);
    const r = await ownerApi(ctx, "POST", "login", { password: OWNER_PW });
    assert(r.status === 200, `owner login for the clean-up answered ${r.status} ${r.data?.code || ""} (is OWNER_PASSWORD right? is [${MAIN_HOST}] locked out?)`);
    const ws = (await ownerApi(ctx, "GET", "weddings")).data.weddings;
    const gone = [];
    for (const s of [SLUG, SLUG2]) if (ws.some((w) => w.slug === s)) {
      const d = await ownerApi(ctx, "POST", "delete", { slug: s, confirm: s });
      assert(d.status === 200, `delete ${s}: ${d.status}`); gone.push(s);
    }
    S.weddingsBefore = ws.filter((w) => ![SLUG, SLUG2].includes(w.slug)).length;
    await ctx.close();
    return gone.length ? "deleted " + gone.join(", ") : "nothing to clean";
  }, { critical: true });

  // ======================= 1. OWNER =======================
  const owner = await newCtx(browser, desc);
  let op = await owner.newPage();
  await step(dev, "1.1 Owner: wrong password shows a plain message", async () => {
    await op.goto(B + "/manage/");
    await op.waitForSelector("#loginForm");
    await op.fill("#pw", "not-the-password");
    await op.click("#loginForm button[type=submit]");
    await op.waitForSelector("#loginErr:not([hidden])");
    const t = await text(op, "#loginErr");
    assert(/wrong password|not right/i.test(t), "message: " + t);
    return `"${t}"`;
  });
  await step(dev, "1.2 Owner: 5 wrong passwords lock that phone out (others not)", async () => {
    if (lockoutDone) return "done on the first phone (the lockout lasts 15 minutes)";
    const alt = await newCtx(browser, desc);
    const ap = await alt.newPage();
    await ap.goto(B_ALT + "/manage/");
    await ap.waitForSelector("#loginForm");
    const msgs = [];
    for (let i = 1; i <= 5; i++) {
      await ap.fill("#pw", "wrong-" + i);
      await ap.click("#loginForm button[type=submit]");
      await ap.waitForFunction((n) => !document.getElementById("loginErr").hidden && document.getElementById("loginErr").dataset.n !== String(n), i);
      await ap.evaluate((n) => { document.getElementById("loginErr").dataset.n = String(n); }, i);
      msgs.push(await text(ap, "#loginErr"));
      if (/too many/i.test(msgs[msgs.length - 1])) break;
    }
    const last = msgs[msgs.length - 1];
    assert(/Too many wrong passwords\. Try again in 15 minutes\./.test(last), "after 5 wrong: " + last);
    const already = msgs.length === 1;
    await ap.fill("#pw", OWNER_PW);
    await ap.click("#loginForm button[type=submit]");
    await ap.waitForTimeout(800);
    assert(await ap.isVisible("#login") && /too many/i.test(await text(ap, "#loginErr")), "the right password got in while locked");
    await alt.close();
    lockoutDone = true;
    return already ? `[${ALT_HOST}] was still locked from a run less than 15 minutes ago: "${last}"; the right password is refused too`
      : `wrong x${msgs.length - 1} then "${last}"; the right password is refused while locked`;
  });
  await step(dev, "1.3 Owner: right password opens the manager", async () => {
    await op.fill("#pw", OWNER_PW);
    await op.click("#loginForm button[type=submit]");
    await op.waitForSelector("#app:not([hidden])");
    await op.waitForSelector("#wList .wed, #wList .note");
    await waitText(op, "#health", /Database OK/);
    return (await text(op, "#health")).slice(0, 90);
  }, { critical: true });
  await step(dev, `1.4 Owner: create wedding ${SLUG} (names, date, time, zone, password)`, async () => {
    await op.click("#goNew");
    await op.fill("#nGroom", "Rami"); await op.fill("#nBride", "Lea");
    assert((await op.inputValue("#nSlug")) === "rami-and-lea", "slug suggestion " + (await op.inputValue("#nSlug")));
    await op.fill("#nSlug", SLUG);
    await op.fill("#nDate", "2027-06-12");
    await op.fill("#nTime", "18:30");
    await op.selectOption("#nTz", "Europe/Paris");
    await op.fill("#nPw", PW1);
    await op.click("#newForm button[type=submit]");
    await dialogTitle(op, "Create this wedding?");
    await dialogButton(op, "Yes, create it");
    await dialogTitle(op, "Wedding created", 20000);
    const w = (await ownerApi(owner, "GET", "weddings")).data.weddings.find((x) => x.slug === SLUG);
    assert(w, "not in the weddings list");
    assert(w.groom === "Rami" && w.bride === "Lea" && w.event_date === "2027-06-12" && w.event_time === "18:30" && w.timezone === "Europe/Paris",
      "saved as " + JSON.stringify([w.groom, w.bride, w.event_date, w.event_time, w.timezone]));
    S.published = !!w.published_at;
    return `${w.groom} & ${w.bride}, ${w.event_date} ${w.event_time} ${w.timezone}`;
  }, { critical: true });
  await step(dev, "1.5 Owner: the links panel shows the admin link and copies the password", async () => {
    const body = await text(op, ".overlay:last-of-type .modal");
    assert(body.includes(`/${SLUG}/admin/`), "no admin link: " + body.slice(0, 120));
    assert(body.includes(`Password: ${PW1}`), "no password shown");
    await dialogButton(op, "Copy as a WhatsApp message for the couple");
    const copied = await op.evaluate(() => window.__copied[window.__copied.length - 1] || "");
    assert(copied.includes(`/${SLUG}/admin/`) && copied.includes(`Password: ${PW1}`) && copied.includes(`/${SLUG}/?demo=1`), "copied: " + copied.slice(0, 160));
    await dialogButton(op, "Close");
    return "admin link + password on screen; WhatsApp message copied with link, password and demo link";
  });
  await step(dev, "1.6 Owner: Data page is empty for the new wedding", async () => {
    await ownerTab(op, "data");
    await op.waitForFunction(() => !/Loading/.test(document.getElementById("dRows").textContent));   // the first, unfiltered load must land first
    await op.waitForTimeout(500);
    await Promise.all([op.waitForResponse((r) => r.url().includes("/api/manage/data"), { timeout: 15000 }), op.selectOption("#dWed", SLUG)]);
    await waitText(op, "#dRows", /Nobody matches/);
    return await text(op, "#dCount");
  });
  await step(dev, "1.7 Owner: Check page runs", async () => {
    await ownerTab(op, "check");
    await op.selectOption("#cWed", SLUG);
    await op.click("#cRun");
    await op.waitForSelector("#cOut .issue, #cOut .note.ok, #cOut .note.bad");
    assert(!(await op.locator("#cOut .note.bad").count()), "error: " + (await text(op, "#cOut")));
    const t = await text(op, "#cOut");
    if (!S.published) assert(/Design not published/.test(t), "expected 'Design not published' for a new wedding: " + t.slice(0, 120));
    return t.slice(0, 100);
  });

  // ======================= 2. HELPER =======================
  const helper = await newCtx(browser, desc);
  const hp = await helper.newPage();
  await step(dev, "2.1 Helper: wrong wedding password shows a plain message", async () => {
    await hp.goto(`${B}/${SLUG}/admin/`);
    await hp.waitForSelector("#login:not([hidden])");
    await hp.fill("#loginName", "Hala"); await hp.fill("#pw", "nope");
    await hp.click("#loginForm button[type=submit]");
    await hp.waitForSelector("#loginErr:not([hidden])");
    const t = await text(hp, "#loginErr");
    assert(/wrong password|not right/i.test(t), t);
    return `"${t}"`;
  });
  await step(dev, `2.2 Helper: logs in to /${SLUG}/admin/ with name + password`, async () => {
    await hp.fill("#pw", PW1);
    await hp.click("#loginForm button[type=submit]");
    await hp.waitForSelector("#app:not([hidden])");
    await hp.waitForFunction(() => document.getElementById("title").textContent === "Rami & Lea");
    assert((await text(hp, "#whoName")) === "Hala", "name shown: " + (await text(hp, "#whoName")));
    const sides = await hp.locator("#sideSwitch button").allTextContents();
    assert(sides.join("|") === "Rami|Lea|Both", "sides " + sides.join("|"));
    return "title Rami & Lea, sides Rami|Lea|Both, logged in as Hala";
  }, { critical: true });
  await step(dev, "2.3 Helper: every tab opens", async () => {
    const seen = [];
    for (const [tab, sel] of [["dash", "#tiles .tile"], ["msgs", "#msgSides textarea"], ["act", "#actList .act"], ["design", "#dzMain [data-cfg]"], ["settings", "#lnkAdmin"], ["send", "#addFamily"]]) {
      await openTab(hp, tab);
      await hp.waitForSelector(`#tab-${tab}:not([hidden]) ${sel}`, { timeout: 15000 });
      seen.push(tab);
    }
    await openTab(hp, "settings");
    assert((await text(hp, "#lnkAdmin")).endsWith(`/${SLUG}/admin/`), "admin link " + (await text(hp, "#lnkAdmin")));
    await openTab(hp, "msgs");
    const m = await hp.inputValue("#m_wa_message_a");
    assert(m.includes("{link}"), "default invite message has no {link}");
    await openTab(hp, "send");
    return "Send invites, Dashboard, Messages, Activity, Design, Settings";
  });

  // ======================= 3. FAMILIES =======================
  await step(dev, "3.1 Families: add one by hand with phone + e-mail", async () => {
    await showAllFamilies(hp);
    await hp.click("#addFamily");
    await dialogTitle(hp, "Add a family");
    await hp.fill("#ffName", "The Salem Family");
    await hp.click('.stepper [data-d="1"]'); await hp.click('.stepper [data-d="1"]');   // 2 -> 4
    await hp.click('#ffSide [data-side="a"]');
    await hp.locator(".overlay .modal details summary").click();
    await hp.fill("#ffPhone", "+961 3 000 003");
    await hp.fill("#ffEmail", "salem@example.com");
    await dialogButton(hp, "Add family");
    await waitText(hp, "#toast", /The Salem Family added/);
    const f = await famBy(helper, "The Salem Family");
    assert(f && f.max_guests === 4 && f.side === "a" && f.email === "salem@example.com" && /^\+?961?3000003$|^\+9613000003$/.test(f.phone), "saved: " + JSON.stringify(f && [f.max_guests, f.side, f.phone, f.email]));
    assert(f.wa_link && f.wa_link.startsWith("https://wa.me/9613000003") && f.mail_link.startsWith("mailto:salem@example.com"), "links " + f.wa_link);
    await hp.locator(`#list .fam[data-t="${f.token}"]`).waitFor();
    S.salem = f;
    return `4 seats, ${f.phone}, ${f.email}; WhatsApp + e-mail buttons`;
  });
  await step(dev, "3.2 Families: the same name again is refused with a plain message", async () => {
    await hp.waitForTimeout(500);
    await hp.click("#addFamily");
    await dialogTitle(hp, "Add a family");
    await hp.fill("#ffName", "the  salem family");
    await hp.waitForSelector("#ffDup:not([hidden])");
    const warn = await text(hp, "#ffDup");
    await hp.click('#ffSide [data-side="b"]');
    await dialogButton(hp, "Add family");
    const err = await text(hp, "#ffErr");
    assert(/already/i.test(warn) && /already on the list/i.test(err), `warn "${warn}" err "${err}"`);
    await dialogButton(hp, "Cancel");
    const r = await adminApi(helper, "POST", "family", { name: "THE SALEM FAMILY", side: "b", max_guests: 2 });   // the server refuses too
    assert(r.status === 409 && r.data.code === "duplicate_name" && r.data.existing?.name === "The Salem Family" && !/[_{}]/.test(r.data.error), "server: " + JSON.stringify(r.data));
    return `page: "${err}"; server 409: "${r.data.error}"`;
  });
  await step(dev, "3.3 Families: edit the seats", async () => {
    await cardButton(hp, S.salem.token, "edit");
    await dialogTitle(hp, "Edit The Salem Family");
    await hp.click('.stepper [data-d="-1"]');
    await dialogButton(hp, "Save changes");
    await waitText(hp, "#toast", /Saved changes/);
    const f = await famBy(helper, "The Salem Family");
    assert(f.max_guests === 3, "seats " + f.max_guests);
    await waitText(hp, `#list .fam[data-t="${f.token}"] .seats`, /^3 people invited/);
    return "4 -> 3 seats";
  });
  await step(dev, "3.4 Families: Excel upload of 3 rows made from the template (dry run, then confirm)", async () => {
    await hp.waitForFunction(() => typeof XLSX !== "undefined", null, { timeout: 30000 });
    const b64 = await hp.evaluate(async () => {
      const wb = XLSX.read(await (await fetch(document.getElementById("xlsTemplate").href)).arrayBuffer(), { type: "array" });
      const sh = wb.Sheets[wb.SheetNames[0]];
      const head = XLSX.utils.sheet_to_json(sh, { header: 1 })[0];
      if (head.join("|") !== "Name|Guests Allowed|Phone|E-mail") return "HEADINGS:" + head.join("|");
      wb.Sheets[wb.SheetNames[0]] = XLSX.utils.aoa_to_sheet([head,
        ["The Karam Family", 2, "+961 70 000 001", "karam@example.com"], ["Sami & Rana", 3, "03 000 003", ""], ["The Aoun Family", 5, "", ""]]);
      return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    });
    assert(!b64.startsWith("HEADINGS:"), "template " + b64);
    await hp.click("#excelBox > summary");
    if (!(await hp.evaluate(() => document.getElementById("excelBox").open))) await hp.click("#excelBox > summary");
    await hp.locator('#upSide button[data-side="b"]').click();
    await hp.setInputFiles("#upFile", { name: "guests.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(b64, "base64") });
    await hp.waitForSelector("#upGo", { timeout: 15000 });
    const dry = await text(hp, "#upOut");
    assert(/3 new families will be added/.test(dry) && /0 will get a new number/.test(dry) && /Nobody will be removed/.test(dry), "dry run: " + dry.slice(0, 160));
    assert((await families(helper)).length === 1, "the dry run saved something");
    await hp.click("#upGo");
    await dialogTitle(hp, "Add these families?");
    await dialogButton(hp, "Yes, add them");
    await waitText(hp, "#upOut", /Done\. 3 added/, 15000);
    const fs3 = await families(helper);
    const names = fs3.map((f) => f.name).sort();
    assert(names.join("|") === "Sami & Rana|The Aoun Family|The Salem Family|The Karam Family", "list " + names.join("|"));
    const k = fs3.find((f) => f.name === "The Karam Family");
    assert(k.side === "b" && k.max_guests === 2 && k.email === "karam@example.com" && k.wa_link, "Karam " + JSON.stringify([k.side, k.max_guests, k.phone, k.email]));
    S.karam = k; S.sami = fs3.find((f) => f.name === "Sami & Rana"); S.aoun = fs3.find((f) => f.name === "The Aoun Family");
    return `template headings ok; dry run "3 new, 0 updated, nobody removed"; saved with phone/e-mail`;
  });
  await step(dev, "3.5 Families: remove, then put back (same link)", async () => {
    await hp.locator(`#list .fam[data-t="${S.aoun.token}"]`).waitFor();
    await cardButton(hp, S.aoun.token, "remove");
    await dialogTitle(hp, "Remove family?");
    await dialogButton(hp, "Yes, remove");
    await waitText(hp, "#toast", /The Aoun Family removed/);
    await hp.waitForSelector(`#list .fam[data-t="${S.aoun.token}"]`, { state: "detached" });
    assert((await fetch(`${B}/${SLUG}/api/guest?t=${S.aoun.token}&preview=1`)).status === 404, "removed family's link still works");
    await hp.waitForSelector("#removedLinkRow:not([hidden])");
    await hp.click("#removedLink");
    await hp.locator(`#removedList [data-putback="${S.aoun.token}"]`).click();
    await dialogTitle(hp, "Put back The Aoun Family?");
    await dialogButton(hp, "Yes, put back");
    await waitText(hp, "#toast", /back on the list/);
    await hp.locator(`#list .fam[data-t="${S.aoun.token}"]`).waitFor();
    const f = await famBy(helper, "The Aoun Family");
    assert(f && f.token === S.aoun.token, "not back with the same link");
    return "removed (link stops), put back with the same link";
  });
  await step(dev, "3.6 Families: reset a family, then undo the reset", async () => {
    const g = await fetch(`${B}/${SLUG}/api/guest?t=${S.aoun.token}`);   // the family opens its invite once
    assert(g.status === 200, "guest open " + g.status);
    await hp.reload(); await hp.waitForSelector("#app:not([hidden])"); await showAllFamilies(hp);
    await hp.locator(`#list .fam[data-t="${S.aoun.token}"] [data-a="reset"]`).waitFor();
    await cardButton(hp, S.aoun.token, "reset");
    await dialogTitle(hp, "Reset The Aoun Family?");
    await dialogButton(hp, "Yes, reset");
    await dialogTitle(hp, "Are you really sure?");
    await dialogButton(hp, "Yes, clear The Aoun Family");
    await dialogTitle(hp, "The Aoun Family was reset");
    assert(!(await famBy(helper, "The Aoun Family")).opened, "still opened after the reset");
    await dialogButton(hp, "Undo this reset");
    await waitText(hp, "#toast", /back as it was/);
    const f = await famBy(helper, "The Aoun Family");
    assert(f.opened && f.opened.count === 1, "open not put back: " + JSON.stringify(f.opened));
    return "opened -> reset (cleared) -> undo (opened again)";
  });

  // ======================= 4. SENDING =======================
  await step(dev, "4.1 Sending: COPY INVITE copies the family's link and marks it sent", async () => {
    assert(!(await hp.locator(`#list .fam[data-t="${S.karam.token}"] [data-a="remind"]`).count()), "Copy reminder shown before anything was sent");
    await cardButton(hp, S.karam.token, "copy");
    await waitText(hp, "#toast", /Copied! Now paste it in WhatsApp/);
    const copied = await hp.evaluate(() => window.__copied[window.__copied.length - 1] || "");
    assert(copied.includes(S.karam.link) && copied.includes("The Karam Family"), "copied: " + copied.slice(0, 120));
    await hp.waitForFunction((t) => /Sent by Hala/.test(document.querySelector(`#list .fam[data-t="${t}"] .status`)?.textContent || ""), S.karam.token);
    const f = await famBy(helper, "The Karam Family");
    assert(f.sent?.invite_at && f.sent.invite_channel === "copy" && f.sent.invite_by === "Hala", "sent " + JSON.stringify(f.sent));
    return "text with the family's own link copied; Sent by Hala (copy)";
  });
  await step(dev, "4.2 Sending: Copy reminder appears only once sent and not answered", async () => {
    await hp.locator(`#list .fam[data-t="${S.karam.token}"] [data-a="remind"]`).waitFor();
    assert(!(await hp.locator(`#list .fam[data-t="${S.sami.token}"] [data-a="remind"]`).count()), "reminder on a family that was not sent");
    return "shown on the sent family, not on unsent ones (answered: checked in 6.1)";
  });
  await step(dev, "4.3 Sending: Mark as not sent undoes it", async () => {
    await cardButton(hp, S.karam.token, "undo");
    await dialogTitle(hp, "Mark as not sent?");
    await dialogButton(hp, "Yes, mark as not sent");
    await waitText(hp, "#toast", /marked as not sent/);
    const f = await famBy(helper, "The Karam Family");
    assert(!f.sent, "still sent: " + JSON.stringify(f.sent));
    await hp.waitForSelector(`#list .fam[data-t="${S.karam.token}"] [data-a="remind"]`, { state: "detached" });
    await cardButton(hp, S.karam.token, "copy");   // and copy it again for real (the dashboard counts it)
    await waitText(hp, "#toast", /Copied!/);
    for (let i = 0; i < 20 && !(await famBy(helper, "The Karam Family")).sent; i++) await sleep(250);
    return "not sent again, reminder button gone; copied again afterwards";
  });
  await step(dev, "4.4 Sending: Send on WhatsApp opens wa.me and marks sent (channel whatsapp)", async () => {
    const popup = hp.waitForEvent("popup", { timeout: 10000 });
    await cardButton(hp, S.salem.token, "wa-invite");
    const pop = await popup;
    await pop.waitForLoadState().catch(() => {});
    const url = decodeURIComponent(pop.url());
    await pop.close();
    assert(url.startsWith("https://wa.me/9613000003?text=") && url.includes(S.salem.link), "opened " + url.slice(0, 120));
    await waitText(hp, "#toast", /WhatsApp is opening/);
    let f;
    for (let i = 0; i < 20; i++) { f = await famBy(helper, "The Salem Family"); if (f.sent) break; await sleep(250); }
    assert(f.sent?.invite_channel === "whatsapp" && f.sends.some((s) => s.channel === "whatsapp"), "sent " + JSON.stringify(f.sent));
    await hp.locator(`#list .fam[data-t="${S.salem.token}"] [data-a="remind"]`).waitFor();
    return "wa.me/9613000003 with the family's link; marked sent (whatsapp)";
  });

  // ======================= 5. GUEST =======================
  const guest = await newCtx(browser, desc);
  const gp = await guest.newPage();
  await step(dev, "5.1 Guest: real link, envelope, tap the seal, the pages", async () => {
    await gp.goto(S.salem.link);
    await gp.waitForSelector("#seal");
    assert(await gp.evaluate(() => document.documentElement.classList.contains("locked")), "page not locked before the seal is tapped");
    await gp.click("#seal");
    await gp.waitForFunction(() => !document.documentElement.classList.contains("locked"), null, { timeout: 10000 });
    const r = await gp.evaluate(() => ({ names: document.querySelector(".card-names")?.textContent || "", pages: [...document.querySelectorAll("section.page")].map((s) => s.id).filter(Boolean),
      venue: document.querySelector(".venue")?.textContent || "" }));
    assert(/Rami/.test(r.names) && /Lea/.test(r.names), "names " + r.names);
    for (const id of ["welcome", "families", "countdown", "gift", "rsvp"]) assert(r.pages.includes(id), "no page " + id + " in " + r.pages.join(","));
    await gp.locator("#rsvp").scrollIntoViewIfNeeded();
    await gp.waitForSelector("#rsvpBox:not([hidden])");
    assert((await text(gp, "#guestName")) === "The Salem Family" && (await text(gp, "#seatCount")) === "3", "reserved for " + (await text(gp, "#guestName")) + " / " + (await text(gp, "#seatCount")));
    const f = await famBy(helper, "The Salem Family");
    assert(f.opened?.count >= 1, "open not recorded");
    // the music, checked through the template's own hook, never by sound (_browser.mjs mutes every page)
    let mu = null;
    for (let i = 0; i < 20; i++) { mu = await gp.evaluate(() => window.__music ? { playing: window.__music.playing, level: window.__music.level(), muted: window.__music.audio.muted } : null); if (mu?.playing) break; await sleep(200); }
    assert(mu && mu.playing && Math.abs(mu.level - 0.6) < 0.01, "music after the seal: " + JSON.stringify(mu));
    assert(mu.muted === true, "the test browser is not muted");
    return `seal opens; music playing at 0.6 (test browser muted); pages ${r.pages.join(", ")}; reserved for The Salem Family, 3 seats; open recorded`;
  });
  await step(dev, "5.2 Guest: accept with 2 names, confirmation shown and saved", async () => {
    await gp.click("#btnYes");
    await gp.selectOption("#guestCount", "2");
    await gp.click("#sendBtn");
    await gp.waitForSelector("#namesErr:not([hidden])");
    const inputs = gp.locator("#nameFields input");
    assert((await inputs.count()) === 2, (await inputs.count()) + " name boxes for 2 guests");
    await inputs.nth(0).fill("Nabil Salem"); await inputs.nth(1).fill("Rita Salem");
    await gp.click("#sendBtn");
    await gp.waitForSelector("#confirm:not([hidden])");
    const c = await text(gp, "#confirm");
    assert(/Thank you!/.test(c) && /2 guests/.test(c) && /Nabil Salem · Rita Salem/.test(c), "confirmation: " + c.slice(0, 140));
    const f = await famBy(helper, "The Salem Family");
    assert(f.response?.attending === true && f.response.guests === 2 && f.response.guest_names.join("|") === "Nabil Salem|Rita Salem", "saved " + JSON.stringify(f.response));
    return "names required; 'Thank you! … 2 guests'; saved";
  });
  await step(dev, "5.3 Guest: reopening the link shows the answer filled in", async () => {
    await gp.reload();
    await gp.waitForSelector("#seal");
    await gp.click("#seal");
    await gp.locator("#rsvp").scrollIntoViewIfNeeded();
    await gp.waitForSelector("#prevNote:not([hidden])");
    const r = await gp.evaluate(() => ({ yes: document.getElementById("btnYes").getAttribute("aria-pressed"), n: document.getElementById("guestCount").value,
      names: [...document.querySelectorAll("#nameFields input")].map((i) => i.value) }));
    assert(r.yes === "true" && r.n === "2" && r.names.join("|") === "Nabil Salem|Rita Salem", "prefilled " + JSON.stringify(r));
    return `"${(await text(gp, "#prevNote")).slice(0, 60)}…", yes, 2, both names`;
  });
  await step(dev, "5.4 Guest: change the answer to decline", async () => {
    await gp.click("#btnNo");
    await gp.click("#sendBtn");
    await waitText(gp, "#confirm", /Thank you for letting us know/);
    const f = await famBy(helper, "The Salem Family");
    assert(f.response?.attending === false && f.response.guests === 0, "saved " + JSON.stringify(f.response));
    // a second family says yes through its own link (for the dashboard)
    const r = await fetch(`${B}/${SLUG}/api/rsvp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: S.karam.token, attending: true, guests: 2, guest_names: ["Nada Karam", "Fadi Karam"] }) });
    assert(r.status === 200, "Karam answer " + r.status);
    return "now 'not coming', 0 guests (and Karam answered yes, 2, for the dashboard)";
  });
  await step(dev, "5.5 Guest: a preview=1 link records nothing", async () => {
    const p = await guest.newPage();
    await p.goto(S.sami.preview_link);
    await p.waitForSelector("#seal");
    await p.click("#seal");
    await p.locator("#rsvp").scrollIntoViewIfNeeded();
    await p.waitForSelector("#rsvpBox:not([hidden])");
    assert((await text(p, "#guestName")) === "Sami & Rana", "name " + (await text(p, "#guestName")));
    await p.click("#btnYes");
    const inputs = p.locator("#nameFields input");
    for (let i = 0; i < await inputs.count(); i++) await inputs.nth(i).fill("Guest " + (i + 1));
    await p.click("#sendBtn");
    await waitText(p, "#confirm", /Preview mode: nothing was sent/);
    await p.close();
    const f = await famBy(helper, "Sami & Rana");
    assert(!f.opened && !f.response, "preview saved something: " + JSON.stringify([f.opened, f.response]));
    return "real name shown, 'Preview mode: nothing was sent', no open, no answer";
  });
  await step(dev, "5.6 Guest: an unknown code, or another wedding's code, gets the gentle message", async () => {
    const out = [];
    const other = (await ownerApi(owner, "GET", "data")).data.rows.find((r) => r.slug !== SLUG);
    const tries = [["unknown", `${B}/${SLUG}/?t=NOTAREALCODE`], ...(other ? [["other wedding's", `${B}/${SLUG}/?t=${new URL(other.link).searchParams.get("t")}`]] : [])];
    for (const [label, url] of tries) {
      const p = await guest.newPage();
      await p.goto(url);
      await p.waitForSelector("#seal"); await p.click("#seal");
      await p.locator("#rsvp").scrollIntoViewIfNeeded();
      await p.waitForSelector("#rsvpNoLink:not([hidden])", { timeout: 10000 });
      const t = await text(p, "#rsvpNoLink");
      assert(/open the personal link/.test(t) && await p.isHidden("#rsvpBox"), label + ": " + t);
      await p.close(); out.push(label);
    }
    return `${out.join(" + ")} code: "To reply, please open the personal link…"`;
  });

  // ======================= 6. DASHBOARD =======================
  await step(dev, "6.1 Dashboard: tiles match sent / opened / answered / coming", async () => {
    await hp.reload(); await hp.waitForSelector("#app:not([hidden])"); await showAllFamilies(hp);
    await hp.locator(`#list .fam[data-t="${S.salem.token}"]`).waitFor();
    assert(!(await hp.locator(`#list .fam[data-t="${S.salem.token}"] [data-a="remind"]`).count()), "Copy reminder still shown on an answered family");
    const fsx = await families(helper);
    const want = { invited: fsx.length, sent: fsx.filter((f) => f.sent?.invite_at).length, opened: fsx.filter((f) => f.opened).length,
      answered: fsx.filter((f) => f.response).length, coming: fsx.filter((f) => f.response?.attending).length, no: fsx.filter((f) => f.response && !f.response.attending).length };
    assert(JSON.stringify(want) === JSON.stringify({ invited: 4, sent: 2, opened: 2, answered: 2, coming: 1, no: 1 }), "server counts " + JSON.stringify(want));
    await openTab(hp, "dash");
    const got = await hp.evaluate(() => Object.fromEntries([...document.querySelectorAll("#tiles .tile:not(.wide)")].map((t) => [t.dataset.open, Number(t.querySelector("b").textContent)])));
    for (const k of Object.keys(want)) assert(got[k] === want[k], `tile ${k}: ${got[k]} (want ${want[k]})`);
    const wide = await text(hp, '#tiles .tile.wide[data-open="coming"] b');
    assert(/^2 of 13$/.test(wide), "guests tile " + wide);
    return `families 4, sent 2, opened 2, answered 2, coming 1, not coming 1, guests "${wide}"; no reminder on answered`;
  });
  await step(dev, "6.2 Dashboard: tapping a tile scrolls to its list", async () => {
    await hp.click('#tiles .tile[data-open="answered"]');
    await hp.waitForTimeout(600);
    const r = await hp.evaluate(() => { const d = document.querySelector('#lists details[data-k="answered"]'); return { open: d.open, top: Math.round(d.getBoundingClientRect().top), h: innerHeight, items: d.querySelectorAll(".item").length }; });
    assert(r.open && r.top >= 0 && r.top < r.h / 2 && r.items === 2, "list " + JSON.stringify(r));
    return `"Answered" list opened at ${r.top}px, 2 families`;
  });
  await step(dev, "6.3 Dashboard: Download Excel has Families / Summary / Activity and the right names", async () => {
    await hp.waitForFunction(() => typeof XLSX !== "undefined", null, { timeout: 30000 });
    const { name, buf } = await readDownload(hp, () => hp.click("#download"));
    const wb = await hp.evaluate((b64) => { const wb = XLSX.read(b64, { type: "base64" });
      return { sheets: wb.SheetNames, fam: XLSX.utils.sheet_to_json(wb.Sheets.Families), sum: XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1 }), act: XLSX.utils.sheet_to_json(wb.Sheets.Activity) }; }, buf.toString("base64"));
    assert(["Families", "Summary", "Activity"].every((s) => wb.sheets.includes(s)), "sheets " + wb.sheets.join(","));
    const names = wb.fam.map((r) => r.Family).sort().join("|");
    assert(names === "Sami & Rana|The Aoun Family|The Salem Family|The Karam Family", "names " + names);
    const row = (label) => (wb.sum.find((r) => r[0] === label) || [])[1];
    assert(row("Invites sent") === 2 && row("Answered") === 2 && row("Guests coming") === 2 && row("Seats offered") === 13, "summary " + JSON.stringify(wb.sum.slice(4, 14)));
    const k = wb.fam.find((r) => r.Family === "The Karam Family");
    assert(k.Answer === "Coming" && k["Guest names"] === "Nada Karam, Fadi Karam" && k["E-mail"] === "karam@example.com", "Karam row " + JSON.stringify(k));
    assert(wb.act.length >= 10 && wb.act.some((r) => /sent the invite to The Salem Family on WhatsApp/.test(r.What)), "activity rows " + wb.act.length);
    return `${name}: ${wb.fam.length} families, summary ok, ${wb.act.length} activity lines`;
  });

  // ======================= 7. DESIGN =======================
  const setMode = async (label, value) => {   // tap the design choice; WebKit sometimes ignores a tap on a styled radio's label
    await hp.locator("#dzModes label", { hasText: label }).click();
    if ((await hp.evaluate(() => DZ.draft.mode)) !== value) await hp.check(`input[name=dzMode][value=${value}]`, { force: true });
    await hp.waitForFunction((v) => DZ.draft.mode === v, value, { timeout: 5000 });
  };
  const dzStatus = async (cls, timeout = 15000) => hp.waitForFunction((c) => document.getElementById("dzStatus").classList.contains(c), cls, { timeout });
  const frameEval = (fn, arg) => hp.evaluate(([src, a]) => { const d = document.getElementById("dzFrame").contentDocument; if (!d || !d.body) return null; return (0, eval)("(" + src + ")")(d, a); }, [fn.toString(), arg]);
  const waitFrame = async (fn, arg, what, timeout = 15000) => {
    let last;
    for (const t0 = Date.now(); Date.now() - t0 < timeout; await sleep(200)) { last = await frameEval(fn, arg).catch(() => null); if (last === true) return; }
    throw new Error(what + " (preview said " + JSON.stringify(last) + ")");
  };
  await step(dev, "7.1 Design: the never-published banner is shown", async () => {
    await openTab(hp, "design");
    await hp.waitForSelector("#dzMain [data-cfg]");
    await dzStatus("ok");
    if (S.published) return "this wedding was published at creation, so no banner expected";
    await hp.waitForSelector("#dzNeverPub:not([hidden])");
    return `"${(await text(hp, "#dzNeverPub")).slice(0, 60)}…"`;
  });
  await step(dev, "7.2 Design: bride's name, gold, a page font, veil, timing, 3 switches; Save draft", async () => {
    await hp.fill('[data-cfg="couple.bride"]', "Leila");
    await hp.locator('input[data-color="gold"]').fill("#aa3355");
    await hp.selectOption("#pgPick", "welcome");
    await hp.selectOption("#pgSerif", { label: "Playfair Display" });
    for (const [id, v] of [["rdVeil", "85"], ["tmEnv", "1.2"]]) await hp.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, [id, v]);
    await hp.selectOption("#tmReveal", "1.5");
    for (const k of ["gift", "countdown", "bismillah"]) {   // tap the switch's label, like a finger (WebKit will not tap a styled checkbox itself)
      const sw = hp.locator(`#dzShowBox [data-show="${k}"]`);
      await hp.locator(`#dzShowBox label:has([data-show="${k}"])`).click();
      if (await sw.isChecked()) await sw.setChecked(false, { force: true });
      assert(!(await sw.isChecked()), `the ${k} switch did not turn off`);
    }
    await dzStatus("dirty");
    await hp.click("#dzSave");
    await dzStatus("draft");
    const inv = (await adminApi(helper, "GET", "invite")).data;
    const d = inv.draft;
    const ok = d.config.couple.bride === "Leila" && d.theme.gold === "#aa3355" && /Playfair/.test(d.pages.welcome.serif || "") && d.readability.veil === 85
      && d.timing.envelopeOpenMs === 1200 && d.timing.revealSpeed === 1.5 && d.show.gift === false && d.show.countdown === false && d.show.bismillah === false;
    assert(ok, "draft saved as " + JSON.stringify({ bride: d.config.couple.bride, gold: d.theme.gold, serif: d.pages.welcome, veil: d.readability, timing: d.timing, show: d.show }));
    assert(inv.live.config.couple.bride === "Lea", "the live design changed before Publish");
    return "draft saved with all 9 changes; live design untouched";
  });
  await step(dev, "7.3 Design: the preview shows the draft", async () => {
    await waitFrame((d) => {
      const css = getComputedStyle(d.documentElement);
      return /Leila/.test(d.querySelector(".card-names")?.textContent || "") && css.getPropertyValue("--gold").trim() === "#aa3355" && getComputedStyle(d.getElementById("gift")).display === "none"
        || { names: d.querySelector(".card-names")?.textContent, gold: css.getPropertyValue("--gold") };
    }, null, "preview does not show the draft");
    return "Leila, gold #aa3355, gift page hidden";
  });
  await step(dev, "7.4 Design: Publish (confirm), the public invite shows all of it", async () => {
    await hp.click("#dzPublish");
    await dialogTitle(hp, "Publish this design?");
    await dialogButton(hp, "Yes, publish");
    await dzStatus("ok");
    assert(await hp.isHidden("#dzNeverPub"), "never-published banner still shown");
    await hp.waitForFunction(() => document.getElementById("title").textContent === "Rami & Leila");
    const p = await guest.newPage();
    await p.goto(`${B}/${SLUG}/?demo=1&open=1`);
    await p.waitForLoadState("networkidle").catch(() => {});
    await p.waitForFunction(() => document.getElementById("twp-overrides"));
    const r = await p.evaluate(() => { const cs = (s, k) => (document.querySelector(s) ? getComputedStyle(document.querySelector(s))[k] : "missing");
      return { names: document.querySelector(".card-names")?.textContent || "", gold: getComputedStyle(document.documentElement).getPropertyValue("--gold").trim(),
        serif: getComputedStyle(document.querySelector(".page-welcome")).getPropertyValue("--serif"), veil: cs(".photo-veil", "backgroundColor"),
        gift: cs("#gift", "display"), bism: cs(".bismillah", "display"), clock: cs("#countdown .clock", "display"),
        timing: typeof CONFIG !== "undefined" ? CONFIG.timing : null, css: document.getElementById("twp-overrides").textContent, playfair: !!document.querySelector('link[href*="Playfair"]') }; });
    await p.close();
    const bad = [];
    if (!/Leila/.test(r.names)) bad.push("names " + r.names);
    if (r.gold !== "#aa3355") bad.push("gold " + r.gold);
    if (!/Playfair/.test(r.serif) || !r.playfair) bad.push("Names page font " + r.serif);
    if (!/0\.85\)$/.test(r.veil)) bad.push("veil " + r.veil);
    if (r.gift !== "none" || r.bism !== "none" || r.clock !== "none") bad.push(`switches gift ${r.gift} bismillah ${r.bism} countdown ${r.clock}`);
    if (!r.timing || r.timing.envelopeOpenMs !== 1200) bad.push("envelope timing " + JSON.stringify(r.timing));
    if (!/\.reveal\{transition:opacity 0\.667s/.test(r.css)) bad.push("lines-appear speed not in the page's style: " + r.css.slice(0, 120));
    assert(!bad.length, bad.join("; "));
    return "guests see Leila, #aa3355, Playfair on the Names page, veil 0.85, timing 1.2 s / 1.5x, gift/countdown/Bismillah hidden";
  });
  await step(dev, "7.5 Design: Discard draft goes back to the published design", async () => {
    await hp.fill('[data-cfg="venue.name"]', "Discard Me Venue");
    await hp.click("#dzSave");
    await dzStatus("draft");
    await hp.click("#dzDiscard");
    await dialogTitle(hp, "Discard the draft?");
    await dialogButton(hp, "Yes, discard");
    await dialogTitle(hp, "Are you really sure?");
    await dialogButton(hp, "Discard the draft");
    await dzStatus("ok");
    const inv = (await adminApi(helper, "GET", "invite")).data;
    assert(inv.draft.config.venue.name === inv.live.config.venue.name && inv.draft.config.venue.name !== "Discard Me Venue", "draft venue " + inv.draft.config.venue.name);
    assert((await hp.inputValue('[data-cfg="venue.name"]')) !== "Discard Me Venue", "the box still shows the discarded text");
    return `back to the published venue ("${inv.live.config.venue.name}")`;
  });
  await step(dev, "7.6 Design: 'Someone else changed the design' when another helper saved first", async () => {
    const other = await newCtx(browser, desc);
    const l = await adminApi(other, "POST", "login", { name: "Yasmine", password: PW1 });
    assert(l.status === 200, "second helper login " + l.status);
    const g = (await adminApi(other, "GET", "invite")).data;
    const draft = structuredClone(g.draft); draft.config.venue.city = "Byblos, Lebanon";
    const put = await adminApi(other, "PUT", "invite", { draft, base: g.draft_updated_at });
    assert(put.status === 200, "second helper save " + put.status + " " + JSON.stringify(put.data));
    await other.close();
    await hp.fill('[data-cfg="venue.name"]', "Hala's Venue");
    await hp.click("#dzSave");
    await dialogTitle(hp, "Someone else changed the design");
    const body = await text(hp, ".overlay:last-of-type .modal");
    assert(/Yasmine/.test(body), "dialog does not name Yasmine: " + body.slice(0, 100));
    const inv = (await adminApi(helper, "GET", "invite")).data;
    assert(inv.draft.config.venue.name !== "Hala's Venue" && inv.draft.config.venue.city === "Byblos, Lebanon", "Hala's save went through over Yasmine's");
    await dialogButton(hp, "Load Yasmine's version");
    await dialogTitle(hp, "Throw away your changes?");
    await dialogButton(hp, "Yes, show Yasmine's version");
    await hp.waitForFunction(() => document.querySelector('[data-cfg="venue.city"]')?.value === "Byblos, Lebanon");
    await dzStatus("draft");
    return "dialog names Yasmine, nothing overwritten; 'Load Yasmine's version' shows her draft";
  });
  await step(dev, "7.7 Design: a 3000x4000 picture is shrunk, uploaded and shown", async () => {
    const big = await makePng(hp, 3000, 4000, "", true);
    await hp.setInputFiles('#dzPics input[data-pic="envelope"]', { name: "big-envelope.png", mimeType: "image/png", buffer: big });
    await hp.waitForFunction(() => DZ.draft.assets.envelope, null, { timeout: 60000 });
    const name = await hp.evaluate(() => DZ.draft.assets.envelope);
    const r = await hp.evaluate(async (n) => { const res = await fetch(`/${location.pathname.split("/")[1]}/asset/${n}`); const b = await res.blob(); const i = new Image(); i.src = URL.createObjectURL(b); await i.decode();
      return { status: res.status, type: res.headers.get("content-type"), bytes: b.size, w: i.naturalWidth, h: i.naturalHeight }; }, name);
    assert(r.status === 200 && r.bytes < 4 * 1024 * 1024 && r.bytes < big.length && Math.max(r.w, r.h) === 1600, "stored " + JSON.stringify(r));
    assert(await hp.locator("#dzPics .pic .th").first().evaluate((el, n) => el.style.backgroundImage.includes(n), name), "thumbnail not shown");
    await waitFrame((d, n) => (d.querySelector(".env-closed")?.style.backgroundImage || "").includes(n) || (d.querySelector(".env-closed")?.style.backgroundImage || "none"), name, "preview envelope is not the upload");
    await hp.click("#dzSave");
    await dzStatus("draft");
    S.envAsset = name;
    return `${(big.length / 1048576).toFixed(1)} MB PNG -> ${(r.bytes / 1024).toFixed(0)} KB ${r.type} ${r.w}x${r.h}; thumbnail + preview`;
  });
  await step(dev, "7.8 Design: deleting a picture in use is refused (an unused one deletes)", async () => {
    const r = await adminApi(helper, "DELETE", "asset", { name: S.envAsset });
    assert(r.status === 409 && r.data.code === "in_use" && r.data.where.includes("draft") && !/_/.test(r.data.error), "delete in use: " + r.status + " " + JSON.stringify(r.data));
    const small = await makePng(hp, 60, 60, "x", false);
    const up = await adminApi(helper, "POST", "upload-asset", { name: "spare.png", content_type: "image/png", data_base64: small.toString("base64") });
    assert(up.status === 200, "spare upload " + up.status);
    const del = await adminApi(helper, "DELETE", "asset", { name: up.data.name });
    assert(del.status === 200 && (await fetch(`${B}/${SLUG}/asset/${up.data.name}`)).status === 404, "unused delete " + del.status);
    return `409 "${r.data.error}"; an unused picture deletes (then 404)`;
  });
  await step(dev, "7.9 Design: published picture reaches guests through the image service", async () => {
    await hp.click("#dzPublish");
    await dialogTitle(hp, "Publish this design?");
    await dialogButton(hp, "Yes, publish");
    await dzStatus("ok");
    const pub = await (await fetch(`${B}/${SLUG}/api/invite`)).json();
    assert(pub.assets.envelope.includes(S.envAsset) && pub.assets.envelope.startsWith("/.netlify/images?"), "public envelope url " + pub.assets.envelope);
    const img = await fetch(B + pub.assets.envelope);
    assert(img.status === 200 && /^image\//.test(img.headers.get("content-type") || ""), "image service " + img.status + " " + img.headers.get("content-type"));
    assert(pub.config.venue.city === "Byblos, Lebanon", "Yasmine's city not published");
    return `${pub.assets.envelope.slice(0, 60)}… -> ${img.status} ${img.headers.get("content-type")}`;
  });
  await step(dev, "7.10 Design: Canva slides: 3 slides, types, drag a box, publish, guest sees slides", async () => {
    await setMode("Canva slides", "slides");
    await hp.waitForSelector("#dzSlidesBox:not([hidden])");
    const files = [];
    for (let i = 1; i <= 3; i++) files.push({ name: `page-${i}.png`, mimeType: "image/png", buffer: await makePng(hp, 1080, 1920, "Slide " + i, false) });
    await hp.setInputFiles("#dzSlideFiles", files);
    await hp.waitForFunction(() => DZ.draft.slides.length === 3 && !DZ.busy, null, { timeout: 60000 });
    await hp.selectOption('[data-stype="1"]', "reserved");
    await hp.selectOption('[data-stype="2"]', "rsvp");
    const types = await hp.evaluate(() => DZ.draft.slides.map((s) => s.type + ":" + s.overlays.map((o) => o.kind).join("+")));
    assert(types.join(",") === "envelope:seal,reserved:reserved,rsvp:rsvp", "slides " + types.join(","));
    const box = hp.frameLocator("#dzFrame").locator('.twp-slide[data-i="1"] .twp-ov.k-reserved');
    let bb = null;
    for (let i = 0; i < 5 && !bb; i++) {   // the preview redraws itself after each change; wait until it holds still
      await hp.waitForTimeout(800);
      try { await box.waitFor({ timeout: 15000 }); await box.scrollIntoViewIfNeeded({ timeout: 3000 }); bb = await box.boundingBox(); } catch {}
    }
    const y0 = await hp.evaluate(() => DZ.draft.slides[1].overlays[0].y);
    assert(bb, "no box to drag");
    await hp.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await hp.mouse.down();
    await hp.mouse.move(bb.x + bb.width / 2 + 5, bb.y + bb.height / 2 + 40, { steps: 6 });
    await hp.mouse.up();
    await hp.waitForFunction((y) => DZ.draft.slides[1].overlays[0].y !== y, y0, { timeout: 5000 });
    const y1 = await hp.evaluate(() => DZ.draft.slides[1].overlays[0].y);
    await hp.click("#dzPublish");
    await dialogTitle(hp, "Publish this design?");
    await dialogButton(hp, "Yes, publish");
    await dzStatus("ok");
    const live = (await adminApi(helper, "GET", "invite")).data.live;
    assert(live.mode === "slides" && live.slides.length === 3 && live.slides[1].overlays[0].y === y1, "published " + JSON.stringify({ mode: live.mode, n: live.slides.length, y: live.slides[1].overlays[0]?.y }));
    const p = await guest.newPage();
    await p.goto(S.sami.preview_link);
    await p.waitForSelector(".twp-slide");
    const n = await p.locator(".twp-slide").count();
    assert(n === 3, n + " slides for the guest");
    assert(await p.evaluate(() => document.documentElement.classList.contains("locked")), "slides not locked before the seal");
    await p.click(".twp-ov.k-seal");
    await p.waitForFunction(() => !document.documentElement.classList.contains("locked"));
    await waitText(p, ".twp-ov.k-reserved", /Sami & Rana/);
    assert(await p.locator(".k-rsvp form, .k-rsvp button").count(), "no answer form on the RSVP slide");
    await p.close();
    // back to the template, so the next steps (archive) use the usual invite
    await setMode("Template", "template");
    await hp.click("#dzPublish");
    await dialogTitle(hp, "Publish this design?");
    await dialogButton(hp, "Yes, publish");
    await dzStatus("ok");
    assert((await (await fetch(`${B}/${SLUG}/api/invite`)).json()).mode === "template", "could not switch back to the template");
    return `types envelope/reserved/rsvp; box moved y ${y0} -> ${y1}; guest sees 3 slides, seal opens, "Sami & Rana"; back to template`;
  });

  // ======================= 8. SETTINGS =======================
  await step(dev, "8.1 Settings: change the wedding password: other helpers out, new login works, owner still in", async () => {
    const other = await newCtx(browser, desc);
    const op2 = await other.newPage();
    await adminLogin(op2, "Yasmine", PW1);
    await openTab(hp, "settings");
    await hp.fill("#pwCur", PW1); await hp.fill("#pwNew", PW2); await hp.fill("#pwNew2", PW2);
    await hp.click("#pwForm button[type=submit]");
    await dialogTitle(hp, "Change the password?");
    await dialogButton(hp, "Yes, change it");
    await waitText(hp, "#toast", /Password changed/);
    assert((await adminApi(helper, "GET", "me")).status === 200, "the helper who changed it was logged out");
    assert((await adminApi(other, "GET", "me")).status === 401, "the other helper's old cookie still works");
    await op2.reload();
    await op2.waitForSelector("#login:not([hidden])");
    await other.close();
    const fresh = await newCtx(browser, desc);
    const fp = await fresh.newPage();
    await fp.goto(`${B}/${SLUG}/admin/`);
    await fp.waitForSelector("#login:not([hidden])");
    await fp.fill("#loginName", "Nadia"); await fp.fill("#pw", PW1);
    await fp.click("#loginForm button[type=submit]");
    await fp.waitForSelector("#loginErr:not([hidden])");
    await fp.fill("#pw", PW2);
    await fp.click("#loginForm button[type=submit]");
    await fp.waitForSelector("#app:not([hidden])");
    await fresh.close();
    const owp = await owner.newPage();
    await owp.goto(`${B}/${SLUG}/admin/`);
    await owp.waitForSelector("#app:not([hidden])", { timeout: 10000 });
    const me = (await adminApi(owner, "GET", "me")).data;
    assert(me.owner === true && me.name === "Owner", "owner me " + JSON.stringify(me));
    await owp.close();
    return "Hala stays in; Yasmine's page asks for the password; old password refused, new one opens; owner opens the admin";
  });

  // ======================= 9. OWNER =======================
  await step(dev, "9.1 Owner: Data page shows the families, filters work", async () => {
    await op.reload(); await op.waitForSelector("#app:not([hidden])");
    await ownerTab(op, "data");
    await op.waitForFunction(() => !/Loading/.test(document.getElementById("dRows").textContent));   // the first, unfiltered load must land first
    await op.waitForTimeout(500);
    await Promise.all([op.waitForResponse((r) => r.url().includes("/api/manage/data"), { timeout: 15000 }), op.selectOption("#dWed", SLUG)]);
    const rows = async () => op.evaluate(() => [...document.querySelectorAll("#dRows tr")].map((tr) => tr.textContent.replace(/\s+/g, " ").trim()));
    const filter = async (act) => { await Promise.all([op.waitForResponse((r) => r.url().includes("/api/manage/data"), { timeout: 15000 }), act()]); };   // one answer at a time
    const waitRows = async (n, re) => { for (let i = 0; i < 50; i++) { const r = await rows(); if (r.length === n && r.every((x) => re.test(x))) return r; await sleep(150); } throw new Error(`rows: ${JSON.stringify(await rows()).slice(0, 200)}`); };
    await waitRows(4, /^Rami & Leila/);   // publishing the design (step 7, bride renamed to Leila) renames the wedding everywhere
    await filter(() => op.selectOption("#dStatus", "coming"));
    await waitRows(1, /The Karam Family.*Coming/);
    await filter(() => op.selectOption("#dStatus", "not_coming"));
    await waitRows(1, /The Salem Family/);
    await filter(() => op.selectOption("#dStatus", ""));
    await filter(() => op.selectOption("#dSide", "b"));
    await waitRows(3, /^Rami & Leila.*Leila/);
    await filter(() => op.selectOption("#dSide", ""));
    await filter(() => op.fill("#dQ", "aoun"));
    await waitRows(1, /The Aoun Family/);
    await filter(() => op.fill("#dQ", ""));
    const api = (await ownerApi(owner, "GET", `data?slug=${SLUG}`)).data.rows;
    assert(api.length === 4 && !api.some((r) => /Discard/.test(r.family)), "api rows " + api.length);
    return "4 families; Coming = Karam, Not coming = Salem, bride's side = 3, search 'aoun' = 1";
  });
  await step(dev, "9.2 Owner: Check page lists the expected issue", async () => {
    await ownerTab(op, "check");
    await op.selectOption("#cWed", SLUG);
    await op.click("#cRun");
    await op.waitForSelector("#cOut .issue, #cOut .note");
    const issues = (await ownerApi(owner, "GET", `check?slug=${SLUG}`)).data.issues;
    assert(issues.length === 1 && issues[0].kind === "bad_phone" && issues[0].family === "Sami & Rana", "issues " + JSON.stringify(issues));
    const t = await text(op, "#cOut");
    assert(/1 thing to look at/.test(t) && /Phone number looks wrong/.test(t) && /Sami & Rana/.test(t), "page: " + t.slice(0, 150));
    return `"${issues[0].text.slice(0, 70)}…"`;
  });
  await step(dev, "9.3 Owner: Make a backup now appears in the list", async () => {
    await ownerTab(op, "backups");
    const before = (await ownerApi(owner, "GET", "backups")).data.backups.length;
    if (before) await op.waitForFunction((n) => document.querySelectorAll("#bList .bk").length === n, before);
    await op.click("#bNow");
    await waitText(op, "#toast", /Backup made/, 20000);
    await op.waitForFunction((n) => document.querySelectorAll("#bList .bk").length === n + 1, before);
    const first = await text(op, "#bList .bk");
    assert(/made by hand/.test(first), "newest backup: " + first);
    const b = (await ownerApi(owner, "GET", "backups")).data.backups[0];
    assert(b.ok && /manual-\d{6}\.json$/.test(b.blob_key) && b.weddings >= 1, "row " + JSON.stringify(b));
    S.manualBackup = b.blob_key;
    return `${b.blob_key}: ${b.weddings} weddings, ${b.families} families`;
  });
  await step(dev, "9.4 Owner: archive -> the invite shows the thank-you card, answers get 410", async () => {
    await weddingDetail(op, SLUG);
    await op.locator('.overlay .modal [data-c="archive"]').click();
    await dialogTitle(op, "Archive this wedding?");
    await dialogButton(op, "Yes, archive");
    await dialogTitle(op, "Are you sure?");
    await dialogButton(op, "Archive the wedding");
    await waitText(op, "#toast", /Archived/);
    const p = await guest.newPage();
    await p.goto(S.salem.link);
    await p.waitForSelector("#seal"); await p.click("#seal");
    await p.locator("#rsvp").scrollIntoViewIfNeeded();
    await waitText(p, "#rsvp", /Thank you for celebrating with us/);
    assert(await p.isHidden("#rsvpBox"), "the answer form is still shown");
    await p.close();
    const r = await fetch(`${B}/${SLUG}/api/rsvp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: S.salem.token, attending: true, guests: 1, guest_names: ["X"] }) });
    const rj = await r.json();
    assert(r.status === 410 && rj.code === "archived", "rsvp " + r.status + " " + JSON.stringify(rj));
    await hp.reload(); await hp.waitForSelector("#app:not([hidden])");
    await hp.waitForSelector("#archivedNote:not([hidden])");
    const w = await adminApi(helper, "POST", "family", { name: "Too Late Family", side: "a", max_guests: 1 });
    assert(w.status === 410, "helper write on archived " + w.status);
    return "thank-you card, no form; RSVP 410 archived; helpers see the archived note, writes 410";
  });
  await step(dev, "9.5 Owner: export JSON has every section", async () => {
    await weddingDetail(op, SLUG);
    const { buf } = await readDownload(op, () => op.locator('.overlay .modal [data-c="export"]').click());
    const ex = JSON.parse(buf.toString("utf8"));
    const keys = ["format", "version", "exported_at", "wedding", "families", "rsvps", "sends", "opens", "activity", "settings", "invite"];
    const missing = keys.filter((k) => !(k in ex));
    assert(!missing.length, "missing " + missing.join(","));
    assert(ex.format === "twp-wedding" && ex.wedding.slug === SLUG && ex.wedding.status === "archived" && ex.families.length === 4 && ex.rsvps.length >= 2 && ex.sends.length >= 3
      && ex.opens.length >= 2 && ex.activity.length >= 10 && ex.invite.live && ex.invite.draft && Object.keys(ex.settings).length >= 4, "contents " + JSON.stringify({ f: ex.families.length, r: ex.rsvps.length, s: ex.sends.length, o: ex.opens.length, a: ex.activity.length }));
    assert(!JSON.stringify(ex).includes(PW2), "the plain password is in the export");
    await dialogButton(op, "Close");
    return `${keys.length} sections; ${ex.families.length} families, ${ex.rsvps.length} answers, ${ex.sends.length} sends, ${ex.activity.length} activity lines`;
  });
  await step(dev, `9.6 Owner: restore the backup into ${SLUG2} (preview, then apply)`, async () => {
    await ownerTab(op, "backups");
    await op.locator(`#bList [data-restore="${S.manualBackup}"]`).click();
    await dialogTitle(op, "Restore from a backup");
    await op.fill("#rSlug", SLUG);
    await op.selectOption("#rWhere", "new");
    await op.fill("#rInto", SLUG2);
    await dialogButton(op, "Show what would change");
    await dialogTitle(op, "Restore: what would change", 15000);
    const pv = await text(op, ".overlay:last-of-type .modal");
    assert(/4 families/.test(pv) && new RegExp(`new wedding at ${SLUG2}`).test(pv), "preview: " + pv.slice(0, 200));
    assert(!(await ownerApi(owner, "GET", "weddings")).data.weddings.some((w) => w.slug === SLUG2), "the preview already made the wedding");
    await dialogButton(op, "Restore it");
    await dialogTitle(op, "Are you really sure?");
    await dialogButton(op, "Restore now");
    await dialogTitle(op, "Restored", 20000);
    await dialogButton(op, "OK");
    const w2 = (await ownerApi(owner, "GET", "weddings")).data.weddings.find((w) => w.slug === SLUG2);
    assert(w2 && w2.counts.families === 4, "restored " + JSON.stringify(w2?.counts));
    const g = await (await fetch(`${B}/${SLUG2}/api/guest?t=${S.salem.token}&preview=1`)).json();
    assert(g.name === "The Salem Family", "same links under the new address: " + JSON.stringify(g));
    return `preview "4 families … new wedding at ${SLUG2}"; restored with 4 families, same family links`;
  });
  await step(dev, `9.7 Owner: delete ${SLUG2} only after typing its address`, async () => {
    await op.close();   // a fresh tab: Chrome holds back a third automatic download from the same tab
    op = await owner.newPage();
    await op.goto(B + "/manage/");
    await op.waitForSelector("#app:not([hidden])");
    await weddingDetail(op, SLUG2);
    await op.locator('.overlay .modal [data-c="delete"]').click();
    await dialogTitle(op, "Delete this wedding?");
    await dialogButton(op, "Continue");
    await dialogTitle(op, "Are you really sure?");
    await op.fill("#delWord", SLUG);
    assert(await op.isDisabled("#delGo"), "the delete button is on with the wrong address");
    await op.fill("#delWord", SLUG2);
    await op.waitForSelector("#delGo:not([disabled])");
    const { buf } = await readDownload(op, () => op.click("#delGo")).catch(async (e) => {
      const gone = !(await ownerApi(owner, "GET", "weddings")).data.weddings.some((w) => w.slug === SLUG2);
      throw new Error(gone ? "the wedding was DELETED but its copy was never downloaded (the tap guard in site/manage/index.html swallows the download click when the export answers within 0.4 s)" : e.message);
    });
    assert(JSON.parse(buf.toString("utf8")).wedding.slug === SLUG2, "the copy downloaded before deleting is not of " + SLUG2);
    await waitText(op, "#toast", /deleted/, 15000);
    const ws = (await ownerApi(owner, "GET", "weddings")).data.weddings;
    assert(!ws.some((w) => w.slug === SLUG2) && ws.some((w) => w.slug === SLUG), "after delete: " + ws.map((w) => w.slug).join(","));
    return `wrong address keeps the button off; copy downloaded; ${SLUG2} gone, ${SLUG} still there`;
  });
  await step(dev, `9.8 Owner: unarchive ${SLUG}`, async () => {
    await op.keyboard.press("Escape").catch(() => {});
    await op.waitForTimeout(500);
    await weddingDetail(op, SLUG);
    await op.locator('.overlay .modal [data-c="unarchive"]').click();
    await dialogTitle(op, "Take out of the archive?");
    await dialogButton(op, "Yes, make it live again");
    await waitText(op, "#toast", /Live again/);
    const w = (await ownerApi(owner, "GET", "weddings")).data.weddings.find((x) => x.slug === SLUG);
    assert(w.status === "live", "status " + w.status);
    const p = await guest.newPage();
    await p.goto(S.sami.link);
    await p.waitForSelector("#seal"); await p.click("#seal");
    await p.locator("#rsvp").scrollIntoViewIfNeeded();
    await p.waitForSelector("#rsvpBox:not([hidden])");
    await p.close();
    return "live again; the answer form is back";
  });

  // ======================= 10. NIGHTLY BACKUP =======================
  await step(dev, "10.1 Nightly backup function invoked directly: row + file", async () => {
    const before = (await ownerApi(owner, "GET", "backups")).data.backups.length;
    let how = "";
    const cli = spawnSync("netlify", ["functions:invoke", "backup-nightly", "--port", String(u0.port || 80), "--no-identity"], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
    if (cli.status === 0) how = "netlify functions:invoke";
    else {
      const r = await fetch(`${B}/.netlify/functions/backup-nightly`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ next_run: new Date().toISOString() }) });
      assert(r.ok, `invoke failed: CLI ${cli.status} ${String(cli.stderr || cli.error || "").slice(0, 100)}; direct ${r.status}`);
      how = "POST /.netlify/functions/backup-nightly";
    }
    let bs;
    for (let i = 0; i < 40; i++) { bs = (await ownerApi(owner, "GET", "backups")).data.backups; if (bs.length > before) break; await sleep(250); }
    const b = bs.find((x) => /\/all\.json$/.test(x.blob_key));
    assert(bs.length > before && b && b.ok, "no new nightly row: " + JSON.stringify(bs.slice(0, 2)));
    const pv = await ownerApi(owner, "POST", "restore", { blob_key: b.blob_key, slug: SLUG, preview: true });   // reads the file back
    assert(pv.status === 200 && pv.data.backup.families === 4, "the backup file could not be read back: " + pv.status + " " + JSON.stringify(pv.data).slice(0, 120));
    return `${how}: row ${b.blob_key} (${b.weddings} weddings, ${(b.bytes / 1024).toFixed(0)} KB), file read back (${SLUG}: 4 families)`;
  });

  // ======================= 11. KEPT FROM pages-smoke.mjs, ON THE REAL BACKEND =======================
  SKIP = "";
  await step(dev, "11.1 Template: Karim & Maya's closed envelope is identical to the untouched original", async () => {
    const has = await fetch(`${B}/karim-and-maya/api/invite`);
    if (has.status === 404) throw new Error("the seeded wedding karim-and-maya is missing (run npm run seed before netlify dev)");
    const raw = rawTemplate();
    const shotCtx = await newCtx(browser, desc);
    const r = pixelDiff(await shot(shotCtx, `file://${raw}/index.html?demo=1`), await shot(shotCtx, `${B}/karim-and-maya/?demo=1`), dev.replace(/\W+/g, "") + "-envelope");
    await shotCtx.close();
    assert(r.n === 0, `${r.sizes || r.n + " of " + r.total + " pixels differ"} (pictures in ${OUT})`);
    return `${r.w}x${r.h}, 0 pixels differ`;
  });
  await step(dev, "11.2 Template: the whole opened invite is identical to the untouched original", async () => {
    const raw = rawTemplate();
    const shotCtx = await newCtx(browser, desc);
    let last;
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {   // WebKit anti-aliases blurred text a little differently from one render to the next
        const r1 = await shot(shotCtx, `file://${raw}/index.html?demo=1&open=1`, true), r2 = await shot(shotCtx, `file://${raw}/index.html?demo=1&open=1`, true);
        const nw = await shot(shotCtx, `${B}/karim-and-maya/?demo=1&open=1`, true);
        const noise = pixelDiff(r1, r2, dev.replace(/\W+/g, "") + "-noise").n;
        const r = [pixelDiff(r1, nw, dev.replace(/\W+/g, "") + "-full"), pixelDiff(r2, nw, dev.replace(/\W+/g, "") + "-full")].sort((a, b) => a.n - b.n)[0];
        last = r.sizes || `${r.n} of ${r.total} pixels differ (same file twice: ${noise})`;
        if (r.n <= noise) return `${r.w}x${r.h} full page, ${r.n} pixels differ (original vs itself: ${noise})${attempt > 1 ? `, attempt ${attempt}` : ""}`;
      }
    } finally { await shotCtx.close(); }
    throw new Error(last + ` (pictures in ${OUT})`);
  });
  await step(dev, "11.3 Front page: Owner login link", async () => {
    const p = await guest.newPage();
    await p.goto(B + "/");
    assert(await p.locator('a[href="/manage/"]').count() >= 1, "Owner login");
    await p.close();
    return "owner login linked";
  });
  await step(dev, "11.4 No page is wider than the phone (front, invite, admin, manager)", async () => {
    const bad = [];
    for (const [ctx, url] of [[guest, "/"], [guest, `/${SLUG}/?demo=1&open=1`], [helper, `/${SLUG}/admin/`], [owner, "/manage/"]]) {
      const p = await ctx.newPage();
      await p.goto(B + url);
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.waitForTimeout(400);
      if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push(url);
      await p.close();
    }
    assert(!bad.length, "too wide: " + bad.join(", "));
    return "4 pages fit";
  });

  await browser.close();
}

// ---------------- report ----------------
const label = (r) => (r.ok === true ? "PASS" : r.ok === false ? "FAIL" : "SKIP");
const w = Math.max(...results.map((r) => r.name.length));
console.log(`\nJourney results (${B}, wedding ${SLUG})\n`);
console.log(`${"".padEnd(4)}  ${"Phone".padEnd(16)} ${"Step".padEnd(w)}  ${"Time".padStart(7)}  Notes`);
for (const r of results) console.log(`${label(r)}  ${r.device.padEnd(16)} ${r.name.padEnd(w)}  ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.note}`);
const failed = results.filter((r) => r.ok === false).length, skipped = results.filter((r) => r.ok === null).length;
console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped${failed || skipped ? ` (screenshots in ${OUT})` : ""}`);
if (RAW) fs.rmSync(RAW, { recursive: true, force: true });
process.exit(failed || skipped ? 1 : 0);
