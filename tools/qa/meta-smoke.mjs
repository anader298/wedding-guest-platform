// LINK PREVIEW SMOKE TEST (what WhatsApp shows when a wedding link is pasted)
// What it does, in plain words: asks the site for one wedding's invite page the way WhatsApp does (no script run),
// and checks that the page's title and preview lines carry THAT wedding's names and preview picture (not Karim &
// Maya's), that the address in the preview has no guest code, that the guest's link is not redirected, and that
// the rest of the page, the page's script (/<slug>/app.js) and the manager page (/manage/) are exactly the files
// in this folder. Read-only: it changes nothing, so it is safe on any address.
//
// Usage:   node tools/qa/meta-smoke.mjs <base-url> <slug>
// Example: node tools/qa/meta-smoke.mjs http://localhost:8888 karim-and-maya
// Exit code 0 = fine, 1 = problems found, 2 = could not run. No Playwright needed (plain HTTP).
//notes: (developers) the expected names and picture are read from GET /<slug>/api/invite (the live design), so the
//   script works for any wedding. Byte checks compare with site/app/index.html (after </head>), site/app/app.js and
//   site/manage/index.html from this checkout: run it against a site built from the same commit.
import fs from "node:fs";
// Netlify's free plan adds a comment and a "Powered by Netlify" badge script to every HTML page it serves. Strip them
// before comparing to the repo file, so the comparison is about OUR code only (the badge disappears on a paid plan).
const stripNetlify = (html) => String(html)
  .replace(/<!-- This site is hosted on Netlify\.[\s\S]*?-->\n?/g, "")
  .replace(/<script async src="\/\.netlify\/scripts\/hud[^>]*><\/script>\n?/g, "");

const [base0, slug] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!base0 || !slug) { console.error("usage: node tools/qa/meta-smoke.mjs <base-url> <slug>"); process.exit(2); }
const base = base0.replace(/\/+$/, "");
const repo = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const UA = { "user-agent": "WhatsApp/2.24.1 A", accept: "text/html" };

let fails = 0;
const ok = (cond, what, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}${cond || !extra ? "" : `\n      ${extra}`}`); if (!cond) fails++; };
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const meta = (html, key) => { const m = new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`, "i").exec(html); return m ? decode(m[1]) : null; };
const title = (html) => { const m = /<title>([^<]*)<\/title>/i.exec(html); return m ? decode(m[1]) : null; };
const get = async (path, headers = UA) => { const r = await fetch(base + path, { headers, redirect: "manual" }); return { status: r.status, type: r.headers.get("content-type") || "", cache: r.headers.get("cache-control") || "", body: await r.text(), r }; };

let design;
try {
  const r = await fetch(`${base}/${slug}/api/invite`);
  design = await r.json();
  if (!r.ok) { console.error(`could not read the design of "${slug}": ${design.error || r.status}`); process.exit(2); }
} catch (e) { console.error(`could not reach ${base}: ${e.message}`); process.exit(2); }

const c = design.config?.couple || {};
const names = `${c.groom} & ${c.bride}`;
const og = String(design.assets?.og || "");
const uploaded = og.startsWith("/.netlify/images");
const origin = new URL(base).origin;
console.log(`Wedding "${slug}": ${names}; preview picture: ${uploaded ? "uploaded" : "the default envelope"}\n`);

// The page must keep the Cache-Control the site sends for every /<slug>/ file (no-store on Netlify; `netlify dev`
// replaces it with its own value for every file), so compare with the same wedding's app.js, which no Edge Function touches.
const siteCache = (await get(`/${slug}/app.js`, {})).cache;
const tplHead = repo("site/app/index.html"), tplRest = tplHead.slice(tplHead.indexOf("</head>"));
for (const path of [`/${slug}/`, `/${slug}`, `/${slug}/?t=ABCDEFGHJK`]) {
  const p = await get(path);
  ok(p.status === 200, `${path} answers 200 (no redirect)`, `got ${p.status} ${p.r.headers.get("location") || ""}`);
  ok(/text\/html/.test(p.type), `${path} is a page`, p.type);
  ok(p.cache === siteCache, `${path} keeps the site's Cache-Control (${siteCache})`, `got "${p.cache}"`);
  ok(title(p.body) === names, `${path} <title> is "${names}"`, `got "${title(p.body)}"`);
  ok(meta(p.body, "og:title") === `${names} · You're invited`, `${path} og:title has the names`, `got "${meta(p.body, "og:title")}"`);
  ok((meta(p.body, "description") || "").includes(names), `${path} description has the names`, `got "${meta(p.body, "description")}"`);
  const img = meta(p.body, "og:image") || "";
  if (uploaded) {
    const src = new URLSearchParams(og.slice(og.indexOf("?") + 1)).get("url");
    ok(img === `${origin}/.netlify/images?url=${src}&w=1200&h=630&fit=cover&fm=jpg&q=80`, `${path} og:image is the uploaded picture as a 1200x630 JPG`, `got "${img}"`);
  } else {
    ok(img === `${origin}/${slug}/og-envelope.jpg`, `${path} og:image is this wedding's default envelope`, `got "${img}"`);
  }
  ok(meta(p.body, "og:image:width") === "1200" && meta(p.body, "og:image:height") === "630", `${path} og:image size 1200 x 630`);
  ok(meta(p.body, "og:url") === `${origin}/${slug}/`, `${path} og:url is the address without the guest's code`, `got "${meta(p.body, "og:url")}"`);
  ok(meta(p.body, "og:type") === "website", `${path} og:type website`);
  if (names !== "Karim & Maya") ok(!/Karim|Maya/.test(p.body.slice(0, p.body.indexOf("</head>"))), `${path} head never mentions Karim & Maya`);
  ok(stripNetlify(p.body.slice(p.body.indexOf("</head>"))) === tplRest, `${path} everything after </head> is the template, byte for byte`);
}

const imgUrl = meta((await get(`/${slug}/`)).body, "og:image");
try {
  const r = await fetch(imgUrl, { headers: UA });
  const buf = Buffer.from(await r.arrayBuffer());
  ok(r.ok && /image\/jpe?g/.test(r.headers.get("content-type") || ""), "the preview picture opens and is a JPG", `${r.status} ${r.headers.get("content-type")}`);
  ok(buf.length <= 600 * 1024, `the preview picture is small enough for WhatsApp (${Math.round(buf.length / 1024)} KB)`);
} catch (e) { ok(false, "the preview picture opens", e.message); }

const js = await get(`/${slug}/app.js`, {});
ok(js.status === 200 && js.body === repo("site/app/app.js"), `/${slug}/app.js is untouched`);
const man = await get("/manage/", {});
ok(man.status === 200 && stripNetlify(man.body) === repo("site/manage/index.html"), "/manage/ is untouched");
const land = await get("/", {});
ok(land.status === 200 && stripNetlify(land.body) === repo("site/index.html"), "/ (landing page) is untouched");

console.log(fails ? `\n${fails} problem(s) found.` : "\nAll link preview checks passed.");
process.exit(fails ? 1 : 0);
