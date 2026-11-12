// tests/meta.test.ts: the link preview lines (what WhatsApp shows when a wedding link is pasted).
// What it checks: netlify/edge-functions/_lib/_meta-rewrite.ts writes each wedding's names, date, place, preview picture
// and address into <title>, description, og:* and twitter:*, escapes odd characters, leaves every other byte of the
// template alone, copes with missing lines; and netlify/edge-functions/invite-meta.ts (with a fake Netlify context)
// rewrites /<slug>/ and /<slug>, keeps the page's headers, and sends the page unchanged when anything is not right.
// It reads site/app/index.html and calls the real GET /<slug>/api/invite against the in-memory database.
//notes: the edge function runs on Deno at Netlify; here it runs on Node with global fetch stubbed.
import "./_env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inviteSlug, buildMeta, rewriteMeta, ogImageUrl, esc } from "../netlify/edge-functions/_lib/_meta-rewrite.ts";
import edge, { config as edgeConfig } from "../netlify/edge-functions/invite-meta.ts";
import { RESERVED_SLUGS, SLUG_RE } from "../netlify/functions/_lib/_wedding.ts";
import { call, handlers, ownerLogin, createWedding } from "./_helpers.ts";

const TEMPLATE = readFileSync(new URL("../site/app/index.html", import.meta.url), "utf8");
const ORIGIN = "https://example.netlify.app";
const HEAD_END = TEMPLATE.indexOf("</head>");

const design = (over: any = {}) => ({
  slug: "nour-and-ali", status: "live",
  config: { couple: { groom: "Ali", bride: "Nour" }, date: { en: "Friday 4 June 2027" }, venue: { name: "The Garden", city: "Byblos, Lebanon" }, ...over.config },
  assets: { og: "/nour-and-ali/og-envelope.jpg", ...over.assets },
});
const metaOf = (html: string, key: string) => {
  const m = new RegExp(`<meta (?:name|property)="${key.replace(/[:]/g, "\\:")}" content="([^"]*)">`).exec(html);
  return m ? m[1] : null;
};
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;

test("the slug rules match the server's (reserved words, shape)", () => {
  for (const r of RESERVED_SLUGS) assert.equal(inviteSlug(`/${r}/`), null, r);
  assert.equal(inviteSlug("/nour-and-ali/"), "nour-and-ali");
  assert.equal(inviteSlug("/nour-and-ali"), "nour-and-ali");
  for (const p of ["/", "/index.html", "/app.js", "/style.css", "/og-envelope.jpg", "/nour-and-ali/app.js", "/nour-and-ali/admin/", "/Nour/", "/-x-/"]) assert.equal(inviteSlug(p), null, p);
  assert.equal(String(SLUG_RE), String(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/), "update SLUG_RE in _meta-rewrite.ts too");
  assert.deepEqual(edgeConfig.path, ["/:slug", "/:slug/"]);
  assert.equal(edgeConfig.onError, "bypass");
});

test("every head line gets this wedding's words, picture and address", () => {
  const out = rewriteMeta(TEMPLATE, buildMeta(design(), ORIGIN, "nour-and-ali"));
  assert.equal(titleOf(out), "Ali &amp; Nour");
  assert.equal(metaOf(out, "description"), "You are invited to the wedding of Ali &amp; Nour, Friday 4 June 2027, The Garden, Byblos.");
  assert.equal(metaOf(out, "og:title"), "Ali &amp; Nour · You're invited");
  assert.equal(metaOf(out, "og:description"), "Friday 4 June 2027 · The Garden, Byblos. Tap to open your invitation.");
  assert.equal(metaOf(out, "og:image"), `${ORIGIN}/nour-and-ali/og-envelope.jpg`);
  assert.equal(metaOf(out, "og:image:width"), "1200");
  assert.equal(metaOf(out, "og:image:height"), "630");
  assert.equal(metaOf(out, "og:type"), "website");
  assert.equal(metaOf(out, "og:url"), `${ORIGIN}/nour-and-ali/`);
  assert.equal(metaOf(out, "twitter:card"), "summary_large_image");
  assert.ok(!/Karim|Maya|example\.com/.test(out.slice(0, out.indexOf("</head>"))), "nothing of the template couple left in <head>");
});

test("only the head lines change: the rest of the page is byte for byte the template", () => {
  const out = rewriteMeta(TEMPLATE, buildMeta(design(), ORIGIN, "nour-and-ali"));
  const outEnd = out.indexOf("</head>");
  assert.equal(out.slice(outEnd), TEMPLATE.slice(HEAD_END), "everything from </head> on is unchanged");
  const strip = (h: string) => h.split("\n").filter((l) => !/^<title>|^<meta (name="description"|property="og:|name="twitter:)/.test(l)).join("\n");
  assert.equal(strip(out.slice(0, outEnd)), strip(TEMPLATE.slice(0, HEAD_END)), "every other head line is unchanged");
  assert.equal(out.split("\n").length, TEMPLATE.split("\n").length + 1, "one line added (og:url)");
});

test("the template couple's own design reproduces the template's lines, with an absolute picture and the address", () => {
  const hs = design({ config: { couple: { groom: "Karim", bride: "Maya" }, date: { en: "Saturday 19 June 2027" }, venue: { name: "Olive Grove Hall", city: "Batroun, Lebanon" } }, assets: { og: "/karim-and-maya/og-envelope.jpg" } });
  const out = rewriteMeta(TEMPLATE, buildMeta(hs, ORIGIN, "karim-and-maya"));
  for (const k of ["description", "og:title", "og:description", "og:type", "og:image:width", "og:image:height", "twitter:card"]) assert.equal(metaOf(out, k), metaOf(TEMPLATE, k), k);
  assert.equal(titleOf(out), titleOf(TEMPLATE));
  assert.equal(metaOf(out, "og:image"), `${ORIGIN}/karim-and-maya/og-envelope.jpg`);
});

test("an uploaded preview picture becomes a 1200 x 630 JPG from the Image CDN (absolute, & escaped)", () => {
  const up = "/.netlify/images?url=/nour-and-ali/asset/og-1a2b.png&w=1170&fm=webp&q=80";
  const want = `${ORIGIN}/.netlify/images?url=/nour-and-ali/asset/og-1a2b.png&w=1200&h=630&fit=cover&fm=jpg&q=80`;
  assert.equal(ogImageUrl(up, ORIGIN, "nour-and-ali"), want);
  const out = rewriteMeta(TEMPLATE, buildMeta(design({ assets: { og: up } }), ORIGIN, "nour-and-ali"));
  assert.equal(metaOf(out, "og:image"), esc(want));
  assert.ok(metaOf(out, "og:image")!.includes("&amp;w=1200&amp;h=630"));
  assert.equal(ogImageUrl("", ORIGIN, "x-y"), `${ORIGIN}/x-y/og-envelope.jpg`, "no picture = the default envelope");
  assert.equal(ogImageUrl("https://cdn.example.com/p.jpg", ORIGIN, "x-y"), "https://cdn.example.com/p.jpg");
});

test("names with & < > and quotes are escaped and cannot break the page", () => {
  const out = rewriteMeta(TEMPLATE, buildMeta(design({ config: { couple: { groom: 'Ali "Al" <b>', bride: "Nour & Co" } } }), ORIGIN, "nour-and-ali"));
  assert.equal(titleOf(out), "Ali &quot;Al&quot; &lt;b&gt; &amp; Nour &amp; Co");
  assert.equal(metaOf(out, "og:title"), "Ali &quot;Al&quot; &lt;b&gt; &amp; Nour &amp; Co · You're invited");
  assert.ok(!out.includes("<b>"));
  assert.equal(out.slice(out.indexOf("</head>")), TEMPLATE.slice(HEAD_END));
});

test("missing lines: og lines are added before </head>, others stay missing; no </head> = rewrites only", () => {
  const bare = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>Hi</body></html>";
  const out = rewriteMeta(bare, buildMeta(design(), ORIGIN, "nour-and-ali"));
  assert.equal(metaOf(out, "og:title"), "Ali &amp; Nour · You're invited");
  assert.equal(metaOf(out, "og:image"), `${ORIGIN}/nour-and-ali/og-envelope.jpg`);
  assert.equal(metaOf(out, "og:url"), `${ORIGIN}/nour-and-ali/`);
  assert.equal(titleOf(out), null);
  assert.ok(out.endsWith("</head><body>Hi</body></html>"));
  const noHead = '<title>Old</title><meta property="og:title" content="Old">';
  assert.equal(rewriteMeta(noHead, buildMeta(design(), ORIGIN, "nour-and-ali")), '<title>Ali &amp; Nour</title><meta property="og:title" content="Ali &amp; Nour · You\'re invited">');
  const m = buildMeta({ config: { couple: { groom: "Ali", bride: "Nour" } } }, ORIGIN, "nour-and-ali");   // no date, no venue
  assert.equal(m.description, "You are invited to the wedding of Ali & Nour.");
  assert.equal(m.ogDescription, "Tap to open your invitation.");
  assert.equal(buildMeta(null, ORIGIN, "nour-and-ali").title, "Our wedding");
});

// ---- the edge function itself, with a fake Netlify context and a stubbed fetch --------------------------------
const pageResponse = () => new Response(TEMPLATE, { status: 200, headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "private, max-age=0, no-store", "x-robots-tag": "noindex, nofollow", "content-length": String(Buffer.byteLength(TEMPLATE)) } });
async function runEdge(url: string, api: () => Response | Promise<Response>, page: () => Response = pageResponse) {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (u: any) => { asked.push(String(u)); return api(); }) as any;
  try {
    let nexts = 0;
    const res = await edge(new Request(url), { next: async () => { nexts++; return page(); } });
    return { res, asked, nexts };
  } finally { globalThis.fetch = realFetch; }
}
const apiOk = () => Response.json(design({ assets: { og: "/.netlify/images?url=/nour-and-ali/asset/og-1.jpg&w=1170&fm=webp&q=80" } }));

test("edge: /<slug>/?t=CODE and /<slug> are rewritten from the live design; headers kept; no redirect", async () => {
  for (const path of ["/nour-and-ali/?t=ABCDEFGHJK", "/nour-and-ali"]) {
    const { res, asked } = await runEdge(ORIGIN + path, apiOk);
    assert.equal(res!.status, 200);
    assert.deepEqual(asked, [`${ORIGIN}/nour-and-ali/api/invite`], "asks the public design, no draft, no code");
    const html = await res!.text();
    assert.equal(metaOf(html, "og:title"), "Ali &amp; Nour · You're invited");
    assert.equal(metaOf(html, "og:url"), `${ORIGIN}/nour-and-ali/`, "address without the guest's code");
    assert.ok(metaOf(html, "og:image")!.startsWith(`${ORIGIN}/.netlify/images?url=/nour-and-ali/asset/og-1.jpg&amp;w=1200&amp;h=630&amp;fit=cover&amp;fm=jpg`));
    assert.equal(res!.headers.get("cache-control"), "private, max-age=0, no-store");
    assert.equal(res!.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(res!.headers.get("content-length"), null, "old length dropped (the body changed)");
  }
});

test("edge: anything not right sends the page unchanged", async () => {
  // not an invite address: does nothing at all
  for (const p of ["/manage/", "/app.js", "/nour-and-ali/app.js", "/admin/", "/"]) {
    const { res, asked, nexts } = await runEdge(ORIGIN + p, apiOk);
    assert.equal(res, undefined, p); assert.equal(asked.length, 0, p); assert.equal(nexts, 0, p);
  }
  // design missing (404), server error, not JSON, network down: original page
  for (const api of [() => Response.json({ error: "This wedding does not exist.", code: "no_wedding" }, { status: 404 }),
                     () => new Response("oops", { status: 500 }), () => new Response("not json"), () => { throw new Error("down"); }]) {
    const { res } = await runEdge(`${ORIGIN}/nour-and-ali/`, api);
    assert.equal(await res!.text(), TEMPLATE);
  }
  // not a page (e.g. a 404 or a file): untouched
  const js = () => new Response("console.log(1)", { status: 200, headers: { "content-type": "application/javascript" } });
  const { res } = await runEdge(`${ORIGIN}/nour-and-ali/`, apiOk, js);
  assert.equal(await res!.text(), "console.log(1)");
});

test("with the real invite API: an archived wedding still shows its couple's names; a new wedding never shows Karim & Maya", async () => {
  const owner = await ownerLogin();
  await createWedding(owner, { slug: "mia-and-omar", groom: "Omar", bride: "Mia" });
  const live = (await call(handlers.invite, "GET", "/mia-and-omar/api/invite")).body;
  let m = buildMeta(live, ORIGIN, "mia-and-omar");
  assert.equal(m.ogTitle, "Omar & Mia · You're invited");
  assert.equal(m.image, `${ORIGIN}/mia-and-omar/og-envelope.jpg`);
  const a = await call(handlers.manage, "POST", "/api/manage/archive", { cookie: owner, body: { slug: "mia-and-omar" } });
  assert.ok(a.status < 300, JSON.stringify(a.body));
  const archived = (await call(handlers.invite, "GET", "/mia-and-omar/api/invite")).body;
  assert.equal(archived.status, "archived");
  m = buildMeta(archived, ORIGIN, "mia-and-omar");
  assert.equal(m.title, "Omar & Mia");
});

test("netlify/edge-functions holds only real Edge Functions; helpers live in its _lib/ (never routed, never an entry file)", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const dir = new URL("../netlify/edge-functions/", import.meta.url);
  for (const f of readdirSync(dir)) {
    if (statSync(new URL(f, dir)).isDirectory()) { assert.equal(f, "_lib", `unexpected folder ${f}`); continue; }
    assert.ok(f === "README.md" || !f.startsWith("_"), `${f}: move helpers to netlify/edge-functions/_lib/`);
  }
  const lib = readdirSync(new URL("_lib/", dir));
  assert.ok(!lib.includes("_lib.ts") && !lib.includes("index.ts"), "_lib/ must not have an entry file");
});
