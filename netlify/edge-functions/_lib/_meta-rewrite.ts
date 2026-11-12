// =====================================================================================================
// _meta-rewrite.ts: writes each wedding's own names, date, place and preview picture into the invite page's
//   <head> lines (title, description, og:*, twitter:*), so a link pasted into WhatsApp shows THAT wedding.
//
// What it is for: WhatsApp, iMessage and Facebook read these lines from the page as it arrives; they never run the
//   page's script. The template (site/app/index.html) carries Karim & Maya's lines, so without this every
//   wedding's link would preview as Karim & Maya.
// Who calls it: netlify/edge-functions/invite-meta.ts (on Netlify), and tests/meta.test.ts (on a laptop).
// What it reads/writes: nothing. Plain text in, plain text out.
//
// What NOT to change and why:
//   - No imports at all (no Node, no Deno): the same file runs at Netlify's edge (Deno) and in the Node tests.
//   - Only the <title> and the description / og:* / twitter:* <meta> lines may change. Every other byte of the
//     template must come out exactly as it went in (the page must look the same).
//   - The wording follows the template's own lines (site/app/index.html) and app.js applyText(). Keep them in step.
//   - Every value is escaped: a couple's name with & < > or " must never break the page.
//
//notes:
// - buildMeta() turns the public design (GET /<slug>/api/invite) into the lines; rewriteMeta() puts them into the HTML.
// - An uploaded preview picture arrives as /.netlify/images?url=/<slug>/asset/<name>&w=1170&fm=webp&q=80. WhatsApp wants a
//   plain JPG about 1200 x 630 and under ~300 KB, so we ask the Image CDN for exactly that (fit=cover, fm=jpg, q=80).
// - A missing og:type / og:title / og:description / og:image / og:image:width / og:image:height / og:url line is added
//   just before </head> (the template has no og:url). A missing <title>, description or twitter:* line stays missing. A page without </head> gets only the rewrites.
// =====================================================================================================

export type Meta = {
  title: string;          // <title>
  description: string;    // <meta name="description">
  ogTitle: string;
  ogDescription: string;
  image: string;          // absolute URL
  url: string;            // canonical page address, without the guest's code
};

const RESERVED = new Set(["manage", "api", "app", "asset", "assets", "admin", "netlify", ".netlify"]);   // = _wedding.ts RESERVED_SLUGS
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;                                              // = _wedding.ts SLUG_RE

/** The wedding address in "/<slug>" or "/<slug>/", or null for anything else (files, reserved words, deeper paths). */
export function inviteSlug(pathname: string): string | null {
  const m = /^\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  const slug = m[1];
  return SLUG_RE.test(slug) && !RESERVED.has(slug) ? slug : null;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The preview picture as an absolute URL WhatsApp can use. */
export function ogImageUrl(og: unknown, origin: string, slug: string): string {
  const v = str(og);
  if (!v) return `${origin}/${slug}/og-envelope.jpg`;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/.netlify/images")) {
    const q = v.indexOf("?");
    const src = q < 0 ? "" : (new URLSearchParams(v.slice(q + 1)).get("url") || "");
    if (src.startsWith("/")) return `${origin}/.netlify/images?url=${src}&w=1200&h=630&fit=cover&fm=jpg&q=80`;
  }
  return origin + (v.startsWith("/") ? v : `/${slug}/${v}`);
}

/** The head lines for this wedding, from its public design. */
export function buildMeta(invite: any, origin: string, slug: string): Meta {
  const cfg = invite && typeof invite === "object" ? invite.config || {} : {};
  const c = cfg.couple || {}, d = cfg.date || {}, v = cfg.venue || {};
  const names = [str(c.groom), str(c.bride)].filter(Boolean).join(" & ") || "Our wedding";
  const city = str(v.city).split(",")[0].trim();
  const place = [str(v.name), city].filter(Boolean).join(", ");
  const when = str(d.en);
  const description = `You are invited to the wedding of ${names}` + [when, place].filter(Boolean).map((p) => `, ${p}`).join("") + ".";
  const ogDescription = [when, place].filter(Boolean).join(" · ") + (when || place ? ". " : "") + "Tap to open your invitation.";
  return {
    title: names,
    description,
    ogTitle: `${names} · You're invited`,
    ogDescription,
    image: ogImageUrl(invite?.assets?.og, origin, slug),
    url: `${origin}/${slug}/`,
  };
}

/** Escapes text for inside a double-quoted attribute (and for <title>). The template's own ' stays as it is. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Which head line a <meta ...> tag is: "description", "og:title", "twitter:image", ... (lower case), or "". */
function metaKey(tag: string): string {
  const m = /\s(?:name|property)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  return m ? (m[1] ?? m[2] ?? "").toLowerCase() : "";
}

/** Puts `value` into the tag's content="..." (adds one if the tag has none). */
function setContent(tag: string, value: string): string {
  const re = /(\scontent\s*=\s*)(?:"[^"]*"|'[^']*')/i;
  if (re.test(tag)) return tag.replace(re, (_m, pre) => `${pre}"${esc(value)}"`);
  return tag.replace(/\s*\/?>$/, (end) => ` content="${esc(value)}"${end}`);
}

/** The HTML with this wedding's head lines. Everything else is returned byte for byte. */
export function rewriteMeta(html: string, meta: Meta): string {
  const values: Record<string, string> = {
    "description": meta.description,
    "og:type": "website",
    "og:title": meta.ogTitle,
    "og:description": meta.ogDescription,
    "og:image": meta.image,
    "og:image:secure_url": meta.image,
    "og:image:url": meta.image,
    "og:image:width": "1200",
    "og:image:height": "630",
    "og:url": meta.url,
    "twitter:title": meta.ogTitle,
    "twitter:description": meta.ogDescription,
    "twitter:image": meta.image,
    "twitter:card": "summary_large_image",
  };
  // Only the <head> is touched, so the visible page can never change.
  const headEnd = html.search(/<\/head\s*>/i);
  const headPart = headEnd < 0 ? html : html.slice(0, headEnd);
  const rest = headEnd < 0 ? "" : html.slice(headEnd);
  const seen = new Set<string>();
  let head = headPart.replace(/<title(\s[^>]*)?>[\s\S]*?<\/title\s*>/i, (_m, attrs) => `<title${attrs || ""}>${esc(meta.title)}</title>`);
  head = head.replace(/<meta\s[^>]*>/gi, (tag) => {
    const key = metaKey(tag);
    if (!(key in values)) return tag;
    seen.add(key);
    return setContent(tag, values[key]);
  });
  if (headEnd < 0) return head;
  const add = ["og:type", "og:title", "og:description", "og:image", "og:image:width", "og:image:height", "og:url"].filter((k) => !seen.has(k))
    .map((k) => `<meta property="${k}" content="${esc(values[k])}">\n`).join("");
  return head + add + rest;
}
