// WEDDING GUEST PLATFORM: PRETEND WEBSITE FOR TESTING THE PAGES (tools/qa/mock-server.mjs)
// What it is:  a tiny local web server that serves site/ with the same address rules as netlify.toml and
//              answers the API with made-up data from tools/qa/fixtures/*.json (kept in memory, nothing saved).
// Who uses it: tools/qa/pages-smoke.mjs (and a developer who wants to click through the pages offline):
//                node tools/qa/mock-server.mjs [port]     then open http://localhost:8788/manage/ (password "owner")
//                or http://localhost:8788/karim-and-maya/admin/ (any name, password "wedding").
// Talks to:    nothing outside this computer. It is NOT the real backend (that is netlify/functions/).
// Must not change, and why: the reply shapes copy docs/API.md; if API.md changes, change this too, or the
//              page tests stop meaning anything.
// //notes: RAW_DIR=<folder> also serves that folder at /__raw/ (the untouched template, for the screenshot diff).
//          Uploaded images are given the same /.netlify/images?url=... address the real site uses; this server
//          answers that address with the original file.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SITE = path.join(ROOT, "site");
const FIX = path.join(HERE, "fixtures");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".m4a": "audio/mp4", ".mp3": "audio/mpeg",
  ".mp4": "video/mp4", ".webm": "video/webm", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
const DEFAULT_FILES = { envelope: "envelope.jpg", envelopeOpen: "envelope-open.jpg", seal: "envelope-seal.webp", couple: "couple.jpg", og: "og-envelope.jpg", music: "music.m4a" };

export function createState() {
  const st = { weddings: {}, manage: JSON.parse(fs.readFileSync(path.join(FIX, "manage.json"), "utf8")), log: [] };
  for (const f of fs.readdirSync(FIX)) {
    if (!f.endsWith(".json") || f === "manage.json") continue;
    const w = JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
    w.assets = {};   // name -> { type, buf }
    for (const [name, rel] of Object.entries(w.files || {})) w.assets[name] = { type: TYPES[path.extname(rel)] || "application/octet-stream", buf: fs.readFileSync(path.join(SITE, rel)) };
    w.removed = [];
    st.weddings[w.wedding.slug] = w;
  }
  return st;
}

const send = (res, code, obj, headers = {}) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve) => { const ch = []; req.on("data", (c) => ch.push(c)); req.on("end", () => { const s = Buffer.concat(ch).toString(); try { resolve(s ? JSON.parse(s) : {}); } catch { resolve(null); } }); });
const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const isImage = (t) => /^image\//.test(t);

function assetUrl(slug, w, name) {
  const a = w.assets[name];
  return a && isImage(a.type) ? `/.netlify/images?url=/${slug}/asset/${name}&w=1170&fm=webp&q=80` : `/${slug}/asset/${name}`;
}
function resolveInvite(slug, w, design) {
  const assets = {};
  for (const [k, file] of Object.entries(DEFAULT_FILES)) assets[k] = design.assets?.[k] ? assetUrl(slug, w, design.assets[k]) : `/${slug}/${file}`;
  const slides = (design.slides || []).map((s) => ({ ...s, url: s.asset ? assetUrl(slug, w, s.asset) : null }));
  return { slug, status: w.wedding.status, mode: design.mode, config: design.config, show: design.show, theme: design.theme,
    pages: design.pages || {}, lines: design.lines || {}, readability: design.readability || { veil: 57.6, photoBlur: 2.5 }, timing: design.timing || { envelopeOpenMs: 2300, revealSpeed: 1 },
    assets, slides, published_at: w.invite.published_at };
}
function familyOut(slug, w, f, base) {
  const link = `${base}/${slug}/?t=${f.token}`;
  const fill = (tpl) => String(tpl || "").replace(/\{(name|link)\}/g, (m, k) => (k === "name" ? f.name : link));
  const inv = fill(f.message || w.settings["wa_message_" + f.side]), rem = fill(w.settings["wa_reminder_" + f.side]);
  const digits = f.phone ? f.phone.replace(/\D/g, "") : null;
  return { ...f, link, preview_link: link + "&preview=1",
    wa_link: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(inv)}` : null, wa_reminder_link: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(rem)}` : null,
    mail_link: f.email ? `mailto:${f.email}?subject=${encodeURIComponent("Wedding invitation")}&body=${encodeURIComponent(inv)}` : null,
    mail_reminder_link: f.email ? `mailto:${f.email}?subject=${encodeURIComponent("Reminder")}&body=${encodeURIComponent(rem)}` : null };
}
function logAct(w, by, action, extra = {}) {
  const key = String(Date.now()).padStart(12, "0") + String(w.activity.length).padStart(3, "0");
  w.activity.unshift({ key, at: new Date().toISOString(), by, action, token: null, family_name: null, side: null, details: {}, ...extra });
}

async function admin(st, req, res, slug, action, url) {
  const w = st.weddings[slug];
  if (!w) return send(res, 404, { error: "This wedding does not exist.", code: "no_wedding" });
  const m = req.method, ck = cookies(req), base = `http://${req.headers.host}`;
  const ownerOk = ck.twp_owner === "ok";
  const who = ownerOk ? "Owner" : ck["twp_" + slug];
  const body = m === "GET" ? {} : await readBody(req);
  if (body === null) return send(res, 400, { error: "The request was not readable.", code: "bad_json" });
  st.log.push(`${m} ${slug}/${action}`);
  if (action === "login" && m === "POST") {
    if (!body.name) return send(res, 400, { error: "Please type your name.", code: "name_required" });
    if (body.password !== w.password) return send(res, 401, { error: "Wrong password. Try again.", code: "wrong_password" });
    return send(res, 200, { ok: true, name: body.name }, { "set-cookie": `twp_${slug}=${encodeURIComponent(body.name)}; Path=/${slug}; HttpOnly; SameSite=Lax` });
  }
  if (!who) return send(res, 401, { error: "Please log in again.", code: "unauthorized" });
  const archived = w.wedding.status === "archived";
  const write = m !== "GET" && !["logout", "hello"].includes(action);
  if (archived && write) return send(res, 410, { error: "This wedding is archived", code: "archived" });
  const fam = (t) => w.families.find((f) => f.token === t);
  switch (`${m} ${action}`) {
    case "POST logout": return send(res, 200, { ok: true }, { "set-cookie": `twp_${slug}=; Path=/${slug}; Max-Age=0` });
    case "GET me": return send(res, 200, { ok: true, name: who, owner: ownerOk, slug, status: w.wedding.status });
    case "POST hello": return send(res, 200, { ok: true });
    case "GET families": return send(res, 200, { now: new Date().toISOString(), settings: w.settings, removed_count: w.removed.length, families: w.families.map((f) => familyOut(slug, w, f, base)) });
    case "GET settings": return send(res, 200, w.settings);
    case "PUT settings": { for (const k of Object.keys(w.settings)) if (k !== "meta" && typeof body[k] === "string") { w.settings[k] = body[k]; w.settings.meta[k] = { updated_at: new Date().toISOString(), updated_by: who }; } return send(res, 200, w.settings); }
    case "POST family": {
      const f = { token: "TOK" + crypto.randomBytes(4).toString("hex").toUpperCase(), name: body.name, side: body.side, max_guests: Number(body.max_guests) || 1, message: body.message || null,
        phone: body.phone || null, email: body.email || null, created_at: new Date().toISOString(), created_by: who, updated_at: new Date().toISOString(), updated_by: who, sent: null, sends: [], opened: null, response: null };
      if (w.families.some((x) => x.name.toLowerCase() === String(body.name).toLowerCase())) return send(res, 409, { error: "duplicate", code: "duplicate_name", existing: { name: body.name } });
      w.families.push(f); logAct(w, who, "family_added", { token: f.token, family_name: f.name, side: f.side, details: { max_guests: f.max_guests } });
      return send(res, 200, { ok: true, family: familyOut(slug, w, f, base) });
    }
    case "PATCH family": { const f = fam(body.token); if (!f) return send(res, 404, { error: "not found", code: "not_found" }); for (const k of ["name", "side", "max_guests", "message", "phone", "email"]) if (k in body) f[k] = body[k] === "" ? null : body[k]; return send(res, 200, { ok: true, family: familyOut(slug, w, f, base) }); }
    case "DELETE family": { const i = w.families.findIndex((f) => f.token === body.token); if (i >= 0) w.removed.push({ ...w.families.splice(i, 1)[0], removed_at: new Date().toISOString(), removed_by: who }); return send(res, 200, { ok: true }); }
    case "POST mark-sent": {
      const f = fam(body.token); if (!f) return send(res, 404, { error: "not found", code: "not_found" });
      const previous = f.sent ? { ...f.sent } : null, ch = body.channel || "copy";
      if (body.undo) { f.sent = null; } else { f.sent = { ...(f.sent || {}), [body.kind + "_at"]: new Date().toISOString(), [body.kind + "_by"]: who, [body.kind + "_channel"]: ch }; f.sends.push({ kind: body.kind, channel: ch, by: who, at: new Date().toISOString() }); }
      logAct(w, who, body.undo ? "unmarked" : body.kind + "_sent", { token: f.token, family_name: f.name, side: f.side, details: { kind: body.kind, channel: ch } });
      return send(res, 200, { ok: true, sent: f.sent, previous });
    }
    case "GET activity": { const since = url.searchParams.get("since"); const ev = since ? w.activity.filter((e) => e.key > since) : w.activity; return send(res, 200, { events: ev, latest: ev[0]?.key || since || null }); }
    case "GET helpers": return send(res, 200, { helpers: w.helpers });
    case "GET removed": return send(res, 200, { removed: w.removed });
    case "GET last-reset": return send(res, 200, { last: null });
    case "POST upload": return send(res, 200, { ok: true, dry_run: !!body.dry_run, added: (body.families || []).map((f) => f.name), updated: [], unchanged: 0, conflicts: [] });
    case "GET invite": return send(res, 200, { ...w.invite, assets: Object.entries(w.assets).map(([name, a]) => ({ name, content_type: a.type, bytes: a.buf.length, url: assetUrl(slug, w, name), uploaded_at: null, uploaded_by: "Owner" })) });
    case "PUT invite": {
      if (!body.draft || typeof body.draft !== "object") return send(res, 400, { error: "bad", code: "invalid_invite", field: "draft" });
      if (body.base !== undefined && body.base !== w.invite.draft_updated_at) return send(res, 409, { error: "Someone else changed the design.", code: "changed", by: w.invite.draft_updated_by, at: w.invite.draft_updated_at });
      w.invite.draft = body.draft; w.invite.draft_updated_at = new Date().toISOString(); w.invite.draft_updated_by = who; logAct(w, who, "invite_saved");
      return send(res, 200, { ok: true, draft: w.invite.draft, draft_updated_at: w.invite.draft_updated_at, draft_updated_by: who });
    }
    case "POST publish": { w.invite.live = structuredClone(w.invite.draft); w.invite.published_at = new Date().toISOString(); w.invite.published_by = who; w.wedding.published_at = w.invite.published_at; logAct(w, who, "invite_published"); return send(res, 200, { ok: true, published_at: w.invite.published_at, published_by: who }); }
    case "POST discard-draft": { w.invite.draft = structuredClone(w.invite.live); w.invite.draft_updated_at = new Date().toISOString(); logAct(w, who, "invite_discarded"); return send(res, 200, { ok: true, draft: w.invite.draft, draft_updated_at: w.invite.draft_updated_at }); }
    case "POST upload-asset": {
      const buf = Buffer.from(body.data_base64 || "", "base64");
      if (buf.length > 4 * 1024 * 1024) return send(res, 400, { error: "This file is too big.", code: "too_big" });
      const ext = path.extname(body.name || "") || ".bin";
      const name = String(body.name || "file").replace(ext, "").toLowerCase().replace(/[^a-z0-9/]+/g, "-") + "-" + crypto.randomBytes(2).toString("hex") + ext;
      w.assets[name] = { type: body.content_type, buf }; logAct(w, who, "asset_uploaded", { details: { name, bytes: buf.length } });
      return send(res, 200, { ok: true, name, url: assetUrl(slug, w, name), bytes: buf.length, content_type: body.content_type });
    }
    case "POST change-password": {
      if (!ownerOk && body.current !== w.password) return send(res, 401, { error: "Wrong password.", code: "wrong_password" });
      if (String(body.new || "").length < 4) return send(res, 400, { error: "Too short.", code: "too_short" });
      w.password = body.new; logAct(w, who, "password_changed"); return send(res, 200, { ok: true });
    }
    case "GET export": return send(res, 200, { format: "twp-wedding", version: 1, exported_at: new Date().toISOString(), wedding: w.wedding, families: w.families, rsvps: [], sends: [], opens: [], activity: w.activity, settings: w.settings, invite: w.invite });
    default: return send(res, 200, { ok: true });
  }
}

async function manage(st, req, res, action, url) {
  const m = req.method, ck = cookies(req);
  const body = m === "GET" ? {} : await readBody(req);
  st.log.push(`${m} manage/${action}`);
  if (action === "login") {
    if (body.password !== st.manage.owner_password) return send(res, 401, { error: "Wrong password.", code: "wrong_password" });
    return send(res, 200, { ok: true }, { "set-cookie": "twp_owner=ok; Path=/; HttpOnly; SameSite=Lax" });
  }
  if (ck.twp_owner !== "ok") return send(res, 401, { error: "Please log in again.", code: "unauthorized" });
  const base = `http://${req.headers.host}`;
  const W = Object.values(st.weddings);
  const counts = (w) => { const f = w.families; const coming = f.filter((x) => x.response?.attending); return { families: f.length, sent: f.filter((x) => x.sent?.invite_at).length, opened: f.filter((x) => x.opened).length, answered: f.filter((x) => x.response).length, coming: coming.length, not_coming: f.filter((x) => x.response && !x.response.attending).length, seats: f.reduce((a, x) => a + x.max_guests, 0), guests_coming: coming.reduce((a, x) => a + x.response.guests, 0) }; };
  const wOut = (w) => ({ ...w.wedding, created_at: "2026-10-01T10:00:00.000Z", counts: counts(w), last_activity: w.activity[0] ? { by: w.activity[0].by, action: w.activity[0].action, at: w.activity[0].at } : null, links: { invite_base: `${base}/${w.wedding.slug}/`, admin: `${base}/${w.wedding.slug}/admin/` } });
  switch (`${m} ${action}`) {
    case "GET me": return send(res, 200, { ok: true, owner: true });
    case "POST logout": return send(res, 200, { ok: true }, { "set-cookie": "twp_owner=; Path=/; Max-Age=0" });
    case "GET health": return send(res, 200, st.manage.health);
    case "GET weddings": return send(res, 200, { weddings: W.sort((a, b) => a.wedding.event_at.localeCompare(b.wedding.event_at)).map(wOut) });
    case "POST create": {
      if (st.weddings[body.slug]) return send(res, 409, { error: "There is already a wedding at this address.", code: "slug_taken" });
      const src = st.weddings[body.copy_from_slug] || st.weddings["karim-and-maya"];
      const w = structuredClone({ ...src, assets: undefined });
      w.assets = { ...src.assets }; w.removed = [];
      w.wedding = { slug: body.slug, groom: body.groom, bride: body.bride, event_at: `${body.event_date}T${body.event_time || "19:00"}:00.000Z`, event_date: body.event_date, event_time: body.event_time || "19:00", timezone: body.timezone || "Asia/Beirut", reply_by: body.reply_by || null, status: "live", notes: body.notes || "", published_at: null };
      w.password = body.password || "wedding"; w.families = []; w.activity = []; w.helpers = [];
      for (const d of [w.invite.draft, w.invite.live]) Object.assign(d.config.couple, { groom: body.groom, bride: body.bride });
      w.invite.published_at = null;
      st.weddings[body.slug] = w;
      return send(res, 200, { ok: true, wedding: w.wedding, links: { invite_base: `${base}/${body.slug}/`, admin: `${base}/${body.slug}/admin/`, password: w.password } });
    }
    case "POST update": { const w = st.weddings[body.slug]; for (const k of ["groom", "bride", "event_date", "event_time", "timezone", "reply_by", "notes"]) if (k in body) w.wedding[k] = body[k]; return send(res, 200, { ok: true, wedding: w.wedding, invite_updated: true }); }
    case "POST set-password": st.weddings[body.slug].password = body.password; return send(res, 200, { ok: true });
    case "POST archive": st.weddings[body.slug].wedding.status = "archived"; return send(res, 200, { ok: true, wedding: st.weddings[body.slug].wedding });
    case "POST unarchive": st.weddings[body.slug].wedding.status = "live"; return send(res, 200, { ok: true, wedding: st.weddings[body.slug].wedding });
    case "GET export": { const w = st.weddings[url.searchParams.get("slug")]; return send(res, 200, { format: "twp-wedding", version: 1, exported_at: new Date().toISOString(), wedding: w.wedding, families: w.families, invite: w.invite }); }
    case "POST delete": { if (body.confirm !== body.slug) return send(res, 400, { error: "Type the address to confirm.", code: "confirm_required" }); const w = st.weddings[body.slug]; delete st.weddings[body.slug]; return send(res, 200, { ok: true, export: { wedding: w.wedding } }); }
    case "GET data": {
      const q = (url.searchParams.get("q") || "").toLowerCase(), slug = url.searchParams.get("slug"), side = url.searchParams.get("side"), status = url.searchParams.get("status");
      const rows = [];
      for (const w of W) for (const f of w.families) {
        if (slug && w.wedding.slug !== slug) continue; if (side && f.side !== side) continue;
        const r = { wedding: `${w.wedding.groom} & ${w.wedding.bride}`, slug: w.wedding.slug, family: f.name, side: f.side, side_name: f.side === "a" ? w.wedding.groom : w.wedding.bride, seats: f.max_guests,
          sent_at: f.sent?.invite_at || null, sent_by: f.sent?.invite_by || null, opened_count: f.opened?.count || 0, answer: f.response ? (f.response.attending ? "coming" : "not_coming") : null,
          guests: f.response?.guests || 0, guest_names: f.response?.guest_names || [], note: f.response?.note || "", answered_at: f.response?.at || null, link: `${base}/${w.wedding.slug}/?t=${f.token}`, phone: f.phone, email: f.email };
        const ok = { not_sent: !r.sent_at, sent: !!r.sent_at, opened: r.opened_count > 0, answered: !!r.answer, coming: r.answer === "coming", not_coming: r.answer === "not_coming" };
        if (status && !ok[status]) continue;
        if (q && !(r.family.toLowerCase().includes(q) || r.wedding.toLowerCase().includes(q))) continue;
        rows.push(r);
      }
      return send(res, 200, { rows });
    }
    case "GET check": { const s = url.searchParams.get("slug"); return send(res, 200, { issues: st.manage.check.issues.filter((i) => !s || i.slug === s) }); }
    case "GET backups": return send(res, 200, { backups: st.manage.backups });
    case "POST backup-now": { const b = { id: 9, at: new Date().toISOString(), blob_key: "2026-11-06/manual-120000.json", weddings: W.length, families: 5, bytes: 50000, ok: true, error: null }; st.manage.backups.unshift(b); return send(res, 200, { ok: true, backup: b }); }
    case "POST restore": {
      if (body.preview !== false) return send(res, 200, { ok: true, preview: true, target: body.into_slug || body.slug, exists: !body.into_slug, backup_at: "2026-11-06T03:00:00.000Z", backup: { families: 3, answered: 1, sent: 2 }, current: body.into_slug ? null : { families: 3, answered: 1, sent: 2 }, will_add: [], will_remove: [], answers_differ: false, missing_pictures: [] });
      return send(res, 200, { ok: true, preview: false, target: body.into_slug || body.slug, families: 3, safety_backup: "x" });
    }
    default: return send(res, 404, { error: "This action does not exist.", code: "not_found" });
  }
}

function serveFile(res, file, req) {
  fs.stat(file, (err, s) => {
    if (err || !s.isFile()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "content-length": s.size, "cache-control": "no-store" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

export function startServer(port = 8788, { rawDir = process.env.RAW_DIR, state = createState() } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const p = decodeURIComponent(url.pathname);
      let m;
      if (p === "/.netlify/images") return serveAsset(state, res, url.searchParams.get("url") || "", req);
      if ((m = p.match(/^\/api\/manage\/([a-z-]+)$/))) return manage(state, req, res, m[1], url);
      if (rawDir && p.startsWith("/__raw/")) return serveFile(res, path.join(rawDir, p.slice(7) || "index.html"), req);
      if (p === "/") return serveFile(res, path.join(SITE, "index.html"), req);
      if (p === "/manage" || p.startsWith("/manage/")) return serveFile(res, path.join(SITE, "manage/index.html"), req);
      if ((m = p.match(/^\/([^/]+)\/api\/admin\/([a-z-]+)$/))) return admin(state, req, res, m[1], m[2], url);
      if ((m = p.match(/^\/([^/]+)\/api\/invite$/))) {
        const w = state.weddings[m[1]]; if (!w) return send(res, 404, { error: "This wedding does not exist.", code: "no_wedding" });
        const draft = url.searchParams.get("draft") === "1", ck = cookies(req);
        if (draft && !ck["twp_" + m[1]] && ck.twp_owner !== "ok") return send(res, 401, { error: "Please log in to see the draft.", code: "unauthorized" });
        return send(res, 200, resolveInvite(m[1], w, draft ? w.invite.draft : w.invite.live));
      }
      if ((m = p.match(/^\/([^/]+)\/api\/guest$/))) {
        const w = state.weddings[m[1]]; const f = w && w.families.find((x) => x.token === url.searchParams.get("t"));
        return f ? send(res, 200, { name: f.name, max_guests: f.max_guests, response: f.response }) : send(res, 404, { error: "unknown invitation" });
      }
      if ((m = p.match(/^\/([^/]+)\/api\/rsvp$/))) {
        const w = state.weddings[m[1]], b = await readBody(req); const f = w && w.families.find((x) => x.token === b?.t);
        if (!f) return send(res, 404, { error: "unknown invitation" });
        if (w.wedding.status === "archived") return send(res, 410, { error: "This wedding is archived", code: "archived" });
        const names = (b.guest_names || []).map((s) => String(s).trim()).filter(Boolean);
        const guests = b.attending ? Math.max(1, Math.min(f.max_guests, Number(b.guests) || 1)) : 0;
        if (b.attending && names.length < guests) return send(res, 400, { error: "Please write the name of everyone coming.", code: "names_required", needed: guests, given: names.length });
        const response = { attending: !!b.attending, guests, guest_names: names.slice(0, guests), note: String(b.note || "").slice(0, 500), at: new Date().toISOString() };
        if (!b.preview) f.response = response;
        return send(res, 200, { ok: true, preview: !!b.preview, saved: !b.preview, name: f.name, max_guests: f.max_guests, response });
      }
      if ((m = p.match(/^\/([^/]+)\/asset\/(.+)$/))) return serveAsset(state, res, p, req);
      // netlify.toml: root rewrites /style.css, /app.js, /envelope.jpg ... -> /app/<file> (for /<wedding> opened without the slash)
      if ((m = p.match(/^\/([^/]+\.(?:js|css|jpe?g|webp|png|m4a|mp3|xlsx))$/i)) && fs.existsSync(path.join(SITE, "app", m[1]))) return serveFile(res, path.join(SITE, "app", m[1]), req);
      if ((m = p.match(/^\/([^/]+)\/admin(\/.*)?$/))) return serveFile(res, path.join(SITE, "app/admin.html"), req);
      if ((m = p.match(/^\/([^/]+)\/?$/))) return serveFile(res, path.join(SITE, "app/index.html"), req);
      if ((m = p.match(/^\/([^/]+)\/(.+)$/))) return serveFile(res, path.join(SITE, "app", m[2]), req);
      res.writeHead(404); res.end("Not found");
    } catch (e) { console.error(e); send(res, 500, { error: "mock server error: " + e.message }); }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, state, port: server.address().port })));
}
function serveAsset(st, res, p, req) {
  const m = p.match(/^\/([^/]+)\/asset\/(.+)$/);
  const a = m && st.weddings[m[1]]?.assets[m[2]];
  if (!a) return send(res, 404, { error: "This file does not exist.", code: "not_found" });
  res.writeHead(200, { "content-type": a.type, "content-length": a.buf.length, "cache-control": "public, max-age=31536000, immutable" });
  res.end(req.method === "HEAD" ? undefined : a.buf);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.argv[2]) || 8788;
  startServer(port).then(({ port: p }) => console.log(`Pretend website on http://localhost:${p}/  (manage password "owner", wedding password "wedding")`));
}
