// =====================================================================================================
// _blobs.ts: where uploaded files and backup files are kept (Netlify Blobs).
//
// What it is for: a tiny wrapper around Netlify Blobs with only the five things this app needs
//   (get, set, delete, list, exists), so the rest of the code does not care where files live.
// Who calls it: wedding-asset.ts, wedding-admin.ts (upload-asset / delete asset), manage.ts (copy, delete,
//   backups, restore), backup-nightly.ts.
// What it reads/writes: two Blobs stores:
//   "assets"  key <slug>/<name>           pictures, music and video a wedding uploaded
//   "backups" key <YYYY-MM-DD>/<file>.json full copies of the database
// Blobs hold FILES ONLY. Never put records (families, answers, ...) here: those live in Postgres.
//
// Where the files go:
//   - On Netlify (and under `netlify dev`): real Netlify Blobs.
//   - BLOBS_DRIVER=memory: kept in memory (the tests use this).
//   - BLOBS_DRIVER=file, or Netlify Blobs not available (e.g. `npm run seed` outside netlify dev):
//     files under .data/blobs/<store>/.
//
// Store names per Netlify deploy context (so a deploy preview can never overwrite or delete the live site's files):
//   - production (or no context known, e.g. a laptop or the tests): "assets" and "backups".
//   - any other context (deploy-preview, branch-deploy, dev): writes and deletes go to
//     "assets-<context>-<deploy id>" / "backups-<context>-<deploy id>", lower case, other characters turned into
//     dashes (e.g. "assets-deploy-preview-65ab12cd"). Reads look there first and then FALL BACK to the live store,
//     read-only, so a preview still shows the pictures real weddings already uploaded (its database is a copy
//     of the live one and points at those files). list() returns both, without duplicates.
//   Where the context comes from: at RUNTIME Netlify does NOT set process.env.CONTEXT / BRANCH / DEPLOY_ID for
//   functions (only URL, SITE_NAME, SITE_ID; docs.netlify.com/build/functions/environment-variables). The
//   runtime signal is the global Netlify.context.deploy = { context, id } (the same as the handler's second
//   argument, context.deploy). process.env.CONTEXT is only a fallback for scripts and tests. deployInfo() reads it.
//   Consequence of a preview delete: the preview's own copy is deleted, the live file is not, so in a preview a
//   deleted picture may still be served from the live store. That is on purpose (the live site wins).
//
// What NOT to change: the production store names "assets" and "backups" and the key layouts above. Existing
// files on the live site are found by exactly these names. Keep "no context = production names": if the
// live site ever ran without a context, any other default would hide all its pictures and backups.
// Never use process.env.CONTEXT alone to tell production from a preview: it is undefined at runtime.
//
//notes:
// - Every file is read as a whole into memory. That is fine: uploads are capped at 4 MB (see wedding-admin.ts).
// =====================================================================================================
import { getStore } from "@netlify/blobs";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

export type StoreName = "assets" | "backups";
export interface Blobs {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, data: Uint8Array | string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

const memory = new Map<string, Map<string, Uint8Array>>();
function memoryStore(name: string): Blobs {
  if (!memory.has(name)) memory.set(name, new Map());
  const m = memory.get(name)!;
  return {
    async get(k) { return m.has(k) ? new Uint8Array(m.get(k)!) : null; },
    async set(k, d) { m.set(k, typeof d === "string" ? new TextEncoder().encode(d) : new Uint8Array(d)); },
    async delete(k) { m.delete(k); },
    async list(p = "") { return [...m.keys()].filter((k) => k.startsWith(p)).sort(); },
  };
}

function fileStore(name: string): Blobs {
  const root = resolve(process.env.BLOBS_DIR || ".data/blobs", name);
  const path = (k: string) => {
    const p = resolve(root, k);
    if (!p.startsWith(root + "/")) throw new Error("bad blob key");
    return p;
  };
  const walk = (dir: string, base: string, out: string[]) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const full = join(dir, f), key = base ? base + "/" + f : f;
      if (statSync(full).isDirectory()) walk(full, key, out); else out.push(key);
    }
  };
  return {
    async get(k) { const p = path(k); return existsSync(p) ? new Uint8Array(readFileSync(p)) : null; },
    async set(k, d) { const p = path(k); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, d); },
    async delete(k) { rmSync(path(k), { force: true }); },
    async list(p = "") { const out: string[] = []; walk(root, "", out); return out.filter((k) => k.startsWith(p)).sort(); },
  };
}

function netlifyStore(name: string): Blobs {
  const s = getStore({ name, consistency: "strong" });
  return {
    async get(k) { const b = await s.get(k, { type: "arrayBuffer" }); return b ? new Uint8Array(b) : null; },
    async set(k, d) { await s.set(k, typeof d === "string" ? d : (d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer)); },
    async delete(k) { await s.delete(k); },
    async list(p = "") { const { blobs } = await s.list({ prefix: p }); return blobs.map((b) => b.key).sort(); },
  };
}

const slugPart = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");

export interface DeployInfo { context?: string; id?: string }
/** This request's deploy context and id, from Netlify's runtime global (see the header); undefined off Netlify. */
export function deployInfo(): DeployInfo | undefined {
  const d = (globalThis as any).Netlify?.context?.deploy;
  return d && typeof d === "object" ? { context: d.context, id: d.id } : undefined;
}

/** The real store name for this deploy: "assets" on production, "assets-<context>-<deploy id>" elsewhere (see the header).
 *  `live` is Netlify's runtime deploy info (wins); `env` is only a fallback for scripts and tests. */
export function storeName(base: StoreName, env: Record<string, string | undefined> = process.env, live: DeployInfo | undefined = deployInfo()): string {
  const ctx = slugPart(live?.context || env.CONTEXT || "");
  if (!ctx || ctx === "production") return base;
  const which = slugPart(live?.id || env.BRANCH || env.HEAD || env.DEPLOY_ID || "") || "unknown";
  return `${base}-${ctx}-${which}`;
}

function backend(real: string): Blobs {
  const d = (process.env.BLOBS_DRIVER || "").toLowerCase();
  if (d === "memory") return memoryStore(real);
  if (d === "file") return fileStore(real);
  try { return netlifyStore(real); } catch { return fileStore(real); }
}

/** The store called `name` for this deploy (see storeName). Outside production: own store for writes and deletes,
 *  with read-only fall-back to the live store (see the header). */
export function blobs(name: StoreName): Blobs {
  const real = storeName(name);
  const own = backend(real);
  if (real === name) return own;
  const liveStore = backend(name);
  return {
    async get(k) { return (await own.get(k)) ?? (await liveStore.get(k)); },
    set: (k, d) => own.set(k, d),
    delete: (k) => own.delete(k),
    async list(p = "") { return [...new Set([...(await own.list(p)), ...(await liveStore.list(p))])].sort(); },
  };
}
