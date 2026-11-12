// tests/backup-github.test.ts: how long backups are kept (90 days of nightly copies, the first of each month and every
// manual / before-restore / archive copy for ever), the backup taken when a wedding is archived, and the copy of every
// wedding to the owner's GitHub repository (_lib/_github-backup.ts).
//notes: GitHub is never called for real: globalThis.fetch is replaced by a small fake GitHub (fakeGitHub below)
// that keeps files in memory and can be told to answer with an error. Runs in its own process (tests/_env.ts).
import "./_env.ts";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { call, handlers, ownerLogin, createWedding, helperLogin, addFamily } from "./_helpers.ts";
import { query } from "../netlify/functions/_lib/_db.ts";
import { blobs } from "../netlify/functions/_lib/_blobs.ts";
import { prune, runBackup, firstOfMonth } from "../netlify/functions/_lib/_backup.ts";
import { GH, TOKEN_MESSAGE, gitBlobSha, parseGitHubDate, stableJson } from "../netlify/functions/_lib/_github-backup.ts";
import nightly from "../netlify/functions/backup-nightly.ts";

const { manage } = handlers;
let owner = "", rima = "";
const M = (method: string, action: string, body?: unknown) => call(manage, method, `/api/manage/${action}`, { cookie: owner, body });
GH.retryMs = 0;
const realFetch = globalThis.fetch;

type Call = { method: string; path: string; body: any };
/** A fake GitHub: files in memory, every call recorded. `fail(fn)` lets a test answer some calls with an error. */
function fakeGitHub(repo = "your-name/wedding-backups", opts: { expires?: string } = {}) {
  const files = new Map<string, { text: string; sha: string }>();
  const calls: Call[] = [];
  let fail: ((c: Call) => Response | null) | null = null;
  const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...(opts.expires ? { "github-authentication-token-expiration": opts.expires } : {}), ...headers } });
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const u = new URL(String(input));
    assert.equal(u.origin, "https://api.github.com", "only GitHub's API is called");
    assert.match(init.headers.authorization, /^Bearer /);
    const c: Call = { method: init.method || "GET", path: decodeURIComponent(u.pathname), body: init.body ? JSON.parse(init.body) : null };
    calls.push(c);
    const f = fail?.(c);
    if (f) return f;
    const base = `/repos/${repo}`;
    if (c.path === base) return c.method === "GET" ? reply(200, { full_name: repo, private: true, default_branch: "main" }) : reply(405);
    if (c.path === `${base}/git/trees/main`) return files.size ? reply(200, { tree: [...files].map(([path, f]) => ({ path, type: "blob", sha: f.sha })) }) : reply(409, { message: "Git Repository is empty." });
    if (!c.path.startsWith(base + "/contents/")) return reply(404, { message: "Not Found" });
    const path = c.path.slice((base + "/contents/").length);
    if (c.method === "GET") return files.has(path) ? reply(200, { path, sha: files.get(path)!.sha }) : reply(404, { message: "Not Found" });
    if (c.method === "PUT") {
      const cur = files.get(path);
      if (cur && c.body.sha !== cur.sha) return reply(409, { message: "sha does not match" });
      if (!cur && c.body.sha) return reply(422, { message: "no such file" });
      const text = Buffer.from(c.body.content, "base64").toString("utf8");
      files.set(path, { text, sha: gitBlobSha(text) });
      return reply(cur ? 200 : 201, { content: { path, sha: gitBlobSha(text) } });
    }
    return reply(405);
  }) as typeof fetch;
  return { files, calls, puts: () => calls.filter((c) => c.method === "PUT"), setFail: (fn: typeof fail) => { fail = fn; }, reset: () => { calls.length = 0; } };
}
function setGitHub(on: boolean) {
  if (on) { process.env.BACKUP_GITHUB_REPO = "your-name/wedding-backups"; process.env.BACKUP_GITHUB_TOKEN = "github_pat_test"; }
  else { delete process.env.BACKUP_GITHUB_REPO; delete process.env.BACKUP_GITHUB_TOKEN; }
}
afterEach(() => { globalThis.fetch = realFetch; setGitHub(false); });

test("setup: two weddings, one with a family that has a phone number", async () => {
  owner = await ownerLogin();
  await createWedding(owner);
  await createWedding(owner, { slug: "other-wedding", groom: "Ali", bride: "Mia" });
  rima = await helperLogin("test-wedding", "Rima");
  await addFamily("test-wedding", rima, "Family Salem", "a", 3, { phone: "+96170000002" });
});

test("prune: nightly kept 90 days, then only the first of each month; manual, before-restore and archive kept for ever", async () => {
  const store = blobs("backups");
  const now = new Date("2027-05-25T04:00:00Z");
  const keys = {
    firstOfFeb100: "2027-02-14/all.json", // 100 days old, the first nightly of February: kept for ever
    midFeb: "2027-02-20/all.json",        // 94 days old, not the first of its month: deleted
    firstOfJan: "2027-01-03/all.json",    // kept for ever
    midJan100: "2027-01-15/all.json",     // deleted
    recent: "2027-03-10/all.json",        // 76 days old: kept (within 90 days)
    recent2: "2027-03-20/all.json",       // kept
    manual400: "2026-04-20/manual-101010.json",  // 400 days old, made by hand: kept
    archive: "2026-01-01/archive-old-wedding-120000.json",
    safety: "2026-02-01/before-restore-old-wedding-090000.json",
  };
  for (const k of Object.values(keys)) {
    await store.set(k, JSON.stringify({ format: "twp-backup", version: 1, weddings: [] }));
    await query("insert into backups (blob_key, weddings, families, bytes, ok) values ($1, 0, 0, 10, true)", [k]);
  }
  await query("insert into backups (blob_key, weddings, families, bytes, ok, error) values ('2027-01-20/all.json', 0, 0, 0, false, 'x')");
  assert.deepEqual([...firstOfMonth(Object.values(keys))].sort(), ["2027-01-03/all.json", "2027-02-14/all.json", "2027-03-10/all.json"]);

  const r = await prune(now);
  assert.deepEqual(r.deleted.sort(), [keys.midJan100, keys.midFeb].sort());
  const left = new Set(await store.list(""));
  for (const [name, k] of Object.entries(keys)) assert.equal(left.has(k), !["midFeb", "midJan100"].includes(name), name);
  const rows = (await query("select blob_key from backups")).map((x) => x.blob_key);
  assert.ok(!rows.includes(keys.midFeb) && !rows.includes(keys.midJan100), "their rows went with them");
  assert.ok(!rows.includes("2027-01-20/all.json"), "an old failed nightly row is removed");
  assert.ok(rows.includes(keys.manual400) && rows.includes(keys.archive) && rows.includes(keys.safety));
  // running it again changes nothing (the first of each month stays the first)
  assert.deepEqual((await prune(now)).deleted, []);

  // the list says what is kept for ever and until when the others are kept
  const list = (await M("GET", "backups")).body.backups;
  const by = Object.fromEntries(list.map((b: any) => [b.blob_key, b]));
  assert.equal(by[keys.manual400].kind, "manual");
  assert.equal(by[keys.manual400].kept_forever, true);
  assert.equal(by[keys.archive].kind, "archive");
  assert.equal(by[keys.archive].kept_forever, true);
  assert.equal(by[keys.safety].kind, "before-restore");
  assert.equal(by[keys.firstOfFeb100].kept_forever, true);
  assert.equal(by[keys.recent2].kind, "nightly");
  assert.equal(by[keys.recent2].kept_forever, false);
  assert.equal(by[keys.recent2].kept_until, "2027-06-18");
  // tidy up so later counts only see real backups
  for (const k of Object.values(keys)) await store.delete(k);
  await query("delete from backups");
});

test("archiving a wedding takes a backup of it, kept for ever; unarchive and a second archive do not repeat it needlessly", async () => {
  const r = await M("POST", "archive", { slug: "other-wedding" });
  assert.equal(r.status, 200);
  assert.equal(r.body.wedding.status, "archived");
  assert.equal(r.body.backup.ok, true);
  assert.match(r.body.backup.blob_key, /^\d{4}-\d{2}-\d{2}\/archive-other-wedding-\d{6}\.json$/);
  const doc = JSON.parse(new TextDecoder().decode((await blobs("backups").get(r.body.backup.blob_key))!));
  assert.deepEqual(doc.weddings.map((w: any) => w.wedding.slug), ["other-wedding"]);
  assert.equal(doc.weddings[0].wedding.status, "archived");
  const again = await M("POST", "archive", { slug: "other-wedding" });
  assert.equal(again.body.backup, undefined, "already archived: no second copy");
  assert.equal((await M("POST", "unarchive", { slug: "other-wedding" })).body.backup, undefined);
  const [row] = await query("select kind, github from backups where blob_key = $1", [r.body.backup.blob_key]);
  assert.equal(row.kind, "archive");
  assert.equal(row.github, null, "GitHub not set up: nothing recorded");
  await prune(new Date(Date.now() + 1000 * 86400_000));
  assert.ok((await blobs("backups").list("")).includes(r.body.backup.blob_key), "archive backups are never pruned");
});

test("GitHub not set up: no call is made and health says so", async () => {
  const gh = fakeGitHub();
  const b = await runBackup("manual");
  assert.equal(b.ok, true);
  assert.equal(b.github, null);
  assert.equal(gh.calls.length, 0);
  const h = (await M("GET", "health")).body.github_backup;
  assert.deepEqual(h, { configured: false, last_ok_at: null, last_error: null, token_expires_at: null });
  process.env.BACKUP_GITHUB_REPO = "your-name/wedding-backups";
  assert.match((await M("GET", "health")).body.github_backup.last_error, /Only one of the two GitHub settings/);
});

test("GitHub: first run creates the files (no sha), second updates with the sha, unchanged files are skipped", async () => {
  setGitHub(true);
  const gh = fakeGitHub();
  const nb = await nightly();
  assert.equal(nb.status, 200);
  let puts = gh.puts();
  assert.deepEqual(puts.map((p) => p.path.split("/contents/")[1]).sort(), ["README.md", "latest.json", "weddings/other-wedding.json", "weddings/test-wedding.json"]);
  for (const p of puts) {
    assert.equal(p.body.sha, undefined, "new files have no sha");
    assert.match(p.body.message, /^Backup \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    assert.equal(p.body.author.name, "Wedding Guest Platform backup");
    assert.equal(p.body.committer.name, "Wedding Guest Platform backup");
  }
  const text = gh.files.get("weddings/test-wedding.json")!.text;
  const w = JSON.parse(text);
  assert.equal(text, stableJson(w), "pretty-printed with sorted keys");
  assert.ok(!/password_hash|session_version|exported_at/.test(text), "no password hash, no export time");
  for (const k of ["families", "rsvps", "sends", "opens", "settings", "invite", "activity", "helpers"]) assert.ok(k in w, k);
  assert.ok("live" in w.invite && "draft" in w.invite);
  assert.equal(w.families[0].name, "Family Salem");
  const latest = JSON.parse(gh.files.get("latest.json")!.text);
  assert.equal(latest.weddings, 2);
  assert.equal(latest.families, 1);
  assert.ok("site" in latest && "at" in latest);
  assert.match(gh.files.get("README.md")!.text, /private/);
  const [row] = await query("select github from backups where blob_key like '%/all.json' order by id desc limit 1");
  assert.equal(row.github.ok, true);
  assert.equal(row.github.files, 4);

  // nothing changed: no PUT at all (no empty commits)
  gh.reset();
  const same = await runBackup("manual");
  assert.equal(same.github.ok, true);
  assert.equal(same.github.files, 0);
  assert.equal(gh.puts().length, 0);

  // one wedding changed: only its file and latest.json are written, with the current sha
  await addFamily("test-wedding", rima, "Family Karam", "b", 2);
  gh.reset();
  const before = gh.files.get("weddings/test-wedding.json")!.sha;
  const two = await runBackup("manual");
  puts = gh.puts();
  assert.deepEqual(puts.map((p) => p.path.split("/contents/")[1]).sort(), ["latest.json", "weddings/test-wedding.json"]);
  assert.equal(puts.find((p) => p.path.endsWith("test-wedding.json"))!.body.sha, before);
  assert.equal(two.github.files, 2);
  assert.equal(JSON.parse(gh.files.get("latest.json")!.text).families, 2);
  const h = (await M("GET", "health")).body.github_backup;
  assert.equal(h.configured, true);
  assert.equal(h.last_ok_at, two.github.at);
  assert.equal(h.last_error, null);

  // archiving copies that wedding too
  gh.reset();
  await addFamily("test-wedding", rima, "Family Nassar", "a", 2);
  const ar = await M("POST", "archive", { slug: "test-wedding" });
  assert.equal(ar.body.backup.ok, true);
  assert.ok(gh.puts().some((p) => p.path.endsWith("weddings/test-wedding.json")));
  await M("POST", "unarchive", { slug: "test-wedding" });
});

test("GitHub: a wrong or expired token (401) is recorded as a plain error; the backup itself still succeeds", async () => {
  setGitHub(true);
  const gh = fakeGitHub();
  gh.setFail(() => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }));
  const nb = await nightly();
  assert.equal(nb.status, 200, "the nightly backup succeeds when GitHub fails");
  const [row] = await query("select ok, github from backups order by id desc limit 1");
  assert.equal(row.ok, true);
  assert.equal(row.github.ok, false);
  assert.equal(row.github.error, TOKEN_MESSAGE);
  assert.equal(gh.calls.length, 1, "no retry for a bad token");
  const h = (await M("GET", "health")).body;
  assert.equal(h.last_backup.ok, true);
  assert.equal(h.github_backup.last_error, TOKEN_MESSAGE);
  assert.ok(h.github_backup.last_ok_at, "the earlier good copy is still reported");
});

test("GitHub: repository not found, not allowed (403), busy (retried twice), network down: never throws", async () => {
  setGitHub(true);
  let gh = fakeGitHub("someone/else");
  let b = await runBackup("manual");
  assert.equal(b.ok, true);
  assert.match(b.github.error, /The GitHub repository your-name\/wedding-backups was not found/);

  gh = fakeGitHub();
  gh.setFail((c) => c.method === "PUT" ? new Response("{}", { status: 403 }) : null);
  await addFamily("test-wedding", rima, "Family Saad", "a", 1);
  b = await runBackup("manual");
  assert.match(b.github.error, /^GitHub token is missing, wrong or expired\. Or it is not allowed/);

  gh = fakeGitHub();
  gh.setFail(() => new Response("{}", { status: 503 }));
  b = await runBackup("manual");
  assert.equal(b.ok, true);
  assert.equal(b.github.ok, false);
  assert.match(b.github.error, /GitHub is busy/);
  assert.equal(gh.calls.length, 3, "first try + two retries");

  gh = fakeGitHub();
  let n = 0;
  gh.setFail((c) => (c.method === "PUT" && n++ === 0 ? new Response("{}", { status: 429, headers: { "retry-after": "1" } }) : null));
  b = await runBackup("manual");
  assert.equal(b.github.ok, true, "a rate limit once is retried and then works");

  // someone changed a file on GitHub after it was listed: the PUT gets 409, the sha is read again and it works
  gh = fakeGitHub();
  await runBackup("manual");
  await addFamily("test-wedding", rima, "Family Aoun", "b", 1);
  gh.setFail((c) => c.path.endsWith("/git/trees/main") ? new Response(JSON.stringify({ tree: [...gh.files].map(([path]) => ({ path, type: "blob", sha: "0".repeat(40) })) }), { status: 200 }) : null);
  gh.reset();
  b = await runBackup("manual");
  assert.equal(b.github.ok, true);
  assert.ok(gh.calls.some((c) => c.method === "GET" && c.path.endsWith("/contents/weddings/test-wedding.json")), "the sha was read again");
  assert.match(JSON.parse(gh.files.get("weddings/test-wedding.json")!.text).families.map((f: any) => f.name).join(), /Family Aoun/);

  // out of time: recorded as not finished, the next backup carries on
  gh = fakeGitHub();
  GH.budgetMs = -1;
  b = await runBackup("manual");
  GH.budgetMs = 8000;
  assert.equal(b.ok, true);
  assert.match(b.github.error, /not finished yet/);
  b = await runBackup("manual");
  assert.equal(b.github.ok, true);
  assert.ok(gh.files.has("weddings/test-wedding.json"));

  globalThis.fetch = (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as typeof fetch;
  b = await runBackup("manual");
  assert.equal(b.ok, true);
  assert.match(b.github.error, /GitHub could not be reached/);
  process.env.BACKUP_GITHUB_REPO = "not a repo";
  b = await runBackup("manual");
  assert.match(b.github.error, /must look like owner\/name/);
});

test("GitHub: the token's end date is kept and health warns when under 30 days", async () => {
  assert.equal(parseGitHubDate("2027-11-08 10:00:00 UTC"), "2027-11-08T10:00:00.000Z");
  assert.equal(parseGitHubDate("2027-11-08 11:00:00 +0100"), "2027-11-08T10:00:00.000Z");
  assert.equal(parseGitHubDate("soon"), null);
  setGitHub(true);
  const far = new Date(Date.now() + 200 * 86400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ") + " UTC";
  fakeGitHub(undefined, { expires: fmt(far) });
  let b = await runBackup("manual");
  assert.equal(b.github.ok, true);
  assert.equal(b.github.token_expires_at.slice(0, 19), far.toISOString().slice(0, 19));
  let h = (await M("GET", "health")).body.github_backup;
  assert.equal(h.last_error, null);
  assert.equal(h.token_expires_at, b.github.token_expires_at);

  const soon = new Date(Date.now() + 10.5 * 86400_000);
  fakeGitHub(undefined, { expires: fmt(soon) });
  b = await runBackup("manual");
  h = (await M("GET", "health")).body.github_backup;
  assert.equal(h.token_expires_at.slice(0, 19), soon.toISOString().slice(0, 19));
  assert.match(h.last_error, /The GitHub token stops working in 10 days/);
});
