// =====================================================================================================
// _wedding.ts: small shared helpers used by every function.
//
// What it is for: replies (json), plain-English errors (Bad), input checks (names, seats, sides, phone,
//   e-mail, slugs), tokens, dates in the wedding's time zone, the default WhatsApp texts, the activity
//   log and the helper counters, and the template's default invite config (CONFIG from site/app/app.js).
// Who calls it: all netlify/functions/*.ts files, tools/seed.ts, the tests.
// What it reads/writes: the tables weddings, activity, helpers (see migrations/001_init.sql).
//
// What NOT to change and why:
//   - TEMPLATE_CONFIG must stay equal to CONFIG in site/app/app.js (minus demoGuest). The seeded
//     karim-and-maya wedding uses it, and its invite must look exactly like the template.
//   - TEMPLATE_THEME holds the colours/fonts of site/app/style.css. Same reason.
//   - TEMPLATE_READABILITY / TEMPLATE_TIMING hold the photo veil, blur and envelope wait that style.css and
//     app.js use. The loader only writes override CSS when a value differs from these, so keep them exact.
//   - RESERVED_SLUGS: these words are real paths of the site; a wedding called "manage" would hide the
//     manager page.
//   - Error messages are shown to helpers as they are: keep them plain, polite sentences.
//   - logEvent / touchHelper must never be called inside tx(...): they use their own connection and they
//     swallow their own errors on purpose (a failed log line must never fail the helper's action).
//
//notes:
// - Sides are stored as "a" (groom's side) and "b" (bride's side). Pages show the first names.
// - Tokens are 10 characters from A-Z and 2-7 (no 0/1/8/9 that look like letters).
// =====================================================================================================
import { randomBytes } from "node:crypto";
import { query, one } from "./_db.ts";

// ---------------- replies and errors ----------------
export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", ...extra },
  });
}
/** An error whose message is shown to the person. Thrown anywhere, turned into a reply by the function. */
export class Bad extends Error {
  constructor(msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); }
}
export const ARCHIVED = () => new Bad("This wedding is archived", 410, { code: "archived" });
export const NOT_FOUND_ACTION = () => new Bad("This action does not exist.", 404, { code: "not_found" });

/** Turns any thrown error into a reply. Unexpected errors are logged and get a generic sentence. */
export function errorReply(e: any) {
  if (e instanceof Bad) return json({ error: e.message, ...e.extra }, e.status);
  console.error(e);
  return json({ error: "Something went wrong on the server. Please try again in a minute.", code: "server_error" }, 500);
}

/** Reads a JSON body. Empty body = {}. DELETE may use the query string instead. */
export async function readBody(req: Request): Promise<any> {
  const text = await req.text();
  if (!text.trim()) return req.method === "DELETE" ? Object.fromEntries(new URL(req.url).searchParams) : {};
  try {
    const b = JSON.parse(text);
    if (b && typeof b === "object" && !Array.isArray(b)) return b;
  } catch {}
  throw new Bad("The request was not readable. Please reload the page and try again.", 400, { code: "bad_json" });
}

export const now = () => new Date().toISOString();
/** Any date value (Date, Postgres JSON timestamp text, ISO) as an ISO string, or null. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const t = new Date(v as any);
  return isNaN(t.getTime()) ? null : t.toISOString();
}

// ---------------- slugs ----------------
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
export const RESERVED_SLUGS = new Set(["manage", "api", "app", "asset", "assets", "admin", "netlify", ".netlify"]);
export function vSlug(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  if (RESERVED_SLUGS.has(s)) throw new Bad(`"${s}" is used by the site itself. Please pick another web address.`, 400, { code: "reserved_slug" });
  if (!SLUG_RE.test(s)) throw new Bad("The web address may only use small letters, digits and dashes (3 to 40 characters, no dash at the start or end).", 400, { code: "bad_slug" });
  return s;
}
/** The first part of the path: "/karim-and-maya/api/guest" -> "karim-and-maya". */
export function slugFromPath(req: Request) {
  return safeDecode(new URL(req.url).pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
}
/** decodeURIComponent that never throws: a broken "%" escape gives "" (= not found), not a server error. */
export function safeDecode(v: string) {
  try { return decodeURIComponent(v); } catch { return ""; }
}

// ---------------- weddings ----------------
export type Wedding = {
  id: number; slug: string; groom: string; bride: string; event_at: string; timezone: string;
  status: "live" | "archived"; password_hash: string; session_version: number; notes: string | null;
  created_at: string; updated_at: string;
};
/** The wedding at this slug, or null (also null for reserved or malformed slugs). */
export async function getWedding(slug: string): Promise<Wedding | null> {
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return null;
  return one<Wedding>("select * from weddings where slug = $1", [slug]);
}
export const NO_WEDDING = () => new Bad("This wedding does not exist.", 404, { code: "no_wedding" });

/** The wedding as shown to pages (never the password hash). */
export function weddingView(w: Wedding, replyBy: string | null = null) {
  const p = localParts(w.event_at, w.timezone);
  return {
    slug: w.slug, groom: w.groom, bride: w.bride, event_at: w.event_at,
    event_date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, event_time: `${pad(p.h)}:${pad(p.mi)}`,
    timezone: w.timezone, reply_by: replyBy, status: w.status, notes: w.notes, created_at: w.created_at, updated_at: w.updated_at,
  };
}

/** Public address of the site, no trailing slash (env PUBLIC_BASE_URL, else the address the request came to). */
export function baseUrl(req: Request) {
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/+$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}
export function links(req: Request, slug: string) {
  const b = baseUrl(req);
  return { invite_base: `${b}/${slug}/`, admin: `${b}/${slug}/admin/` };
}

// ---------------- tokens ----------------
export const TOKEN_RE = /^[A-Z2-7]{6,16}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newToken(n = 10) {
  return Array.from(randomBytes(n), (b) => ALPHABET[b % 32]).join("");
}
export function vToken(v: unknown) {
  const t = String(v ?? "").trim().toUpperCase();
  if (!TOKEN_RE.test(t)) throw new Bad("This family was not found.", 404, { code: "not_found" });
  return t;
}

// ---------------- names and other inputs ----------------
export const NAME_MAX = 120;
export const NAME_MAX_LOGIN = 40;
export const GUESTS_MIN = 1;
export const GUESTS_MAX = 50;
export const MESSAGE_MAX = 4000;
export const NOTE_MAX = 500;
export const GUEST_NAME_MAX = 80;
export const EMAIL_MAX = 200;
export type Side = "a" | "b";

/** Display form of a name: trimmed, inner whitespace collapsed to one space. */
export function cleanName(v: unknown) {
  return String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}
/** Comparison key for duplicates: lower case, whitespace collapsed. Stored as families.name_key. */
export function nameKey(v: unknown) { return cleanName(v).toLowerCase(); }

export function vName(v: unknown) {
  const n = cleanName(v);
  if (!n) throw new Bad("Name is empty.");
  if (n.length > NAME_MAX) throw new Bad(`Name is longer than ${NAME_MAX} characters.`);
  if (/[{}]/.test(n)) throw new Bad("Names cannot contain { or }.");
  return n;
}
export function vCoupleName(v: unknown, who: string) {
  const n = cleanName(v);
  if (!n) throw new Bad(`Please type the ${who}'s name.`, 400, { code: "name_required" });
  if (n.length > 60) throw new Bad(`The ${who}'s name is longer than 60 characters.`);
  if (/[{}<>]/.test(n)) throw new Bad("Names cannot contain { } < or >.");
  return n;
}
/** "a", "b", or the groom's / bride's name in any case. */
export function vSide(v: unknown, w: { groom: string; bride: string }): Side {
  const s = cleanName(v).toLowerCase();
  if (s === "a" || (s && s === w.groom.toLowerCase())) return "a";
  if (s === "b" || (s && s === w.bride.toLowerCase())) return "b";
  throw new Bad(`Side must be ${w.groom} or ${w.bride}.`);
}
export function sideName(side: string, w: { groom: string; bride: string }) { return side === "b" ? w.bride : w.groom; }
export function vGuests(v: unknown) {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < GUESTS_MIN || n > GUESTS_MAX)
    throw new Bad(`Guests allowed must be a whole number from ${GUESTS_MIN} to ${GUESTS_MAX}.`);
  return n;
}
export function vMessage(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const m = String(v);
  if (!m.trim()) return null;
  if (m.length > MESSAGE_MAX) throw new Bad(`Message is longer than ${MESSAGE_MAX} characters.`);
  if (!m.includes("{link}")) throw new Bad("The message must contain {link}, or the family gets no invitation link.");
  return m;
}
/** Phone: spaces, dashes, dots and brackets dropped; "+" or "00" in front kept as "+"; 6 to 15 digits. Empty = null. */
export function vPhone(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/[\s\-.()\/]/g, "");
  if (!s) return null;
  let plus = false;
  if (s.startsWith("+")) { plus = true; s = s.slice(1); } else if (s.startsWith("00")) { plus = true; s = s.slice(2); }
  if (!/^\d{6,15}$/.test(s)) throw new Bad("The phone number should be 6 to 15 digits, ideally starting with + and the country code (for example +961 70 000 002).");
  return (plus ? "+" : "") + s;
}
/** True when a stored phone is in full international form (what WhatsApp links need). */
export const isIntlPhone = (p: string) => /^\+[1-9]\d{6,14}$/.test(p);
export function vEmail(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > EMAIL_MAX || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(s)) throw new Bad("This e-mail address does not look right.");
  return s;
}

// ---------------- dates in the wedding's time zone ----------------
const pad = (n: number) => String(n).padStart(2, "0");
export function vTimezone(v: unknown) {
  const tz = String(v ?? "").trim() || "Asia/Beirut";
  let canonical = "";
  // only region names like "Asia/Beirut" (or UTC): offsets like "+02:00" ignore summer time and are refused
  if (/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) {
    try { canonical = new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone; } catch {}
  }
  if (!canonical) throw new Bad("This time zone is not known. Use a name like Asia/Beirut or Europe/London.", 400, { code: "bad_timezone" });
  return canonical;   // "asia/beirut" -> "Asia/Beirut"
}
export function vDate(v: unknown, what = "date") {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const ok = m && (() => { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; })();
  if (!ok) throw new Bad(`The ${what} must look like 2026-12-31.`, 400, { code: "bad_date" });
  return s;
}
export function vTime(v: unknown) {
  const s = String(v ?? "").trim() || "19:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new Bad("The time must look like 18:30 (24-hour clock).", 400, { code: "bad_time" });
  return s;
}
/** Wall-clock parts of an instant in a time zone, plus the zone's offset in minutes. */
export function localParts(at: string | number, tz: string) {
  const t = typeof at === "number" ? at : Date.parse(at);
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
  const y = +p.year, m = +p.month, d = +p.day, h = +p.hour % 24, mi = +p.minute, s = +p.second;
  const offset = Math.round((Date.UTC(y, m - 1, d, h, mi, s) - Math.floor(t / 1000) * 1000) / 60000);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y, m, d, h, mi, offset, wd };
}
/** "2027-06-19" + "18:30" in "Asia/Beirut" -> the UTC instant (ISO). */
export function zonedToUtc(date: string, time: string, tz: string) {
  const [y, m, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - localParts(guess, tz).offset * 60000;
  const off2 = localParts(utc, tz).offset;
  utc = guess - off2 * 60000;
  return new Date(utc).toISOString();
}

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AR_MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const arDigits = (v: string | number) => String(v).replace(/\d/g, (c) => "٠١٢٣٤٥٦٧٨٩"[+c]);

/** The invite's `date` block (CONFIG.date) for an event instant in its time zone. */
export function dateConfig(eventAt: string, tz: string) {
  const p = localParts(eventAt, tz);
  const off = p.offset, sign = off < 0 ? "-" : "+", ao = Math.abs(off);
  const h12 = p.h % 12 || 12, pm = p.h >= 12;
  return {
    iso: `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:00${sign}${pad(Math.floor(ao / 60))}:${pad(ao % 60)}`,
    en: `${EN_DAYS[p.wd]} ${p.d} ${EN_MONTHS[p.m - 1]} ${p.y}`,
    ar: `${AR_DAYS[p.wd]} ${arDigits(p.d)} ${AR_MONTHS[p.m - 1]} ${arDigits(p.y)}`,
    short: `${p.d} · ${p.m} · ${p.y}`,
    timeEn: `${h12}:${pad(p.mi)} ${pm ? "PM" : "AM"}`,
    timeAr: `${arDigits(h12)}:${arDigits(pad(p.mi))} ${pm ? "مساءً" : "صباحًا"}`,
  };
}
/** Reply-by texts from a YYYY-MM-DD date. */
export function replyByTexts(replyBy: string) {
  const [, m, d] = replyBy.split("-").map(Number);
  return {
    replyByEn: `Please reply before ${EN_MONTHS[m - 1]} ${d}`,
    replyByAr: `الرجاء التأكيد قبل ${arDigits(d)} ${AR_MONTHS[m - 1]}`,
    reminderEn: `before ${d} ${EN_MONTHS[m - 1]}`,
    reminderAr: `قبل ${arDigits(d)} ${AR_MONTHS[m - 1]}`,
  };
}
/** Default reply-by: 4 weeks before the event date (YYYY-MM-DD). */
export function defaultReplyBy(eventDate: string) {
  const [y, m, d] = eventDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 28 * 86400_000).toISOString().slice(0, 10);
}

// ---------------- WhatsApp texts ----------------
export const SETTINGS_KEYS = ["wa_message_a", "wa_message_b", "wa_reminder_a", "wa_reminder_b"] as const;
export type SettingKey = (typeof SETTINGS_KEYS)[number];
/** Default invite and reminder texts, built from the couple's names, the date and the reply-by date. */
export function defaultTexts(o: { groom: string; bride: string; ar: string; dateEn: string; dateAr: string; replyBy: string }) {
  const r = replyByTexts(o.replyBy);
  const msg = `Dear {name},\n\nWith great joy, ${o.groom} & ${o.bride} invite you to celebrate their wedding on ${o.dateEn}.\n\nبكل فرح، يتشرف ${o.ar} بدعوتكم لحضور حفل زفافهما يوم ${o.dateAr}.\n\nPlease open your personal invitation and let us know if you can join us:\nالرجاء فتح الدعوة وتأكيد الحضور:\n{link}`;
  const rem = `Dear {name}, a gentle reminder to RSVP for ${o.groom} & ${o.bride}'s wedding ${r.reminderEn}.\nتذكير لطيف بتأكيد الحضور لحفل زفاف ${o.ar} ${r.reminderAr}.\n{link}`;
  return { wa_message_a: msg, wa_message_b: msg, wa_reminder_a: rem, wa_reminder_b: rem } as Record<SettingKey, string>;
}
/** Fills {name} and {link} in one pass (so a name can never inject another placeholder). */
export function fillText(t: string, name: string, link: string) {
  return t.replace(/\{(name|link)\}/g, (_, k) => (k === "name" ? name : link));
}

// ---------------- the template (site/app/app.js CONFIG and style.css) ----------------
export const TEMPLATE_CONFIG = {
  couple: { groom: "Karim", bride: "Maya", monogram: "K & M", ar: "كريم و مايا" },
  date: { iso: "2027-06-19T18:30:00+03:00", en: "Saturday 19 June 2027", ar: "السبت ١٩ حزيران ٢٠٢٧", short: "19 · 6 · 2027", timeEn: "6:30 PM", timeAr: "٦:٣٠ مساءً" },
  families: { en: { father1: "Eng. Samir Mansour", father2: "Mr. Fadi Nassar" }, ar: { father1: "المهندس سمير منصور", father2: "السيد فادي نصار" } },
  venue: { name: "Olive Grove Hall", city: "Batroun, Lebanon", ar: "البترون، لبنان", mapsQuery: "Olive Grove Hall Batroun Lebanon" },
  rsvp: {
    replyByEn: "Please reply before May 15", replyByAr: "الرجاء التأكيد قبل ١٥ أيار",
    kidsNoteAr: "نومًا هنيئًا لأطفالكم، وسهرة سعيدة لكم", kidsNoteEn: "Sweet dreams to your little ones, and a lovely evening to you.",
  },
  gift: { provider: "Sample Pay", accountNumber: "12 345 678" },
  music: { src: "music.m4a", startAt: 0, loop: true, volume: 0.6, enabled: true },
};
export const TEMPLATE_THEME = {
  paper: "#f3ece2", paper2: "#ece3d5", gold: "#b8975a", goldD: "#8b6a34", goldL: "#e2cd9d", ink: "#4a3f2f", inkSoft: "#6f6250",
  serif: '"Cormorant Garamond", "Playfair Display", Georgia, serif', sans: '"Jost", "Helvetica Neue", Arial, sans-serif',
  arabic: '"Amiri", "Noto Naskh Arabic", "Geeza Pro", serif', baseSize: 16,
};
/** "What to show" switches. All on = the template exactly. (Music on/off is config.music.enabled, not here.) */
export const TEMPLATE_SHOW = { kidsNote: true, gift: true, bismillah: true, countdown: true, maps: true, arabic: true, parents: true, timeLine: true };
/** The six template pages that can get their own fonts/colours ("Each page" card on the Design tab). */
export const PAGE_KEYS = ["envelope", "welcome", "families", "countdown", "gift", "rsvp"] as const;
/** Per-page look: every field is optional; missing = use the theme (today's look). */
export const PAGE_FIELDS = ["serif", "sans", "arabic", "scale", "ink", "inkSoft", "gold", "shadow", "backdrop"] as const;
/**
 * "Fine-tune a line" (Design tab, Each page): every line of words a helper can change on its own, by page, with its
 * plain name. The same keys (with their CSS selectors) are in site/app/app.js (LINES) and, with these names, in
 * site/app/admin.html (LINE_LIST); tests/admin.test.ts checks all three lists match. Never rename a key: saved designs use them.
 */
export const LINE_LIST: ReadonlyArray<readonly [key: string, page: (typeof PAGE_KEYS)[number], name: string]> = [
  ["envelope.names", "envelope", "Names on the card"], ["envelope.date", "envelope", "Date on the card"],
  ["envelope.arabic", "envelope", "Arabic names on the card"], ["envelope.tapHint", "envelope", "Tap to open"],
  ["welcome.bismillah", "welcome", "Bismillah (the calligraphy)"], ["welcome.verse", "welcome", "Verse under the Bismillah"],
  ["welcome.names", "welcome", "Names"], ["welcome.invite", "welcome", "\u201cInvite you to celebrate\u201d line"],
  ["welcome.dateEn", "welcome", "Date (English)"], ["welcome.dateAr", "welcome", "Date (Arabic)"], ["welcome.time", "welcome", "Time under the date"],
  ["families.leadAr", "families", "\u201cThe family of\u201d (Arabic)"], ["families.fathersAr", "families", "Fathers' names (Arabic)"],
  ["families.inviteAr", "families", "Invitation line (Arabic)"], ["families.namesAr", "families", "Couple's names (Arabic)"],
  ["families.leadEn", "families", "\u201cThe family of\u201d (English)"], ["families.fathersEn", "families", "Fathers' names (English)"],
  ["families.inviteEn", "families", "Invitation line (English)"], ["families.namesEn", "families", "Couple's names (English)"],
  ["countdown.small", "countdown", "Small titles (Countdown, The place)"], ["countdown.titles", "countdown", "Big titles (Until the big day, Where we celebrate)"],
  ["countdown.numbers", "countdown", "Countdown numbers"], ["countdown.units", "countdown", "Days, Hours, Minutes, Seconds"],
  ["countdown.dateTime", "countdown", "Date and time under the countdown"], ["countdown.venue", "countdown", "Venue name"],
  ["countdown.city", "countdown", "Venue city"], ["countdown.venueAr", "countdown", "Venue (Arabic)"], ["countdown.maps", "countdown", "Get directions button"],
  ["gift.small", "gift", "Small title (With gratitude)"], ["gift.heading", "gift", "Title (Gift registry)"],
  ["gift.textEn", "gift", "Gift text (English)"], ["gift.textAr", "gift", "Gift text (Arabic)"], ["gift.accountLabel", "gift", "Words above the account number"],
  ["gift.number", "gift", "Account number"], ["gift.copy", "gift", "Tap to copy button"],
  ["rsvp.heading", "rsvp", "RSVP title"], ["rsvp.headingAr", "rsvp", "RSVP title (Arabic)"], ["rsvp.replyBy", "rsvp", "Reply by (English)"],
  ["rsvp.replyByAr", "rsvp", "Reply by (Arabic)"], ["rsvp.guest", "rsvp", "Family name and seats"], ["rsvp.kidsAr", "rsvp", "Children's note (Arabic)"],
  ["rsvp.kidsEn", "rsvp", "Children's note (English)"], ["rsvp.questions", "rsvp", "Questions on the form"], ["rsvp.buttons", "rsvp", "Answer buttons"],
  ["rsvp.monogram", "rsvp", "Monogram at the bottom"], ["rsvp.footDate", "rsvp", "Date at the bottom"],
];
export const LINE_KEYS = LINE_LIST.map(([k]) => k);
/** A line's settings: every field optional; none set = the line follows its page (today's look). */
export const LINE_FIELDS = ["font", "size", "color", "shadow", "weight", "italic", "letterSpacing", "hidden"] as const;
/** Couple photo on page 2: style.css draws a 57.6% veil of rgb(234,221,210) and a 2.5px blur. */
export const TEMPLATE_READABILITY = { veil: 57.6, photoBlur: 2.5 };
/** The literal 2300 ms in app.js (envelope animation, then the scroll to page 2), and the reveal speed. */
export const TEMPLATE_TIMING = { envelopeOpenMs: 2300, revealSpeed: 1 };
export const ASSET_SLOTS = ["envelope", "envelopeOpen", "seal", "couple", "og", "music"] as const;
/** The template's own file for each picture/music slot (served from site/app/ under /<slug>/). */
export const TEMPLATE_FILES: Record<(typeof ASSET_SLOTS)[number], string> = {
  envelope: "envelope.jpg", envelopeOpen: "envelope-open.jpg", seal: "envelope-seal.webp", couple: "couple.jpg", og: "og-envelope.jpg", music: "music.m4a",
};
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The full default invite object (docs/API.md, Invite design) = the template exactly. */
export function templateInvite() {
  return {
    version: 1, mode: "template" as const, config: clone(TEMPLATE_CONFIG), show: clone(TEMPLATE_SHOW), theme: clone(TEMPLATE_THEME),
    assets: Object.fromEntries(ASSET_SLOTS.map((k) => [k, null])) as Record<string, string | null>, slides: [] as any[],
    pages: Object.fromEntries(PAGE_KEYS.map((k) => [k, {}])) as Record<string, Record<string, unknown>>,
    lines: {} as Record<string, Record<string, unknown>>,
    readability: clone(TEMPLATE_READABILITY), timing: clone(TEMPLATE_TIMING),
  };
}
/**
 * Invite for a NEW wedding: the template with this couple's names, date and reply-by filled in.
 * The parents' names, venue and gift account are emptied on purpose: showing another family's names or,
 * worse, another couple's money-transfer number on a new invite would be a real mistake. The gift block
 * stays hidden until an account number is typed on the Design tab.
 */
export function newWeddingInvite(o: { groom: string; bride: string; ar?: string; eventAt: string; timezone: string; replyBy: string }) {
  const inv = templateInvite();
  fillCouple(inv, o.groom, o.bride, o.ar ?? `${o.groom} و ${o.bride}`);   // never keep the template couple's Arabic names
  inv.config.date = dateConfig(o.eventAt, o.timezone);
  const r = replyByTexts(o.replyBy);
  inv.config.rsvp.replyByEn = r.replyByEn; inv.config.rsvp.replyByAr = r.replyByAr;
  inv.config.families = { en: { father1: "", father2: "" }, ar: { father1: "", father2: "" } };
  inv.config.venue = { name: "", city: "", ar: "", mapsQuery: "" };
  inv.config.gift = { provider: "", accountNumber: "" };
  inv.show.gift = false;
  return inv;
}
export function fillCouple(inv: any, groom: string, bride: string, ar?: string) {
  inv.config.couple.groom = groom;
  inv.config.couple.bride = bride;
  inv.config.couple.monogram = `${[...groom][0] || ""} & ${[...bride][0] || ""}`.toUpperCase();
  if (ar !== undefined) inv.config.couple.ar = ar;
}

// ---------------- activity log and helper counters ----------------
const EDIT_ACTIONS = new Set(["family_added", "family_edited", "contact_edited", "family_removed", "family_restored", "upload", "message_saved",
  "unmarked", "reset_family", "reset_all", "undo_reset", "invite_saved", "invite_published", "invite_discarded", "asset_uploaded", "asset_deleted", "password_changed"]);
const NOT_HELPERS = new Set(["guest", "owner", "script", ""]);

/** Appends one line to the activity log. Best effort: never throws. Never call inside tx(). */
export async function logEvent(weddingId: number, e: { by: string; action: string; family?: { id: number; name: string; side: string } | null; side?: string | null; details?: Record<string, unknown> }) {
  try {
    await query("insert into activity (wedding_id, by_name, action, family_id, family_name, side, details) values ($1,$2,$3,$4,$5,$6,$7::jsonb)", [
      weddingId, e.by || "", e.action, e.family?.id ?? null, e.family?.name ?? null, e.family?.side ?? e.side ?? null, JSON.stringify(e.details ?? {}),
    ]);
    await touchHelper(weddingId, e.by, e.action);
  } catch (err) { console.error("activity not logged", err); }
}

/** Counts a helper's action. "ping" = page is open: updates last_active at most every 2 minutes. Never throws. */
export async function touchHelper(weddingId: number, name: string, action: string) {
  try {
    const n = cleanName(name).slice(0, 60);
    if (NOT_HELPERS.has(n.toLowerCase())) return;
    const c = [action === "invite_sent" ? 1 : 0, action === "reminder_sent" ? 1 : 0, EDIT_ACTIONS.has(action) ? 1 : 0, action === "login" ? 1 : 0];
    const ping = action === "ping";
    await query(
      `insert into helpers (wedding_id, name_key, name, first_seen, last_active, invites, reminders, edits, logins)
       values ($1, $2, $3, now(), now(), $4, $5, $6, $7)
       on conflict (wedding_id, name_key) do update set name = excluded.name, last_active = now(),
         invites = helpers.invites + excluded.invites, reminders = helpers.reminders + excluded.reminders,
         edits = helpers.edits + excluded.edits, logins = helpers.logins + excluded.logins
       ${ping ? "where helpers.last_active < now() - interval '2 minutes'" : ""}`,
      [weddingId, n.toLowerCase(), n, ...c],
    );
  } catch (err) { console.error("helper not counted", err); }
}
