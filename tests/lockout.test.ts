// tests/lockout.test.ts: wrong-password lockout (migrations/002_login_attempts.sql, _auth.ts).
// 5 wrong passwords within 10 minutes from one IP lock that wedding (or the manager) for 15 minutes, for that IP only.
//notes: IPs are faked with the x-nf-client-connection-ip header, the one Netlify sets.
import "./_env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, handlers, ownerLogin, createWedding } from "./_helpers.ts";
import { query } from "../netlify/functions/_lib/_db.ts";

const { admin, manage } = handlers;
const S = "lock-wedding";
const login = (password: string, ip = "10.0.0.1") =>
  call(admin, "POST", `/${S}/api/admin/login`, { body: { name: "Rima", password }, headers: { "x-nf-client-connection-ip": ip } });

test("helper login locks after 5 wrong passwords, for that IP only, and unlocks after 15 minutes", async () => {
  await createWedding(await ownerLogin(), { slug: S });
  for (let i = 0; i < 4; i++) assert.equal((await login("nope")).status, 401);
  const fifth = await login("nope");
  assert.equal(fifth.status, 429);
  assert.deepEqual(fifth.body, { error: "Too many wrong passwords. Try again in 15 minutes.", code: "locked" });
  assert.equal((await login("wedding")).status, 429, "even the right password waits");
  assert.equal((await login("wedding", "10.0.0.2")).status, 200, "another phone is not affected");
  const [row] = await query("select locked_until from login_attempts where scope = $1 and key = '10.0.0.1'", ["wedding:" + S]);
  const mins = (Date.parse(row.locked_until) - Date.now()) / 60000;
  assert.ok(mins > 14 && mins <= 15, `locked for ~15 minutes (${mins})`);
  await query("update login_attempts set locked_until = now() - interval '1 second' where key = '10.0.0.1'");
  assert.equal((await login("wedding")).status, 200);
  assert.equal((await query("select count(*)::int as n from login_attempts where key = '10.0.0.1'"))[0].n, 0, "a right password clears the count");
});

test("wrong tries older than 10 minutes do not count", async () => {
  for (let i = 0; i < 4; i++) await login("nope", "10.0.0.3");
  await query("update login_attempts set first_failed_at = now() - interval '11 minutes' where key = '10.0.0.3'");
  assert.equal((await login("nope", "10.0.0.3")).status, 401, "counting starts again");
  assert.equal((await query("select failures from login_attempts where key = '10.0.0.3'"))[0].failures, 1);
});

test("guessing x-wedding-key is locked out the same way", async () => {
  const k = (key: string) => call(admin, "GET", `/${S}/api/admin/families`, { headers: { "x-wedding-key": key, "x-forwarded-for": "10.0.0.4, 1.1.1.1" } });
  for (let i = 0; i < 4; i++) assert.equal((await k("guess")).status, 401);
  assert.equal((await k("guess")).status, 429);
  assert.equal((await k("wedding")).status, 429);
});

test("owner login locks too, separately from weddings", async () => {
  const o = (password: string) => call(manage, "POST", "/api/manage/login", { body: { password }, headers: { "x-nf-client-connection-ip": "10.0.0.9" } });
  for (let i = 0; i < 4; i++) assert.equal((await o("nope")).status, 401);
  assert.equal((await o("nope")).status, 429);
  assert.equal((await o("owner-secret")).status, 429);
  assert.equal((await login("wedding", "10.0.0.9")).status, 200, "a wedding login from the same IP still works");
});
