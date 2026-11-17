// Gut Log. One capture point, no required fields, the app does the sorting.

const BASE_SYMPTOMS = [
  { k: "bloating", name: "Bloating", lo: "none", hi: "a lot" },
  { k: "reflux", name: "Acid reflux", lo: "none", hi: "bad" },
  { k: "heartburn", name: "Heartburn", lo: "none", hi: "bad" },
  { k: "cramps", name: "Stomach cramps", lo: "none", hi: "bad" },
  { k: "constipation", name: "Constipation", lo: "none", hi: "bad" },
  { k: "throat", name: "Throat / swallowing", lo: "fine", hi: "hard" },
  { k: "energy", name: "Energy", lo: "drained", hi: "great", goodHigh: true },
  { k: "fog", name: "Brain fog", lo: "clear", hi: "foggy" },
];
// Symptoms you add yourself are saved on the phone and work like the rest.
let customSymptoms = [];
let SYMPTOMS = BASE_SYMPTOMS;
function setCustom(list) {
  customSymptoms = Array.isArray(list) ? list.filter(c => c && c.k && c.name) : [];
  SYMPTOMS = [...BASE_SYMPTOMS, ...customSymptoms.map(c => ({ k: c.k, name: c.name, lo: "none", hi: "bad", custom: true }))];
}
const FLAGS = [
  { k: "coffee", name: "Coffee", phrase: "coffee" },
  { k: "dairy", name: "Dairy", phrase: "dairy" },
  { k: "sleep", name: "Bad sleep", phrase: "bad sleep" },
  { k: "stress", name: "Stressed", phrase: "stress" },
  { k: "period", name: "Period", phrase: "your period" },
];
const HOUR = 3600e3;
const CHECKIN_AFTER = 2 * HOUR;        // prompt shows up 2 hours after a food log
const CHECKIN_EXPIRES = 12 * HOUR;     // after this it quietly goes away, no nagging
const PATTERN_DAYS = 30;
const MIN_DAYS = 3;                    // need at least this many days with AND without
const MIN_DIFF = 0.8;                  // on the 0 to 5 scale
const MAX_CHIPS = 16;

const state = { view: "home", entries: [], draft: null, ci: null, urls: [] };
const $app = document.getElementById("app");

// ---------- helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
const fmtDay = ts => new Date(ts).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const r1 = n => (Math.round(n * 10) / 10).toFixed(1);
const joinAnd = a => a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

// Turn "rice, chicken and spinach" into ["rice","chicken","spinach"].
// Longer sentences ("felt tired after lunch") are left as a note only.
function parseFoods(note) {
  const pieces = String(note || "").split(/[,;\n+&]|\band\b|\bwith\b|\bw\//i);
  const foods = [];
  let leftover = false;
  for (let p of pieces) {
    p = p.trim().toLowerCase().replace(/^[\s.\-–!?:]+|[\s.\-–!?:]+$/g, "");
    if (!p) continue;
    const words = p.split(/\s+/).length;
    if (/[a-z]/.test(p) && p.length <= 30 && words <= 4) foods.push(p);
    else leftover = true;
  }
  return { foods: [...new Set(foods)], leftover };
}

// "log" is a meal, "symptoms" is a symptoms-only entry, "checkin" answers a meal.
const isLog = e => e.kind === "log" || e.kind === "symptoms";
const hasFood = e => e.kind === "log" && (e.foods?.length || e.photo || (e.note || "").trim());
const kindLabel = e => e.kind === "checkin" ? "check-in" : e.kind === "symptoms" ? "symptoms" : "meal";

const hhmm = d => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
// The time you picked, today. If that's later than now, you meant last night.
function whenTs(draft) {
  if (!draft.time || draft.time === draft.time0) return Date.now();
  const [h, m] = draft.time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return Date.now();
  const now = new Date(), d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d - now > 60e3) d.setDate(d.getDate() - 1);
  return d.getTime();
}

function usualFoods() {
  const m = new Map();
  for (const e of state.entries) if (isLog(e)) for (const f of e.foods || []) {
    const cur = m.get(f) || { f, n: 0, last: 0 };
    cur.n++; cur.last = Math.max(cur.last, e.ts); m.set(f, cur);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, MAX_CHIPS).map(x => x.f);
}

function pendingCheckin() {
  const now = Date.now();
  const due = state.entries.filter(e => hasFood(e) && !e.checkin && now - e.ts >= CHECKIN_AFTER && now - e.ts < CHECKIN_EXPIRES);
  return due.length ? due[due.length - 1] : null;
}

// ---------- rendering ----------
function scaleHTML(scope, s, val) {
  const btns = [0, 1, 2, 3, 4, 5].map(n =>
    `<button data-act="scale" data-scope="${scope}" data-k="${s.k}" data-v="${n}" class="${val === n ? "on" : val != null && n < val ? "fill" : ""}" aria-label="${s.name} ${n}">${n}</button>`
  ).join("");
  return `<div class="scale">
    <div class="scale-top"><span class="scale-name">${s.name}</span><span class="scale-ends">0 ${s.lo} · 5 ${s.hi}</span></div>
    <div class="scale-row" role="group" aria-label="${s.name}">${btns}</div>
  </div>`;
}

function header(left) {
  return `<header class="app">${left}<div class="date">${new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</div></header>`;
}
const backBtn = `<button class="back" data-act="go" data-view="home">‹ Home</button>`;

function renderHome() {
  const p = pendingCheckin();
  if (p && (!state.ci || state.ci.logId !== p.id)) state.ci = { logId: p.id, sym: {} };
  if (!p) state.ci = null;
  const what = p ? (p.foods?.length ? joinAnd(p.foods.slice(0, 3)) : "food") : "";
  const ci = p ? `<section class="card checkin">
      <h2>How do you feel?</h2>
      <p class="sub">You logged ${esc(what)} at ${fmtTime(p.ts)}.</p>
      ${SYMPTOMS.map(s => scaleHTML("ci", s, state.ci.sym[s.k])).join("")}
      <div class="row-actions">
        <button class="quiet" data-act="ci-skip">Not now</button>
        <button class="primary" data-act="ci-save">Save</button>
      </div>
    </section>` : "";
  return `${header(`<h1>Gut Log<span>.</span></h1>`)}
    <div class="home">
      ${ci}
      <div class="home-center">
        <button class="log-btn" data-act="go" data-view="log">Log</button>
        <button class="sym-btn" data-act="go" data-view="log" data-mode="symptoms">Just symptoms</button>
      </div>
      <nav class="home-links">
        <button data-act="go" data-view="week">Your week</button>
        <button data-act="go" data-view="more">Export &amp; backup</button>
      </nav>
    </div>`;
}

function renderLog() {
  const d = state.draft;
  const top = `<header class="app">${backBtn}<label class="when"><span>${d.mode === "symptoms" ? "Felt at" : "Ate at"}</span><input type="time" id="when" value="${d.time}"></label></header>`;
  const feel = `<div class="field">
      <span class="label">How you feel</span>
      ${SYMPTOMS.map(s => scaleHTML("log", s, d.sym[s.k])).join("")}
      <button class="add-sym" data-act="add-sym">+ Add a symptom</button>
    </div>`;
  const extra = `<div class="field">
      <span class="label">Anything else</span>
      <div class="chips">${FLAGS.map(f => `<button class="chip flag ${d.flags.has(f.k) ? "on" : ""}" data-act="flag" data-k="${f.k}">${f.name}</button>`).join("")}</div>
    </div>`;
  if (d.mode === "symptoms") {
    return `${top}
      <h2 class="page-title">Symptoms</h2>
      ${feel}
      <div class="field">
        <span class="label">Note</span>
        <textarea id="note" rows="2" placeholder="optional" enterkeyhint="done">${esc(d.note)}</textarea>
      </div>
      ${extra}
      <div class="save-bar"><button class="primary" data-act="save">Save</button></div>`;
  }
  const chips = usualFoods();
  const photo = d.photoURL
    ? `<div class="photo-preview"><img src="${d.photoURL}" alt="Meal photo"><button data-act="photo-clear">Remove</button></div>`
    : `<button class="photo-btn" data-act="photo"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.5-2h4.8l1.5 2h1.6A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.8" r="3.6"/></svg>Add a photo</button>`;
  return `${top}
    <div class="field">${photo}<input type="file" id="photo-input" accept="image/*" hidden></div>
    <div class="field">
      <span class="label">Usual foods</span>
      ${chips.length
        ? `<div class="chips">${chips.map(f => `<button class="chip ${d.foods.has(f) ? "on" : ""}" data-act="food" data-f="${esc(f)}">${esc(cap(f))}</button>`).join("")}</div>`
        : `<p class="hint">Foods you type below will show up here as quick taps next time.</p>`}
    </div>
    <div class="field">
      <span class="label">Food or note</span>
      <textarea id="note" rows="2" placeholder="rice, chicken, spinach" enterkeyhint="done">${esc(d.note)}</textarea>
    </div>
    ${feel}
    ${extra}
    <div class="save-bar"><button class="primary" data-act="save">Save</button></div>`;
}

// ---------- pattern finding ----------
function buildDays(sinceTs) {
  const days = new Map();
  const get = k => { if (!days.has(k)) days.set(k, { factors: new Set(), sym: {} }); return days.get(k); };
  for (const e of state.entries) {
    if (e.ts < sinceTs) continue;
    const d = get(dayKey(e.ts));
    if (isLog(e)) {
      (e.foods || []).forEach(f => d.factors.add("f:" + f));
      (e.flags || []).forEach(f => d.factors.add("g:" + f));
    }
    for (const s of SYMPTOMS) if (e.sym && e.sym[s.k] != null) (d.sym[s.k] ||= []).push(e.sym[s.k]);
  }
  return days;
}

function factorPhrase(id) {
  if (id.startsWith("g:")) return FLAGS.find(f => f.k === id.slice(2))?.phrase || id.slice(2);
  return id.slice(2);
}

function findPatterns() {
  const since = Date.now() - PATTERN_DAYS * 24 * HOUR;
  const days = [...buildDays(since).values()];
  const factors = new Set(days.flatMap(d => [...d.factors]));
  const found = [];
  for (const F of factors) for (const s of SYMPTOMS) {
    const withF = [], without = [];
    for (const d of days) {
      if (!d.sym[s.k]) continue;
      (d.factors.has(F) ? withF : without).push(mean(d.sym[s.k]));
    }
    if (withF.length < MIN_DAYS || without.length < MIN_DAYS) continue;
    const mw = mean(withF), mo = mean(without), diff = mw - mo;
    if (Math.abs(diff) < MIN_DIFF) continue;
    found.push({ F, s, diff, mw, mo, nw: withF.length, no: without.length, worse: s.goodHigh ? diff < 0 : diff > 0 });
  }
  // Group by symptom and direction so it reads "with coffee and dairy".
  const groups = new Map();
  for (const f of found.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))) {
    const key = f.s.k + (f.diff > 0 ? "+" : "-");
    if (!groups.has(key)) groups.set(key, []);
    if (groups.get(key).length < 2) groups.get(key).push(f);
  }
  return [...groups.values()]
    .sort((a, b) => (b[0].worse - a[0].worse) || Math.abs(b[0].diff) - Math.abs(a[0].diff))
    .slice(0, 3)
    .map(g => ({
      text: `${g[0].s.name} was ${g[0].diff > 0 ? "higher" : "lower"} on days with ${joinAnd(g.map(x => factorPhrase(x.F)))}.`,
      detail: g.map(x => `${cap(factorPhrase(x.F))}: ${r1(x.mw)} on ${x.nw} days with, ${r1(x.mo)} on ${x.no} days without`).join(". ") + ".",
    }));
}

function weekAverages() {
  const since = Date.now() - 7 * 24 * HOUR;
  return SYMPTOMS.map(s => {
    const vals = state.entries.filter(e => e.ts >= since && e.sym && e.sym[s.k] != null).map(e => e.sym[s.k]);
    return { s, avg: vals.length ? mean(vals) : null };
  });
}

function entryText(e) {
  const sym = SYMPTOMS.filter(s => e.sym && e.sym[s.k] != null).map(s => `${s.name} ${e.sym[s.k]}`).join(" · ");
  const flags = (e.flags || []).map(k => FLAGS.find(f => f.k === k)?.name || k).join(", ");
  let foods = (e.foods || []).map(cap).join(", ");
  const note = (e.note || "").trim();
  const showNote = note && (e.kind !== "log" || parseFoods(note).leftover);
  return { sym, flags, foods, note: showNote ? note : "" };
}

function renderWeek() {
  state.urls.forEach(u => URL.revokeObjectURL(u)); state.urls = [];
  const pats = findPatterns();
  const avgs = weekAverages();
  const patHTML = pats.length
    ? pats.map(p => `<p class="pattern">${esc(p.text)}<small>${esc(p.detail)}</small></p>`).join("")
    : `<p class="pattern">Not enough logs yet to spot patterns.<small>Once a food or toggle shows up on a few days (and is missing on a few others), the app will start comparing them here.</small></p>`;

  const list = [...state.entries].reverse();
  let lastDay = "", tl = "";
  for (const e of list) {
    const dk = dayKey(e.ts);
    if (dk !== lastDay) { tl += `<div class="day-head">${fmtDay(e.ts)}</div>`; lastDay = dk; }
    const t = entryText(e);
    let img = "";
    if (e.photo instanceof Blob) { const u = URL.createObjectURL(e.photo); state.urls.push(u); img = `<img src="${u}" alt="">`; }
    tl += `<div class="entry ${e.kind === "checkin" ? "ci" : e.kind === "symptoms" ? "sx" : ""}">${img}<div class="body">
      <div class="time"><span>${fmtTime(e.ts)}${e.kind === "log" ? "" : " · " + kindLabel(e)}</span><button data-act="del" data-id="${e.id}">delete</button></div>
      ${t.foods ? `<div class="note">${esc(t.foods)}</div>` : ""}
      ${t.note ? `<div class="note">${esc(t.note)}</div>` : ""}
      ${t.sym ? `<div class="meta">${esc(t.sym)}</div>` : ""}
      ${t.flags ? `<div class="tags">${esc(t.flags)}</div>` : ""}
    </div></div>`;
  }

  return `${header(backBtn)}
    <h2 class="page-title">Your week</h2>
    <section class="card">${patHTML}</section>
    <p class="footnote">Patterns from your last ${PATTERN_DAYS} days. These are just what your own logs show, to talk over with your doctor.</p>
    ${avgs.some(a => a.avg != null) ? `<h3 class="section-head">Last 7 days, on average</h3>
      <div class="avgs">${avgs.map(a => `<div class="avg"><div class="n">${a.avg == null ? "–" : r1(a.avg)}</div><div class="l">${a.s.name}</div></div>`).join("")}</div>` : ""}
    <h3 class="section-head">Timeline</h3>
    ${tl || `<p class="empty">Your logs will show up here.</p>`}`;
}

function renderMore() {
  const notifOK = "Notification" in window;
  const perm = notifOK ? Notification.permission : "unsupported";
  const remind = perm === "granted"
    ? `<p class="hint">Reminders are on.</p>`
    : perm === "denied"
      ? `<p class="hint">Notifications are turned off for Gut Log in your iPhone Settings.</p>`
      : notifOK ? `<button class="secondary" data-act="notif">Turn on check-in reminders</button>` : "";
  const mine = customSymptoms.length ? `<h3 class="section-head">Symptoms you added</h3>
    <div class="mine">${customSymptoms.map(c => `<div class="mine-row"><span>${esc(c.name)}</span><button data-act="del-sym" data-k="${esc(c.k)}">remove</button></div>`).join("")}</div>
    <p class="hint">Removing one hides it from now on. Past logs keep what you rated.</p>` : "";
  return `${header(backBtn)}
    <h2 class="page-title">Export &amp; backup</h2>
    <span class="label">For your doctor</span>
    <div class="stack">
      <button class="primary" data-act="pdf">Doctor report (PDF)</button>
      <button class="secondary" data-act="csv">Spreadsheet (CSV)</button>
    </div>
    <div id="ready"></div>

    <h3 class="section-head">Backup</h3>
    <p class="hint">Save a backup file to iCloud Drive or Files now and then, so a new phone can pick up where this one left off.</p>
    <div class="stack">
      <button class="secondary" data-act="backup">Save a backup file</button>
      <button class="secondary" data-act="restore">Restore from a backup</button>
      <input type="file" id="restore-input" accept=".json,application/json" hidden>
    </div>

    <h3 class="section-head">Check-in reminders</h3>
    <p class="hint">About 2 hours after you log food, a "How do you feel?" check-in waits at the top of the home screen.${notifOK ? " A notification can also pop up, but only while Gut Log is still open in the background." : ""}</p>
    ${remind}
    ${mine}

    <p class="privacy">Everything stays on this phone. No account, no server, no tracking. ${state.entries.length} entries saved.</p>`;
}

function render() {
  const views = { home: renderHome, log: renderLog, week: renderWeek, more: renderMore };
  $app.innerHTML = views[state.view]();
}

function go(view, mode) {
  if (view === "log") {
    const t = hhmm(new Date());
    state.draft = { mode: mode === "symptoms" ? "symptoms" : "meal", time: t, time0: t, photo: null, photoURL: null, note: "", foods: new Set(), sym: {}, flags: new Set() };
  }
  else if (state.draft?.photoURL) { URL.revokeObjectURL(state.draft.photoURL); state.draft = null; }
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

// ---------- photo ----------
function shrinkPhoto(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1200, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => resolve(b || file), "image/jpeg", 0.75);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ---------- saving ----------
async function saveLog() {
  const d = state.draft;
  const note = document.getElementById("note").value.trim();
  const ts = whenTs(d);
  const entry = d.mode === "symptoms"
    ? { id: uid(), ts, kind: "symptoms", note, sym: { ...d.sym }, flags: [...d.flags] }
    : {
        id: uid(), ts, kind: "log",
        note, foods: [...new Set([...d.foods, ...parseFoods(note).foods])],
        photo: d.photo || null, sym: { ...d.sym }, flags: [...d.flags],
      };
  await DB.put(entry);
  state.entries.push(entry);
  state.entries.sort((a, b) => a.ts - b.ts);
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  scheduleReminders();
  go("home");
  toast(Date.now() - ts > 5 * 60e3 ? `Saved for ${fmtTime(ts)}` : "Saved");
}

async function addSymptom() {
  const name = (prompt("New symptom (you'll rate it 0 to 5)") || "").trim().slice(0, 40);
  if (!name) return;
  if (SYMPTOMS.some(s => s.name.toLowerCase() === name.toLowerCase())) { toast("That one's already on the list"); return; }
  setCustom([...customSymptoms, { k: "c_" + uid(), name }]);
  await DB.setSetting("customSymptoms", customSymptoms);
  render();
  toast(`Added ${name}`);
}

async function saveCheckin(skip) {
  const p = pendingCheckin();
  if (!p) return;
  const sym = { ...(state.ci?.sym || {}) };
  const now = Date.now();
  const changed = [];
  if (!skip && Object.keys(sym).length) {
    const ci = { id: uid(), ts: now, kind: "checkin", forLog: p.id, sym };
    changed.push(ci); state.entries.push(ci);
    p.checkin = ci.id;
  } else p.checkin = "skipped";
  changed.push(p);
  // Any older check-ins still waiting are covered by this one.
  for (const e of state.entries) if (hasFood(e) && !e.checkin && e.ts < p.ts) { e.checkin = "covered"; changed.push(e); }
  await DB.putMany(changed);
  state.ci = null;
  render();
  if (!skip) toast("Saved");
}

// ---------- reminders ----------
let reminderTimers = [];
async function scheduleReminders() {
  reminderTimers.forEach(clearTimeout); reminderTimers = [];
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = Date.now();
  for (const e of state.entries) {
    if (!hasFood(e) || e.checkin) continue;
    const at = e.ts + CHECKIN_AFTER;
    if (at <= now || at - now > CHECKIN_EXPIRES) continue;
    reminderTimers.push(setTimeout(async () => {
      if (e.checkin) return;
      try {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification("How do you feel?", { body: "A quick gut check-in. One tap.", tag: "checkin-" + e.id, icon: "icon-180.png" });
      } catch { /* fine, the home screen card still shows */ }
      if (state.view === "home") render();
    }, at - now));
  }
}

// ---------- export ----------
function blobFile(blob, name) { return new File([blob], name, { type: blob.type }); }

async function deliver(blob, name) {
  const file = blobFile(blob, name);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (err) {
      if (err.name === "AbortError") return;
      // iPhone sometimes wants a fresh tap before sharing. Offer one.
      const slot = document.getElementById("ready");
      if (slot) {
        slot.innerHTML = `<p class="hint" style="margin-top:14px">Your file is ready.</p><button class="primary" id="ready-btn">Share ${esc(name)}</button>`;
        document.getElementById("ready-btn").onclick = () => navigator.share({ files: [file], title: name }).catch(() => {}).finally(() => { slot.innerHTML = ""; });
        return;
      }
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const stamp = () => dayKey(Date.now());

function exportCSV() {
  const symCol = s => s.custom ? s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") : s.k === "fog" ? "brain_fog" : s.k === "cramps" ? "stomach_cramps" : s.k === "reflux" ? "acid_reflux" : s.k;
  const cols = ["date", "time", "type", "foods", "note", ...SYMPTOMS.map(symCol), ...FLAGS.map(f => f.k === "sleep" ? "bad_sleep" : f.k === "stress" ? "stressed" : f.k), "photo"];
  const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = state.entries.map(e => [
    dayKey(e.ts), fmtTime(e.ts), kindLabel(e),
    (e.foods || []).join("; "), e.note || "",
    ...SYMPTOMS.map(s => e.sym?.[s.k] ?? ""),
    ...FLAGS.map(f => isLog(e) ? ((e.flags || []).includes(f.k) ? "yes" : "") : ""),
    e.photo ? "yes" : "",
  ].map(q).join(","));
  const csv = [cols.join(","), ...rows].join("\n");
  deliver(new Blob([csv], { type: "text/csv" }), `gut-log-${stamp()}.csv`);
}

function exportPDF() {
  if (!window.jspdf) { toast("One sec, still loading"); return; }
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 50;
  let y = M;
  const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const line = (txt, { size = 11, bold = false, color = [67, 48, 42], indent = 0, gap = 4 } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(txt, W - 2 * M - indent);
    for (const l of lines) { need(size * 1.3); doc.text(l, M + indent, y + size); y += size * 1.3; }
    y += gap;
  };
  const list = state.entries;
  const range = list.length ? `${fmtDay(list[0].ts)} to ${fmtDay(list[list.length - 1].ts)}` : "No entries yet";

  line("Gut Log", { size: 22, bold: true, color: [107, 31, 45], gap: 2 });
  line(`Food and symptom log · ${range}`, { size: 11, color: [147, 121, 107] });
  line("Symptoms are self-rated 0 to 5. Energy: higher is better. Every other symptom: higher is worse. Check-ins were logged about 2 hours after eating. Symptoms-only entries were logged on their own, not tied to a meal.", { size: 10, color: [147, 121, 107], gap: 14 });

  line(`Patterns (last ${PATTERN_DAYS} days)`, { size: 14, bold: true, gap: 6 });
  const pats = findPatterns();
  if (pats.length) pats.forEach(p => { line("• " + p.text, { size: 11, gap: 1 }); line(p.detail, { size: 9.5, color: [147, 121, 107], indent: 10, gap: 6 }); });
  else line("Not enough data yet to compare days.", { size: 11 });
  y += 10;

  line("Daily log", { size: 14, bold: true, gap: 6 });
  let lastDay = "";
  for (const e of list) {
    const dk = dayKey(e.ts);
    if (dk !== lastDay) { y += 6; need(40); line(fmtDay(e.ts), { size: 11.5, bold: true, color: [107, 31, 45], gap: 2 }); lastDay = dk; }
    const t = entryText(e);
    const parts = [];
    if (e.kind === "log") {
      if (t.foods) parts.push("Ate: " + t.foods);
      if (t.note) parts.push("Note: " + t.note);
      if (e.photo && !t.foods && !t.note) parts.push("Meal (photo)");
    } else if (e.kind === "symptoms") {
      parts.push("Symptoms");
      if (t.note) parts.push("Note: " + t.note);
    } else parts.push("Check-in");
    if (t.sym) parts.push(t.sym);
    if (t.flags) parts.push(t.flags);
    line(`${fmtTime(e.ts)}   ${parts.join("  |  ") || "Logged"}`, { size: 10.5, indent: 8, gap: 3 });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(147, 121, 107);
    doc.text(`Exported ${fmtDay(Date.now())} · page ${i} of ${pages}`, M, H - 26);
  }
  deliver(doc.output("blob"), `gut-log-report-${stamp()}.pdf`);
}

// ---------- backup ----------
const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }

async function backup() {
  const entries = await Promise.all(state.entries.map(async e => e.photo instanceof Blob ? { ...e, photo: await blobToDataURL(e.photo) } : e));
  const json = JSON.stringify({ app: "gut-log", version: 2, exportedAt: new Date().toISOString(), customSymptoms, entries });
  deliver(new Blob([json], { type: "application/json" }), `gut-log-backup-${stamp()}.json`);
}

async function restore(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "gut-log" || !Array.isArray(data.entries)) throw new Error("not a backup");
    const entries = [];
    for (const e of data.entries) {
      if (!e || !e.id || !e.ts) continue;
      if (typeof e.photo === "string" && e.photo.startsWith("data:")) e.photo = await dataURLToBlob(e.photo);
      entries.push(e);
    }
    await DB.putMany(entries);
    if (Array.isArray(data.customSymptoms)) {
      const have = new Set(customSymptoms.map(c => c.k));
      setCustom([...customSymptoms, ...data.customSymptoms.filter(c => c && c.k && c.name && !have.has(c.k))]);
      await DB.setSetting("customSymptoms", customSymptoms);
    }
    state.entries = await DB.all();
    render();
    toast(`Restored ${entries.length} entries`);
  } catch {
    toast("That file isn't a Gut Log backup");
  }
}

// ---------- events ----------
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;

  if (act === "go") return go(b.dataset.view, b.dataset.mode);
  if (act === "add-sym") return addSymptom();
  if (act === "del-sym") {
    const c = customSymptoms.find(x => x.k === b.dataset.k);
    if (!c || !confirm(`Remove ${c.name}?`)) return;
    setCustom(customSymptoms.filter(x => x.k !== c.k));
    await DB.setSetting("customSymptoms", customSymptoms);
    return render();
  }

  if (act === "scale") {
    const target = b.dataset.scope === "ci" ? state.ci.sym : state.draft.sym;
    const k = b.dataset.k, v = +b.dataset.v;
    if (target[k] === v) delete target[k]; else target[k] = v;
    const row = b.parentElement;
    row.querySelectorAll("button").forEach(x => {
      const n = +x.dataset.v;
      x.className = target[k] === n ? "on" : target[k] != null && n < target[k] ? "fill" : "";
    });
    return;
  }
  if (act === "food") {
    const f = b.dataset.f, s = state.draft.foods;
    s.has(f) ? s.delete(f) : s.add(f); b.classList.toggle("on", s.has(f));
    return;
  }
  if (act === "flag") {
    const k = b.dataset.k, s = state.draft.flags;
    s.has(k) ? s.delete(k) : s.add(k); b.classList.toggle("on", s.has(k));
    return;
  }
  if (act === "photo") return document.getElementById("photo-input").click();
  if (act === "photo-clear") {
    state.draft.note = document.getElementById("note").value;
    URL.revokeObjectURL(state.draft.photoURL); state.draft.photo = state.draft.photoURL = null;
    return render();
  }
  if (act === "save") { b.disabled = true; return saveLog(); }
  if (act === "ci-save") return saveCheckin(false);
  if (act === "ci-skip") return saveCheckin(true);
  if (act === "del") {
    if (!confirm("Delete this entry?")) return;
    await DB.del(b.dataset.id);
    state.entries = state.entries.filter(e => e.id !== b.dataset.id);
    return render();
  }
  if (act === "pdf") return exportPDF();
  if (act === "csv") return exportCSV();
  if (act === "backup") return backup();
  if (act === "restore") return document.getElementById("restore-input").click();
  if (act === "notif") {
    try { await Notification.requestPermission(); } catch {}
    scheduleReminders();
    return render();
  }
});

document.addEventListener("change", async ev => {
  if (ev.target.id === "photo-input" && ev.target.files[0]) {
    const d = state.draft;
    d.note = document.getElementById("note").value;
    d.photo = await shrinkPhoto(ev.target.files[0]);
    if (d.photoURL) URL.revokeObjectURL(d.photoURL);
    d.photoURL = URL.createObjectURL(d.photo);
    render();
  }
  if (ev.target.id === "restore-input" && ev.target.files[0]) restore(ev.target.files[0]);
});

// Keep what you've typed when the screen redraws (photo, new symptom).
document.addEventListener("input", ev => {
  if (!state.draft) return;
  if (ev.target.id === "note") state.draft.note = ev.target.value;
  if (ev.target.id === "when") state.draft.time = ev.target.value;
});

// Coming back to the app: refresh so a due check-in appears.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.view === "home") render();
});

(async function init() {
  try { setCustom(await DB.getSetting("customSymptoms")); } catch {}
  try { state.entries = await DB.all(); } catch { toast("Couldn't open storage"); }
  render();
  scheduleReminders();
})();
