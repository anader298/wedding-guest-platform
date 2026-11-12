// tests/db.test.ts: the database layer and the date/text helpers.
//notes: also guards two promises: TEMPLATE_CONFIG equals app.js CONFIG, and deploy previews never write or
//   delete in the live Blobs stores (storeName / Netlify.context.deploy, see _blobs.ts).
import "./_env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, schemaVersion, query, tx, migrationFiles } from "../netlify/functions/_lib/_db.ts";
import { dateConfig, zonedToUtc, defaultTexts, TEMPLATE_CONFIG, vPhone, vSlug, newWeddingInvite } from "../netlify/functions/_lib/_wedding.ts";
import { hashPassword, verifyPassword } from "../netlify/functions/_lib/_auth.ts";
import { normalizeInvite } from "../netlify/functions/_lib/_invite.ts";
import { storeName, blobs } from "../netlify/functions/_lib/_blobs.ts";

test("migrations apply, and applying again changes nothing", async () => {
  await migrate();
  const v = await schemaVersion();
  assert.equal(v, migrationFiles().at(-1)!.version);
  assert.equal(await migrate(), 0);
  assert.equal(await migrate(), 0);
  const tables = (await query("select table_name from information_schema.tables where table_schema = 'public'")).map((r) => r.table_name);
  for (const t of ["weddings", "families", "rsvps", "sends", "opens", "activity", "helpers", "settings", "invites", "assets", "resets", "backups", "schema_version"])
    assert.ok(tables.includes(t), t);
});

test("a failed transaction saves nothing", async () => {
  await assert.rejects(tx(async (q) => {
    await q.query("insert into backups (blob_key, weddings, families, bytes, ok) values ('x', 0, 0, 0, true)");
    throw new Error("boom");
  }));
  assert.equal((await query("select count(*)::int as n from backups"))[0].n, 0);
});

test("dates in the wedding's time zone reproduce the template exactly", () => {
  const at = zonedToUtc("2027-06-19", "18:30", "Asia/Beirut");
  assert.equal(at, "2027-06-19T15:30:00.000Z");
  assert.deepEqual(dateConfig(at, "Asia/Beirut"), TEMPLATE_CONFIG.date);
  // summer time in Beirut is +03:00
  assert.equal(dateConfig(zonedToUtc("2027-06-05", "09:05", "Asia/Beirut"), "Asia/Beirut").iso, "2027-06-05T09:05:00+03:00");
});

test("default WhatsApp texts match the template texts for Karim & Maya", () => {
  const t = defaultTexts({ groom: "Karim", bride: "Maya", ar: "كريم و مايا", dateEn: TEMPLATE_CONFIG.date.en, dateAr: TEMPLATE_CONFIG.date.ar, replyBy: "2027-05-15" });
  assert.equal(t.wa_message_a, "Dear {name},\n\nWith great joy, Karim & Maya invite you to celebrate their wedding on Saturday 19 June 2027.\n\nبكل فرح، يتشرف كريم و مايا بدعوتكم لحضور حفل زفافهما يوم السبت ١٩ حزيران ٢٠٢٧.\n\nPlease open your personal invitation and let us know if you can join us:\nالرجاء فتح الدعوة وتأكيد الحضور:\n{link}");
  assert.equal(t.wa_reminder_b, "Dear {name}, a gentle reminder to RSVP for Karim & Maya's wedding before 15 May.\nتذكير لطيف بتأكيد الحضور لحفل زفاف كريم و مايا قبل ١٥ أيار.\n{link}");
});

test("passwords are hashed with scrypt and verified", async () => {
  const h = await hashPassword("wedding");
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(await verifyPassword("wedding", h));
  assert.ok(!(await verifyPassword("Wedding", h)));
  assert.ok(!(await verifyPassword("", h)));
});

test("input checks", () => {
  assert.equal(vPhone("+961 70-000 002"), "+96170000002");
  assert.equal(vPhone("00961 70 000 002"), "+96170000002");
  assert.equal(vPhone(""), null);
  assert.throws(() => vPhone("12ab"));
  assert.throws(() => vSlug("manage"), /used by the site/);
  assert.throws(() => vSlug("A b"));
  assert.equal(vSlug("karim-and-maya"), "karim-and-maya");
});

test("invite designs are checked; bad colours and unknown files are refused", () => {
  const inv = newWeddingInvite({ groom: "Adam", bride: "Eve", eventAt: "2027-06-05T16:30:00.000Z", timezone: "Asia/Beirut", replyBy: "2027-05-08" });
  const n = normalizeInvite({ ...inv, extra: 1 } as any);
  assert.equal((n as any).extra, undefined);
  assert.equal(n.config.couple.monogram, "A & E");
  assert.equal(n.show.gift, false);
  assert.throws(() => normalizeInvite({ ...inv, theme: { ...inv.theme, gold: "red;}" } }), (e: any) => e.extra.code === "invalid_invite");
  assert.throws(() => normalizeInvite({ ...inv, assets: { ...inv.assets, couple: "../x.png" } }), (e: any) => e.extra.field === "assets.couple");
  assert.throws(() => normalizeInvite({ ...inv, config: { ...inv.config, couple: { groom: 5 } } }), (e: any) => e.extra.field === "config.couple.groom");
});

test("TEMPLATE_CONFIG is exactly CONFIG from site/app/app.js (minus demoGuest)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../site/app/app.js", import.meta.url), "utf8");
  const m = /const CONFIG = (\{[\s\S]*?\n\});/.exec(src);
  assert.ok(m, "CONFIG block found in app.js");
  const cfg = new Function(`return (${m![1]});`)();
  delete cfg.demoGuest;
  assert.deepEqual(cfg, TEMPLATE_CONFIG);
});

test("deploy previews and branch deploys get their own picture/backup stores", () => {
  assert.equal(storeName("assets", {}), "assets", "no CONTEXT (laptop, tests) = production names");
  assert.equal(storeName("assets", { CONTEXT: "production", BRANCH: "main" }), "assets");
  assert.equal(storeName("backups", { CONTEXT: "production" }), "backups");
  assert.equal(storeName("assets", { CONTEXT: "deploy-preview", BRANCH: "Fix/Upload Size!" }), "assets-deploy-preview-fix-upload-size");
  assert.equal(storeName("backups", { CONTEXT: "branch-deploy", BRANCH: "staging" }), "backups-branch-deploy-staging");
  assert.equal(storeName("assets", { CONTEXT: "deploy-preview", DEPLOY_ID: "65ab12cd" }), "assets-deploy-preview-65ab12cd");
  assert.equal(storeName("assets", { CONTEXT: "dev" }), "assets-dev-unknown");
  assert.notEqual(storeName("assets", { CONTEXT: "deploy-preview", BRANCH: "main" }), storeName("assets", { CONTEXT: "production", BRANCH: "main" }));
});

test("at runtime the deploy context comes from Netlify.context.deploy, not process.env.CONTEXT", () => {
  // On Netlify, functions get no CONTEXT/BRANCH/DEPLOY_ID env vars; the runtime global is the signal.
  assert.equal(storeName("assets", {}, { context: "deploy-preview", id: "65AB12cd" }), "assets-deploy-preview-65ab12cd");
  assert.equal(storeName("backups", {}, { context: "branch-deploy", id: "abc" }), "backups-branch-deploy-abc");
  assert.equal(storeName("assets", {}, { context: "production", id: "abc" }), "assets");
  assert.equal(storeName("assets", { CONTEXT: "deploy-preview" }, { context: "production", id: "x" }), "assets", "runtime wins over env");
  const g = globalThis as any, before = g.Netlify;
  try {
    g.Netlify = { context: { deploy: { context: "deploy-preview", id: "d1", published: false } } };
    assert.equal(storeName("assets"), "assets-deploy-preview-d1", "default argument reads the global");
    g.Netlify = { context: null };
    assert.equal(storeName("assets", {}), "assets", "no request context = production names");
  } finally { g.Netlify = before; }
});

test("a deploy preview reads live files but can never overwrite or delete them", async () => {
  const g = globalThis as any, before = g.Netlify;
  try {
    g.Netlify = undefined;
    await blobs("assets").set("preview-check/live.jpg", "LIVE");
    g.Netlify = { context: { deploy: { context: "deploy-preview", id: "p1", published: false } } };
    const pv = blobs("assets");
    assert.equal(new TextDecoder().decode((await pv.get("preview-check/live.jpg"))!), "LIVE", "preview sees live pictures");
    await pv.set("preview-check/live.jpg", "PREVIEW");
    await pv.set("preview-check/new.jpg", "NEW");
    assert.equal(new TextDecoder().decode((await pv.get("preview-check/live.jpg"))!), "PREVIEW");
    assert.deepEqual(await pv.list("preview-check/"), ["preview-check/live.jpg", "preview-check/new.jpg"]);
    await pv.delete("preview-check/live.jpg");
    await pv.delete("preview-check/new.jpg");
    g.Netlify = undefined;
    const live = blobs("assets");
    assert.equal(new TextDecoder().decode((await live.get("preview-check/live.jpg"))!), "LIVE", "live file untouched");
    assert.equal(await live.get("preview-check/new.jpg"), null, "preview upload never reached live");
  } finally { g.Netlify = before; }
});
