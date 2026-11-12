/* =====================================================================================
 * WEDDING GUEST PLATFORM: "CANVA SLIDES" INVITE (slides.js)
 * -------------------------------------------------------------------------------------
 * What it is:   the second way an invite can look. Instead of Karim & Maya's built-in
 *               design, the guest sees the pages (pictures or short muted videos) that were
 *               designed in Canva and uploaded in the admin page's Design tab, one under the
 *               other. On top of those pictures the page draws a few "live" things in boxes:
 *               the seal to tap, texts, the couple's names, a photo, the family's name and
 *               seats, the countdown, a Maps button, the gift number and the RSVP form.
 * Who uses it:  guests, when a wedding's Design is set to "Canva slides" and published.
 *               Helpers see it in the Design tab preview (with boxes they can drag).
 * Talks to:     nothing by itself to load the design: app.js (the loader) fetches
 *               /<wedding>/api/invite and calls TWPSlides.start(data, { CONFIG, API, SLUG }).
 *               For the guest: GET  /<wedding>/api/guest?t=...  (name + seats + earlier answer)
 *                              POST /<wedding>/api/rsvp       (the answer)
 *               Same calls, same rules as the template.
 * Must not change, and why:
 *   - The RSVP rules: names required for every guest coming, 1..seats only, preview and
 *     demo never save, "Change my reply" always possible. Helpers and guests rely on them.
 *   - Never show a phone number or e-mail here; the public API does not send them anyway.
 *   - This file MIRRORS logic from app.js (envelope open + music, countdown, copy number,
 *     initRsvp). It is copied, not shared, so the template (app.js) never has to change.
 *     If you fix a bug in one, check the other.
 * //notes: (for developers)
 *   - Slide shape (from the invite config, see docs/API.md, Invite design):
 *       { id, name, kind:"image"|"video", asset, url, type, open_asset?, open_url?, w?, h?,
 *         overlays:[{ kind, x, y, w, h, text?, font?, size?, color?, dir?, align?, shape?, asset?, url? }] }
 *     x/y/w/h are percentages of the slide. size is in "% of slide width" (CSS cqw units).
 *     font: "serif" | "sans" | "arabic" (the theme's fonts) or a font family name.
 *   - Text placeholders: {groom} {bride} {ar} {date} {dateAr} {short} {time} {timeAr} {venue}
 *     {city} {cityAr} {father1} {father2} {father1Ar} {father2Ar} {replyBy} {replyByAr}
 *     {giftProvider} {account} {family} {seats}, or any CONFIG path like {venue.name}.
 *   - Fitting (not in edit mode): the "Family + seats" card shrinks to its box (fitReserved, down to 55%); the slide holding
 *     the RSVP form grows with the form instead of scrolling inside the box (fitRsvpSlide: boxes placed in px of the picture's
 *     height, the picture covers the taller slide). Small labels never go under 11 px (CSS max()).
 *   - Edit mode (?edit=1 inside the admin iframe): no lock, no music, boxes outlined, drag to
 *     move, corner dot to resize; sends postMessage to the parent:
 *       { type:"twp-overlay-select", slide, overlay } and { type:"twp-overlay-move", slide, overlay, x, y, w, h, done }
 *     and listens for { type:"twp-invite", invite } (re-render), { type:"twp-select", slide, overlay }.
 * ===================================================================================== */
(() => {
  "use strict";
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const inFrame = window.parent !== window;
  const EDIT = q.get("edit") === "1" && inFrame;
  const preview = q.get("preview") === "1";
  const t = q.get("t");
  const isLocal = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const VARS = { paper: "--paper", paper2: "--paper-2", gold: "--gold", goldD: "--gold-d", goldL: "--gold-l", ink: "--ink", inkSoft: "--ink-soft", serif: "--serif", sans: "--sans", arabic: "--arabic" };
  const GFONTS = { "Playfair Display": "Playfair+Display:ital@0;1", "Great Vibes": "Great+Vibes", "Lora": "Lora:ital@0;1",
    "EB Garamond": "EB+Garamond:ital@0;1", "Cinzel": "Cinzel", "Parisienne": "Parisienne", "Montserrat": "Montserrat:wght@300;400;500",
    "Lato": "Lato:wght@300;400", "Poppins": "Poppins:wght@300;400;500", "Cairo": "Cairo:wght@400;600;700", "Aref Ruqaa": "Aref+Ruqaa:wght@400;700",
    "Noto Naskh Arabic": "Noto+Naskh+Arabic:wght@400;700", "Tajawal": "Tajawal:wght@400;700", "Reem Kufi": "Reem+Kufi:wght@400;700",
    "Lateef": "Lateef:wght@400;700", "Scheherazade New": "Scheherazade+New:wght@400;700", "Marhey": "Marhey:wght@400;700" };
  const DEFAULT_SIZE = { text: 4.6, names: 11, reserved: 6.5, countdown: 9, maps: 4, gift: 7, rsvp: 3.8, seal: 4 };
  const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

  let C, API, SLUG, DATA;
  let guestPromise = null, demo = q.get("demo") === "1";
  const timers = [];

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const merge = (into, from) => { if (!isObj(from)) return; for (const k of Object.keys(from)) { if (isObj(from[k]) && isObj(into[k])) merge(into[k], from[k]); else if (from[k] !== undefined && from[k] !== null) into[k] = from[k]; } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ar = (e) => { e.dir = "rtl"; e.lang = "ar"; return e; };
  const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), C);
  const hasArabic = (s) => /[؀-ۿ]/.test(String(s || ""));

  // uploaded file name -> address (used when the server did not already add a url)
  const assetUrl = (name) => (name ? (/^(https?:)?\//.test(name) ? name : `/${SLUG}/asset/${name}`) : null);

  /* ---------- CSS for the slides (style.css stays loaded for fonts, form, countdown, music button) ---------- */
  const CSS = `
  html.twp-s, html.twp-s body { background: #e7dccb; }
  html.twp-s.locked, html.twp-s.locked body { overflow: hidden; height: 100%; }
  .twp-slides { display: flex; flex-direction: column; align-items: center; gap: 0; }
  .page.twp-slide { min-height: 0; padding: 0; display: block; width: 100%; max-width: 560px; margin: 0 auto; overflow: hidden; background: var(--paper); }
  .twp-frame { position: relative; width: 100%; aspect-ratio: var(--ar, 0.5625); container-type: inline-size; background: var(--paper) center / 100% 100% no-repeat; overflow: hidden; }
  .twp-frame > video.twp-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
  .twp-frame > .twp-open { position: absolute; inset: 0; background: center / 100% 100% no-repeat; opacity: 0; transition: opacity 1.1s ease .35s; pointer-events: none; }
  .twp-slide.is-open .twp-open { opacity: 1; }
  .twp-ov { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; line-height: 1.25; color: var(--ink); min-width: 0; min-height: 0; }
  .twp-ov.k-text { white-space: pre-line; overflow-wrap: anywhere; }
  .twp-ov.k-names { font-family: var(--serif); font-style: italic; font-weight: 600; line-height: 1.05; }
  .twp-ov.k-names i { color: var(--gold); font-size: .62em; margin: .08em 0; font-style: italic; }
  .twp-ov.k-photo { background: center / cover no-repeat; }
  .twp-ov.k-photo.shape-arch { border-radius: 50% 50% 0 0 / 30% 30% 0 0; }
  .twp-ov.k-photo.shape-circle { border-radius: 50%; }
  .twp-ov.k-photo.shape-soft { border-radius: 6cqw; }
  .twp-ov.k-seal { cursor: pointer; border: 0; padding: 0; background: none; -webkit-tap-highlight-color: transparent; }
  .twp-ov.k-seal img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .twp-ov.k-seal .seal-ring { position: absolute; inset: 4%; border-radius: 50%; pointer-events: none; }
  .twp-ov.k-seal .seal-ring::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid rgba(184, 151, 90, .7); animation: pulse 2.6s ease-out infinite; }
  .twp-slide.is-open .twp-ov.k-seal { pointer-events: none; animation: waxLift .8s var(--ease) forwards; }
  .twp-slide.is-open .twp-ov.k-seal .seal-ring::after { animation: none; opacity: 0; }
  .twp-tap { position: absolute; left: 0; right: 0; bottom: 5%; display: flex; flex-direction: column; gap: 4px; align-items: center; font-size: 12px; letter-spacing: .3em; text-transform: uppercase; color: #5e5040; text-shadow: 0 0 10px rgba(246,239,227,.95); pointer-events: none; animation: hint 2.4s ease-in-out infinite; transition: opacity .4s; }
  .twp-tap [dir="rtl"] { font-size: 15px; letter-spacing: 0; text-transform: none; }
  .twp-slide.is-open .twp-tap { opacity: 0; animation: none; }
  .twp-ov .reserved { margin: 0; width: 100%; padding: .7em .8em .5em; }
  .twp-ov .guest-name { font-size: 1.15em; margin: .15em 0 .4em; }
  .twp-ov .seats { font-size: 1em; }
  .twp-ov .lbl { font-size: max(11px, .36em); }
  .twp-ov .lbl[dir="rtl"] { font-size: max(12px, .5em); }
  .twp-ov .res-row .lbl { white-space: nowrap; }
  .twp-ov.k-countdown .clock { margin: 0; gap: .2em; display: flex; align-items: flex-start; justify-content: center; }
  .twp-ov.k-countdown .unit { min-width: 0; display: flex; flex-direction: column; align-items: center; }
  .twp-ov.k-countdown .num { font-size: 1em; line-height: 1; }
  .twp-ov.k-countdown .colon { font-size: .8em; line-height: 1; }
  .twp-ov.k-countdown .unit-label { font-size: max(11px, .22em); letter-spacing: .06em; margin-top: .3em; }
  .twp-ov.k-maps a, .twp-ov.k-gift button { font-size: 1em; }
  .twp-ov.k-gift .acct-num { font-size: 1em; margin: 0 0 .3em; }
  .twp-ov.k-gift .btn-outline { font-size: max(12px, .42em); }
  .twp-ov.k-rsvp { display: block; text-align: left; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 0 1%; }
  .twp-ov.k-rsvp form { margin-top: 0; }
  .twp-ov.k-rsvp .reserved { margin-bottom: 1em; text-align: center; }
  .twp-ov.k-rsvp .guest-name { font-size: 1.7em; }
  .twp-ov.k-rsvp .seats { font-size: 1.4em; }
  .twp-ov.k-rsvp .lbl { font-size: max(11px, .62em); }
  .twp-ov.k-rsvp .lbl[dir="rtl"] { font-size: max(12px, .8em); }
  .twp-frame.has-rsvp { background-size: cover; background-position: center top; }
  .twp-frame.has-rsvp > video.twp-bg { object-fit: cover; object-position: center top; }
  .twp-frame.has-rsvp > .twp-ov.k-rsvp { overflow: visible; }
  .twp-ov.k-rsvp .nolink, .twp-ov.k-rsvp .confirm, .twp-ov.k-rsvp .rsvp-loading { text-align: center; }
  .twp-ov .ar-font { font-family: var(--arabic); }
  .twp-edit .twp-ov { outline: 1.5px dashed rgba(59, 111, 214, .85); outline-offset: -1px; cursor: move; touch-action: none; user-select: none; -webkit-user-select: none; }
  .twp-edit .twp-ov > * { pointer-events: none; }
  .twp-edit .twp-ov.sel { outline: 2px solid #3b6fd6; background-color: rgba(59, 111, 214, .08); z-index: 30; }
  .twp-edit .twp-hdl { position: absolute; right: -9px; bottom: -9px; width: 20px; height: 20px; border-radius: 50%; background: #3b6fd6; border: 2px solid #fff; cursor: nwse-resize; pointer-events: auto !important; touch-action: none; }
  .twp-edit .twp-tag { position: absolute; left: 0; top: -1px; transform: translateY(-100%); background: #3b6fd6; color: #fff; font: 600 10px/1.4 -apple-system, Helvetica, Arial, sans-serif; padding: 1px 5px; border-radius: 4px 4px 0 0; white-space: nowrap; pointer-events: none; }
  .twp-edit .twp-num { position: absolute; left: 6px; top: 6px; z-index: 40; background: rgba(0,0,0,.55); color: #fff; font: 600 12px/1 -apple-system, Helvetica, Arial, sans-serif; padding: 4px 7px; border-radius: 10px; }
  .twp-toast { position: fixed; left: 50%; bottom: 70px; transform: translateX(-50%); background: rgba(43,38,34,.92); color: #fff; padding: 9px 16px; border-radius: 20px; font: 500 14px -apple-system, Helvetica, Arial, sans-serif; z-index: 9999; pointer-events: none; }
  `;

  /* ---------- placeholders ---------- */
  const FIELDS = {
    groom: "couple.groom", bride: "couple.bride", ar: "couple.ar", monogram: "couple.monogram",
    date: "date.en", dateAr: "date.ar", short: "date.short", time: "date.timeEn", timeAr: "date.timeAr",
    venue: "venue.name", city: "venue.city", cityAr: "venue.ar",
    father1: "families.en.father1", father2: "families.en.father2", father1Ar: "families.ar.father1", father2Ar: "families.ar.father2",
    replyBy: "rsvp.replyByEn", replyByAr: "rsvp.replyByAr", kidsNote: "rsvp.kidsNoteEn", kidsNoteAr: "rsvp.kidsNoteAr",
    giftProvider: "gift.provider", account: "gift.accountNumber",
  };
  const fillText = (tpl, g) => String(tpl || "").replace(/\{([a-zA-Z0-9_.]+)\}/g, (m, k) => {
    if (k === "family") return g ? g.name : "";
    if (k === "seats") return g ? String(g.max_guests) : "";
    const v = get(FIELDS[k] || k);
    return v == null || typeof v === "object" ? m : String(v);
  });

  const fontOf = (f) => {
    if (!f || f === "sans") return "var(--sans)";
    if (f === "serif") return "var(--serif)";
    if (f === "arabic") return "var(--arabic)";
    return `"${String(f).replace(/"/g, "")}", var(--sans)`;
  };
  const loadFonts = (names) => {
    const want = [...new Set(names.map((n) => GFONTS[n]).filter(Boolean))];
    if (!want.length) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?" + want.map((f) => "family=" + f).join("&") + "&display=swap";
    document.head.append(l);
  };

  /* ---------- guest lookup (mirrors app.js loadGuest) ---------- */
  const loadGuest = () => {
    if (guestPromise) return guestPromise;
    guestPromise = (async () => {
      if (demo || EDIT) return structuredClone(C.demoGuest || { name: "The Salem Family", max_guests: 4, response: null });
      if (!t) return null;
      try {
        const r = await fetch(`${API}/guest?t=${encodeURIComponent(t)}${preview ? "&preview=1" : ""}`, { headers: { accept: "application/json" } });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (err) {
        if (isLocal) { demo = true; return structuredClone(C.demoGuest); }
        return null;
      }
    })().then((g) => { if (preview && g) demo = true; return g; });
    return guestPromise;
  };

  const fmtAt = (iso) => {
    try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }); }
    catch (_) { return ""; }
  };

  const toast = (text) => {
    const d = el("div", "twp-toast", text); document.body.append(d); setTimeout(() => d.remove(), 2200);
  };

  /* ---------- fitting: the "Family + seats" card shrinks to its box; the RSVP slide grows with its form ---------- */
  // Family + seats: smaller words (down to 55% of the chosen size) until the card fits the box drawn on the Canva page; the two
  // labels of a row go one under the other first when the box is too narrow for them side by side. Labels never go under 11 px (CSS).
  const fitReserved = (box) => {
    const card = box.querySelector(".reserved"); if (!card || !box.clientHeight) return;
    const base = Number(box.dataset.fs) || DEFAULT_SIZE.reserved;
    box.style.fontSize = base + "cqw";
    card.querySelectorAll(".res-row").forEach((r) => r.classList.remove("stack"));
    const fits = () => card.offsetHeight <= box.clientHeight + 1 && card.scrollWidth <= card.clientWidth + 1;
    if (fits()) return;
    if (card.scrollWidth > card.clientWidth + 1) card.querySelectorAll(".res-row").forEach((r) => r.classList.add("stack"));
    for (let k = 0.95; !fits() && k >= 0.549; k -= 0.05) box.style.fontSize = +(base * k).toFixed(3) + "cqw";
  };
  // The slide that holds the answer form: the form is never squeezed into a scrolling box. The box keeps its place (top, at
  // least its drawn height) and grows with the form; the slide is at least the picture's shape and grows with it (the picture
  // then covers the taller slide). Boxes on that slide are placed in px of the picture's height, so they stay where drawn.
  const fitRsvpSlide = (fr) => {
    const W = fr.clientWidth; if (!W) return;
    const ratio = parseFloat(getComputedStyle(fr).getPropertyValue("--ar")) || 0.5625, H0 = W / ratio;
    let need = H0;
    fr.querySelectorAll(":scope > .twp-ov").forEach((box) => {
      const ov = box.__ov; if (!ov) return;
      box.style.top = +((Number(ov.y) || 0) / 100 * H0).toFixed(1) + "px";
      const h = (Number(ov.h) || 10) / 100 * H0;
      if (box.classList.contains("k-rsvp")) { box.style.height = "auto"; box.style.minHeight = +h.toFixed(1) + "px"; need = Math.max(need, box.offsetTop + box.offsetHeight + H0 * 0.02); }
      else box.style.height = +h.toFixed(1) + "px";
    });
    const mh = need > H0 + 1 ? Math.ceil(need) + "px" : "";
    if (fr.style.minHeight !== mh) fr.style.minHeight = mh;
  };
  // Names and gift boxes: the same, smaller words (down to 55% for names, 70% for the gift number) until what is inside fits the box drawn for it.
  const fitInside = (box) => {
    if (!box.clientHeight) return;
    const base = Number(box.dataset.fs) || DEFAULT_SIZE[box.dataset.kind] || 4.6;
    box.style.fontSize = base + "cqw";
    const fits = () => {
      const b = box.getBoundingClientRect(); let t = Infinity, bt = -Infinity, l = Infinity, r = -Infinity;
      [...box.children].forEach((c) => { const x = c.getBoundingClientRect(); if (!x.height) return; t = Math.min(t, x.top); bt = Math.max(bt, x.bottom); l = Math.min(l, x.left); r = Math.max(r, x.right); });
      return t === Infinity || (t >= b.top - 2 && bt <= b.bottom + 2 && l >= b.left - 2 && r <= b.right + 2);
    };
    const floor = box.dataset.kind === "names" ? 0.549 : 0.699;   // names are big to begin with
    for (let k = 0.95; !fits() && k >= floor; k -= 0.05) box.style.fontSize = +(base * k).toFixed(3) + "cqw";
  };
  const fitAll = () => {
    if (EDIT) return;
    document.querySelectorAll(".twp-ov.k-reserved").forEach(fitReserved);
    document.querySelectorAll(".twp-ov.k-names, .twp-ov.k-gift").forEach(fitInside);
    document.querySelectorAll(".twp-frame.has-rsvp").forEach(fitRsvpSlide);
  };
  let fitQueued = false;
  const fitLater = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fitAll(); }); };
  window.addEventListener("resize", fitLater);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitLater);

  /* ---------- live parts ---------- */
  let openEnvelope = () => {};
  let music = null;

  const KIND = {
    text(ov, box) {
      const txt = fillText(ov.text ?? "", null);
      box.textContent = txt;
      if (!ov.font && hasArabic(txt) && !/[A-Za-z]/.test(txt)) box.classList.add("ar-font");
      if (/\{(family|seats)\}/.test(ov.text || "")) loadGuest().then((g) => { box.textContent = fillText(ov.text, g); });
    },
    names(ov, box) {
      box.append(el("span", "", C.couple.groom), el("i", "", "&"), el("span", "", C.couple.bride));
      box.setAttribute("aria-label", `${C.couple.groom} & ${C.couple.bride}`);
    },
    photo(ov, box) {
      const url = ov.url || assetUrl(ov.asset) || (DATA.assets && DATA.assets.couple) || "couple.jpg";
      box.style.backgroundImage = `url("${url}")`;
      box.classList.add("shape-" + (ov.shape || "rect"));
      box.setAttribute("role", "img"); box.setAttribute("aria-label", "");
    },
    seal(ov, box) {
      const b = el("button", "");
      b.type = "button";
      // replace the div with a button so it is a real control
      box.replaceWith(b); b.className = box.className; b.style.cssText = box.style.cssText; b.dataset.ov = box.dataset.ov;
      b.setAttribute("aria-label", "Open the invitation");
      const su = ov.url || assetUrl(ov.asset);
      if (su) { const img = el("img"); img.src = su; img.alt = ""; b.append(img); }
      b.append(el("span", "seal-ring"));
      b.addEventListener("click", () => { if (!EDIT) openEnvelope(b.closest(".twp-slide")); });
      return b;
    },
    reserved(ov, box) {
      const card = el("div", "reserved");
      const r1 = el("div", "res-row"); r1.append(el("span", "lbl", "Reserved for"), ar(el("span", "lbl", "محجوز لـ")));
      const nm = el("p", "guest-name", "…");
      const r2 = el("div", "res-row"); r2.append(el("span", "lbl", "Seats reserved"), ar(el("span", "lbl", "عدد المقاعد")));
      const seats = el("p", "seats", "");
      card.append(r1, nm, r2, seats); box.append(card);
      loadGuest().then((g) => {
        if (!g) { card.replaceChildren(el("p", "lbl", "Please open the personal link you received"), ar(el("p", "lbl", "الرجاء فتح الرابط الخاص بكم"))); fitLater(box); return; }
        nm.textContent = g.name; seats.textContent = g.max_guests;
        fitLater(box);
      });
    },
    countdown(ov, box) {   // mirrors app.js section 4
      const clock = el("div", "clock"); clock.setAttribute("role", "timer");
      const cells = {};
      [["d", "Days"], ["h", "Hours"], ["m", "Minutes"], ["s", "Seconds"]].forEach(([k, label], i) => {
        if (i) clock.append(el("span", "colon", ":"));
        const u = el("div", "unit"); cells[k] = el("span", "num", "00"); u.append(cells[k], el("span", "unit-label", label)); clock.append(u);
      });
      const done = el("p", "cd-done", ""); done.hidden = true; done.append("Today is the day · ", ar(el("span", "", "اليوم هو اليوم")));
      box.append(clock, done);
      const target = new Date(C.date.iso).getTime();
      const pad = (n) => String(n).padStart(2, "0");
      const tick = () => {
        let diff = Math.max(0, target - Date.now());
        const d = Math.floor(diff / 86400000); diff -= d * 86400000;
        const h = Math.floor(diff / 3600000); diff -= h * 3600000;
        const m = Math.floor(diff / 60000); diff -= m * 60000;
        const s = Math.floor(diff / 1000);
        cells.d.textContent = pad(d); cells.h.textContent = pad(h); cells.m.textContent = pad(m); cells.s.textContent = pad(s);
        if (target - Date.now() <= 0) { done.hidden = false; return false; }
        return true;
      };
      if (tick()) { const iv = setInterval(() => { if (!tick()) clearInterval(iv); }, 1000); timers.push(iv); }
    },
    maps(ov, box) {
      const a = el("a", "btn-outline");
      a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(C.venue.mapsQuery || C.venue.name);
      a.target = "_blank"; a.rel = "noopener";
      a.append(el("span", "", ov.text || "Get directions"), ar(el("span", "", "الموقع على الخريطة")));
      box.append(a);
    },
    gift(ov, box) {   // mirrors app.js section 5
      const num = el("p", "acct-num", C.gift.accountNumber); num.dir = "ltr";
      const btn = el("button", "btn-outline small"); btn.type = "button";
      const l1 = el("span", "", "Tap to copy"), l2 = ar(el("span", "", "انسخ الرقم"));
      btn.append(l1, l2);
      box.append(num, btn);
      const copy = async () => {
        if (EDIT) return;
        const text = String(C.gift.accountNumber).replace(/\s+/g, "");
        let ok = false;
        try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
          const ta = document.createElement("textarea");
          ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.append(ta); ta.select();
          try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
          ta.remove();
        }
        l1.textContent = ok ? "Copied" : "Copy failed"; l2.textContent = ok ? "تم النسخ" : "تعذّر النسخ";
        setTimeout(() => { l1.textContent = "Tap to copy"; l2.textContent = "انسخ الرقم"; }, 2200);
      };
      box.addEventListener("click", copy);
    },
    rsvp(ov, box) { buildRsvp(box); },
  };

  /* ---------- RSVP form (mirrors app.js initRsvp; same calls, same validation) ---------- */
  function buildRsvp(host) {
    const loading = el("p", "rsvp-loading", "Loading your invitation…");
    host.append(loading);
    const $$ = {};
    const make = () => {
      const wrap = el("div");
      wrap.innerHTML = `
        <div class="reserved">
          <div class="res-row"><span class="lbl">Reserved for</span><span class="lbl" dir="rtl" lang="ar">محجوز لـ</span></div>
          <p class="guest-name" data-r="guestName"></p>
          <div class="res-row"><span class="lbl">Seats reserved</span><span class="lbl" dir="rtl" lang="ar">عدد المقاعد</span></div>
          <p class="seats" data-r="seatCount"></p>
        </div>
        <div class="kids-note" data-r="kids"><p class="kids-ar" dir="rtl" lang="ar"></p><p class="kids-en"></p></div>
        <p class="prev-note" data-r="prevNote" hidden></p>
        <form data-r="form" novalidate>
          <fieldset class="field">
            <legend class="bi"><span>Will you join us?</span><span dir="rtl" lang="ar">هل ستشاركونا؟</span></legend>
            <div class="choice">
              <button type="button" data-r="btnYes" aria-pressed="false"><span>Joyfully accept</span><span dir="rtl" lang="ar">بكل سرور</span></button>
              <button type="button" data-r="btnNo" aria-pressed="false"><span>Regretfully decline</span><span dir="rtl" lang="ar">نعتذر</span></button>
            </div>
          </fieldset>
          <div data-r="partyBox" hidden>
            <div class="field">
              <label class="bi"><span>How many of you?</span><span dir="rtl" lang="ar">عدد الحضور</span></label>
              <div class="select-wrap"><select data-r="guestCount"></select></div>
            </div>
            <div class="field">
              <p class="bi"><span>Names</span><span dir="rtl" lang="ar">الأسماء</span></p>
              <p class="form-err names-err" data-r="namesErr" role="alert" hidden></p>
              <div data-r="nameFields" class="name-fields"></div>
            </div>
          </div>
          <div class="field">
            <label class="bi"><span>Share your love and wishes</span><span dir="rtl" lang="ar">شاركونا محبتكم وأمنياتكم</span></label>
            <textarea data-r="note" rows="3" maxlength="500"></textarea>
          </div>
          <p class="form-err" data-r="formErr" role="alert" hidden></p>
          <button class="btn-gold" type="submit" data-r="sendBtn"><span>Send your reply</span><span dir="rtl" lang="ar">أرسلوا ردّكم</span></button>
          <p class="overwrite-hint">You can reopen your link any time; sending again replaces your previous reply.<br><span dir="rtl" lang="ar">يمكنكم فتح الرابط مجدداً وتعديل ردّكم في أي وقت.</span></p>
        </form>
        <div class="confirm" data-r="confirm" role="status" hidden></div>`;
      wrap.querySelectorAll("[data-r]").forEach((n) => { $$[n.dataset.r] = n; });
      $$.kids.querySelector(".kids-ar").textContent = C.rsvp.kidsNoteAr || "";
      $$.kids.querySelector(".kids-en").textContent = C.rsvp.kidsNoteEn || "";
      if (DATA.show && DATA.show.kidsNote === false) $$.kids.hidden = true;
      return wrap;
    };

    loadGuest().then((g) => {
      loading.remove();
      if (!g) {
        const n = el("div", "nolink");
        n.append(el("p", "", "To reply, please open the personal link from your invitation."), ar(el("p", "", "لتأكيد الحضور، الرجاء فتح الرابط الخاص بكم من رسالة الدعوة.")));
        host.append(n); return;
      }
      if (DATA.status === "archived") {
        const c = el("div", "confirm"); c.append(el("p", "c-title", "Thank you for celebrating with us"), ar(el("p", "", "شكراً لمشاركتكم فرحتنا")));
        host.append(c); return;
      }
      host.append(make());
      $$.guestName.textContent = g.name;
      $$.seatCount.textContent = g.max_guests;
      const sel = $$.guestCount, namesBox = $$.nameFields;
      for (let i = 1; i <= g.max_guests; i++) sel.append(new Option(String(i), String(i)));
      sel.value = String(g.max_guests);

      const paintNames = (vals) => {
        const keep = [...namesBox.querySelectorAll("input")].map((i) => i.value);
        namesBox.innerHTML = "";
        for (let i = 0; i < Number(sel.value); i++) {
          const id = `sgname${i}`;
          const lab = document.createElement("label");
          lab.htmlFor = id;
          const arN = String(i + 1).replace(/\d/g, (d) => AR_DIGITS[d]);
          lab.textContent = `Full name of guest ${i + 1}`;
          const inp = document.createElement("input");
          inp.type = "text"; inp.id = id; inp.maxLength = 80; inp.autocomplete = i === 0 ? "name" : "off";
          inp.placeholder = `Full name of guest ${i + 1} / الاسم الكامل للضيف ${arN}`;
          inp.required = true;
          inp.addEventListener("input", () => inp.classList.remove("missing"));
          inp.value = (vals && vals[i]) ?? keep[i] ?? "";
          namesBox.append(lab, inp);
        }
      };
      sel.addEventListener("change", () => paintNames());

      let attending = null;
      const paint = () => {
        $$.btnYes.setAttribute("aria-pressed", String(attending === true));
        $$.btnNo.setAttribute("aria-pressed", String(attending === false));
        $$.partyBox.hidden = attending !== true;
      };
      $$.btnYes.addEventListener("click", () => {
        attending = true; $$.formErr.hidden = true; paint();
        $$.partyBox.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      });
      const NAMES_MSG = "Please write the name of everyone coming · الرجاء كتابة أسماء جميع الحضور";
      const flagMissingNames = () => {
        const empty = [...namesBox.querySelectorAll("input")].filter((i) => !i.value.trim());
        empty.forEach((i) => i.classList.add("missing"));
        $$.namesErr.textContent = NAMES_MSG; $$.namesErr.hidden = false;
        const first = empty[0] || namesBox.querySelector("input");
        if (first) { first.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }); first.focus({ preventScroll: true }); }
      };
      $$.btnNo.addEventListener("click", () => { attending = false; $$.formErr.hidden = true; paint(); });

      if (g.response) {
        attending = g.response.attending;
        if (g.response.guests) sel.value = String(Math.min(g.response.guests, g.max_guests));
        $$.note.value = g.response.note || "";
        $$.prevNote.textContent = `You replied on ${fmtAt(g.response.at)}. Sending again will replace that reply. · تم استلام ردّكم سابقاً، والإرسال مجدداً يستبدله.`;
        $$.prevNote.hidden = false;
      }
      paintNames(g.response?.guest_names || []);
      paint();

      const showConfirm = (resp) => {
        const box = $$.confirm, n = resp.guests;
        box.innerHTML = "";
        const add = (tag, cls, text, rtl) => { const e = el(tag, cls, text); if (rtl) ar(e); box.append(e); return e; };
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
        const again = el("button", "btn-outline small"); again.type = "button";
        again.innerHTML = '<span>Change my reply</span><span dir="rtl" lang="ar">تعديل الرد</span>';
        again.addEventListener("click", () => { box.hidden = true; $$.form.hidden = false; });
        box.append(again);
        box.hidden = false; $$.form.hidden = true; $$.prevNote.hidden = true;
        box.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      };

      $$.form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (EDIT) return;
        const err = $$.formErr;
        if (attending === null) { err.textContent = "Please choose whether you will join us. · الرجاء اختيار الحضور أو الاعتذار."; err.hidden = false; return; }
        if (attending && [...namesBox.querySelectorAll("input")].some((i) => !i.value.trim())) return flagMissingNames();
        err.hidden = true; $$.namesErr.hidden = true;
        const guests = attending ? Number(sel.value) : 0;
        const guest_names = attending ? [...namesBox.querySelectorAll("input")].map((i) => i.value) : [];
        const note = $$.note.value.slice(0, 500);
        const btn = $$.sendBtn; btn.disabled = true;
        if (demo) {
          const clean = guest_names.map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, guests);
          setTimeout(() => { btn.disabled = false; showConfirm({ attending, guests, guest_names: clean, note, at: new Date().toISOString() }); }, 400);
          return;
        }
        try {
          const res = await fetch(`${API}/rsvp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, attending, guests, guest_names, note }) });
          if (res.status === 400) { const body = await res.json().catch(() => ({})); if (body && body.code === "names_required") { flagMissingNames(); return; } }
          if (res.status === 410) { err.textContent = "This wedding is over, so answers are closed. Thank you! · انتهت المناسبة، شكراً لكم"; err.hidden = false; return; }
          if (!res.ok) throw new Error("HTTP " + res.status);
          const out = await res.json();
          showConfirm(out.response);
        } catch (_) {
          err.textContent = "Something went wrong. Please try again. · حدث خطأ، الرجاء المحاولة مجدداً.";
          err.hidden = false;
        } finally { btn.disabled = false; }
      });
    });
  }

  /* ---------- background music (mirrors app.js section 8) ---------- */
  function setupMusic() {
    const M = C.music || {};
    if (EDIT || !M.enabled || !M.src) return null;
    const KEY = "wedding-music";
    const audio = new Audio();
    audio.preload = "none"; audio.loop = !!M.loop; audio.volume = M.volume ?? 0.6;
    audio.setAttribute("playsinline", ""); audio.id = "bgMusic";
    document.body.append(audio);
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (_) {}
    const btn = el("button", "music-btn"); btn.type = "button"; btn.hidden = true;
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"/>' +
      '<path class="on" d="M14.5 9.2a4 4 0 0 1 0 5.6M16.8 7a7 7 0 0 1 0 10"/><path class="off" d="M15 9.5l5 5M20 9.5l-5 5"/></svg>';
    document.body.append(btn);
    let playing = false, wanted = false, resumeOnShow = false;
    const paint = () => { btn.classList.toggle("is-on", playing); btn.setAttribute("aria-pressed", String(playing)); btn.setAttribute("aria-label", playing ? "Mute music · إيقاف الموسيقى" : "Play music · تشغيل الموسيقى"); };
    const start = () => {
      if (!audio.src) audio.src = M.src + (M.startAt ? `#t=${M.startAt}` : "");
      const p = audio.play();
      const ok = () => { playing = true; paint(); }, fail = () => { playing = false; wanted = false; paint(); };
      if (p && p.then) p.then(ok, fail); else ok();
    };
    const stop = () => { playing = false; paint(); audio.pause(); };
    btn.addEventListener("click", () => { if (playing) { wanted = false; sessionStorage.setItem(KEY, "off"); stop(); } else { wanted = true; sessionStorage.setItem(KEY, "on"); start(); } });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { resumeOnShow = playing; if (playing) { audio.pause(); playing = false; paint(); } }
      else if (resumeOnShow && wanted) { resumeOnShow = false; start(); }
    });
    audio.addEventListener("ended", () => { playing = false; wanted = false; paint(); });
    paint();
    window.__music = { audio, level: () => audio.volume, get playing() { return playing; } };
    return {
      firstTap() { btn.hidden = false; if (preview || sessionStorage.getItem(KEY) === "off") { paint(); return; } wanted = true; start(); },
      show() { btn.hidden = false; },
    };
  }

  /* ---------- build ---------- */
  function applyTheme(theme) {
    if (!isObj(theme)) return;
    for (const [k, v] of Object.entries(VARS)) if (typeof theme[k] === "string" && theme[k].trim()) root.style.setProperty(v, theme[k]);
    const names = ["serif", "sans", "arabic"].map((k) => (String(theme[k] || "").match(/^\s*["']?([^"',]+)/) || [])[1]).filter(Boolean).map((s) => s.trim());
    loadFonts(names);
  }

  function render() {
    timers.splice(0).forEach(clearInterval);
    document.querySelectorAll(".twp-root, .music-btn, #bgMusic").forEach((n) => n.remove());
    root.classList.add("twp-s");
    const slides = (DATA.slides || []).filter((s) => s && (s.url || s.asset || s.overlays?.length));
    const wrap = el("main", "twp-slides twp-root" + (EDIT ? " twp-edit" : ""));
    const ovFonts = [];
    slides.forEach((s, si) => {
      const sec = el("section", "page twp-slide");
      sec.id = "slide-" + (si + 1); sec.dataset.i = si; sec.dataset.type = s.type || "plain";
      const fr = el("div", "twp-frame");
      const ratio = Number(s.w) > 0 && Number(s.h) > 0 ? s.w / s.h : null;
      if (ratio) fr.style.setProperty("--ar", String(ratio));
      const url = s.url || assetUrl(s.asset);
      if (url && s.kind === "video") {
        const v = el("video", "twp-bg"); v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
        v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.src = url;
        v.addEventListener("loadedmetadata", () => { if (!ratio && v.videoWidth) fr.style.setProperty("--ar", String(v.videoWidth / v.videoHeight)); });
        fr.append(v);
      } else if (url) {
        fr.style.backgroundImage = `url("${url}")`;
        if (!ratio) { const im = new Image(); im.onload = () => { if (im.naturalWidth) fr.style.setProperty("--ar", String(im.naturalWidth / im.naturalHeight)); }; im.src = url; }
      }
      const openUrl = s.open_url || assetUrl(s.open_asset);
      if (s.type === "envelope" && openUrl) { const o = el("div", "twp-open"); o.style.backgroundImage = `url("${openUrl}")`; fr.append(o); }
      (s.overlays || []).forEach((ov, oi) => {
        let box = el("div", "twp-ov k-" + ov.kind);
        box.dataset.ov = oi;
        box.style.left = (Number(ov.x) || 0) + "%"; box.style.top = (Number(ov.y) || 0) + "%";
        box.style.width = (Number(ov.w) || 20) + "%"; box.style.height = (Number(ov.h) || 10) + "%";
        box.style.fontSize = (Number(ov.size) || DEFAULT_SIZE[ov.kind] || 4.6) + "cqw";
        box.dataset.fs = String(Number(ov.size) || DEFAULT_SIZE[ov.kind] || 4.6);
        box.dataset.kind = ov.kind;
        if (ov.font) { box.style.fontFamily = fontOf(ov.font); if (!["serif", "sans", "arabic"].includes(ov.font)) ovFonts.push(ov.font); }
        if (ov.color) box.style.color = ov.color;
        if (ov.dir && ov.dir !== "auto") box.dir = ov.dir; else if (ov.kind === "text") box.dir = "auto";
        if (ov.align) { box.style.textAlign = ov.align; box.style.alignItems = { left: "flex-start", right: "flex-end", center: "center" }[ov.align] || "center"; }
        if (ov.weight) box.style.fontWeight = ov.weight;
        if (ov.italic) box.style.fontStyle = "italic";
        fr.append(box);
        const f = KIND[ov.kind];
        if (f) { const r = f(ov, box); if (r) box = r; }
        box.__ov = ov;
        if (ov.kind === "rsvp" && !EDIT) {
          fr.classList.add("has-rsvp");
          if ("ResizeObserver" in window) { const ro = new ResizeObserver(fitLater); ro.observe(box); ro.observe(fr); }
        }
        if (EDIT) {
          const tag = el("span", "twp-tag", { text: "Text", names: "Names", photo: "Photo", seal: "Seal", reserved: "Family + seats", countdown: "Countdown", maps: "Maps", gift: "Gift", rsvp: "RSVP form" }[ov.kind] || ov.kind);
          box.append(tag, el("span", "twp-hdl"));
        }
      });
      if (s.type === "envelope" && !EDIT) {
        const hint = el("p", "twp-tap"); hint.setAttribute("aria-hidden", "true");
        hint.append(el("span", "", "Tap to open"), ar(el("span", "", "اضغطوا لفتح الدعوة")));
        fr.append(hint);
      }
      if (EDIT) fr.append(el("span", "twp-num", String(si + 1)));
      sec.append(fr); wrap.append(sec);
    });
    loadFonts(ovFonts);
    document.body.prepend(wrap);
    document.title = `${C.couple.groom} & ${C.couple.bride}`;

    music = setupMusic();
    const envSlide = wrap.querySelector('.twp-slide[data-type="envelope"]');
    const hashTarget = location.hash && document.querySelector(location.hash);
    openEnvelope = (sec) => {
      if (!sec || sec.classList.contains("is-open")) return;
      sec.classList.add("is-open");
      if (music) music.firstTap();
      const wait = reduceMotion ? 50 : 1500;
      setTimeout(() => {
        root.classList.remove("locked");
        const next = sec.nextElementSibling;
        if (next) next.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }, wait);
    };
    if (envSlide && !EDIT && q.get("open") !== "1" && !(hashTarget && hashTarget !== envSlide)) {
      if (envSlide === wrap.firstElementChild) {
        root.classList.add("locked");
        if ("scrollRestoration" in history) history.scrollRestoration = "manual";
        window.scrollTo(0, 0);
      }
    } else {
      root.classList.remove("locked");
      if (envSlide) { envSlide.classList.add("is-open"); if (music) music.show(); }
      if (hashTarget) requestAnimationFrame(() => hashTarget.scrollIntoView({ block: "start" }));
    }
    if (preview) {
      const bar = el("div", "", "Preview — this is what the family will see. Nothing is saved.");
      bar.setAttribute("role", "status");
      bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#4a3f2f;color:#fff;font:600 14px/1.3 -apple-system,Helvetica,Arial,sans-serif;text-align:center;padding:8px 12px;padding-top:max(8px,env(safe-area-inset-top));pointer-events:none;";
      wrap.append(bar);
    }
    if (EDIT) setupEditing(wrap);
    fitLater();
  }

  /* ---------- edit mode: drag + resize boxes, talk to the admin page ---------- */
  let selected = null;
  function post(msg) { try { window.parent.postMessage(msg, location.origin); } catch (_) {} }
  function markSel() {
    document.querySelectorAll(".twp-ov.sel").forEach((n) => n.classList.remove("sel"));
    if (!selected) return;
    const n = document.querySelector(`.twp-slide[data-i="${selected.slide}"] .twp-ov[data-ov="${selected.overlay}"]`);
    if (n) n.classList.add("sel");
    return n;
  }
  function setupEditing(wrap) {
    markSel();
    let drag = null;
    wrap.addEventListener("pointerdown", (e) => {
      const box = e.target.closest(".twp-ov"); if (!box) return;
      const sec = box.closest(".twp-slide"), si = Number(sec.dataset.i), oi = Number(box.dataset.ov);
      const ov = DATA.slides[si].overlays[oi];
      e.preventDefault();
      selected = { slide: si, overlay: oi }; markSel();
      post({ type: "twp-overlay-select", slide: si, overlay: oi });
      const r = box.parentElement.getBoundingClientRect();
      drag = { box, ov, si, oi, r, mode: e.target.classList.contains("twp-hdl") ? "size" : "move", sx: e.clientX, sy: e.clientY, o: { x: +ov.x || 0, y: +ov.y || 0, w: +ov.w || 20, h: +ov.h || 10 } };
      try { box.setPointerCapture(e.pointerId); } catch (_) {}
    });
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const round = (v) => Math.round(v * 10) / 10;
    const move = (e, done) => {
      if (!drag) return;
      const dx = (e.clientX - drag.sx) / drag.r.width * 100, dy = (e.clientY - drag.sy) / drag.r.height * 100, o = drag.o, ov = drag.ov;
      if (drag.mode === "move") { ov.x = round(clamp(o.x + dx, 0, 100 - o.w)); ov.y = round(clamp(o.y + dy, 0, 100 - o.h)); }
      else { ov.w = round(clamp(o.w + dx, 4, 100 - o.x)); ov.h = round(clamp(o.h + dy, 2, 100 - o.y)); }
      Object.assign(drag.box.style, { left: ov.x + "%", top: ov.y + "%", width: ov.w + "%", height: ov.h + "%" });
      post({ type: "twp-overlay-move", slide: drag.si, overlay: drag.oi, x: ov.x, y: ov.y, w: ov.w, h: ov.h, done: !!done });
    };
    wrap.addEventListener("pointermove", (e) => move(e, false));
    const end = (e) => { if (drag) { move(e, true); drag = null; } };
    wrap.addEventListener("pointerup", end);
    wrap.addEventListener("pointercancel", end);
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || !DATA) return;
    const m = e.data;
    if (m.type === "twp-invite" && m.invite && m.invite.mode === "slides") {
      const y = window.scrollY;
      DATA = m.invite; C = structuredClone(BASE); merge(C, DATA.config); applyTheme(DATA.theme);
      render(); window.scrollTo(0, y);
    } else if (m.type === "twp-select") {
      selected = m.overlay == null ? null : { slide: m.slide, overlay: m.overlay };
      const n = markSel();
      const sec = document.querySelector(`.twp-slide[data-i="${m.slide}"]`);
      if (m.scroll !== false) (n || sec)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });

  let BASE = null;
  window.TWPSlides = {
    start(data, ctx) {
      BASE = structuredClone(ctx.CONFIG);
      C = ctx.CONFIG; API = ctx.API; SLUG = ctx.SLUG; DATA = data;
      merge(C, data.config);
      applyTheme(data.theme);
      const st = document.createElement("style"); st.textContent = CSS; document.head.append(st);
      // the template's own page is not used in this mode
      [...document.body.children].forEach((n) => { if (n.tagName !== "SCRIPT") n.remove(); });
      root.classList.remove("locked");
      render();
    },
  };
})();
