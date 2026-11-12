// COMPARE THE INVITE WITH THE ORIGINAL TEMPLATE
// What it does, in plain words: takes pictures of two copies of the invitation (the "reference" and the
// "candidate") on a simulated iPhone and Android phone, page by page, with the clock frozen and animations
// off, and says which pictures are not identical. Used at handover to prove that the seeded
// karim-and-maya wedding, served by the new server, looks exactly like the Karim & Maya original.
// It changes nothing (demo mode, no family, nothing saved).
//
// Usage:   node tools/qa/compare-template.mjs <reference-url> <candidate-url>
// Example: node tools/qa/compare-template.mjs "file://$PWD/site/app/index.html" http://localhost:8888/karim-and-maya/
// (?demo=1 is added for you.) Opened as a file, the invite cannot reach the server and runs on its built-in
// settings, which ARE the Karim & Maya original. Pictures go to the folder printed at the end.
// Needs Playwright (see tools/qa/README.md). Exit code 0 = identical, 1 = differences.
//notes: (developers) the clock is frozen and animations disabled so the countdown matches pixel for pixel.
import { playwright, launchQuiet } from "./_browser.mjs";   // silent browsers only
const { webkit, chromium, devices } = playwright;
import os from "node:os"; import path from "node:path"; import fs from "node:fs";

const [ref, cand] = process.argv.slice(2);
if (!ref || !cand) { console.error("usage: node tools/qa/compare-template.mjs <reference-url> <candidate-url>"); process.exit(2); }
const out = path.join(os.tmpdir(), "twp-qa", "compare"); fs.mkdirSync(out, { recursive: true });
const withQ = (u, extra) => u + (u.includes("?") ? "&" : "?") + "demo=1" + extra;
const states = [["envelope-closed", "", null], ["welcome", "&open=1", "#welcome"], ["families", "&open=1", "#families"],
  ["countdown", "&open=1", "#countdown"], ["gift", "&open=1", "#gift"], ["rsvp", "&open=1", "#rsvp"]];
const FIXED = new Date("2026-11-20T10:00:00+02:00");
const diffs = [];
let served = 0; // how many candidate loads got the wedding's design from the server (else the test proves nothing)
for (const [dev, engine] of [["iPhone 15", webkit], ["Pixel 7", chromium]]) {
  const b = await launchQuiet(engine);
  const snap = async (url, hash, isCand) => {
    const ctx = await b.newContext({ ...devices[dev], reducedMotion: "reduce" });
    const p = await ctx.newPage(); await p.clock.install({ time: FIXED });
    if (isCand) p.on("response", (r) => { if (/\/api\/invite(\?|$)/.test(r.url()) && r.status() === 200) served++; });
    await p.goto(url + (hash || ""), { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts && document.fonts.ready); await p.waitForTimeout(1200);
    if (hash) await p.evaluate((h) => document.querySelector(h)?.scrollIntoView(), hash);
    await p.waitForTimeout(600);
    const buf = await p.screenshot(); await ctx.close(); return buf;
  };
  for (const [name, extra, hash] of states) {
    const a = await snap(withQ(ref, extra), hash, false), c = await snap(withQ(cand, extra), hash, true);
    const tag = `${dev.replace(/\s+/g, "")}-${name}`;
    fs.writeFileSync(path.join(out, `${tag}-reference.png`), a); fs.writeFileSync(path.join(out, `${tag}-candidate.png`), c);
    const same = Buffer.compare(a, c) === 0;
    console.log(same ? "same     " : "DIFFERENT", tag);
    if (!same) diffs.push(tag);
  }
  await b.close();
}
const total = states.length * 2;
console.log({ differences: diffs.length, candidateUsedServerDesign: `${served}/${total}`, pictures: out });
if (served < total) console.log("WARNING: the candidate did not always get its design from the server, so 'same' may only mean both used the built-in settings.");
process.exit(diffs.length || served < total ? 1 : 0);
