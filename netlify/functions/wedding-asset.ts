// =====================================================================================================
// wedding-asset.ts: GET /<slug>/asset/<name>   (public)
//
// What it is for: serves a picture, song or video a wedding uploaded on the Design tab.
// Who calls it: the invite page (directly for audio/video, through /.netlify/images for pictures).
// What it reads: the assets table (to know the file exists and its type) and Blobs store "assets",
//   key <slug>/<name>. What it writes: nothing.
//
// What NOT to change and why:
//   - The long "immutable" cache is safe ONLY because every upload gets a new name with a random suffix.
//     If you ever let an upload keep the same name, drop the cache time or guests will see the old file.
//   - Range requests (206) are needed: iPhones refuse to play audio/video from servers without them.
//
//notes:
// - Files are at most 4 MB, so reading the whole file into memory is fine.
// =====================================================================================================
import type { Config } from "@netlify/functions";
import { one } from "./_lib/_db.ts";
import { json, errorReply, slugFromPath, getWedding, safeDecode } from "./_lib/_wedding.ts";
import { blobs } from "./_lib/_blobs.ts";
import { ASSET_NAME_RE } from "./_lib/_invite.ts";

const notFound = () => json({ error: "This file does not exist.", code: "not_found" }, 404);

export default async (req: Request) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return notFound();
    const slug = slugFromPath(req);
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const name = safeDecode(parts.slice(2).join("/"));
    if (parts[1] !== "asset" || !ASSET_NAME_RE.test(name)) return notFound();
    const w = await getWedding(slug);
    if (!w) return notFound();
    const row = await one<{ content_type: string; blob_key: string }>("select content_type, blob_key from assets where wedding_id = $1 and name = $2", [w.id, name]);
    if (!row) return notFound();
    const data = await blobs("assets").get(row.blob_key);
    if (!data) return notFound();
    const headers: Record<string, string> = {
      "content-type": row.content_type, "cache-control": "public, max-age=31536000, immutable",
      "netlify-cdn-cache-control": "public, max-age=31536000, immutable", "accept-ranges": "bytes", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
    };
    const size = data.byteLength;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
      const part = data.subarray(start, end + 1);
      return new Response(req.method === "HEAD" ? null : (part as any), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(part.byteLength) } });
    }
    return new Response(req.method === "HEAD" ? null : (data as any), { status: 200, headers: { ...headers, "content-length": String(size) } });
  } catch (e) { return errorReply(e); }
};

export const config: Config = { path: "/:slug/asset/*" };
