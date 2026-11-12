// tests/manage.test.ts: the owner's manager API: login, create/update/archive/delete, data, check, backups and restore.
//notes: backups and uploads go to in-memory Blobs (BLOBS_DRIVER=memory); restore tests check the preview first.
import "./_env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, handlers, ownerLogin, createWedding, helperLogin, addFamily, A } from "./_helpers.ts";
import { query, migrationFiles } from "../netlify/functions/_lib/_db.ts";
import nightly from "../netlify/functions/backup-nightly.ts";
import { blobs } from "../netlify/functions/_lib/_blobs.ts";

const { manage, guest, rsvp, invite, asset } = handlers;
let owner = "";
const M = (method: string, action: string, body?: unknown) => call(manage, method, `/api/manage/${action}`, { cookie: owner, body });

test("owner password key is accepted in lowercase too", async () => {
  const saved = process.env.OWNER_PASSWORD;
  delete process.env.OWNER_PASSWORD;
  process.env.owner_password = " lower-secret\n";
  try {
    const { ownerPassword } = await import("../netlify/functions/_lib/_auth.ts");
    assert.equal(ownerPassword(), "lower-secret");
  } finally { delete process.env.owner_password; process.env.OWNER_PASSWORD = saved; }
});

test("owner login fails closed without OWNER_PASSWORD", async () => {
  assert.equal((await call(manage, "POST", "/api/manage/login", { body: { password: "x" } })).status, 401);
  assert.equal((await call(manage, "GET", "/api/manage/weddings")).status, 401);
  const saved = process.env.OWNER_PASSWORD;
  delete process.env.OWNER_PASSWORD;
  const r = await call(manage, "POST", "/api/manage/login", { body: { password: "" } });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "owner_password_missing");
  process.env.OWNER_PASSWORD = saved;
  owner = await ownerLogin();
  const https = await manage(new Request("https://test.local/api/manage/login", { method: "POST", body: JSON.stringify({ password: "owner-secret" }) }));
  assert.match(https.headers.get("set-cookie")!, /^twp_owner=.+; Path=\/; .*HttpOnly; Secure; SameSite=Lax$/);
  assert.match((await call(manage, "POST", "/api/manage/login", { body: { password: "owner-secret" } })).setCookie!, /HttpOnly; SameSite=Lax$/);
  delete process.env.OWNER_PASSWORD;
  assert.equal((await M("GET", "me")).status, 401, "an old owner cookie stops working too");
  process.env.OWNER_PASSWORD = saved;
  assert.deepEqual((await M("GET", "me")).body, { ok: true, owner: true });
});

test("create: validation, defaults, slug rules", async () => {
  assert.equal((await M("POST", "create", { slug: "manage", groom: "A", bride: "B", event_date: "2027-01-01" })).body.code, "reserved_slug");
  assert.equal((await M("POST", "create", { slug: "Bad Slug", groom: "A", bride: "B", event_date: "2027-01-01" })).body.code, "bad_slug");
  assert.equal((await M("POST", "create", { slug: "ok-slug", groom: "A", bride: "B", event_date: "2027-02-30" })).body.code, "bad_date");
  assert.equal((await M("POST", "create", { slug: "ok-slug", groom: "A", bride: "B", event_date: "2027-02-03", timezone: "Mars/Base" })).body.code, "bad_timezone");
  assert.equal((await M("POST", "create", { slug: "ok-slug", groom: "A", bride: "B", event_date: "2027-02-03", password: "ab" })).body.code, "too_short");
  const c = await createWedding(owner, { slug: "adam-and-eve", reply_by: "2027-05-01" });
  assert.equal(c.wedding.event_date, "2027-06-05");
  assert.equal(c.wedding.event_time, "19:30");
  assert.equal(c.wedding.timezone, "Asia/Beirut");
  assert.equal(c.wedding.reply_by, "2027-05-01");
  assert.equal(c.wedding.password_hash, undefined);
  assert.deepEqual(c.links, { invite_base: "http://test.local/adam-and-eve/", admin: "http://test.local/adam-and-eve/admin/", password: "wedding" });
  assert.equal((await M("POST", "create", { slug: "adam-and-eve", groom: "A", bride: "B", event_date: "2027-01-01" })).body.code, "slug_taken");
  const inv = (await call(invite, "GET", "/adam-and-eve/api/invite")).body;
  assert.equal(inv.config.couple.monogram, "A & E");
  assert.equal(inv.config.rsvp.replyByEn, "Please reply before May 1");
  assert.equal(inv.config.gift.accountNumber, "", "another couple's gift account is never copied");
  assert.equal(inv.show.gift, false);
  assert.equal(inv.config.families.en.father1, "");
  const rima = await helperLogin("adam-and-eve");
  const s = (await A("adam-and-eve", rima)("GET", "settings")).body;
  assert.ok(s.wa_message_a.includes("Adam & Eve invite you to celebrate their wedding on Saturday 5 June 2027"));
  assert.ok(s.wa_reminder_b.includes("before 1 May"));
});

test("copy_from_slug copies the design and pictures with the new names and date", async () => {
  const rima = await helperLogin("adam-and-eve");
  const api = A("adam-and-eve", rima);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]);
  const up = (await api("POST", "upload-asset", { name: "couple.png", content_type: "image/png", data_base64: png.toString("base64") })).body;
  const d = (await api("GET", "invite")).body.draft;
  d.assets.couple = up.name;
  d.theme.gold = "#aa0000";
  d.config.venue.name = "Same Hall";
  await api("PUT", "invite", { draft: d });
  await api("POST", "publish", {});
  const c = await M("POST", "create", { slug: "copy-wedding", groom: "Omar", bride: "Lina", event_date: "2027-09-10", copy_from_slug: "adam-and-eve" });
  assert.equal(c.status, 200);
  const inv = (await call(invite, "GET", "/copy-wedding/api/invite")).body;
  assert.equal(inv.theme.gold, "#aa0000");
  assert.equal(inv.config.venue.name, "Same Hall");
  assert.equal(inv.config.couple.groom, "Omar");
  assert.equal(inv.config.date.en, "Friday 10 September 2027");
  assert.equal(inv.assets.couple, `/.netlify/images?url=/copy-wedding/asset/${up.name}&w=1170&fm=webp&q=80`);
  assert.equal((await call(asset, "GET", `/copy-wedding/asset/${up.name}`)).status, 200);
  assert.equal((await M("POST", "create", { slug: "x-wedding", groom: "A", bride: "B", event_date: "2027-01-01", copy_from_slug: "nope" })).body.code, "no_wedding");
});

test("update changes names/date in the wedding and its design; set-password logs helpers out", async () => {
  const rima = await helperLogin("copy-wedding");
  const r = await M("POST", "update", { slug: "copy-wedding", groom: "Omar", bride: "Leena", event_time: "20:00", reply_by: "2027-08-20", notes: "VIP" });
  assert.equal(r.body.invite_updated, true);
  assert.equal(r.body.wedding.bride, "Leena");
  assert.equal(r.body.wedding.event_time, "20:00");
  assert.equal(r.body.wedding.reply_by, "2027-08-20");
  const inv = (await call(invite, "GET", "/copy-wedding/api/invite")).body;
  assert.equal(inv.config.couple.monogram, "O & L");
  assert.equal(inv.config.couple.bride, "Leena");
  assert.equal(inv.config.date.timeEn, "8:00 PM");
  assert.equal(inv.config.rsvp.replyByEn, "Please reply before August 20");
  assert.equal((await M("POST", "set-password", { slug: "copy-wedding", password: "x" })).body.code, "too_short");
  assert.equal((await M("POST", "set-password", { slug: "copy-wedding", password: "fresh-pass" })).body.ok, true);
  assert.equal((await A("copy-wedding", rima)("GET", "me")).status, 401);
  await helperLogin("copy-wedding", "Rima", "fresh-pass");
});

test("weddings list with counts, data filters and the check report", async () => {
  const rima = await helperLogin("adam-and-eve");
  const a = await addFamily("adam-and-eve", rima, "The Demo Family", "a", 4, { phone: "70000002" });
  const b = await addFamily("adam-and-eve", rima, "Demo Family", "b", 2);
  await addFamily("adam-and-eve", rima, "Sample Family Three", "b", 3);
  await A("adam-and-eve", rima)("POST", "mark-sent", { token: a.token, kind: "invite" });
  await A("adam-and-eve", rima)("POST", "mark-sent", { token: b.token, kind: "invite" });
  await call(guest, "GET", `/adam-and-eve/api/guest?t=${a.token}`);
  await call(rsvp, "POST", "/adam-and-eve/api/rsvp", { body: { t: a.token, attending: true, guests: 3, guest_names: ["x", "y", "z"] } });
  await call(rsvp, "POST", "/adam-and-eve/api/rsvp", { body: { t: b.token, attending: false } });
  const ws = (await M("GET", "weddings")).body.weddings;
  const w = ws.find((x: any) => x.slug === "adam-and-eve");
  assert.deepEqual(w.counts, { families: 3, sent: 2, opened: 1, answered: 2, coming: 1, not_coming: 1, seats: 9, guests_coming: 3 });
  assert.equal(w.last_activity.by, "Guest");
  assert.ok(w.published_at);
  assert.equal(w.links.admin, "http://test.local/adam-and-eve/admin/");

  const all = (await M("GET", "data")).body.rows;
  assert.equal(all.length, 3);
  const coming = (await M("GET", "data?status=coming")).body.rows;
  assert.equal(coming.length, 1);
  assert.equal(coming[0].family, "The Demo Family");
  assert.equal(coming[0].wedding, "Adam & Eve");
  assert.equal(coming[0].side_name, "Adam");
  assert.deepEqual(coming[0].guest_names, ["x", "y", "z"]);
  assert.equal(coming[0].link, `http://test.local/adam-and-eve/?t=${a.token}`);
  assert.equal((await M("GET", "data?status=not_sent")).body.rows.length, 1);
  assert.equal((await M("GET", "data?side=b&status=not_coming")).body.rows[0].family, "Demo Family");
  assert.equal((await M("GET", "data?q=sample")).body.rows.length, 1);
  assert.equal((await M("GET", "data?status=bogus")).status, 400);

  // make one invite look old, and force an over-capacity answer
  await query("update sends set at = now() - interval '20 days' where family_id = (select id from families where token = $1)", [b.token]);
  await query("update families set max_guests = 2 where token = $1", [a.token]);
  const issues = (await M("GET", "check?slug=adam-and-eve")).body.issues;
  const kinds = issues.map((i: any) => i.kind).sort();
  assert.ok(kinds.includes("duplicate_name"), "The Demo Family vs Demo Family");
  assert.ok(kinds.includes("over_capacity"));
  assert.ok(kinds.includes("never_opened"));
  assert.ok(kinds.includes("bad_phone"));
  assert.ok(!kinds.includes("not_published"));
  const allIssues = (await M("GET", "check")).body.issues;
  assert.ok(allIssues.some((i: any) => i.slug === "copy-wedding"), "check without slug covers every live wedding");
  assert.ok(issues.every((i: any) => typeof i.text === "string" && i.text.length > 10));
});

test("backup, then restore into a new slug (round trip) and over the same slug (with confirm)", async () => {
  const nb = await nightly();
  assert.equal(nb.status, 200);
  const day = new Date().toISOString().slice(0, 10);
  assert.ok((await blobs("backups").list(day)).includes(`${day}/all.json`));
  const now = await M("POST", "backup-now");
  assert.equal(now.body.ok, true);
  assert.match(now.body.backup.blob_key, /^\d{4}-\d{2}-\d{2}\/manual-\d{6}\.json$/);
  assert.equal(now.body.backup.weddings, 2);
  const list = (await M("GET", "backups")).body.backups;
  assert.equal(list.length, 2);
  const key = now.body.backup.blob_key;

  const before = (await M("GET", "export?slug=adam-and-eve")).body;
  const p = await M("POST", "restore", { blob_key: key, slug: "adam-and-eve", into_slug: "adam-copy", preview: true });
  assert.equal(p.body.preview, true);
  assert.equal(p.body.exists, false);
  assert.deepEqual(p.body.backup, { families: 3, answered: 2, sent: 2 });
  assert.equal((await M("GET", "export?slug=adam-copy")).status, 404, "preview wrote nothing");
  const r = await M("POST", "restore", { blob_key: key, slug: "adam-and-eve", into_slug: "adam-copy", preview: false });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.families, 3);
  const after = (await M("GET", "export?slug=adam-copy")).body;
  const strip = (e: any) => ({ families: e.families.map((f: any) => [f.token, f.name, f.side, f.max_guests, f.phone]), rsvps: e.rsvps.map((x: any) => [x.token, x.attending, x.guests, x.guest_names]),
    sends: e.sends.map((x: any) => [x.token, x.kind, x.by]), opens: e.opens.map((x: any) => [x.token, x.count]), settings: Object.keys(e.settings), live: e.invite.live });
  assert.deepEqual(strip(after), strip(before));
  // same tokens work under the new address, with the same password
  const fam = before.families[0];
  assert.equal((await call(guest, "GET", `/adam-copy/api/guest?t=${fam.token}&preview=1`)).body.name, fam.name);
  await helperLogin("adam-copy", "Rima", "wedding");
  assert.equal((await M("POST", "restore", { blob_key: key, slug: "adam-and-eve", into_slug: "adam-copy", preview: false })).body.code, "slug_taken");

  // over the same slug: preview shows the difference, applying needs confirm and saves a safety copy first
  const rima = await helperLogin("adam-and-eve");
  await addFamily("adam-and-eve", rima, "Added After Backup", "a", 1);
  const p2 = await M("POST", "restore", { blob_key: key, slug: "adam-and-eve" });
  assert.equal(p2.body.preview, true);
  assert.equal(p2.body.exists, true);
  assert.deepEqual(p2.body.will_remove, ["Added After Backup"]);
  assert.equal((await M("POST", "restore", { blob_key: key, slug: "adam-and-eve", preview: false })).body.code, "confirm_required");
  const r2 = await M("POST", "restore", { blob_key: key, slug: "adam-and-eve", preview: false, confirm: "adam-and-eve" });
  assert.equal(r2.body.ok, true);
  assert.match(r2.body.safety_backup, /before-restore-adam-and-eve-\d{6}\.json$/);
  const names = (await M("GET", "export?slug=adam-and-eve")).body.families.map((f: any) => f.name);
  assert.ok(!names.includes("Added After Backup"));
  assert.equal((await M("POST", "restore", { blob_key: "2020-01-01/nope.json", slug: "adam-and-eve" })).status, 404);
  // a picture whose file is gone is listed in the preview and falls back to the template picture
  const [pic] = await query("select a.name, a.blob_key from assets a join weddings w on w.id = a.wedding_id where w.slug = 'adam-and-eve'");
  await blobs("assets").delete(pic.blob_key);
  const p3 = await M("POST", "restore", { blob_key: key, slug: "adam-and-eve" });
  assert.deepEqual(p3.body.missing_pictures, [pic.name]);
  assert.deepEqual(p.body.missing_pictures, []);
});

test("delete needs the slug typed, returns the export, removes rows and files", async () => {
  assert.equal((await M("POST", "delete", { slug: "copy-wedding", confirm: "copy" })).body.code, "confirm_required");
  const r = await M("POST", "delete", { slug: "copy-wedding", confirm: "copy-wedding" });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.export.wedding.slug, "copy-wedding");
  assert.equal((await M("GET", "export?slug=copy-wedding")).status, 404);
  assert.deepEqual(await blobs("assets").list("copy-wedding/"), []);
  assert.equal((await call(invite, "GET", "/copy-wedding/api/invite")).status, 404);
});

test("health", async () => {
  const h = (await M("GET", "health")).body;
  assert.equal(h.db_ok, true);
  assert.equal(h.version, migrationFiles().at(-1)!.version);
  assert.ok(h.weddings >= 2);
  assert.ok(h.last_backup.ok);
});
