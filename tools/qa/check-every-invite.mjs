// CHECK EVERY INVITE
// What it does, in plain words: opens every family's personal invitation for one wedding, the way a guest
// would, on an iPhone and on an Android phone (simulated), and checks that each one shows the right family
// name, the right number of seats, and the right choices in "how many are coming". It also checks that the
// public pages never give out a phone number or an e-mail address.
// It uses PREVIEW mode, so nothing is counted as opened and no answer is saved. It changes nothing.
//
// Usage:   node tools/qa/check-every-invite.mjs <base-url> <slug>
// Example: node tools/qa/check-every-invite.mjs http://localhost:8888 karim-and-maya
//          WEDDING_PASSWORD=secret node tools/qa/check-every-invite.mjs https://yoursite.netlify.app nour-and-ali
// The wedding password is read from WEDDING_PASSWORD (default "wedding"). It is sent only as the
// x-wedding-key header to that wedding's admin API, to get the list of families.
// Needs Playwright (see tools/qa/README.md). Exit code 0 = no problems, 1 = problems found, 2 = could not run.
//notes: (developers) uses &preview=1 links, so opens and answers are never recorded on a real wedding.
import { playwright, launchQuiet } from "./_browser.mjs";   // silent browsers only
const { webkit, chromium, devices } = playwright;

const [base0, slug] = process.argv.slice(2);
if (!base0 || !slug) { console.error("usage: node tools/qa/check-every-invite.mjs <base-url> <slug>"); process.exit(2); }
const base = base0.replace(/\/+$/, "");
const password = process.env.WEDDING_PASSWORD || "wedding";
const w = `${base}/${slug}`;

const res = await fetch(`${w}/api/admin/families`, { headers: { "x-wedding-key": password } });
if (!res.ok) { console.error(`could not read the families (${res.status}). Wrong slug or password?`); process.exit(2); }
const fam = await res.json();
const families = fam.families || [];
console.log(`${slug}: ${families.length} families`);

const problems = [];
const CONTACT_KEYS = ["phone", "email", "wa_link", "mail_link"];

// 1. Public API must never carry contact details.
const inv = await fetch(`${w}/api/invite`);
if (inv.ok) {
  const text = await inv.text();
  if (/"(phone|email)"\s*:/.test(text)) problems.push({ where: "api/invite", problem: "public invite config mentions phone or email" });
} else problems.push({ where: "api/invite", problem: `status ${inv.status}` });
for (const f of families) {
  const g = await fetch(`${w}/api/guest?t=${encodeURIComponent(f.token)}&preview=1`);
  if (!g.ok) { problems.push({ family: f.name, problem: `api/guest status ${g.status}` }); continue; }
  const body = await g.json();
  for (const k of CONTACT_KEYS) if (k in body) problems.push({ family: f.name, problem: `public api/guest returns "${k}"` });
  if (body.name !== f.name || body.max_guests !== f.max_guests) problems.push({ family: f.name, problem: "public api/guest name or seats differ from admin", got: body });
}

// 2. Every invite on two phones.
const runs = [["iPhone 15", webkit], ["Pixel 7", chromium]];
for (const [dev, engine] of runs) {
  const b = await launchQuiet(engine); const ctx = await b.newContext({ ...devices[dev] });
  const errs = [];
  for (const f of families) {
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(f.name + ": " + e.message));
    await p.goto(`${w}/?t=${f.token}&preview=1&open=1#rsvp`, { waitUntil: "networkidle" });
    await p.waitForSelector("#rsvpBox:not([hidden])", { timeout: 15000 }).catch(() => {});
    const r = await p.evaluate(() => ({
      name: document.querySelector("#guestName")?.textContent.trim(),
      seats: document.querySelector("#seatCount")?.textContent.trim() || "",
      opts: [...document.querySelectorAll("#guestCount option")].map((o) => o.value).filter(Boolean),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      html: document.documentElement.outerHTML,
    }));
    const maxOpt = Math.max(...r.opts.map(Number));
    if (r.name !== f.name || !r.seats.includes(String(f.max_guests)) || maxOpt !== f.max_guests || r.overflow)
      problems.push({ dev, family: f.name, want: f.max_guests, got: { name: r.name, seats: r.seats, opts: r.opts, overflow: r.overflow } });
    if (f.phone && r.html.includes(String(f.phone).replace(/^\+/, ""))) problems.push({ dev, family: f.name, problem: "phone number visible on the invite page" });
    if (f.email && r.html.includes(f.email)) problems.push({ dev, family: f.name, problem: "e-mail visible on the invite page" });
    await p.close();
  }
  problems.push(...errs.map((e) => ({ dev, pageerror: e })));
  console.log(dev, "checked", families.length);
  await b.close();
}
console.log("problems:", problems.length); for (const x of problems.slice(0, 20)) console.log(JSON.stringify(x));
process.exit(problems.length ? 1 : 0);
