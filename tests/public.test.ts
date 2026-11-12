// tests/public.test.ts: the guest side: guest lookup, RSVP rules, token isolation, the invite design, archive.
//notes: the "never leaks contacts" checks protect the rule that phone numbers and e-mails never reach the public invite; keep them when adding fields.
import "./_env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, handlers, ownerLogin, createWedding, helperLogin, addFamily, A } from "./_helpers.ts";

const { guest, rsvp, invite, manage } = handlers;
let owner = "", rima = "", fam: any;

test("setup: a wedding with one family", async () => {
  owner = await ownerLogin();
  const c = await createWedding(owner);
  assert.equal(c.links.invite_base, "http://test.local/test-wedding/");
  assert.equal(c.links.password, "wedding");
  rima = await helperLogin("test-wedding");
  fam = await addFamily("test-wedding", rima, "The Demo Family", "a", 3, { phone: "+961 70 000 000", email: "demo@example.com" });
  assert.match(fam.token, /^[A-Z2-7]{10}$/);
});

test("guest lookup returns name and seats only, and records opens (not in preview)", async () => {
  const p = await call(guest, "GET", `/test-wedding/api/guest?t=${fam.token}&preview=1`);
  assert.equal(p.status, 200);
  assert.deepEqual(Object.keys(p.body).sort(), ["max_guests", "name", "response"]);
  let f = (await A("test-wedding", rima)("GET", "families")).body.families[0];
  assert.equal(f.opened, null);
  await call(guest, "GET", `/test-wedding/api/guest?t=${fam.token.toLowerCase()}`);
  await call(guest, "GET", `/test-wedding/api/guest?t=${fam.token}`);
  f = (await A("test-wedding", rima)("GET", "families")).body.families[0];
  assert.equal(f.opened.count, 2);
  const acts = (await A("test-wedding", rima)("GET", "activity")).body.events.filter((e: any) => e.action === "opened");
  assert.equal(acts.length, 1, "only the first open is logged");
  assert.equal((await call(guest, "GET", `/test-wedding/api/guest?t=AAAAAAAAAA`)).status, 404);
  assert.equal((await call(guest, "GET", `/test-wedding/api/guest`)).status, 404);
  assert.equal((await call(guest, "GET", `/nope/api/guest?t=${fam.token}`)).body.error, "unknown invitation");
});

test("RSVP clamps guests, needs names, and preview saves nothing", async () => {
  const url = "/test-wedding/api/rsvp";
  let r = await call(rsvp, "POST", url, { body: { t: fam.token, attending: "yes", guests: 9, guest_names: ["A", "B"] } });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "names_required");
  assert.equal(r.body.needed, 3);
  assert.equal(r.body.given, 2);
  r = await call(rsvp, "POST", url, { body: { t: fam.token, attending: 1, guests: 0, guest_names: ["  Solo  "] } });
  assert.equal(r.body.response.guests, 1);
  assert.deepEqual(r.body.response.guest_names, ["Solo"]);
  r = await call(rsvp, "POST", url, { body: { t: fam.token, attending: true, guests: 2, guest_names: ["A", "", "B", "C"], preview: true } });
  assert.equal(r.body.preview, true);
  assert.equal(r.body.saved, false);
  assert.deepEqual(r.body.response.guest_names, ["A", "B"]);
  let g = await call(guest, "GET", `/test-wedding/api/guest?t=${fam.token}&preview=1`);
  assert.equal(g.body.response.guests, 1, "preview did not overwrite");
  r = await call(rsvp, "POST", url, { body: { t: fam.token, attending: false, guests: 3, note: "x".repeat(900) } });
  assert.equal(r.body.response.guests, 0);
  assert.equal(r.body.response.note.length, 500);
  g = await call(guest, "GET", `/test-wedding/api/guest?t=${fam.token}&preview=1`);
  assert.equal(g.body.response.attending, false);
  const ans = (await A("test-wedding", rima)("GET", "activity")).body.events.filter((e: any) => e.action === "answered");
  assert.equal(ans.length, 2);
  assert.equal(ans[0].details.changed, true);
});

test("a token only works under its own wedding", async () => {
  await createWedding(owner, { slug: "other-wedding", groom: "Ali", bride: "Mia" });
  const zeina = await helperLogin("other-wedding", "Yara");
  const other = await addFamily("other-wedding", zeina, "The Demo Family", "b", 2);
  assert.equal((await call(guest, "GET", `/other-wedding/api/guest?t=${fam.token}`)).status, 404);
  assert.equal((await call(guest, "GET", `/test-wedding/api/guest?t=${other.token}`)).status, 404);
  assert.equal((await call(rsvp, "POST", "/other-wedding/api/rsvp", { body: { t: fam.token, attending: false } })).status, 404);
  // each wedding's helper sees only its own families, and a helper cookie does not open another wedding
  assert.equal((await A("other-wedding", zeina)("GET", "families")).body.families.length, 1);
  assert.equal((await A("other-wedding", rima)("GET", "families")).status, 401);
});

test("invite: live is public, draft needs a login; never any phone or e-mail", async () => {
  const r = await call(invite, "GET", "/test-wedding/api/invite");
  assert.equal(r.status, 200);
  assert.equal(r.body.slug, "test-wedding");
  assert.equal(r.body.status, "live");
  assert.equal(r.body.mode, "template");
  assert.equal(r.body.config.couple.groom, "Adam");
  assert.equal(r.body.config.date.iso, "2027-06-05T19:30:00+03:00");
  assert.equal(r.body.assets.envelope, "/test-wedding/envelope.jpg");
  assert.equal(r.body.theme.gold, "#b8975a");
  assert.ok(!JSON.stringify(r.body).includes("example.com"));
  assert.ok(!JSON.stringify(r.body).includes("961"));
  assert.equal((await call(invite, "GET", "/test-wedding/api/invite?draft=1")).status, 401);
  assert.equal((await call(invite, "GET", "/test-wedding/api/invite?draft=1", { cookie: rima })).status, 200);
  assert.equal((await call(invite, "GET", "/test-wedding/api/invite?draft=1", { cookie: owner })).status, 200);
  assert.equal((await call(invite, "GET", "/manage/api/invite")).status, 404);
});

test("archived: RSVP and admin writes answer 410, reads keep working", async () => {
  assert.equal((await call(manage, "POST", "/api/manage/archive", { cookie: owner, body: { slug: "test-wedding" } })).body.wedding.status, "archived");
  const r = await call(rsvp, "POST", "/test-wedding/api/rsvp", { body: { t: fam.token, attending: false } });
  assert.equal(r.status, 410);
  assert.deepEqual(r.body, { error: "This wedding is archived", code: "archived" });
  assert.equal((await A("test-wedding", rima)("POST", "family", { name: "New", side: "a", max_guests: 1 })).status, 410);
  assert.equal((await A("test-wedding", rima)("POST", "mark-sent", { token: fam.token, kind: "invite" })).status, 410);
  assert.equal((await A("test-wedding", rima)("GET", "families")).status, 200);
  assert.equal((await call(guest, "GET", `/test-wedding/api/guest?t=${fam.token}`)).status, 200);
  assert.equal((await call(invite, "GET", "/test-wedding/api/invite")).body.status, "archived");
  assert.equal((await call(manage, "POST", "/api/manage/unarchive", { cookie: owner, body: { slug: "test-wedding" } })).body.wedding.status, "live");
  assert.equal((await call(rsvp, "POST", "/test-wedding/api/rsvp", { body: { t: fam.token, attending: false } })).status, 200);
});
