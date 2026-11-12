# netlify/edge-functions/

What this folder is for: Netlify Edge Functions, small pieces of code Netlify runs on a page request before the page is
sent. There is one: it makes a wedding link pasted into WhatsApp (iMessage, Facebook, ...) show THAT wedding's names, date
and "Link preview picture" instead of Karim & Maya's. Who calls it: Netlify, on its own, for the invite page.
What it reads: the invite page and the wedding's published design. What it writes: nothing (no database, no files).
What NOT to change: never redirect or drop the guest's `?t=` code, never change anything in the page outside the `<head>`
preview lines, and keep "send the page unchanged when in doubt". The template `site/app/index.html` is never edited.

| File | Address | What it does |
|---|---|---|
| `invite-meta.ts` | `GET /<slug>/`, `GET /<slug>` | Lets the page load as usual, asks `/<slug>/api/invite` for the live design, and rewrites the page's `<title>`, description, `og:*` and `twitter:*` lines for this wedding. Unchanged page on any doubt; `onError: "bypass"`. |
| `_lib/_meta-rewrite.ts` | (none) | The text rewriting itself (`inviteSlug`, `buildMeta`, `rewriteMeta`). No imports, so the Node tests can load it. |

Rules that keep this safe:
- Netlify turns every file at the top of this folder into an Edge Function, so helpers go in `_lib/` (no `index.ts` or
  `_lib.ts` there). `tests/meta.test.ts` checks this.
- The address list is declared in the file's `config` (no `[[edge_functions]]` block in `netlify.toml` is needed; `netlify dev`
  loads it too: "Loaded edge function invite-meta").
- The reserved words and the address rule in `_meta-rewrite.ts` must equal `RESERVED_SLUGS` / `SLUG_RE` in
  `netlify/functions/_lib/_wedding.ts` (the test checks).
- It only works because the site is not behind another site's 200 proxy: a proxy in front would serve the template's own preview lines.

#notes: (developers) unit tests: `tests/meta.test.ts`. Against a running site: `node tools/qa/meta-smoke.mjs <base-url> <slug>`.
#  WhatsApp caches a preview per link; to see a new picture, paste a link it has not seen (e.g. add `&x=1`).
