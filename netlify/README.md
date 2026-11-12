# netlify/: the server side

| Folder | What it is |
|---|---|
| `edge-functions/` | One Edge Function, `invite-meta`: writes each wedding's names and preview picture into the invite page's preview lines, so WhatsApp shows the right couple. See `edge-functions/README.md`. |
| `functions/` | The server code (Netlify Functions): every address under `/<wedding>/api/...`, `/<wedding>/asset/...`, `/api/manage/...`, and the nightly backup. See `functions/README.md`. |

Keep `netlify/database/migrations/` from ever existing: Netlify Database would run SQL files from there on every deploy,
and this app applies its own migrations from the top-level `migrations/` folder (two systems on one database drift apart).
