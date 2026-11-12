// tests/admin.test.ts: the helpers' admin API: families, sending, messages, resets, design, uploads, password, export.
//notes: runs in its own process with an empty in-memory database (tests/_env.ts). Helpers are logged in with
//   tests/_helpers.ts; never use real helper or family names in test data.
import "./_env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, handlers, ownerLogin, createWedding, helperLogin, addFamily, A, cookieOf } from "./_helpers.ts";

const { admin, guest, rsvp, invite, asset } = handlers;
const S = "test-wedding";
let owner = "", rima = "", api: ReturnType<typeof A>;

test("setup and login rules", async () => {
  owner = await ownerLogin();
  await createWedding(owner);
  const L = (body: any) => call(admin, "POST", `/${S}/api/admin/login`, { body });
  assert.equal((await L({ name: " ", password: "wedding" })).body.code, "name_required");
  assert.equal((await L({ name: "x".repeat(41), password: "wedding" })).body.code, "name_too_long");
  assert.equal((await L({ name: "Owner", password: "wedding" })).body.code, "name_reserved");
  const bad = await L({ name: "Rima", password: "nope" });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, "Wrong password. Try again.");
  const ok = await L({ name: "  Rima  ", password: "wedding" });
  assert.match(ok.setCookie!, /^twp_test-wedding=.+; Path=\/test-wedding; Max-Age=34560000; .*HttpOnly; SameSite=Lax$/);
  assert.ok(!/Secure/.test(ok.setCookie!), "plain http (localhost): no Secure flag, so Safari keeps the cookie");
  const https = await handlers.admin(new Request(`https://test.local/${S}/api/admin/login`, { method: "POST", body: JSON.stringify({ name: "Rima", password: "wedding" }) }));
  assert.match(https.headers.get("set-cookie")!, /; HttpOnly; Secure; SameSite=Lax$/);
  const proxied = await call(admin, "POST", `/${S}/api/admin/login`, { body: { name: "Rima", password: "wedding" }, headers: { "x-forwarded-proto": "https" } });
  assert.match(proxied.setCookie!, /; HttpOnly; Secure; SameSite=Lax$/);
  assert.match((await call(admin, "POST", `/${S}/api/admin/logout`)).setCookie!, /Max-Age=0; HttpOnly; SameSite=Lax$/);
  rima = cookieOf(ok.setCookie);
  api = A(S, rima);
  assert.deepEqual((await api("GET", "me")).body, { ok: true, name: "Rima", owner: false, slug: S, status: "live" });
  assert.equal((await call(admin, "GET", `/${S}/api/admin/families`)).status, 401);
  assert.equal((await call(admin, "GET", `/nope/api/admin/families`)).body.code, "no_wedding");
});

test("families: add, duplicate 409, validation, edit, below_answer, contact log, links", async () => {
  const f = await addFamily(S, rima, "The Demo Family", "Adam", 4, { phone: "+961 70 000 001", email: "demo@example.com" });
  assert.equal(f.side, "a");
  assert.equal(f.created_by, "Rima");
  assert.equal(f.link, `http://test.local/${S}/?t=${f.token}`);
  assert.equal(f.preview_link, f.link + "&preview=1");
  assert.ok(f.wa_link.startsWith("https://wa.me/96170000001?text="));
  assert.ok(decodeURIComponent(f.wa_link.split("text=")[1]).includes(`Dear The Demo Family,`));
  assert.ok(decodeURIComponent(f.wa_link.split("text=")[1]).includes(f.link));
  assert.ok(f.mail_link.startsWith("mailto:demo@example.com?subject="));
  const dup = await api("POST", "family", { name: "  the demo   FAMILY ", side: "b", max_guests: 2 });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "duplicate_name");
  assert.equal(dup.body.existing.token, f.token);
  for (const [body, re] of [
    [{ name: "", side: "a", max_guests: 1 }, /empty/], [{ name: "A{b}", side: "a", max_guests: 1 }, /\{ or \}/],
    [{ name: "X", side: "z", max_guests: 1 }, /Side must be Adam or Eve/], [{ name: "X", side: "a", max_guests: 51 }, /whole number/],
    [{ name: "X", side: "a", max_guests: 1, message: "hi" }, /\{link\}/], [{ name: "X", side: "a", max_guests: 1, email: "nope" }, /e-mail/],
  ] as const) {
    const r = await api("POST", "family", body);
    assert.equal(r.status, 400);
    assert.match(r.body.error, re);
  }
  const two = await addFamily(S, rima, "Test Family Two", "b", "2" as any);
  assert.equal(two.max_guests, 2);
  assert.equal(two.wa_link, null);
  assert.equal((await api("PATCH", "family", { token: two.token, name: "The Demo Family" })).body.code, "duplicate_name");
  await call(rsvp, "POST", `/${S}/api/rsvp`, { body: { t: f.token, attending: true, guests: 3, guest_names: ["a", "b", "c"] } });
  const below = await api("PATCH", "family", { token: f.token, max_guests: 2 });
  assert.equal(below.status, 409);
  assert.equal(below.body.code, "below_answer");
  assert.equal(below.body.answered_guests, 3);
  const forced = await api("PATCH", "family", { token: f.token, max_guests: 2, force: true, phone: null, by: "Hacker" });
  assert.equal(forced.body.family.max_guests, 2);
  assert.equal(forced.body.family.response.guests, 3, "the stored answer is never changed");
  assert.equal(forced.body.family.updated_by, "Rima", "by comes from the session, never the body");
  assert.equal(forced.body.family.phone, null);
  const ev = (await api("GET", "activity")).body.events;
  assert.equal(ev[0].action, "contact_edited");
  assert.deepEqual(ev[0].details.changes, ["phone removed"]);
  assert.equal(ev[1].action, "family_edited");
  assert.deepEqual(ev[1].details.changes, ["seats 4 → 2"]);
  assert.equal((await api("PATCH", "family", { token: "ZZZZZZZZZZ", name: "Q" })).status, 404);
  const list = (await api("GET", "families")).body;
  assert.deepEqual(list.families.map((x: any) => x.name), ["Test Family Two", "The Demo Family"]);
  assert.equal(list.settings.wa_message_a.includes("Adam & Eve"), true);
});

test("delete needs force when sent/answered; removed list; restore with the same token", async () => {
  const fams = (await api("GET", "families")).body.families;
  const demo = fams.find((f: any) => f.name === "The Demo Family");
  const r = await api("DELETE", "family", { token: demo.token });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "has_activity");
  assert.equal((await api("DELETE", "family", { token: demo.token, force: true })).body.ok, true);
  assert.equal((await api("DELETE", "family", { token: demo.token, force: true })).body.already_removed, true);
  assert.equal((await call(guest, "GET", `/${S}/api/guest?t=${demo.token}`)).status, 404);
  let fl = (await api("GET", "families")).body;
  assert.equal(fl.removed_count, 1);
  const removed = (await api("GET", "removed")).body.removed;
  assert.equal(removed[0].token, demo.token);
  assert.equal(removed[0].response.guests, 3);
  // someone reuses the name meanwhile -> restore refuses
  const imposter = await addFamily(S, rima, "the demo family", "a", 1);
  assert.equal((await api("POST", "restore", { token: demo.token })).body.code, "duplicate_name");
  await api("DELETE", "family", { token: imposter.token });
  const back = await api("POST", "restore", { token: demo.token });
  assert.equal(back.body.family.token, demo.token);
  assert.equal(back.body.family.response.guests, 3);
  assert.equal((await api("POST", "restore", { token: demo.token })).body.code, "already_restored");
  // DELETE by query string
  const tmp = await addFamily(S, rima, "Temp", "a", 1);
  const q = await call(admin, "DELETE", `/${S}/api/admin/family?token=${tmp.token}`, { cookie: rima });
  assert.equal(q.body.ok, true);
});

test("upload: dry run, adds, updates, conflicts, never removes", async () => {
  const rows = [
    { name: "Sample Family Three", max_guests: 5 }, { name: "Test Family Two", max_guests: 3 }, { name: "The Demo Family", max_guests: 9 },
    { name: "sample family three", max_guests: 1 }, { name: "", max_guests: 2 }, { name: "Bad Seats", max_guests: 0 },
  ];
  const dry = await api("POST", "upload", { side: "b", families: rows, dry_run: true });
  assert.equal(dry.body.dry_run, true);
  assert.deepEqual(dry.body.added, ["Sample Family Three"]);
  assert.deepEqual(dry.body.updated, [{ name: "Test Family Two", from: 2, to: 3 }]);
  assert.equal(dry.body.conflicts.length, 4);
  assert.ok(dry.body.conflicts.some((c: any) => c.reason === "Already on Adam's side."));
  assert.equal((await api("GET", "families")).body.families.length, 2, "dry run wrote nothing");
  const real = await api("POST", "upload", { side: "Eve", families: rows });
  assert.deepEqual(real.body.added, ["Sample Family Three"]);
  const fams = (await api("GET", "families")).body.families;
  assert.equal(fams.length, 3);
  assert.equal(fams.find((f: any) => f.name === "Test Family Two").max_guests, 3);
  const again = await api("POST", "upload", { side: "b", families: [{ name: "Test Family Two", max_guests: 3 }] });
  assert.equal(again.body.unchanged, 1);
});

test("mark-sent with channel, previous, undo; sends list", async () => {
  const two = (await api("GET", "families")).body.families.find((f: any) => f.name === "Test Family Two");
  let r = await api("POST", "mark-sent", { token: two.token, kind: "invite" });
  assert.equal(r.body.previous, null);
  assert.equal(r.body.sent.invite_by, "Rima");
  assert.equal(r.body.sent.invite_channel, "copy");
  const zeina = await helperLogin(S, "Yara");
  r = await A(S, zeina)("POST", "mark-sent", { token: two.token, kind: "invite", channel: "whatsapp" });
  assert.equal(r.body.previous.invite_by, "Rima");
  assert.equal(r.body.sent.invite_channel, "whatsapp");
  assert.equal((await api("POST", "mark-sent", { token: two.token, kind: "x" })).status, 400);
  assert.equal((await api("POST", "mark-sent", { token: two.token, kind: "invite", channel: "fax" })).status, 400);
  let f = (await api("GET", "families")).body.families.find((x: any) => x.token === two.token);
  assert.equal(f.sends.length, 2);
  assert.deepEqual(f.sends.map((s: any) => s.channel), ["copy", "whatsapp"]);
  r = await api("POST", "mark-sent", { token: two.token, kind: "invite", undo: true });
  assert.equal(r.body.sent, null);
  r = await api("POST", "mark-sent", { token: two.token, kind: "reminder", channel: "email" });
  assert.equal(r.body.sent.reminder_channel, "email");
  assert.equal(r.body.sent.invite_at, undefined);
  const helpers = (await api("GET", "helpers")).body.helpers;
  const z = helpers.find((h: any) => h.name === "Yara");
  assert.equal(z.invites, 1);
  assert.equal(z.logins, 1);
  assert.ok(helpers.every((h: any) => h.name !== "Guest" && h.name !== "Owner"));
  assert.equal((await api("POST", "hello", {})).body.ok, true);
});

test("settings: missing link, too long, 409 changed, force, same text never conflicts", async () => {
  const s0 = (await api("GET", "settings")).body;
  assert.deepEqual(s0.meta, {});
  assert.equal((await api("PUT", "settings", { wa_message_a: "no link" })).body.code, "missing_link");
  assert.equal((await api("PUT", "settings", { wa_message_a: "{link}" + "x".repeat(4000) })).body.code, "too_long");
  const s1 = (await api("PUT", "settings", { wa_message_a: "Hello {name} {link}", base: { wa_message_a: null } })).body;
  assert.equal(s1.meta.wa_message_a.updated_by, "Rima");
  const zeina = await helperLogin(S, "Yara");
  const c = await A(S, zeina)("PUT", "settings", { wa_message_a: "Other {link}", base: { wa_message_a: null } });
  assert.equal(c.status, 409);
  assert.equal(c.body.code, "changed");
  assert.equal(c.body.by, "Rima");
  assert.equal(c.body.fields[0].value, "Hello {name} {link}");
  assert.equal((await A(S, zeina)("PUT", "settings", { wa_message_a: "Hello {name} {link}", base: { wa_message_a: null } })).status, 200);
  assert.equal((await A(S, zeina)("PUT", "settings", { wa_message_a: "Other {link}", base: { wa_message_a: s1.meta.wa_message_a.updated_at } })).status, 200);
  assert.equal((await api("PUT", "settings", { wa_message_a: "Mine {link}", base: { wa_message_a: null }, force: true })).status, 200);
  const saved = (await api("GET", "activity")).body.events.filter((e: any) => e.action === "message_saved");
  assert.equal(saved.length, 3);
  assert.equal(saved[0].side, "a");
});

test("activity keys sort as strings; since returns only newer events", async () => {
  const a = (await api("GET", "activity?limit=3")).body;
  assert.equal(a.events.length, 3);
  assert.match(a.latest, /^\d{12}$/);
  assert.ok(a.events[0].key > a.events[1].key);
  assert.deepEqual((await api("GET", `activity?since=${a.latest}`)).body.events, []);
  await addFamily(S, rima, "Another", "a", 1);
  const b = (await api("GET", `activity?since=${a.latest}`)).body;
  assert.equal(b.events.length, 1);
  assert.equal(b.events[0].action, "family_added");
  assert.equal(b.events[0].family_name, "Another");
  assert.ok(b.events[0].token);
});

test("reset-family and undo-reset bring back exactly what was cleared", async () => {
  const demo = (await api("GET", "families")).body.families.find((f: any) => f.name === "The Demo Family");
  await api("POST", "mark-sent", { token: demo.token, kind: "invite" });
  await call(guest, "GET", `/${S}/api/guest?t=${demo.token}`);
  const r = await api("POST", "reset-family", { token: demo.token });
  assert.deepEqual(r.body.cleared, { sent: true, opened: true, response: true });
  assert.equal(r.body.family.response, null);
  assert.equal(r.body.family.sent, null);
  assert.equal(r.body.family.opened, null);
  assert.equal(r.body.family.token, demo.token);
  assert.equal((await api("POST", "reset-family", { token: demo.token })).body.cleared.sent, false);
  const u = await api("POST", "undo-reset", { key: r.body.key });
  assert.deepEqual(u.body.restored, ["The Demo Family"]);
  const back = (await api("GET", "families")).body.families.find((f: any) => f.token === demo.token);
  assert.equal(back.response.guests, 3);
  assert.equal(back.opened.count, 1);
  assert.ok(back.sent.invite_at);
  assert.equal((await api("POST", "undo-reset", { key: r.body.key })).body.code, "already_undone");
  assert.equal((await api("POST", "undo-reset", { key: "999999" })).status, 404);
});

test("reset-all needs RESET; undo skips families with new activity", async () => {
  assert.equal((await api("POST", "reset-all", {})).body.code, "confirm_required");
  const before = (await api("GET", "families")).body.families;
  const r = await api("POST", "reset-all", { confirm: "RESET" });
  assert.equal(r.body.counts.answered, 1);
  assert.ok(r.body.counts.sent >= 1);
  const last = (await api("GET", "last-reset")).body.last;
  assert.equal(last.key, r.body.snapshot);
  assert.equal(last.undone_at, null);
  const after = (await api("GET", "families")).body.families;
  assert.ok(after.every((f: any) => !f.sent && !f.response && !f.opened));
  assert.equal(after.length, before.length, "families and links stay");
  const demo = after.find((f: any) => f.name === "The Demo Family");
  await call(rsvp, "POST", `/${S}/api/rsvp`, { body: { t: demo.token, attending: false } });
  const u = await api("POST", "undo-reset", { key: r.body.snapshot });
  assert.ok(u.body.skipped.some((s: any) => s.name === "The Demo Family"));
  assert.ok(u.body.restored.includes("Test Family Two"));
  assert.ok((await api("GET", "last-reset")).body.last.undone_at);
});

test("invite design: draft, 409 changed, publish, discard", async () => {
  const g = (await api("GET", "invite")).body;
  assert.equal(g.draft.config.couple.groom, "Adam");
  assert.equal(g.published_at, null);
  const d = structuredClone(g.draft);
  d.theme.gold = "#123456";
  d.config.venue.name = "Garden Hall";
  const s1 = await api("PUT", "invite", { draft: d, base: g.draft_updated_at });
  assert.equal(s1.status, 200);
  assert.equal(s1.body.draft_updated_by, "Rima");
  const zeina = await helperLogin(S, "Yara");
  const c = await A(S, zeina)("PUT", "invite", { draft: d, base: g.draft_updated_at });
  assert.equal(c.status, 409);
  assert.equal(c.body.code, "changed");
  assert.equal(c.body.by, "Rima");
  assert.equal((await api("PUT", "invite", { draft: { ...d, mode: "movie" } })).body.code, "invalid_invite");
  assert.equal((await call(invite, "GET", `/${S}/api/invite`)).body.theme.gold, "#b8975a", "not published yet");
  assert.equal((await call(invite, "GET", `/${S}/api/invite?draft=1`, { cookie: rima })).body.theme.gold, "#123456");
  const p = await api("POST", "publish", {});
  assert.equal(p.body.published_by, "Rima");
  const live = (await call(invite, "GET", `/${S}/api/invite`)).body;
  assert.equal(live.theme.gold, "#123456");
  assert.equal(live.config.venue.name, "Garden Hall");
  assert.ok(live.published_at);
  d.theme.gold = "#654321";
  await api("PUT", "invite", { draft: d, base: s1.body.draft_updated_at });
  const disc = await api("POST", "discard-draft", {});
  assert.equal(disc.body.draft.theme.gold, "#123456");
  const acts = (await api("GET", "activity")).body.events.map((e: any) => e.action);
  for (const a of ["invite_saved", "invite_published", "invite_discarded"]) assert.ok(acts.includes(a), a);
});

test("invite design: per-page looks, readability and timing are checked with plain-words errors", async () => {
  const g = (await api("GET", "invite")).body;
  const d = structuredClone(g.draft);
  assert.deepEqual(d.readability, { veil: 57.6, photoBlur: 2.5 }, "defaults = the template's veil and blur");
  assert.deepEqual(d.timing, { envelopeOpenMs: 2300, revealSpeed: 1 });
  for (const k of ["kidsNote", "bismillah", "countdown", "maps", "arabic", "parents", "timeLine"]) assert.equal(d.show[k], true, `show.${k} defaults to on`);
  assert.equal(d.show.gift, false, "a new wedding starts with the gift page off");
  assert.equal((await api("PUT", "invite", { draft: { ...d, show: { ...d.show, maps: "yes" } } })).body.field, "show.maps");
  assert.deepEqual(Object.keys(d.pages).sort(), ["countdown", "envelope", "families", "gift", "rsvp", "welcome"]);   // jsonb reorders keys
  const tooBig = await api("PUT", "invite", { draft: { ...d, pages: { welcome: { scale: 3 } } } });
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.body.code, "invalid_invite");
  assert.equal(tooBig.body.field, "pages.welcome.scale");
  assert.match(tooBig.body.error, /text size on the Names page must be between 80% and 140%/);
  const tooSmall = await api("PUT", "invite", { draft: { ...d, pages: { welcome: { scale: 0.7 } } } });
  assert.equal(tooSmall.status, 400, "the Size slider starts at 80% now");
  assert.equal(tooSmall.body.field, "pages.welcome.scale");
  const bigClock = await api("PUT", "invite", { draft: { ...d, pages: { countdown: { scale: 1.3 } } } });
  assert.equal(bigClock.status, 400, "the Countdown page stops at 120% (its numbers would run off the screen)");
  assert.equal(bigClock.body.field, "pages.countdown.scale");
  assert.match(bigClock.body.error, /text size on the Countdown & venue page must be between 80% and 120%/);
  const noPage = await api("PUT", "invite", { draft: { ...d, pages: { lobby: { ink: "#000000" } } } });
  assert.equal(noPage.status, 400);
  assert.equal(noPage.body.field, "pages.lobby");
  assert.match(noPage.body.error, /there is no page called "lobby"/);
  assert.equal((await api("PUT", "invite", { draft: { ...d, pages: { welcome: { glow: 1 } } } })).body.field, "pages.welcome.glow");
  assert.equal((await api("PUT", "invite", { draft: { ...d, pages: { welcome: { ink: "red;}" } } } })).body.field, "pages.welcome.ink");
  assert.equal((await api("PUT", "invite", { draft: { ...d, pages: { welcome: { shadow: "huge" } } } })).body.field, "pages.welcome.shadow");
  assert.equal((await api("PUT", "invite", { draft: { ...d, readability: { veil: 120 } } })).body.field, "readability.veil");
  assert.equal((await api("PUT", "invite", { draft: { ...d, timing: { envelopeOpenMs: 100 } } })).body.field, "timing.envelopeOpenMs");
  const okDraft = { ...d, pages: { welcome: { ink: "#000000", shadow: "strong", scale: 1.15, serif: "\"Playfair Display\", Georgia, serif", backdrop: "", gold: null } },
    readability: { veil: 90, photoBlur: 0 }, timing: { envelopeOpenMs: 800, revealSpeed: 1.5 } };
  const ok = await api("PUT", "invite", { draft: okDraft });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.draft.pages.welcome, { ink: "#000000", shadow: "strong", scale: 1.15, serif: "\"Playfair Display\", Georgia, serif" }, "empty = same as everywhere, dropped");
  assert.deepEqual(ok.body.draft.pages.families, {});
  const pub = (await call(invite, "GET", `/${S}/api/invite?draft=1`, { cookie: rima })).body;
  assert.equal(pub.pages.welcome.ink, "#000000");
  assert.deepEqual(pub.readability, { veil: 90, photoBlur: 0 });
  assert.deepEqual(pub.timing, { envelopeOpenMs: 800, revealSpeed: 1.5 });
  await api("PUT", "invite", { draft: d });   // back to the defaults for the next tests
});

test("invite design: one line's settings (Fine-tune a line) are checked with plain-words errors and reach the public page", async () => {
  const d = structuredClone((await api("GET", "invite")).body.draft);
  assert.deepEqual(d.lines, {}, "default = no line changed");
  const noLine = await api("PUT", "invite", { draft: { ...d, lines: { "welcome.lobby": { size: 1.2 } } } });
  assert.equal(noLine.status, 400);
  assert.equal(noLine.body.code, "invalid_invite");
  assert.equal(noLine.body.field, "lines.welcome.lobby");
  assert.match(noLine.body.error, /there is no line called "welcome.lobby"/);
  const tooBig = await api("PUT", "invite", { draft: { ...d, lines: { "welcome.dateEn": { size: 3 } } } });
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.body.field, "lines.welcome.dateEn.size");
  assert.match(tooBig.body.error, /size of "Date \(English\)" on the Names page must be between 60% and 180%/);
  assert.equal((await api("PUT", "invite", { draft: { ...d, lines: { "welcome.dateEn": { glow: 1 } } } })).body.field, "lines.welcome.dateEn.glow");
  assert.equal((await api("PUT", "invite", { draft: { ...d, lines: { "welcome.dateEn": { color: "red;}" } } } })).body.field, "lines.welcome.dateEn.color");
  assert.equal((await api("PUT", "invite", { draft: { ...d, lines: { "welcome.dateEn": { letterSpacing: 1 } } } })).body.field, "lines.welcome.dateEn.letterSpacing");
  assert.equal((await api("PUT", "invite", { draft: { ...d, lines: { "welcome.time": { hidden: "yes" } } } })).body.field, "lines.welcome.time.hidden");
  assert.equal((await api("PUT", "invite", { draft: { ...d, lines: { "welcome.time": { weight: "heavy" } } } })).body.field, "lines.welcome.time.weight");
  const ok = await api("PUT", "invite", { draft: { ...d, lines: {
    "welcome.dateEn": { size: 1.5, color: "#000000", italic: false, weight: "bold", letterSpacing: 0.1, shadow: "soft", font: "\"Lora\", Georgia, serif", hidden: false },
    "welcome.time": { hidden: true }, "rsvp.kidsEn": { color: "", size: null } } } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.draft.lines, {
    "welcome.dateEn": { size: 1.5, color: "#000000", italic: false, weight: "bold", letterSpacing: 0.1, shadow: "soft", font: "\"Lora\", Georgia, serif" },
    "welcome.time": { hidden: true } }, "empty values and hidden: false are dropped, a line with nothing set disappears");
  const pub = (await call(invite, "GET", `/${S}/api/invite?draft=1`, { cookie: rima })).body;
  assert.deepEqual(pub.lines["welcome.time"], { hidden: true });
  await api("PUT", "invite", { draft: d });
});

test("line keys: the server, the invite's loader and the Design tab list the same lines", async () => {
  const fs = await import("node:fs");
  const { LINE_KEYS } = await import("../netlify/functions/_lib/_wedding.ts");
  const appJs = fs.readFileSync(new URL("../site/app/app.js", import.meta.url), "utf8");
  const adminHtml = fs.readFileSync(new URL("../site/app/admin.html", import.meta.url), "utf8");
  const block = (src: string, start: string) => src.slice(src.indexOf(start), src.indexOf("];", src.indexOf(start)) + 2);
  const loader = [...appJs.slice(appJs.indexOf("const LINES = {"), appJs.indexOf("window.TWPLines = LINES")).matchAll(/^\s{4}"([a-z]+\.[A-Za-z]+)":/gm)].map((m) => m[1]);
  const tab = [...block(adminHtml, "const LINE_LIST = [").matchAll(/\["([a-z]+\.[A-Za-z]+)", "([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(LINE_KEYS.length >= 40, "line list " + LINE_KEYS.length);
  assert.deepEqual(loader, LINE_KEYS, "app.js LINES");
  assert.deepEqual(tab, LINE_KEYS, "admin.html LINE_LIST");
  for (const k of LINE_KEYS) assert.ok(["envelope", "welcome", "families", "countdown", "gift", "rsvp"].includes(k.split(".")[0]), k);
});

test("upload-asset: stored, served with cache headers and ranges, used by the design, delete guarded", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);
  assert.equal((await api("POST", "upload-asset", { name: "x.png", content_type: "text/html", data_base64: png.toString("base64") })).body.code, "bad_type");
  assert.equal((await api("POST", "upload-asset", { name: "x.png", content_type: "image/png", data_base64: Buffer.from("<html>").toString("base64") })).body.code, "bad_file");
  const big = Buffer.alloc(6 * 1024 * 1024 + 10, 1);
  big[0] = 0x89; big[1] = 0x50; big[2] = 0x4e; big[3] = 0x47;
  assert.equal((await api("POST", "upload-asset", { name: "x.png", content_type: "image/png", data_base64: big.toString("base64") })).body.code, "too_big");
  const up = await api("POST", "upload-asset", { name: "Slides/My Envelope!.PNG", content_type: "image/png", data_base64: png.toString("base64") });
  assert.equal(up.status, 200);
  assert.match(up.body.name, /^slides\/my-envelope-[a-z2-7]{4}\.png$/);
  assert.equal(up.body.url, `/.netlify/images?url=/${S}/asset/${up.body.name}&w=1170&fm=webp&q=80`);
  assert.equal(up.body.bytes, png.length);
  const got = await call(asset, "GET", `/${S}/asset/${up.body.name}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.equal(got.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const part = await call(asset, "GET", `/${S}/asset/${up.body.name}`, { headers: { range: "bytes=0-3" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 0-3/${png.length}`);
  assert.equal((await call(asset, "GET", `/${S}/asset/nope-abcd.png`)).status, 404);
  assert.equal((await call(asset, "GET", `/other/asset/${up.body.name}`)).status, 404);
  const song = await api("POST", "upload-asset", { name: "song.m4a", content_type: "audio/mp4", data_base64: Buffer.alloc(50, 3).toString("base64") });
  assert.equal(song.body.url, `/${S}/asset/${song.body.name}`);

  const g = (await api("GET", "invite")).body;
  assert.equal(g.assets.length, 2);
  const d = structuredClone(g.draft);
  d.assets.envelope = up.body.name;
  d.mode = "slides";
  d.slides = [{ id: "s1", name: "envelope.png", kind: "image", asset: up.body.name, type: "envelope", overlays: [{ kind: "seal", x: 33, y: 38, w: 34, h: 19 }] }];
  assert.equal((await api("PUT", "invite", { draft: { ...d, assets: { ...d.assets, couple: "ghost-aaaa.png" } } })).body.code, "invalid_invite");
  assert.equal((await api("PUT", "invite", { draft: d })).status, 200);
  const dr = (await call(invite, "GET", `/${S}/api/invite?draft=1`, { cookie: rima })).body;
  assert.equal(dr.mode, "slides");
  assert.equal(dr.assets.envelope, up.body.url);
  assert.equal(dr.slides[0].url, up.body.url);
  assert.equal(dr.slides[0].overlays[0].kind, "seal");
  const del = await api("DELETE", "asset", { name: up.body.name });
  assert.equal(del.status, 409);
  assert.equal(del.body.code, "in_use");
  assert.equal((await api("DELETE", "asset", { name: song.body.name })).body.ok, true);
  assert.equal((await call(asset, "GET", `/${S}/asset/${song.body.name}`)).status, 404);
});

test("delete asset is refused while a slide's open picture or a photo box uses it, in draft or live", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(30, 1)]).toString("base64");
  const up = async (name: string) => (await api("POST", "upload-asset", { name, content_type: "image/png", data_base64: png })).body.name;
  const page = await up("slides/page.png"), opened = await up("slides/page-open.png"), photo = await up("photo.png");
  const g = (await api("GET", "invite")).body;
  const d = structuredClone(g.draft);
  d.mode = "slides";
  d.slides = [{ id: "p1", name: "page.png", kind: "image", asset: page, open_asset: opened, type: "envelope",
    overlays: [{ kind: "photo", x: 10, y: 10, w: 30, h: 30, asset: photo }] }];
  assert.equal((await api("PUT", "invite", { draft: { ...d, slides: [{ ...d.slides[0], open_asset: "ghost-aaaa.png" }] } })).body.code, "invalid_invite");
  assert.equal((await api("PUT", "invite", { draft: { ...d, slides: [{ ...d.slides[0], overlays: [{ ...d.slides[0].overlays[0], asset: "../x" }] }] } })).body.field, "slides.0.overlays.0.asset");
  assert.equal((await api("PUT", "invite", { draft: d })).status, 200);
  const dr = (await call(invite, "GET", `/${S}/api/invite?draft=1`, { cookie: rima })).body.slides[0];
  assert.equal(dr.open_url, `/.netlify/images?url=/${S}/asset/${opened}&w=1170&fm=webp&q=80`);
  assert.equal(dr.overlays[0].url, `/.netlify/images?url=/${S}/asset/${photo}&w=1170&fm=webp&q=80`);
  for (const n of [page, opened, photo]) {
    const r = await api("DELETE", "asset", { name: n });
    assert.equal(r.status, 409, n);
    assert.deepEqual(r.body.where, ["draft"]);
  }
  await api("POST", "publish", {});
  // draft no longer uses the photo, live still does
  d.slides[0].overlays = [];
  await api("PUT", "invite", { draft: d });
  const r = await api("DELETE", "asset", { name: photo });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.where, ["live"]);
  await api("POST", "publish", {});
  assert.equal((await api("DELETE", "asset", { name: photo })).body.ok, true);
  assert.equal((await api("DELETE", "asset", { name: opened })).status, 409, "the open picture is still in use");
});

test("owner cookie opens any wedding as Owner; x-wedding-key works for scripts", async () => {
  const o = A(S, owner);
  assert.equal((await o("GET", "me")).body.name, "Owner");
  assert.equal((await o("GET", "me")).body.owner, true);
  const f = await addFamily(S, owner, "Owner Added", "a", 1);
  assert.equal(f.created_by, "Owner");
  const s = await call(admin, "POST", `/${S}/api/admin/family`, { headers: { "x-wedding-key": "wedding" }, body: { name: "Script Added", side: "a", max_guests: 1, by: "Importer" } });
  assert.equal(s.body.family.created_by, "Importer");
  assert.equal((await call(admin, "GET", `/${S}/api/admin/families`, { headers: { "x-wedding-key": "wrong" } })).status, 401);
  const helpers = (await api("GET", "helpers")).body.helpers.map((h: any) => h.name);
  assert.ok(!helpers.includes("Owner"));
});

test("change-password logs every helper out; the caller gets a fresh cookie", async () => {
  const zeina = await helperLogin(S, "Yara");
  assert.equal((await api("POST", "change-password", { current: "bad", new: "newpass" })).body.code, "wrong_password");
  assert.equal((await api("POST", "change-password", { current: "wedding", new: "abc" })).body.code, "too_short");
  const r = await api("POST", "change-password", { current: "wedding", new: "newpass" });
  assert.equal(r.status, 200);
  const fresh = cookieOf(r.setCookie);
  assert.equal((await A(S, fresh)("GET", "me")).status, 200);
  assert.equal((await api("GET", "me")).status, 401, "old cookie of the caller");
  assert.equal((await A(S, zeina)("GET", "me")).status, 401, "other helper logged out");
  assert.equal((await call(admin, "POST", `/${S}/api/admin/login`, { body: { name: "Yara", password: "wedding" } })).status, 401);
  assert.equal((await call(admin, "POST", `/${S}/api/admin/login`, { body: { name: "Yara", password: "newpass" } })).status, 200);
  assert.equal((await A(S, owner)("GET", "me")).status, 200, "owner unaffected");
  api = A(S, fresh);
});

test("export has the full shape and no password hash", async () => {
  const e = (await api("GET", "export")).body;
  for (const k of ["wedding", "families", "rsvps", "sends", "opens", "activity", "settings", "invite"]) assert.ok(k in e, k);
  assert.equal(e.format, "twp-wedding");
  assert.equal(e.wedding.slug, S);
  assert.equal(e.wedding.password_hash, undefined);
  assert.ok(!JSON.stringify(e).includes("scrypt$"));
  assert.ok(e.families.some((f: any) => f.removed_at), "removed families included");
  assert.ok(e.rsvps.every((r: any) => r.token));
  assert.ok(e.settings.wa_message_a.value);
  assert.ok(e.invite.live);
  assert.equal((await api("GET", "unknown-action")).body.code, "not_found");
});
