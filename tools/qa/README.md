# tools/qa/: checks you run by hand

These open the site in real browser engines (Safari's WebKit as an iPhone, Chrome's engine as an Android
phone) using Playwright, and report problems in plain words. They started as the checks for a single-wedding
site and were updated for the multi-wedding address layout (`/<slug>/`, `/<slug>/admin/`, `/manage/`).

## The one command: `npm run qa` (replaces hand-testing)

**QA runs are always silent.** Every script gets its browsers from `_browser.mjs` (`launchQuiet()` / `quietContext()`): Chromium
runs with `--mute-audio`, and every page (WebKit too) has its audio and video muted and Web Audio suspended before the page starts.
Music is checked through the template's `window.__music` hook (`playing`, `level()`), never by sound.
`tests/journeys/qa-silent.test.mjs` fails if any script opens a browser another way, and `npm run qa` runs it before anything else.

```
npm run qa                      # both phones; about 15 minutes
ONLY=Pixel npm run qa           # one phone (ONLY=iPhone for the other)
SKIP_SMOKE=1 npm run qa         # only the journeys, not pages-smoke.mjs
```

It makes a throwaway copy of this folder in the temporary folder, starts it with `netlify dev --offline` (the REAL functions,
with the throwaway database that `netlify dev` starts for that copy), puts the demo wedding in it, runs `journeys.mjs` on an
iPhone (WebKit) and a Pixel (Chromium), stops it, then runs `pages-smoke.mjs`. It ends with `[qa] everything passed` and exit
code 0, or `[qa] SOMETHING FAILED`. Nothing in this folder changes, the live site is never contacted, and the copy is deleted at
the end (`KEEP=1` keeps it, with the server log `netlify-dev.log`). Needs the Netlify CLI and Playwright (setup below).

| File | What it is |
|---|---|
| `run-all.mjs` | What `npm run qa` runs (above). `node tools/qa/run-all.mjs --serve` only starts the throwaway site and prints its address and a made-up owner password, so you can click around or run one test file against it; Ctrl+C deletes it. |
| `_browser.mjs` | The silent browsers every script uses (see above). |
| `meta-smoke.mjs` | Read-only. Checks that `/<slug>/` sends WhatsApp the right title, description and picture (the Edge Function rewrite): `node tools/qa/meta-smoke.mjs <base-url> <slug>`. |
| `scenarios.mjs` | Local only. Tries 46 design settings (long and Arabic names, sizes, veil, Canva slides…) on three phones and writes a gallery with automatic checks for words cut off, split or overlapping, tiny or faint text, the countdown and the answer form (see `docs/HANDOVER-CHECKLIST.md`). Start the site with `node tools/qa/run-all.mjs --serve`, then `OWNER_PASSWORD=<printed> npm run qa:scenarios -- http://127.0.0.1:<port>`; `SCN=1,4,7` runs only those scenarios, `PHONES=se,px7` only those phones. Gallery: `../previews/scenarios/index.html`. |
| `journeys.mjs` | The journeys, against a running site on this computer: `OWNER_PASSWORD=... node tools/qa/journeys.mjs http://127.0.0.1:<port>`. Refuses any address that is not this computer. |

What `journeys.mjs` does, in order, on each phone (it checks the screen and the server after every step; a failed step saves a
picture of every open page under `twp-journeys/` in the temporary folder):

1. **Owner**: wrong password gives the plain message; 5 wrong passwords lock that "phone" out (the right password is refused too,
   other phones are not affected); right password; creates `qa-journey` (names, date, time, time zone, password); the links window
   shows the helpers' link and the password and copies them as a WhatsApp message; Data page empty; Check page runs.
2. **Helper**: wrong password message; logs in with a name; every tab opens.
3. **Families**: add one by hand with phone and e-mail; the same name again is refused (page and server); edit seats; Excel upload
   of 3 rows built from the downloadable template (dry run counts, then confirm); remove (link stops) and put back (same link);
   reset a family and undo the reset.
4. **Sending**: COPY INVITE copies the family's own link and marks it sent; Copy reminder only when sent and not answered;
   Mark as not sent; Send on WhatsApp opens wa.me with the link and marks it sent "on WhatsApp".
5. **Guest**: the family's real link: envelope, tap the seal, the pages, "Reserved for", accept with 2 names (names required),
   confirmation; reopen shows the answer filled in; change to decline; a `preview=1` link records nothing; an unknown code and
   another wedding's code both get "please open the personal link".
6. **Dashboard**: tiles equal the server's counts; a tile scrolls to its list; Download Excel has the sheets Families, Summary and
   Activity with the right names and numbers.
7. **Design**: never-published banner; bride's name, gold colour, a font on one page, photo veil, timing, 3 "What to show"
   switches; Save draft (live untouched); the preview shows the draft; Publish, and the guest invite shows all of it; Discard draft;
   "Someone else changed the design" when another helper saved first; a 3000x4000 PNG is shrunk to 1600 px and shown; deleting a
   picture that is in use is refused; the published picture reaches guests through Netlify's image service; Canva slides: 3 slides,
   slide types, drag a box in the preview, publish, the guest sees the slides; back to the template.
8. **Settings**: change the wedding password: the other helper is logged out, the old password is refused, the new one works, the
   owner still gets in.
9. **Owner**: Data page and its filters; Check page shows the expected "phone number looks wrong"; Make a backup now; archive (the
   invite shows the thank-you card, answering gives 410, helpers can look but not change); export JSON has every section; restore the
   backup into `qa-journey-2` (preview first, then apply, same family links); delete `qa-journey-2` (only after typing its address,
   a copy is downloaded first); unarchive `qa-journey`.
10. **Nightly backup**: the scheduled function is invoked directly (`netlify functions:invoke`, else its local address); a new
    backup row appears and its file reads back.
11. **Kept from `pages-smoke.mjs`, now on the real backend**: the template invite is pixel-identical to the untouched
    reference (closed envelope and whole opened page); front page Owner login; no page wider than the phone.

It prints a table: PASS / FAIL / SKIP, phone, step, seconds, what it saw. Exit code 1 if anything failed or was skipped.

Safe to run again and again: each phone's run first deletes `qa-journey` and `qa-journey-2` (only those) and makes them again.
At the end `qa-journey` stays, live, so you can look at it. Notes:
- The lockout check uses the other loopback address (`[::1]` when the site is `127.0.0.1`), which stays locked out of the manager
  for 15 minutes. Run again within 15 minutes against the same site and that step says so (still PASS). With `npm run qa` every
  run is a new site, so it never matters.
- The clipboard is replaced by a recorder and wa.me is answered by the test itself, so nothing is sent to WhatsApp.
- Taps wait 0.45 s around dialogs and 0.75 s between card buttons, because the pages ignore faster taps on purpose.
- Why not `DB_DRIVER=pglite` under `netlify dev`: each function opens its own PGlite on the same folder, and two requests at the
  same moment crash it (`RuntimeError: Aborted()` in the log, then "Something went wrong on the server" everywhere). `run-all.mjs`
  uses the database `netlify dev` starts itself (`DB_DRIVER=pg`), which is one server, like the live site.

## One-time setup (on a computer, from the repo folder)

```
npm install
npm install --no-save playwright pngjs
npx playwright install webkit chromium
```

`--no-save` keeps Playwright out of `package.json`, so the site itself never depends on it. (Or install them outside the repo:
`mkdir -p /tmp/pwtest && cd /tmp/pwtest && npm init -y && npm i playwright pngjs && npx playwright install chromium webkit`, then
run the scripts with `NODE_PATH=/tmp/pwtest/node_modules`. Never run `npm init` inside the repo folder: it overwrites `package.json`.)

## The four checks against a running site

| Script | Changes anything? | Command |
|---|---|---|
| `check-every-invite.mjs` | No (preview mode) | `node tools/qa/check-every-invite.mjs <base-url> <slug>` |
| `admin-smoke.mjs` | Only one "login" line under the name "QA check" in that wedding's Activity | `node tools/qa/admin-smoke.mjs <base-url> <slug>` |
| `manage-smoke.mjs` | No. With `--write` (localhost or deploy preview only) it creates and deletes a throwaway wedding | `OWNER_PASSWORD=... node tools/qa/manage-smoke.mjs <base-url> [--write]` |
| `compare-template.mjs` | No (demo mode) | `node tools/qa/compare-template.mjs <reference-url> <candidate-url>` |

`<base-url>` is the site address without a trailing slash, for example `http://localhost:8888`,
`https://deploy-preview-12--your-site.netlify.app` or `https://your-site.netlify.app`.
`<slug>` is the wedding's short name in its address, for example `karim-and-maya`.

The wedding password is taken from `WEDDING_PASSWORD` (default `wedding`); the owner password from `OWNER_PASSWORD`.
Never write a password into these files.

On a plain `http://` address (your computer), `admin-smoke.mjs` uses Chrome's engine at iPhone size, because Safari's
engine will not keep the login cookie on http. On https addresses it uses the real iPhone engine.

Screenshots are saved in your computer's temporary folder under `twp-qa/` (the scripts print the exact path).
Every script ends with `problems: 0` (or an empty `problems: []`) when all is well, and exits with code 1 otherwise.

## When to run them

- **Locally**, after `npm run seed` and `npm run dev`:
  ```
  node tools/qa/check-every-invite.mjs http://localhost:8888 karim-and-maya
  node tools/qa/admin-smoke.mjs http://localhost:8888 karim-and-maya
  OWNER_PASSWORD=<the one in your .env> node tools/qa/manage-smoke.mjs http://localhost:8888 --write
  ```
- **On a deploy preview** before merging a pull request that changes the invite or the admin page.
- **On the live site** after a code change that touched the invite: `check-every-invite.mjs` only (it is read-only).
  Do not run `manage-smoke.mjs --write` on the live site (the script refuses anyway).

## Template pixel check (handover, and any change near the invite)

The invite must look exactly like the original template. With `npm run dev` running and the seed loaded:

```
node tools/qa/compare-template.mjs "file://$PWD/site/app/index.html" http://localhost:8888/karim-and-maya/
```

Opened as a file, the invite cannot reach the server and runs on its built-in settings (the original).
Every line must say `same`, and `candidateUsedServerDesign` must be `12/12` (otherwise the new copy fell back to its
built-in settings and the comparison proves nothing). Pictures of both are saved so you can look at any `DIFFERENT` one yourself.

## Page tests without the real backend (`pages-smoke.mjs`, `mock-server.mjs`, `fixtures/`)

These three files test the pages (`site/`) on their own, with no database and no Netlify, so they can run on any
laptop in a couple of minutes. Nothing is saved anywhere; the pretend data is thrown away at the end.

| File | What it is |
|---|---|
| `mock-server.mjs` | A pretend website. It serves `site/` with the same address rules as `netlify.toml` and answers `/<wedding>/api/...` and `/api/manage/...` with the reply shapes of `docs/API.md`, from the made-up data in `fixtures/`. **It is not the real backend** (that is `netlify/functions/`), and it does not copy Netlify's redirect quirks (Netlify matches `/x` and `/x/` alike), so also run the checks above under `netlify dev` after touching `netlify.toml`; if `docs/API.md` changes, change this too. You can also click around in it: `node tools/qa/mock-server.mjs` then open `http://localhost:8788/manage/` (password `owner`) or `http://localhost:8788/karim-and-maya/admin/` (any name, password `wedding`). |
| `fixtures/README.md` | Lists the made-up data files below. |
| `fixtures/karim-and-maya.json` | The seeded wedding (template mode, Karim & Maya's design) with 3 made-up families. |
| `fixtures/nour-and-ali.json` | A second wedding with other names, the Blush colours, the Cairo Arabic font, kids note and Bismillah hidden. |
| `fixtures/dana-and-omar.json` | A "Canva slides" wedding with 3 slides (it reuses the template's own pictures as slides). |
| `fixtures/manage.json` | The owner password for the pretend site, the health line, backups and the Check results. |
| `pages-smoke.mjs` | Opens the pages on an iPhone (WebKit) and an Android phone (Chromium) against the pretend website and checks: the template invite is identical, pixel by pixel, to the untouched original (`reference-template/app.js` with `site/app/*`); a guest can answer; another wedding's names, colours and show/hide settings apply; Canva slides render and the answer form works; the helpers' page logs in, every tab opens, Send on WhatsApp works; the Design tab previews, saves, publishes, shows the "someone else changed it" dialog, shrinks big pictures, and receives dragged boxes from the slides preview; the Excel template and old/new Excel files; the owner's manager (weddings, Data, Check, Backups, new wedding); the front page; nothing is wider than the phone. |

Run (Playwright and pngjs installed outside the repo, so the site never depends on them):

```
mkdir -p /tmp/pwtest && cd /tmp/pwtest && npm init -y && npm i playwright pngjs && npx playwright install chromium webkit
cd <this repo>
NODE_PATH=/tmp/pwtest/node_modules node tools/qa/pages-smoke.mjs            # both phones
ONLY=iPhone NODE_PATH=/tmp/pwtest/node_modules node tools/qa/pages-smoke.mjs  # one phone
```

Every line must say `PASS`; the last line says `N passed, 0 failed` and the exit code is 0. On a failure the line says
what the page was showing (open dialog, message, design status), and pictures of any difference are saved in the
temporary folder under `twp-pages-smoke/`.
