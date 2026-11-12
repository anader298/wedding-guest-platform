# .github/workflows/: the automatic checks GitHub runs

| File | What it does |
|---|---|
| `test.yml` | On every pull request and every change to `main`, GitHub installs the building blocks (`npm ci`) and runs the automatic tests (`npm test`). A green tick on the pull request means they passed; a red cross means do not merge. It never deploys anything: Netlify deploys by itself when `main` changes. |

This README lives here (not in `.github/` itself) on purpose: a `.github/README.md` would replace the repository's front page on GitHub.
