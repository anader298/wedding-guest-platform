/* WEDDING GUEST PLATFORM: THE INVITATION'S SCRIPT (site/app/app.js)
 * What it is: Karim & Maya's original invite script, verbatim, plus the LOADER block further down (search "LOADER")
 *   that fetches each wedding's design from /<wedding>/api/invite and fills it in. Only the LOADER may change.
 * Who uses it: site/app/index.html (every wedding's invitation). CONFIG below = the template's built-in design.
 * //notes: (developers) tests/db.test.ts checks CONFIG equals TEMPLATE_CONFIG in netlify/functions/_lib/_wedding.ts.
 *   site/app/index.html and style.css have NO header on purpose: they must stay byte-identical to the original. */
/* Karim & Maya wedding invitation (draft).
 * ALL event text lives in CONFIG below. Edit here, not in index.html. */
const CONFIG = {
  couple: {
    groom: "Karim",
    bride: "Maya",
    monogram: "K & M",          // shown in footer; seal uses the first letters of groom/bride
    ar: "كريم و مايا",
  },
  date: {
    // Countdown target, Beirut time (EEST, UTC+3 in June). Change the time here if needed.
    iso: "2027-06-19T18:30:00+03:00",   // 6:30 pm Beirut
    en: "Saturday 19 June 2027",
    ar: "السبت ١٩ حزيران ٢٠٢٧",
    short: "19 · 6 · 2027",
    timeEn: "6:30 PM",
    timeAr: "٦:٣٠ مساءً",
  },
  families: {
    en: { father1: "Eng. Samir Mansour", father2: "Mr. Fadi Nassar" },
    ar: { father1: "المهندس سمير منصور", father2: "السيد فادي نصار" },
  },
  venue: {
    name: "Olive Grove Hall",
    city: "Batroun, Lebanon",
    ar: "البترون، لبنان",
    mapsQuery: "Olive Grove Hall Batroun Lebanon",
  },
  rsvp: {
    replyByEn: "Please reply before May 15",
    replyByAr: "الرجاء التأكيد قبل ١٥ أيار",
    // polite adults-only note, shown under the "Reserved for" card
    kidsNoteAr: "نومًا هنيئًا لأطفالكم، وسهرة سعيدة لكم",
    kidsNoteEn: "Sweet dreams to your little ones, and a lovely evening to you.",
  },
  gift: {
    provider: "Sample Pay",
    accountNumber: "12 345 678",   // shown with spaces; "Tap to copy" copies the digits only
  },
  // Background music, starts when the guest taps the envelope.
  // music.m4a: a short synthetic placeholder tone in this repository. Each wedding uploads its own song
  // on the Design tab; loop: true restarts it without a cut.
  music: { src: "music.m4a", startAt: 0, loop: true, volume: 0.6, enabled: true },
  // Used with ?demo=1, or when the API is unreachable on file:// or localhost.
  demoGuest: { name: "The Aziz Family", max_guests: 4, response: null },
};

/* =====================================================================================
 * WEDDING GUEST PLATFORM: LOADER (the only part of this file added to the original invite)
 * -------------------------------------------------------------------------------------
 * What it is:   a small piece of code that runs first, before Karim & Maya's original
 *               invite code below. It asks the website "what does THIS wedding look like?"
 *               and quietly fills in that wedding's names, dates, colours and pictures.
 * Who uses it:  every guest who opens a wedding link (https://<site>/<wedding-name>/?t=...).
 * Talks to:     GET /<wedding-name>/api/invite   (public, returns the published design)
 *               GET /<wedding-name>/api/invite?draft=1 (only for helpers, used by the
 *               Design preview), and slides.js when the wedding uses "Canva slides".
 * Must not change, and why:
 *   - Everything BELOW this loader is the original invite, copied verbatim. Do not edit it,
 *     and do not edit index.html or style.css. Every wedding shares them, so one change
 *     changes every wedding, and Karim & Maya's invite must stay exactly as it was.
 *   - If the website cannot be reached (opened from a file, no internet, old link), the page
 *     must still work on the built-in CONFIG above. Keep that fallback.
 *   - Phone numbers and e-mails are never sent to this page. Do not add them.
 * //notes: (for developers)
 *   - Slug = first path segment. API = "/" + slug + "/api". The original code's two fetches
 *     now use `${API}/guest` and `${API}/rsvp` (the only other edits in this file).
 *   - THE ONE STRUCTURAL CHANGE: the original immediately-invoked function `(() => { ... })();`
 *     (everything below this loader) was renamed into a named function, `const runTemplate = () => { ... };`,
 *     which the loader calls once the design has arrived (or failed to arrive). Nothing inside it changed
 *     except the two web addresses (`${API}/guest`, `${API}/rsvp`, formerly "/wedding/api/...") and ONE literal:
 *     the envelope wait `2300` became `(CONFIG.timing && CONFIG.timing.envelopeOpenMs) || 2300` (Design tab, Timing).
 *   - index.html and style.css are kept byte-identical to the original template.
 *     To check that it LOOKS identical, pixel by pixel, on an iPhone and an Android phone:
 *       node tools/qa/compare-template.mjs "file://$PWD/site/app/index.html" http://localhost:8888/karim-and-maya/
 *       NODE_PATH=/tmp/pwtest/node_modules node tools/qa/pages-smoke.mjs   (first two checks)
 *   - Theme -> CSS variables on <html>: paper, paper2, gold, goldD, goldL, ink, inkSoft, serif,
 *     sans, arabic (same names style.css uses), baseSize -> html font-size; because the
 *     template's text sizes are in px, a baseSize other than 16 also zooms each page's .content.
 *   - Per-page look (data.pages), photo veil/blur (data.readability), timing (data.timing): applyOverrides() writes
 *     one <style id="twp-overrides"> after style.css, using the template's own selectors (.page-welcome .content,
 *     .photo-veil, .reveal, .env-card...) and CSS variables set on each page section. A rule is written only when a
 *     value differs from the template, so the default design gets an empty style element (pixel-identical).
 *     Reveal speed scales the .reveal transitions and their inline --d delays via calc(); envelope timing scales the
 *     envelope's transitions and sets CONFIG.timing.envelopeOpenMs for runTemplate's wait (the same wait ends with
 *     the scroll to #welcome, so there is no separate "pause before scrolling").
 *   - One line of words (data.lines, Design tab "Fine-tune a line"): LINES maps each key ("welcome.dateEn"...) to its
 *     template selectors and its px sizes in style.css; lineCSS() writes those rules AFTER the page rules, with !important,
 *     so a line always wins over its page. size = that px times 0.6-1.8 (and the phone-width size where style.css has one),
 *     hidden = display:none. No lines = no rules (the default design still gets an empty style element).
 *     window.TWPLines exposes LINES to the Design tab's live sample. Key list = LINE_LIST in netlify/functions/_lib/_wedding.ts.
 *   - afterTemplate() runs once runTemplate() has returned (and again on fonts ready / resize): word boxes + shrink for long or
 *     spaced names, the countdown zoomed to fit, an 11 px floor for small words when sizes changed, the music button's dodge for
 *     the line under Send. Each acts only when needed, so the default design stays pixel-identical. Photo veil under 30 with
 *     no Names-page shadow or backdrop adds a glow and a feathered soft light behind the words (overridesCSS). Page Size bounds 0.8-1.4, Countdown 0.8-1.2 (as _lib/_invite.ts).
 *   - Assets: a URL whose file name equals the template's own file is left alone (identical
 *     result for the seeded wedding). Others replace the CSS backgrounds / <img> / music.
 *   - Design preview: inside the admin page's iframe with ?draft=1 the loader first asks the
 *     parent window for the unsaved draft (postMessage "twp-ready" -> "twp-invite"), and
 *     only fetches ?draft=1 if no answer comes within 800 ms.
 *   - mode "slides": loads slides.js and hands over (window.TWPSlides.start); the template DOM
 *     is not used then. status "archived": RSVP form replaced by a thank-you card.
 *   - While waiting (max 4 s on a laptop, 9 s on the real site) the body is hidden so guests never see the wrong couple flash.
 *     On the real site, if the design cannot be loaded, a plain "could not be loaded" page is shown (notLoaded), never the
 *     built-in CONFIG (another couple's names and gift account). Opened from a file or on localhost: the built-in CONFIG.
 * ===================================================================================== */
const SLUG = (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
const API = "/" + SLUG + "/api";
(() => {
  "use strict";
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  const wantDraft = q.get("draft") === "1";
  const DEFAULT_FILES = { envelope: "envelope.jpg", envelopeOpen: "envelope-open.jpg", seal: "envelope-seal.webp", couple: "couple.jpg", og: "og-envelope.jpg", music: "music.m4a" };
  // Google Fonts the Design tab offers (index.html already loads Cormorant Garamond, Jost and Amiri).
  const GFONTS = { "Playfair Display": "Playfair+Display:ital@0;1", "Great Vibes": "Great+Vibes", "Lora": "Lora:ital@0;1",
    "EB Garamond": "EB+Garamond:ital@0;1", "Cinzel": "Cinzel", "Parisienne": "Parisienne", "Montserrat": "Montserrat:wght@300;400;500",
    "Lato": "Lato:wght@300;400", "Poppins": "Poppins:wght@300;400;500", "Cairo": "Cairo:wght@400;600;700", "Aref Ruqaa": "Aref+Ruqaa:wght@400;700",
    "Noto Naskh Arabic": "Noto+Naskh+Arabic:wght@400;700", "Tajawal": "Tajawal:wght@400;700", "Reem Kufi": "Reem+Kufi:wght@400;700",
    "Lateef": "Lateef:wght@400;700", "Scheherazade New": "Scheherazade+New:wght@400;700", "Marhey": "Marhey:wght@400;700",
    "Dancing Script": "Dancing+Script:wght@400;600" };
  const VARS = { paper: "--paper", paper2: "--paper-2", gold: "--gold", goldD: "--gold-d", goldL: "--gold-l", ink: "--ink", inkSoft: "--ink-soft", serif: "--serif", sans: "--sans", arabic: "--arabic" };

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const merge = (into, from) => { if (!isObj(from)) return; for (const k of Object.keys(from)) { if (isObj(from[k]) && isObj(into[k])) merge(into[k], from[k]); else if (from[k] !== undefined && from[k] !== null) into[k] = from[k]; } };
  const fileOf = (u) => String(u || "").split(/[?#]/)[0].split("/").pop();
  const isDefault = (key, url) => !url || fileOf(url) === DEFAULT_FILES[key];

  const hold = document.createElement("style");
  hold.textContent = "body{visibility:hidden}";
  const release = () => hold.remove();

  const fonts = (list) => {   // list = font-family strings; downloads the first family of each if the Design tab offers it
    const want = new Set();
    list.forEach((f) => { const m = String(f || "").match(/^\s*["']?([^"',]+)["']?/); if (m && GFONTS[m[1].trim()]) want.add(GFONTS[m[1].trim()]); });
    if (!want.size) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?" + [...want].map((f) => "family=" + f).join("&") + "&display=swap";
    document.head.append(l);
  };

  const applyTheme = (theme) => {
    if (!isObj(theme)) return;
    for (const [k, v] of Object.entries(VARS)) if (typeof theme[k] === "string" && theme[k].trim()) root.style.setProperty(v, theme[k]);
    const n = Number(theme.baseSize);
    if (n && n !== 16) {
      root.style.fontSize = n + "px";
      document.querySelectorAll(".page .content").forEach((el) => { el.style.zoom = String(n / 16); });
    }
    if (theme.gold && theme.gold.toLowerCase() !== "#b8975a") {   // the names flourish has the gold written into the SVG
      document.querySelectorAll(".flourish path").forEach((p) => p.setAttribute("stroke", theme.gold));
      document.querySelectorAll(".flourish circle").forEach((c) => c.setAttribute("fill", theme.gold));
    }
  };

  /* ----- Per-page look, photo readability, timing -> one <style id="twp-overrides"> -----
   * Uses only the template's own selectors and CSS variables; style.css itself is never touched.
   * Every rule is written ONLY when a setting differs from the template, so a default design adds an
   * empty style element and the page stays pixel-identical. Numbers below are style.css's own literals. */
  const PAGE_SEL = { envelope: ".page-envelope", welcome: ".page-welcome", families: ".page-families", countdown: ".page-countdown", gift: ".page-gift", rsvp: ".page-rsvp" };
  const HEX = /^#[0-9a-fA-F]{3,8}$/, FONT = /^[\w\s",'.-]{1,200}$/;
  const lum = (hex) => {   // 0 (black) .. 1 (white); for picking a light or dark glow behind the text
    let h = String(hex).slice(1); if (h.length < 6) h = h.split("").map((c) => c + c).join("");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const clampN = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
  const s3 = (sec) => +sec.toFixed(3) + "s";

  const pageCSS = (key, p, themeInk) => {
    const S = PAGE_SEL[key], out = [], vars = [];
    const box = key === "envelope" ? `${S} .env-card` : `${S} .content`;                 // the block that holds the words
    const text = key === "envelope" ? `${S} .env-card, ${S} .tap-hint` : `${S} .content`;
    let ink = HEX.test(p.ink || "") ? p.ink : null, inkSoft = HEX.test(p.inkSoft || "") ? p.inkSoft : null;
    if (p.backdrop === "dark" && !ink) { ink = "#fbf6ec"; if (!inkSoft) inkSoft = "#eadfcb"; }   // dark panel: light words unless chosen
    const fontsSet = ["serif", "sans", "arabic"].filter((k) => FONT.test(p[k] || ""));
    fontsSet.forEach((k) => vars.push(`--${k}:${p[k]}`));
    if (ink) vars.push(`--ink:${ink}`);
    if (inkSoft) vars.push(`--ink-soft:${inkSoft}`);
    if (HEX.test(p.gold || "")) vars.push(`--gold:${p.gold}`, `--gold-d:${p.gold}`);
    if (vars.length) out.push(`${S}{${vars.join(";")}}`);
    // body sets colour and text font once for the whole page; re-state them so this page picks up its own values
    if (ink || p.sans) out.push(`${S}{color:var(--ink);font-family:var(--sans)}`);
    if (ink) {   // the few words style.css colours with a fixed value instead of var(--ink)
      if (key === "welcome") out.push(`${S} .names,${S} .bismillah{color:var(--ink)}`);
      if (key === "envelope") out.push(`${S} .tap-hint{color:var(--ink)}`);
    }
    if (HEX.test(p.gold || "") && key === "welcome") out.push(`${S} .flourish path{stroke:var(--gold)}${S} .flourish circle{fill:var(--gold)}`);
    const sc = clampN(p.scale, 0.8, key === "countdown" ? 1.2 : 1.4);   // same bounds as _lib/_invite.ts (older designs: clamped)
    if (sc && sc !== 1) out.push(`${box} > *{zoom:${sc}}`);
    if (p.shadow === "none") out.push(`${text}{text-shadow:none}`);
    else if (p.shadow === "soft" || p.shadow === "strong") {
      const g = lum(ink || themeInk || "#4a3f2f") < 0.5 ? "243,236,226" : "20,16,10";
      const sh = p.shadow === "soft" ? `0 0 10px rgba(${g},.9),0 0 3px rgba(${g},.8)`
        : `0 0 18px rgba(${g},1),0 0 8px rgba(${g},1),0 0 3px rgba(${g},1),0 0 1px rgba(${g},1)`;
      out.push(`${text}{text-shadow:${sh}}`);
      if (key === "welcome") out.push(`${S} .bismillah svg{filter:drop-shadow(0 0 ${p.shadow === "soft" ? 5 : 8}px rgba(${g},.95)) drop-shadow(0 0 2px rgba(${g},.9))}`);
    }
    if (p.backdrop === "light" || p.backdrop === "dark") {
      const bg = p.backdrop === "light" ? "rgba(255,251,244,.8)" : "rgba(28,22,15,.62)";
      out.push(`${box}{background:${bg};border-radius:18px;${key === "envelope" ? "" : "padding:22px 16px;"}-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}`);
    }
    return out.join("\n");
  };

  /* ----- "Fine-tune a line" (data.lines) -> rules after the page rules, so a line always wins over its page -----
   * Key -> s: the line's element(s) (colour, font, bold, italic, spacing, shadow, hide), fs: [selector, size in px in
   * style.css, size on phones under 361px if style.css changes it], c: other selector(s) for the colour (default s),
   * svg: the Bismillah calligraphy (size = width, shadow = drop-shadow). Same keys as LINE_LIST in _lib/_wedding.ts.
   * Every rule has !important: the template's own rules for some lines are more specific than .page-x .line. */
  const LINES = {
    "envelope.names": { s: ".page-envelope .card-names", fs: [[".page-envelope .card-names", 36]] },
    "envelope.date": { s: ".page-envelope .card-date", fs: [[".page-envelope .card-date", 12]] },
    "envelope.arabic": { s: ".page-envelope .card-ar", fs: [[".page-envelope .card-ar", 22]] },
    "envelope.tapHint": { s: ".page-envelope .tap-hint", fs: [[".page-envelope .tap-hint", 12], [".page-envelope .tap-hint [dir=\"rtl\"]", 15]] },
    "welcome.bismillah": { s: ".page-welcome .bismillah", svg: true },
    "welcome.verse": { s: ".page-welcome .ayah", fs: [[".page-welcome .ayah", 26]] },
    "welcome.names": { s: ".page-welcome .names", fs: [[".page-welcome .names", 68, 58]] },
    "welcome.invite": { s: ".page-welcome .invite-line", fs: [[".page-welcome .invite-line", 12.5]] },
    "welcome.dateEn": { s: ".page-welcome .date-en", fs: [[".page-welcome .date-en", 26]] },
    "welcome.dateAr": { s: ".page-welcome .date-ar", fs: [[".page-welcome .date-ar", 22]] },
    "welcome.time": { s: ".page-welcome .time-line", fs: [[".page-welcome .time-line", 22]] },
    "families.leadAr": { s: ".page-families .ar-lead", fs: [[".page-families .ar-lead", 32]] },
    "families.fathersAr": { s: ".page-families .parents", fs: [[".page-families .parents", 24], [".page-families .parents .and", 22]] },
    "families.inviteAr": { s: ".page-families .ar-body", fs: [[".page-families .ar-body", 22]] },
    "families.namesAr": { s: ".page-families .ar-names", fs: [[".page-families .ar-names", 34]] },
    "families.leadEn": { s: ".page-families .block-en .label", fs: [[".page-families .block-en .label", 12]] },
    "families.fathersEn": { s: ".page-families .parents-en", fs: [[".page-families .parents-en", 25]] },
    "families.inviteEn": { s: ".page-families .en-body", fs: [[".page-families .en-body", 21]] },
    "families.namesEn": { s: ".page-families .en-names", fs: [[".page-families .en-names", 44]] },
    "countdown.small": { s: ".page-countdown .label", fs: [[".page-countdown .label", 12]] },
    "countdown.titles": { s: ".page-countdown .heading,.page-countdown .ar-sub", fs: [[".page-countdown .heading", 38, 34], [".page-countdown .ar-sub", 22]] },
    "countdown.numbers": { s: ".page-countdown .num,.page-countdown .colon", c: ".page-countdown .num", fs: [[".page-countdown .num", 54, 44], [".page-countdown .colon", 40]] },
    "countdown.units": { s: ".page-countdown .unit-label", fs: [[".page-countdown .unit-label", 14]] },
    "countdown.dateTime": { s: ".page-countdown .cd-time", fs: [[".page-countdown .cd-time", 20]] },
    "countdown.venue": { s: ".page-countdown .venue", fs: [[".page-countdown .venue", 40]] },
    "countdown.city": { s: ".page-countdown .venue-city", fs: [[".page-countdown .venue-city", 15]] },
    "countdown.venueAr": { s: ".page-countdown .venue-ar", fs: [[".page-countdown .venue-ar", 20]] },
    "countdown.maps": { s: ".page-countdown #mapsLink", fs: [[".page-countdown #mapsLink", 15], [".page-countdown #mapsLink [dir=\"rtl\"]", 16]] },
    "gift.small": { s: ".page-gift .label", fs: [[".page-gift .label", 12]] },
    "gift.heading": { s: ".page-gift .heading", fs: [[".page-gift .heading", 38, 34]] },
    "gift.textEn": { s: ".page-gift .gift-en", fs: [[".page-gift .gift-en", 13]] },
    "gift.textAr": { s: ".page-gift .gift-ar", fs: [[".page-gift .gift-ar", 19]] },
    "gift.accountLabel": { s: ".page-gift .account .lbl", fs: [[".page-gift .account .lbl", 11.5], [".page-gift .account .lbl[dir=\"rtl\"]", 16]] },
    "gift.number": { s: ".page-gift .acct-num", fs: [[".page-gift .acct-num", 34]] },
    "gift.copy": { s: ".page-gift #copyBtn", fs: [[".page-gift #copyBtn", 14], [".page-gift #copyBtn [dir=\"rtl\"]", 16]] },
    "rsvp.heading": { s: ".page-rsvp .heading", fs: [[".page-rsvp .heading", 54]] },
    "rsvp.headingAr": { s: ".page-rsvp .ar-title", fs: [[".page-rsvp .ar-title", 28]] },
    "rsvp.replyBy": { s: ".page-rsvp .replyby", fs: [[".page-rsvp .replyby", 21]] },
    "rsvp.replyByAr": { s: ".page-rsvp .replyby-ar", fs: [[".page-rsvp .replyby-ar", 18]] },
    "rsvp.guest": { s: ".page-rsvp .guest-name,.page-rsvp .seats", fs: [[".page-rsvp .guest-name", 32], [".page-rsvp .seats", 30]] },
    "rsvp.kidsAr": { s: ".page-rsvp .kids-ar", fs: [[".page-rsvp .kids-ar", 21]] },
    "rsvp.kidsEn": { s: ".page-rsvp .kids-en", fs: [[".page-rsvp .kids-en", 18]] },
    "rsvp.questions": { s: ".page-rsvp .bi", fs: [[".page-rsvp .bi", 16], [".page-rsvp .bi [dir=\"rtl\"]", 18]] },
    "rsvp.buttons": { s: ".page-rsvp .choice button,.page-rsvp .btn-gold", c: ".page-rsvp .choice button:not([aria-pressed=\"true\"]),.page-rsvp .btn-gold",
      fs: [[".page-rsvp .choice button", 18], [".page-rsvp .choice button [dir=\"rtl\"]", 16], [".page-rsvp .btn-gold", 16], [".page-rsvp .btn-gold [dir=\"rtl\"]", 16]] },
    "rsvp.monogram": { s: ".page-rsvp .foot-mono", fs: [[".page-rsvp .foot-mono", 30]] },
    "rsvp.footDate": { s: ".page-rsvp .foot-date", fs: [[".page-rsvp .foot-date", 11]] },
  };
  window.TWPLines = LINES;   // read by the Design tab (admin.html) for the live sample next to the controls
  const px = (n) => +n.toFixed(2) + "px";
  const lineCSS = (key, L, pageInk, themeInk) => {
    const D = LINES[key]; if (!D || !isObj(L)) return "";
    const out = [], decl = [];
    if (L.hidden === true) return `${D.s}{display:none!important}`;
    const color = HEX.test(L.color || "") ? L.color : null;
    if (color) out.push(`${D.c || D.s}{color:${color}!important}`);
    if (!D.svg) {
      if (FONT.test(L.font || "")) decl.push(`font-family:${L.font}!important`);
      if (L.weight === "bold" || L.weight === "normal") decl.push(`font-weight:${L.weight === "bold" ? 700 : 400}!important`);
      if (typeof L.italic === "boolean") decl.push(`font-style:${L.italic ? "italic" : "normal"}!important`);
      const ls = typeof L.letterSpacing === "number" ? clampN(L.letterSpacing, -0.05, 0.3) : null;
      if (ls !== null) decl.push(`letter-spacing:${+ls.toFixed(3)}em!important`);
    }
    if (L.shadow === "none") { if (D.svg) out.push(`${D.s} svg{filter:none!important}`); else decl.push("text-shadow:none!important"); }
    else if (L.shadow === "soft" || L.shadow === "strong") {
      const g = lum(color || pageInk || themeInk || "#4a3f2f") < 0.5 ? "243,236,226" : "20,16,10";
      if (D.svg) out.push(`${D.s} svg{filter:drop-shadow(0 0 ${L.shadow === "soft" ? 5 : 8}px rgba(${g},.95)) drop-shadow(0 0 2px rgba(${g},.9))!important}`);
      else decl.push(`text-shadow:${L.shadow === "soft" ? `0 0 10px rgba(${g},.9),0 0 3px rgba(${g},.8)`
        : `0 0 18px rgba(${g},1),0 0 8px rgba(${g},1),0 0 3px rgba(${g},1),0 0 1px rgba(${g},1)`}!important`);
    }
    const k = typeof L.size === "number" ? clampN(L.size, 0.6, 1.8) : null;
    if (k !== null && k !== 1) {
      if (D.svg) out.push(`${D.s}{width:min(${+Math.min(100, 96 * k).toFixed(1)}%,${px(430 * k)})!important}`);
      else (D.fs || []).forEach(([sel, base, small]) => {
        out.push(`${sel}{font-size:${px(base * k)}!important}`);
        if (small) out.push(`@media (max-width: 360px){${sel}{font-size:${px(small * k)}!important}}`);
      });
    }
    if (decl.length) out.unshift(`${D.s}{${decl.join(";")}}`);
    return out.join("\n");
  };

  const overridesCSS = (data) => {
    const css = [];
    const themeInk = isObj(data.theme) && HEX.test(data.theme.ink || "") ? data.theme.ink : null;
    if (isObj(data.pages)) for (const key of Object.keys(PAGE_SEL)) if (isObj(data.pages[key])) { const c = pageCSS(key, data.pages[key], themeInk); if (c) css.push(c); }
    if (isObj(data.lines)) for (const key of Object.keys(data.lines)) {   // after the page rules: a line wins over its page
      const pg = isObj(data.pages) && isObj(data.pages[key.split(".")[0]]) ? data.pages[key.split(".")[0]] : {};
      const pageInk = HEX.test(pg.ink || "") ? pg.ink : pg.backdrop === "dark" ? "#fbf6ec" : null;
      const c = lineCSS(key, data.lines[key], pageInk, themeInk); if (c) css.push(c);
    }
    const r = isObj(data.readability) ? data.readability : {};
    const veil = clampN(r.veil, 0, 100), blur = clampN(r.photoBlur, 0, 6);
    if (veil !== null && veil !== 57.6) css.push(`.page-welcome .photo-veil{background:rgba(234,221,210,${+(veil / 100).toFixed(3)})}`);
    const wp = isObj(data.pages) && isObj(data.pages.welcome) ? data.pages.welcome : {};
    if (veil !== null && veil < 30 && !wp.shadow && wp.backdrop !== "light" && wp.backdrop !== "dark") {   // little veil, no shadow chosen: a glow behind the words (Readability card says so)
      const g = lum(HEX.test(wp.ink || "") ? wp.ink : themeInk || "#4a3f2f") < 0.5 ? "243,236,226" : "20,16,10";
      const halo = [1, 2, 2, 3, 3, 4, 6, 6, 9, 14, 20].map((r) => `0 0 ${r}px rgba(${g},1)`).join(",");   // layered: dense right around each letter
      const haze = +(0.5 * (30 - veil) / 30).toFixed(3);   // plus a feathered soft light behind the words block: 0.5 at no veil, none at 30
      css.push(`.page-welcome .content{text-shadow:${halo}}`,
        g === "243,236,226" ? `.page-welcome .content{background:rgba(${g},${haze});border-radius:48px;box-shadow:0 0 36px 24px rgba(${g},${haze})}` : "",
        `.page-welcome .bismillah svg{filter:drop-shadow(0 0 8px rgba(${g},.95)) drop-shadow(0 0 2px rgba(${g},.9))}`);
    }
    if (blur !== null && blur !== 2.5) css.push(`.page-welcome .couple-photo{filter:${blur ? `blur(${blur}px)` : "none"}}`);
    const t = isObj(data.timing) ? data.timing : {};
    const ms = clampN(t.envelopeOpenMs, 800, 5000);
    if (ms !== null && ms !== 2300) {   // the envelope's own transitions, stretched to end when the page scrolls on
      const f = ms / 2300;
      css.push(`.env-closed{transition:opacity ${s3(.35 * f)} ease ${s3(.15 * f)}}`,
        `.env-flap{transition:transform ${s3(1.35 * f)} cubic-bezier(.45,.05,.25,1) ${s3(.45 * f)}}`,
        `.flap-front{transition:filter ${s3(1.35 * f)} ease ${s3(.45 * f)}}`,
        `.env-glow{transition:opacity ${s3(1.1 * f)} ease ${s3(1.05 * f)}}`,
        `.env-card{transition:opacity ${s3(.7 * f)} ease ${s3(1.15 * f)},transform ${s3(1.25 * f)} var(--ease) ${s3(1.1 * f)}}`,
        `.is-open .env-wax{animation:waxLift ${s3(.8 * f)} var(--ease) forwards}`);
    }
    const sp = clampN(t.revealSpeed, 0.5, 2);
    if (sp !== null && sp !== 1) {   // lines fading in: durations and the inline --d delays, divided by the speed
      const k = +(1 / sp).toFixed(4);
      css.push(`.reveal{transition:opacity ${s3(k)} var(--ease) calc(var(--d, 0s) * ${k}),transform ${s3(k)} var(--ease) calc(var(--d, 0s) * ${k})}`,
        `.names .ch{transition-duration:${s3(.7 * k)};transition-delay:calc((var(--i) * 70ms + var(--base, 0ms)) * ${k})}`,
        `.names .amp{transition:opacity ${s3(.8 * k)} var(--ease) ${s3(.7 * k)},transform ${s3(.8 * k)} var(--ease) ${s3(.7 * k)}}`,
        `.flourish path{transition:stroke-dashoffset ${s3(1.8 * k)} var(--ease) ${s3(1.4 * k)}}`,
        `.flourish circle{transition:opacity ${s3(.6 * k)} ${s3(2.6 * k)}}`);
    }
    return css.join("\n");
  };

  const applyOverrides = (data) => {
    const st = document.createElement("style");
    st.id = "twp-overrides";
    st.textContent = overridesCSS(data);
    document.head.append(st);   // after style.css, so equal selectors win
    const list = isObj(data.theme) ? [data.theme.serif, data.theme.sans, data.theme.arabic] : [];
    if (isObj(data.pages)) Object.values(data.pages).forEach((p) => { if (isObj(p)) list.push(p.serif, p.sans, p.arabic); });
    if (isObj(data.lines)) Object.values(data.lines).forEach((l) => { if (isObj(l)) list.push(l.font); });
    fonts(list);
    const ms = isObj(data.timing) ? clampN(data.timing.envelopeOpenMs, 800, 5000) : null;
    if (ms !== null) CONFIG.timing = { envelopeOpenMs: ms };   // read by the one edited line in runTemplate
  };

  const applyAssets = (assets) => {
    if (!isObj(assets)) return;
    const bg = (sel, url) => document.querySelectorAll(sel).forEach((el) => { el.style.backgroundImage = `url("${url}")`; });
    if (!isDefault("envelope", assets.envelope)) bg(".env-closed", assets.envelope);
    if (!isDefault("envelopeOpen", assets.envelopeOpen)) bg(".env-open, .flap-front", assets.envelopeOpen);
    if (!isDefault("seal", assets.seal)) bg(".env-wax", assets.seal);
    if (!isDefault("couple", assets.couple)) document.querySelectorAll("img.couple-photo").forEach((img) => { img.src = assets.couple; });
    if (!isDefault("og", assets.og)) {
      const abs = new URL(assets.og, location.href).href;
      document.querySelectorAll('meta[property="og:image"]').forEach((m) => m.setAttribute("content", abs));
      document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((m) => m.setAttribute("href", abs));
    }
    if (!isDefault("music", assets.music)) CONFIG.music.src = assets.music;
  };

  const applyShow = (show) => {   // the Design tab's "What to show" switches; false = hidden, anything else = as the template
    if (!isObj(show)) return;
    const hide = (sel) => document.querySelectorAll(sel).forEach((el) => { el.style.display = "none"; });
    if (show.kidsNote === false) hide(".kids-note");
    if (show.bismillah === false) hide(".bismillah, .ayah");
    if (show.gift === false) {
      const g = document.getElementById("gift");
      if (g) { const d = g.previousElementSibling; if (d && d.classList.contains("divider")) d.style.display = "none"; g.style.display = "none"; }
    }
    if (show.countdown === false) {   // the numbers with their "Countdown / Until the big day" title; the date line stays
      const c = document.querySelector("#countdown .clock");
      if (c) { let p = c.previousElementSibling; for (let i = 0; i < 2 && p; i++, p = p.previousElementSibling) p.style.display = "none"; c.style.display = "none"; }
      const done = document.getElementById("cdDone"); if (done) { done.style.display = "none"; }
    }
    if (show.maps === false) hide("#mapsLink");
    if (show.parents === false) hide("#families .ar-lead, #families .parents, #families .block-en .label, #families .parents-en");
    if (show.timeLine === false) hide("#welcome .time-line");
    if (show.arabic === false) {   // CSS, so Arabic lines added later (thank-you card, answers) are hidden too
      const st = document.createElement("style");
      st.id = "twp-show";
      st.textContent = '[dir="rtl"]:not(html):not(body){display:none!important}';
      document.head.append(st);
    }
  };

  const applyText = () => {   // the <head> lines the original code does not fill
    const c = CONFIG.couple, d = CONFIG.date, v = CONFIG.venue;
    const set = (sel, val) => document.querySelectorAll(sel).forEach((m) => m.setAttribute("content", val));
    set('meta[name="description"]', `You are invited to the wedding of ${c.groom} & ${c.bride}, ${d.en}, ${v.name}, ${String(v.city).split(",")[0]}.`);
    set('meta[property="og:title"]', `${c.groom} & ${c.bride} · You're invited`);
    set('meta[property="og:description"]', `${d.en} · ${v.name}. Tap to open your invitation.`);
  };

  const archived = () => {
    const box = document.querySelector("#rsvp .content");
    if (!box) return;
    const css = document.createElement("style");
    css.textContent = "#rsvpLoading,#rsvpBox,#rsvpNoLink,#rsvp .replyby,#rsvp .replyby-ar{display:none!important}";
    document.head.append(css);
    const card = document.createElement("div");
    card.className = "reserved reveal in";
    card.style.marginTop = "28px";
    card.innerHTML = '<p class="guest-name">Thank you for celebrating with us</p>' +
      '<p class="kids-ar" dir="rtl" lang="ar">شكراً لمشاركتكم فرحتنا</p>';
    box.append(card);
  };

  // Full-size draft (the Design tab's "Open full size"): a ribbon so nobody mistakes it for what guests see.
  // Not inside the Design tab's own preview frame (that one is labelled there), never on a guest's link.
  const draftRibbon = () => {
    if (!wantDraft || window.parent !== window) return;
    const r = document.createElement("div");
    r.setAttribute("role", "status");
    r.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#8a5a00;color:#fff;font:600 14px/1.3 -apple-system,Helvetica,Arial,sans-serif;text-align:center;padding:8px 10px;padding-top:max(8px,env(safe-area-inset-top));pointer-events:none";
    r.textContent = "Draft preview: guests do not see this until you tap Publish.";
    document.body.append(r);
  };

  // On the real site, a wedding whose design cannot be loaded must NOT fall back to the built-in CONFIG
  // (Karim & Maya's names and gift account number). Only a laptop (localhost) keeps that demo fallback.
  const isLocal = !/^https?:$/.test(location.protocol) || !SLUG || SLUG.endsWith(".html") || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const notLoaded = () => {
    release();
    document.documentElement.classList.remove("locked");
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3ece2;color:#4a3f2f;font-family:Georgia,serif;text-align:center;padding:24px;box-sizing:border-box";
    const box = document.createElement("div");
    box.style.cssText = "position:relative;z-index:2147483646;opacity:1;visibility:visible;max-width:420px";
    const p1 = document.createElement("p"); p1.style.cssText = "font-size:20px;line-height:1.5;margin:0 0 6px";
    p1.textContent = "This invitation could not be loaded. Please try again in a moment.";
    const p2 = document.createElement("p"); p2.dir = "rtl"; p2.lang = "ar"; p2.style.cssText = "font-size:18px;margin:0 0 20px";
    p2.textContent = "تعذّر فتح الدعوة. الرجاء المحاولة بعد قليل.";
    const b = document.createElement("button"); b.type = "button"; b.textContent = "Try again";
    b.style.cssText = "font:600 17px -apple-system,Helvetica,Arial,sans-serif;min-height:48px;padding:10px 22px;border-radius:24px;border:2px solid #8b6a34;background:#fff;color:#4a3f2f";
    b.onclick = () => location.reload();
    box.append(p1, p2, b); document.body.append(box);
  };

  /* ----- After the template has run: layout fixes that need the real page (measured, so written as inline styles) -----
   * Only for designs that need them; Karim & Maya's own design meets none of the conditions, so it stays pixel-identical.
   *  1. Names (page 2): runTemplate splits each name into one box per letter, so a long name broke inside a word and the
   *     spaces between words vanished. When a name has a space (or a word is wider than the page), each word's letters go into
   *     one box that never breaks (the letters keep --i/--base, so the letter-by-letter reveal is unchanged), the space keeps
   *     its width, and the names get smaller (down to 55%) until the longest word fits. Arabic names: one box per word (letters
 *     only join inside one run of text) and the words right to left; they appear word by word instead of letter by letter.
   *  2. Countdown: with a big base size or Size, the four numbers (each at least 66 px wide in style.css) ran off both sides
   *     of a phone. The clock is zoomed down just enough to fit.
   *  3. Small words: with base size under 16, Size under 100% or a line made smaller, no words go under 11 px on screen.
   *  4. The round music button steps aside (its "dodge" look) when the small line under Send reaches it. */
  const zoomOf = (e) => { let z = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const v = parseFloat(getComputedStyle(n).zoom); if (v && isFinite(v)) z *= v; } return z; };
  const sizesChanged = (data) => {
    if (!isObj(data)) return false;
    const n = isObj(data.theme) ? Number(data.theme.baseSize) : 16;
    if (n && n !== 16) return true;
    if (isObj(data.pages) && Object.values(data.pages).some((p) => isObj(p) && Number(p.scale) && Number(p.scale) !== 1)) return true;
    return isObj(data.lines) && Object.values(data.lines).some((l) => isObj(l) && typeof l.size === "number" && l.size < 1);
  };

  const AR = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const fitNames = () => {
    const names = document.getElementById("names"); if (!names) return;
    const lines = [...names.querySelectorAll(".name-line")];
    const wrapped = (l) => { const t = [...l.querySelectorAll(".ch")].map((c) => Math.round(c.getBoundingClientRect().top)); return t.length > 1 && Math.max(...t) - Math.min(...t) > 4; };
    if (!names.__twpWords) {
      if (!lines.some((l) => /\S\s+\S/.test(l.textContent.trim()) || AR.test(l.textContent) || wrapped(l))) return;
      names.__twpWords = true;
      lines.forEach((line) => {
        let w = null;
        [...line.children].filter((c) => c.classList.contains("ch")).forEach((ch) => {
          if (!ch.textContent.trim()) { ch.classList.add("twp-sp"); ch.style.whiteSpace = "pre"; w = null; return; }
          if (!w) { w = document.createElement("span"); w.className = "twp-word"; w.style.cssText = "display:inline-block;white-space:nowrap"; line.insertBefore(w, ch); }
          w.append(ch);
        });
        // Arabic letters only join (and read right to left) inside one run of text: one box per word, words right to left
        if (AR.test(line.textContent)) {
          line.dir = "rtl";
          line.querySelectorAll(".twp-word").forEach((wd, i) => {
            const chs = [...wd.querySelectorAll(".ch")]; if (!AR.test(wd.textContent) || chs.length < 2) return;
            chs[0].textContent = chs.map((c) => c.textContent).join(""); chs[0].style.setProperty("--i", String(i * 3));
            chs.slice(1).forEach((c) => c.remove());
          });
        }
      });
    }
    names.style.removeProperty("font-size");
    names.querySelectorAll(".twp-sp").forEach((sp) => { sp.style.marginRight = ""; });
    const avail = names.getBoundingClientRect().width;
    const words = [...names.querySelectorAll(".twp-word")];
    const widest = () => Math.max(0, ...words.map((w) => w.getBoundingClientRect().width));
    const base = parseFloat(getComputedStyle(names).fontSize);
    for (let k = 0.95; avail && base && widest() > avail + 0.5 && k >= 0.549; k -= 0.05) names.style.setProperty("font-size", px(base * k), "important");
    // a space at the end of a line still has its width: pull it back so the line stays centred
    names.querySelectorAll(".twp-sp").forEach((sp) => {
      const a = sp.previousElementSibling, b = sp.nextElementSibling;
      if (a && b && b.getBoundingClientRect().top > a.getBoundingClientRect().top + 4) sp.style.marginRight = "-" + getComputedStyle(sp).width;
    });
  };

  const fitClock = () => {
    const clock = document.querySelector(".page-countdown .clock");
    if (!clock || !clock.getClientRects().length) return;
    clock.style.removeProperty("zoom");
    const host = clock.parentElement, hs = getComputedStyle(host), hr = host.getBoundingClientRect(), hz = zoomOf(host);
    const availL = hr.left + parseFloat(hs.paddingLeft) * hz, availR = hr.right - parseFloat(hs.paddingRight) * hz;
    const kids = [...clock.children].filter((c) => c.getClientRects().length).map((c) => c.getBoundingClientRect());
    if (!kids.length) return;
    const need = Math.max(...kids.map((r) => r.right)) - Math.min(...kids.map((r) => r.left));
    const room = Math.min(availR, window.innerWidth) - Math.max(availL, 0);
    if (need <= room + 0.5) return;
    const own = parseFloat(getComputedStyle(clock).zoom) || 1;
    clock.style.zoom = String(+(own * (room / need) * 0.99).toFixed(4));
  };

  const SKIP_FLOOR = ".names, svg, select, option, textarea, script, style";
  const floorSmall = (scope) => {
    const tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const els = new Set(); let n;
    while ((n = tw.nextNode())) { const e = n.parentElement; if (n.nodeValue.trim() && e && !e.closest(SKIP_FLOOR)) els.add(e); }
    els.forEach((e) => {
      const z = zoomOf(e), fs = parseFloat(getComputedStyle(e).fontSize);
      if (fs && z && fs * z < 10.95) e.style.setProperty("font-size", px(11 / z + 0.01), "important");
    });
  };

  const musicDodge = () => {   // the template's own dodge list (runTemplate section 8) cannot be edited; this adds the small line under Send
    const btn = document.querySelector(".music-btn"), hints = document.querySelectorAll("#rsvp .overwrite-hint");
    if (!btn || !hints.length || !("IntersectionObserver" in window)) return;
    const TPL = "#btnYes, #btnNo, #sendBtn, #copyBtn, #mapsLink, #nameFields, #note, #guestCount, .confirm";
    const inZone = (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom > innerHeight * 0.82 && r.top < innerHeight; };
    let under = false;
    const sync = () => { if (under && !btn.classList.contains("dodge")) btn.classList.add("dodge"); };
    new IntersectionObserver((es) => {
      under = es.some((e) => e.isIntersecting) || [...hints].some(inZone);
      if (!under && btn.classList.contains("dodge") && ![...document.querySelectorAll(TPL)].some(inZone)) btn.classList.remove("dodge");
      sync();
    }, { rootMargin: "-82% 0px 0px 0px" }).observe(hints[0]);
    new MutationObserver(sync).observe(btn, { attributes: true, attributeFilter: ["class"] });
  };

  const afterTemplate = (data) => {
    if (!isObj(data)) return;
    const sized = sizesChanged(data);
    const all = () => {
      try { fitNames(); } catch (e) { console.warn("names fit:", e); }
      if (sized) {
        try { fitClock(); } catch (e) { console.warn("countdown fit:", e); }
        try { document.querySelectorAll("section.page").forEach(floorSmall); } catch (e) { console.warn("small words:", e); }
      }
    };
    all();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(all);
    let t = 0;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(all, 120); });
    const rsvp = document.getElementById("rsvp");
    if (sized && rsvp && "MutationObserver" in window) {   // the answer form, name fields and thank-you card are filled in later
      let q = 0;
      new MutationObserver(() => { clearTimeout(q); q = setTimeout(() => floorSmall(rsvp), 30); }).observe(rsvp, { childList: true, subtree: true });
    }
    try { musicDodge(); } catch (e) { console.warn("music dodge:", e); }
  };

  const run = (data) => {
    if (!(data && isObj(data)) && !isLocal) { notLoaded(); return; }
    try { draftRibbon(); } catch (_) {}
    try {
      if (data && isObj(data)) {
        if (data.mode === "slides" && Array.isArray(data.slides) && data.slides.length) {
          const s = document.createElement("script");
          s.src = "slides.js";
          s.onload = () => { release(); window.TWPSlides.start(data, { CONFIG, API, SLUG }); };
          s.onerror = () => { release(); runTemplate(); };
          document.head.append(s);
          return;
        }
        merge(CONFIG, data.config);
        applyTheme(data.theme);
        applyOverrides(data);
        applyAssets(data.assets);
        applyShow(data.show);
        applyText();
        if (data.status === "archived") archived();
      }
    } catch (e) { console.warn("Wedding loader:", e); }
    release();
    runTemplate();
    try { afterTemplate(data); } catch (e) { console.warn("Wedding loader (after):", e); }
  };

  // Opened from a file (double-click): no website to ask, use the built-in CONFIG.
  if (!/^https?:$/.test(location.protocol) || !SLUG || SLUG.endsWith(".html")) { setTimeout(() => run(null)); return; }

  document.head.append(hold);
  let done = false;
  const finish = (data) => { if (done) return; done = true; run(data); };
  setTimeout(() => finish(null), isLocal ? 4000 : 9000);   // never leave a guest staring at a blank page (real site: a plain 'could not be loaded' page, never another couple)

  const fetchInvite = () => {
    fetch(`${API}/invite${wantDraft ? "?draft=1" : ""}`, { credentials: "same-origin", headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null)).then(finish, () => finish(null));
  };

  if (wantDraft && window.parent !== window) {
    // Design preview: the admin page sends the draft it is editing (even unsaved).
    let answered = false;
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== "twp-invite" || answered) return;
      answered = true; finish(e.data.invite);
    });
    try { window.parent.postMessage({ type: "twp-ready", slug: SLUG }, location.origin); } catch (_) {}
    setTimeout(() => { if (!answered) { answered = true; fetchInvite(); } }, 800);
  } else fetchInvite();
})();
/* ======================== end of loader; original invite below ======================== */

const runTemplate = () => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), CONFIG);

  /* ---------- 1. Fill text from CONFIG ---------- */
  document.querySelectorAll("[data-c]").forEach((el) => {
    const v = get(el.dataset.c);
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll(".seal .m1").forEach((el) => (el.textContent = CONFIG.couple.groom.charAt(0)));
  document.querySelectorAll(".seal .m2").forEach((el) => (el.textContent = CONFIG.couple.bride.charAt(0)));
  document.title = `${CONFIG.couple.groom} & ${CONFIG.couple.bride}`;
  $("mapsLink").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(CONFIG.venue.mapsQuery);
  $("acctNum").textContent = CONFIG.gift.accountNumber;

  // Names on page 2, split into letters for the reveal flourish.
  const names = $("names");
  names.setAttribute("aria-label", `${CONFIG.couple.groom} & ${CONFIG.couple.bride}`);
  let offset = 0;
  names.querySelectorAll("[data-split]").forEach((line, li) => {
    const word = get(line.dataset.split) || "";
    line.setAttribute("aria-hidden", "true");
    [...word].forEach((ch, i) => {
      const s = document.createElement("span");
      s.className = "ch";
      s.textContent = ch;
      s.style.setProperty("--i", i);
      s.style.setProperty("--base", `${offset}ms`);
      line.append(s);
    });
    offset = li === 0 ? 900 : offset; // bride's name starts after the ampersand
  });
  names.querySelector(".amp").setAttribute("aria-hidden", "true");

  /* ---------- 2. Envelope ---------- */
  const env = $("envelope");
  const seal = $("seal");
  let opened = false;

  const unlock = () => root.classList.remove("locked");
  const openEnvelope = ({ instant = false } = {}) => {
    if (opened) return;
    opened = true;
    if (instant || reduceMotion) env.classList.add("instant");
    env.classList.add("is-open");
    seal.setAttribute("aria-expanded", "true");
    seal.tabIndex = -1;
    if (instant) { unlock(); return; }
    const wait = reduceMotion ? 50 : (CONFIG.timing && CONFIG.timing.envelopeOpenMs) || 2300;
    setTimeout(() => {
      unlock();
      $("welcome").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }, wait);
  };
  seal.addEventListener("click", () => openEnvelope());

  // ?open=1 or a #section hash skips straight to the opened state.
  const hashTarget = location.hash && document.querySelector(location.hash);
  if (q.get("open") === "1" || (hashTarget && hashTarget !== env)) {
    openEnvelope({ instant: true });
    if (hashTarget) {
      const jump = () => hashTarget.scrollIntoView({ behavior: "instant", block: "start" });
      requestAnimationFrame(jump);
      if (document.fonts) document.fonts.ready.then(jump);
    }
  } else {
    // Make sure we start at the top while locked (mobile browsers restore scroll).
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
  }

  /* ---------- 3. Reveal on scroll ---------- */
  const revealEls = document.querySelectorAll(".reveal, #names, .flourish");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    revealEls.forEach((el) => io.observe(el));
    // Safety net: if an observer callback is missed (fast jumps, elements un-hidden later), reveal on scroll.
    let pending = false;
    const sweep = () => {
      pending = false;
      const vh = window.innerHeight;
      revealEls.forEach((el) => {
        if (el.classList.contains("in")) return;
        const r = el.getBoundingClientRect();
        if (r.height && r.top < vh * 0.92 && r.bottom > 0) { el.classList.add("in"); io.unobserve(el); }
      });
    };
    const queue = () => { if (!pending) { pending = true; requestAnimationFrame(sweep); } };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    window.__revealSweep = queue;
  }

  /* ---------- 4. Countdown ---------- */
  const target = new Date(CONFIG.date.iso).getTime();
  const pad = (n) => String(n).padStart(2, "0");
  const tick = () => {
    let diff = Math.max(0, target - Date.now());
    const d = Math.floor(diff / 86400000); diff -= d * 86400000;
    const h = Math.floor(diff / 3600000); diff -= h * 3600000;
    const m = Math.floor(diff / 60000); diff -= m * 60000;
    const s = Math.floor(diff / 1000);
    $("cd-d").textContent = pad(d);
    $("cd-h").textContent = pad(h);
    $("cd-m").textContent = pad(m);
    $("cd-s").textContent = pad(s);
    if (target - Date.now() <= 0) { $("cdDone").hidden = false; return false; }
    return true;
  };
  if (tick()) { const iv = setInterval(() => { if (!tick()) clearInterval(iv); }, 1000); }

  /* ---------- 5. Gift: copy account number ---------- */
  $("copyBtn").addEventListener("click", async () => {
    const text = CONFIG.gift.accountNumber.replace(/\s+/g, "");
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.append(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
      ta.remove();
    }
    $("copyLabel").textContent = ok ? "Copied" : "Copy failed";
    $("copyLabelAr").textContent = ok ? "تم النسخ" : "تعذّر النسخ";
    setTimeout(() => { $("copyLabel").textContent = "Tap to copy"; $("copyLabelAr").textContent = "انسخ الرقم"; }, 2200);
  });

  /* ---------- 6. RSVP (see wedding/CONTRACT.md) ---------- */
  const t = q.get("t");
  const isLocal = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  let demo = q.get("demo") === "1";

  const showNoLink = () => { $("rsvpLoading").hidden = true; $("rsvpNoLink").hidden = false; $("rsvpNoLink").classList.add("in"); };

  const loadGuest = async () => {
    if (demo) return structuredClone(CONFIG.demoGuest);
    if (!t) return null;
    try {
      const r = await fetch(`${API}/guest?t=${encodeURIComponent(t)}${preview ? "&preview=1" : ""}`, { headers: { accept: "application/json" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (err) {
      if (isLocal) { demo = true; return structuredClone(CONFIG.demoGuest); }
      return null;
    }
  };

  const fmtAt = (iso) => {
    try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }); }
    catch (_) { return ""; }
  };

  const initRsvp = (g) => {
    if (!g) return showNoLink();
    $("rsvpLoading").hidden = true;
    $("rsvpBox").hidden = false;
    $("guestName").textContent = g.name;
    $("seatCount").textContent = g.max_guests;

    const sel = $("guestCount");
    const namesBox = $("nameFields");
    for (let i = 1; i <= g.max_guests; i++) sel.append(new Option(String(i), String(i)));
    sel.value = String(g.max_guests);

    const paintNames = (vals) => {
      const keep = [...namesBox.querySelectorAll("input")].map((i) => i.value);
      namesBox.innerHTML = "";
      for (let i = 0; i < Number(sel.value); i++) {
        const id = `gname${i}`;
        const lab = document.createElement("label");
        lab.htmlFor = id;
        const arN = String(i + 1).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
        lab.textContent = `Full name of guest ${i + 1}`;
        const inp = document.createElement("input");
        inp.type = "text"; inp.id = id; inp.maxLength = 80; inp.autocomplete = i === 0 ? "name" : "off";
        inp.placeholder = `Full name of guest ${i + 1} / الاسم الكامل للضيف ${arN}`;
        inp.required = true; // names are required when accepting
        inp.addEventListener("input", () => inp.classList.remove("missing"));
        inp.value = (vals && vals[i]) ?? keep[i] ?? "";
        namesBox.append(lab, inp);
      }
    };
    sel.addEventListener("change", () => paintNames());

    let attending = null;
    const paint = () => {
      $("btnYes").setAttribute("aria-pressed", String(attending === true));
      $("btnNo").setAttribute("aria-pressed", String(attending === false));
      $("partyBox").hidden = attending !== true;
    };
    $("btnYes").addEventListener("click", () => {
      attending = true; $("formErr").hidden = true; paint();
      // bring the name fields that just appeared into view
      $("partyBox").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    });
    // Required names: highlight the empty fields and point at the first one.
    const NAMES_MSG = "Please write the name of everyone coming · الرجاء كتابة أسماء جميع الحضور";
    const flagMissingNames = () => {
      const empty = [...namesBox.querySelectorAll("input")].filter((i) => !i.value.trim());
      empty.forEach((i) => i.classList.add("missing"));
      $("namesErr").textContent = NAMES_MSG; // shown right above the name fields
      $("namesErr").hidden = false;
      const first = empty[0] || namesBox.querySelector("input");
      if (first) {
        first.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        first.focus({ preventScroll: true });
      }
    };
    $("btnNo").addEventListener("click", () => { attending = false; $("formErr").hidden = true; paint(); });

    if (g.response) {
      attending = g.response.attending;
      if (g.response.guests) sel.value = String(Math.min(g.response.guests, g.max_guests));
      $("note").value = g.response.note || "";
      const pn = $("prevNote");
      pn.textContent = `You replied on ${fmtAt(g.response.at)}. Sending again will replace that reply. · تم استلام ردّكم سابقاً، والإرسال مجدداً يستبدله.`;
      pn.hidden = false;
    }
    paintNames(g.response?.guest_names || []);
    paint();
    if (window.__revealSweep) window.__revealSweep();

    const showConfirm = (resp) => {
      const box = $("confirm");
      const n = resp.guests;
      box.innerHTML = "";
      const add = (tag, cls, text, rtl) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (rtl) { el.dir = "rtl"; el.lang = "ar"; }
        el.textContent = text; box.append(el); return el;
      };
      if (resp.attending) {
        add("p", "c-title", "Thank you!");
        add("p", "", `We can't wait to celebrate with you. We have you down for ${n} ${n === 1 ? "guest" : "guests"}.`);
        add("p", "", `شكراً لكم! بانتظاركم لنحتفل معاً. عدد الحضور: ${n}`, true);
      } else {
        add("p", "c-title", "Thank you for letting us know");
        add("p", "", "You will be missed, and you are in our hearts on the day.");
        add("p", "", "شكراً لإعلامنا، سنفتقدكم وستكونون في قلوبنا.", true);
      }
      const names = (resp.guest_names || []).filter(Boolean);
      if (names.length) add("p", "c-meta", names.join(" · "));
      add("p", "c-meta", "You can reopen your link any time to change your answer; a new reply replaces this one.");
      if (demo) add("span", "c-demo", "Preview mode: nothing was sent");
      const again = document.createElement("button");
      again.type = "button"; again.className = "btn-outline small";
      again.innerHTML = '<span>Change my reply</span><span dir="rtl" lang="ar">تعديل الرد</span>';
      again.addEventListener("click", () => { box.hidden = true; $("rsvpForm").hidden = false; });
      box.append(again);
      box.hidden = false;
      $("rsvpForm").hidden = true;
      $("prevNote").hidden = true;
      box.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    };

    $("rsvpForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("formErr");
      if (attending === null) {
        err.textContent = "Please choose whether you will join us. · الرجاء اختيار الحضور أو الاعتذار.";
        err.hidden = false; return;
      }
      if (attending && [...namesBox.querySelectorAll("input")].some((i) => !i.value.trim())) return flagMissingNames();
      err.hidden = true;
      $("namesErr").hidden = true;
      const guests = attending ? Number(sel.value) : 0;
      const guest_names = attending ? [...namesBox.querySelectorAll("input")].map((i) => i.value) : [];
      const note = $("note").value.slice(0, 500);
      const btn = $("sendBtn");
      btn.disabled = true;

      if (demo) {
        const clean = guest_names.map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, guests);
        setTimeout(() => { btn.disabled = false; showConfirm({ attending, guests, guest_names: clean, note, at: new Date().toISOString() }); }, 400);
        return;
      }
      try {
        const res = await fetch(`${API}/rsvp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ t, attending, guests, guest_names, note }),
        });
        if (res.status === 400) {
          const body = await res.json().catch(() => ({}));
          if (body && body.code === "names_required") { flagMissingNames(); return; }
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        const out = await res.json();
        showConfirm(out.response);
      } catch (_) {
        err.textContent = "Something went wrong. Please try again. · حدث خطأ، الرجاء المحاولة مجدداً.";
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  };

  /* ---------- 7. Preview mode (?preview=1, opened from the admin page) ----------
   * Real name and seats; the open is not counted, and the RSVP is never posted
   * (setting demo after the fetch reuses the "Preview mode: nothing was sent" path). */
  const preview = q.get("preview") === "1";
  if (preview) {
    const bar = document.createElement("div");
    bar.textContent = "Preview \u2014 this is what the family will see. Nothing is saved.";
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#4a3f2f;color:#fff;font:600 14px/1.3 -apple-system,Helvetica,Arial,sans-serif;text-align:center;padding:8px 12px;padding-top:max(8px,env(safe-area-inset-top));pointer-events:none;";
    document.body.append(bar);
  }

  loadGuest().then((g) => { if (preview && g) demo = true; initRsvp(g); });

  /* ---------- 8. Background music (CONFIG.music) ----------
   * A plain <audio> element (not Web Audio): on iPhone it then plays through the media channel,
   * so guests with the ring/silent switch on still hear it. Starts inside the envelope tap
   * (a user gesture, so iOS/Android allow sound), same level throughout, no fades.
   * audio.volume is honoured on Android/desktop; iPhone plays at the phone's media volume.
   * Nothing is downloaded before the tap. Never auto-plays in ?preview=1. */
  const M = CONFIG.music || {};
  if (M.enabled && M.src) {
    const KEY = "wedding-music";                 // sessionStorage: "on" | "off"
    const audio = new Audio();
    audio.preload = "none";
    audio.loop = !!M.loop;
    audio.volume = M.volume ?? 0.6;
    audio.setAttribute("playsinline", "");
    audio.id = "bgMusic";
    document.body.append(audio);
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (_) {}   // iOS 17+

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "music-btn";
    btn.hidden = true;
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"/>' +
      '<path class="on" d="M14.5 9.2a4 4 0 0 1 0 5.6M16.8 7a7 7 0 0 1 0 10"/>' +
      '<path class="off" d="M15 9.5l5 5M20 9.5l-5 5"/></svg>';
    document.body.append(btn);

    let playing = false, wanted = false, resumeOnShow = false;
    const paint = () => {
      btn.classList.toggle("is-on", playing);
      btn.setAttribute("aria-pressed", String(playing));
      btn.setAttribute("aria-label", playing ? "Mute music \u00b7 إيقاف الموسيقى" : "Play music \u00b7 تشغيل الموسيقى");
    };
    const start = () => {
      if (!audio.src) audio.src = M.src + (M.startAt ? `#t=${M.startAt}` : "");
      const p = audio.play();
      const ok = () => { playing = true; paint(); };
      const fail = () => { playing = false; wanted = false; paint(); };
      if (p && p.then) p.then(ok, fail); else ok();
    };
    const stop = () => { playing = false; paint(); audio.pause(); };

    // first start: the envelope tap (skipped in preview, or if the guest muted earlier this session)
    $("seal").addEventListener("click", () => {
      btn.hidden = false;
      if (preview || sessionStorage.getItem(KEY) === "off") { paint(); return; }
      wanted = true;
      start();
    });
    if ($("envelope").classList.contains("is-open")) btn.hidden = false;   // ?open=1 / #hash: no gesture, button off
    paint();

    btn.addEventListener("click", () => {
      if (playing) { wanted = false; sessionStorage.setItem(KEY, "off"); stop(); }
      else { wanted = true; sessionStorage.setItem(KEY, "on"); start(); }
    });

    // pause while the tab is hidden, resume when back
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        resumeOnShow = playing;
        if (playing) { audio.pause(); playing = false; paint(); }
      } else if (resumeOnShow && wanted) {
        resumeOnShow = false;
        start();
      }
    });

    audio.addEventListener("ended", () => { playing = false; wanted = false; paint(); });

    // step out of the way when a button scrolls under it
    if ("IntersectionObserver" in window) {
      const under = new Set();
      const dodge = new IntersectionObserver((entries) => {
        entries.forEach((en) => (en.isIntersecting ? under.add(en.target) : under.delete(en.target)));
        btn.classList.toggle("dodge", under.size > 0);
      }, { rootMargin: "-82% 0px 0px 0px" });
      document.querySelectorAll("#btnYes, #btnNo, #sendBtn, #copyBtn, #mapsLink, #nameFields, #note, #guestCount, .confirm")
        .forEach((el) => dodge.observe(el));
    }
    window.__music = { audio, level: () => audio.volume, get playing() { return playing; } };   // for tests
  }
};
