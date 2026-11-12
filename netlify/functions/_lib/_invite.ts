// =====================================================================================================
// _invite.ts: the invite design object (docs/API.md, Invite design): checking it and turning it into URLs.
//
// What it is for:
//   - normalizeInvite(): checks a design sent by the Design tab before it is saved. Known fields are
//     type-checked, missing fields get the template default, unknown fields are dropped.
//   - resolveInvite(): what the public GET /<slug>/api/invite returns: picture slots and slides turned
//     into real URLs.
//   - assetUrl(), ASSET_NAME_RE, assetKind(): naming rules for uploaded files.
// Who calls it: wedding-invite.ts, wedding-admin.ts (GET/PUT invite, upload-asset), manage.ts (create, copy).
// What it reads/writes: nothing by itself (pure functions).
//
// What NOT to change and why:
//   - The shape must match what site/app/app.js (the loader) and site/app/slides.js expect.
//   - Colours are limited to #hex and fonts to plain characters because they are written into CSS
//     variables on the guest's page; letting anything else through would let a design inject CSS.
//   - Every text field is shown with textContent by the page, so plain strings are safe there.
//
//notes:
// - pages / readability / timing (per-page fonts and colours, photo veil and blur, envelope and reveal speed):
//   unlike the rest of the design, an unknown page or field is REFUSED with a plain 400, not dropped.
// - lines ("Fine-tune a line", one line of words on one page): same rule, an unknown line or setting or a value out of range
//   is refused with a plain 400 naming the line in plain words. Only settings that are set are kept; a line with none is dropped.
// - Size limit of a whole design: 256 KB of JSON (slides only hold file names, not the files).
// =====================================================================================================
import { Bad, TEMPLATE_CONFIG, TEMPLATE_SHOW, TEMPLATE_THEME, ASSET_SLOTS, TEMPLATE_FILES, PAGE_KEYS, PAGE_FIELDS, LINE_LIST, LINE_FIELDS, TEMPLATE_READABILITY, TEMPLATE_TIMING, clone } from "./_wedding.ts";

export const ASSET_NAME_RE = /^(?:[a-z0-9][a-z0-9-]{0,40}\/)?[a-z0-9][a-z0-9-]{0,80}\.(png|jpg|webp|m4a|mp3|mp4|webm)$/;
export const ASSET_TYPES: Record<string, { ext: string; kind: "image" | "audio" | "video" }> = {
  "image/png": { ext: "png", kind: "image" }, "image/jpeg": { ext: "jpg", kind: "image" }, "image/jpg": { ext: "jpg", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "audio/mp4": { ext: "m4a", kind: "audio" }, "audio/x-m4a": { ext: "m4a", kind: "audio" }, "audio/m4a": { ext: "m4a", kind: "audio" },
  "audio/mpeg": { ext: "mp3", kind: "audio" }, "audio/mp3": { ext: "mp3", kind: "audio" },
  "video/mp4": { ext: "mp4", kind: "video" }, "video/webm": { ext: "webm", kind: "video" },
};
export const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", webp: "image/webp", m4a: "audio/mp4", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm",
};
export function assetKind(name: string): "image" | "audio" | "video" {
  const ext = name.split(".").pop() || "";
  return ["png", "jpg", "webp"].includes(ext) ? "image" : ["m4a", "mp3"].includes(ext) ? "audio" : "video";
}
/** Public URL of an uploaded file: images go through Netlify's image resizer, audio/video are served as is. */
export function assetUrl(slug: string, name: string) {
  return assetKind(name) === "image" ? `/.netlify/images?url=/${slug}/asset/${name}&w=1170&fm=webp&q=80` : `/${slug}/asset/${name}`;
}

const MAX_TEXT = 1000;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const FONT_RE = /^[\w\s",'.-]{1,200}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;
const bad = (field: string, msg: string) => new Bad(`The design could not be saved: ${msg}`, 400, { code: "invalid_invite", field });

/** Copies `input` over `def`, checking each field has the same type as the default. */
function mergeChecked(def: any, input: any, path: string): any {
  if (input === undefined || input === null) return clone(def);
  if (typeof def === "object") {
    if (typeof input !== "object" || Array.isArray(input)) throw bad(path, `"${path}" should be a group of fields.`);
    const out: any = {};
    for (const k of Object.keys(def)) out[k] = mergeChecked(def[k], input[k], path ? `${path}.${k}` : k);
    return out;
  }
  if (typeof def === "string") {
    if (typeof input !== "string") throw bad(path, `"${path}" should be text.`);
    if (input.length > MAX_TEXT) throw bad(path, `"${path}" is longer than ${MAX_TEXT} characters.`);
    return input;
  }
  if (typeof def === "number") {
    const n = typeof input === "string" && input.trim() ? Number(input) : input;
    if (typeof n !== "number" || !Number.isFinite(n)) throw bad(path, `"${path}" should be a number.`);
    return n;
  }
  if (typeof def === "boolean") {
    if (typeof input !== "boolean") throw bad(path, `"${path}" should be on or off.`);
    return input;
  }
  return clone(def);
}

function extras(src: any, known: string[], path: string) {
  const out: any = {};
  let n = 0;
  for (const [k, v] of Object.entries(src || {})) {
    if (known.includes(k) || !/^[A-Za-z][\w-]{0,40}$/.test(k)) continue;
    if (++n > 20) break;
    if (typeof v === "string") { if (v.length > 500) throw bad(`${path}.${k}`, `"${path}.${k}" is too long.`); out[k] = v; }
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

const PAGE_NAMES: Record<string, string> = { envelope: "Envelope", welcome: "Names", families: "Families", countdown: "Countdown & venue", gift: "Gift", rsvp: "RSVP" };
const SHADOWS = ["none", "soft", "strong"], BACKDROPS = ["none", "light", "dark"];
const empty = (v: unknown) => v === undefined || v === null || v === "";
function num(v: unknown, field: string, what: string, min: number, max: number, unit = "") {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw bad(field, `${what} must be between ${min}${unit} and ${max}${unit}.`);
  return n;
}

/** pages: { envelope|welcome|families|countdown|gift|rsvp: { serif?, sans?, arabic?, scale?, ink?, inkSoft?, gold?, shadow?, backdrop? } }.
 *  Unknown pages or fields are refused (not dropped), so a typo never silently does nothing. Empty values = use the theme. */
// Size slider bounds (Design tab "Each page"): 80%-140%, but the Countdown page at most 120% (its four numbers have a fixed
// least width and would run off a phone screen). Saving outside these is a plain 400. Designs saved before (70%-140% on every
// page) are clamped into the new bounds when they are read (stored = true), never refused, so an old invite keeps working.
export const SCALE_MIN = 0.8, SCALE_MAX = 1.4, SCALE_MAX_PAGE: Record<string, number> = { countdown: 1.2 };
const pct = (n: number) => Math.round(n * 100) + "%";
function normalizePages(input: any, stored = false) {
  const out: Record<string, Record<string, string | number>> = Object.fromEntries(PAGE_KEYS.map((k) => [k, {}]));
  if (empty(input)) return out;
  if (typeof input !== "object" || Array.isArray(input)) throw bad("pages", "the page settings should be a group of pages.");
  for (const [key, page] of Object.entries(input)) {
    if (!(PAGE_KEYS as readonly string[]).includes(key)) throw bad(`pages.${key}`, `there is no page called "${String(key).slice(0, 40)}". The pages are: ${PAGE_KEYS.join(", ")}.`);
    if (empty(page)) continue;
    if (typeof page !== "object" || Array.isArray(page)) throw bad(`pages.${key}`, `the settings for the ${PAGE_NAMES[key]} page should be a group of fields.`);
    const name = PAGE_NAMES[key], o = out[key];
    for (const [f, v] of Object.entries(page as any)) {
      const field = `pages.${key}.${f}`;
      if (!(PAGE_FIELDS as readonly string[]).includes(f)) throw bad(field, `the ${name} page has no setting called "${String(f).slice(0, 40)}".`);
      if (empty(v)) continue;
      if (f === "serif" || f === "sans" || f === "arabic") {
        if (typeof v !== "string" || !FONT_RE.test(v)) throw bad(field, `a font on the ${name} page may only hold letters, spaces, quotes and commas.`);
        o[f] = v;
      } else if (f === "ink" || f === "inkSoft" || f === "gold") {
        if (typeof v !== "string" || !COLOR_RE.test(v)) throw bad(field, `a colour on the ${name} page must look like #b8975a.`);
        o[f] = v;
      } else if (f === "scale") {
        const hi = SCALE_MAX_PAGE[key] ?? SCALE_MAX;
        const n = typeof v === "string" && v.trim() ? Number(v) : v;
        if (stored && typeof n === "number" && Number.isFinite(n)) o[f] = Math.round(Math.min(hi, Math.max(SCALE_MIN, n)) * 100) / 100;
        else if (typeof n !== "number" || !Number.isFinite(n) || n < SCALE_MIN || n > hi) throw bad(field, `The text size on the ${name} page must be between ${pct(SCALE_MIN)} and ${pct(hi)}.`);
        else o[f] = Math.round(n * 100) / 100;
      } else if (f === "shadow") {
        if (!SHADOWS.includes(v as string)) throw bad(field, `the text shadow on the ${name} page must be none, soft or strong.`);
        o[f] = v as string;
      } else if (f === "backdrop") {
        if (!BACKDROPS.includes(v as string)) throw bad(field, `the backdrop on the ${name} page must be none, light or dark.`);
        o[f] = v as string;
      }
    }
  }
  return out;
}
const LINE_NAME = new Map(LINE_LIST.map(([k, page, name]) => [k, `"${name}" on the ${PAGE_NAMES[page]} page`]));
const WEIGHTS = ["normal", "bold"];
/** lines: { "<page>.<line>": { font?, size? 0.6-1.8, color?, shadow?, weight?, italic?, letterSpacing? -0.05-0.3 em, hidden? } }.
 *  Keys are LINE_LIST in _wedding.ts. Unknown lines or settings are refused. Empty values (and hidden: false) = same as the page, dropped. */
function normalizeLines(input: any) {
  const out: Record<string, Record<string, string | number | boolean>> = {};
  if (empty(input)) return out;
  if (typeof input !== "object" || Array.isArray(input)) throw bad("lines", "the line settings should be a group of lines.");
  for (const [key, line] of Object.entries(input)) {
    const name = LINE_NAME.get(key);
    if (!name) throw bad(`lines.${String(key).slice(0, 40)}`, `there is no line called "${String(key).slice(0, 40)}". Choose the line from the list in the Design tab (Each page, Fine-tune a line).`);
    if (empty(line)) continue;
    if (typeof line !== "object" || Array.isArray(line)) throw bad(`lines.${key}`, `the settings for ${name} should be a group of fields.`);
    const o: Record<string, string | number | boolean> = {};
    for (const [f, v] of Object.entries(line as any)) {
      const field = `lines.${key}.${f}`;
      if (!(LINE_FIELDS as readonly string[]).includes(f)) throw bad(field, `the line ${name} has no setting called "${String(f).slice(0, 40)}".`);
      if (empty(v)) continue;
      if (f === "font") {
        if (typeof v !== "string" || !FONT_RE.test(v)) throw bad(field, `the font of ${name} may only hold letters, spaces, quotes and commas.`);
        o.font = v;
      } else if (f === "color") {
        if (typeof v !== "string" || !COLOR_RE.test(v)) throw bad(field, `the colour of ${name} must look like #b8975a.`);
        o.color = v;
      } else if (f === "size") {
        const n = typeof v === "string" && v.trim() ? Number(v) : v;
        if (typeof n !== "number" || !Number.isFinite(n) || n < 0.6 || n > 1.8) throw bad(field, `The size of ${name} must be between 60% and 180% of the original.`);
        o.size = Math.round(n * 100) / 100;
      } else if (f === "letterSpacing") {
        const n = typeof v === "string" && v.trim() ? Number(v) : v;
        if (typeof n !== "number" || !Number.isFinite(n) || n < -0.05 || n > 0.3) throw bad(field, `The letter spacing of ${name} must be between -0.05 and 0.3.`);
        o.letterSpacing = Math.round(n * 1000) / 1000;
      } else if (f === "shadow") {
        if (!SHADOWS.includes(v as string)) throw bad(field, `the shadow of ${name} must be none, soft or strong.`);
        o.shadow = v as string;
      } else if (f === "weight") {
        if (!WEIGHTS.includes(v as string)) throw bad(field, `the weight of ${name} must be normal or bold.`);
        o.weight = v as string;
      } else if (f === "italic" || f === "hidden") {
        if (typeof v !== "boolean") throw bad(field, `"${f === "italic" ? "Italic" : "Hide this line"}" for ${name} should be on or off.`);
        if (f === "italic") o.italic = v; else if (v) o.hidden = true;
      }
    }
    if (Object.keys(o).length) out[key] = o;
  }
  return out;
}
/** Refuses a field that does not exist (a typo must never silently do nothing; docs/API.md). */
function onlyKnown(input: object, path: string, known: string[], what: string) {
  for (const k of Object.keys(input)) if (!known.includes(k)) throw bad(`${path}.${k}`, `${what} have no setting called "${String(k).slice(0, 40)}".`);
}
function normalizeReadability(input: any) {
  const out = clone(TEMPLATE_READABILITY);
  if (empty(input)) return out;
  if (typeof input !== "object" || Array.isArray(input)) throw bad("readability", "the readability settings should be a group of fields.");
  onlyKnown(input, "readability", ["veil", "photoBlur"], "the photo settings");
  if (!empty(input.veil)) out.veil = Math.round(num(input.veil, "readability.veil", "The photo veil", 0, 100, "%") * 10) / 10;
  if (!empty(input.photoBlur)) out.photoBlur = Math.round(num(input.photoBlur, "readability.photoBlur", "The photo blur", 0, 6) * 10) / 10;
  return out;
}
function normalizeTiming(input: any) {
  const out = clone(TEMPLATE_TIMING);
  if (empty(input)) return out;
  if (typeof input !== "object" || Array.isArray(input)) throw bad("timing", "the timing settings should be a group of fields.");
  onlyKnown(input, "timing", ["envelopeOpenMs", "revealSpeed"], "the timing settings");
  if (!empty(input.envelopeOpenMs)) out.envelopeOpenMs = Math.round(num(input.envelopeOpenMs, "timing.envelopeOpenMs", "The envelope opening time", 800, 5000, " ms"));
  if (!empty(input.revealSpeed)) out.revealSpeed = Math.round(num(input.revealSpeed, "timing.revealSpeed", "The speed the lines appear at", 0.5, 2) * 100) / 100;
  return out;
}

/** Checks and cleans a design. Throws 400 invalid_invite (with `field`) when something is wrong.
 *  opts.stored = the design was saved earlier (reading, not saving): values whose bounds have since been narrowed are
 *  clamped instead of refused (today: the page Size slider, see SCALE_MIN). */
export function normalizeInvite(input: any, opts: { stored?: boolean } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("draft", "the design is missing.");
  if (JSON.stringify(input).length > 256 * 1024) throw bad("draft", "the design is too large.");
  if (input.version !== undefined && input.version !== 1) throw bad("version", "unknown design version.");
  const mode = input.mode ?? "template";
  if (mode !== "template" && mode !== "slides") throw bad("mode", 'mode must be "template" or "slides".');

  const config = mergeChecked(TEMPLATE_CONFIG, input.config, "config");
  if (config.date.iso && isNaN(Date.parse(config.date.iso))) throw bad("config.date.iso", "the countdown date is not a valid date.");
  if (!FILE_RE.test(config.music.src)) throw bad("config.music.src", "the music file name is not valid.");
  config.music.volume = Math.max(0, Math.min(1, config.music.volume));
  config.music.startAt = Math.max(0, config.music.startAt);

  const show = mergeChecked(TEMPLATE_SHOW, input.show, "show");
  const theme = mergeChecked(TEMPLATE_THEME, input.theme, "theme");
  for (const k of ["paper", "paper2", "gold", "goldD", "goldL", "ink", "inkSoft"])
    if (!COLOR_RE.test(theme[k])) throw bad(`theme.${k}`, `the colour "${k}" must look like #b8975a.`);
  for (const k of ["serif", "sans", "arabic"])
    if (!FONT_RE.test(theme[k])) throw bad(`theme.${k}`, `the font "${k}" may only hold letters, spaces, quotes and commas.`);
  if (theme.baseSize < 12 || theme.baseSize > 24) throw bad("theme.baseSize", "the text size must be between 12 and 24.");

  const assets: Record<string, string | null> = {};
  const ia = input.assets && typeof input.assets === "object" ? input.assets : {};
  for (const k of ASSET_SLOTS) {
    const v = ia[k];
    if (v === undefined || v === null || v === "") assets[k] = null;
    else if (typeof v === "string" && ASSET_NAME_RE.test(v)) assets[k] = v;
    else throw bad(`assets.${k}`, `the picture for "${k}" is not a valid uploaded file name.`);
  }

  const slidesIn = input.slides ?? [];
  if (!Array.isArray(slidesIn)) throw bad("slides", "slides must be a list.");
  if (slidesIn.length > 80) throw bad("slides", "at most 80 slides.");
  const slides = slidesIn.map((s: any, i: number) => {
    const p = `slides.${i}`;
    if (!s || typeof s !== "object") throw bad(p, "a slide is empty.");
    const id = String(s.id ?? "");
    if (!/^[\w-]{1,40}$/.test(id)) throw bad(`${p}.id`, "a slide has no valid id.");
    const kind = s.kind ?? "image";
    if (kind !== "image" && kind !== "video") throw bad(`${p}.kind`, 'a slide must be "image" or "video".');
    if (typeof s.asset !== "string" || !ASSET_NAME_RE.test(s.asset)) throw bad(`${p}.asset`, "a slide's file name is not valid.");
    const overlaysIn = s.overlays ?? [];
    if (!Array.isArray(overlaysIn) || overlaysIn.length > 20) throw bad(`${p}.overlays`, "a slide has too many boxes.");
    const overlays = overlaysIn.map((o: any, j: number) => {
      const op = `${p}.overlays.${j}`;
      if (!o || typeof o !== "object" || typeof o.kind !== "string" || !/^[\w-]{1,40}$/.test(o.kind)) throw bad(op, "a box has no valid kind.");
      const box: any = { kind: o.kind };
      for (const k of ["x", "y", "w", "h"]) {
        const n = Number(o[k]);
        if (!Number.isFinite(n) || n < 0 || n > 100) throw bad(`${op}.${k}`, "a box position must be between 0 and 100.");
        box[k] = n;
      }
      if (o.asset !== undefined && o.asset !== null && o.asset !== "") {
        if (typeof o.asset !== "string" || !ASSET_NAME_RE.test(o.asset)) throw bad(`${op}.asset`, "a photo box's file name is not valid.");
        box.asset = o.asset;
      }
      return { ...extras(o, ["kind", "x", "y", "w", "h", "asset"], op), ...box };
    });
    let open_asset: string | undefined;
    if (s.open_asset !== undefined && s.open_asset !== null && s.open_asset !== "") {
      if (typeof s.open_asset !== "string" || !ASSET_NAME_RE.test(s.open_asset)) throw bad(`${p}.open_asset`, "a slide's opened-picture file name is not valid.");
      open_asset = s.open_asset;
    }
    return {
      ...extras(s, ["id", "name", "kind", "asset", "open_asset", "type", "overlays"], p),
      id, name: String(s.name ?? "").slice(0, 200), kind, asset: s.asset, ...(open_asset ? { open_asset } : {}), type: String(s.type ?? "page").slice(0, 40), overlays,
    };
  });
  const pages = normalizePages(input.pages, !!opts.stored);
  const lines = normalizeLines(input.lines);
  const readability = normalizeReadability(input.readability);
  const timing = normalizeTiming(input.timing);
  return { version: 1, mode, config, show, theme, assets, slides, pages, lines, readability, timing };
}

/** The design as the guest page needs it: every picture slot and slide with a ready-to-use URL. */
export function resolveInvite(slug: string, inv: any) {
  const n = normalizeInvite(inv, { stored: true });
  const assets: Record<string, string> = {};
  for (const k of ASSET_SLOTS) assets[k] = n.assets[k] ? assetUrl(slug, n.assets[k]!) : `/${slug}/${TEMPLATE_FILES[k]}`;
  return { mode: n.mode, config: n.config, show: n.show, theme: n.theme, pages: n.pages, lines: n.lines, readability: n.readability, timing: n.timing, assets, slides: n.slides.map((s: any) => ({
    ...s, url: assetUrl(slug, s.asset), ...(s.open_asset ? { open_url: assetUrl(slug, s.open_asset) } : {}),
    overlays: s.overlays.map((o: any) => (o.asset ? { ...o, url: assetUrl(slug, o.asset) } : o)),
  })) };
}

/** A stored design (admin GET invite) with its page sizes moved into today's bounds, so the Design tab never shows or re-saves
 *  a size the save would now refuse. Only pages[*].scale changes; everything else is returned as stored. */
export function clampStoredScales(inv: any) {
  if (!inv || typeof inv !== "object" || !inv.pages || typeof inv.pages !== "object") return inv;
  const pages: any = { ...inv.pages };
  for (const [k, p] of Object.entries(pages)) {
    const n = p && typeof p === "object" ? Number((p as any).scale) : NaN;
    if (!Number.isFinite(n) || (p as any).scale === null || (p as any).scale === "") continue;
    const c = Math.round(Math.min(SCALE_MAX_PAGE[k] ?? SCALE_MAX, Math.max(SCALE_MIN, n)) * 100) / 100;
    if (c !== n) pages[k] = { ...(p as any), scale: c };
  }
  return { ...inv, pages };
}

/**
 * Names of uploaded files a design uses: the picture slots, every slide's `asset` and `open_asset`, and every
 * overlay's `asset` (photo boxes). Used to refuse deleting a file still in use, and to check a saved design
 * only points at uploaded files. If you add a new place a design can hold a file name, add it here too.
 */
export function assetsUsed(inv: any): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => { if (typeof v === "string" && v) out.add(v); };
  for (const v of Object.values(inv?.assets || {})) add(v);
  for (const s of Array.isArray(inv?.slides) ? inv.slides : []) {
    add(s?.asset); add(s?.open_asset);
    for (const o of Array.isArray(s?.overlays) ? s.overlays : []) add(o?.asset);
  }
  return out;
}
