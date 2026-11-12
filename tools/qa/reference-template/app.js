/* Karim & Maya wedding invitation (draft).
 * ALL event text lives in CONFIG below. Edit here, not in index.html. */
const CONFIG = {
  couple: {
    groom: "Karim",
    bride: "Maya",
    monogram: "K & M",          // shown in footer; seal uses the first letters of groom/bride
    ar: "كريم و مايا",
  },
  date: {
    // Countdown target, Beirut time (EEST, UTC+3 in June). Change the time here if needed.
    iso: "2027-06-19T18:30:00+03:00",   // 6:30 pm Beirut
    en: "Saturday 19 June 2027",
    ar: "السبت ١٩ حزيران ٢٠٢٧",
    short: "19 · 6 · 2027",
    timeEn: "6:30 PM",
    timeAr: "٦:٣٠ مساءً",
  },
  families: {
    en: { father1: "Eng. Samir Mansour", father2: "Mr. Fadi Nassar" },
    ar: { father1: "المهندس سمير منصور", father2: "السيد فادي نصار" },
  },
  venue: {
    name: "Olive Grove Hall",
    city: "Batroun, Lebanon",
    ar: "البترون، لبنان",
    mapsQuery: "Olive Grove Hall Batroun Lebanon",
  },
  rsvp: {
    replyByEn: "Please reply before May 15",
    replyByAr: "الرجاء التأكيد قبل ١٥ أيار",
    // polite adults-only note, shown under the "Reserved for" card
    kidsNoteAr: "نومًا هنيئًا لأطفالكم، وسهرة سعيدة لكم",
    kidsNoteEn: "Sweet dreams to your little ones, and a lovely evening to you.",
  },
  gift: {
    provider: "Sample Pay",
    accountNumber: "12 345 678",   // shown with spaces; "Tap to copy" copies the digits only
  },
  // Background music, starts when the guest taps the envelope.
  // music.m4a: a short synthetic placeholder tone in this repository. Each wedding uploads its own song
  // on the Design tab; loop: true restarts it without a cut.
  music: { src: "music.m4a", startAt: 0, loop: true, volume: 0.6, enabled: true },
  // Used with ?demo=1, or when the API is unreachable on file:// or localhost.
  demoGuest: { name: "The Aziz Family", max_guests: 4, response: null },
};

(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), CONFIG);

  /* ---------- 1. Fill text from CONFIG ---------- */
  document.querySelectorAll("[data-c]").forEach((el) => {
    const v = get(el.dataset.c);
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll(".seal .m1").forEach((el) => (el.textContent = CONFIG.couple.groom.charAt(0)));
  document.querySelectorAll(".seal .m2").forEach((el) => (el.textContent = CONFIG.couple.bride.charAt(0)));
  document.title = `${CONFIG.couple.groom} & ${CONFIG.couple.bride}`;
  $("mapsLink").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(CONFIG.venue.mapsQuery);
  $("acctNum").textContent = CONFIG.gift.accountNumber;

  // Names on page 2, split into letters for the reveal flourish.
  const names = $("names");
  names.setAttribute("aria-label", `${CONFIG.couple.groom} & ${CONFIG.couple.bride}`);
  let offset = 0;
  names.querySelectorAll("[data-split]").forEach((line, li) => {
    const word = get(line.dataset.split) || "";
    line.setAttribute("aria-hidden", "true");
    [...word].forEach((ch, i) => {
      const s = document.createElement("span");
      s.className = "ch";
      s.textContent = ch;
      s.style.setProperty("--i", i);
      s.style.setProperty("--base", `${offset}ms`);
      line.append(s);
    });
    offset = li === 0 ? 900 : offset; // bride's name starts after the ampersand
  });
  names.querySelector(".amp").setAttribute("aria-hidden", "true");

  /* ---------- 2. Envelope ---------- */
  const env = $("envelope");
  const seal = $("seal");
  let opened = false;

  const unlock = () => root.classList.remove("locked");
  const openEnvelope = ({ instant = false } = {}) => {
    if (opened) return;
    opened = true;
    if (instant || reduceMotion) env.classList.add("instant");
    env.classList.add("is-open");
    seal.setAttribute("aria-expanded", "true");
    seal.tabIndex = -1;
    if (instant) { unlock(); return; }
    const wait = reduceMotion ? 50 : 2300;
    setTimeout(() => {
      unlock();
      $("welcome").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }, wait);
  };
  seal.addEventListener("click", () => openEnvelope());

  // ?open=1 or a #section hash skips straight to the opened state.
  const hashTarget = location.hash && document.querySelector(location.hash);
  if (q.get("open") === "1" || (hashTarget && hashTarget !== env)) {
    openEnvelope({ instant: true });
    if (hashTarget) {
      const jump = () => hashTarget.scrollIntoView({ behavior: "instant", block: "start" });
      requestAnimationFrame(jump);
      if (document.fonts) document.fonts.ready.then(jump);
    }
  } else {
    // Make sure we start at the top while locked (mobile browsers restore scroll).
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
  }

  /* ---------- 3. Reveal on scroll ---------- */
  const revealEls = document.querySelectorAll(".reveal, #names, .flourish");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    revealEls.forEach((el) => io.observe(el));
    // Safety net: if an observer callback is missed (fast jumps, elements un-hidden later), reveal on scroll.
    let pending = false;
    const sweep = () => {
      pending = false;
      const vh = window.innerHeight;
      revealEls.forEach((el) => {
        if (el.classList.contains("in")) return;
        const r = el.getBoundingClientRect();
        if (r.height && r.top < vh * 0.92 && r.bottom > 0) { el.classList.add("in"); io.unobserve(el); }
      });
    };
    const queue = () => { if (!pending) { pending = true; requestAnimationFrame(sweep); } };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    window.__revealSweep = queue;
  }

  /* ---------- 4. Countdown ---------- */
  const target = new Date(CONFIG.date.iso).getTime();
  const pad = (n) => String(n).padStart(2, "0");
  const tick = () => {
    let diff = Math.max(0, target - Date.now());
    const d = Math.floor(diff / 86400000); diff -= d * 86400000;
    const h = Math.floor(diff / 3600000); diff -= h * 3600000;
    const m = Math.floor(diff / 60000); diff -= m * 60000;
    const s = Math.floor(diff / 1000);
    $("cd-d").textContent = pad(d);
    $("cd-h").textContent = pad(h);
    $("cd-m").textContent = pad(m);
    $("cd-s").textContent = pad(s);
    if (target - Date.now() <= 0) { $("cdDone").hidden = false; return false; }
    return true;
  };
  if (tick()) { const iv = setInterval(() => { if (!tick()) clearInterval(iv); }, 1000); }

  /* ---------- 5. Gift: copy account number ---------- */
  $("copyBtn").addEventListener("click", async () => {
    const text = CONFIG.gift.accountNumber.replace(/\s+/g, "");
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.append(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
      ta.remove();
    }
    $("copyLabel").textContent = ok ? "Copied" : "Copy failed";
    $("copyLabelAr").textContent = ok ? "تم النسخ" : "تعذّر النسخ";
    setTimeout(() => { $("copyLabel").textContent = "Tap to copy"; $("copyLabelAr").textContent = "انسخ الرقم"; }, 2200);
  });

  /* ---------- 6. RSVP (see wedding/CONTRACT.md) ---------- */
  const t = q.get("t");
  const isLocal = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  let demo = q.get("demo") === "1";

  const showNoLink = () => { $("rsvpLoading").hidden = true; $("rsvpNoLink").hidden = false; $("rsvpNoLink").classList.add("in"); };

  const loadGuest = async () => {
    if (demo) return structuredClone(CONFIG.demoGuest);
    if (!t) return null;
    try {
      const r = await fetch(`/wedding/api/guest?t=${encodeURIComponent(t)}${preview ? "&preview=1" : ""}`, { headers: { accept: "application/json" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (err) {
      if (isLocal) { demo = true; return structuredClone(CONFIG.demoGuest); }
      return null;
    }
  };

  const fmtAt = (iso) => {
    try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }); }
    catch (_) { return ""; }
  };

  const initRsvp = (g) => {
    if (!g) return showNoLink();
    $("rsvpLoading").hidden = true;
    $("rsvpBox").hidden = false;
    $("guestName").textContent = g.name;
    $("seatCount").textContent = g.max_guests;

    const sel = $("guestCount");
    const namesBox = $("nameFields");
    for (let i = 1; i <= g.max_guests; i++) sel.append(new Option(String(i), String(i)));
    sel.value = String(g.max_guests);

    const paintNames = (vals) => {
      const keep = [...namesBox.querySelectorAll("input")].map((i) => i.value);
      namesBox.innerHTML = "";
      for (let i = 0; i < Number(sel.value); i++) {
        const id = `gname${i}`;
        const lab = document.createElement("label");
        lab.htmlFor = id;
        const arN = String(i + 1).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
        lab.textContent = `Full name of guest ${i + 1}`;
        const inp = document.createElement("input");
        inp.type = "text"; inp.id = id; inp.maxLength = 80; inp.autocomplete = i === 0 ? "name" : "off";
        inp.placeholder = `Full name of guest ${i + 1} / الاسم الكامل للضيف ${arN}`;
        inp.required = true; // names are required when accepting
        inp.addEventListener("input", () => inp.classList.remove("missing"));
        inp.value = (vals && vals[i]) ?? keep[i] ?? "";
        namesBox.append(lab, inp);
      }
    };
    sel.addEventListener("change", () => paintNames());

    let attending = null;
    const paint = () => {
      $("btnYes").setAttribute("aria-pressed", String(attending === true));
      $("btnNo").setAttribute("aria-pressed", String(attending === false));
      $("partyBox").hidden = attending !== true;
    };
    $("btnYes").addEventListener("click", () => {
      attending = true; $("formErr").hidden = true; paint();
      // bring the name fields that just appeared into view
      $("partyBox").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    });
    // Required names: highlight the empty fields and point at the first one.
    const NAMES_MSG = "Please write the name of everyone coming · الرجاء كتابة أسماء جميع الحضور";
    const flagMissingNames = () => {
      const empty = [...namesBox.querySelectorAll("input")].filter((i) => !i.value.trim());
      empty.forEach((i) => i.classList.add("missing"));
      $("namesErr").textContent = NAMES_MSG; // shown right above the name fields
      $("namesErr").hidden = false;
      const first = empty[0] || namesBox.querySelector("input");
      if (first) {
        first.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        first.focus({ preventScroll: true });
      }
    };
    $("btnNo").addEventListener("click", () => { attending = false; $("formErr").hidden = true; paint(); });

    if (g.response) {
      attending = g.response.attending;
      if (g.response.guests) sel.value = String(Math.min(g.response.guests, g.max_guests));
      $("note").value = g.response.note || "";
      const pn = $("prevNote");
      pn.textContent = `You replied on ${fmtAt(g.response.at)}. Sending again will replace that reply. · تم استلام ردّكم سابقاً، والإرسال مجدداً يستبدله.`;
      pn.hidden = false;
    }
    paintNames(g.response?.guest_names || []);
    paint();
    if (window.__revealSweep) window.__revealSweep();

    const showConfirm = (resp) => {
      const box = $("confirm");
      const n = resp.guests;
      box.innerHTML = "";
      const add = (tag, cls, text, rtl) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (rtl) { el.dir = "rtl"; el.lang = "ar"; }
        el.textContent = text; box.append(el); return el;
      };
      if (resp.attending) {
        add("p", "c-title", "Thank you!");
        add("p", "", `We can't wait to celebrate with you. We have you down for ${n} ${n === 1 ? "guest" : "guests"}.`);
        add("p", "", `شكراً لكم! بانتظاركم لنحتفل معاً. عدد الحضور: ${n}`, true);
      } else {
        add("p", "c-title", "Thank you for letting us know");
        add("p", "", "You will be missed, and you are in our hearts on the day.");
        add("p", "", "شكراً لإعلامنا، سنفتقدكم وستكونون في قلوبنا.", true);
      }
      const names = (resp.guest_names || []).filter(Boolean);
      if (names.length) add("p", "c-meta", names.join(" · "));
      add("p", "c-meta", "You can reopen your link any time to change your answer; a new reply replaces this one.");
      if (demo) add("span", "c-demo", "Preview mode: nothing was sent");
      const again = document.createElement("button");
      again.type = "button"; again.className = "btn-outline small";
      again.innerHTML = '<span>Change my reply</span><span dir="rtl" lang="ar">تعديل الرد</span>';
      again.addEventListener("click", () => { box.hidden = true; $("rsvpForm").hidden = false; });
      box.append(again);
      box.hidden = false;
      $("rsvpForm").hidden = true;
      $("prevNote").hidden = true;
      box.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    };

    $("rsvpForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("formErr");
      if (attending === null) {
        err.textContent = "Please choose whether you will join us. · الرجاء اختيار الحضور أو الاعتذار.";
        err.hidden = false; return;
      }
      if (attending && [...namesBox.querySelectorAll("input")].some((i) => !i.value.trim())) return flagMissingNames();
      err.hidden = true;
      $("namesErr").hidden = true;
      const guests = attending ? Number(sel.value) : 0;
      const guest_names = attending ? [...namesBox.querySelectorAll("input")].map((i) => i.value) : [];
      const note = $("note").value.slice(0, 500);
      const btn = $("sendBtn");
      btn.disabled = true;

      if (demo) {
        const clean = guest_names.map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, guests);
        setTimeout(() => { btn.disabled = false; showConfirm({ attending, guests, guest_names: clean, note, at: new Date().toISOString() }); }, 400);
        return;
      }
      try {
        const res = await fetch("/wedding/api/rsvp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ t, attending, guests, guest_names, note }),
        });
        if (res.status === 400) {
          const body = await res.json().catch(() => ({}));
          if (body && body.code === "names_required") { flagMissingNames(); return; }
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        const out = await res.json();
        showConfirm(out.response);
      } catch (_) {
        err.textContent = "Something went wrong. Please try again. · حدث خطأ، الرجاء المحاولة مجدداً.";
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  };

  /* ---------- 7. Preview mode (?preview=1, opened from the admin page) ----------
   * Real name and seats; the open is not counted, and the RSVP is never posted
   * (setting demo after the fetch reuses the "Preview mode: nothing was sent" path). */
  const preview = q.get("preview") === "1";
  if (preview) {
    const bar = document.createElement("div");
    bar.textContent = "Preview \u2014 this is what the family will see. Nothing is saved.";
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#4a3f2f;color:#fff;font:600 14px/1.3 -apple-system,Helvetica,Arial,sans-serif;text-align:center;padding:8px 12px;padding-top:max(8px,env(safe-area-inset-top));pointer-events:none;";
    document.body.append(bar);
  }

  loadGuest().then((g) => { if (preview && g) demo = true; initRsvp(g); });

  /* ---------- 8. Background music (CONFIG.music) ----------
   * A plain <audio> element (not Web Audio): on iPhone it then plays through the media channel,
   * so guests with the ring/silent switch on still hear it. Starts inside the envelope tap
   * (a user gesture, so iOS/Android allow sound), same level throughout, no fades.
   * audio.volume is honoured on Android/desktop; iPhone plays at the phone's media volume.
   * Nothing is downloaded before the tap. Never auto-plays in ?preview=1. */
  const M = CONFIG.music || {};
  if (M.enabled && M.src) {
    const KEY = "wedding-music";                 // sessionStorage: "on" | "off"
    const audio = new Audio();
    audio.preload = "none";
    audio.loop = !!M.loop;
    audio.volume = M.volume ?? 0.6;
    audio.setAttribute("playsinline", "");
    audio.id = "bgMusic";
    document.body.append(audio);
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (_) {}   // iOS 17+

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "music-btn";
    btn.hidden = true;
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"/>' +
      '<path class="on" d="M14.5 9.2a4 4 0 0 1 0 5.6M16.8 7a7 7 0 0 1 0 10"/>' +
      '<path class="off" d="M15 9.5l5 5M20 9.5l-5 5"/></svg>';
    document.body.append(btn);

    let playing = false, wanted = false, resumeOnShow = false;
    const paint = () => {
      btn.classList.toggle("is-on", playing);
      btn.setAttribute("aria-pressed", String(playing));
      btn.setAttribute("aria-label", playing ? "Mute music \u00b7 إيقاف الموسيقى" : "Play music \u00b7 تشغيل الموسيقى");
    };
    const start = () => {
      if (!audio.src) audio.src = M.src + (M.startAt ? `#t=${M.startAt}` : "");
      const p = audio.play();
      const ok = () => { playing = true; paint(); };
      const fail = () => { playing = false; wanted = false; paint(); };
      if (p && p.then) p.then(ok, fail); else ok();
    };
    const stop = () => { playing = false; paint(); audio.pause(); };

    // first start: the envelope tap (skipped in preview, or if the guest muted earlier this session)
    $("seal").addEventListener("click", () => {
      btn.hidden = false;
      if (preview || sessionStorage.getItem(KEY) === "off") { paint(); return; }
      wanted = true;
      start();
    });
    if ($("envelope").classList.contains("is-open")) btn.hidden = false;   // ?open=1 / #hash: no gesture, button off
    paint();

    btn.addEventListener("click", () => {
      if (playing) { wanted = false; sessionStorage.setItem(KEY, "off"); stop(); }
      else { wanted = true; sessionStorage.setItem(KEY, "on"); start(); }
    });

    // pause while the tab is hidden, resume when back
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        resumeOnShow = playing;
        if (playing) { audio.pause(); playing = false; paint(); }
      } else if (resumeOnShow && wanted) {
        resumeOnShow = false;
        start();
      }
    });

    audio.addEventListener("ended", () => { playing = false; wanted = false; paint(); });

    // step out of the way when a button scrolls under it
    if ("IntersectionObserver" in window) {
      const under = new Set();
      const dodge = new IntersectionObserver((entries) => {
        entries.forEach((en) => (en.isIntersecting ? under.add(en.target) : under.delete(en.target)));
        btn.classList.toggle("dodge", under.size > 0);
      }, { rootMargin: "-82% 0px 0px 0px" });
      document.querySelectorAll("#btnYes, #btnNo, #sendBtn, #copyBtn, #mapsLink, #nameFields, #note, #guestCount, .confirm")
        .forEach((el) => dodge.observe(el));
    }
    window.__music = { audio, level: () => audio.volume, get playing() { return playing; } };   // for tests
  }
})();
