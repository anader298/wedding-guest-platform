# tools/qa/fixtures/: made-up data for the pretend website

Used only by `tools/qa/mock-server.mjs` (and so by `tools/qa/pages-smoke.mjs`). Nothing here is real or goes online.
Every name and number is invented.

| File | What it is |
|---|---|
| `karim-and-maya.json` | The template wedding (Karim & Maya's design) with 3 made-up families. |
| `nour-and-ali.json` | A second wedding with other names, the Blush colours, the Cairo Arabic font, kids note and Bismillah hidden. |
| `dana-and-omar.json` | A "Canva slides" wedding with 3 slides (it reuses the template's own pictures). |
| `manage.json` | The pretend owner password (`owner`), health line, backups and Check results for `/manage/`. |

If `docs/API.md` changes a reply shape, update these files and `mock-server.mjs` together.
