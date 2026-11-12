# tools/qa/reference-template/

`app.js` here is the invitation script as it was before the multi-wedding LOADER was added: the same CONFIG,
the same code, the original `/wedding/api/...` addresses. The pixel checks (`pages-smoke.mjs`, `journeys.mjs` step 11)
copy `site/app/*` into a temporary folder, swap in this `app.js`, open it as a file (so it runs on its built-in
CONFIG), and compare it with a seeded wedding served by the real loader. Any difference means the loader changed
how the template looks.

Never edit this file to make a check pass.
