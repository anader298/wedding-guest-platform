// tools/sample-guests.mjs: fills the local demo wedding (karim-and-maya) with an invented guest list.
// What it is for: the README screenshots. 16 families on both sides, four helpers (Rami, Lara, Nadia, Tarek) sending
//   invites and reminders, opens and answers, so the admin page and the owner page have something to show.
// Run: start a local site (`node tools/qa/run-all.mjs --serve`), then `node tools/sample-guests.mjs <base-url>`.
// Every name here is invented. It removes the seed's three placeholder families first. Local sites only.
const B = process.argv[2] || "http://localhost:8888", SLUG = "karim-and-maya", PW = "wedding";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B)) { console.error("Local sites only: http://localhost:<port> or http://127.0.0.1:<port>"); process.exit(2); }
async function helper(name) {
  const r = await fetch(`${B}/${SLUG}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, password: PW }) });
  if (!r.ok) throw new Error("login " + r.status + (await r.text()));
  const cookie = r.headers.get("set-cookie").split(";")[0];
  return async (method, action, body) => {
    const res = await fetch(`${B}/${SLUG}/api/admin/${action}`, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(`${action} ${res.status} ${JSON.stringify(j)}`); return j;
  };
}
const H = { rami: await helper("Rami"), lara: await helper("Lara"), nadia: await helper("Nadia"), tarek: await helper("Tarek") };
// remove the seed's three placeholder families so the list reads like a real one
const start = await H.rami("GET", "families");
for (const f of start.families) await H.rami("DELETE", "family", { token: f.token, force: true }).catch(() => {});
const FAM = [
  ["The Aziz Family", "a", 4, "rami"], ["The Mansour Family", "a", 5, "rami"], ["Uncle Samir & Hiba", "a", 2, "tarek"], ["The Khalil Family", "a", 3, "tarek"],
  ["The Daher Family", "a", 6, "rami"], ["Ziad & Carla", "a", 2, "tarek"], ["The Hayek Family", "a", 4, "rami"], ["Teta Salwa", "a", 1, "tarek"],
  ["The Nassar Family", "b", 5, "lara"], ["The Rizk Family", "b", 3, "nadia"], ["Aunt Mireille", "b", 2, "lara"], ["The Frem Family", "b", 4, "nadia"],
  ["Joe & Rita Saliba", "b", 2, "lara"], ["The Najjar Family", "b", 6, "nadia"], ["The Tannous Family", "b", 3, "lara"], ["Karl & Yasmina", "b", 2, "nadia"],
];
const fam = {};
for (const [name, side, n, by] of FAM) fam[name] = (await H[by]("POST", "family", { name, side, max_guests: n })).family;
const send = (by, name, channel = "copy", kind = "invite") => H[by]("POST", "mark-sent", { token: fam[name].token, kind, channel });
for (const [name, , , by] of FAM.slice(0, 14)) await send(by, name, ["The Mansour Family", "The Rizk Family", "Joe & Rita Saliba"].includes(name) ? "whatsapp" : "copy");
const open = (name) => fetch(`${B}/${SLUG}/api/guest?t=${fam[name].token}`);
for (const n of ["The Aziz Family", "The Mansour Family", "Uncle Samir & Hiba", "The Khalil Family", "The Daher Family", "The Nassar Family", "The Rizk Family", "Aunt Mireille", "The Frem Family", "Joe & Rita Saliba", "Teta Salwa"]) await open(n);
const rsvp = (name, attending, guest_names, note = "") => fetch(`${B}/${SLUG}/api/rsvp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: fam[name].token, attending, guests: guest_names.length, guest_names, note }) });
await rsvp("The Aziz Family", true, ["Fouad Aziz", "Leila Aziz", "Jad Aziz", "Maria Aziz"], "Counting the days!");
await rsvp("The Mansour Family", true, ["Elie Mansour", "Nada Mansour", "Chris Mansour"]);
await rsvp("Uncle Samir & Hiba", true, ["Samir", "Hiba"]);
await rsvp("The Nassar Family", true, ["Fadi Nassar", "Rania Nassar", "Lea Nassar", "Marc Nassar", "Sara Nassar"]);
await rsvp("Aunt Mireille", false, [], "So sorry to miss it, we will be abroad.");
await rsvp("The Frem Family", true, ["Tony Frem", "Dalia Frem"]);
await rsvp("Teta Salwa", true, ["Salwa"]);
await send("tarek", "The Khalil Family", "copy", "reminder");
await send("nadia", "The Najjar Family", "whatsapp", "reminder");
console.log("filled", Object.keys(fam).length, "families");
console.log("guest link", `${B}/${SLUG}/?t=${fam["The Aziz Family"].token}`);
