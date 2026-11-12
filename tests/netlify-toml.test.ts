// tests/netlify-toml.test.ts: checks netlify.toml for the mistakes that would break every wedding page at once.
// What it checks: (1) no redirect only adds or removes a final slash (Netlify matches rules with and without the
// final slash, so such a rule loops forever: "too many redirects" on every invite); (2) every file the template
// loads by a relative address (style.css, app.js, pictures, music, the Excel template) has a root rewrite to
// site/app/, so /<wedding> typed without the slash still works; (3) the site publishes site/ and nothing else.
// It reads files only; no database.
//notes: the toml is read with small regexes on purpose (no TOML library dependency). If netlify.toml's
//   [[redirects]] blocks change shape (e.g. extra keys before "from"), adjust redirects() below.
import "./_env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
function redirects() {
  return [...toml.matchAll(/\[\[redirects\]\]\s*\n\s*from\s*=\s*"([^"]+)"\s*\n\s*to\s*=\s*"([^"]+)"\s*\n\s*status\s*=\s*(\d+)/g)]
    .map((m) => ({ from: m[1], to: m[2], status: Number(m[3]) }));
}
const noSlash = (p: string) => p.replace(/\/+$/, "") || "/";

test("no redirect rule only adds or removes a final slash (it would loop on Netlify)", () => {
  const rs = redirects();
  assert.ok(rs.length >= 5, "redirect rules were found");
  for (const r of rs) {
    const toPath = r.to.split("?")[0];
    assert.ok(!(r.status >= 300 && r.status < 400 && noSlash(r.from) === noSlash(toPath)),
      `rule ${r.from} -> ${r.to} (${r.status}) differs only by a final slash`);
  }
});

test("every template file loaded by a relative address has a root rewrite to site/app/", () => {
  const rs = redirects();
  const rooted = new Map(rs.filter((r) => /^\/[^/:*]+\.[a-z0-9]+$/i.test(r.from)).map((r) => [r.from.slice(1), r]));
  const files = readdirSync(new URL("../site/app/", import.meta.url)).filter((f) => /\.(js|css|jpe?g|webp|png|m4a|mp3|xlsx)$/i.test(f));
  for (const f of files) {
    const r = rooted.get(f);
    assert.ok(r, `missing rewrite /${f} -> /app/${f} in netlify.toml`);
    assert.equal(r!.to, `/app/${f}`); assert.equal(r!.status, 200);
  }
  const catchAll = rs.findIndex((r) => r.from === "/:slug/*");
  for (const f of files) assert.ok(rs.findIndex((r) => r.from === "/" + f) < catchAll, `/${f} must come before /:slug/*`);
});

test("only site/ is published, functions come from netlify/functions", () => {
  assert.match(toml, /\[build\][^[]*publish\s*=\s*"site"/);
  assert.match(toml, /directory\s*=\s*"netlify\/functions"/);
  assert.match(toml, /included_files\s*=\s*\["migrations\/\*\*"\]/);
});
