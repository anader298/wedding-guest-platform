// WEDDING GUEST PLATFORM: SCENARIO SWEEP (tools/qa/scenarios.mjs)
// What it is:  tries many different invite settings (long names, Arabic, every switch off, each colour palette, big and small
//              text, line tweaks, photo veil, timing, odd-shaped pictures, long gift numbers, 1 / 50 seats, archived, Canva
//              slides...) and checks that every page of the invitation still looks right on three phones: nothing wider than
//              the screen, no words cut off or running into each other, nothing too small or too faint to read, nothing stuck
//              invisible after the animations, the countdown and the answer form work, no errors.
// Who uses it: whoever changes the invite, and before a handover. Run it against a site on THIS computer only:
//                node tools/qa/run-all.mjs --serve              (prints an address and an owner password)
//                OWNER_PASSWORD=<that password> node tools/qa/scenarios.mjs http://127.0.0.1:<port>
//              then open previews/scenarios/index.html (next to the app folder) and look at every row.
// What it reads/writes: on the local site it makes one throwaway wedding per scenario (qa-scn-1, qa-scn-2, ...) through the
//              manager and helpers' API, with one family, and deletes them at the end (KEEP=1 keeps them). It reads the demo
//              wedding karim-and-maya (seeded) as the starting design. Pictures and the gallery go to
//              ../previews/scenarios/ (outside the repo; OUT=<folder> to change). It never contacts the live site: any
//              address that is not this computer is refused.
// Must not change, and why: browsers come from _browser.mjs (silent; the owner once heard the wedding music from a test), and
//              this file adds a second mute (volume 0, Web Audio stubbed). Keep the localhost-only rule: every scenario writes data.
// //notes: env: OWNER_PASSWORD (else read from .env), SCN=1,4,7 (only those scenarios), PHONES=se,i15,px7, CONC=2 (scenarios at
//          once), KEEP=1, OUT=<folder>. Exit code 1 if any check failed (warnings do not fail the run).
//          Checks per page section, per phone, after scrolling it into view and waiting for the fade-ins (timing.revealSpeed):
//          page width, text inside the screen / its section / its box (button, card, Canva box), clipped text (an ancestor with
//          overflow hidden), overlap between text of different blocks (>10% of the smaller, on the middle 60% of each line, so
//          tall Arabic line boxes do not count), effective font size (computed size x CSS zoom: <11 px warning, <9 px failure),
//          contrast (text hidden, screenshot, background sampled under each line: <3 warning, <2 failure; the 25th percentile of
//          the samples, so a busy photo counts where it is darkest/lightest), lines still transparent after the animations,
//          countdown 4 numbers, RSVP (seats in the menu, name fields, Send button reachable and not covered), console errors and
//          failed requests (Google Fonts failures only warn: they need the internet, not this site).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { playwright, launchQuiet } from "./_browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const require = createRequire(process.env.NODE_PATH ? path.join(process.env.NODE_PATH, "x.js") : import.meta.url);
const { PNG } = require("pngjs");

const BASE = (process.argv[2] || "").replace(/\/+$/, "");
if (!BASE) { console.error("usage: OWNER_PASSWORD=... node tools/qa/scenarios.mjs http://127.0.0.1:<port>"); process.exit(2); }
try {
  const h = new URL(BASE).hostname;
  if (!/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(h)) { console.error(`Refusing ${BASE}: this sweep creates and deletes weddings, so it only runs against a site on this computer.`); process.exit(2); }
} catch { console.error("not an address: " + BASE); process.exit(2); }

const envFile = (() => { try { return Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])); } catch { return {}; } })();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || envFile.OWNER_PASSWORD || "test";
const PW = "scn-wedding-pw";
const OUT = path.resolve(process.env.OUT || path.join(ROOT, "..", "previews", "scenarios"));
const CONC = Math.max(1, Number(process.env.CONC) || 2);
const KEEP = process.env.KEEP === "1";
const LONG_FAMILY = "The Abou El Hassan Al Karam Family";
const LONG_NOTE = "We are so sorry we cannot be with you on your special day. Our cousin's graduation is the same weekend in Montreal and the flights were booked a year ago. " +
  "We will be thinking of you both all evening, and we cannot wait to see the photos and celebrate with you properly when we are back in Beirut in January. With all our love, always.";

/* ============================== THE SCENARIOS (plain words; add a row to add a scenario) ==============================
 * name: what a person would call it. setting: the Design-tab setting it tries (shown next to every issue it causes).
 * design(d, up): change the starting design d (Karim & Maya's) in place; up = names of the pictures uploaded for it.
 * uploads: { slot: [w, h, look] } pictures made on the fly. family: { name, seats }. answer: an earlier reply. archived. */
const allOff = { kidsNote: false, gift: false, bismillah: false, countdown: false, maps: false, arabic: false, parents: false, timeLine: false };
const PAL = {
  "Cream & Gold": { paper: "#f3ece2", paper2: "#ece3d5", gold: "#b8975a", goldD: "#8b6a34", goldL: "#e2cd9d", ink: "#4a3f2f", inkSoft: "#6f6250" },
  "Blush": { paper: "#fbf3f1", paper2: "#f4e6e3", gold: "#c98b8b", goldD: "#9c5f5f", goldL: "#ecc9c6", ink: "#3b2f2f", inkSoft: "#6e5a5a" },
  "Sage & Gold": { paper: "#eef0e8", paper2: "#e2e6da", gold: "#a8955c", goldD: "#6f6235", goldL: "#d8cfa4", ink: "#33402f", inkSoft: "#5d6a57" },
  "Dusty Blue": { paper: "#eef2f7", paper2: "#e1e8f0", gold: "#5b6f8f", goldD: "#3e4f6b", goldL: "#b9c6da", ink: "#2a3344", inkSoft: "#56607a" },
  "Black & White": { paper: "#ffffff", paper2: "#f2f2f2", gold: "#555555", goldD: "#222222", goldL: "#cccccc", ink: "#111111", inkSoft: "#555555" },
};
const allPages = (p) => Object.fromEntries(["envelope", "welcome", "families", "countdown", "gift", "rsvp"].map((k) => [k, { ...p }]));
const OV = { seal: { x: 33, y: 38, w: 34, h: 19 }, names: { x: 5, y: 20, w: 90, h: 18 }, reserved: { x: 12, y: 40, w: 76, h: 16 }, countdown: { x: 6, y: 42, w: 88, h: 13 },
  maps: { x: 22, y: 75, w: 56, h: 8 }, gift: { x: 12, y: 50, w: 76, h: 13 }, rsvp: { x: 6, y: 25, w: 88, h: 70 }, photo: { x: 18, y: 50, w: 64, h: 40, shape: "arch" } };
const ov = (kind, extra = {}) => ({ kind, ...OV[kind], ...extra });
const text = (t, y, extra = {}) => ({ kind: "text", x: 10, y, w: 80, h: 10, text: t, ...extra });
// a Canva deck: list of [type, overlays, ratio]; ratio [w, h] (default 9:16)
const SLIDE_SETS = {
  3: [["envelope", [ov("seal")]], ["reserved", [ov("names"), ov("reserved", { y: 55 })]], ["rsvp", [ov("rsvp")]]],
  6: [["envelope", [ov("seal")]], ["plain", [ov("names"), text("{date}\n{time}", 45)]], ["reserved", [ov("reserved"), ov("countdown", { y: 65 })]],
    ["venue", [text("{venue}\n{city}", 35), ov("maps")]], ["gift", [text("With gratitude", 30), ov("gift")]], ["rsvp", [ov("rsvp")]]],
  9: [["envelope", [ov("seal")]], ["plain", [ov("names")]], ["plain", [text("{father1} & {father2}", 30), text("{father1Ar} و {father2Ar}", 50, { dir: "rtl" })]],
    ["plain", [ov("photo")]], ["reserved", [ov("reserved")]], ["countdown", [ov("countdown")]], ["venue", [text("{venue}", 40), ov("maps")]],
    ["gift", [ov("gift")]], ["rsvp", [ov("rsvp")]]],
};
const slidesDesign = (deck, ratios) => (d, up) => {
  d.mode = "slides";
  d.slides = deck.map(([type, overlays], i) => {
    const [w, h] = (ratios && ratios[i % ratios.length]) || [1080, 1920];
    return { id: "s" + (i + 1), name: `page-${i + 1}.png`, kind: "image", asset: up["slide" + (i + 1)], type, overlays: JSON.parse(JSON.stringify(overlays)), w, h };
  });
};
const slideUploads = (deck, ratios) => Object.fromEntries(deck.map((_, i) => { const [w, h] = (ratios && ratios[i % ratios.length]) || [1080, 1920]; return ["slide" + (i + 1), [w, h, "slide" + i]]; }));

const SCENARIOS = [
  { name: "Karim & Maya as they are (the control)", setting: "nothing changed" },
  { name: "Very long names", setting: "Names: Mohammad Abdulrahman & Fatima Al-Zahraa Nour", design: (d) => { Object.assign(d.config.couple, { groom: "Mohammad Abdulrahman", bride: "Fatima Al-Zahraa Nour", monogram: "M & F" }); } },
  { name: "Very short names", setting: "Names: Al & Jo", design: (d) => { Object.assign(d.config.couple, { groom: "Al", bride: "Jo", monogram: "A & J" }); } },
  { name: "Arabic everywhere", setting: "Arabic couple names, parents, venue; Show the Arabic lines on",
    design: (d) => { arabicHeavy(d); } },
  { name: "Arabic everywhere, English lines almost empty", setting: "Arabic texts filled, English parents / city / notes left empty",
    design: (d) => { arabicHeavy(d); Object.assign(d.config.families.en, { father1: "", father2: "" }); d.config.venue.city = ""; d.config.rsvp.kidsNoteEn = ""; d.config.rsvp.replyByEn = ""; } },
  { name: "Every switch off", setting: "What to show: everything off", design: (d) => { d.show = { ...allOff }; d.config.music.enabled = false; } },
  { name: "Only the gift page on", setting: "What to show: only Show the gift page", design: (d) => { d.show = { ...allOff, gift: true }; } },
  { name: "Only the adults-only note on", setting: "What to show: only Show the adults-only note", design: (d) => { d.show = { ...allOff, kidsNote: true }; } },
  ...Object.entries(PAL).map(([n, p]) => ({ name: `Colours: ${n}`, setting: `Colours and fonts: ${n}`, design: (d) => { Object.assign(d.theme, p); } })),
  { name: "Text size 13 (smallest common)", setting: "Colours and fonts: base text size 13 px", design: (d) => { d.theme.baseSize = 13; } },
  { name: "Text size 22 (large)", setting: "Colours and fonts: base text size 22 px", design: (d) => { d.theme.baseSize = 22; } },
  { name: "Every page at 80% (the smallest)", setting: "Each page: Size 80% on all six pages", design: (d) => { d.pages = allPages({ scale: 0.8 }); } },
  { name: "Every page at its biggest", setting: "Each page: Size 140% on all six pages (Countdown 120%, its most)", design: (d) => { d.pages = allPages({ scale: 1.4 }); d.pages.countdown.scale = 1.2; } },
  { name: "Big bold date", setting: "Fine-tune a line: Date (English) 180% + bold", design: (d) => { d.lines = { "welcome.dateEn": { size: 1.8, weight: "bold" } }; } },
  { name: "Small names", setting: "Fine-tune a line: Names 60%", design: (d) => { d.lines = { "welcome.names": { size: 0.6 } }; } },
  { name: "Time line hidden", setting: "Fine-tune a line: Time under the date hidden", design: (d) => { d.lines = { "welcome.time": { hidden: true } }; } },
  { name: "Bismillah hidden", setting: "Fine-tune a line: Bismillah hidden", design: (d) => { d.lines = { "welcome.bismillah": { hidden: true } }; } },
  { name: "Names page: strong shadow on a dark panel", setting: "Each page (Names): Text shadow Strong + Backdrop Dark", design: (d) => { d.pages.welcome = { shadow: "strong", backdrop: "dark" }; } },
  { name: "Light panel and the biggest size on every page", setting: "Each page: Backdrop Light + Size 140% on all six pages (Countdown 120%)", design: (d) => { d.pages = allPages({ backdrop: "light", scale: 1.4 }); d.pages.countdown.scale = 1.2; } },
  { name: "No photo veil", setting: "Readability: Photo veil 0%", design: (d) => { d.readability = { veil: 0, photoBlur: 2.5 }; } },
  { name: "Full photo veil", setting: "Readability: Photo veil 100%", design: (d) => { d.readability = { veil: 100, photoBlur: 2.5 }; } },
  { name: "Most photo blur", setting: "Readability: Photo blur 6", design: (d) => { d.readability = { veil: 57.6, photoBlur: 6 }; } },
  { name: "Envelope opens in 0.8 s", setting: "Timing: Envelope opens over 0.8 s", design: (d) => { d.timing = { envelopeOpenMs: 800, revealSpeed: 1 }; } },
  { name: "Envelope opens in 5 s", setting: "Timing: Envelope opens over 5 s", design: (d) => { d.timing = { envelopeOpenMs: 5000, revealSpeed: 1 }; } },
  { name: "Lines appear much faster", setting: "Timing: Lines appear Much faster", design: (d) => { d.timing = { envelopeOpenMs: 2300, revealSpeed: 2 }; } },
  { name: "Lines appear much slower", setting: "Timing: Lines appear Much slower", design: (d) => { d.timing = { envelopeOpenMs: 2300, revealSpeed: 0.5 }; } },
  { name: "Square couple photo", setting: "Pictures: couple photo 1200 x 1200", uploads: { couple: [1200, 1200, "photo"] }, design: (d, up) => { d.assets.couple = up.couple; } },
  { name: "Very tall couple photo", setting: "Pictures: couple photo 1000 x 4000", uploads: { couple: [1000, 4000, "photo"] }, design: (d, up) => { d.assets.couple = up.couple; } },
  { name: "Tiny couple photo", setting: "Pictures: couple photo 200 x 200", uploads: { couple: [200, 200, "photo"] }, design: (d, up) => { d.assets.couple = up.couple; } },
  { name: "Landscape envelope pictures", setting: "Pictures: envelope + opened envelope 1600 x 900", uploads: { envelope: [1600, 900, "envelope"], envelopeOpen: [1600, 900, "envelope"] },
    design: (d, up) => { d.assets.envelope = up.envelope; d.assets.envelopeOpen = up.envelopeOpen; } },
  { name: "Very long gift provider name", setting: "Gift: provider \"Bank Audi Lebanon - Hamra Main Branch Wedding Registry Account\"", design: (d) => { d.config.gift.provider = "Bank Audi Lebanon - Hamra Main Branch Wedding Registry Account"; } },
  { name: "Very long account number", setting: "Gift: account number of 30 characters", design: (d) => { d.config.gift.accountNumber = "LB62 0999 0000 0001 0019 0122 9114"; } },
  { name: "Family with 1 seat", setting: "Family: 1 seat", family: { seats: 1 } },
  { name: "Family with 50 seats", setting: "Family: 50 seats (the most allowed)", family: { seats: 50 } },
  { name: "Already answered: not coming, long note", setting: "Family answered \"Regretfully decline\" with a 380-character note", answer: { attending: false, note: LONG_NOTE } },
  { name: "Archived wedding", setting: "Manager: Archive", archived: true },
  { name: "Canva slides: 3 pages", setting: "Canva slides, 3 pages (envelope, names + family, answer form)", uploads: slideUploads(SLIDE_SETS[3]), design: slidesDesign(SLIDE_SETS[3]) },
  { name: "Canva slides: 6 pages", setting: "Canva slides, 6 pages", uploads: slideUploads(SLIDE_SETS[6]), design: slidesDesign(SLIDE_SETS[6]) },
  { name: "Canva slides: 9 pages", setting: "Canva slides, 9 pages", uploads: slideUploads(SLIDE_SETS[9]), design: slidesDesign(SLIDE_SETS[9]) },
  { name: "Canva slides: mixed shapes (9:16, 1:1, 4:5)", setting: "Canva slides with 9:16, 1:1 and 4:5 pictures",
    uploads: slideUploads(SLIDE_SETS[6], [[1080, 1920], [1080, 1080], [1080, 1350]]), design: slidesDesign(SLIDE_SETS[6], [[1080, 1920], [1080, 1080], [1080, 1350]]) },
  { name: "Canva slides: answer form in the top third", setting: "Canva slides: RSVP box at the top, 30% of the page tall",
    uploads: slideUploads(SLIDE_SETS[3]), design: (d, up) => { slidesDesign(SLIDE_SETS[3])(d, up); d.slides[2].overlays = [ov("rsvp", { x: 6, y: 2, w: 88, h: 30 })]; } },
  { name: "Canva slides: long family name in a small box", setting: "Canva slides: \"Family + seats\" box 40% x 8%", family: { name: LONG_FAMILY },
    uploads: slideUploads(SLIDE_SETS[3]), design: (d, up) => { slidesDesign(SLIDE_SETS[3])(d, up); d.slides[1].overlays = [ov("names"), ov("reserved", { x: 30, y: 55, w: 40, h: 8 })]; } },
].map((s, i) => ({ n: i + 1, ...s }));

function arabicHeavy(d) {
  Object.assign(d.config.couple, { groom: "محمد عبد الرحمن", bride: "فاطمة الزهراء نور", ar: "محمد عبد الرحمن و فاطمة الزهراء نور", monogram: "م & ف" });
  Object.assign(d.config.families.ar, { father1: "الحاج عبد الرحمن محمد الكريمي", father2: "المهندس نور الدين علي الموسوي" });
  Object.assign(d.config.venue, { name: "قاعة قصر الأمراء للاحتفالات", ar: "قاعة قصر الأمراء للاحتفالات، الجية، جبل لبنان" });
  d.show.arabic = true;
}

/* ============================== the local site's API ============================== */
let ownerCookie = "";
async function call(method, url, body, headers = {}) {
  const r = await fetch(BASE + url, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data, headers: r.headers };
}
async function ownerLogin() {
  const r = await call("POST", "/api/manage/login", { password: OWNER_PASSWORD });
  if (r.status !== 200) throw new Error(`owner login refused (${r.status} ${r.data && r.data.error}). Set OWNER_PASSWORD.`);
  ownerCookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")]).map((c) => String(c).split(";")[0]).join("; ");
}
const owner = (method, action, body) => call(method, "/api/manage/" + action, body, { cookie: ownerCookie });
const admin = (slug, method, action, body, pw = PW) => call(method, `/${slug}/api/admin/${action}`, body, { "x-wedding-key": pw });
const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); return r.data; };

/* ============================== pictures made on the fly (pngjs) ============================== */
function makePng(w, h, look) {
  const png = new PNG({ width: w, height: h });
  const cols = { photo: [[156, 120, 98], [62, 52, 58], [214, 190, 160]], envelope: [[236, 226, 210], [196, 172, 136], [250, 244, 232]] }[look]
    || [[[243, 234, 220], [228, 214, 196], [252, 248, 240]], [[238, 228, 236], [214, 196, 210], [250, 244, 248]], [[230, 236, 226], [204, 214, 196], [246, 250, 242]]][Number(String(look).slice(5)) % 3];
  const [a, b, c] = cols;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = (x / w + y / h) / 2;
    const wave = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 4) * Math.cos((y / h) * Math.PI * 6);
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y) < Math.min(w, h) * 0.03 ? 1 : 0;   // a frame, like a Canva page
    const i = (w * y + x) << 2;
    for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(edge ? b[k] * 0.8 : a[k] * (1 - t) + b[k] * t * 0.6 + c[k] * t * 0.4 + (wave - 0.5) * 30);
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

/* ============================== making one scenario's wedding ============================== */
let BASE_DESIGN = null;
async function baseDesign() {
  if (BASE_DESIGN) return JSON.parse(JSON.stringify(BASE_DESIGN));
  const r = must(await admin("karim-and-maya", "GET", "invite", undefined, process.env.WEDDING_PASSWORD || "wedding"), "reading the demo wedding's design (run the seed)");
  BASE_DESIGN = r.live;
  return JSON.parse(JSON.stringify(BASE_DESIGN));
}
async function setup(sc) {
  const slug = `qa-scn-${sc.n}`;
  await owner("POST", "delete", { slug, confirm: slug });
  must(await owner("POST", "create", { slug, groom: "Karim", bride: "Maya", event_date: "2027-06-19", event_time: "18:30", timezone: "Asia/Beirut", password: PW, notes: "QA scenario sweep (throwaway)" }), `creating ${slug}`);
  const inv = must(await admin(slug, "GET", "invite"), "reading the new design");
  const d = await baseDesign();
  const up = {};
  for (const [slot, [w, h, look]] of Object.entries(sc.uploads || {})) {
    const buf = makePng(w, h, look);
    const folder = slot.startsWith("slide") ? "slides/" : "";
    up[slot] = must(await admin(slug, "POST", "upload-asset", { name: `${folder}${slot}-${w}x${h}.png`, content_type: "image/png", data_base64: buf.toString("base64") }), `uploading ${slot}`).name;
  }
  if (sc.design) sc.design(d, up);
  must(await admin(slug, "PUT", "invite", { draft: d, base: inv.draft_updated_at }), "saving the design");
  must(await admin(slug, "POST", "publish", {}), "publishing");
  const fam = must(await admin(slug, "POST", "family", { name: (sc.family && sc.family.name) || LONG_FAMILY, side: "a", max_guests: (sc.family && sc.family.seats) || 4 }), "adding the family").family;
  if (sc.answer) must(await call("POST", `/${slug}/api/rsvp`, { t: fam.token, attending: sc.answer.attending, guests: 0, guest_names: [], note: sc.answer.note }), "answering");
  if (sc.archived) must(await owner("POST", "archive", { slug }), "archiving");
  const live = must(await call("GET", `/${slug}/api/invite`), "reading the published design");
  return { slug, token: fam.token, family: fam.name, seats: fam.max_guests, design: live };
}

/* ============================== phones ============================== */
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const PHONES = [
  { key: "se", label: "iPhone SE", engine: "webkit", ctx: { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IPHONE } },
  { key: "i15", label: "iPhone 15", engine: "webkit", ctx: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_IPHONE }, sealTap: true },
  { key: "px7", label: "Pixel 7", engine: "chromium", ctx: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_PIXEL } },
].filter((p) => !process.env.PHONES || process.env.PHONES.split(",").includes(p.key));

// A second mute on top of _browser.mjs: every sound element at volume 0, Web Audio replaced by a silent stand-in.
const SILENCE = `(() => {
  const P = window.HTMLMediaElement && HTMLMediaElement.prototype; if (!P || P.__scnSilent) return; P.__scnSilent = true;
  const vd = Object.getOwnPropertyDescriptor(P, "volume");
  if (vd && vd.set) Object.defineProperty(P, "volume", { configurable: true, get() { return vd.get.call(this); }, set() { vd.set.call(this, 0); } });
  const play = P.play; P.play = function () { try { this.muted = true; vd && vd.set ? vd.set.call(this, 0) : 0; } catch (e) {} return play.apply(this, arguments); };
  const Fake = function () { return { state: "suspended", resume: () => Promise.resolve(), suspend: () => Promise.resolve(), close: () => Promise.resolve(), createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }), createMediaElementSource: () => ({ connect() {}, disconnect() {} }), destination: {} }; };
  window.AudioContext = Fake; window.webkitAudioContext = Fake;
})();`;

/* ============================== checks inside the page ============================== */
// Runs in the page. Returns the text pieces of one section with their line boxes, plus geometry problems.
const ANALYZE = (a) => {
  const sec = document.querySelector(a.sel);
  if (!sec) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cs = (e) => getComputedStyle(e);
  const zoomOf = (e) => { let z = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const v = parseFloat(cs(n).zoom); if (v && isFinite(v)) z *= v; } return z; };
  const opacityOf = (e) => {
    let op = 1;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const s = cs(n);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") return -1;
      if (n.hidden) return -1;
      op *= parseFloat(s.opacity);
      if (s.clip && s.clip !== "auto" && /rect\(0px,? 0px,? 0px,? 0px\)/.test(s.clip)) return -1;
    }
    return op;
  };
  const blockOf = (e) => { for (let n = e; n && n !== sec; n = n.parentElement) { const d = cs(n).display; if (!d.startsWith("inline") && d !== "contents") return n; } return sec; };
  const ids = new Map(); const idOf = (e) => { if (!ids.has(e)) ids.set(e, ids.size + 1); return ids.get(e); };
  const desc = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.classList.length ? "." + [...e.classList].slice(0, 2).join(".") : "");
  const BOX = ".twp-ov, .reserved, .account, button, a.btn-outline, .env-card";
  const byEl = new Map();
  const tw = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    if (!n.nodeValue.trim()) continue;
    const e = n.parentElement;
    if (!e || e.closest("select, option, script, style, svg, textarea, .twp-tag, .twp-num")) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter((x) => x.width > 1.5 && x.height > 1.5).map((x) => ({ l: x.left, t: x.top, r: x.right, b: x.bottom }));
    if (!rects.length) continue;
    if (!byEl.has(e)) byEl.set(e, { rects: [], text: "" });
    const it = byEl.get(e); it.rects.push(...rects); it.text += n.nodeValue;
  }
  const items = [];
  for (const [e, it] of byEl) {
    const op = opacityOf(e);
    if (op < 0) continue;
    const s = cs(e);
    const txt = it.text.replace(/\s+/g, " ").trim();
    let clipped = null, scrolledAway = false;
    for (let p = e.parentElement; p && p !== sec && p.nodeType === 1; p = p.parentElement) {   // inside a box that scrolls: only the part in view counts
      const ps = cs(p);
      if (/auto|scroll/.test(ps.overflowY) || /auto|scroll/.test(ps.overflowX)) {
        const pr = p.getBoundingClientRect();
        if (it.rects.some((x) => x.t < pr.top - 1 || x.b > pr.bottom + 1 || x.l < pr.left - 1 || x.r > pr.right + 1)) { scrolledAway = true; break; }
      }
    }
    for (let p = e; p && p.nodeType === 1; p = p.parentElement) {
      const ps = cs(p), ox = ps.overflowX, oy = ps.overflowY;
      if (ox !== "visible" || oy !== "visible") {
        const pr = p.getBoundingClientRect();
        for (const x of it.rects) {
          if (clipped) break;
          if (ox !== "visible" && (x.l < pr.left - 1.5 || x.r > pr.right + 1.5)) clipped = { by: desc(p), axis: "x", scroll: ox === "auto" || ox === "scroll" };
          else if (oy !== "visible" && oy !== "auto" && oy !== "scroll" && (x.t < pr.top - 1.5 || x.b > pr.bottom + 1.5)) clipped = { by: desc(p), axis: "y" };
        }
      }
      if (p === sec || clipped) break;
    }
    const ownClip = s.overflowX !== "visible" && e.scrollWidth > e.clientWidth + 1 && !/auto|scroll/.test(s.overflowX);
    let spill = null;
    for (let box = e.closest(BOX); box && sec.contains(box) && !spill; box = box.parentElement && box.parentElement.closest(BOX)) {
      if (/auto|scroll/.test(cs(box).overflowY)) continue;   // a scrolling box (the Canva answer form): see "squeezed"
      const br = box.getBoundingClientRect();
      const out = Math.max(0, ...it.rects.map((x) => Math.max(br.left - x.l, x.r - br.right, br.top - x.t, x.b - br.bottom)));
      if (out > 3) spill = { box: desc(box), canva: box.classList.contains("twp-ov"), kind: ([...box.classList].find((c) => c.startsWith("k-")) || "").slice(2), at: Math.round(br.top + window.scrollY), by: Math.round(out) };
    }
    // a short label that wraps and leaves one or two letters alone on a line (e.g. the Arabic "محجوز لـ" split as "محجوز / ل")
    const lines = [];
    for (const x of it.rects) { const l = lines.find((q) => Math.abs(q.t - x.t) < 3); if (l) { l.w += x.r - x.l; } else lines.push({ t: x.t, w: x.r - x.l }); }
    const fsPx = parseFloat(s.fontSize) * zoomOf(e);
    const orphan = lines.length >= 2 && txt.length <= 40 && Math.min(...lines.map((q) => q.w)) < fsPx * 1.1;
    items.push({ id: idOf(e), group: idOf(blockOf(e)), desc: desc(e), text: txt.slice(0, 80), op, color: s.color, fs: Math.round(parseFloat(s.fontSize) * zoomOf(e) * 10) / 10,
      rects: it.rects, clipped, ownClip, spill, orphan, scrolledAway, sr: !!e.closest(".sr-only, .visually-hidden") });
  }
  // lines still invisible after their fade-in: in view, displayed, but transparent
  const stuck = [];
  sec.querySelectorAll(".reveal, .names .ch, .names .amp, .twp-ov").forEach((e) => {
    const r = e.getBoundingClientRect();
    if (!r.height || r.top < 0 || r.bottom > vh || r.top > vh * 0.85 || r.width < 2) return;   // the template reveals a line once it is above the bottom 8% of the screen
    let hidden = false;
    for (let p = e; p && p.nodeType === 1; p = p.parentElement) { const s = cs(p); if (s.display === "none" || s.visibility === "hidden" || p.hidden) { hidden = true; break; } }
    if (hidden || !e.textContent.trim()) return;
    const op = parseFloat(cs(e).opacity);
    if (op < 0.95) stuck.push({ desc: desc(e), text: e.textContent.replace(/\s+/g, " ").trim().slice(0, 60), op });
  });
  // words split over two lines. The names on page 2 are one box per letter (template), so check them letter by letter.
  const broken = [], lostSpace = [];
  sec.querySelectorAll(".name-line").forEach((line) => {
    const chs = [...line.querySelectorAll(".ch")]; if (!chs.length || cs(line).display === "none") return;
    let word = [];
    const flush = () => { if (word.length > 1) { const tops = word.map((c) => Math.round(c.getBoundingClientRect().top)); if (Math.max(...tops) - Math.min(...tops) > word[0].getBoundingClientRect().height * 0.4) broken.push({ text: line.textContent.trim(), word: word.map((c) => c.textContent).join("") }); } word = []; };
    chs.forEach((c) => { if (/\s/.test(c.textContent)) { flush(); if (c.getBoundingClientRect().width < 2) lostSpace.push({ text: line.textContent.trim() }); } else word.push(c); });
    flush();
  });
  const tw2 = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
  while ((n = tw2.nextNode())) {
    const e = n.parentElement; if (!e || e.closest(".names, select, option, script, style, svg, textarea") || opacityOf(e) < 0.05) continue;
    const re = /\S{3,}/g; let m;
    while ((m = re.exec(n.nodeValue))) {
      const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      const tops = [...new Set([...r.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top / 4)))];
      if (tops.length > 1 && !/[-‐/]/.test(m[0])) broken.push({ text: n.nodeValue.trim().slice(0, 60), word: m[0] });
    }
  }
  const sr = sec.getBoundingClientRect();
  return { broken, lostSpace, vw, vh, sw: document.documentElement.scrollWidth, sec: { l: sr.left, t: sr.top, r: sr.right, b: sr.bottom, h: sr.height }, scrollY: window.scrollY, items, stuck };
};

const HIDE_TEXT = "*{color:transparent!important;-webkit-text-fill-color:transparent!important;caret-color:transparent!important;transition:none!important}input::placeholder,textarea::placeholder{color:transparent!important}";

/* ============================== contrast (WCAG) ============================== */
const parseColor = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 1]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function contrastOf(item, png, dpr) {
  const [r, g, b, al] = parseColor(item.color);
  const alpha = Math.max(0, Math.min(1, al * item.op));
  const vals = [];
  for (const x of item.rects) {
    const w = x.r - x.l, h = x.b - x.t;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const px = Math.round((x.l + w * (0.1 + 0.2 * i)) * dpr), py = Math.round((x.t + h * (0.3 + 0.2 * j)) * dpr);
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue;
      const k = (png.width * py + px) << 2;
      const bg = [png.data[k], png.data[k + 1], png.data[k + 2]];
      const fg = [r * alpha + bg[0] * (1 - alpha), g * alpha + bg[1] * (1 - alpha), b * alpha + bg[2] * (1 - alpha)];
      vals.push(ratio(fg, bg));
    }
  }
  if (!vals.length) return null;
  vals.sort((p, q) => p - q);
  return vals[Math.floor(vals.length * 0.25)];
}

/* ============================== one phone, one scenario ============================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (t) => (t.length > 46 ? t.slice(0, 44) + "…" : t);
const PAGE_LABEL = { envelope: "Envelope", welcome: "Names", families: "Families", countdown: "Countdown & venue", gift: "Gift", rsvp: "RSVP" };

async function runPhone(browser, phone, sc, w, dir) {
  const problems = [];
  const add = (level, cause, page, text, shot, subject = "") => problems.push({ level, cause, page, text, shot, subject });
  const ctx = await browser.newContext(phone.ctx);
  await ctx.addInitScript(SILENCE);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push({ text: "console: " + m.text().slice(0, 200), url: (m.location() || {}).url || "" }); });
  page.on("pageerror", (e) => errors.push({ text: "script error: " + String(e.message || e).slice(0, 200), url: "" }));
  page.on("requestfailed", (r) => { const f = (r.failure() || {}).errorText || ""; if (!/ABORTED|cancelled|NS_BINDING_ABORTED|Load request cancelled|interrupted/i.test(f)) errors.push({ text: `request failed: ${r.url().slice(0, 140)} (${f})`, url: r.url() }); });
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push({ text: `HTTP ${r.status()}: ${r.url().replace(BASE, "").slice(0, 140)}`, url: r.url() }); });
  const D = w.design, slides = D.mode === "slides";
  const k = 1 / ((D.timing && D.timing.revealSpeed) || 1);
  const envMs = (D.timing && D.timing.envelopeOpenMs) || 2300;
  const shotPath = (name) => path.join(dir, `${phone.key}-${name}.jpg`);
  const rel = (p) => path.relative(OUT, p);
  const link = `${BASE}/${w.slug}/?t=${w.token}`;
  const out = { phone: phone.key, problems, full: null, pages: [], seconds: 0 };
  const t0 = Date.now();
  try {
    // 1. one real tap on the seal (iPhone 15 only), from the closed envelope
    if (phone.sealTap && !sc.archived) {
      await page.goto(link, { waitUntil: "load" });
      await page.waitForFunction(() => getComputedStyle(document.body).visibility !== "hidden", null, { timeout: 15000 });
      const sealSel = slides ? ".twp-ov.k-seal" : "#seal";
      await page.waitForSelector(sealSel, { state: "visible", timeout: 10000 });
      await sleep(600);
      await page.tap(sealSel);
      await sleep((slides ? 1500 : envMs) + 1800);
      const st = await page.evaluate((s) => {
        const next = s ? document.querySelectorAll(".twp-slide")[1] : document.getElementById("welcome");
        return { locked: document.documentElement.classList.contains("locked"), top: next ? Math.round(next.getBoundingClientRect().top) : null,
          open: s ? !!document.querySelector(".twp-slide.is-open") : document.getElementById("envelope").classList.contains("is-open"),
          music: window.__music ? !!window.__music.playing : null, muted: [...document.querySelectorAll("audio,video")].every((m) => m.muted || m.volume === 0) };
      }, slides);
      const p = shotPath("seal-tap"); await page.screenshot({ path: p, type: "jpeg", quality: 70, scale: "css" });
      if (!st.open) add("fail", "seal", "Envelope", "Tapping the seal did not open the envelope.", rel(p));
      else if (st.locked) add("fail", "seal", "Envelope", "After tapping the seal the page stayed locked (guests cannot scroll).", rel(p));
      else if (st.top === null || Math.abs(st.top) > 60) add("warn", "seal", "Envelope", `After the envelope opened, the next page did not come to the top of the screen (it is ${st.top} px away).`, rel(p));
      if (!st.muted) add("fail", "sound", "Envelope", "A sound was not muted during the test.", rel(p));
    }

    // 2. the opened invite, page by page
    await page.goto(link + "&open=1", { waitUntil: "load" });
    await page.waitForFunction(() => getComputedStyle(document.body).visibility !== "hidden", null, { timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await sleep(500);
    const sections = await page.evaluate((s) => [...document.querySelectorAll(s ? ".twp-slide" : "section.page")]
      .filter((e) => getComputedStyle(e).display !== "none").map((e, i) => ({ sel: e.id ? "#" + e.id : `section:nth-of-type(${i + 1})`, id: e.id, type: e.dataset.type || "" })), slides);
    if (!sections.length) add("fail", "blank", "", "The invitation showed no pages at all.", null);
    for (const s of sections) {
      const label = slides ? `Page ${s.id.replace("slide-", "")} (${s.type})` : PAGE_LABEL[s.id] || s.id;
      const isWelcome = s.id === "welcome";
      const longest = Math.max(String(D.config.couple.groom).length, String(D.config.couple.bride).length);
      const waitMs = Math.round((isWelcome ? Math.max(3.3, longest * 0.07 + 1.7) : 1.6) * k * 1000) + 450;
      const geo = await page.evaluate((sel) => { const e = document.querySelector(sel); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY); const r = e.getBoundingClientRect(); return { h: r.height, vh: innerHeight, top: r.top + scrollY }; }, s.sel);
      const steps = geo.h <= geo.vh + 4 ? 1 : 1 + Math.ceil((geo.h - geo.vh) / (geo.vh * 0.8));
      const seen = new Set(), firstShot = shotPath(`page-${s.id}`);
      const pageRec = { label, shot: rel(firstShot), steps: [] };
      out.pages.push(pageRec);
      for (let st = 0; st < steps; st++) {
        const y = Math.min(geo.top + st * geo.vh * 0.8, geo.top + geo.h - geo.vh);
        await page.evaluate((yy) => { window.scrollTo(0, Math.max(0, yy)); window.dispatchEvent(new Event("scroll")); }, y);
        await sleep(st === 0 ? waitMs : Math.round(1.6 * k * 1000) + 300);
        // the picture FIRST: a headless browser only moves its fade-ins forward when it paints a frame, so measuring before
        // a paint reads lines as still see-through (that was the false "stuck" alarm in the first full run)
        const sp = st === 0 ? firstShot : shotPath(`page-${s.id}-${st + 1}`);
        await page.screenshot({ path: sp, type: "jpeg", quality: 72, scale: "css" });
        const a = await page.evaluate(ANALYZE, { sel: s.sel });
        if (!a) continue;
        if (st > 0) pageRec.steps.push(rel(sp));
        await page.addStyleTag({ content: HIDE_TEXT }).then((h) => h.evaluate((e) => e.setAttribute("data-scn-hide", "1")));
        await sleep(60);
        const png = PNG.sync.read(await page.screenshot({ type: "png", scale: "css" }));
        await page.evaluate(() => document.querySelectorAll("style[data-scn-hide]").forEach((e) => e.remove()));
        const R = rel(sp);
        if (a.sw > a.vw + 1) add("fail", "overflow-x", label, `The page is wider than the phone (${a.sw} px on a ${a.vw} px screen): guests can slide it sideways.`, R);
        for (const x of a.stuck) add("fail", "stuck", label, `"${short(x.text)}" never appeared: it is still see-through after the animation.`, R, x.text);
        for (let tries = 0; a.stuck.length && tries < 3; tries++) {   // a busy test machine stalls fade-ins: up to 3 x 2 s more, with a tiny scroll
          await page.evaluate((d) => { window.scrollBy(0, d); window.dispatchEvent(new Event("scroll")); }, tries % 2 ? -2 : 2);   // like a real guest; a truly stuck line never recovers
          for (let f = 0; f < 4; f++) { await sleep(500); await page.screenshot({ type: "jpeg", quality: 10, scale: "css" }); }   // keep painting frames
          const again = await page.evaluate(ANALYZE, { sel: s.sel });
          if (again) a.stuck = again.stuck;
        }
        for (const x of a.broken) if (!seen.has("bw|" + x.word)) { seen.add("bw|" + x.word); add("fail", "broken-word", label, `The word "${x.word}" is split over two lines ("${short(x.text)}").`, R, x.word); }
        for (const x of a.lostSpace) if (!seen.has("ls|" + x.text)) { seen.add("ls|" + x.text); add("fail", "lost-space", label, `The space between the words disappears: "${short(x.text.replace(/\s+/g, ""))}" instead of "${short(x.text)}".`, R, x.text); }
        const visible = a.items.filter((it) => it.op >= 0.05 && !it.sr && !it.scrolledAway);
        const full = visible.filter((it) => it.rects.every((r) => r.t >= -1 && r.b <= a.vh + 1));
        for (const it of visible) {
          const key = it.desc + "|" + it.text;
          if (seen.has(key)) continue;
          const inView = it.rects.every((r) => r.t >= -1 && r.b <= a.vh + 1);
          if (!inView) continue;
          seen.add(key);
          const offX = it.rects.some((r) => r.l < -1 || r.r > a.vw + 1);
          if (offX) add("fail", "off-screen", label, `"${short(it.text)}" runs off the side of the screen.`, R, it.text);
          else if (it.rects.some((r) => r.l < a.sec.l - 1 || r.r > a.sec.r + 1 || r.t < a.sec.t - 1 || r.b > a.sec.b + 1)) add("fail", "clipped", label, `"${short(it.text)}" sticks out of its page and is cut off.`, R, it.text);
          else if (it.clipped && !it.clipped.scroll) add("fail", "clipped", label, `"${short(it.text)}" is cut off at the edge of ${it.clipped.by}.`, R, it.text);
          else if (it.clipped && it.clipped.scroll) add("warn", "clipped", label, `"${short(it.text)}" only fits by sliding sideways inside its box.`, R, it.text);
          else if (it.ownClip) add("fail", "clipped", label, `"${short(it.text)}" is cut off (it does not fit its line).`, R, it.text);
          if (it.spill && !offX && !it.spill.canva) add(it.spill.by > 12 ? "fail" : "warn", "spill", label, `"${short(it.text)}" spills ${it.spill.by} px out of its box (${it.spill.box}).`, R, it.text);
          if (it.spill && !offX && it.spill.canva) {
            const OVN = { text: "text", names: "couple names", reserved: "\"Family + seats\"", countdown: "countdown", maps: "Maps button", gift: "gift number", photo: "photo" };
            const bk = "sc|" + label + "|" + it.spill.kind + "|" + it.spill.at;
            if (it.spill.canva && !seen.has(bk)) { seen.add(bk); add("warn", "spill-canva", label, `The ${OVN[it.spill.kind] || it.spill.kind} box: "${short(it.text)}" grows ${it.spill.by} px past the box drawn for it on the Canva page, over the picture.`, R, it.spill.kind); }
          }
          if (it.orphan) add("warn", "orphan", label, `"${short(it.text)}" breaks awkwardly, leaving one or two letters alone on a line.`, R, it.text);
          if (it.fs < 9) add("fail", "small", label, `"${short(it.text)}" is tiny (${it.fs} px).`, R, it.text);
          else if (it.fs < 11) add("warn", "small", label, `"${short(it.text)}" is very small (${it.fs} px; 11 px is the least for easy reading).`, R, it.text);
          const ornament = it.text.replace(/[\s\p{P}\p{S}]/gu, "").length <= 1;   // "&", "·", ":", "و" between names: decoration, not reading text
          const c = ornament ? null : contrastOf(it, png, png.width / a.vw);
          if (c !== null && c < 2) add("fail", "contrast", label, `"${short(it.text)}" is very hard to read against what is behind it (contrast ${c.toFixed(1)} : 1).`, R, it.text);
          else if (c !== null && c < 3) add("warn", "contrast", label, `"${short(it.text)}" is faint against what is behind it (contrast ${c.toFixed(1)} : 1).`, R, it.text);
        }
        // overlap between text of different blocks (middle 60% of each line box)
        const band = (r) => { const h = r.b - r.t; return { l: r.l, r: r.r, t: r.t + h * 0.2, b: r.b - h * 0.2 }; };
        for (let i = 0; i < full.length; i++) for (let j = i + 1; j < full.length; j++) {
          const A = full[i], B = full[j];
          if (A.group === B.group || A.id === B.id) continue;
          let hit = false;
          for (const ra of A.rects) { for (const rb of B.rects) {
            const p = band(ra), q = band(rb);
            const iw = Math.min(p.r, q.r) - Math.max(p.l, q.l), ih = Math.min(p.b, q.b) - Math.max(p.t, q.t);
            if (iw <= 0 || ih <= 0) continue;
            const small = Math.min((p.r - p.l) * (p.b - p.t), (q.r - q.l) * (q.b - q.t));
            if (small > 0 && (iw * ih) / small > 0.1) { hit = true; break; }
          } if (hit) break; }
          if (hit) { const key = "ov|" + A.text + "|" + B.text; if (!seen.has(key)) { seen.add(key); add("fail", "overlap", label, `"${short(A.text)}" runs into "${short(B.text)}".`, R, A.text + "|" + B.text); } }
        }
      }
    }

    // 3. countdown
    const showCd = slides ? D.slides.some((x) => x.overlays.some((o) => o.kind === "countdown")) : D.show.countdown !== false;
    if (showCd) {
      const nums = await page.evaluate((s) => [...document.querySelectorAll(s ? ".k-countdown .num" : "#countdown .num")].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map((e) => e.textContent.trim()), slides);
      if (nums.length !== 4 || !nums.every((x) => /^\d{2,3}$/.test(x)) || nums.every((x) => /^0+$/.test(x)))
        add("fail", "countdown", "Countdown", `The countdown does not show 4 numbers (it shows: ${nums.join(" ") || "nothing"}).`, out.pages.find((p) => /Countdown|countdown/.test(p.label))?.shot || null);
    }

    // 4. the answer form
    const rsvpSel = slides ? ".k-rsvp" : "#rsvp";
    const hasRsvp = await page.evaluate((s) => !!document.querySelector(s), rsvpSel);
    if (sc.archived) {
      const ok = await page.evaluate(() => { const c = [...document.querySelectorAll("#rsvp .reserved .guest-name")].some((e) => /Thank you/.test(e.textContent) && e.getClientRects().length); const box = document.getElementById("rsvpBox"); return c && (!box || box.hidden || getComputedStyle(box).display === "none"); });
      if (!slides && !ok) add("fail", "rsvp", "RSVP", "The archived wedding does not show the thank-you card instead of the answer form.", out.pages.at(-1)?.shot || null);
    } else if (hasRsvp) {
      const q = slides ? { box: ".k-rsvp", yes: ".k-rsvp [data-r=btnYes]", no: ".k-rsvp [data-r=btnNo]", sel: ".k-rsvp [data-r=guestCount]", names: ".k-rsvp [data-r=nameFields] input", send: ".k-rsvp [data-r=sendBtn]", guest: ".k-rsvp [data-r=guestName]", prev: ".k-rsvp [data-r=prevNote]", note: ".k-rsvp textarea" }
        : { box: "#rsvpBox", yes: "#btnYes", no: "#btnNo", sel: "#guestCount", names: "#nameFields input", send: "#sendBtn", guest: "#guestName", prev: "#prevNote", note: "#note" };
      const rshot = shotPath("rsvp-form");
      await page.waitForSelector(q.yes, { state: "attached", timeout: 10000 }).catch(() => {});
      const before = await page.evaluate((q) => ({ guest: (document.querySelector(q.guest) || {}).textContent || "", options: document.querySelector(q.sel) ? document.querySelector(q.sel).options.length : -1,
        noPressed: (document.querySelector(q.no) || { getAttribute: () => "" }).getAttribute("aria-pressed"), prev: !!(document.querySelector(q.prev) && !document.querySelector(q.prev).hidden),
        note: (document.querySelector(q.note) || {}).value || "" }), q);
      if (before.guest.trim() !== w.family) add("fail", "rsvp", "RSVP", `The family's name shows as "${short(before.guest)}" instead of "${w.family}".`, null);
      if (before.options !== w.seats) add("fail", "rsvp", "RSVP", `The "How many of you?" menu has ${before.options} choices instead of ${w.seats}.`, null);
      if (sc.answer) {
        if (before.noPressed !== "true") add("fail", "rsvp", "RSVP", "The earlier answer (not coming) is not shown as chosen.", null);
        if (!before.prev) add("fail", "rsvp", "RSVP", "The note \"You replied on ...\" is not shown for a family that already answered.", null);
        if (before.note !== sc.answer.note) add("fail", "rsvp", "RSVP", "The family's earlier message is not filled in.", null);
      }
      await page.locator(q.yes).scrollIntoViewIfNeeded().catch(() => {});
      await sleep(300);
      await page.tap(q.yes).catch(async () => { await page.click(q.yes).catch(() => {}); });
      await sleep(900);
      const nNames = await page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length, q.names);
      if (nNames !== w.seats) add("fail", "rsvp", "RSVP", `After "Joyfully accept", ${nNames} name boxes appear instead of ${w.seats}.`, null);
      await page.evaluate((s) => { const b = document.querySelector(s); if (b) b.scrollIntoView({ block: "center" }); }, q.send);
      await sleep(700);
      const send = await page.evaluate((q) => {
        const b = document.querySelector(q.send); if (!b) return { found: false };
        const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        let inBox = true; const box = b.closest(".twp-ov");
        if (box) { const br = box.getBoundingClientRect(); inBox = r.top >= br.top - 1 && r.bottom <= br.bottom + 1; }
        const box2 = document.querySelector(q.box);
        return { found: true, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, covered: !(hit && (hit === b || b.contains(hit))), coveredBy: hit ? hit.className || hit.tagName : "",
          inBox, squeezed: box ? box.scrollHeight > box.clientHeight + 4 : false, boxH: box ? Math.round(box.clientHeight) : 0, formH: box ? Math.round(box.scrollHeight) : 0,
          sw: document.documentElement.scrollWidth, vw: innerWidth, inputsOk: [...document.querySelectorAll(q.names)].every((i) => { const ir = i.getBoundingClientRect(); return ir.left >= -1 && ir.right <= innerWidth + 1; }), boxSeen: !!box2 };
      }, q);
      await page.screenshot({ path: rshot, type: "jpeg", quality: 72, scale: "css" });
      const R = rel(rshot);
      out.pages.push({ label: "Answer form opened", shot: R, steps: [] });
      if (!send.found) add("fail", "rsvp", "RSVP", "There is no Send button on the answer form.", R);
      else {
        if (!send.inView || !send.inBox) add("fail", "rsvp", "RSVP", "The Send button cannot be brought fully onto the screen.", R);
        else if (send.covered) add("fail", "rsvp", "RSVP", `The Send button is covered by something else (${send.coveredBy}).`, R);
        if (send.squeezed) add("warn", "rsvp-squeezed", "RSVP", `The answer form is squeezed into a box ${send.boxH} px tall (it needs ${send.formH} px): guests must scroll inside the box to reach Send.`, R);
        if (send.sw > send.vw + 1) add("fail", "overflow-x", "RSVP", "With the name boxes open, the page is wider than the phone.", R);
        if (!send.inputsOk) add("fail", "off-screen", "RSVP", "Some name boxes run off the side of the screen.", R);
      }
    }

    // 5. whole page, and errors
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    const fp = shotPath("full");
    await page.screenshot({ path: fp, fullPage: true, type: "jpeg", quality: 55, scale: "css" });
    out.full = rel(fp);
  } catch (e) {
    const p = shotPath("crash");
    await page.screenshot({ path: p, type: "jpeg", quality: 70, scale: "css" }).catch(() => {});
    add("fail", "crash", "", `The check could not finish: ${String(e.message || e).split("\n")[0].slice(0, 200)}`, rel(p));
  }
  const seenErr = new Set();
  for (const e of errors) {
    if (seenErr.has(e.text)) continue; seenErr.add(e.text);
    const fonts = /fonts\.(googleapis|gstatic)\.com/.test(e.url + e.text);
    add(fonts ? "warn" : "fail", fonts ? "fonts" : "errors", "", (fonts ? "A Google font could not be downloaded (needs the internet): " : "The page reported a problem: ") + e.text, null);
  }
  await ctx.close();
  out.seconds = Math.round((Date.now() - t0) / 1000);
  return out;
}

/* ============================== the gallery ============================== */
const CAUSE = {
  "overflow-x": "Page wider than the phone", "off-screen": "Words run off the side of the screen", clipped: "Words cut off", spill: "Words spill out of their box or button",
  overlap: "Lines of words run into each other", "broken-word": "A word split over two lines", "lost-space": "Space between words disappears",
  "spill-canva": "Canva box content grows past its box", orphan: "Short label breaks awkwardly", small: "Words too small", contrast: "Words hard to read against the background", stuck: "Words stuck invisible after the animation",
  countdown: "Countdown wrong", rsvp: "Answer form problem", "rsvp-squeezed": "Answer form squeezed into a small box", seal: "Opening the envelope", errors: "Errors on the page",
  fonts: "Fonts not downloaded", crash: "Check could not finish", setup: "Scenario could not be set up", blank: "Blank invitation", sound: "Sound not muted",
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function statusOf(problems) { return problems.some((p) => p.level === "fail") ? "failure" : problems.some((p) => p.level === "warn") ? "warning" : "ok"; }
function summarize(results) {
  const pagesChecked = results.reduce((n, r) => n + r.phones.reduce((m, p) => m + p.pages.length, 0), 0);
  const all = results.flatMap((r) => r.phones.flatMap((p) => p.problems.filter((x) => x.level !== "same").map((x) => ({ ...x, sc: r.sc, phone: p.phone }))).concat((r.setupError ? [{ level: "fail", cause: "setup", page: "", text: r.setupError, sc: r.sc, phone: "" }] : [])));
  const fails = all.filter((x) => x.level === "fail").length, warns = all.filter((x) => x.level === "warn").length;
  const groups = {};
  for (const x of all) {
    const g = (groups[x.level + "|" + x.cause] ||= { level: x.level, cause: x.cause, n: 0, scenarios: new Map() });
    g.n++;
    const s = g.scenarios.get(x.sc.n) || { sc: x.sc, phones: new Set(), pages: new Set(), example: x };
    s.phones.add(x.phone); if (x.page) s.pages.add(x.page); g.scenarios.set(x.sc.n, s);
  }
  const top = Object.values(groups).sort((a, b) => (a.level === b.level ? b.scenarios.size - a.scenarios.size : a.level === "fail" ? -1 : 1));
  return { scenarios: results.length, phones: PHONES.length, pagesChecked, fails, warns, top, failedScenarios: results.filter((r) => r.status === "failure").length, warnScenarios: results.filter((r) => r.status === "warning").length };
}
function gallery(results, S, started) {
  const phoneName = Object.fromEntries(PHONES.map((p) => [p.key, p.label]));
  const chip = (st) => `<span class="chip ${st}">${st === "ok" ? "OK" : st === "warning" ? "Warning" : "Failure"}</span>`;
  const topHtml = S.top.map((g) => `<li class="${g.level}"><b>${esc(CAUSE[g.cause] || g.cause)}</b> <span class="lvl">${g.level === "fail" ? "failure" : "warning"}</span> &middot; ${g.n} times in ${g.scenarios.size} scenario${g.scenarios.size === 1 ? "" : "s"}
    <ul>${[...g.scenarios.values()].slice(0, 14).map((s) => `<li><a href="#scn-${s.sc.n}">${s.sc.n}. ${esc(s.sc.name)}</a> <span class="set">(${esc(s.sc.setting)})</span>: ${[...s.phones].filter(Boolean).map((p) => phoneName[p] || p).join(", ")}${s.pages.size ? " &middot; " + esc([...s.pages].join(", ")) : ""}
      <br><span class="ex">${esc(s.example.text)}</span>${s.example.shot ? ` <a href="${esc(s.example.shot)}">picture</a>` : ""}</li>`).join("")}${g.scenarios.size > 14 ? `<li>and ${g.scenarios.size - 14} more</li>` : ""}</ul></li>`).join("");
  const rows = results.map((r) => `<section class="row" id="scn-${r.sc.n}"><h2>${chip(r.status)} ${r.sc.n}. ${esc(r.sc.name)}</h2><p class="set">Setting: ${esc(r.sc.setting)}${r.slug ? ` &middot; wedding <code>${esc(r.slug)}</code>` : ""}</p>
    ${r.setupError ? `<p class="bad">Could not set up: ${esc(r.setupError)}</p>` : ""}
    <div class="phones">${r.phones.map((p) => {
      const st = statusOf(p.problems);
      const same = p.problems.filter((x) => x.level === "same");
      const list = p.problems.filter((x) => x.cause !== "fonts" && x.level !== "same").slice(0, 40);
      return `<div class="phone"><h3>${chip(st)} ${esc(phoneName[p.phone])}</h3>
        ${p.full ? `<a href="${esc(p.full)}"><div class="shot"><img loading="lazy" src="${esc(p.full)}" alt=""></div></a>` : ""}
        <p class="pages">${p.pages.map((pg) => `<a href="${esc(pg.shot)}">${esc(pg.label)}</a>${pg.steps.map((s, i) => ` <a href="${esc(s)}">(${i + 2})</a>`).join("")}`).join(" &middot; ")}</p>
        ${list.length ? `<ul class="probs">${list.map((x) => `<li class="${x.level}">${x.page ? `<b>${esc(x.page)}</b>: ` : ""}${esc(x.text)}${x.shot ? ` <a href="${esc(x.shot)}">picture</a>` : ""}</li>`).join("")}</ul>` : "<p class=\"okline\">Nothing wrong found.</p>"}
        ${same.length ? `<details class="same"><summary>${same.length} also in the original template (not counted)</summary><ul>${same.map((x) => `<li>${x.page ? `<b>${esc(x.page)}</b>: ` : ""}${esc(x.text)}</li>`).join("")}</ul></details>` : ""}
        ${p.problems.length - same.length > list.length ? `<p class="more">${p.problems.length - same.length - list.length} more (fonts / long list) not shown</p>` : ""}</div>`;
    }).join("")}</div></section>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invite scenario sweep</title>
<style>body{font:15px/1.45 -apple-system,Helvetica,Arial,sans-serif;margin:0;background:#f6f3ee;color:#2b2622}header,main{max-width:1400px;margin:0 auto;padding:16px 20px}
h1{font-size:24px;margin:8px 0}table{border-collapse:collapse;margin:10px 0}td,th{border:1px solid #d8cfc2;padding:6px 12px;text-align:left;background:#fff}
.chip{display:inline-block;font-size:12px;font-weight:700;border-radius:10px;padding:2px 9px;vertical-align:2px}.chip.ok{background:#d9f0dc;color:#1d6b2c}.chip.warning{background:#fff0c2;color:#7a5600}.chip.failure{background:#f8d3d0;color:#9b1c13}
.row{background:#fff;border:1px solid #e3dbcf;border-radius:12px;margin:18px 0;padding:10px 16px}.row h2{font-size:18px;margin:6px 0}.set{color:#6b6157;margin:2px 0 8px;font-size:13px}
.phones{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.phone h3{font-size:15px;margin:4px 0}.shot{height:560px;overflow:auto;border:1px solid #ddd;border-radius:8px;background:#eee}.shot img{width:100%;display:block}
.pages{font-size:12px}.probs{padding-left:18px;font-size:13px}.probs li.fail{color:#9b1c13}.probs li.warn{color:#7a5600}.okline{color:#1d6b2c;font-size:13px}.more{font-size:12px;color:#777}.same{font-size:12px;color:#888}
#top>li{margin:10px 0}#top li.fail>b{color:#9b1c13}#top li.warn>b{color:#7a5600}.lvl{font-size:12px;color:#777}.ex{color:#555;font-size:13px}code{font-size:12px}
@media (max-width:900px){.phones{grid-template-columns:1fr}}</style></head><body>
<header><h1>Invite scenario sweep</h1><p>Run ${esc(new Date(started).toLocaleString("en-GB"))} against ${esc(BASE)} (this computer only). Each row is one set of invite settings, opened by a guest family on three phones.
Failure = a guest would notice something broken; warning = worth a look. Scenario 1 is the untouched template: what it already shows is greyed in the other rows ("also in the original") and not counted. Click a picture to open it full size; the page names under it open each page.</p>
<table><tr><th>Scenarios run</th><th>Phones</th><th>Pages checked</th><th>Failures</th><th>Warnings</th><th>Scenarios with a failure</th><th>Scenarios with only warnings</th></tr>
<tr><td>${S.scenarios}</td><td>${PHONES.map((p) => p.label).join(", ")}</td><td>${S.pagesChecked}</td><td>${S.fails}</td><td>${S.warns}</td><td>${S.failedScenarios}</td><td>${S.warnScenarios}</td></tr></table>
<h2>Top issues (grouped by cause, with the setting that triggers each)</h2><ul id="top">${topHtml || "<li>None.</li>"}</ul></header>
<main>${rows}</main></body></html>`;
}

/* ============================== main ============================== */
async function pool(list, n, fn) { const out = new Array(list.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } })); return out; }

const started = Date.now();
const pick = process.env.SCN ? new Set(process.env.SCN.split(",").map(Number)) : null;
const list = SCENARIOS.filter((s) => !pick || pick.has(s.n) || s.n === 1);   // the control always runs: it is the baseline
fs.mkdirSync(OUT, { recursive: true });
await ownerLogin();
console.log(`[scenarios] ${list.length} scenarios x ${PHONES.length} phones against ${BASE}; pictures in ${OUT}`);
// What the untouched template already does (its gold button, gold time line over the photo...): the same finding in another
// scenario, on the same phone and page, for the same words, is shown greyed as "also in the original", not counted.
let baseline = null;
const baseKey = (phone, x) => `${phone}|${x.page}|${x.cause}|${x.subject || x.text}`;
const phoneRun = async (p, sc, w, dir) => { const b = await launchQuiet(playwright[p.engine], p.engine === "chromium" ? { args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] } : {}); try { return await runPhone(b, p, sc, w, dir); } finally { await b.close(); } };
const statusOfRun = (r) => r.setupError ? "failure" : r.phones.map((p) => statusOf(p.problems)).reduce((a, b) => (a === "failure" || b === "failure" ? "failure" : a === "warning" || b === "warning" ? "warning" : "ok"), "ok");
const runOne = async (sc) => {
  const dir = path.join(OUT, `scn-${String(sc.n).padStart(2, "0")}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const r = { sc: { n: sc.n, name: sc.name, setting: sc.setting }, phones: [], slug: `qa-scn-${sc.n}` };
  let w;
  try { w = await setup(sc); } catch (e) { r.setupError = String(e.message || e).slice(0, 400); r.status = "failure"; console.log(`[scenarios] ${sc.n}. ${sc.name}: SETUP FAILED ${r.setupError}`); return r; }
  // one browser per phone per scenario: pages sharing a browser under heavy screenshotting stall their fade-ins (false "stuck")
  r.phones = await Promise.all(PHONES.map((p) => phoneRun(p, sc, w, dir)));
  r.ctx = { sc, w, dir };
  if (sc.n === 1) baseline = new Map(r.phones.flatMap((p) => p.problems.map((x) => [baseKey(p.phone, x), x.level])));
  else if (baseline) for (const p of r.phones) for (const x of p.problems) { const b = baseline.get(baseKey(p.phone, x)); if (b && (b === x.level || b === "fail")) x.level = "same"; }
  r.status = r.setupError ? "failure" : [...r.phones.map((p) => statusOf(p.problems))].reduce((a, b) => (a === "failure" || b === "failure" ? "failure" : a === "warning" || b === "warning" ? "warning" : "ok"), "ok");
  const f = r.phones.reduce((n, p) => n + p.problems.filter((x) => x.level === "fail").length, 0), wn = r.phones.reduce((n, p) => n + p.problems.filter((x) => x.level === "warn").length, 0);
  console.log(`[scenarios] ${String(sc.n).padStart(2)}. ${r.status.toUpperCase().padEnd(7)} ${sc.name} (${f} failures, ${wn} warnings, ${r.phones.map((p) => p.seconds + "s").join("/")})`);
  return r;
};
const results = [await runOne(list[0])].concat(await pool(list.slice(1), CONC, runOne));
// Confirm "stuck invisible" on a quiet machine: with several phones at once, Chromium sometimes freezes its fade-ins mid-way
// (the same design passes alone). A phone that reported stuck lines is run again alone; only that quiet result counts.
for (const r of results) for (let i = 0; i < r.phones.length; i++) {
  if (!r.ctx || !r.phones[i].problems.some((x) => x.cause === "stuck" && x.level === "fail")) continue;
  const p = PHONES.find((q) => q.key === r.phones[i].phone);
  const again = await phoneRun(p, r.ctx.sc, r.ctx.w, r.ctx.dir);
  again.problems.forEach((x) => { if (x.level === "fail" && x.cause === "stuck") x.text += " (confirmed when run alone)"; });
  if (baseline && r.sc.n !== 1) for (const x of again.problems) { const b = baseline.get(baseKey(again.phone, x)); if (b && (b === x.level || b === "fail")) x.level = "same"; }
  console.log(`[scenarios] ${r.sc.n}. re-checked ${p.label} alone: ${again.problems.some((x) => x.cause === "stuck" && x.level === "fail") ? "still stuck" : "fine (it was the busy machine)"}`);
  r.phones[i] = again;
  r.status = statusOfRun(r);
}
for (const r of results) delete r.ctx;
const S = summarize(results);
fs.writeFileSync(path.join(OUT, "index.html"), gallery(results, S, started));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ base: BASE, started: new Date(started).toISOString(), summary: { ...S, top: S.top.map((g) => ({ level: g.level, cause: g.cause, n: g.n, scenarios: [...g.scenarios.values()].map((s) => ({ n: s.sc.n, name: s.sc.name, setting: s.sc.setting, phones: [...s.phones], pages: [...s.pages], example: s.example.text })) })) }, results }, null, 1));

if (!KEEP) {
  for (const sc of list) { const slug = `qa-scn-${sc.n}`; await owner("POST", "delete", { slug, confirm: slug }); }
  console.log(`[scenarios] deleted the ${list.length} throwaway weddings (KEEP=1 keeps them)`);
}
console.log("\n[scenarios] SUMMARY");
console.log(`  scenarios run: ${S.scenarios}   phones: ${PHONES.map((p) => p.label).join(", ")}   pages checked: ${S.pagesChecked}`);
console.log(`  failures: ${S.fails}   warnings: ${S.warns}   scenarios with a failure: ${S.failedScenarios}   with only warnings: ${S.warnScenarios}`);
console.log("  top issues:");
for (const g of S.top.slice(0, 15)) console.log(`   - [${g.level}] ${CAUSE[g.cause] || g.cause}: ${g.n} times, scenarios ${[...g.scenarios.values()].map((s) => s.sc.n).join(", ")}`);
console.log(`\n  gallery: ${path.join(OUT, "index.html")}  (${Math.round((Date.now() - started) / 1000)} s)`);
process.exit(S.fails ? 1 : 0);
