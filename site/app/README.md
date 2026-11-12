# site/app/: the invitation and the helpers' page (shared by every wedding)

Every wedding's address points here: `/<wedding>/` shows `index.html`, `/<wedding>/admin/` shows `admin.html`,
and `/<wedding>/<file>` is the file of that name in this folder. The page finds out which wedding it is from the
first part of the address.

| File | What it is | Can it be changed? |
|---|---|---|
| `index.html` | The invitation template (sample couple Karim & Maya): the envelope, the six pages, the answer form. | **No, never.** Every wedding uses it. |
| `style.css` | Its look (colours, fonts, sizes, the envelope animation). The colours and fonts are "variables" that the Design tab can change per wedding without touching this file. | **No, never.** |
| `app.js` | The invitation's code. A short header comment, then the original code with the **LOADER** block (search "LOADER"), the only added part: it asks `/<wedding>/api/invite` for this wedding's design, fills in the names, date, place, gift number, colours and fonts, swaps the pictures and music, hides the kids note / gift page / Bismillah when asked, shows a thank-you card when the wedding is archived, or hands over to `slides.js`. Below the loader is the original code, unchanged (only its two web addresses now include the wedding's name). If the website cannot be reached, the page still works with Karim & Maya's details. | Only the LOADER block, carefully. |
| `slides.js` | The "Canva slides" invitation: shows the pages uploaded in the Design tab one under another, with the live parts on top (seal to tap, texts, names, photo, family name + seats, countdown, Maps button, gift number, answer form). Its answer form follows exactly the same rules as the template's. In the Design preview it also lets helpers drag and resize the boxes. | Yes. Keep the answer-form rules. |
| `admin.html` | The helpers' page: Send invites (copy, or Send on WhatsApp / by e-mail when a number or e-mail is saved), Dashboard, Messages, Activity, **Design** (change the invite, preview, save, publish) and **Settings** (password, links, download everything). Talks to `/<wedding>/api/admin/...` (see `docs/API.md`). | Yes. Keep the double confirmations, the tap guard and plain words. |
| `envelope.jpg`, `envelope-open.jpg`, `envelope-seal.webp` | The envelope pictures (closed, opened, the wax seal on its own); drawn placeholders with the sample initials K & M. | No. A wedding uses its own by uploading them in Design. |
| `couple.jpg` | Placeholder picture behind page 2 (no people in it). | No (upload in Design instead). |
| `og-envelope.jpg` | The picture WhatsApp shows under a link. | No (upload in Design instead). |
| `music.m4a` | A short synthetic tone that starts when the envelope is tapped (a wedding uploads its own song). | No (upload in Design instead). |
| `guest-list-template.xlsx` | The Excel template helpers download to add many families at once: Name, Guests Allowed, and optional Phone and E-mail (used for new families only). Files with only the first two columns still work. The side is chosen on the page, not in the file. Second sheet = instructions. | Yes, if the column headings stay. |

Header comments: every file here has a plain-words header, **except `index.html` and `style.css`**, which must stay
byte-identical to the original (a header would change them). Their description is this README.

## How a wedding's design is stored

The Design tab edits a "draft"; **Publish** copies it to "live", which is what guests see. Both look like this
(full description in `docs/API.md`, Invite design):

- `mode`: `"template"` (Karim & Maya's design with this couple's details) or `"slides"` (Canva pages).
- `config`: every text of the invitation (names, dates, families, place, reply-by line, kids note, gift, music settings).
- `show`: whether to show the kids note, the gift page and the Bismillah.
- `theme`: 7 colours, 3 fonts, the text size.
- `assets`: uploaded replacements for the 6 pictures/music (empty = the original file).
- `slides`: for Canva mode, each slide's picture or video and the boxes on it (positions in % of the slide).

## The Design preview (for developers)

`admin.html` shows `/<wedding>/?demo=1&draft=1` in a frame. The loader in `app.js` asks the admin page for the
design being edited (message `twp-ready`, answer `twp-invite`), so the preview shows changes before they are saved.
In Canva mode the frame also has `&edit=1`: `slides.js` outlines every box and sends `twp-overlay-select` and
`twp-overlay-move` back when a box is tapped or dragged.
