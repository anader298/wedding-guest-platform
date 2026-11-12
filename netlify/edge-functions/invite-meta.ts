// =====================================================================================================
// invite-meta.ts: Edge Function on the invite page itself, /<slug>/ and /<slug> (with or without the guest's ?t=code).
//
// What it is for: makes a link pasted into WhatsApp (iMessage, Facebook, ...) preview as THIS wedding: its names,
//   date, place and its own "Link preview picture" from the Design tab. Those apps read the page's <head> lines as
//   they arrive and never run the page's script, and the template's lines say Karim & Maya.
// Who calls it: Netlify, before the normal page (netlify.toml rewrite /:slug/* -> /app/index.html) is sent.
// What it reads: the page as Netlify would send it, and the wedding's PUBLISHED design from GET /<slug>/api/invite.
// What it writes: nothing. It only changes the <head> lines in the copy sent to this one visitor.
//
// What NOT to change and why:
//   - Never redirect and never drop the ?t= code: the guest's link must keep working exactly as before.
//   - If anything is not right (not a wedding, not a page, design not readable, a failure), the page goes out
//     UNCHANGED. onError "bypass" does the same if this file itself crashes. The invite must never break because of a preview.
//   - Keep the page's own headers (Cache-Control no-store, noindex, no-referrer).
//   - The template file site/app/index.html is never edited; this only changes what is sent.
//
//notes:
// - The rewriting itself is in _lib/_meta-rewrite.ts (no imports; unit-tested in tests/meta.test.ts).
// - Helpers live in _lib/ so Netlify does not take them for Edge Functions (same rule as netlify/functions/_lib/).
// - This works because the site serves the invite with a 200 REWRITE to a file of this same site, so the edge sees
//   the HTML. A site served through another site's 200 proxy would not get this.
// - No type imports on purpose (the Node tests and the laptop need nothing extra installed).
// =====================================================================================================
import { inviteSlug, buildMeta, rewriteMeta } from "./_lib/_meta-rewrite.ts";

type Context = { next: () => Promise<Response> };

async function liveDesign(origin: string, slug: string): Promise<any | null> {
  try {
    const r = await fetch(`${origin}/${slug}/api/invite`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d && typeof d === "object" && d.config && typeof d.config === "object" ? d : null;
  } catch { return null; }
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const slug = inviteSlug(url.pathname);
  if (!slug) return;                                    // not an invite page: carry on as if this did not exist
  const designP = liveDesign(url.origin, slug);         // ask for the design while the page is fetched
  const page = await context.next();
  if (page.status !== 200 || !/text\/html/i.test(page.headers.get("content-type") || "")) return page;
  const design = await designP;
  if (!design) return page;
  const html = await page.text();
  const headers = new Headers(page.headers);
  headers.delete("content-length");
  let out = html;
  try { out = rewriteMeta(html, buildMeta(design, url.origin, slug)); }
  catch (e) { console.error("invite-meta: could not rewrite the page, sending it unchanged", e); }
  return new Response(out, { status: page.status, statusText: page.statusText, headers });
};

export const config = {
  path: ["/:slug", "/:slug/"],
  excludedPath: ["/manage", "/manage/*", "/api/*", "/app/*", "/.netlify/*", "/index.html", "/"],
  method: ["GET"],
  onError: "bypass",
};
