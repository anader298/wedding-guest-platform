# tests/journeys/

Checks that belong to the journey tests in `tools/qa/` (`npm run qa`). They are not part of `npm test`, which runs
`tests/*.test.ts` only. Run them by hand with `node --test tests/journeys/qa-silent.test.mjs`.

| File | What it checks |
|---|---|
| `qa-silent.test.mjs` | QA runs are always silent: every script in `tools/qa/` that opens a browser gets it from `tools/qa/_browser.mjs` (muted), never from Playwright directly. `npm run qa` runs it first and stops if it fails. |
