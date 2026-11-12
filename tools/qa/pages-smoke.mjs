// WEDDING GUEST PLATFORM: PAGE TESTS (tools/qa/pages-smoke.mjs)
// What it is:  opens the pages in real phone browsers (iPhone = WebKit, Pixel = Chromium) against the pretend
//              website in tools/qa/mock-server.mjs, and checks that:
//                1. Karim & Maya's invite looks EXACTLY like the untouched copy (pixel-by-pixel screenshots,
//                   closed envelope and the whole opened page), and a guest can answer through /<wedding>/api/...
//                2. another wedding's names, colours and show/hide settings are applied by the loader, and the
//                   "Each page" / "Readability" / "Timing" settings change only what they should (one page's text
//                   colour, the photo veil, how soon the page scrolls on after the envelope opens), and "Fine-tune a line"
//                   changes one line only (size, colour, hide), beats its page, resets, and survives Save draft + reload;
//                3. a "Canva slides" wedding renders its slides, opens, and its RSVP form validates;
//                4. the helpers' admin logs in, every tab opens, the Design tab previews, saves and publishes,
//                   shrinks big pictures before uploading them,
//                   and dragging a box in the slides preview reaches the admin page;
//                5. the owner's manager lists weddings, Data, Check and Backups, and makes a new wedding;
//                6. the front page has its WhatsApp and Owner login links, and a REPLACE ME badge per unreplaced placeholder;
//                7. the Excel template has Phone + E-mail, and old 2-column files still upload.
// Who uses it: whoever changes site/. Run before every change is put live.
// How to run:  once:  mkdir -p /tmp/pwtest && cd /tmp/pwtest && npm init -y && npm i playwright pngjs && npx playwright install chromium webkit
//              then:  NODE_PATH=/tmp/pwtest/node_modules node tools/qa/pages-smoke.mjs
//              Screenshots of any difference go to /tmp/twp-pages-smoke/.
// Must not change, and why: the "identical to the untouched copy" check is the promise that one shared template
//              never changes the template invite. Never loosen it to make a change pass.
// //notes: the untouched copy (site/app/* with tools/qa/reference-template/app.js) is put in a temp folder and served at
//          /__raw/. The clock is frozen so the countdown shows the same seconds in both screenshots.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startServer, createState } from "./mock-server.mjs";
import { playwright, launchQuiet } from "./_browser.mjs";

const require = createRequire(process.env.NODE_PATH ? path.join(process.env.NODE_PATH, "x.js") : import.meta.url);
const { webkit, chromium, devices } = playwright;   // silent browsers only (_browser.mjs)
const { PNG } = require("pngjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT = path.join(os.tmpdir(), "twp-pages-smoke");
fs.mkdirSync(OUT, { recursive: true });
const FROZEN = new Date("2026-11-06T10:00:00Z");

// ---- the untouched template: site/app/* with the original pre-loader script (tools/qa/reference-template/app.js) ----
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), "twp-raw-"));
for (const f of fs.readdirSync(path.join(ROOT, "site/app"))) if (!f.endsWith(".md")) fs.copyFileSync(path.join(ROOT, "site/app", f), path.join(RAW, f));
fs.copyFileSync(path.join(HERE, "reference-template/app.js"), path.join(RAW, "app.js"));

const results = [];
let CTX = null;   // the current browser context; on a failure, say what the open pages were showing
const check = async (device, name, fn) => {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ device, name, ok: true, note: note || "", ms: Date.now() - t0 }); }
  catch (e) {
    let seen = "";
    for (const p of CTX ? CTX.pages() : []) {
      seen += await p.evaluate(() => { const t = (s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
        return ` [${location.pathname}${location.hash} dialog: ${t(".overlay:last-of-type .modal") || "none"} | message: ${t("#toast") || "none"} | design: ${t("#dzStatus") || "-"}]`; }).catch(() => "");
      await p.close().catch(() => {});
    }
    results.push({ device, name, ok: false, note: String(e.message || e).split("\n")[0].slice(0, 160) + seen, ms: Date.now() - t0 });
  }
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };

function diff(a, b, label) {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) { fs.writeFileSync(path.join(OUT, label + "-raw.png"), a); fs.writeFileSync(path.join(OUT, label + "-new.png"), b); throw new Error(`${label}: sizes differ ${A.width}x${A.height} vs ${B.width}x${B.height}`); }
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) n++;
  if (n) { fs.writeFileSync(path.join(OUT, label + "-raw.png"), a); fs.writeFileSync(path.join(OUT, label + "-new.png"), b); }
  return { n, total: A.width * A.height, w: A.width, h: A.height };
}
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(400);
}
async function shot(ctx, url, full) {
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FROZEN);
  await page.goto(url);
  await settle(page);
  const png = await page.screenshot({ fullPage: !!full, animations: "disabled", caret: "hide" });
  await page.close();
  return png;
}

// A copy of Karim & Maya's wedding under another address, with its published design changed by `patch`.
// Removed again right after the checks that use it (the Manage check counts the weddings).
function lookWedding(state, slug, patch) {
  const w = structuredClone(state.weddings["karim-and-maya"]);
  w.wedding.slug = slug; w.assets = state.weddings["karim-and-maya"].assets;
  Object.assign(w.invite.live, structuredClone(patch));
  state.weddings[slug] = w;
}
const DEVICES = [["iPhone (WebKit)", webkit, devices["iPhone 13"]], ["Pixel (Chromium)", chromium, devices["Pixel 7"]]];

for (const [dev, engine, desc] of DEVICES.filter(([d]) => !process.env.ONLY || d.includes(process.env.ONLY))) {   // ONLY=Pixel or ONLY=iPhone runs one phone
  const { server, state, port } = await startServer(0, { rawDir: RAW, state: createState() });
  const B = `http://127.0.0.1:${port}`;
  const browser = await launchQuiet(engine);
  const ctx = await browser.newContext({ ...desc, reducedMotion: "reduce" });
  CTX = ctx;
  // Screenshots get their own context: a frozen clock applies to the whole context, and a frozen clock would also
  // freeze the admin page's tap guard (it would ignore every confirm tap).
  const shotCtx = await browser.newContext({ ...desc, reducedMotion: "reduce" });

  await check(dev, "Template: closed envelope identical to the untouched copy", async () => {
    const r = diff(await shot(shotCtx, B + "/__raw/index.html?demo=1"), await shot(shotCtx, B + "/karim-and-maya/?demo=1"), dev.replace(/\W+/g, "") + "-envelope");
    assert(r.n === 0, `${r.n} of ${r.total} pixels differ`);
    return `${r.w}x${r.h}, 0 pixels differ`;
  });
  await check(dev, "Template: whole opened invite identical to the untouched copy", async () => {
    // WebKit sometimes anti-aliases blurred text a few pixels differently between two renders of the SAME file.
    // So: render the untouched copy twice to measure that noise, and require the new page to be within it.
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r1 = await shot(shotCtx, B + "/__raw/index.html?demo=1&open=1", true), r2 = await shot(shotCtx, B + "/__raw/index.html?demo=1&open=1", true);
      const nw = await shot(shotCtx, B + "/karim-and-maya/?demo=1&open=1", true);
      const noise = diff(r1, r2, dev.replace(/\W+/g, "") + "-noise").n;
      const r = [diff(r1, nw, dev.replace(/\W+/g, "") + "-full"), diff(r2, nw, dev.replace(/\W+/g, "") + "-full")].sort((a, b) => a.n - b.n)[0];
      last = `${r.n} of ${r.total} pixels differ (same file twice: ${noise})`;
      if (r.n <= noise) return `${r.w}x${r.h} full page, ${r.n} pixels differ (untouched copy vs itself: ${noise})${attempt > 1 ? `, attempt ${attempt}` : ""}`;
    }
    throw new Error(last);
  });
  await check(dev, "Template: guest answers through /karim-and-maya/api/guest + /rsvp", async () => {
    const page = await ctx.newPage();
    await page.goto(B + "/karim-and-maya/?t=TOKKARAM3&open=1#rsvp");
    await page.waitForSelector("#rsvpBox:not([hidden])");
    assert((await page.textContent("#guestName")) === "The Karam Family", "wrong family name");
    await page.click("#btnYes");
    await page.click("#sendBtn");
    assert(await page.isVisible("#namesErr"), "names error not shown");
    const inputs = page.locator("#nameFields input");
    for (let i = 0; i < await inputs.count(); i++) await inputs.nth(i).fill("Guest " + (i + 1));
    await page.click("#sendBtn");
    await page.waitForSelector("#confirm:not([hidden])");
    const saved = state.weddings["karim-and-maya"].families.find((f) => f.token === "TOKKARAM3").response;
    assert(saved && saved.attending && saved.guests === 5, "answer not saved on the server");
    await page.close();
    return "names required, answer saved (5 guests)";
  });
  await check(dev, "Loader: another wedding's names, colours, show/hide", async () => {
    const page = await ctx.newPage();
    await page.goto(B + "/nour-and-ali/?demo=1&open=1");
    await settle(page);
    const r = await page.evaluate(() => ({ title: document.title, paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
      kids: getComputedStyle(document.querySelector(".kids-note")).display, bism: getComputedStyle(document.querySelector(".bismillah")).display,
      venue: document.querySelector(".venue").textContent, fonts: [...document.querySelectorAll('link[href*="Cairo"]')].length }));
    assert(r.title === "Ali & Nour", "title " + r.title);
    assert(r.paper === "#fbf3f1", "paper " + r.paper);
    assert(r.kids === "none" && r.bism === "none", "show/hide not applied");
    assert(r.venue === "The Garden", "venue " + r.venue);
    assert(r.fonts === 1, "Cairo font not loaded");
    await page.close();
    return "Ali & Nour, Blush colours, kids note + Bismillah hidden, Cairo loaded";
  });
  await check(dev, "Each page: Names page text colour + strong shadow change only that page", async () => {
    lookWedding(state, "look-ink", { pages: { welcome: { ink: "#000000", shadow: "strong" } } });
    const read = async (slug) => {
      const page = await ctx.newPage();
      await page.goto(B + `/${slug}/?demo=1&open=1`);
      await settle(page);
      const r = await page.evaluate(() => { const c = (s, p = "color") => getComputedStyle(document.querySelector(s))[p];
        return { date: c(".page-welcome .date-en"), names: c(".page-welcome .names"), shadow: c(".page-welcome .content", "textShadow"),
          fam: c(".page-families .en-names"), cd: c(".page-countdown .venue"), famShadow: c(".page-families .content", "textShadow"),
          css: document.getElementById("twp-overrides")?.textContent ?? null }; });
      await page.close();
      return r;
    };
    const def = await read("karim-and-maya"), ink = await read("look-ink");
    assert(def.css === "", "default design should add an empty override style, got: " + String(def.css).slice(0, 80));
    assert(ink.date === "rgb(0, 0, 0)" && ink.names === "rgb(0, 0, 0)", `Names page colour ${ink.date} / ${ink.names}`);
    assert(def.date !== ink.date, "default Names page should not be black");
    assert(ink.shadow !== def.shadow && /18px/.test(ink.shadow), "strong shadow not applied: " + ink.shadow);
    assert(ink.fam === def.fam && ink.cd === def.cd && ink.famShadow === def.famShadow, `other pages changed: ${ink.fam} vs ${def.fam}`);
    return `Names page ${ink.date} with strong glow; Families/Countdown unchanged (${def.fam})`;
  });
  await check(dev, "Fine-tune a line: Date (English) 150% + black changes only that line; Hide removes the time line", async () => {
    lookWedding(state, "look-line", { lines: { "welcome.dateEn": { size: 1.5, color: "#000000" }, "welcome.time": { hidden: true } } });
    const read = async (slug) => {
      const page = await ctx.newPage();
      await page.goto(B + `/${slug}/?demo=1&open=1`);
      await settle(page);
      const r = await page.evaluate(() => { const c = (s) => getComputedStyle(document.querySelector(s));
        return { size: c(".page-welcome .date-en").fontSize, color: c(".page-welcome .date-en").color, names: c(".page-welcome .names").fontSize,
          namesColor: c(".page-welcome .names").color, dateAr: c(".page-welcome .date-ar").fontSize, cdTime: c(".page-countdown .cd-time").display,
          fam: c(".page-families .en-names").fontSize }; });
      r.timeVisible = await page.isVisible(".page-welcome .time-line");
      await page.close();
      return r;
    };
    const def = await read("karim-and-maya"), ln = await read("look-line");
    assert(def.size === "26px" && ln.size === "39px", `date size ${def.size} -> ${ln.size}`);
    assert(ln.color === "rgb(0, 0, 0)" && def.color !== ln.color, "date colour " + ln.color);
    assert(ln.names === def.names && ln.namesColor === def.namesColor && ln.dateAr === def.dateAr && ln.fam === def.fam, `other lines changed: names ${ln.names}/${ln.namesColor}`);
    assert(def.timeVisible && !ln.timeVisible, "time line should be hidden only in the changed wedding");
    assert(ln.cdTime !== "none", "the countdown's own time line must stay");
    return `date ${def.size} -> ${ln.size}, black; names ${ln.names} unchanged; time line hidden`;
  });
  await check(dev, "Readability: photo veil 90 makes the veil over the couple photo stronger", async () => {
    lookWedding(state, "look-veil", { readability: { veil: 90, photoBlur: 2.5 } });
    const veil = async (slug) => {
      const page = await ctx.newPage();
      await page.goto(B + `/${slug}/?demo=1&open=1`);
      await settle(page);
      const v = await page.evaluate(() => getComputedStyle(document.querySelector(".photo-veil")).backgroundColor);
      await page.close();
      return v;
    };
    const a = await veil("karim-and-maya"), b = await veil("look-veil");
    assert(/0\.576\)$/.test(a), "default veil " + a);
    assert(/0\.9\)$/.test(b), "veil 90 gave " + b);
    return `${a} -> ${b}`;
  });
  await check(dev, "Timing: envelope 0.8 s scrolls to the names page sooner than 2.3 s", async () => {
    lookWedding(state, "look-fast", { timing: { envelopeOpenMs: 800, revealSpeed: 1 } });
    const motion = await browser.newContext({ ...desc, reducedMotion: "no-preference" });   // reduced motion would skip the wait
    const measure = async (slug) => {
      const page = await motion.newPage();
      await page.goto(B + `/${slug}/?demo=1`);
      await settle(page);
      const ms = await page.evaluate(() => new Promise((done) => {
        const t0 = performance.now();
        document.getElementById("seal").click();
        const poll = () => (document.documentElement.classList.contains("locked") ? requestAnimationFrame(poll) : done(Math.round(performance.now() - t0)));
        poll();
      }));
      await page.waitForTimeout(1200);
      const y = await page.evaluate(() => Math.round(document.getElementById("welcome").getBoundingClientRect().top));
      await page.close();
      return { ms, y };
    };
    const slow = await measure("karim-and-maya"), fast = await measure("look-fast");
    await motion.close();
    assert(slow.ms >= 2250, "default wait " + slow.ms + " ms");
    assert(fast.ms < 1300 && fast.ms < slow.ms - 1000, `0.8 s setting waited ${fast.ms} ms (default ${slow.ms} ms)`);
    assert(Math.abs(fast.y) < 40, "did not scroll to the names page, top = " + fast.y);
    return `scroll after ${fast.ms} ms (default ${slow.ms} ms)`;
  });
  for (const s of ["look-ink", "look-line", "look-veil", "look-fast"]) delete state.weddings[s];   // the Manage check counts weddings
  await check(dev, "Slides: Canva wedding renders, opens, RSVP validates", async () => {
    const page = await ctx.newPage();
    await page.goto(B + "/dana-and-omar/?demo=1");
    await page.waitForSelector(".twp-slide");
    const n = await page.locator(".twp-slide").count();
    assert(n === 3, n + " slides");
    assert(await page.evaluate(() => document.documentElement.classList.contains("locked")), "not locked before the seal is tapped");
    await page.click(".twp-ov.k-seal");
    await page.waitForFunction(() => !document.documentElement.classList.contains("locked"));
    const names = await page.textContent(".twp-ov.k-names");
    assert(/Omar\s*&\s*Dana/.test(names), "names " + names);
    const nums = await page.locator(".k-countdown .num").count(); assert(nums === 4, "countdown");
    await page.locator(".k-rsvp button", { hasText: "Joyfully accept" }).click();
    await page.locator(".k-rsvp .btn-gold").click();
    assert(await page.locator(".k-rsvp .names-err").isVisible(), "names error");
    const inputs = page.locator(".k-rsvp .name-fields input");
    for (let i = 0; i < await inputs.count(); i++) await inputs.nth(i).fill("Guest " + (i + 1));
    await page.locator(".k-rsvp .btn-gold").click();
    await page.locator(".k-rsvp .confirm .c-demo").waitFor();
    await page.close();
    return "3 slides, seal opens, countdown, names required, preview confirm";
  });

  // ---- admin ----
  const login = async (page, slug) => {
    await page.goto(`${B}/${slug}/admin/`);
    await page.waitForSelector("#login:not([hidden]), #app:not([hidden])");
    if (await page.isVisible("#login")) {   // the first visit logs in; later visits keep the cookie, like a phone
      await page.fill("#loginName", "Rima"); await page.fill("#pw", "wedding");
      await page.click("#loginForm button[type=submit]");
      await page.waitForSelector("#app:not([hidden])");
    }
  };
  await check(dev, "Admin: logs in, title + sides from the invite, every tab opens", async () => {
    const page = await ctx.newPage();
    await login(page, "karim-and-maya");
    await page.waitForFunction(() => document.getElementById("title").textContent === "Karim & Maya");
    const sides = await page.locator("#sideSwitch button").allTextContents();
    assert(sides.join("|") === "Karim|Maya|Both", "sides " + sides.join("|"));
    await page.click('#sideSwitch button[data-side="both"]');
    await page.click('#filters button[data-f="all"]');
    await page.waitForFunction(() => document.querySelectorAll("#list .fam").length === 3);
    assert(await page.locator('#list .fam[data-t="TOKKARAM3"] button[data-a="wa-invite"]').count() === 1, "no Send on WhatsApp button");
    assert(await page.locator('#list .fam[data-t="TOKSALEM1"] button[data-a="mail-invite"]').count() === 1, "no Send by e-mail button");
    const seen = [];
    for (const [tab, sel] of [["dash", "#tiles .tile"], ["msgs", "#msgSides textarea"], ["act", "#actList .act"], ["settings", "#lnkAdmin"], ["design", "#dzMain [data-cfg]"], ["send", "#list .fam"]]) {
      await page.click(`#tabs button[data-tab="${tab}"]`);
      await page.waitForSelector(`#tab-${tab}:not([hidden]) ${sel}`, { timeout: 8000 });
      seen.push(tab);
    }
    await page.click('#tabs button[data-tab="settings"]');
    assert((await page.textContent("#lnkAdmin")).endsWith("/karim-and-maya/admin/"), "admin link");
    await page.close();
    return "tabs: " + seen.join(", ");
  });
  await check(dev, "Admin: Send on WhatsApp opens wa.me and marks sent (channel whatsapp)", async () => {
    const page = await ctx.newPage();
    await login(page, "karim-and-maya");
    await page.click('#filters button[data-f="all"]');
    const popup = page.waitForEvent("popup", { timeout: 5000 }).catch(() => null);
    await page.click('#list .fam[data-t="TOKKARAM3"] button[data-a="wa-invite"]');
    const pop = await popup;
    const url = pop ? pop.url() : "";
    if (pop) await pop.close().catch(() => {});
    await page.waitForFunction(() => /WhatsApp is opening/.test(document.getElementById("toast").textContent));
    await page.waitForTimeout(500);
    const f = state.weddings["karim-and-maya"].families.find((x) => x.token === "TOKKARAM3");
    assert(f.sends.some((s) => s.channel === "whatsapp"), "mark-sent with channel whatsapp not received");
    await page.close();
    return url ? "opened " + url.slice(0, 40) + "…" : "marked as sent (popup blocked in test browser)";
  });
  await check(dev, "Design: loads, live preview, save, publish", async () => {
    const page = await ctx.newPage();
    await login(page, "karim-and-maya");
    await page.click('#tabs button[data-tab="design"]');
    await page.waitForFunction(() => /same as the published/.test(document.getElementById("dzStatus").textContent));
    const frame = page.frameLocator("#dzFrame");
    await frame.locator(".card-names").filter({ hasText: "Karim" }).waitFor({ state: "attached" });
    await page.fill('[data-cfg="couple.groom"]', "Kamal");
    await page.click('[data-pal="1"]');
    assert(/not saved/.test(await page.textContent("#dzStatus")), "status not dirty");
    await frame.locator(".card-names").filter({ hasText: "Kamal" }).waitFor({ state: "attached", timeout: 8000 });
    const paper = await page.frameLocator("#dzFrame").locator("html").evaluate((h) => getComputedStyle(h).getPropertyValue("--paper").trim());
    assert(paper === "#fbf3f1", "preview colour " + paper);
    await page.click("#dzSave");
    await page.waitForFunction(() => /Draft saved/.test(document.getElementById("dzStatus").textContent));
    const w = state.weddings["karim-and-maya"];
    assert(w.invite.draft.config.couple.groom === "Kamal" && w.invite.live.config.couple.groom === "Karim", "draft/live after save");
    await page.click("#dzPublish");
    await page.waitForTimeout(500); // the tap guard ignores taps in the first 0.4 s of a dialog, on purpose
    await page.locator(".modal button", { hasText: "Yes, publish" }).click();
    await page.waitForFunction(() => /same as the published/.test(document.getElementById("dzStatus").textContent));
    assert(w.invite.live.config.couple.groom === "Kamal", "not published");
    const pub = await (await fetch(B + "/karim-and-maya/api/invite")).json();
    assert(pub.config.couple.groom === "Kamal" && pub.theme.paper === "#fbf3f1", "public invite not updated");
    assert((await page.textContent("#title")) === "Kamal & Maya", "title not updated after publish");
    await page.close();
    return "preview updated before saving; draft saved; published; public invite updated";
  });
  await check(dev, "Design: every What to show switch hides its part, shows it again, and survives Save + reload", async () => {
    const page = await ctx.newPage();
    await login(page, "nour-and-ali");
    await page.click('#tabs button[data-tab="design"]');
    await page.waitForFunction(() => /same as the published/.test(document.getElementById("dzStatus").textContent));
    assert(await page.isHidden("#dzNeverPub"), "never-published banner shown on a published wedding");
    // switch -> the part of the invite it controls (music: no music button at all when off)
    const PARTS = { gift: "#gift", kidsNote: ".kids-note", bismillah: ".bismillah", countdown: "#countdown .clock", maps: "#mapsLink",
      arabic: "#welcome .date-ar", parents: "#families .parents-en", timeLine: "#welcome .time-line", music: null };
    const keys = Object.keys(PARTS);
    const seen = () => page.evaluate((parts) => {
      const d = document.getElementById("dzFrame").contentDocument; if (!d || !d.querySelector("#gift")) return null;
      if (!d.getElementById("twp-overrides")) return null;   // loader not finished yet
      return Object.fromEntries(Object.entries(parts).map(([k, sel]) => [k, sel ? getComputedStyle(d.querySelector(sel)).display !== "none" : !!d.querySelector(".music-btn")]));
    }, PARTS);
    const waitSeen = async (want) => {
      let last;
      for (let i = 0; i < 60; i++) { last = await seen().catch(() => null); if (last && keys.every((k) => last[k] === want)) return; await page.waitForTimeout(150); }
      throw new Error(`preview with every switch ${want ? "on" : "off"}: ` + JSON.stringify(last));
    };
    const setAll = async (on) => { for (const k of keys) await page.locator(`#dzShowBox [data-show="${k}"]`).setChecked(on); };
    // typing never flips a switch; typed words under an Off switch get the note
    await setAll(false);
    await page.locator('[data-cfg="gift.accountNumber"]').fill("12 345 678");
    assert(!(await page.isChecked('#dzShowBox [data-show="gift"]')), "typing switched the gift page on");
    assert(await page.isVisible('[data-offnote="gift"]'), "no 'switched off' note under the gift words");
    assert(await page.$$eval('[data-show="gift"]', (els) => els.length === 2 && els.every((e) => !e.checked)), "the gift switch next to its words is out of sync");
    await waitSeen(false);
    await page.click("#dzSave");
    await page.waitForFunction(() => /Draft saved/.test(document.getElementById("dzStatus").textContent));
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.click('#tabs button[data-tab="design"]');
    await page.waitForSelector('#dzShowBox [data-show="gift"]', { state: "attached" });
    for (const k of keys) assert(!(await page.isChecked(`#dzShowBox [data-show="${k}"]`)), k + " came back on after reload");
    await waitSeen(false);
    await setAll(true);
    assert(await page.isHidden('[data-offnote="gift"]'), "note still shown with the switch on");
    await waitSeen(true);
    await page.click("#dzSave");
    await page.waitForFunction(() => /Draft saved/.test(document.getElementById("dzStatus").textContent));
    const dr = state.weddings["nour-and-ali"].invite.draft;
    assert(keys.every((k) => (k === "music" ? dr.config.music.enabled : dr.show[k]) === true), "not all saved on: " + JSON.stringify(dr.show));
    await page.close();
    return `${keys.length} switches: off hides, saved + reloaded still off, on shows; typing never flips a switch`;
  });
  await check(dev, "Design: never-published wedding shows the banner", async () => {
    const page = await ctx.newPage();
    state.weddings["nour-and-ali"].invite.published_at = null;
    await login(page, "nour-and-ali");
    await page.click('#tabs button[data-tab="design"]');
    await page.waitForSelector("#dzNeverPub:not([hidden])", { timeout: 8000 });
    const txt = await page.textContent("#dzNeverPub");
    state.weddings["nour-and-ali"].invite.published_at = "2026-11-02T10:00:00.000Z";
    await page.close();
    assert(/never been published/.test(txt), txt);
    return "banner shown";
  });
  await check(dev, "Design: Fine-tune a line changes one line in the preview, wins over the page, resets, survives Save + reload", async () => {
    const page = await ctx.newPage();
    await login(page, "nour-and-ali");
    await page.click('#tabs button[data-tab="design"]');
    await page.waitForSelector("#dzPageBox #lnPick");
    const setVal = (sel, v) => page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
    const read = () => page.evaluate(() => {
      const d = document.getElementById("dzFrame").contentDocument; if (!d || !d.getElementById("twp-overrides") || !d.querySelector(".date-en")) return null;
      const c = (s) => getComputedStyle(d.querySelector(s));
      return { size: c(".page-welcome .date-en").fontSize, color: c(".page-welcome .date-en").color, names: c(".page-welcome .names").fontSize,
        namesColor: c(".page-welcome .names").color, time: c(".page-welcome .time-line").display };
    });
    const waitFor = async (ok, what) => {
      let last;
      for (let i = 0; i < 80; i++) { last = await read().catch(() => null); if (last && ok(last)) return last; await page.waitForTimeout(150); }
      throw new Error(what + ": " + JSON.stringify(last));
    };
    await page.selectOption("#pgPick", "welcome");
    const before = await waitFor(() => true, "preview did not load");
    await setVal("#pgc_ink", "#333333");                 // the page's own text colour
    await waitFor((r) => r.color === "rgb(51, 51, 51)", "page colour not in the preview");
    await page.selectOption("#lnPick", "welcome.dateEn");
    await setVal("#lnSize", "150");
    await setVal("#lnColor", "#000000");
    const big = await waitFor((r) => r.size === "39px" && r.color === "rgb(0, 0, 0)", "date line not 150% black in the preview");
    assert(big.names === before.names && big.namesColor === "rgb(51, 51, 51)", `names changed with the date line: ${big.names} ${big.namesColor}`);
    assert(/not saved/.test(await page.textContent("#dzStatus")), "status not dirty");
    await page.waitForFunction(() => /Saturday|\d/.test(document.getElementById("lnSample").textContent), null, { timeout: 8000 });
    await page.selectOption("#lnPick", "welcome.time");
    await page.locator("#lnHide").setChecked(true);
    await waitFor((r) => r.time === "none", "time line not hidden in the preview");
    await page.click("#dzSave");
    await page.waitForFunction(() => /Draft saved/.test(document.getElementById("dzStatus").textContent));
    const dr = state.weddings["nour-and-ali"].invite.draft;
    assert(dr.lines["welcome.dateEn"].size === 1.5 && dr.lines["welcome.dateEn"].color === "#000000" && dr.lines["welcome.time"].hidden === true, "not saved: " + JSON.stringify(dr.lines));
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.click('#tabs button[data-tab="design"]');
    await page.waitForSelector("#dzPageBox #lnPick");
    await page.selectOption("#lnPick", "welcome.dateEn");
    assert((await page.inputValue("#lnSize")) === "150" && (await page.textContent("#lnSizeV")) === "150%", "size control after reload");
    await waitFor((r) => r.size === "39px" && r.time === "none", "saved line settings not in the preview after reload");
    await page.click("#lnReset");
    const reset = await waitFor((r) => r.size === before.size && r.color === "rgb(51, 51, 51)", "Reset this line did not go back to the page");
    assert(reset.time === "none", "Reset this line also reset another line");
    await page.click("#pgReset");
    await waitFor((r) => r.time !== "none" && r.namesColor === before.namesColor && r.color === before.color, "Reset this page did not clear its lines");
    await page.click("#dzSave");
    await page.waitForFunction(() => /Draft saved|same as the published/.test(document.getElementById("dzStatus").textContent));
    assert(Object.keys(state.weddings["nour-and-ali"].invite.draft.lines || {}).length === 0, "lines left after Reset this page");
    await page.close();
    return `date ${before.size} -> 39px black over a #333 page; time hidden; saved + reloaded; reset line -> page colour; reset page clears lines`;
  });
  await check(dev, "Design: 409 when someone else saved in between", async () => {
    const page = await ctx.newPage();
    await login(page, "karim-and-maya");
    await page.click('#tabs button[data-tab="design"]');
    await page.waitForSelector("#dzMain [data-cfg]");
    state.weddings["karim-and-maya"].invite.draft_updated_at = "2099-01-01T00:00:00.000Z";   // another helper saved
    state.weddings["karim-and-maya"].invite.draft_updated_by = "Yasmine";
    await page.fill('[data-cfg="venue.name"]', "Other Venue");
    await page.click("#dzSave");
    await page.locator(".modal h2", { hasText: "Someone else changed the design" }).waitFor();
    await page.close();
    return "conflict dialog shown, nothing saved";
  });
  await check(dev, "Design (slides): drag a box in the preview, admin receives it", async () => {
    const page = await ctx.newPage();
    await login(page, "dana-and-omar");
    await page.click('#tabs button[data-tab="design"]');
    await page.waitForSelector("#dzSlides .slide");
    const box = page.frameLocator("#dzFrame").locator('.twp-slide[data-i="1"] .twp-ov.k-names');
    await box.waitFor();
    await box.scrollIntoViewIfNeeded();
    const bb = await box.boundingBox();
    assert(bb, "no box");
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 5, bb.y + bb.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => /not saved/.test(document.getElementById("dzStatus").textContent), null, { timeout: 5000 });
    const y = await page.evaluate(() => DZ.draft.slides[1].overlays[0].y);
    assert(y > 10, "overlay y did not change: " + y);
    await page.close();
    return `names box moved to y=${y}%`;
  });

  await check(dev, "Design: a big picture is made smaller on the phone before upload", async () => {
    const page = await ctx.newPage();
    await login(page, "nour-and-ali");
    await page.click('#tabs button[data-tab="design"]');
    await page.waitForSelector('#dzPics input[data-pic="envelope"]', { state: "attached" });
    // a 3000 x 4000 grainy PNG made in the browser (several MB)
    const b64 = await page.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 3000; c.height = 4000; const g = c.getContext("2d");
      const im = g.createImageData(3000, 4000); for (let i = 0; i < im.data.length; i++) im.data[i] = (i % 4 === 3) ? 255 : ((((i >> 2) % 3000) >> 4) + (Math.random() * 40 | 0)) & 255; g.putImageData(im, 0, 0);
      const bl = await new Promise((r) => c.toBlob(r, "image/png")); const fr = new FileReader();
      return await new Promise((r) => { fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(bl); });
    });
    const buf = Buffer.from(b64, "base64");
    await page.setInputFiles('#dzPics input[data-pic="envelope"]', { name: "big-envelope.png", mimeType: "image/png", buffer: buf });
    await page.waitForFunction(() => DZ.draft.assets.envelope, null, { timeout: 20000 });
    const w = state.weddings["nour-and-ali"], name = await page.evaluate(() => DZ.draft.assets.envelope), a = w.assets[name];
    assert(a && a.buf.length < 4 * 1024 * 1024, "upload too big");
    assert(a.buf.length < buf.length, "not smaller");
    const dims = await page.evaluate(async (u) => { const i = new Image(); i.src = u; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, `/nour-and-ali/asset/${name}`);
    assert(Math.max(...dims) === 1600, "long side " + dims.join("x"));
    await page.close();
    return `${(buf.length / 1048576).toFixed(1)} MB PNG 3000x4000 -> ${(a.buf.length / 1024).toFixed(0)} KB ${a.type} ${dims.join("x")}`;
  });

  await check(dev, "Excel: template has Phone + E-mail; old 2-column and new 4-column files both upload", async () => {
    const page = await ctx.newPage();
    await login(page, "karim-and-maya");
    await page.waitForFunction(() => typeof XLSX !== "undefined", null, { timeout: 20000 });
    const heads = await page.evaluate(async () => {
      const wb = XLSX.read(await (await fetch(BASE_URL + "guest-list-template.xlsx")).arrayBuffer(), { type: "array" });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0];
    });
    assert(heads.join("|") === "Name|Guests Allowed|Phone|E-mail", "template headings: " + heads.join("|"));
    await page.click("#excelBox > summary");   // "Add many families from Excel", like a helper would
    await page.click('#upSide button[data-side="a"]');
    const sent = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/admin/upload")) sent.push(r.postDataJSON()); });
    for (const rows of [[["Name", "Guests Allowed"], ["The Old Family", 3]], [["Name", "Guests Allowed", "Phone", "E-mail"], ["The New Family", 2, "+961 3 000 003", "new@example.com"]]]) {
      const b64 = await page.evaluate((rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Guests"); return XLSX.write(wb, { type: "base64", bookType: "xlsx" }); }, rows);
      await page.setInputFiles("#upFile", { name: "guests.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(b64, "base64") });
      await page.waitForSelector("#upGo");
      await page.click("#upCancel");
    }
    assert(sent.length === 2, sent.length + " uploads");
    assert(JSON.stringify(sent[0].families) === JSON.stringify([{ name: "The Old Family", max_guests: 3 }]), "old file: " + JSON.stringify(sent[0].families));
    assert(JSON.stringify(sent[1].families) === JSON.stringify([{ name: "The New Family", max_guests: 2, phone: "+961 3 000 003", email: "new@example.com" }]), "new file: " + JSON.stringify(sent[1].families));
    await page.close();
    return "headings Name|Guests Allowed|Phone|E-mail; old file -> no contact fields, new file -> phone + e-mail";
  });

  // ---- manage ----
  await check(dev, "Manage: login, weddings, data, check, backups, new wedding", async () => {
    const page = await ctx.newPage();
    await page.goto(B + "/manage/");
    await page.waitForSelector("#loginForm");
    await page.fill("#pw", "owner"); await page.click("#loginForm button[type=submit]");
    await page.waitForSelector("#wList .wed");
    const n = await page.locator("#wList .wed").count(); assert(n === 3, n + " weddings");
    assert(/Database OK/.test(await page.textContent("#health")), "health line");
    await page.click('#tabs button[data-v="data"]');
    await page.waitForFunction(() => document.querySelectorAll("#dRows tr").length >= 4);
    await page.selectOption("#dStatus", "coming");
    await page.waitForFunction(() => { const r = [...document.querySelectorAll("#dRows tr")]; return r.length >= 1 && r.length < 4 && r.every((tr) => /Coming/.test(tr.textContent)); });
    await page.click('#tabs button[data-v="check"]'); await page.click("#cRun");
    await page.waitForSelector("#cOut .issue");
    assert(await page.locator("#cOut .issue").count() === 2, "issues");
    await page.click('#tabs button[data-v="backups"]');
    await page.waitForSelector("#bList .bk");
    await page.click('#tabs button[data-v="weddings"]');
    await page.fill("#nGroom", "Rami"); await page.fill("#nBride", "Lea");
    assert((await page.inputValue("#nSlug")) === "rami-and-lea", "slug suggestion");
    await page.fill("#nDate", "2027-06-12");
    await page.click("#newForm button[type=submit]");
    await page.waitForTimeout(500);
    await page.locator(".modal button", { hasText: "Yes, create it" }).click();
    await page.locator(".modal h2", { hasText: "Wedding created" }).waitFor();
    assert(state.weddings["rami-and-lea"], "not created");
    await page.close();
    return "3 weddings, filters, 2 issues, backups, rami-and-lea created";
  });
  await check(dev, "Front page: Owner login", async () => {
    const page = await ctx.newPage();
    await page.goto(B + "/");
    assert(await page.locator('a[href="/manage/"]').count() >= 1, "Owner login");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert(!overflow, "page wider than the phone");
    await page.close();
  });
  await check(dev, "No page is wider than the phone (admin, manage)", async () => {
    const page = await ctx.newPage();
    const bad = [];
    for (const u of ["/karim-and-maya/admin/", "/manage/"]) { await page.goto(B + u); await settle(page); if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push(u); }
    assert(!bad.length, "too wide: " + bad.join(", "));
    await page.close();
  });

  await browser.close();
  server.close();
}

const w = Math.max(...results.map((r) => r.name.length));
console.log("\nPage smoke results\n");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.device.padEnd(17)} ${r.name.padEnd(w)}  ${r.note}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed${failed ? ` (screenshots of differences in ${OUT})` : ""}`);
fs.rmSync(RAW, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
