// tests/safety.test.ts: regression tests for the code-and-safety review (one test per bug found, plus the
// isolation, concurrency and backup guarantees the review checked). If one of these fails, a real wedding could
// show another couple's details, lose a picture, or a guest/helper could get a server error instead of a sentence.
//notes: runs in its own process with an empty in-memory database (tests/_env.ts). Never use real names.
import "./_env.ts";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { call, handlers, ownerLogin, createWedding, helperLogin, addFamily, A } from "./_helpers.ts";
import { query } from "../netlify/functions/_lib/_db.ts";
import { blobs } from "../netlify/functions/_lib/_blobs.ts";
import { vTimezone } from "../netlify/functions/_lib/_wedding.ts";
import { normalizeInvite, resolveInvite, clampStoredScales } from "../netlify/functions/_lib/_invite.ts";
import { dump } from "../netlify/functions/_lib/_backup.ts";

const { manage, admin, guest, rsvp, invite, asset } = handlers;
const S = "test-wedding", O = "other-wedding";
let owner = "", rima = "", zeina = "";
const M = (method: string, action: string, body?: unknown) => call(manage, method, `/api/manage/${action}`, { cookie: owner, body });
const png = (fill: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, fill)]);

test("setup: two weddings with a helper each", async () => {
  owner = await ownerLogin();
  await createWedding(owner);
  await createWedding(owner, { slug: O, groom: "Ali", bride: "Mia" });
  rima = await helperLogin(S, "Rima");
  zeina = await helperLogin(O, "Yara");
});

test("a missing or unreadable design never shows the template couple's names, parents or gift account", async () => {
  // bug: the public invite fell back to the raw template (Karim & Maya, their parents and money-transfer number)
  await query("update invites set live = '{\"version\": 7}'::jsonb where wedding_id = (select id from weddings where slug = $1)", [O]);
  const r = (await call(invite, "GET", `/${O}/api/invite`)).body;
  assert.equal(r.config.couple.groom, "Ali");
  assert.equal(r.config.couple.bride, "Mia");
  assert.equal(r.config.couple.ar, "Ali و Mia");
  assert.equal(r.config.gift.accountNumber, "");
  assert.equal(r.show.gift, false);
  assert.equal(r.config.families.en.father1, "");
  assert.ok(!JSON.stringify(r).includes("Karim") && !JSON.stringify(r).includes("12 345 678"));
  await query("delete from invites where wedding_id = (select id from weddings where slug = $1)", [O]);
  const r2 = (await call(invite, "GET", `/${O}/api/invite`)).body;
  assert.equal(r2.config.couple.groom, "Ali");
  assert.ok(!JSON.stringify(r2).includes("12 345 678"));
});

test("a token from another wedding is 'not found' on every admin action, never applied", async () => {
  const mine = await addFamily(S, rima, "Demo Family One", "a", 3);
  const api = A(O, zeina);
  for (const [method, action, body] of [
    ["PATCH", "family", { token: mine.token, name: "Hijacked" }],
    ["DELETE", "family", { token: mine.token, force: true }],
    ["POST", "mark-sent", { token: mine.token, kind: "invite" }],
    ["POST", "reset-family", { token: mine.token }],
    ["POST", "restore", { token: mine.token }],
  ] as const) {
    const r = await api(method, action, body);
    assert.equal(r.status, 404, `${method} ${action}`);
    assert.equal(r.body.code, "not_found", `${method} ${action}`);
  }
  const still = (await A(S, rima)("GET", "families")).body.families.find((f: any) => f.token === mine.token);
  assert.equal(still.name, "Demo Family One");
  assert.equal(still.sent, null);
  // a reset key of wedding A cannot be undone from wedding B
  const reset = await A(S, rima)("POST", "reset-all", { confirm: "RESET" });
  assert.equal((await api("POST", "undo-reset", { key: reset.body.snapshot })).status, 404);
  // a helper cookie of wedding A, copied under wedding B's cookie name, does not log in there
  const value = rima.split("=").slice(1).join("=");
  assert.equal((await A(O, `twp_${O}=${value}`)("GET", "me")).status, 401);
});

test("a script cannot sign its actions as Owner or Guest", async () => {
  const r = await call(admin, "POST", `/${S}/api/admin/family`, { headers: { "x-wedding-key": "wedding" }, body: { name: "Script Family", side: "a", max_guests: 1, by: "Owner" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.family.created_by, "script");
});

test("two helpers adding the same family at the same moment: one wins, the other gets duplicate_name", async () => {
  const add = () => A(S, rima)("POST", "family", { name: "Spaced  Family", side: "b", max_guests: 2 });
  const rs = await Promise.all([add(), add(), add()]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409, 409]);
  for (const r of rs.filter((x) => x.status === 409)) assert.equal(r.body.code, "duplicate_name");
});

test("an unreadable 'base' time gives 409 changed, not a server error", async () => {
  const api = A(S, rima);
  const d = (await api("GET", "invite")).body.draft;
  const r = await api("PUT", "invite", { draft: d, base: "not a date" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "changed");
  await api("PUT", "settings", { wa_message_a: "Hi {name} {link} (first edit)" });   // a field only conflicts once someone saved it
  const s = await api("PUT", "settings", { wa_message_a: "Hi {name} {link} (edited)", base: { wa_message_a: "garbage" } });
  assert.equal(s.status, 409);
  assert.equal(s.body.code, "changed");
});

test("broken % escapes in an address give 'not found', not a server error", async () => {
  assert.equal((await call(asset, "GET", `/${S}/asset/%E0%A4%A.png`)).status, 404);
  assert.equal((await call(guest, "GET", `/%E0%A4%A/api/guest?t=AAAAAAAAAA`)).status, 404);
  assert.equal((await call(admin, "GET", `/%E0%A4%A/api/admin/me`)).status, 404);
  assert.equal((await call(invite, "GET", `/%E0%A4%A/api/invite`)).status, 404);
});

test("readability and timing refuse a field that does not exist (as docs/API.md says); old page sizes are clamped when read", () => {
  assert.throws(() => normalizeInvite({ readability: { veil: 50, vail: 10 } }), (e: any) => e.extra.field === "readability.vail");
  assert.throws(() => normalizeInvite({ timing: { envelopeOpenMs: 2000, speed: 2 } }), (e: any) => e.extra.field === "timing.speed");
  assert.equal(normalizeInvite({ readability: { veil: 50 }, timing: { revealSpeed: 2 } }).readability.veil, 50);
  // page sizes saved before the 80% floor / the Countdown's 120% cap: clamped when read, never refused
  const old = { pages: { welcome: { scale: 0.7 }, countdown: { scale: 1.4 }, gift: { scale: 1.4 } } };
  assert.throws(() => normalizeInvite(old), (e: any) => e.extra.field === "pages.welcome.scale");
  const read = normalizeInvite(old, { stored: true }).pages;
  assert.deepEqual([read.welcome.scale, read.countdown.scale, read.gift.scale], [0.8, 1.2, 1.4]);
  assert.equal(resolveInvite("x", old).pages.countdown.scale, 1.2, "the public invite reads the old design without an error");
  const c = clampStoredScales({ mode: "template", pages: { welcome: { scale: 0.7, ink: "#000000" }, countdown: { scale: 1.4 }, rsvp: {} } });
  assert.deepEqual(c.pages, { welcome: { scale: 0.8, ink: "#000000" }, countdown: { scale: 1.2 }, rsvp: {} });
  assert.equal(clampStoredScales(null), null);
});

test("an upload whose random name collides never replaces the file already there", async () => {
  // bug: the file was written to storage BEFORE its name was claimed, so a collision overwrote a picture in use
  const api = A(S, rima);
  const fixed = mock.method(crypto, "randomBytes", (n: number) => Buffer.alloc(n, 0));   // every suffix = "aaaa"
  syncBuiltinESMExports();
  try {
    const first = await api("POST", "upload-asset", { name: "same.png", content_type: "image/png", data_base64: png(1).toString("base64") });
    assert.equal(first.status, 200);
    assert.equal(first.body.name, "same-aaaa.png");
    const second = await api("POST", "upload-asset", { name: "same.png", content_type: "image/png", data_base64: png(2).toString("base64") });
    assert.notEqual(second.status, 200);
    assert.ok(second.body.error && !/stack|Error:/.test(second.body.error));
    const got = await call(asset, "GET", `/${S}/asset/same-aaaa.png`);
    assert.equal(Buffer.from(await got.raw.arrayBuffer()).equals(png(1)), true, "the first file is untouched");
    assert.equal((await query("select count(*)::int as n from assets where name = 'same-aaaa.png'"))[0].n, 1);
  } finally { fixed.mock.restore(); syncBuiltinESMExports(); }
});

test("change-password: wrong current passwords lock out like login", async () => {
  const api = A(S, rima);
  const ip = { "x-nf-client-connection-ip": "10.9.9.9" };
  const cp = () => call(admin, "POST", `/${S}/api/admin/change-password`, { cookie: rima, headers: ip, body: { current: "guess", new: "whatever" } });
  for (let i = 0; i < 4; i++) assert.equal((await cp()).body.code, "wrong_password");
  assert.equal((await cp()).status, 429);
  assert.equal((await cp()).body.code, "locked");
  assert.equal((await api("GET", "me")).status, 200, "still logged in; nothing changed");
  await query("delete from login_attempts");
});

test("DELETE family with a token this wedding never had is 404, a removed one is already_removed", async () => {
  const api = A(S, rima);
  assert.equal((await api("DELETE", "family", { token: "ZZZZZZZZZZ" })).status, 404);
  const f = await addFamily(S, rima, "Gone Soon Family", "a", 1);
  assert.equal((await api("DELETE", "family", { token: f.token })).body.ok, true);
  assert.equal((await api("DELETE", "family", { token: f.token })).body.already_removed, true);
});

test("time zones: region names only, stored in their proper spelling", () => {
  assert.equal(vTimezone("asia/beirut"), "Asia/Beirut");
  assert.equal(vTimezone(""), "Asia/Beirut");
  assert.equal(vTimezone("Europe/London"), "Europe/London");
  for (const bad of ["+02:00", "Mars/Olympus", "Asia/Beirut; drop", "../x"])
    assert.throws(() => vTimezone(bad), (e: any) => e.extra.code === "bad_timezone", bad);
});

test("archived: every write answers 410 with the plain sentence; reads work; unarchive restores writes", async () => {
  const f = await addFamily(S, rima, "Archive Test Family", "a", 2);
  await M("POST", "archive", { slug: S });
  const api = A(S, rima);
  const d = (await api("GET", "invite")).body.draft;
  for (const [method, action, body] of [
    ["POST", "family", { name: "X", side: "a", max_guests: 1 }], ["PATCH", "family", { token: f.token, max_guests: 3 }],
    ["DELETE", "family", { token: f.token, force: true }], ["POST", "upload", { side: "a", families: [] }],
    ["POST", "mark-sent", { token: f.token, kind: "invite" }], ["PUT", "settings", { wa_message_a: "{link}" }],
    ["POST", "reset-family", { token: f.token }], ["POST", "reset-all", { confirm: "RESET" }], ["POST", "undo-reset", { key: "1" }],
    ["PUT", "invite", { draft: d }], ["POST", "publish", {}], ["POST", "discard-draft", {}],
    ["POST", "upload-asset", { name: "a.png", content_type: "image/png", data_base64: png(3).toString("base64") }],
    ["DELETE", "asset", { name: "same-aaaa.png" }], ["POST", "change-password", { current: "wedding", new: "abcdef" }],
  ] as const) {
    const r = await api(method, action, body);
    assert.equal(r.status, 410, `${method} ${action}`);
    assert.deepEqual(r.body, { error: "This wedding is archived", code: "archived" });
  }
  assert.equal((await call(rsvp, "POST", `/${S}/api/rsvp`, { body: { t: f.token, attending: false } })).status, 410);
  for (const action of ["families", "settings", "activity", "helpers", "invite", "export", "removed", "last-reset"])
    assert.equal((await api("GET", action)).status, 200, action);
  assert.equal((await api("POST", "hello", {})).status, 200);
  assert.equal((await call(invite, "GET", `/${S}/api/invite`)).body.status, "archived");
  await M("POST", "unarchive", { slug: S });
  assert.equal((await api("PATCH", "family", { token: f.token, max_guests: 3 })).status, 200);
});

test("backups: one snapshot of every table; restore races and a wrong confirm never overwrite a wedding", async () => {
  const doc = await dump();
  const w = doc.weddings.find((x: any) => x.wedding.slug === S);
  for (const k of ["families", "rsvps", "sends", "opens", "activity", "settings", "invite", "helpers", "assets", "resets"]) assert.ok(k in w, k);
  assert.ok(w.wedding.password_hash.startsWith("scrypt$"));
  assert.ok(w.assets.some((a: any) => a.name === "same-aaaa.png"));
  const nb = await M("POST", "backup-now");
  const key = nb.body.backup.blob_key;
  // two restores into the same new address at once: one wins, the other is told the address is taken
  const go = () => M("POST", "restore", { blob_key: key, slug: S, into_slug: "race-copy", preview: false });
  const rs = await Promise.all([go(), go()]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(rs.find((r) => r.status === 409)!.body.code, "slug_taken");
  assert.ok((await blobs("assets").list("race-copy/")).includes("race-copy/same-aaaa.png"));
  // restoring wedding S's backup over another existing wedding needs that wedding's address typed
  const r = await M("POST", "restore", { blob_key: key, slug: S, into_slug: O, preview: false, confirm: O });
  assert.equal(r.body.code, "slug_taken");
  assert.equal((await M("POST", "restore", { blob_key: key, slug: S, preview: false, confirm: O })).body.code, "confirm_required");
});

test("health says which file stores this deploy uses (production names here)", async () => {
  const h = (await M("GET", "health")).body;
  assert.deepEqual(h.storage, { context: null, assets: "assets", backups: "backups" });
});

test("activity polling has an index on (wedding_id, id)", async () => {
  const rows = await query("select indexdef from pg_indexes where tablename = 'activity'");
  assert.ok(rows.some((r) => /\(wedding_id, id DESC\)/.test(r.indexdef)), JSON.stringify(rows));
});

test("netlify/functions holds only real endpoints; shared helpers live in _lib/ (not deployed as functions)", () => {
  const dir = new URL("../netlify/functions/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => /\.(ts|js|mjs|cjs|mts|cts)$/.test(x))) {
    assert.ok(!f.startsWith("_"), `${f} would be deployed as a function: move it to netlify/functions/_lib/`);
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.match(src, /export default async/, `${f} has no handler`);
    assert.match(src, /export const config: Config = \{ (path|schedule): /, `${f} has no address or schedule`);
  }
  const lib = readdirSync(new URL("_lib/", dir));
  assert.ok(!lib.includes("_lib.ts") && !lib.includes("index.ts"), "_lib/ must not have an entry file, or Netlify would deploy it");
});
