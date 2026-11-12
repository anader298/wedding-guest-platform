// =====================================================================================================
// _github-backup.ts: an off-site copy of every wedding in the owner's own private GitHub repository.
//
// What it is for: after each successful backup (nightly, "Back up now", archive) the site also writes one
//   readable file per wedding into a GitHub repository the owner owns, so there is a copy outside Netlify.
//   Switched on only when BOTH Netlify settings are present:
//     BACKUP_GITHUB_REPO   = "owner/name" of the repository (e.g. "your-name/wedding-backups")
//     BACKUP_GITHUB_TOKEN  = a fine-grained GitHub token for that one repository, Contents: Read and write
//   (any capitalisation of the key is accepted; spaces around the value are ignored).
// Who calls it: _backup.ts runBackup(), after the backup file is safely in Blobs.
// What it reads/writes: nothing in the database itself (the caller records the result on the backups row);
//   GitHub over HTTPS: weddings/<slug>.json, latest.json, and README.md (only if missing).
//
// What NOT to change and why:
//   - syncToGitHub() NEVER throws. A GitHub problem must never make the real backup (in Blobs) fail.
//   - No password hashes and no session numbers go to GitHub: that copy is for reading and safe keeping;
//     restoring is done from the Blobs backups on the manager page.
//   - Files are pretty-printed with sorted keys and without "exported_at", so a file only changes (and only
//     makes a commit) when the wedding really changed. Unchanged files are skipped by comparing the git
//     blob hash we compute with the sha GitHub reports; no empty commits.
//   - Error texts are shown on the manager's Health line: keep them plain sentences.
//
//notes:
// - Calls: GET /repos/{o}/{r} (exists? default branch), GET /repos/{o}/{r}/git/trees/{branch}?recursive=1 (every
//   file's sha in one call; 404/409 = empty repository), then for each CHANGED file only, the Contents API
//   PUT /repos/{o}/{r}/contents/{path} with { message, content (base64), sha?, author, committer } (one commit each).
//   A 409/422 on PUT (the file changed on GitHub meanwhile) re-reads that file's sha (GET contents) and tries once more.
// - 429, 5xx and 403 with x-ratelimit-remaining: 0 are retried twice (after GH.retryMs, then twice that); then the
//   run is recorded as failed.
// - Time budget GH.budgetMs (8 s) for the writes, so the function never hits Netlify's time limit: when it runs out,
//   the run is recorded as not finished and the next backup carries on (written files are then unchanged, so skipped).
// - 401 = bad or expired token; 403 otherwise = token not allowed to write that repository; 404 on the
//   repository itself = wrong name or the token cannot see it.
// - GitHub reports a token's end date in the header github-authentication-token-expiration
//   ("2027-11-08 10:00:00 UTC"); we return it as token_expires_at (ISO) so the Health line can warn.
// - A wedding deleted on the site keeps its last file in the repository (nothing is ever deleted there).
// =====================================================================================================
import { createHash } from "node:crypto";

export const GH = { api: "https://api.github.com", retryMs: 1000, tries: 3, budgetMs: 8000 };
const AUTHOR = { name: "Wedding Guest Platform backup", email: "backup@wedding-guest-platform.invalid" };
export const TOKEN_MESSAGE = "GitHub token is missing, wrong or expired.";

export interface GitHubResult { ok: boolean; at: string; error?: string; files: number; unchanged: number; token_expires_at?: string }

function env(name: string): string {
  for (const k of Object.keys(process.env)) if (k.toLowerCase() === name.toLowerCase() && (process.env[k] || "").trim()) return (process.env[k] as string).trim();
  return "";
}
export function githubConfig() {
  const repo = env("BACKUP_GITHUB_REPO").replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const token = env("BACKUP_GITHUB_TOKEN");
  return { repo, token, configured: !!(repo && token), half: !!repo !== !!token };
}

/** Same value, every object's keys sorted, so the JSON text is stable between runs. */
export function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
export const stableJson = (v: any) => JSON.stringify(sortKeys(v), null, 2) + "\n";
/** The sha GitHub shows for a file with this content (git blob hash). */
export const gitBlobSha = (text: string) => {
  const b = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
};

/** One wedding from a backup file, as it is written to GitHub: no password hash, no export time. */
export function githubWedding(w: any) {
  const out = structuredClone(w);
  delete out.exported_at;
  if (out.wedding) { delete out.wedding.password_hash; delete out.wedding.session_version; }
  return out;
}

const README = (repo: string) => `# Wedding backups (Wedding Guest Platform)

This private repository is a copy of every wedding on your website, written by the website itself
after each backup (every night at 03:00 UTC, when you tap **Back up now**, and when a wedding is archived).

- \`weddings/<address>.json\`: one file per wedding: families, answers, sends, opens, settings, the invitation
  design (live and draft), the activity log and the helpers. No passwords.
- \`latest.json\`: when the copy last changed, how many weddings and families, and the website address.

Keep this repository **private**: it holds guests' names and phone numbers.
Do not edit files here; the website overwrites them. To put a wedding back, use **Backups** on your manager page.
GitHub keeps every earlier version of each file (open a file, then **History**).

Repository: ${repo}
`;

/** "2027-11-08 10:00:00 UTC" or "... +0100" (GitHub's token-expiry header) -> ISO, or null. */
export function parseGitHubDate(h: string): string | null {
  const t = h.trim().replace(/\s+UTC$/i, "Z").replace(/\s+([+-]\d{2}):?(\d{2})$/, "$1:$2").replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const d = new Date(t);
  return isNaN(+d) ? null : d.toISOString();
}

class GhError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (r: Response) => r.status === 429 || r.status >= 500 || (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0");

/**
 * Writes the given weddings (backup-file shape) and the summary to GitHub. Never throws.
 * Returns null when the two settings are not both present.
 */
export async function syncToGitHub(weddings: any[], summary: { weddings: number; families: number; site: string | null }): Promise<GitHubResult | null> {
  const cfg = githubConfig();
  if (!cfg.configured) return null;
  const at = new Date().toISOString();
  const res: GitHubResult = { ok: false, at, files: 0, unchanged: 0 };
  const note = (r: Response) => {
    const h = r.headers.get("github-authentication-token-expiration");
    const d = h ? parseGitHubDate(h) : null;
    if (d) res.token_expires_at = d;
  };
  const [owner, name, extra] = cfg.repo.split("/");
  try {
    if (!owner || !name || extra !== undefined || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name))
      throw new GhError(`The GitHub backup setting BACKUP_GITHUB_REPO must look like owner/name (for example your-name/wedding-backups).`);
    const base = `${GH.api}/repos/${owner}/${name}`;
    const headers = { authorization: `Bearer ${cfg.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "wedding-guest-platform-backup" };
    const call = async (method: string, url: string, body?: unknown) => {
      for (let i = 1; ; i++) {
        let r: Response;
        try { r = await fetch(url, { method, headers: body ? { ...headers, "content-type": "application/json" } : headers, body: body ? JSON.stringify(body) : undefined }); }
        catch (e: any) { if (i >= GH.tries) throw new GhError(`GitHub could not be reached (${String(e?.message || e).slice(0, 100)}).`); await sleep(GH.retryMs * i); continue; }
        note(r);
        if (r.status === 401) throw new GhError(TOKEN_MESSAGE);
        if (retryable(r) && i < GH.tries) { await sleep(GH.retryMs * i); continue; }
        if (retryable(r)) throw new GhError(`GitHub is busy or not answering (status ${r.status}); the copy will be tried again with the next backup.`);
        if (r.status === 403) throw new GhError(`${TOKEN_MESSAGE} Or it is not allowed to change ${cfg.repo}: it needs Contents: Read and write on that repository.`);
        return r;
      }
    };
    const repo = await call("GET", base);
    if (repo.status === 404) throw new GhError(`The GitHub repository ${cfg.repo} was not found. Check BACKUP_GITHUB_REPO on Netlify, and that the token was made for that repository.`);
    if (!repo.ok) throw new GhError(`GitHub answered with status ${repo.status} for ${cfg.repo}.`);
    // every file's sha in one call (an empty repository answers 404/409: no files yet)
    const branch = String(((await repo.json()) as any)?.default_branch || "main");
    const known = new Map<string, string>();
    const tree = await call("GET", `${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    if (tree.ok) { for (const t of (((await tree.json()) as any)?.tree || [])) if (t?.type === "blob") known.set(String(t.path), String(t.sha)); }
    else if (tree.status !== 404 && tree.status !== 409) throw new GhError(`GitHub answered with status ${tree.status} when listing ${cfg.repo}.`);
    const started = Date.now();
    const message = `Backup ${at.slice(0, 10)} ${at.slice(11, 16)} UTC`;
    const url = (path: string) => `${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
    const currentSha = async (path: string) => {
      const r = await call("GET", url(path));
      if (r.status === 404) return null;
      if (!r.ok) throw new GhError(`GitHub answered with status ${r.status} when reading ${path}.`);
      return String(((await r.json()) as any)?.sha || "") || null;
    };
    /** "written" | "unchanged" */
    const put = async (path: string, text: string, onlyIfMissing = false, fresh = false): Promise<"written" | "unchanged"> => {
      const sha = fresh ? await currentSha(path) : known.get(path) ?? null;
      if (sha && (onlyIfMissing || sha === gitBlobSha(text))) { res.unchanged++; return "unchanged"; }
      if (Date.now() - started > GH.budgetMs) throw new GhError(`The copy to GitHub is not finished yet (${res.files} files written); the rest is copied with the next backups.`);
      const body: any = { message, content: Buffer.from(text, "utf8").toString("base64"), author: AUTHOR, committer: AUTHOR };
      if (sha) body.sha = sha;
      const r = await call("PUT", url(path), body);
      // the file changed on GitHub since we listed it (409), or appeared (422): read its sha now and try once more
      if ((r.status === 409 || r.status === 422) && !fresh) return put(path, text, onlyIfMissing, true);
      if (!r.ok) throw new GhError(`GitHub did not accept ${path} (status ${r.status}).`);
      known.set(path, gitBlobSha(text));
      res.files++;
      return "written";
    };
    await put("README.md", README(cfg.repo), true);
    let changed = 0;
    for (const w of weddings) {
      const slug = String(w?.wedding?.slug || "");
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) continue;
      if ((await put(`weddings/${slug}.json`, stableJson(githubWedding(w)))) === "written") changed++;
    }
    // latest.json changes only together with a wedding file (or the first time), so no commit is made for nothing
    const latestPath = "latest.json";
    if (changed || !known.has(latestPath)) await put(latestPath, stableJson({ at, ...summary, note: "Written by Wedding Guest Platform website. Last time any wedding file here changed." }));
    else res.unchanged++;
    res.ok = true;
  } catch (e: any) {
    res.error = e instanceof GhError ? e.message : `The copy to GitHub failed: ${String(e?.message || e).slice(0, 200)}`;
    if (!(e instanceof GhError)) console.error("github backup failed", e);
  }
  return res;
}
