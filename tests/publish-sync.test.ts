// What this file is for: publishing a design makes the couple's names on it the wedding's names (manager list, Data page,
// page title). Found by the journey tester: renaming the bride in the Design tab did not reach the manager.
// //notes: uses the in-memory database like every other test; see tests/_helpers.ts for the call helpers.
import "./_env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, handlers, ownerLogin, createWedding, helperLogin, A } from "./_helpers.ts";

test("publishing a design renames the wedding to the names on the invitation", async () => {
  const owner = await ownerLogin();
  const slug = "sync-" + Math.random().toString(36).slice(2, 8);
  await createWedding(owner, { slug, groom: "Ali", bride: "Nour" });
  const helper = await helperLogin(slug);
  const admin = A(slug, helper);
  const inv = await admin("GET", "invite");
  const draft = inv.body.draft;
  draft.config.couple.bride = "Noura";
  const put = await admin("PUT", "invite", { draft });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const pub = await admin("POST", "publish", {});
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const list = await call(handlers.manage, "GET", "/api/manage/weddings", { cookie: owner });
  const row = (list.body.weddings || []).find((w: any) => w.slug === slug);
  assert.ok(row, "wedding listed");
  assert.equal(row.bride, "Noura");
  assert.equal(row.groom, "Ali");
});
