# site/manage/: the owner's manager

`index.html` is the page at `/manage/`. Only the owner uses it, with the owner password (set on Netlify as
`OWNER_PASSWORD`; set on the host). It talks only to `/api/manage/...` (described in `docs/API.md`, section 3)
and loads SheetJS from `cdn.sheetjs.com` for the Excel download.

| Part of the page | What it does |
|---|---|
| Health line (top) | Database OK, when the last backup was made, how many weddings and families. |
| **Weddings** | Every wedding with its date, status (Live / Design not published / Archived), how many families were sent, opened, answered and are coming, and the last thing that happened. "Open admin" and "Design" open that wedding's helpers' page (the owner does not need its password). "Details" opens the links to send the couple (with **Copy as a WhatsApp message**), the wedding's details, a new password, download everything, archive, and delete. |
| **+ New wedding** | The green button at the top of the Weddings list scrolls to this form (on a phone it is below the list). Names, the wedding's address (suggested from the names, can be changed before creating, not after), date, time, time zone, answer-by date, helpers' password (default `wedding`), and which design to start from. |
| **Data** | All families of all live weddings in one table, with filters (wedding, side, status, search) and **Download Excel**. |
| **Check** | Lists things that look wrong (same family twice, more guests than seats, sent long ago and never opened, late answers, wrong-looking phone numbers, weddings soon with no helper active, designs never published), each with a button to open it in that wedding's admin. |
| **Backups** | The nightly backups (and ones made by hand). **Restore…** shows first what would change, then asks twice; restoring over an existing wedding also needs its address typed. |

Safety rules kept in this page: delete asks twice, needs the wedding's address typed, and downloads a full copy
first (if the copy cannot be downloaded, nothing is deleted). Archive asks twice. Passwords are never stored by the
page.
