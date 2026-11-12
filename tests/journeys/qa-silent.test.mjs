// tests/journeys/qa-silent.test.mjs: QA runs are always silent.
// What it checks: every script in tools/qa/ that opens a browser gets it from tools/qa/_browser.mjs (launchQuiet), which
//   mutes all sound, and none launches Playwright directly. The owner once heard the wedding music from a test run.
// Who runs it: `npm run qa` (tools/qa/run-all.mjs) first, or by hand: node --test tests/journeys/
// //notes: a plain text check (grep), no browser. Not in `npm test` (that runs tests/*.test.ts only).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/qa");
test("every QA script that opens a browser uses launchQuiet from _browser.mjs", () => {
  for (const f of fs.readdirSync(QA).filter((f) => f.endsWith(".mjs") && f !== "_browser.mjs")) {
    const s = fs.readFileSync(path.join(QA, f), "utf8");
    if (!/playwright|\.launch\(/.test(s)) continue;
    assert.match(s, /from "\.\/_browser\.mjs"/, `${f} does not use tools/qa/_browser.mjs`);
    assert.doesNotMatch(s, /from "playwright"|require\("playwright"\)/, `${f} loads Playwright itself`);
    assert.doesNotMatch(s, /\b(?:engine|webkit|chromium|firefox)\.launch\(/, `${f} launches a browser without launchQuiet`);
  }
});
