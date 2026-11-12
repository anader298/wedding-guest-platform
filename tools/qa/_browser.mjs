// WEDDING GUEST PLATFORM: SILENT TEST BROWSERS (tools/qa/_browser.mjs)
// What it is:  the one place every QA script gets its browsers from, so a test run NEVER plays the wedding music (or any
//              sound) out loud on the computer it runs on.
// Who uses it: every script in tools/qa/ that opens a browser (journeys, pages-smoke, check-every-invite, admin-smoke,
//              compare-template, manage-smoke). tests/journeys/qa-silent.test.mjs checks that none of them launches a browser any
//              other way.
// How:         launchQuiet(engine, options) = engine.launch() with Chromium's --mute-audio, and with browser.newContext
//              replaced so EVERY context it makes gets the mute script below (quietContext does the same for one context).
//              The mute script (WebKit has no mute switch): every <audio>/<video> is muted when it plays or is created and
//              cannot be unmuted; Web Audio contexts stay suspended (silent).
// Must not change, and why: the owner heard the music from a test run. Keep every launch going through here.
// //notes: the element's volume is left as the page sets it, so tests can still check the music through the template's
//          window.__music hook ({ playing, level() }) without any sound: muted=true is what keeps the speakers quiet.
//          playwright is found like the scripts find it (NODE_PATH, else the repo's node_modules).
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(process.env.NODE_PATH ? path.join(process.env.NODE_PATH, "x.js") : import.meta.url);
export const playwright = require("playwright");

// Runs in every page and frame before the page's own scripts.
export const MUTE_SCRIPT = `(() => {
  const P = window.HTMLMediaElement && HTMLMediaElement.prototype; if (!P || P.__twpQuiet) return;
  P.__twpQuiet = true;
  const d = Object.getOwnPropertyDescriptor(P, "muted");
  if (d && d.set) Object.defineProperty(P, "muted", { configurable: true, get() { return d.get.call(this); }, set() { d.set.call(this, true); } });
  const hush = (el) => { try { d && d.set ? d.set.call(el, true) : (el.muted = true); } catch (e) {} };
  const play = P.play;
  P.play = function () { hush(this); return play.apply(this, arguments); };
  document.addEventListener("play", (e) => { if (e.target instanceof HTMLMediaElement) hush(e.target); }, true);
  if (window.Audio) { const A = window.Audio; window.Audio = function (src) { const a = new A(src); hush(a); return a; }; window.Audio.prototype = A.prototype; }
  for (const k of ["AudioContext", "webkitAudioContext"]) {
    const C = window[k]; if (!C) continue;
    window[k] = class extends C { constructor(...a) { super(...a); try { super.suspend(); } catch (e) {} } resume() { return Promise.resolve(); } };
  }
})();`;

export async function quietContext(browser, options = {}) {
  const ctx = await (browser.__twpNewContext || browser.newContext.bind(browser))(options);
  await ctx.addInitScript(MUTE_SCRIPT);
  return ctx;
}

export async function launchQuiet(engine, options = {}) {
  const isChromium = engine.name() === "chromium";
  const browser = await engine.launch({ ...options, args: [...(options.args || []), ...(isChromium ? ["--mute-audio"] : [])] });
  browser.__twpNewContext = browser.newContext.bind(browser);
  browser.newContext = (opts) => quietContext(browser, opts);
  return browser;
}
