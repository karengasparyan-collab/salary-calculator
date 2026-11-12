/* Glana Pay — app layer (UI, storage, Jira pull). All pay math lives in engine.js. */
(function () {
"use strict";
const E = window.PayEngine;
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const amd = (n) => n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("en-US");
const hrs = (n) => n == null || isNaN(n) ? "—" : (Math.round(n * 10) / 10).toLocaleString("en-US");
const pct = (n, d) => n == null || isNaN(n) ? "—" : n.toFixed(d == null ? 0 : d) + "%";
const clone = (o) => JSON.parse(JSON.stringify(o == null ? null : o));
const MONTHN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthName = (m) => { const [y, mo] = m.split("-").map(Number); return MONTHN[mo - 1] + " " + y; };
const monthShort = (m) => monthName(m).slice(0, 3) + " " + m.slice(0, 4);
const fmtDate = (d) => { if (!d) return "—"; const [y, m, dd] = d.split("-"); return `${+dd} ${MONTHN[+m - 1].slice(0, 3)}`; };
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------------- presentation helpers (icons, avatars, colour cues; no pay logic) ----------------
const svgI = (d, cls) => `<svg class="i${cls ? " " + cls : ""}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  payroll: svgI('<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 10v4M17.5 10v4"/>'),
  tasks: svgI('<path d="M8.5 11.5l3 3 8-8.5"/><path d="M20 12.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8.5"/>'),
  hours: svgI('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  incidents: svgI('<path d="M12 4.5l8.5 14.5h-17z"/><path d="M12 10.5v3.5M12 16.8v.2"/>'),
  team: svgI('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.2 3-5.2 6-5.2s5.4 2 6 5.2"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.8 14.8c1.7.8 2.8 2.4 3.2 4.7"/>'),
  settings: svgI('<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.4"/><circle cx="8" cy="17" r="2.4"/>'),
  analytics: svgI('<path d="M4 19.5h16"/><path d="M7 16v-4.5M12 16V6.5M17 16v-7"/>'),
  history: svgI('<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 5v3.8h3.8"/><path d="M12 8v4.2l2.8 1.8"/>'),
  print: svgI('<path d="M7 9V4.5h10V9"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14.5h10v5H7z"/>'),
  lock: svgI('<rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  check: svgI('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  download: svgI('<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14"/>'),
  upload: svgI('<path d="M12 16V5M7.5 9L12 4.5 16.5 9M5 19.5h14"/>'),
  refresh: svgI('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.2h-4.2"/>'),
  spin: svgI('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/>', "spin"),
};
const initials = (n) => String(n || "").trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || "").join("").toUpperCase() || "?";
const hueOf = (n) => { let h = 7; for (const ch of String(n || "")) h = (h * 33 + ch.codePointAt(0)) % 9973; return [262, 292, 322, 346, 222, 196][h % 6]; };
const avatar = (n) => `<span class="av" style="--h:${hueOf(n)}" data-i="${esc(initials(n))}" aria-hidden="true"></span>`;
const clampPct = (n) => Math.max(0, Math.min(100, Number(n) || 0)).toFixed(1);
const bandCls = (r) => r.bonusPct >= 48 ? "good" : r.bonusPct >= 35 ? "" : r.bonusPct > 0 ? "warn" : "bad";
const gateCls = (g) => g === 1 ? "good" : g > 0 ? "warn" : "bad";
const scCls = (v) => v >= 80 ? "good" : v >= 50 ? "warn" : "bad";
const prio = (p) => p ? `<span class="prio" data-p="${esc(String(p).toLowerCase())}">${esc(p)}</span>` : "—";
const mixBar = (base, bonus, extra) => `<div class="stack" aria-hidden="true"><span class="s-base" style="flex:${Math.max(0, base)} 0 0"></span><span class="s-bonus" style="flex:${Math.max(0, bonus)} 0 0"></span>${extra > 0 ? `<span class="s-extra" style="flex:${extra} 0 0"></span>` : ""}</div>`;

// ---------------- store (shared server, browser storage, fallback, sample mode) ----------------
/** Same interface as the Claude artifact db (doc / collection / onSnapshot).
 *  With `remote` (ServerDB), the Glana server is the source of truth: every write goes there first and
 *  sync() picks up other people's changes. With `storageKey`, writes are kept in this browser's
 *  localStorage. With neither, data lives in memory only (sample mode). */
function MemDB(storageKey, remote) {
  const docs = new Map(); const listeners = new Set();
  const parent = (p) => p.split("/").slice(0, -1).join("/");
  const merge = (a, b) => { const o = Object.assign({}, a); for (const k in b) { o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a && typeof a[k] === "object" && !Array.isArray(a[k]) ? merge(a[k], b[k]) : clone(b[k]); } return o; };
  const notify = () => setTimeout(() => listeners.forEach((l) => l()), 0);
  const load = () => {
    docs.clear();
    const raw = localStorage.getItem(storageKey);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) if (v && typeof v === "object") docs.set(k, v);
  };
  if (storageKey) {
    load(); // throws if storage is blocked: the caller falls back to memory only
    window.addEventListener("storage", (e) => { if (e.key === storageKey) { try { load(); notify(); } catch (err) {} } });
  }
  /** Apply a change, persist it, and roll back if the browser refuses to store it. */
  const commit = (path, next) => {
    const had = docs.has(path), prev = docs.get(path);
    if (next === undefined) docs.delete(path); else docs.set(path, next);
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(docs))); }
      catch (e) { if (had) docs.set(path, prev); else docs.delete(path); throw { code: "quota_exceeded", message: String(e && e.message) }; }
    }
    notify();
  };
  /** Send one change to the server, then keep what the server stored. */
  let writes = 0, epoch = 0;
  const remoteWrite = async (op) => {
    writes++; epoch++;
    try { const r = await remote.write(op); commit(op.path, r.data == null ? undefined : r.data); }
    finally { writes--; epoch++; }
  };
  /** Replace the cache with a server snapshot; tell listeners only if something changed. */
  const refresh = (all) => {
    const next = new Map(Object.entries(all || {}).filter(([, v]) => v && typeof v === "object"));
    if (JSON.stringify([...next].sort()) === JSON.stringify([...docs].sort())) return false;
    docs.clear(); next.forEach((v, k) => docs.set(k, v)); notify(); return true;
  };
  /** Pick up changes made by others, unless one of our own saves is still on its way. */
  const sync = async () => {
    if (!remote || writes) return false;
    const e = epoch; const all = await remote.poll();
    return !!all && e === epoch && !writes && refresh(all);
  };
  const snap = (path) => { const d = docs.get(path); return { id: path.split("/").pop(), exists: !!d, data: () => (d ? clone(d) : undefined), metadata: { fromCache: false, hasPendingWrites: false } }; };
  const qsnap = (path) => { const list = [...docs.keys()].filter((k) => parent(k) === path).sort().map(snap); return { docs: list, size: list.length, empty: !list.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      get: async () => { if (remote) { const d = await remote.readDoc(path); if (d) docs.set(path, d); else docs.delete(path); } return snap(path); },
      set: async (d) => { if (remote) return remoteWrite({ op: "set", path, data: clone(d) }); commit(path, clone(d)); },
      update: async (d) => { if (remote) return remoteWrite({ op: "update", path, data: clone(d) }); if (!docs.has(path)) throw { code: "invalid_argument", message: "missing" }; commit(path, merge(docs.get(path), d)); },
      delete: async () => { if (remote) return remoteWrite({ op: "delete", path }); commit(path, undefined); },
      onSnapshot(next) { const l = () => next(snap(path)); listeners.add(l); setTimeout(l, 0); return () => listeners.delete(l); },
      collection: (c) => colRef(path + "/" + c),
    };
  }
  function colRef(path) {
    const q = {
      path, doc: (id) => docRef(path + "/" + (id || rid())),
      add: async (d) => { const r = docRef(path + "/" + rid()); await r.set(d); return r; },
      get: async () => qsnap(path),
      onSnapshot(next) { const l = () => next(qsnap(path)); listeners.add(l); setTimeout(l, 0); return () => listeners.delete(l); },
      where() { return q; }, orderBy() { return q; }, limit() { return q; },
    };
    return q;
  }
  /** Backup: every stored document as { path: data }. */
  const exportAll = () => clone(Object.fromEntries(docs));
  /** Restore: replace everything with a backup made by exportAll. */
  const importAll = async (all) => {
    if (remote) { writes++; epoch++; try { refresh(await remote.replaceAll(all)); } finally { writes--; epoch++; } return; }
    const before = new Map(docs);
    docs.clear();
    for (const [k, v] of Object.entries(all)) if (v && typeof v === "object") docs.set(k, clone(v));
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(docs))); }
      catch (e) { docs.clear(); before.forEach((v, k) => docs.set(k, v)); throw { code: "quota_exceeded" }; }
    }
    notify();
  };
  /** Read-only looks at the cache (no copies): one document, or every [path, data] pair. Don't change what they return. */
  const peek = (path) => docs.get(path);
  const entries = () => docs.entries();
  return { doc: docRef, collection: colRef, exportAll, importAll, refresh, sync, peek, entries };
}
const STORE_KEY = "glanaPay.db.v1";

/** Talks to the Glana server's shared data (server.js → /api/db). */
function ServerDB() {
  let rev = null;
  async function req(method, url, body) {
    let res, data = null;
    try { res = await fetch(url, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw { code: "unavailable" }; }
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401) throw { code: "login_required" };
    if (!res.ok) throw { code: res.status >= 500 ? "unavailable" : (data && data.code) || "invalid_argument", message: data && data.message };
    return data;
  }
  return {
    async loadAll() { const d = await req("GET", "api/db"); rev = d.rev; return d.docs; },
    /** Everything again if anyone changed anything since the last look, else null. */
    async poll() { const d = await req("GET", "api/db" + (rev == null ? "" : "?since=" + rev)); if (d.unchanged) return null; rev = d.rev; return d.docs; },
    async readDoc(path) { return (await req("GET", "api/db/doc?path=" + encodeURIComponent(path))).data; },
    // Our own writes don't move `rev` here, so the next poll also sees changes others made in between.
    async write(op) { return (await req("POST", "api/db", { ops: [op] })).results[0]; },
    async replaceAll(docs) { const d = await req("PUT", "api/db", { docs }); rev = d.rev; return d.docs; },
  };
}

// ---------------- state ----------------
const S = {
  db: null, mode: "loading", // live (inside Claude) | server (shared, on the Glana server) | browser (this browser only) | local (not saving) | sample
  canEdit: true, downloads: null,
  settings: clone(E.DEFAULT_SETTINGS), settingsStored: false,
  team: [], month: E.monthAdd(new Date().toISOString().slice(0, 7), -1),
  monthDoc: {}, incidents: [], jiraParts: [], tasks: [],
  tab: "payroll", loaded: {}, unsubs: [], monthUnsubs: [], slowTimer: null, slow: false,
  me: null, users: null, userEditing: null, backups: null, history: null, histFilter: { who: "", q: "" },
  an: { range: "12", metric: "bonusPct", focus: null, live: null },
  pendingRender: false, jiraPreview: null, hoursPreview: null, filter: "", mcp: null, jiraServer: null, pull: null, pageSize: 100,
};
try { const t = localStorage.getItem("glanaPayTab"); if (t) S.tab = t; } catch (e) {}

const ALL_TABS = [
  ["payroll", "Payroll"], ["tasks", "Jira tasks"], ["hours", "Hours"], ["incidents", "Incidents"], ["analytics", "Analytics"], ["team", "Team"], ["settings", "Settings"], ["history", "History"],
];
// ----- who is signed in (only on the Glana server with separate logins; elsewhere everything is allowed) -----
const isAdmin = () => !S.me || S.me.admin;
const seesPay = () => !S.me || S.me.seesPay;
const hasHistory = () => S.mode === "server" && isAdmin() && !!(S.jiraServer && S.jiraServer.auth);
function canPage(k) {
  if (k === "history") return hasHistory();
  if (k === "settings") return isAdmin() || !!(S.jiraServer && S.jiraServer.auth); // everyone can change their own password there
  if (k === "analytics" && S.mode === "loading") return true;
  return !S.me || S.me.admin || S.me.pages.includes(k);
}
const tabs = () => ALL_TABS.filter(([k]) => canPage(k));
const nowMonth = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };

function cfg() {
  const c = Object.assign(clone(E.DEFAULT_SETTINGS), clone(S.settings || {}));
  c.tax = Object.assign(clone(E.DEFAULT_SETTINGS.tax), (S.settings && S.settings.tax) || {});
  c.payday = Object.assign(clone(E.DEFAULT_SETTINGS.payday), (S.settings && S.settings.payday) || {});
  return c;
}
function teamFor(month) { const [a, b] = [month + "-01", month + "-31"]; return S.team.filter((m) => m.active !== false && (!m.start || m.start <= b) && (!m.end || m.end >= a)).sort((x, y) => x.name.localeCompare(y.name)); }
function activeTeam() { return teamFor(S.month); }
function hoursFor(id) { return (S.monthDoc.hours || {})[id]; }
function incidentsFor(id) { return S.incidents.filter((i) => i.memberId === id); }
function results() {
  const c = cfg();
  return activeTeam().map((m) => E.computePerson(m, S.month, { tasks: S.tasks, hours: hoursFor(m.id), incidents: incidentsFor(m.id), skipHours: !!S.monthDoc.skipHours, extra: (S.monthDoc.extras || {})[m.id] }, c));
}

// ---------------- save status / toast ----------------
let saving = 0;
function setSave(txt) { $("#saveState").textContent = txt; }
async function write(fn, okMsg) {
  if (!S.canEdit) { toast("You can view this calculator but not change it."); return false; }
  saving++; setSave("Saving…");
  try { await fn(); setSave(S.mode === "live" || S.mode === "server" || S.mode === "browser" ? "Saved" : ""); if (okMsg) toast(okMsg); return true; }
  catch (e) {
    let msg = "Could not save. Try again.";
    if (e && e.code === "invalid_argument") { msg = "This change was refused (no edit access, or the data is too large)."; }
    if (e && e.code === "forbidden") msg = e.message || "Your account isn't allowed to change this.";
    if (e && e.code === "quota_exceeded") msg = "Storage is full. Delete old months to free space.";
    if (e && e.code === "login_required") msg = "Your sign-in expired. Reload the page and sign in again.";
    if (e && e.code === "unavailable") { try { await new Promise((r) => setTimeout(r, 400 + Math.random() * 600)); await fn(); setSave("Saved"); return true; } catch (e2) {} }
    setSave("Not saved"); toast(msg); return false;
  } finally { saving--; }
}
let toastT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600); }

// ---------------- data wiring ----------------
function subscribeAll() {
  S.unsubs.forEach((u) => u()); S.unsubs = [];
  const db = S.db;
  S.loaded = {};
  clearTimeout(S.slowTimer); S.slow = false;
  S.slowTimer = setTimeout(() => { if (!S.loaded.settings || !S.loaded.team) { S.slow = true; render(); } }, 10000);
  const done = (k, snap) => { if (!snap.metadata || !snap.metadata.fromCache) S.loaded[k] = true; if (S.loaded.settings && S.loaded.team && S.slow) { S.slow = false; } };
  const err = (k) => (e) => { S.loaded[k] = true; console.warn(k, e); if (e && e.code === "revoked") { S.canEdit = false; } scheduleRender(); };
  S.unsubs.push(db.doc("config/settings").onSnapshot((s) => {
    done("settings", s);
    S.settingsStored = s.exists;
    S.settings = s.exists ? Object.assign(clone(E.DEFAULT_SETTINGS), s.data()) : clone(E.DEFAULT_SETTINGS);
    scheduleRender();
  }, err("settings")));
  S.unsubs.push(db.collection("team").onSnapshot((q) => {
    done("team", q);
    S.team = q.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    scheduleRender();
  }, err("team")));
  subscribeMonth();
}
function subscribeMonth() {
  S.monthUnsubs.forEach((u) => u()); S.monthUnsubs = [];
  S.monthDoc = {}; S.incidents = []; S.jiraParts = []; S.tasks = []; S.jiraPreview = null; S.hoursPreview = null;
  const db = S.db, m = S.month;
  S.monthUnsubs.push(db.doc("months/" + m).onSnapshot((s) => { S.monthDoc = s.exists ? s.data() : {}; rebuildTasks(); scheduleRender(); }, (e) => console.warn(e)));
  S.monthUnsubs.push(db.collection("months/" + m + "/incidents").onSnapshot((q) => {
    S.incidents = q.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    scheduleRender();
  }, (e) => console.warn(e)));
  S.monthUnsubs.push(db.collection("months/" + m + "/jira").onSnapshot((q) => {
    S.jiraParts = q.docs.map((d) => ({ id: d.id, data: d.data() })); rebuildTasks(); scheduleRender();
  }, (e) => console.warn(e)));
}
function rebuildTasks() {
  const meta = S.monthDoc.jira; if (!meta) { S.tasks = []; return; }
  const parts = [];
  for (let i = 0; i < (meta.parts || 0); i++) { const p = S.jiraParts.find((x) => x.id === "p" + i); if (!p || p.data.uploadId !== meta.uploadId) { S.tasks = []; return; } parts.push(...(p.data.tasks || [])); }
  S.tasks = parts;
}
function scheduleRender() {
  const a = document.activeElement;
  if (a && $("#view").contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.type !== "file") { S.pendingRender = true; return; }
  render();
}
document.addEventListener("focusout", () => setTimeout(() => { if (S.pendingRender) { const a = document.activeElement; if (!(a && $("#view").contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) { S.pendingRender = false; render(); } } }, 0));

// ---------------- writes ----------------
async function ensureMonthDoc() {
  const ref = S.db.doc("months/" + S.month);
  const s = await ref.get();
  if (!s.exists) await ref.set({ month: S.month, createdAt: new Date().toISOString() });
}
async function setHours(id, field, value) {
  const v = value === "" ? "" : Number(value);
  if (v !== "" && (!isFinite(v) || v < 0)) { toast("Enter a positive number."); return; }
  await write(async () => { await ensureMonthDoc(); await S.db.doc("months/" + S.month).update({ hours: { [id]: { [field]: v } } }); });
}
async function saveJira(parsed, fileName, source) {
  const uploadId = rid();
  const tasks = parsed.tasks;
  const chunks = []; let cur = [], size = 0;
  for (const t of tasks) { const s = JSON.stringify(t).length; if (size + s > 180000 && cur.length) { chunks.push(cur); cur = []; size = 0; } cur.push(t); size += s; }
  chunks.push(cur);
  return write(async () => {
    for (let i = 0; i < chunks.length; i++) await S.db.doc(`months/${S.month}/jira/p${i}`).set({ uploadId, tasks: chunks[i] });
    await ensureMonthDoc();
    await S.db.doc("months/" + S.month).update({ jira: { uploadId, source: source || "csv", parts: chunks.length, fileName: fileName || "pasted", uploadedAt: new Date().toISOString(), rowCount: parsed.rowCount, found: parsed.found, missing: parsed.missing, warnings: parsed.warnings } });
  }, source === "jira" ? `Pulled ${tasks.filter((t) => E.monthOf(t.resolved) === S.month).length} tasks for ${monthName(S.month)}` : `Jira export saved: ${tasks.length} tasks`);
}

// ---------------- render ----------------
function render() {
  const c = cfg();
  $("#monthLabel").textContent = monthName(S.month);
  const pill = $("#modePill");
  const shadow = (c.shadowMonths || []).includes(S.month);
  pill.className = "pill " + (shadow ? "shadow" : "live");
  pill.textContent = shadow ? "Shadow month" : "Live pay";
  pill.classList.toggle("hide", S.mode === "loading");
  if (S.mode !== "loading" && !canPage(S.tab)) S.tab = (tabs()[0] || ["settings"])[0];
  renderBanners();
  renderTabs();
  renderChrome();
  const v = $("#view");
  const scroll = window.scrollY;
  if (S.mode === "loading") { v.innerHTML = `<div class="empty loading"><div class="sk-grid" aria-hidden="true"><span class="sk"></span><span class="sk"></span><span class="sk"></span><span class="sk"></span></div><span class="sk sk-table" aria-hidden="true"></span><p>Loading saved data…</p></div>`; return; }
  // Keep a half-typed password when shared data arrives and the view is redrawn.
  const typed = [...v.querySelectorAll(".pwform input[type=password]")].map((i) => [i.name, i.value]); const focused = document.activeElement && document.activeElement.closest(".pwform") ? document.activeElement.name : null;
  v.innerHTML = ({ payroll: viewPayroll, tasks: viewTasks, hours: viewHours, incidents: viewIncidents, team: viewTeam, settings: viewSettings, analytics: viewAnalytics, history: viewHistory })[S.tab]();
  for (const [n, val] of typed) { const i = v.querySelector(`.pwform [name=${n}]`); if (i) i.value = val; }
  if (focused) { const i = v.querySelector(`.pwform [name=${focused}]`); if (i) i.focus(); }
  window.scrollTo(0, scroll);
  bindDrops();
  if (S.animatePull && S.tab === "tasks") { clearTimeout(S.animT); S.animT = setTimeout(playPullAnim, 180); }
}
/** Browser tab title and the sidebar note that says where the data is kept. Display only. */
function renderChrome() {
  const tabLabel = (ALL_TABS.find(([k]) => k === S.tab) || [])[1];
  document.title = S.mode === "loading" || !tabLabel ? "Glana Pay" : `${tabLabel} · ${monthName(S.month)} · Glana Pay`;
  const where = {
    live: ["Shared data", "Saved in Claude"],
    server: ["Shared data", "Saved on the Glana server"],
    browser: ["This browser only", "Saved on this computer"],
    local: ["Not saving", "Changes are lost on reload"],
    sample: ["Sample data", "Nothing here is saved"],
  }[S.mode] || ["Loading…", ""];
  const w = $("#dataWhere"), n = $("#dataNote"), f = $("#dataFoot");
  if (w) w.textContent = where[0];
  if (n) n.textContent = where[1];
  if (f) f.title = where.filter(Boolean).join(" · ");
}
function renderBanners() {
  const b = [];
  if (S.mode === "local") b.push(`<div class="banner"><span class="grow"><b>Not saving.</b> ${S.loadError ? esc(S.loadError) : "This browser blocks saved data (private window or storage turned off). Changes here are lost on reload."}</span><button class="btn" data-action="sample">Try sample data</button></div>`);
  if (S.mode === "browser" && S.jiraServer && S.jiraServer.hosted) b.push(`<div class="banner"><span class="grow"><b>Shared database not connected.</b> For now, data is saved only in this browser. In Vercel, add Upstash for Redis under Storage, then redeploy.</span></div>`);
  if (S.mode === "server" && S.loaded.team && !S.team.length) b.push(`<div class="banner info"><span class="grow"><b>Welcome.</b> Everything you enter is saved on the Glana server and shared with everyone who has the password. Add the team to start, or look around with sample data first.</span><button class="btn" data-action="sample">Try sample data</button></div>`);
  if (S.mode === "browser" && S.loaded.team && !S.team.length) b.push(`<div class="banner info"><span class="grow"><b>Welcome.</b> Everything you enter is saved in this browser on this computer. Add the team to start, or look around with sample data first.</span><button class="btn" data-action="sample">Try sample data</button></div>`);
  if (S.mode === "sample") b.push(`<div class="banner info"><span class="grow"><b>Sample data.</b> Three example employees for November 2026 (Ani is the worked example from the pay document). Nothing here is saved.</span><button class="btn" data-action="exit-sample">Back to real data</button></div>`);
  if (S.slow) b.push(`<div class="banner"><span class="grow">Saved data can't be reached yet. What you see may be out of date.</span></div>`);
  const pd = paydayNotice();
  if (pd) b.push(`<div class="banner"><span class="grow"><b>${pd.daysLeft === 0 ? "Payday is today." : pd.daysLeft === 1 ? "Payday is tomorrow." : `Payday is in ${pd.daysLeft} days.`}</b> ${esc(monthName(pd.month))} still needs: ${pd.missing.map(esc).join(", ")}.</span>${S.month === pd.month ? "" : `<button class="btn" data-action="goto-month" data-month="${esc(pd.month)}">Open ${esc(monthName(pd.month))}</button>`}</div>`);
  if (!S.canEdit && S.me) b.push(`<div class="banner info"><span class="grow">View only: your account (${esc(S.me.name)}) can look but not change anything.</span></div>`);
  if (!S.canEdit && S.mode === "live") b.push(`<div class="banner info"><span class="grow">View only: you don't have edit access to this calculator.</span></div>`);
  $("#banners").innerHTML = b.join("");
}
/** Reminder before payday (Settings → Payday reminder): the month about to be paid, if it is not ready yet. */
function paydayNotice() {
  const p = cfg().payday;
  if (!p || !p.enabled || !["server", "browser", "live"].includes(S.mode) || !seesPay() || !S.loaded.team) return null;
  const t = new Date(), ym = nowMonth(), dim = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
  const day = Math.min(Math.max(1, Math.round(p.day) || 1), dim(ym));
  let daysLeft, month;
  if (t.getDate() <= day) { daysLeft = day - t.getDate(); month = E.monthAdd(ym, -1); }
  else { const nm = E.monthAdd(ym, 1); daysLeft = dim(ym) - t.getDate() + Math.min(Math.max(1, Math.round(p.day) || 1), dim(nm)); month = ym; }
  if (daysLeft > (Number(p.daysBefore) || 0)) return null;
  const doc = month === S.month ? S.monthDoc : S.db && S.db.peek ? S.db.peek("months/" + month) || {} : null;
  const team = teamFor(month);
  if (!doc || !team.length) return null;
  const missing = [];
  if (!doc.jira) missing.push("Jira tasks");
  if (!doc.skipHours && !team.every((m) => { const h = (doc.hours || {})[m.id]; return h && h.worked !== "" && h.worked != null; })) missing.push("hours");
  if (!doc.final) missing.push("saved results");
  return missing.length ? { month, daysLeft, missing } : null;
}
function status() {
  const team = activeTeam();
  const hrs = team.filter((m) => { const h = hoursFor(m.id); return h && h.worked !== "" && h.worked != null; }).length;
  return {
    team: team.length > 0 && (!seesPay() || team.every((m) => E.salaryFor(m, S.month) > 0)),
    tasks: !!S.monthDoc.jira && S.tasks.length > 0,
    hours: team.length > 0 && (!!S.monthDoc.skipHours || hrs === team.length),
    hrs, teamN: team.length,
  };
}
function renderTabs() {
  const st = status();
  const dots = { tasks: st.tasks, hours: st.hours, team: st.team };
  const list = tabs();
  const groups = {}; // a heading above the first visible tab of each group
  for (const [name, keys] of [["This month", ["payroll", "tasks", "hours", "incidents"]], ["Insights", ["analytics"]], ["Setup", ["team", "settings", "history"]]]) { const first = list.find(([k]) => keys.includes(k)); if (first) groups[first[0]] = name; }
  $("#tabs").style.setProperty("--tabn", list.length > 6 ? Math.ceil(list.length / 2) : list.length || 1); // phones: two even rows when there are many
  document.body.classList.toggle("tabs2", list.length > 6);
  $("#tabs").innerHTML = list.map(([k, label]) => `${groups[k] ? `<span class="nav-h" role="presentation">${groups[k]}</span>` : ""}<button role="tab" aria-selected="${S.tab === k}" data-action="tab" data-tab="${k}"><span class="ico">${ICON[k]}</span><span class="lbl">${label}</span>${k in dots ? `<span class="dot ${dots[k] ? "ok" : "todo"}" title="${dots[k] ? "Ready" : "Needs attention"}"></span>` : ""}${k === "incidents" && S.incidents.length ? `<span class="tag">${S.incidents.length}</span>` : ""}</button>`).join("");
}

function playPullAnim() {
  const el = $("#pullsum"); if (!el) return;
  S.animatePull = false;
  el.classList.add("anim");
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.querySelectorAll("[data-count]").forEach((n, ix) => {
    const target = +n.dataset.count, delay = ix * 550, dur = 900, t0 = performance.now();
    n.textContent = "0";
    const step = (t) => {
      if (!n.isConnected) return;
      const p = Math.min(1, Math.max(0, (t - t0 - delay) / dur)); const e = 1 - Math.pow(1 - p, 3);
      n.textContent = String(Math.round(target * e));
      if (p < 1) requestAnimationFrame(step); else n.textContent = String(target);
    };
    requestAnimationFrame(step);
  });
}

// ----- payroll -----
function viewPayroll() {
  const c = cfg();
  const team = activeTeam();
  if (!team.length) return emptyState("No one on the team yet", "Add employees on the Team tab: their name exactly as it appears in Jira, and their current salary.", "team", "Go to Team");
  const st = status();
  const rs = results();
  const shadow = (c.shadowMonths || []).includes(S.month);
  const tot = rs.reduce((a, r) => ({ cur: a.cur + r.currentPaid, base: a.base + r.basePaid, bonus: a.bonus + r.bonus, extra: a.extra + r.extra, total: a.total + r.total }), { cur: 0, base: 0, bonus: 0, extra: 0, total: 0 });
  const scored = rs.filter((r) => r.score != null);
  const avg = scored.length ? scored.reduce((a, r) => a + r.score, 0) / scored.length : null;
  const todo = [];
  if (!st.tasks) todo.push(`<a href="#" data-action="tab" data-tab="tasks">pull the tasks from Jira</a>`);
  if (!st.hours) todo.push(`<a href="#" data-action="tab" data-tab="hours">enter hours</a> (${st.hrs} of ${st.teamN} done) or turn off hours for this month`);
  if (!st.team) todo.push(`<a href="#" data-action="tab" data-tab="team">add missing salaries</a>`);
  const final = S.monthDoc.final;
  const differs = final ? finalDiffers(final, rs) : false;
  const flow = [
    ["team", "Team", st.team, st.team ? `${st.teamN} ${st.teamN === 1 ? "salary" : "salaries"} set` : "Salary missing"],
    ["tasks", "Jira tasks", st.tasks, st.tasks ? `${S.tasks.length} tasks pulled` : "Not pulled yet"],
    ["hours", "Hours", st.hours, S.monthDoc.skipHours ? "Not counted this month" : `${st.hrs} of ${st.teamN} entered`],
  ];
  const doneN = flow.filter((x) => x[2]).length;
  const maxPct = Math.max(1, ...c.bands.map((b) => Number(b.pct) || 0));
  const normPct = c.bands.find((b) => b.label === "Normal good")?.pct ?? 35;
  return `
  <div class="pagehead">
    <div class="ph-t"><h2>Payroll · ${esc(monthName(S.month))}</h2>
    <p class="sub" style="margin:0">${shadow ? "Shadow month: everyone is paid their current salary. The table shows what the new system would pay." : `<span class="eq"><b>Bonus</b> = <i>Base</i> × <i>Bonus %</i> × <i>Attendance gate</i> × <i>(1 − Ethics deduction)</i></span>`}</p></div>
    <button class="btn" data-action="slips-print">${ICON.print}Payslips (PDF)</button>
    <button class="btn" data-action="export-csv">${ICON.download}Export CSV</button>
    <button class="btn primary" data-action="finalize" ${todo.length ? "disabled title='Finish the steps above first'" : ""}>${ICON.check}${final ? "Save again" : "Save results"}</button>
  </div>
  <div class="card flow">
    <span class="flow-bar" aria-hidden="true"><span style="width:${(doneN + (final && !differs ? 1 : 0)) * 25}%"></span></span>
    <div class="flow-steps">
      ${flow.map(([k, label, ok, sub], i) => `<a href="#" class="fstep ${ok ? "ok" : "todo"}" data-action="tab" data-tab="${k}"><span class="fb">${ok ? ICON.check : i + 1}</span><span class="ft"><b>${label}</b><span class="small">${esc(sub)}</span></span></a>`).join("")}
      <span class="fstep ${final ? (differs ? "warn" : "ok") : "todo"}"><span class="fb">${final && !differs ? ICON.check : 4}</span><span class="ft"><b>Results</b><span class="small">${final ? (differs ? "Changed since saving" : "Saved") : todo.length ? `${doneN} of 3 steps done` : "Ready to save"}</span></span></span>
    </div>
    ${todo.length ? `<div class="flow-note"><span class="grow">To finish this month: ${todo.join(", ")}.</span></div>` : ""}
    ${final ? `<div class="flow-note quiet">Results saved ${esc(new Date(final.savedAt).toLocaleString())}. ${differs ? `<span class="warntext">Numbers changed since then.</span>` : ""}</div>` : ""}
  </div>
  <div class="grid-kpi">
    <div class="card kpi hero"><div class="k">${shadow ? "Would pay (new system)" : "Total pay"}</div><div class="v num">${amd(tot.total)}</div><div class="d">AMD · <i class="lg lg-base"></i>base ${amd(tot.base)} + <i class="lg lg-bonus"></i>bonus ${amd(tot.bonus)}</div>${tot.base + tot.bonus > 0 ? mixBar(tot.base, tot.bonus, tot.extra) : ""}</div>
    <div class="card kpi"><div class="k">Current salaries</div><div class="v num">${amd(tot.cur)}</div><div class="d num">New system: <span class="delta ${tot.total - tot.cur >= 0 ? "pos" : "neg"}">${tot.total - tot.cur >= 0 ? "+" : "−"}${amd(Math.abs(tot.total - tot.cur))}${tot.cur ? ` (${tot.total - tot.cur >= 0 ? "+" : "−"}${Math.abs((tot.total - tot.cur) / tot.cur * 100).toFixed(1)}%)` : ""}</span></div></div>
    <div class="card kpi"><div class="k">Average task score</div><div class="v num">${avg == null ? "—" : avg.toFixed(1)}</div><div class="d">${scored.length} of ${rs.length} people scored</div>${avg == null ? "" : `<div class="meter" aria-hidden="true"><span class="fill" style="width:${clampPct(avg)}%"></span>${c.bands.filter((b) => b.min > 0 && b.min < 100).map((b) => `<i style="left:${b.min}%"></i>`).join("")}</div>`}</div>
    <div class="card kpi"><div class="k">Bonus paid out</div><div class="v num">${tot.base ? pct(tot.bonus / tot.base * 100) : "—"}</div><div class="d">of base (normal good = ${normPct}%)</div>${tot.base ? `<div class="meter" aria-hidden="true"><span class="fill" style="width:${clampPct(tot.bonus / tot.base * 100 / maxPct * 100)}%"></span><i class="mark" style="left:${clampPct(normPct / maxPct * 100)}%"></i></div>` : ""}</div>
  </div>
  <div class="card tablewrap">
  <div class="panel-h"><h3>Pay by employee</h3><span class="tag">${rs.length}</span><span class="spacer"></span><span class="small muted">Click a row for the full payslip</span></div>
  <table>
    <thead><tr><th>Employee</th><th class="n">Score</th><th class="c">Bonus %</th><th class="n hide-sm">Hours</th><th class="c hide-sm">Gate</th><th class="c hide-sm">Ethics</th><th class="n hide-sm">Base</th><th class="n hide-sm">Bonus</th><th class="n hide-sm">Extra</th><th class="n">Total</th>${c.tax.enabled ? `<th class="n hide-sm">Net</th>` : ""}<th class="n hide-sm">vs current</th></tr></thead>
    <tbody>${rs.map((r) => `
      <tr class="click" data-action="slip" data-id="${esc(r.memberId)}">
        <td><div class="who">${avatar(r.name)}<div><b>${esc(r.name)}</b>${r.warnings.length ? ` <span class="warnicon" title="${esc(r.warnings.join("\n"))}">!</span>` : ""}<div class="small muted">${r.tasks.length} task${r.tasks.length === 1 ? "" : "s"}${r.scoreBasis === "pool" ? " · quiet month" : r.scoreBasis === "default" ? " · default" : ""}</div></div></div></td>
        <td class="n">${r.score == null ? "—" : `${r.score.toFixed(1)}<span class="mini ${bandCls(r)}" aria-hidden="true"><span style="width:${clampPct(r.score)}%"></span></span>`}</td>
        <td class="c">${bandTag(r)}</td>
        <td class="n hide-sm">${r.hoursSkipped ? `<span class="muted small">not counted</span>` : r.hoursMissing ? `<span class="tag warn">missing</span>` : `${hrs(r.worked)} / ${hrs(r.requiredHours)}<div class="small muted">${pct(r.attendancePct, 1)}</div><span class="mini ${gateCls(r.gate)}" aria-hidden="true"><span style="width:${clampPct(r.attendancePct)}%"></span></span>`}</td>
        <td class="c hide-sm">${r.hoursMissing ? "—" : gateTag(r.gate)}</td>
        <td class="c hide-sm">${r.ethics.deduction ? `<span class="tag bad">−${r.ethics.deduction}%</span>` : `<span class="muted">0</span>`}</td>
        <td class="n hide-sm">${amd(r.basePaid)}</td>
        <td class="n hide-sm">${amd(r.bonus)}</td>
        <td class="n hide-sm">${r.extra ? `<span class="pos">+${amd(r.extra)}</span>` : `<button class="btn ghost small" data-action="extra-open" data-id="${esc(r.memberId)}" style="padding:2px 8px">+ Add</button>`}</td>
        <td class="n tot"><b>${amd(r.total)}</b></td>
        ${r.tax ? `<td class="n hide-sm">${amd(r.tax.net)}</td>` : ""}
        <td class="n hide-sm ${r.diff >= 0 ? "pos" : "neg"}">${r.diff >= 0 ? "+" : "−"}${amd(Math.abs(r.diff))}</td>
      </tr>`).join("")}</tbody>
    <tfoot><tr><td>Total</td><td></td><td></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="n hide-sm">${amd(tot.base)}</td><td class="n hide-sm">${amd(tot.bonus)}</td><td class="n hide-sm">${amd(tot.extra)}</td><td class="n">${amd(tot.total)}</td>${c.tax.enabled ? `<td class="n hide-sm">${amd(rs.reduce((x, r) => x + (r.tax ? r.tax.net : 0), 0))}</td>` : ""}<td class="n hide-sm ${tot.total - tot.cur >= 0 ? "pos" : "neg"}">${tot.total - tot.cur >= 0 ? "+" : "−"}${amd(Math.abs(tot.total - tot.cur))}</td></tr></tfoot>
  </table></div>
  <p class="small muted">Amounts in AMD. “vs current” compares the new total with today's salary for the same days.</p>`;
}
function finalDiffers(final, rs) {
  if (!final || !final.rows) return false;
  const a = final.rows.map((r) => r.memberId + ":" + r.total).sort().join("|");
  const b = rs.map((r) => r.memberId + ":" + r.total).sort().join("|");
  return a !== b;
}
function bandTag(r) {
  const cls = r.bonusPct >= 48 ? "good" : r.bonusPct >= 35 ? "" : r.bonusPct > 0 ? "warn" : "bad";
  return `<span class="tag ${cls}">${r.bonusPct}%</span>`;
}
function gateTag(g) { return `<span class="tag ${g === 1 ? "good" : g > 0 ? "warn" : "bad"}">${g === 1 ? "1.0" : g}</span>`; }
function emptyState(title, text, tab, btn) { return `<div class="card empty"><span class="empty-ico" aria-hidden="true">${ICON[tab] || ICON.team}</span><h2>${esc(title)}</h2><p>${esc(text)}</p>${tab ? `<button class="btn primary" data-action="tab" data-tab="${tab}">${esc(btn)}</button>` : ""}</div>`; }

// ----- payslip -----
function slipHTML(r, standalone) {
  const c = cfg();
  const basis = r.scoreBasis === "month" ? `Average of ${r.tasksUsed} tasks resolved in ${monthName(r.month)}` : r.scoreBasis === "pool" ? `Quiet month: average of ${r.tasksUsed} tasks from the last ${c.poolMonths} months` : `Not enough tasks yet: default ${c.defaultBonusPct}%`;
  const inc = incidentsFor(r.memberId);
  const rows = r.tasks.map((t) => `<tr><td><b>${esc(t.key)}</b> ${esc(t.summary)}</td><td>${prio(t.priority)}</td><td class="n">${fmtDate(t.due)}</td><td class="n">${fmtDate(t.submittedOn)}</td><td class="c">${t.late == null ? "—" : t.late}</td><td class="c">${t.rejections || 0}${t.reopened ? ` · reopened` : ""}</td><td class="c">${t.timing == null ? "—" : t.timing}</td><td class="c">${t.quality}</td><td class="c"><b class="sc ${scCls(t.score)}">${+t.score.toFixed(1)}</b></td></tr>`).join("");
  return `
  <div class="slip-head">
    ${avatar(r.name)}<div style="flex:1;min-width:0"><div class="small" style="opacity:.75">Glana · Payslip${r.shadow ? " · shadow month (current salary paid)" : ""}</div><h3>${esc(r.name)} · ${esc(monthName(r.month))}</h3></div>
    ${standalone ? "" : `<button class="btn" data-action="slip-print" data-id="${esc(r.memberId)}">${ICON.print}PDF</button><button class="btn" data-action="slip-download" data-id="${esc(r.memberId)}">${ICON.download}Download</button><button class="btn" data-action="slip-close" aria-label="Close">✕</button>`}
  </div>
  <div class="slip-body">
    <div class="steps">
      <div class="step ${bandCls(r) || "mid"}"><div class="k">1 · Task score</div><div class="v num">${r.score == null ? "—" : r.score.toFixed(1)} → ${r.bonusPct}%</div><div class="small muted">${esc(r.band ? r.band.label + " · " : "")}${esc(basis)}</div></div>
      <div class="step ${r.hoursSkipped ? "mid" : r.hoursMissing ? "warn" : gateCls(r.gate)}"><div class="k">2 · Attendance gate</div><div class="v num">${r.hoursMissing ? "hours missing" : (r.gate === 1 ? "1.0" : r.gate)}</div><div class="small muted">${r.hoursSkipped ? "Working hours not counted this month" : r.hoursMissing ? "Enter hours to calculate" : `${hrs(r.worked)} of ${hrs(r.requiredHours)} h (${pct(r.attendancePct, 1)})`}<br>${r.requiredDays} days × ${c.hoursPerDay} h${r.leave ? ` · ${r.leave} leave` : ""}${r.sick ? ` · ${r.sick} sick` : ""}${r.unpaid ? ` · ${r.unpaid} unpaid` : ""}</div></div>
      <div class="step ${r.ethics.deduction ? "bad" : "good"}"><div class="k">3 · Ethics deduction</div><div class="v num">${r.ethics.deduction}%</div><div class="small muted">${r.ethics.minors} minor · ${r.ethics.majors} major · ${r.ethics.criticals} critical</div></div>
    </div>
    <div class="eqn">
      <span class="t"><b class="num">${amd(r.basePaid)}</b><span>Base</span></span><span class="op">×</span>
      <span class="t"><b class="num">${r.bonusPct}%</b><span>Bonus %</span></span><span class="op">×</span>
      <span class="t"><b class="num">${r.hoursMissing ? 0 : r.gate === 1 ? "1.0" : r.gate}</b><span>Attendance gate</span></span><span class="op">×</span>
      <span class="t"><b class="num">1 − ${r.ethics.deduction}%</b><span>Ethics</span></span><span class="op">=</span>
      <span class="t res"><b class="num">${amd(r.bonus)}</b><span>Bonus</span></span>
    </div>
    <table class="receipt">
      <tbody>
        <tr><td>Current salary</td><td class="n">${amd(r.salary)}</td></tr>
        <tr><td>Base salary (${c.basePct}%)${r.prorate < 1 ? ` × ${r.paidDays}/${r.monthDays} days` : ""}</td><td class="n">${amd(r.basePaid)}</td></tr>
        <tr><td>Bonus = ${amd(r.basePaid)} × ${r.bonusPct}% × ${r.hoursMissing ? 0 : r.gate} × (1 − ${r.ethics.deduction}%)</td><td class="n">${amd(r.bonus)}</td></tr>
        ${r.extra ? `<tr><td>Extra from founders${r.extraNote ? `: ${esc(r.extraNote)}` : ""}</td><td class="n pos">+${amd(r.extra)}</td></tr>` : ""}
      </tbody>
      <tfoot><tr><td>Total pay ${r.shadow ? "(would be)" : ""}</td><td class="n">${amd(r.total)} AMD</td></tr></tfoot>
    </table>
    ${r.tax ? `<table class="receipt net">
      <tbody>
        <tr><td>${r.shadow ? "Paid this month (current salary), before tax" : "Total pay before tax"}</td><td class="n">${amd(r.tax.gross)}</td></tr>
        <tr><td>Income tax (${c.tax.incomeTaxPct}%)</td><td class="n neg">−${amd(r.tax.incomeTax)}</td></tr>
        ${c.tax.pension ? `<tr><td>Funded pension</td><td class="n neg">−${amd(r.tax.pension)}</td></tr>` : ""}
        ${c.tax.stampDuty ? `<tr><td>Stamp duty</td><td class="n neg">−${amd(r.tax.stamp)}</td></tr>` : ""}
      </tbody>
      <tfoot><tr><td>Net pay (in hand)</td><td class="n">${amd(r.tax.net)} AMD</td></tr></tfoot>
    </table>` : ""}
    ${r.basePaid + r.bonus > 0 ? `<div class="paymix">${mixBar(r.basePaid, r.bonus, r.extra)}<div class="legend"><span><i class="lg lg-base"></i>Base</span><span><i class="lg lg-bonus"></i>Bonus</span>${r.extra > 0 ? `<span><i class="lg lg-extra"></i>Extra</span>` : ""}</div></div>` : ""}
    ${r.warnings.length ? `<div class="formula">${r.warnings.map(esc).join("<br>")}</div>` : ""}
    ${standalone || !S.canEdit ? "" : `<form class="card pad form" data-form="extra" data-id="${esc(r.memberId)}" style="margin-top:14px;background:var(--surface-2)">
      <div style="grid-column:1/-1"><b>Extra from founders</b> <span class="small muted">An amount on top of the calculated pay, for this month only. Shown on the payslip.</span></div>
      <label class="f">Amount (AMD)<input type="number" name="amount" min="0" step="1000" value="${r.extra || ""}" placeholder="0"></label>
      <label class="f" style="grid-column: span 2">Reason<input type="text" name="note" maxlength="200" value="${esc(r.extraNote)}" placeholder="e.g. Stayed the weekend for the launch"></label>
      <div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">Save extra</button>${r.extra ? `<button class="btn ghost danger" type="button" data-action="extra-clear" data-id="${esc(r.memberId)}">Remove</button>` : ""}</div>
    </form>`}
    <h4 style="margin:18px 0 6px">Tasks resolved in ${esc(monthName(r.month))}</h4>
    ${r.tasks.length ? `<div class="tablewrap"><table><thead><tr><th>Task</th><th>Priority</th><th class="n">Due</th><th class="n">Submitted</th><th class="c">Days late</th><th class="c">Rejections</th><th class="c">Timing</th><th class="c">Quality</th><th class="c">Score</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">No tasks resolved this month.</p>`}
    <h4 style="margin:18px 0 6px">Incidents</h4>
    ${inc.length ? `<table><tbody>${inc.map((i) => `<tr><td class="n" style="width:70px">${fmtDate(i.date)}</td><td><span class="tag ${i.level === "minor" ? "warn" : "bad"}">${esc(i.level)}</span>${i.aiSlop ? ` <span class="tag">AI slop</span>` : ""}</td><td>${esc(i.note)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">None.</p>`}
  </div>`;
}
function openSlip(id) {
  const r = results().find((x) => x.memberId === id); if (!r) return;
  const d = $("#slip"); d.innerHTML = slipHTML(r); if (!d.open) d.showModal();
}

// ----- tasks -----
function viewTasks() {
  const meta = S.monthDoc.jira; const c = cfg();
  const prev = S.jiraPreview;
  const team = activeTeam();
  const pull = S.pull && S.pull.month === S.month ? S.pull : null;
  const running = pull && pull.state === "running";
  const canPull = jiraSource() !== null;
  const pullNote = S.mode === "sample" ? "Not available with sample data."
    : canPull ? (jiraSource() === "mcp" ? "Reads Jira with your Atlassian connection. Nothing in Jira is changed." : `Reads ${esc(S.jiraServer.site || "Jira")} through the Glana server. Nothing in Jira is changed.`)
    : S.jiraServer ? "The server has no Jira token yet (JIRA_EMAIL and JIRA_API_TOKEN). Upload the CSV export below for now."
    : "Direct pull needs the Glana server (npm start). Upload the CSV export below.";
  let html = `<h2>Jira tasks</h2><p class="sub">Pulls the tasks finished in ${esc(monthName(S.month))} on ${esc(c.jiraProjects)}. Each month is scored on its own tasks only. Pull again any time to refresh.</p>`;
  html += `<div class="card pad pullcard"><div class="row"><span class="tile" aria-hidden="true">${ICON.tasks}</span><button class="btn primary" data-action="jira-pull" ${!canPull || running ? "disabled" : ""}>${running ? ICON.spin : ICON.refresh}${running ? `Pulling…` : meta ? "Pull again from Jira" : "Pull from Jira"}</button>
    <span class="small muted">${pullNote}</span></div>
    ${running ? `<div class="loadbar"></div><p class="small muted" style="margin:8px 0 0">Reading Jira… ${pull.count ? pull.count + " tasks found so far" : ""}</p>` : ""}
    ${pull && pull.state === "error" ? `<div class="banner" style="margin-top:12px"><span class="grow">${esc(pull.message)}</span></div>` : ""}
    <details style="margin-top:12px"${canPull ? "" : " open"}><summary class="small muted">Or upload a CSV export instead</summary>
    <p class="small muted">In Jira, open the filter <b>Pay - resolved last 3 months</b> → Export → <b>Export CSV (all fields)</b>.</p>
    <div class="drop" data-drop="jira"><span class="drop-ico" aria-hidden="true">${ICON.upload}</span><p style="margin:0 0 10px"><b>Drop the Jira CSV here</b> or</p><label class="btn">Choose file<input type="file" accept=".csv,text/csv" data-file="jira" hidden></label>
    <details style="margin-top:12px;text-align:left"><summary class="small muted">Or paste the CSV text</summary><textarea id="jiraPaste" data-live="0" placeholder="Issue key,Summary,…"></textarea><button class="btn" data-action="jira-paste" style="margin-top:6px">Check pasted text</button></details></div></details></div>`;
  if (prev) html += columnCheck(prev, true);
  else if (meta && meta.source === "jira") {
    const per = {}; for (const t of S.tasks) { const mo = E.monthOf(t.resolved); if (mo) per[mo] = (per[mo] || 0) + 1; }
    const win = []; for (let k = c.poolMonths - 1; k >= 0; k--) win.push(E.monthAdd(S.month, -k));
    const totalN = win.reduce((a, m) => a + (per[m] || 0), 0), mineN = per[S.month] || 0, maxN = Math.max(1, ...win.map((m) => per[m] || 0));
    html += `<div class="card pad section pullsum" id="pullsum">
      <div class="ps-nums">
        <div class="ps-num"><div class="k">Pulled for the last ${c.poolMonths} months</div><div class="v num" data-count="${totalN}">${totalN}</div><div class="small muted">tasks finished</div></div>
        <div class="ps-arrow" aria-hidden="true"><svg width="34" height="20" viewBox="0 0 34 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10h29M23 3l8 7-8 7"/></svg></div>
        <div class="ps-num hi"><div class="k">Counted for ${esc(monthName(S.month))}</div><div class="v num" data-count="${mineN}">${mineN}</div><div class="small muted">tasks finished this month</div></div>
      </div>
      <div class="ps-bars">${win.map((m, ix) => `<div class="ps-bar ${m === S.month ? "hi" : ""}"><span class="lbl">${esc(monthShort(m))}</span><span class="track"><span class="fill" style="width:${Math.max(per[m] ? 3 : 0, (per[m] || 0) / maxN * 100)}%;animation-delay:${ix * 140}ms"></span></span><span class="n num">${per[m] || 0}</span><span class="tagcol">${m === S.month ? `<span class="tag good">scored</span>` : `<span class="small muted">reserve</span>`}</span></div>`).join("")}</div>
      <p class="small muted" style="margin:10px 0 0">Each month is scored only on its own tasks. The earlier months are a reserve, used only for someone with fewer than ${c.minTasks} tasks this month. Pulled from Jira on ${esc(new Date(meta.uploadedAt).toLocaleString())}.${meta.warnings && meta.warnings.length ? ` <span style="color:var(--warn)">${meta.warnings.map(esc).join(" ")}</span>` : ""}</p></div>`;
  }
  else if (meta) html += `<div class="card pad section"><div class="row"><div><b>${esc(meta.fileName)}</b> <span class="muted small">uploaded ${esc(new Date(meta.uploadedAt).toLocaleString())} · ${meta.rowCount} rows</span></div></div>${columnCheck(meta, false)}</div>`;
  if (!S.tasks.length) return html;
  const un = E.unmatchedAssignees(S.tasks, team, S.month, c);
  if (un.length) html += `<div class="banner info section"><span class="grow"><b>Not on the team, not scored:</b> ${un.map((u) => `${esc(u.name)} (${u.count})`).join(", ")}. If one of these is an employee, add them on the Team tab with this exact Jira name.</span></div>`;
  const rs = results();
  const f = S.filter;
  const list = rs.filter((r) => !f || r.memberId === f);
  html += `<div class="card tablewrap section"><div class="panel-h"><h3>Scored tasks · ${esc(monthName(S.month))}</h3><span class="spacer"></span><select data-action="filter" data-live="0" aria-label="Show tasks for"><option value="">Everyone</option>${rs.map((r) => `<option value="${esc(r.memberId)}" ${f === r.memberId ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div><table><thead><tr><th>Task</th><th class="hide-sm">Assignee</th><th>Priority</th><th class="n">Due</th><th class="n">Submitted</th><th class="c">Late</th><th class="c">Rej.</th><th class="c">Timing</th><th class="c">Quality</th><th class="c">Score</th></tr></thead><tbody>`;
  let n = 0;
  for (const r of list) for (const t of r.tasks) { n++; html += `<tr><td><b>${esc(t.key)}</b> <span class="muted">${esc(t.summary)}</span></td><td class="hide-sm">${esc(r.name)}</td><td>${prio(t.priority)}</td><td class="n">${fmtDate(t.due)}</td><td class="n">${fmtDate(t.submittedOn)}${!t.submitted && t.resolved ? `<span class="muted small" title="No Submitted date; Resolved date used"> *</span>` : ""}</td><td class="c">${t.late == null ? `<span class="muted small">no due</span>` : t.late > 0 ? `<span class="late">${t.late}</span>` : t.late}</td><td class="c">${t.rejections || 0}${t.reopened ? `<div class="small muted">reopened</div>` : ""}</td><td class="c">${t.timing == null ? "—" : t.timing}</td><td class="c">${t.quality}</td><td class="c"><b class="sc ${scCls(t.score)}">${+t.score.toFixed(1)}</b></td></tr>`; }
  if (!n) html += `<tr><td colspan="10" class="empty">No tasks resolved in ${esc(monthName(S.month))} for the team.</td></tr>`;
  html += `</tbody></table></div><p class="small muted">* no Submitted date, so the Resolved date was used. “no due” = scored on quality only. Tasks labelled “${esc(c.excludeLabel)}” and types other than ${esc(c.issueTypes.join(", "))} are skipped.</p>`;
  return html;
}
function columnCheck(p, isPreview) {
  const labels = { key: "Issue key", assignee: "Assignee", resolved: "Resolved", due: "Due date", submitted: "Submitted", rejections: "Rejections", reopened: "Reopened", type: "Issue Type", priority: "Priority", summary: "Summary", status: "Status" };
  const found = new Set(p.found || []);
  const checks = Object.entries(labels).map(([k, l]) => `<div class="check ${found.has(k) ? "ok" : "no"}"><i>${found.has(k) ? "✓" : "✕"}</i>${l}</div>`).join("");
  const missing = p.missing || [];
  let html = `<div class="checks">${checks}</div>`;
  if (p.warnings && p.warnings.length) html += `<p class="small" style="color:var(--warn)">${p.warnings.map(esc).join(" ")}</p>`;
  if (isPreview) {
    const months = {}; for (const t of p.tasks) { const mo = E.monthOf(t.resolved); if (mo) months[mo] = (months[mo] || 0) + 1; }
    const inM = months[S.month] || 0;
    html = `<div class="card pad section"><div class="row"><div><b>${esc(p.fileName || "Pasted text")}</b> <span class="muted small">${p.rowCount} rows · resolved per month: ${Object.keys(months).sort().map((m) => `${monthShort(m)} ${months[m]}`).join(", ") || "none"}</span></div></div>${html}
      ${missing.length ? `<p style="color:var(--bad)"><b>Missing columns:</b> ${missing.map((k) => labels[k]).join(", ")}. Export with <b>all fields</b>, not current fields.</p>` : ""}
      ${!inM ? `<p style="color:var(--warn)">No tasks were resolved in ${esc(monthName(S.month))} in this file. Check the pay month at the top.</p>` : ""}
      <div class="row" style="margin-top:10px"><button class="btn primary" data-action="jira-save" ${missing.includes("key") || missing.includes("assignee") || missing.includes("resolved") ? "disabled" : ""}>Use for ${esc(monthName(S.month))} (${inM} tasks this month)</button><button class="btn ghost" data-action="jira-cancel">Cancel</button></div></div>`;
  } else if (missing.length) html += `<p style="color:var(--bad)" class="small">Missing columns: ${missing.map((k) => labels[k]).join(", ")}. Re-export with all fields.</p>`;
  return html;
}

// ----- hours -----
function viewHours() {
  const team = activeTeam(); const c = cfg();
  if (!team.length) return emptyState("No one on the team yet", "Add employees first.", "team", "Go to Team");
  const hol = E.holidaySet(c.holidays);
  const wd = E.workingDaysInMonth(S.month, hol);
  const hp = S.hoursPreview;
  let html = `<h2>Hours · ${esc(monthName(S.month))}</h2><p class="sub">${wd} working days (weekends and public holidays removed) × ${c.hoursPerDay} h. Leave, sick and unpaid days lower the required hours.</p>`;
  const skip = !!S.monthDoc.skipHours;
  html += `<div class="card pad" style="margin-bottom:12px"><label class="row" style="cursor:pointer;gap:10px"><input type="checkbox" data-action="skip-hours" ${skip ? "checked" : ""}><span><b>Don't count working hours this month</b><br><span class="small muted">Use until the face scanner is installed. Attendance gate = 1.0 for everyone; leave and unpaid days still apply to pay.</span></span></label></div>`;
  html += `<div class="drop card ${skip ? "hide" : ""}" data-drop="hours"><span class="drop-ico" aria-hidden="true">${ICON.upload}</span><p style="margin:0 0 10px"><b>Import the face-scan export</b> (CSV): total hours per person, daily in/out, or one row per scan.</p><label class="btn">Choose file<input type="file" accept=".csv,text/csv" data-file="hours" hidden></label></div>`;
  if (hp) {
    if (hp.error) html += `<div class="banner section"><span class="grow">${esc(hp.error)}</span><button class="btn" data-action="hours-cancel">Close</button></div>`;
    else {
      const rows = [...hp.totals.entries()].map(([name, h]) => { const m = matchMember(name, team); return { name, h, days: hp.days.get(name) || 0, m }; });
      html += `<div class="card pad section"><b>${esc(hp.fileName)}</b> <span class="muted small">read as ${esc(hp.mode)}${hp.skipped ? ` · ${hp.skipped} rows skipped` : ""}</span>
      <div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Name in file</th><th>Team member</th><th class="n">Days</th><th class="n">Hours</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.m ? esc(x.m.name) : `<span class="tag warn">no match</span>`}</td><td class="n">${x.days || "—"}</td><td class="n">${x.h.toFixed(1)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-action="hours-apply" ${rows.some((x) => x.m) ? "" : "disabled"}>Apply ${rows.filter((x) => x.m).length} matched</button><button class="btn ghost" data-action="hours-cancel">Cancel</button></div></div>`;
    }
  }
  html += `<div class="card tablewrap section"><div class="panel-h"><h3>Hours by employee</h3><span class="tag">${team.length}</span><span class="spacer"></span><span class="small muted">Saved as you go</span></div><table><thead><tr><th>Employee</th><th class="n">Worked hours</th><th class="n">Leave days</th><th class="n">Sick days</th><th class="n">Unpaid days</th><th class="n">Required</th><th class="c">Result</th></tr></thead><tbody>`;
  for (const m of team) {
    const h = hoursFor(m.id) || {};
    const r = E.computePerson(m, S.month, { tasks: [], hours: h.worked === "" || h.worked == null ? undefined : h, incidents: [] }, c);
    const req = E.computePerson(m, S.month, { tasks: [], hours: Object.assign({ worked: 0 }, h), incidents: [] }, c).requiredHours;
    const inp = (f) => `<input type="number" step="0.5" min="0" value="${h[f] === "" || h[f] == null ? "" : esc(h[f])}" data-hours="${esc(m.id)}" data-field="${f}" aria-label="${f} ${esc(m.name)}">`;
    html += `<tr><td><div class="who">${avatar(m.name)}<div><b>${esc(m.name)}</b>${m.start && m.start > S.month + "-01" ? `<div class="small muted">from ${fmtDate(m.start)}</div>` : ""}</div></div></td><td class="n">${inp("worked")}</td><td class="n">${inp("leave")}</td><td class="n">${inp("sick")}</td><td class="n">${inp("unpaid")}</td><td class="n">${amd(req)} h</td><td class="c">${skip ? `<span class="muted small">not counted</span>` : r.hoursMissing ? `<span class="muted">—</span>` : `${pct(r.attendancePct, 1)} ${gateTag(r.gate)}<span class="mini ${gateCls(r.gate)}" style="margin-inline:auto" aria-hidden="true"><span style="width:${clampPct(r.attendancePct)}%"></span></span>`}</td></tr>`;
  }
  html += `</tbody></table></div><p class="small muted">Gate: ${c.gates.map((g) => `${g.min}%+ → ${g.gate}`).join(" · ")}. Forgotten scans: a founder corrects the hours here (max 2 per month).</p>`;
  return html;
}
function matchMember(name, team) { const n = E.norm(name); return team.find((m) => [m.name, m.jiraName, m.scanName].filter(Boolean).map(E.norm).includes(n)); }

// ----- incidents -----
function viewIncidents() {
  const team = activeTeam(); const c = cfg();
  if (!team.length) return emptyState("No one on the team yet", "Add employees first.", "team", "Go to Team");
  const name = (id) => (S.team.find((m) => m.id === id) || {}).name || "Former employee";
  const today = new Date().toISOString().slice(0, 10);
  const def = today.slice(0, 7) === S.month ? today : S.month + "-01";
  // AI slop repeat check: previous incidents are only known for months loaded; warn on 2+ in this month
  return `<h2>Incidents · ${esc(monthName(S.month))}</h2><p class="sub">Minor −${c.penalties.minor}% of the bonus each · Major −${c.penalties.major}% each · Critical = no bonus + formal reprimand. Capped at 100%.</p>
  <form class="card pad form" data-form="incident">
    <div class="form-title"><b>Log an incident</b></div>
    <label class="f">Employee<select name="memberId" required>${team.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select></label>
    <label class="f">Date<input type="date" name="date" value="${def}" min="${S.month}-01" max="${S.month}-${String(new Date(+S.month.slice(0,4), +S.month.slice(5,7), 0).getDate()).padStart(2,"0")}" required></label>
    <label class="f">Level<select name="level"><option value="minor">Minor (−${c.penalties.minor}%)</option><option value="major">Major (−${c.penalties.major}%)</option><option value="critical">Critical (no bonus)</option></select></label>
    <label class="f" style="grid-column: span 2">What happened<input type="text" name="note" maxlength="300" placeholder="e.g. Contract summary was unchecked AI output" required></label>
    <label class="check" style="font-size:13px"><input type="checkbox" name="aiSlop"> AI slop</label>
    <button class="btn primary" type="submit">Log incident</button>
  </form>
  <div class="card tablewrap section"><div class="panel-h"><h3>Logged this month</h3><span class="tag">${S.incidents.length}</span></div>${S.incidents.length ? `<table><thead><tr><th>Date</th><th>Employee</th><th>Level</th><th>What happened</th><th></th></tr></thead><tbody>${S.incidents.map((i) => `<tr><td class="num">${fmtDate(i.date)}</td><td><div class="who">${avatar(name(i.memberId))}<span>${esc(name(i.memberId))}</span></div></td><td><span class="tag ${i.level === "minor" ? "warn" : "bad"}">${esc(i.level)}</span>${i.aiSlop ? ` <span class="tag">AI slop</span>` : ""}</td><td>${esc(i.note)}</td><td class="n"><button class="btn ghost danger" data-action="incident-del" data-id="${esc(i.id)}">Delete</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">No incidents this month.</div>`}</div>
  <p class="small muted">A second AI slop within 3 months is critical: log it as Critical.</p>`;
}

// ----- team -----
function viewTeam() {
  const c = cfg(), now = nowMonth(), pay = seesPay();
  const list = S.team.slice().sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  const edit = S.editing ? S.team.find((m) => m.id === S.editing) : null;
  const m = edit || {};
  const hist = edit ? (m.salaryHistory || []).slice().sort((x, y) => (x.from < y.from ? -1 : 1)) : [];
  const canForm = S.canEdit && pay;
  return `<h2>Team</h2><p class="sub">Everyone paid under the system. <b>Jira name</b> must match the Assignee name in Jira exactly.${pay ? ` Base salary = ${c.basePct}% of current salary.` : " Your account doesn't show salaries."}</p>
  ${canForm ? `<form class="card pad form" data-form="member">
    <div class="form-title"><b>${edit ? `Edit ${esc(m.name)}` : "Add an employee"}</b></div>
    <label class="f">Name<input type="text" name="name" value="${esc(m.name || "")}" required maxlength="80"></label>
    <label class="f">Jira name<input type="text" name="jiraName" value="${esc(m.jiraName || "")}" placeholder="same as Name" maxlength="80"></label>
    <label class="f">Face-scan name<input type="text" name="scanName" value="${esc(m.scanName || "")}" placeholder="if different" maxlength="80"></label>
    <label class="f">Role<input type="text" name="role" value="${esc(m.role || "")}" maxlength="60"></label>
    <label class="f">Current salary (AMD)<input type="number" name="salary" min="0" step="1000" value="${esc(edit ? E.salaryFor(m, now) || "" : "")}" required></label>
    ${edit ? `<label class="f">New salary counts from<input type="month" name="salaryFrom" value="${esc(now)}" required><span class="small" style="font-weight:400">Only used if you change the salary. Earlier months keep the old one.</span></label>` : ""}
    <label class="f">Start date<input type="date" name="start" value="${esc(m.start || "")}"></label>
    <label class="f">End date<input type="date" name="end" value="${esc(m.end || "")}"></label>
    <div class="row"><button class="btn primary" type="submit">${edit ? "Save changes" : "Add employee"}</button>${edit ? `<button class="btn ghost" type="button" data-action="member-cancel">Cancel</button>` : ""}</div>
    ${hist.length ? `<div class="salhist" style="grid-column:1/-1"><b>Salary history</b><span class="small muted"> Each month is paid with the salary that was in force then.</span>
      <ol>${hist.map((x, i) => `<li><span class="num"><b>${amd(x.salary)}</b> AMD</span><span class="muted">${i === 0 && x.from <= "2000-01" ? "from the start" : "from " + esc(monthName(x.from))}</span>${i > 0 && Number(hist[i - 1].salary) > 0 ? `<span class="delta ${x.salary >= hist[i - 1].salary ? "pos" : "neg"} small">${x.salary >= hist[i - 1].salary ? "+" : "−"}${Math.abs((x.salary - hist[i - 1].salary) / hist[i - 1].salary * 100).toFixed(1)}%</span>` : ""}${hist.length > 1 ? `<button class="btn ghost danger small" type="button" data-action="salary-del" data-id="${esc(m.id)}" data-from="${esc(x.from)}">Remove</button>` : ""}</li>`).join("")}</ol></div>` : ""}
  </form>` : ""}
  <div class="card tablewrap section"><div class="panel-h"><h3>Employees</h3><span class="tag">${list.length}</span></div>${list.length ? `<table><thead><tr><th>Name</th><th class="hide-sm">Jira name</th><th class="hide-sm">Role</th>${pay ? `<th class="n">Current salary</th><th class="n">Base (${c.basePct}%)</th><th class="n hide-sm">Normal month</th>` : ""}<th></th></tr></thead><tbody>${list.map((x) => {
    const sal = E.salaryFor(x, now); const base = Math.round(sal * c.basePct / 100);
    const next = (x.salaryHistory || []).filter((h) => h.from > now).sort((p, q) => (p.from < q.from ? -1 : 1))[0];
    return `<tr${x.active === false ? ` style="opacity:.55"` : ""}><td><div class="who">${avatar(x.name)}<div><b>${esc(x.name)}</b>${x.end ? `<div class="small muted">until ${fmtDate(x.end)}</div>` : ""}</div></div></td><td class="hide-sm">${esc(x.jiraName || x.name)}</td><td class="hide-sm">${esc(x.role || "")}</td>${pay ? `<td class="n">${sal > 0 ? amd(sal) : `<span class="tag warn">missing</span>`}${next ? `<div class="small muted">${amd(next.salary)} from ${esc(monthShort(next.from))}</div>` : ""}</td><td class="n">${amd(base)}</td><td class="n hide-sm">${amd(base * (1 + (c.defaultBonusPct || 35) / 100))}</td>` : ""}<td class="n" style="white-space:nowrap">${canForm ? `<button class="btn ghost" data-action="member-edit" data-id="${esc(x.id)}">Edit</button><button class="btn ghost" data-action="member-toggle" data-id="${esc(x.id)}">${x.active === false ? "Activate" : "Deactivate"}</button>` : ""}</td></tr>`;
  }).join("")}</tbody></table>` : `<div class="empty">No employees yet.</div>`}</div>`;
}

// ----- settings -----
function viewSettings() {
  const c = cfg();
  const numIn = (path, v, step) => `<input type="number" step="${step || 1}" data-set="${path}" value="${esc(v)}" data-live="0">`;
  const chk = (path, on, label) => `<label class="check"><input type="checkbox" data-set="${path}" ${on ? "checked" : ""}> ${label}</label>`;
  if (!isAdmin()) return `<h2>Settings</h2><p class="sub">Signed in as <b>${esc(S.me.name)}</b> (login <b>${esc(S.me.login)}</b>). The pay rules and people are managed by an admin.</p>${passwordCard()}`;
  if (!S.users && hasPeople()) loadUsers();
  if (!S.backups && S.mode === "server") loadBackups();
  return `<h2>Settings</h2><p class="sub">The rules from the pay document. Change only after both founders agree; every month is recalculated with the current settings.</p>
  <div class="split">
    <div class="card pad"><h3 style="margin-top:0">Score → bonus</h3><table><thead><tr><th>Level</th><th class="n">Score from</th><th class="n">Bonus %</th></tr></thead><tbody>${c.bands.map((b, i) => `<tr><td>${esc(b.label)}</td><td class="n">${numIn(`bands.${i}.min`, b.min, 0.1)}</td><td class="n">${numIn(`bands.${i}.pct`, b.pct)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card pad"><h3 style="margin-top:0">Task points</h3><table><tbody>
      <tr><td>On time or early</td><td class="n">${numIn("timing.onTime", c.timing.onTime)}</td></tr>
      <tr><td>1 working day late</td><td class="n">${numIn("timing.late1", c.timing.late1)}</td></tr>
      <tr><td>2–3 working days late</td><td class="n">${numIn("timing.late2to3", c.timing.late2to3)}</td></tr>
      <tr><td>4+ working days late</td><td class="n">${numIn("timing.late4plus", c.timing.late4plus)}</td></tr>
      <tr><td>Accepted first time</td><td class="n">${numIn("quality.firstTime", c.quality.firstTime)}</td></tr>
      <tr><td>Rejected once</td><td class="n">${numIn("quality.rejectedOnce", c.quality.rejectedOnce)}</td></tr>
      <tr><td>Rejected 2+ / reopened</td><td class="n">${numIn("quality.rejected2plus", c.quality.rejected2plus)}</td></tr>
    </tbody></table></div>
    <div class="card pad"><h3 style="margin-top:0">Pay and attendance</h3><table><tbody>
      <tr><td>Base salary (% of current)</td><td class="n">${numIn("basePct", c.basePct)}</td></tr>
      <tr><td>Hours per day</td><td class="n">${numIn("hoursPerDay", c.hoursPerDay, 0.5)}</td></tr>
      ${c.gates.map((g, i) => `<tr><td>Gate ${g.gate} from (% of required hours)</td><td class="n">${numIn(`gates.${i}.min`, g.min, 0.1)}</td></tr>`).join("")}
      <tr><td>Minor penalty (% of bonus)</td><td class="n">${numIn("penalties.minor", c.penalties.minor)}</td></tr>
      <tr><td>Major penalty (% of bonus)</td><td class="n">${numIn("penalties.major", c.penalties.major)}</td></tr>
    </tbody></table></div>
    <div class="card pad"><h3 style="margin-top:0">Quiet months</h3><table><tbody>
      <tr><td>Minimum tasks in a month</td><td class="n">${numIn("minTasks", c.minTasks)}</td></tr>
      <tr><td>Quiet month: pool the last N months</td><td class="n">${numIn("poolMonths", c.poolMonths)}</td></tr>
      <tr><td>Default bonus % (not enough data)</td><td class="n">${numIn("defaultBonusPct", c.defaultBonusPct)}</td></tr>
    </tbody></table>
    <label class="f" style="margin-top:12px">Jira projects (keys, comma separated)<input type="text" data-set="jiraProjects" value="${esc(c.jiraProjects)}" data-live="0"></label>
    <label class="f" style="margin-top:8px">Skip tasks with label<input type="text" data-set="excludeLabel" value="${esc(c.excludeLabel)}" data-live="0"></label>
    <label class="f" style="margin-top:8px">Scored issue types (comma separated)<input type="text" data-set="issueTypes" value="${esc(c.issueTypes.join(", "))}" data-live="0"></label>
    <label class="f" style="margin-top:8px">Shadow months (YYYY-MM, comma separated)<input type="text" data-set="shadowMonths" value="${esc(c.shadowMonths.join(", "))}" data-live="0"></label>
    </div>
  </div>
  <div class="card pad section"><h3 style="margin-top:0">Public holidays (Armenia)</h3><p class="small muted" style="margin-top:0">One date per line (YYYY-MM-DD). Not counted as working days or late days. Add government-announced extra days off here.</p><textarea data-set="holidays" data-live="0" style="min-height:140px">${esc(c.holidays.join("\n"))}</textarea></div>
  <div class="split section">
    <div class="card pad"><h3 style="margin-top:0">Taxes on payslips</h3><p class="small muted" style="margin-top:0">Off: payslips show total pay only. On: they also show what is withheld and the net pay in hand, using the Armenian rules below. Pay itself is not changed. Check the rates with your accountant.</p>
      ${chk("tax.enabled", c.tax.enabled, "<b>Show taxes and net pay</b>")}
      <table style="margin-top:8px"><tbody>
      <tr><td>Income tax (%)</td><td class="n">${numIn("tax.incomeTaxPct", c.tax.incomeTaxPct, 0.5)}</td></tr>
      <tr><td>${chk("tax.pension", c.tax.pension, "Funded pension")}</td><td class="n small muted">${c.tax.pensionLowPct}% up to ${amd(c.tax.pensionThreshold)}, then ${c.tax.pensionHighPct}% − ${amd(c.tax.pensionHighMinus)}</td></tr>
      <tr><td>Pension: most per month (AMD)</td><td class="n">${numIn("tax.pensionMax", c.tax.pensionMax, 500)}</td></tr>
      <tr><td>${chk("tax.stampDuty", c.tax.stampDuty, "Stamp duty")}</td><td class="n small muted">${c.tax.stampTiers.map((t) => amd(t[1])).join(" / ")} by salary</td></tr>
      </tbody></table></div>
    <div class="card pad"><h3 style="margin-top:0">Payday reminder</h3><p class="small muted" style="margin-top:0">A banner at the top of the page in the days before payday, if the month about to be paid is missing Jira tasks, hours or saved results.</p>
      ${chk("payday.enabled", c.payday.enabled, "<b>Remind before payday</b>")}
      <table style="margin-top:8px"><tbody>
      <tr><td>Payday: day of the following month</td><td class="n">${numIn("payday.day", c.payday.day)}</td></tr>
      <tr><td>Start reminding (days before)</td><td class="n">${numIn("payday.daysBefore", c.payday.daysBefore)}</td></tr>
      </tbody></table></div>
  </div>
  <div class="row section savebar"><button class="btn primary" data-action="settings-save">Save settings</button><button class="btn ghost" data-action="settings-reset">Reset to document defaults</button><span class="small muted">${S.settingsStored ? "Custom settings saved." : "Using the document defaults."}</span></div>
  ${peopleCard()}
  ${passwordCard()}
  ${S.mode === "browser" || S.mode === "server" ? `<div class="card pad section"><h3 style="margin-top:0">Backup</h3><p class="small muted" style="margin-top:0">${S.mode === "server" ? "Everything (team, salaries, months, tasks, incidents, settings) is saved on the Glana server. Download a backup now and then to keep a copy of your own. Restoring replaces the shared data for everyone." : "Everything (team, salaries, months, tasks, incidents, settings) is saved in this browser only. Download a backup regularly, and use it to move the data to another computer. Clearing the browser's site data deletes it."}</p><div class="row"><button class="btn" data-action="backup-download">${ICON.download}Download backup</button><label class="btn">${ICON.upload}Restore from backup<input type="file" accept=".json,application/json" data-file="backup" hidden></label></div>${serverBackups()}</div>` : ""}`;
}

// ----- Settings → People (separate logins; only on the Glana server with the shared database) -----
const PAGE_NAMES = { payroll: "Payroll", tasks: "Jira tasks", hours: "Hours", incidents: "Incidents", team: "Team", analytics: "Analytics" };
const hasPeople = () => S.mode === "server" && isAdmin() && !!(S.jiraServer && S.jiraServer.auth && S.jiraServer.passwordChange);
async function apiCall(method, url, body) {
  let res, data = null;
  try { res = await fetch(url, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw { message: "Couldn't reach the server. Check the connection and try again." }; }
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) throw { message: "Your sign-in expired. Reload the page and sign in again." };
  if (!res.ok) throw { message: (data && data.message) || "The server refused the request." };
  return data;
}
async function loadUsers() {
  if (S.usersLoading) return; S.usersLoading = true;
  try { const d = await apiCall("GET", "api/users"); S.users = d.users; S.ownerLogin = d.owner.login; } catch (e) { S.users = []; S.usersError = e.message; }
  S.usersLoading = false; scheduleRender();
}
async function userAction(body, okMsg) {
  try { const d = await apiCall("POST", "api/users", body); S.users = d.users; S.history = null; toast(okMsg); render(); return true; }
  catch (e) { toast(e.message); return false; }
}
function peopleCard() {
  if (!hasPeople()) return "";
  const list = S.users || [];
  const edit = S.userEditing ? list.find((u) => u.id === S.userEditing) : null;
  const u = edit || { pages: Object.keys(PAGE_NAMES), edit: true };
  const role = (x) => x.admin ? `<span class="tag good">Admin</span>` : x.edit ? `<span class="tag">Can edit</span>` : `<span class="tag warn">View only</span>`;
  return `<div class="card section people"><div class="panel-h"><h3>People</h3><span class="tag">${list.length + 1}</span><span class="spacer"></span><span class="small muted">Everyone signs in with their own login and password</span></div>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Login</th><th>Can</th><th class="hide-sm">Sees</th><th></th></tr></thead><tbody>
    <tr><td><div class="who">${avatar("Owner")}<div><b>Owner</b>${!S.me || S.me.owner ? `<div class="small muted">you</div>` : ""}</div></div></td><td>${esc(S.ownerLogin || (S.jiraServer && S.jiraServer.user) || "glana")} <span class="small muted">or empty</span></td><td><span class="tag good">Admin</span></td><td class="hide-sm small muted">Everything</td><td class="n small muted">Password below</td></tr>
    ${list.map((x) => `<tr${x.locked ? ` class="locked"` : ""}><td><div class="who">${avatar(x.name)}<div><b>${esc(x.name)}</b>${S.me && S.me.id === x.id ? `<div class="small muted">you</div>` : x.locked ? `<div class="small"><span class="tag bad">Locked</span></div>` : ""}</div></div></td><td>${esc(x.login)}</td><td>${role(x)}</td><td class="hide-sm">${x.admin ? `<span class="small muted">Everything</span>` : x.pages.length ? `<div class="chips">${x.pages.map((k) => `<span class="chip">${esc(PAGE_NAMES[k] || k)}</span>`).join("")}</div>` : `<span class="small muted">Nothing yet</span>`}</td>
      <td class="n" style="white-space:nowrap"><button class="btn ghost" data-action="user-edit" data-id="${esc(x.id)}">Edit</button>${S.me && S.me.id === x.id ? "" : `<button class="btn ghost" data-action="user-lock" data-id="${esc(x.id)}">${x.locked ? "Unlock" : "Lock"}</button><button class="btn ghost danger" data-action="user-del" data-id="${esc(x.id)}">Remove</button>`}</td></tr>`).join("")}
  </tbody></table></div>
  ${S.usersError ? `<p class="pad small warntext" style="margin:0">${esc(S.usersError)}</p>` : ""}
  <form class="pad form userform" data-form="user" autocomplete="off">
    <div class="form-title"><b>${edit ? `Edit ${esc(edit.name)}` : "Add a person"}</b></div>
    <label class="f">Name<input type="text" name="name" value="${esc(u.name || "")}" required maxlength="80" autocomplete="off"></label>
    <label class="f">Login<input type="text" name="login" value="${esc(u.login || "")}" required minlength="2" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]+" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
    <label class="f">${edit ? "New password" : "Password"}<input type="text" name="password" ${edit ? `placeholder="leave empty to keep"` : "required"} minlength="8" maxlength="200" autocomplete="off" spellcheck="false"></label>
    <label class="f">Can<select name="role"><option value="view" ${!u.admin && !u.edit ? "selected" : ""}>View only</option><option value="edit" ${!u.admin && u.edit ? "selected" : ""}>View and edit</option><option value="admin" ${u.admin ? "selected" : ""}>Admin: everything, incl. settings and people</option></select></label>
    <fieldset class="perm" style="grid-column:1/-1"><legend>Sees these pages <span class="small muted">(an admin sees everything)</span></legend>
      ${Object.entries(PAGE_NAMES).map(([k, label]) => `<label class="check"><input type="checkbox" name="page_${k}" ${u.admin || (u.pages || []).includes(k) ? "checked" : ""}> ${label}</label>`).join("")}
      <p class="small muted" style="margin:8px 0 0;flex-basis:100%">Without <b>Payroll</b> or <b>Analytics</b>, salaries and pay are never sent to that person's browser.</p>
    </fieldset>
    <div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">${edit ? "Save changes" : "Add person"}</button>${edit ? `<button class="btn ghost" type="button" data-action="user-cancel">Cancel</button>` : ""}<span class="small muted">At least 8 characters for the password. Tell it to the person yourself.</span></div>
  </form></div>`;
}
async function saveUser(form, fd) {
  const role = fd.role;
  const body = { action: S.userEditing ? "update" : "create", id: S.userEditing || undefined, name: fd.name.trim(), login: fd.login.trim(), admin: role === "admin", edit: role !== "view", pages: Object.keys(PAGE_NAMES).filter((k) => fd["page_" + k]) };
  if (fd.password) body.password = fd.password;
  if (await userAction(body, S.userEditing ? "Saved" : `${body.name} can now sign in with the login “${body.login.toLowerCase()}”`)) { S.userEditing = null; render(); }
}
// ----- Settings → Backup: copies kept on the server -----
async function loadBackups() {
  if (S.backupsLoading) return; S.backupsLoading = true;
  try { S.backups = (await apiCall("GET", "api/backups")).backups; } catch (e) { S.backups = []; }
  S.backupsLoading = false; scheduleRender();
}
function serverBackups() {
  if (S.mode !== "server" || !isAdmin()) return "";
  const l = S.backups || [];
  const why = { weekly: "Weekly", manual: "Made by hand", "before restore": "Before a restore" };
  return `<h4 style="margin:18px 0 6px">Automatic backups on the server</h4><p class="small muted" style="margin-top:0">The server keeps a copy by itself: once a week (before the first change of the week) and before every restore. The last 10 are kept.</p>
  ${l.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Why</th><th class="n">Documents</th><th></th></tr></thead><tbody>${l.map((b) => `<tr><td class="num">${esc(new Date(b.at).toLocaleString())}</td><td>${esc(why[b.reason] || b.reason)}</td><td class="n">${b.count}</td><td class="n" style="white-space:nowrap"><button class="btn ghost" data-action="sbackup-download" data-id="${esc(b.id)}">Download</button><button class="btn ghost" data-action="sbackup-restore" data-id="${esc(b.id)}">Restore</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">${S.backups ? "No backups yet. The first one is made with the next change." : "Loading…"}</p>`}
  <div class="row" style="margin-top:10px"><button class="btn" data-action="sbackup-now">Back up now</button></div>`;
}
async function serverBackup(id) {
  const d = await apiCall("GET", "api/backups/get?id=" + encodeURIComponent(id));
  return JSON.stringify(d, null, 1);
}

/** Settings → Password. Only where the site has a sign-in (served by server.js with APP_PASSWORD). */
function passwordCard() {
  const st = S.jiraServer;
  if (!st || !st.auth) return "";
  const head = `<div class="card pad section"><h3 style="margin-top:0">Password</h3>`;
  if (!st.passwordChange) return head + `<p class="small muted" style="margin:0">The website password is <code>APP_PASSWORD</code> on the server. To change it from here, connect the shared database (Vercel: Storage → Upstash for Redis). Until then, change <code>APP_PASSWORD</code> in Vercel and redeploy.</p></div>`;
  const owner = !S.me || S.me.owner;
  const when = st.passwordChangedAt ? `Last changed ${esc(new Date(st.passwordChangedAt).toLocaleString())}.` : owner ? "Still the password set on the server (APP_PASSWORD)." : "";
  return head.replace("Password", owner ? "Owner password" : "Your password") + `<p class="small muted" style="margin-top:0">${owner ? "The password of the owner account (the one that can do everything). Other people sign in with their own login from the People list above." : "Only you use this password."} After a change, your other browsers are signed out; this one stays signed in. ${when}</p>
  <form data-form="password" class="pwform" autocomplete="on">
    <input type="text" name="username" autocomplete="username" value="${esc(st.user || "glana")}" hidden readonly>
    <label class="f">Current password<input type="password" name="current" autocomplete="current-password" required maxlength="200"></label>
    <label class="f">New password<input type="password" name="next" autocomplete="new-password" required minlength="8" maxlength="200"></label>
    <label class="f">Repeat the new password<input type="password" name="again" autocomplete="new-password" required minlength="8" maxlength="200"></label>
    <div class="row"><button class="btn primary" type="submit">Change password</button><span class="small muted">At least 8 characters. A long phrase is best.</span></div>
  </form>
  <p class="small muted" style="margin-bottom:0">${owner ? "Forgot it? Change <code>APP_PASSWORD</code> in Vercel and redeploy: that password works again and replaces the one set here." : "Forgot it? Ask an admin to set a new one for you in Settings → People."}</p></div>`;
}
async function changePassword(form, fd) {
  if (fd.next !== fd.again) return toast("The new passwords don't match.");
  if (fd.next.length < 8) return toast("The new password needs at least 8 characters.");
  if (fd.next === fd.current) return toast("The new password is the same as the current one.");
  const btn = form.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
  try {
    const r = await fetch("api/password", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: fd.current, next: fd.next }) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (out.code === "login_required") return toast("Your sign-in expired. Reload the page and sign in again.");
      return toast(out.message || "Couldn't change the password.");
    }
    form.reset();
    S.jiraServer = Object.assign({}, S.jiraServer, { passwordChangedAt: out.changedAt });
    render();
    toast("Password changed.");
  } catch (e) { toast("Couldn't reach the server. Check the connection and try again."); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}

// ---------------- analytics (read only: every number comes from engine.js, month by month) ----------------
/** Everything stored about every month: Map(month → { doc, incidents, tasks }). null while it is being fetched (inside Claude). */
function monthsStore() {
  let src = null;
  if (S.db && S.db.entries) src = S.db.entries();
  else if (S.an.live) src = S.an.live;
  else { loadLiveMonths(); return null; }
  const out = new Map();
  for (const [k, v] of src) {
    const m = /^months\/(\d{4}-\d{2})(?:\/(incidents|jira)\/(.+))?$/.exec(k); if (!m) continue;
    const o = out.get(m[1]) || { doc: {}, incidents: [], parts: {} }; out.set(m[1], o);
    if (!m[2]) o.doc = v; else if (m[2] === "incidents") o.incidents.push(Object.assign({ id: m[3] }, v)); else o.parts[m[3]] = v;
  }
  for (const o of out.values()) {
    const meta = o.doc.jira; o.tasks = [];
    if (meta) for (let i = 0; i < (meta.parts || 0); i++) { const p = o.parts["p" + i]; if (!p || p.uploadId !== meta.uploadId) { o.tasks = []; break; } o.tasks.push(...(p.tasks || [])); }
  }
  return out;
}
/** Inside Claude the database has no "everything" call: read the months one by one, once per visit to the page. */
async function loadLiveMonths() {
  if (S.an.loading || !S.db) return; S.an.loading = true;
  try {
    const out = []; const q = await S.db.collection("months").get();
    for (const d of q.docs) {
      out.push(["months/" + d.id, d.data()]);
      for (const sub of ["incidents", "jira"]) { const s = await S.db.collection(`months/${d.id}/${sub}`).get(); for (const x of s.docs) out.push([`months/${d.id}/${sub}/${x.id}`, x.data()]); }
    }
    S.an.live = out;
  } catch (e) { S.an.live = []; }
  S.an.loading = false; if (S.tab === "analytics") render();
}
function analyticsData() {
  const store = monthsStore(); if (!store) return null;
  const c = cfg(); const maxPct = Math.max(1, ...c.bands.map((b) => Number(b.pct) || 0));
  const all = [];
  for (const month of [...store.keys()].sort()) {
    const o = store.get(month); const d = o.doc;
    if (!d.jira && !d.final && !Object.keys(d.hours || {}).length) continue; // nothing entered for this month
    const rs = teamFor(month).map((m) => E.computePerson(m, month, { tasks: o.tasks, hours: (d.hours || {})[m.id], incidents: o.incidents.filter((i) => i.memberId === m.id), skipHours: !!d.skipHours, extra: (d.extras || {})[m.id] }, c));
    if (!rs.length) continue;
    const sum = (f) => rs.reduce((a, r) => a + (f(r) || 0), 0);
    const tasks = rs.flatMap((r) => r.tasks);
    const scored = rs.filter((r) => r.score != null), att = rs.filter((r) => r.attendancePct != null);
    const timed = tasks.filter((t) => t.late != null);
    all.push({
      month, rs, people: rs.length, shadow: rs[0].shadow, saved: !!d.final,
      base: sum((r) => r.basePaid), bonus: sum((r) => r.bonus), extra: sum((r) => r.extra), total: sum((r) => r.total), cur: sum((r) => r.currentPaid), net: sum((r) => r.tax && r.tax.net),
      score: scored.length ? scored.reduce((a, r) => a + r.score, 0) / scored.length : null,
      attendance: att.length ? att.reduce((a, r) => a + r.attendancePct, 0) / att.length : null,
      tasks: tasks.length, timed: timed.length,
      late: [timed.filter((t) => t.late <= 0).length, timed.filter((t) => t.late === 1).length, timed.filter((t) => t.late >= 2 && t.late <= 3).length, timed.filter((t) => t.late >= 4).length],
      firstTime: tasks.length ? tasks.filter((t) => !(t.rejections > 0) && !(t.reopened > 0)).length / tasks.length * 100 : null,
      incidents: [o.incidents.filter((i) => i.level === "minor").length, o.incidents.filter((i) => i.level === "major").length, o.incidents.filter((i) => i.level === "critical").length],
      pool: sum((r) => r.basePaid) ? sum((r) => r.bonus) / (sum((r) => r.basePaid) * maxPct / 100) * 100 : null,
    });
  }
  const years = [...new Set(all.map((x) => x.month.slice(0, 4)))].sort();
  if (S.an.range !== "12" && !years.includes(S.an.range)) S.an.range = "12";
  const months = S.an.range === "12" ? all.slice(-12) : all.filter((x) => x.month.startsWith(S.an.range));
  // one line per person over the chosen months
  const ids = [...new Set(months.flatMap((x) => x.rs.map((r) => r.memberId)))];
  const order = S.team.slice().sort((a, b) => a.name.localeCompare(b.name)).map((m) => m.id);
  const people = ids.map((id) => {
    const per = months.map((x) => x.rs.find((r) => r.memberId === id) || null), got = per.filter(Boolean);
    const scores = got.filter((r) => r.score != null).map((r) => r.score), tasks = got.flatMap((r) => r.tasks), timed = tasks.filter((t) => t.late != null);
    const sum = (f) => got.reduce((a, r) => a + (f(r) || 0), 0);
    const ix = order.indexOf(id);
    return {
      id, name: got[got.length - 1].name, per, months: got.length, color: ix >= 0 && ix < 8 ? `var(--c${ix + 1})` : "var(--muted)",
      base: sum((r) => r.basePaid), bonus: sum((r) => r.bonus), extra: sum((r) => r.extra), total: sum((r) => r.total), net: sum((r) => r.tax && r.tax.net),
      score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, gain: scores.length > 1 ? scores[scores.length - 1] - scores[0] : null,
      bonusPct: sum((r) => r.basePaid) ? sum((r) => r.bonus) / sum((r) => r.basePaid) * 100 : null,
      tasks: tasks.length, onTime: timed.length >= 3 ? timed.filter((t) => t.late <= 0).length / timed.length * 100 : null,
      incidents: sum((r) => r.ethics.minors + r.ethics.majors + r.ethics.criticals),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { all, months, years, people, cfg: c, maxPct };
}

// ----- chart pieces (inline SVG, sized to the page; colours and hover follow the same rules everywhere) -----
const fmtK = (n) => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : a >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n)); };
function niceMax(v) { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
const tipAttr = (title, rows) => `data-tip="${esc(`<b>${esc(title)}</b>` + rows.map(([k, v, col]) => `<span class="tr">${col ? `<i style="background:${col}"></i>` : ""}<span>${esc(k)}</span><b class="num">${esc(v)}</b></span>`).join(""))}"`;
/** Plot area, grid and axis labels shared by every chart. */
function frame(w, h, months, max, fmt, pad) {
  pad = Object.assign({ l: 46, r: 10, t: 12, b: 26 }, pad);
  const n = months.length, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, band = iw / Math.max(1, n);
  const sx = (i) => pad.l + band * (i + 0.5), sy = (v) => pad.t + ih - (v / max) * ih;
  const every = Math.ceil(34 / band);
  let g = "";
  for (let i = 0; i <= 4; i++) { const v = max * i / 4, y = sy(v); g += `<line class="grid${i === 0 ? " base" : ""}" x1="${pad.l}" x2="${w - pad.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="ax" x="${pad.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(fmt(v))}</text>`; }
  months.forEach((x, i) => { if ((n - 1 - i) % every) return; const jan = x.month.endsWith("-01") || i === 0; g += `<text class="ax" x="${sx(i).toFixed(1)}" y="${h - 8}" text-anchor="middle">${MONTHN[+x.month.slice(5) - 1].slice(0, 3)}${jan ? " ’" + x.month.slice(2, 4) : ""}</text>`; });
  return { pad, band, ih, sx, sy, grid: g, bottom: pad.t + ih };
}
/** A bar segment with only its outer end rounded. */
function barPath(x, y, w, h, top) {
  x = +x; y = +y; w = +w; h = +h;
  const r = top ? Math.min(4, h, w / 2) : 0;
  const n = (v) => +v.toFixed(1);
  return `M${n(x)},${n(y + h)}V${n(y + r)}${r ? `a${r},${r} 0 0 1 ${r},${-r}` : ""}H${n(x + w - r)}${r ? `a${r},${r} 0 0 1 ${r},${r}` : ""}V${n(y + h)}Z`;
}
/** Stacked bars: parts = [{ key, label, color }], value(month, key). */
function chartStack(w, months, parts, value, opts) {
  opts = opts || {}; const h = opts.h || 250;
  const totals = months.map((x) => parts.reduce((a, p) => a + (value(x, p.key) || 0), 0));
  const max = opts.percent ? 100 : opts.int ? Math.max(4, Math.ceil(Math.max(...totals) / 4) * 4) : niceMax(Math.max(...totals, 1));
  const f = frame(w, h, months, max, opts.percent ? (v) => v + "%" : fmtK);
  const bw = Math.max(6, Math.min(38, f.band * 0.62));
  let g = f.grid;
  months.forEach((x, i) => {
    const tot = totals[i]; let y = f.bottom; const segs = [];
    const live = parts.filter((p) => (value(x, p.key) || 0) > 0);
    live.forEach((p, k) => {
      const v = value(x, p.key), share = opts.percent ? (tot ? v / tot * 100 : 0) : v;
      const hh = Math.max(1, (share / max) * f.ih - (k < live.length - 1 ? 2 : 0));
      y -= (share / max) * f.ih;
      segs.push(`<path class="seg an-grow" style="fill:${p.color};animation-delay:${i * 28}ms" d="${barPath((f.sx(i) - bw / 2).toFixed(1), (y + (k < live.length - 1 ? 2 : 0)).toFixed(1), bw.toFixed(1), hh.toFixed(1), k === live.length - 1)}"/>`);
    });
    const rows = parts.slice().reverse().map((p) => [p.label, opts.percent ? `${value(x, p.key) || 0} (${tot ? Math.round((value(x, p.key) || 0) / tot * 100) : 0}%)` : amd(value(x, p.key) || 0), p.color]);
    rows.push(["Total", opts.percent ? String(tot) : amd(tot)]);
    g += `<g class="col" ${tipAttr(monthName(x.month) + (x.shadow && opts.shadowNote ? " · shadow month" : ""), rows)}><rect class="hit" x="${(f.sx(i) - f.band / 2).toFixed(1)}" y="${f.pad.t}" width="${f.band.toFixed(1)}" height="${f.ih}"/>${segs.join("")}${opts.topLabel && f.band >= 44 && tot ? `<text class="val" x="${f.sx(i).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${esc(fmtK(tot))}</text>` : ""}</g>`;
  });
  return `<svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opts.label || "Chart")}">${g}</svg>`;
}
/** Lines over the months: series = [{ id, name, color, values }] (null = no value that month). */
function chartLines(w, months, series, opts) {
  opts = opts || {}; const h = opts.h || 260;
  const vals = series.flatMap((s) => s.values).filter((v) => v != null);
  const max = opts.max || niceMax(Math.max(...vals, 1));
  const labelled = series.length > 1 && series.length <= 4;
  const f = frame(w, h, months, max, opts.fmt || String, { r: labelled ? 78 : 14 });
  let g = f.grid;
  for (const m of opts.marks || []) g += `<line class="mark" x1="${f.pad.l}" x2="${w - f.pad.r}" y1="${f.sy(m.v).toFixed(1)}" y2="${f.sy(m.v).toFixed(1)}"/><text class="ax" x="${w - f.pad.r}" y="${(f.sy(m.v) + (m.below ? 15 : -6)).toFixed(1)}" text-anchor="end">${esc(m.label)}</text>`;
  const ends = [];
  for (const s of series) {
    const dim = opts.focus && opts.focus !== s.id;
    let d = "", pen = false, last = null, dots = "";
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const x = f.sx(i).toFixed(1), y = f.sy(Math.min(v, max)).toFixed(1);
      d += (pen ? "L" : "M") + x + "," + y; pen = true; last = { x: +x, y: +y };
      dots += `<circle class="dot" cx="${x}" cy="${y}" r="${months.length > 16 ? 2.5 : 4}" style="fill:${s.color}"/>`;
    });
    if (opts.area && series.length === 1 && last) { const first = s.values.findIndex((v) => v != null); g += `<path class="area" style="fill:${s.color}" d="${d}L${last.x},${f.bottom}L${f.sx(first).toFixed(1)},${f.bottom}Z"/>`; }
    g += `<g class="ser${dim ? " dim" : ""}"><path class="line an-draw" pathLength="1" style="stroke:${s.color}" d="${d}"/>${dots}</g>`;
    if (last && labelled) ends.push({ y: last.y, x: last.x, name: s.name, dim });
  }
  ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const e of ends) g += `<text class="endl${e.dim ? " dim" : ""}" x="${e.x + 10}" y="${(e.y + 4).toFixed(1)}">${esc(e.name.length > 10 ? e.name.slice(0, 9) + "…" : e.name)}</text>`;
  months.forEach((x, i) => {
    const rows = series.filter((s) => s.values[i] != null).sort((a, b) => b.values[i] - a.values[i]).map((s) => [s.name, (opts.tipFmt || opts.fmt || String)(s.values[i]), s.color]);
    if (!rows.length) return;
    g += `<g class="col" ${tipAttr(monthName(x.month), rows)}><rect class="hit" x="${(f.sx(i) - f.band / 2).toFixed(1)}" y="${f.pad.t}" width="${f.band.toFixed(1)}" height="${f.ih}"/><line class="xh" x1="${f.sx(i).toFixed(1)}" x2="${f.sx(i).toFixed(1)}" y1="${f.pad.t}" y2="${f.bottom}"/></g>`;
  });
  return `<svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opts.label || "Chart")}">${g}</svg>`;
}
function spark(values, w, h) {
  const v = values.filter((x) => x != null); if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1; let d = "", pen = false, n = values.length, lx = 0, ly = 0;
  values.forEach((x, i) => { if (x == null) { pen = false; return; } lx = 2 + (w - 4) * (n === 1 ? 0.5 : i / (n - 1)); ly = h - 3 - (h - 6) * ((x - lo) / span); d += (pen ? "L" : "M") + lx.toFixed(1) + "," + ly.toFixed(1); pen = true; });
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5"/></svg>`;
}
const legend = (items) => `<div class="lgd">${items.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.label)}</span>`).join("")}</div>`;
function deltaTag(now, prev, unit, digits, goodUp) {
  if (now == null || prev == null) return "";
  const d = unit === "%" ? (prev ? (now - prev) / Math.abs(prev) * 100 : 0) : now - prev;
  if (Math.abs(d) < 0.05) return `<span class="delta">no change</span>`;
  const good = goodUp == null ? "" : (d > 0) === goodUp ? " pos" : " neg";
  return `<span class="delta${good}">${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(digits == null ? 1 : digits)}${unit === "%" ? "%" : unit === "pt" ? " pts" : ""}</span>`;
}

function viewAnalytics() {
  const A = analyticsData();
  if (!A) return `<h2>Analytics</h2><div class="card empty loading"><p>Loading every month…</p></div>`;
  if (!A.all.length) return `<h2>Analytics</h2>` + emptyState("Nothing to chart yet", "Analytics fills in as months get their Jira tasks and hours. Finish a month on the Payroll page first.", canPage("payroll") ? "payroll" : "", "Go to Payroll");
  const ms = A.months, c = A.cfg, last = ms[ms.length - 1], prev = ms[ms.length - 2] || null;
  const W = Math.max(280, ($("#view").clientWidth || 900)), two = W >= 980;
  const full = W - 42, half = two ? Math.floor((W - 20) / 2) - 42 : full;
  const sum = (f) => ms.reduce((a, x) => a + (f(x) || 0), 0);
  const avgOf = (f) => { const v = ms.map(f).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const tot = { base: sum((x) => x.base), bonus: sum((x) => x.bonus), extra: sum((x) => x.extra), total: sum((x) => x.total), cur: sum((x) => x.cur), tasks: sum((x) => x.tasks), timed: sum((x) => x.timed), onTime: sum((x) => x.late[0]), incidents: sum((x) => x.incidents[0] + x.incidents[1] + x.incidents[2]) };
  const span = ms.length === 1 ? monthName(last.month) : `${monthShort(ms[0].month)} – ${monthShort(last.month)}`;
  const vs = prev ? `${MONTHN[+last.month.slice(5) - 1].slice(0, 3)} vs ${MONTHN[+prev.month.slice(5) - 1].slice(0, 3)}` : "";
  const onPct = (x) => (x && x.timed ? x.late[0] / x.timed * 100 : null);
  const kpi = (k, v, d, sp, extra) => `<div class="card kpi an-kpi"><div class="k">${k}</div><div class="v num">${v}</div><div class="d">${d}</div><div class="kf">${extra || ""}<span class="spacer"></span>${sp}</div></div>`;

  // --- per-person chart ---
  const METRICS = { bonusPct: ["Bonus %", (r) => r.bonusPct, (v) => Math.round(v) + "%", A.maxPct], score: ["Task score", (r) => r.score, (v) => (+v.toFixed(1)).toString(), 100], total: ["Total pay", (r) => r.total, fmtK, null], attendance: ["Attendance", (r) => r.attendancePct, (v) => Math.round(v) + "%", null] };
  const M = METRICS[S.an.metric] || METRICS.bonusPct;
  const series = A.people.map((p) => ({ id: p.id, name: p.name, color: p.color, values: p.per.map((r) => (r ? M[1](r) : null)) }));
  const marks = S.an.metric === "score" ? c.bands.filter((b) => b.min > 0 && b.pct === Math.max(...c.bands.map((x) => x.pct))).map((b) => ({ v: b.min, label: b.label + " from " + b.min })) : S.an.metric === "attendance" ? [{ v: 100, label: "Full bonus from 100%" }] : [];

  // --- leaderboard and awards ---
  const ranked = A.people.filter((p) => p.score != null).sort((a, b) => b.score - a.score);
  const best = (list, f) => list.filter((p) => f(p) != null).sort((a, b) => f(b) - f(a))[0];
  const awards = [
    ["Top performer", ranked[0], (p) => `Average score ${p.score.toFixed(1)}`, "🏆"],
    ["Most improved", (() => { const p = best(A.people, (x) => x.gain); return p && p.gain > 0 ? p : null; })(), (p) => `Score up ${p.gain.toFixed(1)} points`, "🚀"],
    ["Most punctual", best(A.people, (x) => x.onTime), (p) => `${Math.round(p.onTime)}% of tasks on time`, "⏱"],
    ["Most tasks finished", (() => { const p = best(A.people, (x) => x.tasks); return p && p.tasks > 0 ? p : null; })(), (p) => `${p.tasks} task${p.tasks === 1 ? "" : "s"}`, "✅"],
  ].filter((a) => a[1]);

  // --- insights in plain words ---
  const ins = [];
  if (prev) { const d = prev.total ? (last.total - prev.total) / prev.total * 100 : 0; ins.push(`Payroll for <b>${esc(monthName(last.month))}</b> is <b>${amd(last.total)}</b> AMD, ${Math.abs(d) < 0.05 ? "the same as" : `${d > 0 ? "up" : "down"} <b>${Math.abs(d).toFixed(1)}%</b> on`} ${esc(MONTHN[+prev.month.slice(5) - 1])}.`); }
  if (tot.base) ins.push(`Bonuses came to <b>${(tot.bonus / tot.base * 100).toFixed(0)}%</b> of base pay over this period (a “normal good” month is ${(c.bands.find((b) => b.label === "Normal good") || { pct: 35 }).pct}%, the most possible is ${A.maxPct}%).`);
  if (tot.cur) { const d = tot.total - tot.cur; ins.push(`Compared with paying everyone their full current salary, the new system ${d >= 0 ? "paid" : "saved"} <b>${amd(Math.abs(d))}</b> AMD ${d >= 0 ? "more" : ""} (${d >= 0 ? "+" : "−"}${Math.abs(d / tot.cur * 100).toFixed(1)}%).`); }
  if (tot.timed) { const worst = ms.filter((x) => x.timed >= 3).sort((a, b) => onPct(a) - onPct(b))[0]; ins.push(`<b>${Math.round(tot.onTime / tot.timed * 100)}%</b> of tasks with a due date were on time${worst && ms.length > 2 && onPct(worst) < 100 ? `; the weakest month was ${esc(monthName(worst.month))} (${Math.round(onPct(worst))}%)` : ""}.`); }
  for (const p of A.people) { const run = p.per.slice(-3); if (run.length === 3 && run.every((r) => r && r.scoreBasis !== "default" && r.bonusPct >= 48)) ins.push(`<b>${esc(p.name)}</b> has earned a Strong or Excellent bonus three months in a row.`); }
  for (const p of A.people) { const run = p.per.slice(-2); if (run.length === 2 && run.every((r) => r && r.scoreBasis !== "default" && r.bonusPct <= 10)) ins.push(`<b>${esc(p.name)}</b> has been at Poor or Fail for two months: worth a conversation.`); }
  if (tot.incidents) { const p = A.people.slice().sort((a, b) => b.incidents - a.incidents)[0]; ins.push(`<b>${tot.incidents}</b> incident${tot.incidents === 1 ? " was" : "s were"} logged${p && p.incidents > 1 ? `, ${p.incidents} of them for ${esc(p.name)}` : ""}.`); }
  const recent = A.all.slice(-3); const fc = recent.reduce((a, x) => a + x.total, 0) / recent.length;
  ins.push(`At the average of the last ${recent.length === 1 ? "month" : recent.length + " months"}, next month's payroll will be about <b>${amd(fc)}</b> AMD.`);

  const heatCols = ms.length;
  return `
  <div class="pagehead">
    <div class="ph-t"><h2>Analytics</h2><p class="sub" style="margin:0">${esc(span)} · ${ms.length} month${ms.length === 1 ? "" : "s"} · every month is recalculated with today's settings${ms.some((x) => x.shadow) ? " · shadow months show what the new system would pay" : ""}</p></div>
    <div class="segc" role="group" aria-label="Period"><button data-action="an-range" data-v="12" aria-pressed="${S.an.range === "12"}">Last 12 months</button>${A.years.map((y) => `<button data-action="an-range" data-v="${y}" aria-pressed="${S.an.range === y}">${y}</button>`).join("")}</div>
    <button class="btn" data-action="an-csv">${ICON.download}Export CSV</button>
  </div>
  <div class="an-kpis">
    ${kpi("Total pay", amd(tot.total), `AMD over ${ms.length} month${ms.length === 1 ? "" : "s"}`, spark(ms.map((x) => x.total), 84, 30), deltaTag(last.total, prev && prev.total, "%"))}
    ${kpi("Average month", amd(tot.total / ms.length), `AMD · ${last.people} ${last.people === 1 ? "person" : "people"} now`, spark(ms.map((x) => x.people), 84, 30), "")}
    ${kpi("Bonuses paid", amd(tot.bonus), tot.base ? `${(tot.bonus / tot.base * 100).toFixed(0)}% of base pay` : "—", spark(ms.map((x) => x.bonus), 84, 30), deltaTag(last.bonus, prev && prev.bonus, "%", 1, true))}
    ${kpi("Average task score", avgOf((x) => x.score) == null ? "—" : avgOf((x) => x.score).toFixed(1), "out of 100", spark(ms.map((x) => x.score), 84, 30), deltaTag(last.score, prev && prev.score, "pt", 1, true))}
    ${kpi("On time", tot.timed ? Math.round(tot.onTime / tot.timed * 100) + "%" : "—", `${tot.onTime} of ${tot.timed} tasks with a due date`, spark(ms.map(onPct), 84, 30), deltaTag(onPct(last), onPct(prev), "pt", 0, true))}
    ${kpi("Tasks finished", String(tot.tasks), `${(tot.tasks / ms.length).toFixed(1)} a month`, spark(ms.map((x) => x.tasks), 84, 30), deltaTag(last.tasks, prev && prev.tasks, "", 0, true))}
  </div>
  ${vs ? `<p class="small muted" style="margin:-8px 0 16px">Arrows compare ${esc(vs)}.</p>` : ""}
  <div class="an-grid">
    <div class="card pad an-wide"><div class="ch-h"><h3>Payroll by month</h3>${legend([{ label: "Base", color: "var(--seg-1)" }, { label: "Bonus", color: "var(--seg-2)" }, { label: "Extra", color: "var(--seg-3)" }])}</div>
      ${chartStack(full, ms, [{ key: "base", label: "Base", color: "var(--seg-1)" }, { key: "bonus", label: "Bonus", color: "var(--seg-2)" }, { key: "extra", label: "Extra", color: "var(--seg-3)" }], (x, k) => x[k], { topLabel: true, shadowNote: true, label: "Payroll by month: base, bonus and extra" })}</div>
    <div class="card pad an-wide"><div class="ch-h"><h3>By person</h3><div class="segc" role="group" aria-label="Measure">${Object.entries(METRICS).map(([k, m]) => `<button data-action="an-metric" data-v="${k}" aria-pressed="${S.an.metric === k}">${m[0]}</button>`).join("")}</div></div>
      <div class="lgd pick">${A.people.map((p) => `<button data-action="an-focus" data-id="${esc(p.id)}" aria-pressed="${S.an.focus === p.id}" class="${S.an.focus && S.an.focus !== p.id ? "dim" : ""}"><i style="background:${p.color}"></i>${esc(p.name)}</button>`).join("")}${S.an.focus ? "" : `<span class="small muted">Click a name to highlight it</span>`}</div>
      ${chartLines(full, ms, series, { max: M[3] ? Math.max(M[3], niceMax(Math.max(...series.flatMap((s) => s.values).filter((v) => v != null), 0))) : null, fmt: M[2], tipFmt: S.an.metric === "total" ? amd : M[2], focus: S.an.focus, marks, label: M[0] + " by person and month" })}</div>
    <div class="card pad"><div class="ch-h"><h3>Were tasks on time?</h3>${legend([{ label: "On time", color: "var(--late-0)" }, { label: "1 day late", color: "var(--late-1)" }, { label: "2–3 days", color: "var(--late-2)" }, { label: "4+ days", color: "var(--late-3)" }])}</div>
      ${tot.timed ? chartStack(half, ms, [{ key: 0, label: "On time", color: "var(--late-0)" }, { key: 1, label: "1 working day late", color: "var(--late-1)" }, { key: 2, label: "2–3 days late", color: "var(--late-2)" }, { key: 3, label: "4+ days late", color: "var(--late-3)" }], (x, k) => x.late[k], { percent: true, h: 220, label: "Share of tasks on time or late, by month" }) : `<p class="muted">No tasks with a due date yet.</p>`}</div>
    <div class="card pad"><div class="ch-h"><h3>Accepted first time</h3><span class="small muted">Share of tasks with no rejection or reopen</span></div>
      ${chartLines(half, ms, [{ id: "q", name: "Accepted first time", color: "var(--c1)", values: ms.map((x) => x.firstTime) }], { max: 100, fmt: (v) => Math.round(v) + "%", area: true, h: 220, label: "Share of tasks accepted first time, by month" })}</div>
    <div class="card pad"><div class="ch-h"><h3>Attendance</h3><span class="small muted">Average hours worked vs required</span></div>
      ${ms.some((x) => x.attendance != null) ? chartLines(half, ms, [{ id: "a", name: "Attendance", color: "var(--c3)", values: ms.map((x) => x.attendance) }], { max: Math.max(120, Math.ceil(Math.max(...ms.map((x) => x.attendance || 0)) / 20) * 20), fmt: (v) => Math.round(v) + "%", area: true, h: 220, marks: [{ v: 100, label: "Full bonus from 100%", below: true }], label: "Average attendance by month" }) : `<p class="muted">No hours counted in these months.</p>`}</div>
    <div class="card pad"><div class="ch-h"><h3>Incidents</h3>${legend([{ label: "Minor", color: "var(--inc-1)" }, { label: "Major", color: "var(--inc-2)" }, { label: "Critical", color: "var(--inc-3)" }])}</div>
      ${tot.incidents ? chartStack(half, ms, [{ key: 0, label: "Minor", color: "var(--inc-1)" }, { key: 1, label: "Major", color: "var(--inc-2)" }, { key: 2, label: "Critical", color: "var(--inc-3)" }], (x, k) => x.incidents[k], { h: 220, int: true, label: "Incidents by month and level" }) : `<div class="quiet-ok"><span aria-hidden="true">✓</span><b>No incidents</b><span class="small muted">Nothing logged in these months.</span></div>`}</div>
    <div class="card pad"><div class="ch-h"><h3>Leaderboard</h3><span class="small muted">Average task score</span></div>
      ${ranked.length ? `<ol class="lb">${ranked.map((p, i) => `<li><span class="rk${i < 3 ? " top" : ""}">${i + 1}</span>${avatar(p.name)}<span class="nm"><b>${esc(p.name)}</b><span class="small muted">${p.tasks} task${p.tasks === 1 ? "" : "s"} · bonus ${p.bonusPct == null ? "—" : p.bonusPct.toFixed(0) + "%"}</span></span><span class="bar"><span style="width:${clampPct(p.score)}%;background:${p.color}"></span></span><b class="num sc2">${p.score.toFixed(1)}</b>${p.gain == null || Math.abs(p.gain) < 0.05 ? `<span class="tr0"></span>` : `<span class="tr0 ${p.gain > 0 ? "pos" : "neg"}" title="First to last month">${p.gain > 0 ? "▲" : "▼"}${Math.abs(p.gain).toFixed(1)}</span>`}</li>`).join("")}</ol>` : `<p class="muted">No scores yet.</p>`}</div>
    <div class="card pad"><div class="ch-h"><h3>Highlights</h3><span class="small muted">${esc(span)}</span></div>
      ${awards.length ? `<div class="awards">${awards.map(([t, p, f, ico]) => `<div class="award"><span class="aw-i" aria-hidden="true">${ico}</span><div><div class="small muted">${t}</div><b>${esc(p.name)}</b><div class="small">${esc(f(p))}</div></div></div>`).join("")}</div>` : ""}
      <ul class="insights">${ins.map((t) => `<li>${t}</li>`).join("")}</ul></div>
    <div class="card pad an-wide"><div class="ch-h"><h3>Score map</h3><div class="lgd"><span class="small muted">Lower</span><span class="ramp" aria-hidden="true">${[15, 35, 55, 75, 95].map((v) => `<i style="background:color-mix(in srgb, var(--c1) ${v}%, var(--surface))"></i>`).join("")}</span><span class="small muted">Higher score</span></div></div>
      <div class="tablewrap"><table class="heat" style="--n:${heatCols}"><thead><tr><th></th>${ms.map((x) => `<th>${MONTHN[+x.month.slice(5) - 1].slice(0, 3)}<span>${x.month.slice(2, 4)}</span></th>`).join("")}<th class="n">Avg</th></tr></thead><tbody>
      ${A.people.map((p) => `<tr><th>${esc(p.name)}</th>${p.per.map((r, i) => { if (!r) return `<td class="na"></td>`; if (r.score == null) return `<td class="na" ${tipAttr(p.name + " · " + monthName(ms[i].month), [["Score", "no tasks"], ["Bonus", r.bonusPct + "%"]])}>·</td>`; const k = Math.max(8, Math.min(100, (r.score - 50) * 2)); return `<td style="background:color-mix(in srgb, var(--c1) ${k.toFixed(0)}%, var(--surface))" class="${k > 52 ? "hi" : ""}" ${tipAttr(p.name + " · " + monthName(ms[i].month), [["Score", r.score.toFixed(1)], ["Bonus", r.bonusPct + "%"], ["Tasks", String(r.tasks.length)], ["Total pay", amd(r.total)]])}>${r.score.toFixed(0)}</td>`; }).join("")}<td class="n"><b>${p.score == null ? "—" : p.score.toFixed(1)}</b></td></tr>`).join("")}
      </tbody></table></div></div>
  </div>
  <div class="card tablewrap section"><div class="panel-h"><h3>Summary by employee</h3><span class="tag">${A.people.length}</span><span class="spacer"></span><span class="small muted">${esc(span)}</span></div>
  <table><thead><tr><th>Employee</th><th class="n">Months</th><th class="n">Avg score</th><th class="n">Bonus %</th><th class="n hide-sm">Base</th><th class="n hide-sm">Bonus</th><th class="n hide-sm">Extra</th><th class="n">Total</th>${c.tax.enabled ? `<th class="n hide-sm">Net</th>` : ""}<th class="hide-sm">Pay by month</th></tr></thead>
  <tbody>${A.people.map((p) => `<tr><td><div class="who">${avatar(p.name)}<b>${esc(p.name)}</b></div></td><td class="n">${p.months}</td><td class="n">${p.score == null ? "—" : p.score.toFixed(1)}</td><td class="n">${p.bonusPct == null ? "—" : p.bonusPct.toFixed(0) + "%"}</td><td class="n hide-sm">${amd(p.base)}</td><td class="n hide-sm">${amd(p.bonus)}</td><td class="n hide-sm">${p.extra ? amd(p.extra) : "—"}</td><td class="n tot"><b>${amd(p.total)}</b></td>${c.tax.enabled ? `<td class="n hide-sm">${amd(p.net)}</td>` : ""}<td class="hide-sm">${spark(p.per.map((r) => (r ? r.total : null)), 110, 26)}</td></tr>`).join("")}</tbody>
  <tfoot><tr><td>Total</td><td></td><td></td><td class="n">${tot.base ? (tot.bonus / tot.base * 100).toFixed(0) + "%" : ""}</td><td class="n hide-sm">${amd(tot.base)}</td><td class="n hide-sm">${amd(tot.bonus)}</td><td class="n hide-sm">${amd(tot.extra)}</td><td class="n">${amd(tot.total)}</td>${c.tax.enabled ? `<td class="n hide-sm">${amd(sum((x) => x.net))}</td>` : ""}<td class="hide-sm"></td></tr></tfoot></table></div>
  <p class="small muted">Amounts in AMD. Hover or tap a chart for the exact numbers.</p>`;
}
function analyticsCSV() {
  const A = analyticsData(); if (!A || !A.months.length) return toast("Nothing to export yet.");
  const rows = [["Month", "Employee", "Salary", "Score", "Bonus %", "Tasks", "Attendance %", "Gate", "Ethics deduction %", "Base paid", "Bonus", "Extra", "Total", "Net pay", "Shadow month"]];
  for (const x of A.months) for (const r of x.rs) rows.push([x.month, r.name, r.salary, r.score == null ? "" : r.score, r.bonusPct, r.tasks.length, r.attendancePct == null ? "" : r.attendancePct.toFixed(1), r.hoursMissing ? "" : r.gate, r.ethics.deduction, r.basePaid, r.bonus, r.extra, r.total, r.tax ? r.tax.net : "", r.shadow ? "yes" : "no"]);
  download(`Glana analytics ${A.months[0].month} to ${A.months[A.months.length - 1].month}.csv`, "﻿" + E.toCSV(rows));
}
// one floating box for every chart's hover text
(function () {
  let tip = null;
  const show = (el, ev) => {
    if (!tip) { tip = document.createElement("div"); tip.className = "tipbox"; tip.setAttribute("role", "status"); document.body.appendChild(tip); }
    if (tip.dataset.for !== el.dataset.tip) { tip.innerHTML = el.dataset.tip; tip.dataset.for = el.dataset.tip; }
    tip.classList.add("on");
    const r = tip.getBoundingClientRect(), pad = 12;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width + pad > window.innerWidth) x = ev.clientX - r.width - 14;
    if (y + r.height + pad > window.innerHeight) y = ev.clientY - r.height - 14;
    tip.style.transform = `translate(${Math.max(pad, x)}px, ${Math.max(pad, y)}px)`;
  };
  const hide = () => { if (tip) tip.classList.remove("on"); };
  document.addEventListener("pointermove", (ev) => { const el = ev.target.closest && ev.target.closest("[data-tip]"); if (el) show(el, ev); else hide(); });
  document.addEventListener("pointerdown", (ev) => { const el = ev.target.closest && ev.target.closest("[data-tip]"); if (el) show(el, ev); else hide(); });
  document.addEventListener("scroll", hide, true);
})();

// ---------------- change history (Glana server only, admins) ----------------
async function loadHistory() {
  if (S.histLoading) return; S.histLoading = true;
  try { S.history = { entries: (await apiCall("GET", "api/history?limit=500")).entries }; } catch (e) { S.history = { entries: [], error: e.message }; }
  S.histLoading = false; if (S.tab === "history") render();
}
const FIELD = { salary: "salary", name: "name", jiraName: "Jira name", scanName: "face-scan name", role: "role", start: "start date", end: "end date", salaryHistory: "salary history", basePct: "base salary %", hoursPerDay: "hours per day", minTasks: "minimum tasks", poolMonths: "months pooled", defaultBonusPct: "default bonus %", holidays: "public holidays", bands: "score → bonus table", gates: "attendance gates", shadowMonths: "shadow months", issueTypes: "issue types", excludeLabel: "skipped label", jiraProjects: "Jira projects", worked: "hours worked", leave: "leave days", sick: "sick days", unpaid: "unpaid days", pages: "pages", edit: "can edit", admin: "admin", login: "login", password: "password", locked: "locked" };
function histVal(v, k) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return /pct|score|hours|worked|leave|sick|unpaid|day|min|months|tasks/i.test(k || "") ? String(v) : amd(v);
  if (Array.isArray(v)) return v.length && v.every((x) => typeof x !== "object") ? v.map((x) => PAGE_NAMES[x] || x).join(", ") : v.length + " entries";
  if (typeof v === "object") return "items" in v ? v.items + " entries" : "changed";
  return String(v);
}
/** One history entry in plain words: [sentence, detail lines]. */
function histText(e) {
  const who = (id) => { const m = S.team.find((x) => x.id === id); return m ? m.name : "someone no longer on the team"; };
  const ch = e.changes || [];
  const line = (c, label) => `<span class="chg"><span>${esc(label || FIELD[c.k.split(".").pop()] || c.k)}</span> <s>${esc(histVal(c.from, c.k))}</s> → <b>${esc(histVal(c.to, c.k))}</b></span>`;
  if (e.kind === "signin") return ["signed in", []];
  if (e.kind === "password") return ["changed their own password", []];
  if (e.kind === "restore") return [`restored a backup (${e.count} documents). Everything was replaced.`, []];
  if (e.kind === "backup") return ["made a backup on the server", []];
  if (e.kind === "user") return [`${e.action === "created" ? "created the account of" : e.action === "removed" ? "removed the account of" : e.action === "locked" ? "locked the account of" : e.action === "unlocked" ? "unlocked the account of" : "changed the account of"} <b>${esc(e.label || e.login)}</b> <span class="muted">(${esc(e.login)})</span>`, ch.filter((c) => c.k !== "locked" || e.action === "changed").map((c) => (c.k === "password" ? `<span class="chg"><span>password</span> <b>set a new one</b></span>` : line(c)))];
  const p = e.path || "";
  if (p.startsWith("team/")) {
    const name = `<b>${esc(e.label || "an employee")}</b>`;
    if (e.op === "create") { const s = ch.find((c) => c.k === "salary"); return [`added ${name} to the team`, s ? [line(s)] : []]; }
    if (e.op === "delete") return [`removed ${name} from the team`, []];
    const act = ch.find((c) => c.k === "active");
    if (act && ch.length === 1) return [`${act.to === false ? "deactivated" : "activated"} ${name}`, []];
    return [`changed ${name}`, ch.filter((c) => c.k !== "active").map((c) => (c.k === "salaryHistory" ? `<span class="chg"><span>salary history</span> <b>${Array.isArray(c.to) ? c.to.map((x) => `${amd(x.salary)} from ${x.from <= "2000-01" ? "the start" : monthShort(x.from)}`).join(", ") : "cleared"}</b></span>` : line(c)))];
  }
  if (p === "config/settings") return ["changed the settings", ch.map((c) => line(c, c.k.startsWith("tax.") ? "tax: " + c.k.slice(4) : c.k.startsWith("payday.") ? "payday reminder: " + c.k.slice(7) : c.k.replace(/^(timing|quality|penalties)\./, "$1: ")))];
  const mm = /^months\/(\d{4}-\d{2})(\/incidents\/)?/.exec(p);
  if (mm && mm[2]) {
    const g = (k) => { const c = ch.find((x) => x.k === k); return c ? (e.op === "delete" ? c.from : c.to) : ""; };
    return [`${e.op === "delete" ? "deleted" : "logged"} a <b>${esc(g("level"))}</b> incident for <b>${esc(who(g("memberId")))}</b> <span class="muted">(${esc(monthName(mm[1]))})</span>`, g("note") ? [`<span class="chg">“${esc(g("note"))}”</span>`] : []];
  }
  if (mm) {
    const month = `<span class="muted">(${esc(monthName(mm[1]))})</span>`, out = [];
    for (const c of ch) {
      const k = c.k.split(".");
      if (k[0] === "hours" && k.length === 3) out.push(line(c, `${who(k[1])}: ${FIELD[k[2]] || k[2]}`));
      else if (k[0] === "extras" && k[2] === "amount") out.push(line(c, `${who(k[1])}: extra from founders`));
      else if (k[0] === "extras" && k[2] === "note") out.push(line(c, `${who(k[1])}: reason for the extra`));
      else if (k[0] === "skipHours") out.push(`<span class="chg"><b>${c.to ? "turned off counting hours" : "turned counting hours back on"}</b></span>`);
      else if (k[0] === "jira") out.push(`<span class="chg"><b>${c.to ? `${c.to.source === "jira" ? "pulled" : "uploaded"} ${c.to.tasks} tasks ${c.to.source === "jira" ? "from Jira" : "from a CSV file"}` : "removed the Jira tasks"}</b></span>`);
      else if (k[0] === "final") out.push(`<span class="chg"><b>saved the results for ${c.to ? c.to.people : 0} people</b></span>`);
      else if (k[0] === "hoursImport") out.push(`<span class="chg"><b>imported hours from ${esc((c.to && c.to.file) || "a file")}</b></span>`);
    }
    if (e.op === "delete") return [`deleted the month ${month}`, []];
    if (!out.length) return [`opened the month ${month}`, []];
    return [`changed ${month}`, out];
  }
  return ["made a change", ch.map((c) => line(c))];
}
function viewHistory() {
  if (!hasHistory()) return `<h2>History</h2>` + emptyState("No history here", "The change history is kept on the Glana server and is shown to admins.", "", "");
  if (!S.history) { loadHistory(); return `<h2>History</h2><div class="card empty loading"><p>Loading the history…</p></div>`; }
  const f = S.histFilter, q = f.q.trim().toLowerCase();
  const names = [...new Set(S.history.entries.map((e) => e.who))].sort();
  const rows = S.history.entries.map((e) => ({ e, t: histText(e) })).filter(({ e, t }) => (!f.who || e.who === f.who) && (f.hide !== "signin" || e.kind !== "signin") && (!q || (e.who + " " + t[0] + " " + t[1].join(" ")).replace(/<[^>]+>/g, "").toLowerCase().includes(q)));
  let day = "", html = "";
  for (const { e, t } of rows) {
    const d = new Date(e.at), key = d.toDateString();
    if (key !== day) { day = key; html += `${html ? "</ol>" : ""}<h4 class="hday">${esc(d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</h4><ol class="hist">`; }
    html += `<li class="k-${esc(e.kind)}">${avatar(e.who)}<div class="hb"><div><b>${esc(e.who)}</b> ${t[0]}</div>${t[1].length ? `<div class="chgs">${t[1].join("")}</div>` : ""}</div><time class="small muted num" datetime="${esc(e.at)}">${esc(d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }))}</time></li>`;
  }
  return `<div class="pagehead"><div class="ph-t"><h2>History</h2><p class="sub" style="margin:0">Who changed what, newest first. The last 2,000 changes are kept; restoring a backup doesn't erase them.</p></div><button class="btn" data-action="history-refresh">${ICON.refresh}Refresh</button></div>
  <div class="card pad form histbar"><label class="f">Person<select data-hist="who"><option value="">Everyone</option>${names.map((n) => `<option ${f.who === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
  <label class="f" style="grid-column:span 2">Search<input type="search" data-hist="q" value="${esc(f.q)}" placeholder="e.g. salary, Ani, incident"></label>
  <label class="check"><input type="checkbox" data-hist="hide" ${f.hide === "signin" ? "checked" : ""}> Hide sign-ins</label></div>
  ${S.history.error ? `<div class="banner"><span class="grow">${esc(S.history.error)}</span></div>` : ""}
  <div class="card pad section">${rows.length ? html + "</ol>" : `<div class="empty">${S.history.entries.length ? "Nothing matches." : "No changes recorded yet."}</div>`}</div>`;
}

// ---------------- actions ----------------
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-action]"); if (!el) return;
  const a = el.dataset.action;
  if (el.tagName === "A") ev.preventDefault();
  if (a === "tab") { S.tab = el.dataset.tab; try { localStorage.setItem("glanaPayTab", S.tab); } catch (e) {} S.editing = null; S.userEditing = null; if (S.tab === "analytics") S.an.live = null; if (S.tab === "history") S.history = null; if (S.tab === "settings") { S.users = null; S.backups = null; } render(); window.scrollTo(0, 0); }
  else if (a === "month-prev" || a === "month-next") { S.month = E.monthAdd(S.month, a === "month-prev" ? -1 : 1); S.filter = ""; if (S.db) subscribeMonth(); render(); }
  else if (a === "extra-open") { ev.stopPropagation(); openSlip(el.dataset.id); const f = $("#slip [name=amount]"); if (f) { f.focus(); f.scrollIntoView({ block: "center" }); } }
  else if (a === "extra-clear") { const id = el.dataset.id; if (await write(async () => { await S.db.doc("months/" + S.month).update({ extras: { [id]: { amount: 0, note: "" } } }); }, "Extra removed")) setTimeout(() => openSlip(id), 60); }
  else if (a === "slip") openSlip(el.dataset.id);
  else if (a === "slip-close") $("#slip").close();
  else if (a === "slip-print") { const r = results().find((x) => x.memberId === el.dataset.id); if (r) printHTML(standaloneSlip(r), `Payslip ${r.name} ${r.month}.html`); }
  else if (a === "slips-print") { const rs = results(); if (rs.length) printHTML(standaloneSlips(rs), `Payslips ${S.month}.html`); }
  else if (a === "slip-download") { const r = results().find((x) => x.memberId === el.dataset.id); if (r) download(`Payslip ${r.name} ${r.month}.html`, standaloneSlip(r)); }
  else if (a === "goto-month") { S.month = el.dataset.month; S.filter = ""; S.tab = canPage("payroll") ? "payroll" : S.tab; if (S.db) subscribeMonth(); render(); }
  else if (a === "export-csv") exportCSV();
  else if (a === "finalize") finalize();
  else if (a === "jira-paste") { const t = $("#jiraPaste").value; if (!t.trim()) return toast("Paste the CSV first."); previewJira(t, "Pasted text"); }
  else if (a === "jira-save") { const p = S.jiraPreview; if (!p) return; if (await saveJira(p, p.fileName)) { S.jiraPreview = null; render(); } }
  else if (a === "jira-pull") pullJira();
  else if (a === "jira-cancel") { S.jiraPreview = null; render(); }
  else if (a === "hours-cancel") { S.hoursPreview = null; render(); }
  else if (a === "hours-apply") applyHours();
  else if (a === "incident-del") { if (await write(() => S.db.doc(`months/${S.month}/incidents/${el.dataset.id}`).delete(), "Incident deleted")) {} }
  else if (a === "member-edit") { S.editing = el.dataset.id; render(); window.scrollTo(0, 0); }
  else if (a === "member-cancel") { S.editing = null; render(); }
  else if (a === "member-toggle") { const m = S.team.find((x) => x.id === el.dataset.id); if (m) await write(() => S.db.doc("team/" + m.id).update({ active: m.active === false })); }
  else if (a === "salary-del") {
    const m = S.team.find((x) => x.id === el.dataset.id); if (!m) return;
    const hist = (m.salaryHistory || []).filter((x) => x.from !== el.dataset.from);
    const body = Object.assign({}, m); delete body.id; delete body.salaryHistory;
    if (hist.length > 1) body.salaryHistory = hist;
    body.salary = hist.length ? E.salaryFor({ salaryHistory: hist }, nowMonth()) : m.salary;
    await write(() => S.db.doc("team/" + m.id).set(body), "Salary history updated");
  }
  else if (a === "settings-save") saveSettings();
  else if (a === "settings-reset") { await write(() => S.db.doc("config/settings").set(clone(E.DEFAULT_SETTINGS)), "Settings reset to the document defaults"); }
  else if (a === "backup-download") backupDownload();
  else if (a === "user-edit") { S.userEditing = el.dataset.id; render(); const f = $(".userform"); if (f) f.scrollIntoView({ block: "center" }); }
  else if (a === "user-cancel") { S.userEditing = null; render(); }
  else if (a === "user-lock") { const u = (S.users || []).find((x) => x.id === el.dataset.id); if (u) await userAction({ action: "update", id: u.id, locked: !u.locked }, u.locked ? `${u.name} can sign in again` : `${u.name} is locked out and signed out`); }
  else if (a === "user-del") { const u = (S.users || []).find((x) => x.id === el.dataset.id); if (u && confirm(`Remove ${u.name}'s account? They are signed out and can't sign in again.`)) await userAction({ action: "delete", id: u.id }, "Account removed"); }
  else if (a === "sbackup-now") { try { S.backups = (await apiCall("POST", "api/backups")).backups; S.history = null; toast("Backup made"); render(); } catch (e) { toast(e.message); } }
  else if (a === "sbackup-download") { try { download(`Glana pay backup ${el.dataset.id.slice(0, 8)}.json`, await serverBackup(el.dataset.id)); } catch (e) { toast(e.message); } }
  else if (a === "sbackup-restore") { try { await restoreBackup(await serverBackup(el.dataset.id)); S.backups = null; S.history = null; render(); } catch (e) { toast(e.message); } }
  else if (a === "history-refresh") { S.history = null; render(); }
  else if (a === "an-range") { S.an.range = el.dataset.v; render(); }
  else if (a === "an-metric") { S.an.metric = el.dataset.v; render(); }
  else if (a === "an-focus") { S.an.focus = S.an.focus === el.dataset.id ? null : el.dataset.id; render(); }
  else if (a === "an-csv") analyticsCSV();
  else if (a === "sample") startSample();
  else if (a === "exit-sample") boot();
});
$("#slip").addEventListener("click", (e) => { if (e.target === $("#slip")) $("#slip").close(); });
document.addEventListener("change", async (ev) => {
  const el = ev.target;
  if (el.dataset.hours) await setHours(el.dataset.hours, el.dataset.field, el.value.trim());
  else if (el.dataset.file) { const f = el.files[0]; if (f) readFile(f, el.dataset.file); el.value = ""; }
  else if (el.dataset.action === "filter") { S.filter = el.value; render(); }
  else if (el.dataset.hist) { S.histFilter[el.dataset.hist] = el.type === "checkbox" ? (el.checked ? "signin" : "") : el.value; render(); }
  else if (el.dataset.action === "skip-hours") { const v = el.checked; el.blur(); await write(async () => { await ensureMonthDoc(); await S.db.doc("months/" + S.month).update({ skipHours: v }); }, v ? "Working hours not counted for " + monthName(S.month) : "Working hours counted again"); render(); }
});
document.addEventListener("submit", async (ev) => {
  const form = ev.target;
  if (form.id === "logoutForm") return; // a normal form post to /logout: the server clears the cookie
  ev.preventDefault();
  const fd = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.form === "password") return changePassword(form, fd);
  if (form.dataset.form === "user") return saveUser(form, fd);
  if (form.dataset.form === "incident") {
    const doc = { memberId: fd.memberId, date: fd.date, level: fd.level, note: fd.note.trim(), aiSlop: !!fd.aiSlop, createdAt: new Date().toISOString() };
    if (!doc.note) return toast("Describe what happened.");
    if (await write(async () => { await ensureMonthDoc(); await S.db.collection(`months/${S.month}/incidents`).doc().set(doc); }, "Incident logged")) form.reset();
  } else if (form.dataset.form === "extra") {
    const id = form.dataset.id; const amount = Math.round(Number(fd.amount || 0));
    if (!isFinite(amount) || amount < 0) return toast("Enter a positive amount.");
    if (await write(async () => { await ensureMonthDoc(); await S.db.doc("months/" + S.month).update({ extras: { [id]: { amount, note: (fd.note || "").trim(), at: new Date().toISOString() } } }); }, amount ? "Extra saved" : "Extra removed")) setTimeout(() => openSlip(id), 60);
  } else if (form.dataset.form === "member") {
    const salary = Number(fd.salary);
    if (!fd.name.trim()) return toast("Enter a name.");
    if (!(salary > 0)) return toast("Enter the current salary.");
    const body = { name: fd.name.trim(), jiraName: fd.jiraName.trim() || fd.name.trim(), scanName: fd.scanName.trim(), role: fd.role.trim(), salary, start: fd.start || "", end: fd.end || "", active: true };
    const id = S.editing || rid();
    const prev = S.team.find((m) => m.id === id);
    if (prev && prev.active === false) body.active = false;
    if (prev) {
      // A changed salary is a new line in the salary history, counted from the chosen month. Earlier months keep theirs.
      let hist = (prev.salaryHistory || []).slice();
      const from = /^\d{4}-\d{2}$/.test(fd.salaryFrom || "") ? fd.salaryFrom : nowMonth();
      if (salary !== E.salaryFor(prev, from)) {
        if (!hist.length && Number(prev.salary) > 0) hist.push({ from: "2000-01", salary: Number(prev.salary) });
        hist = hist.filter((x) => x.from !== from); hist.push({ from, salary });
        hist.sort((x, y) => (x.from < y.from ? -1 : 1));
      }
      if (hist.length) { body.salaryHistory = hist; body.salary = E.salaryFor({ salaryHistory: hist }, nowMonth()); }
    }
    if (await write(() => S.db.doc("team/" + id).set(body), S.editing ? "Saved" : "Employee added")) { S.editing = null; render(); }
  }
});

function readFile(file, kind) {
  const r = new FileReader();
  r.onload = () => { if (kind === "jira") previewJira(r.result, file.name); else if (kind === "backup") restoreBackup(r.result); else previewHours(r.result, file.name); };
  r.readAsText(file);
}
function bindDrops() {
  document.querySelectorAll("[data-drop]").forEach((z) => {
    z.addEventListener("dragover", (e) => { e.preventDefault(); z.classList.add("over"); });
    z.addEventListener("dragleave", () => z.classList.remove("over"));
    z.addEventListener("drop", (e) => { e.preventDefault(); z.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) readFile(f, z.dataset.drop); });
  });
}
function previewJira(text, fileName) {
  const p = E.parseJiraExport(text);
  if (!p.rowCount) { toast("No rows found in this file."); return; }
  p.fileName = fileName; S.jiraPreview = p; render();
}
function previewHours(text, fileName) {
  const p = E.parseHoursFile(text, S.month); p.fileName = fileName; S.hoursPreview = p; render();
}
async function applyHours() {
  const hp = S.hoursPreview; if (!hp || hp.error) return;
  const team = activeTeam(); const patch = {};
  for (const [name, h] of hp.totals) { const m = matchMember(name, team); if (m) patch[m.id] = { worked: Math.round(h * 10) / 10 }; }
  if (await write(async () => { await ensureMonthDoc(); await S.db.doc("months/" + S.month).update({ hours: patch, hoursImport: { fileName: hp.fileName, at: new Date().toISOString() } }); }, `Hours applied for ${Object.keys(patch).length} people`)) { S.hoursPreview = null; render(); }
}
async function saveSettings() {
  const c = cfg();
  for (const el of document.querySelectorAll("[data-set]")) {
    const path = el.dataset.set.split("."); let v = el.value;
    if (el.type === "checkbox") v = el.checked;
    else if (path[0] === "holidays") { v = v.split(/[\s,]+/).map((x) => E.parseDate(x)).filter(Boolean).sort(); }
    else if (path[0] === "issueTypes" || path[0] === "shadowMonths") { v = v.split(",").map((x) => x.trim()).filter(Boolean); }
    else if (path[0] === "excludeLabel") v = v.trim();
    else if (path[0] === "jiraProjects") { v = v.split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z][A-Z0-9_]*$/.test(x)).join(", "); if (!v) return toast("Enter at least one Jira project key."); }
    else { v = Number(v); if (!isFinite(v)) return toast("Check the numbers: one is not valid."); }
    let o = c; for (let i = 0; i < path.length - 1; i++) o = o[path[i]]; o[path[path.length - 1]] = v;
  }
  c.bands.sort((a, b) => b.min - a.min); c.gates.sort((a, b) => b.min - a.min);
  await write(() => S.db.doc("config/settings").set(c), "Settings saved");
}
async function finalize() {
  const rs = results();
  const rows = rs.map((r) => ({ memberId: r.memberId, name: r.name, salary: r.salary, score: r.score, scoreBasis: r.scoreBasis, tasks: r.tasks.length, bonusPct: r.bonusPct, worked: r.worked, requiredHours: r.requiredHours, gate: r.gate, deduction: r.ethics.deduction, basePaid: r.basePaid, bonus: r.bonus, extra: r.extra, extraNote: r.extraNote, total: r.total, currentPaid: r.currentPaid, shadow: r.shadow }));
  await write(async () => { await ensureMonthDoc(); await S.db.doc("months/" + S.month).update({ final: { savedAt: new Date().toISOString(), rows } }); }, "Results saved for " + monthName(S.month));
}
function exportCSV() {
  const rs = results();
  const rows = [["Month", "Employee", "Current salary", "Base paid", "Tasks", "Score", "Score basis", "Bonus %", "Worked h", "Required h", "Attendance %", "Gate", "Ethics deduction %", "Bonus", "Extra from founders", "Extra reason", "Total", "Difference vs current", "Shadow month", "Notes"].concat(cfg().tax.enabled ? ["Income tax", "Pension", "Stamp duty", "Net pay"] : [])];
  for (const r of rs) rows.push([r.month, r.name, r.salary, r.basePaid, r.tasks.length, r.score == null ? "" : r.score, r.scoreBasis, r.bonusPct, r.worked == null ? "" : r.worked, r.requiredHours, r.attendancePct == null ? "" : r.attendancePct.toFixed(1), r.hoursMissing ? "" : r.gate, r.ethics.deduction, r.bonus, r.extra, r.extraNote, r.total, r.diff, r.shadow ? "yes" : "no", r.warnings.join("; ")].concat(r.tax ? [r.tax.incomeTax, r.tax.pension, r.tax.stamp, r.tax.net] : []));
  download(`Glana payroll ${S.month}.csv`, "﻿" + E.toCSV(rows));
}
function backupDownload() {
  if (!S.db || !S.db.exportAll) return toast("Backup is only available for data saved in this browser.");
  const data = { app: "glana-pay", version: 1, exportedAt: new Date().toISOString(), docs: S.db.exportAll() };
  download(`Glana pay backup ${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1));
}
async function restoreBackup(text) {
  if ((S.mode !== "browser" && S.mode !== "server") || !S.db.importAll) return toast("Restore works only for data saved in this browser or on the Glana server.");
  let data; try { data = JSON.parse(text); } catch (e) { return toast("This file is not a Glana pay backup."); }
  if (!data || data.app !== "glana-pay" || !data.docs || typeof data.docs !== "object") return toast("This file is not a Glana pay backup.");
  const n = Object.keys(data.docs).filter((k) => k.startsWith("team/")).length;
  if (!confirm(`Replace all ${S.mode === "server" ? "shared data (for everyone)" : "data in this browser"} with the backup from ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : "an unknown date"} (${n} employees)? This cannot be undone.`)) return;
  if (await write(() => S.db.importAll(data.docs), "Backup restored")) { S.editing = null; subscribeAll(); render(); }
}
function slipPage(title, sheets) {
  const css = [...document.querySelectorAll("style")].map((x) => x.textContent).join("\n");
  return `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css} body{background:var(--bg)} .sheet{max-width:860px;margin:24px auto;background:var(--surface);border-radius:16px;overflow:hidden;border:1px solid var(--line)}
  @media print { @page { margin: 12mm; } body{background:#fff} .sheet{max-width:none;margin:0;border:0;border-radius:0;break-after:page} .sheet:last-child{break-after:auto} *{-webkit-print-color-adjust:exact;print-color-adjust:exact} }</style></head><body>${sheets.map((h) => `<div class="sheet">${h}</div>`).join("")}</body></html>`;
}
function standaloneSlip(r) { return slipPage(`Payslip ${r.name} ${r.month}`, [slipHTML(r, true)]); }
function standaloneSlips(rs) { return slipPage(`Payslips ${monthName(rs[0].month)}`, rs.map((r) => slipHTML(r, true))); }
/** Open the browser's print window for a page ("Save as PDF" there makes the PDF). Falls back to a download. */
function printHTML(html, fallbackName) {
  try {
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { download(fallbackName, html); } setTimeout(() => f.remove(), 60000); }, 250); };
    f.srcdoc = html; document.body.appendChild(f);
    toast("Choose “Save as PDF” in the print window.");
  } catch (e) { download(fallbackName, html); }
}
async function download(filename, data) {
  if (S.downloads) {
    try { await S.downloads.save({ filename, data }); toast("Saved " + filename); return; }
    catch (e) { if (e && e.code === "declined") return; if (e && e.code === "rate_limited") return toast("A save prompt is already open."); }
  }
  try { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: filename.endsWith(".csv") ? "text/csv" : filename.endsWith(".json") ? "application/json" : "text/html" })); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }
  catch (e) { toast("Download is not available here."); }
}


// ---------------- pull from Jira (Atlassian connector) ----------------
const JIRA_SERVER = "Atlassian MCP";
const JIRA_TOOL = "searchJiraIssuesUsingJql";
function pullError(e) {
  const code = (e && e.code) || "unknown";
  const msg = {
    server_not_connected: "The Atlassian connector isn't connected. Add it in claude.ai Settings → Connectors, then try again.",
    needs_reauth: "Your Atlassian sign-in expired. Reconnect Atlassian in claude.ai Settings → Connectors.",
    not_in_manifest: "Jira access is turned off for this page. Allow Atlassian in the page's Permissions menu, then try again.",
    approval_required: "Claude needs your approval to read Jira. Click Pull from Jira again and choose Allow.",
    blocked_by_policy: "Your organization's policy blocks this Jira tool.",
    selection_required: "You have more than one Atlassian connector. Choose one when Claude asks, then try again.",
    server_unavailable: "Jira didn't answer in time. Try again in a minute.",
    bad_shape: "Jira answered in a format the calculator didn't expect. A sample was saved for Claude to check. Use the CSV upload for now.",
    tool_error: "Jira refused the search: " + ((e && e.message) || "unknown error"),
    jira_auth: "Jira refused the server's e-mail / API token. Check JIRA_EMAIL and JIRA_API_TOKEN on the server, then restart it.",
    not_configured: "The server has no Jira token yet. Set JIRA_EMAIL and JIRA_API_TOKEN, then restart it.",
    login_required: "Your sign-in to this site expired. Reload the page and sign in again.",
    bad_request: "The server refused the request: " + ((e && e.message) || "unknown error"),
  }[code];
  return msg || `Couldn't pull from Jira (${code}). You can upload a CSV export instead.`;
}
/** Where Jira is read from: the Atlassian connector inside Claude, the Glana server on the website, or nowhere. */
function jiraSource() {
  if (S.mode === "sample" || S.mode === "loading") return null;
  if (S.mcp && S.mode === "live") return "mcp";
  if (S.jiraServer && S.jiraServer.jira) return "server";
  return null;
}
/** One page from the Glana server (server.js builds the JQL and holds the token). */
async function serverSearch(input, range) {
  const body = { from: range[0], to: range[1], projects: cfg().jiraProjects, issueTypes: cfg().issueTypes, maxResults: input.maxResults };
  if (input.nextPageToken) body.nextPageToken = input.nextPageToken;
  let res, data = null;
  try { res = await fetch("api/jira/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }); }
  catch (e) { throw { code: "server_unavailable", retryable: true }; }
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) throw { code: "login_required" };
  if (!res.ok) throw { code: (data && data.code) || "server_unavailable", message: data && data.message, retryable: res.status === 503 || res.status === 504, retryAfterMs: data && data.retryAfterMs };
  return data;
}
async function callJira(input, range) {
  const once = () => (jiraSource() === "server" ? serverSearch(input, range) : S.mcp.callTool(JIRA_SERVER, JIRA_TOOL, input, { cache: false }));
  try { return await once(); }
  catch (e) {
    if (e && e.retryable) { await new Promise((r) => setTimeout(r, Math.max(800, e.retryAfterMs || 0) + Math.random() * 700)); return await once(); }
    throw e;
  }
}
function parseLoose(str) {
  if (typeof str !== "string") return null;
  try { return JSON.parse(str); } catch (e) {}
  const i = str.indexOf("{"), j = str.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(str.slice(i, j + 1)); } catch (e) {} }
  return null;
}
/** Find the object holding the issues array anywhere in a connector reply (payload, structuredContent, text blocks, nested data/result wrappers). */
function findIssues(node, depth) {
  depth = depth || 0;
  if (node == null || depth > 7) return null;
  if (typeof node === "string") return findIssues(parseLoose(node), depth + 1);
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === "object" && "key" in x && "fields" in x)) return { issues: node, isLast: true };
    for (const x of node) { const r = findIssues(x, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof node !== "object") return null;
  if (Array.isArray(node.issues)) return node;
  // Newer Atlassian connector replies: { issues: { nodes: [...], pageInfo: { hasNextPage, endCursor } } }
  const conn = node.issues && typeof node.issues === "object" && Array.isArray(node.issues.nodes) ? node.issues : Array.isArray(node.nodes) && node.pageInfo ? node : null;
  if (conn) { const pi = conn.pageInfo || {}; return { issues: conn.nodes, isLast: pi.hasNextPage !== true, nextPageToken: pi.hasNextPage === true && typeof pi.endCursor === "string" ? pi.endCursor : null }; }
  for (const k of ["payload", "structuredContent", "data", "result", "content", "text", "json", "response", "body"]) {
    if (k in node) { const r = findIssues(node[k], depth + 1); if (r) return r; }
  }
  for (const k of Object.keys(node)) { const r = findIssues(node[k], depth + 1); if (r) return r; }
  return null;
}
async function saveDebug(res, input) {
  try {
    let raw; try { raw = JSON.stringify(res); } catch (e) { raw = String(res); }
    await S.db.doc("debug/lastPull").set({ at: new Date().toISOString(), jql: input.jql, keys: res && typeof res === "object" ? Object.keys(res) : typeof res, sample: String(raw).slice(0, 6000) });
  } catch (e) {}
}
async function pullJira() {
  if (!jiraSource()) return toast("Pulling from Jira needs the Atlassian connection in Claude or the Glana server. Upload a CSV instead.");
  if (S.pull && S.pull.state === "running") return;
  const c = cfg(); const month = S.month;
  S.pull = { state: "running", count: 0, month }; render();
  const byKey = new Map(); const queue = E.jiraRanges(month, c); const truncated = []; let calls = 0;
  const findToken = (node, depth) => {
    depth = depth || 0; if (node == null || depth > 7) return null;
    if (typeof node === "string") { return node.includes("nextPageToken") ? findToken(parseLoose(node), depth + 1) : null; }
    if (typeof node !== "object") return null;
    if (!Array.isArray(node) && typeof node.nextPageToken === "string" && node.nextPageToken) return node.nextPageToken;
    for (const k of Object.keys(node)) { if (k === "issues") continue; const r = findToken(node[k], depth + 1); if (r) return r; }
    return null;
  };
  try {
    while (queue.length) {
      const [from, to] = queue.shift();
      const jql = E.jiraJql(month, c, from, to);
      let token = null, lastLen = 0, lastRes = null, lastInput = null;
      do {
        if (++calls > 120) throw { code: "server_unavailable" };
        const input = { cloudId: c.jiraSite, jql, fields: E.JIRA_FIELDS, maxResults: S.pageSize, view: "full" };
        if (token) input.nextPageToken = token;
        const res = await callJira(input, [from, to]);
        const d = findIssues(res);
        if (!d) { await saveDebug(res, input); throw { code: "bad_shape" }; }
        for (const it of d.issues) if (it && it.key) byKey.set(it.key, it);
        lastLen = d.issues.length; lastRes = res; lastInput = input;
        const next = d.isLast === true ? null : (d.nextPageToken || findToken(res));
        token = next && next !== token ? next : null;
        S.pull.count = byKey.size; render();
      } while (token);
      // A full page with no "next page" marker may be cut off: split the dates and ask again.
      if (lastLen >= S.pageSize) {
        const halves = E.splitRange(from, to);
        if (halves) queue.unshift(...halves); else { truncated.push(from); await saveDebug(lastRes, lastInput); }
      }
    }
  } catch (e) { S.pull = { state: "error", message: pullError(e), month }; render(); return; }
  const issues = [...byKey.values()];
  if (S.month !== month) { S.pull = null; return; }
  const tasks = issues.map(E.taskFromJiraApi).filter((t) => t.key);
  tasks.sort((x, y) => (x.resolved || "").localeCompare(y.resolved || "") || x.key.localeCompare(y.key, undefined, { numeric: true }));
  const parsed = { tasks, rowCount: tasks.length, found: ["key", "summary", "type", "status", "priority", "assignee", "resolved", "due", "submitted", "started", "rejections", "reopened"], missing: [], warnings: truncated.length ? [`More than ${S.pageSize} tasks were resolved on ${truncated.join(", ")}; some may be missing.`] : [] };
  const ok = await saveJira(parsed, "Pulled from Jira", "jira");
  if (ok) S.animatePull = true;
  S.pull = ok ? { state: "done", count: tasks.length, month } : { state: "error", message: "Pulled the tasks but couldn't save them. Try again.", month };
  render();
}

// ---------------- sample data ----------------
function startSample() {
  const db = MemDB();
  const HDR = ["Summary", "Issue key", "Issue id", "Issue Type", "Status", "Priority", "Assignee", "Created", "Resolved", "Due date", "Labels", "Labels", "Custom field (Rejections)", "Custom field (Reopened)", "Custom field (Started)", "Custom field (Submitted)"];
  const T = (key, who, summary, pri, due, sub, res, rej, reo, type, labels) => [summary, key, "1", type || "Task", "Done", pri, who, "02/Nov/26 10:00 AM", res, due, (labels || "").split("|")[0] || "", (labels || "").split("|")[1] || "", String(rej || 0), String(reo || 0), "", sub];
  const A = "Ani Example", D = "Davit Example", L = "Lilit Example";
  const rows = [
    T("PRJ-101", A, "Competitor research, Georgia", "Medium", "13/Nov/26 12:00 AM", "12/Nov/26 4:10 PM", "13/Nov/26 11:00 AM"),
    T("PRJ-102", A, "Venue onboarding plan", "High", "10/Nov/26 12:00 AM", "11/Nov/26 6:30 PM", "12/Nov/26 9:00 AM"),
    T("PRJ-103", A, "Weekly sprint report", "Highest", "06/Nov/26 12:00 AM", "06/Nov/26 5:00 PM", "06/Nov/26 6:00 PM"),
    T("PRJ-104", A, "Partner contract summary", "Medium", "18/Nov/26 12:00 AM", "17/Nov/26 1:00 PM", "19/Nov/26 1:00 PM", 1),
    T("PRJ-105", A, "Loyalty feature spec", "Low", "27/Nov/26 12:00 AM", "26/Nov/26 1:00 PM", "27/Nov/26 1:00 PM"),
    T("GOD-106", A, "Bug triage, POS app", "High", "05/Nov/26 12:00 AM", "05/Nov/26 1:00 PM", "05/Nov/26 3:00 PM", 0, 0, "Bug"),
    T("PRJ-107", A, "Investor update draft", "High", "19/Nov/26 12:00 AM", "23/Nov/26 10:00 AM", "25/Nov/26 10:00 AM", 1),
    T("AWE-108", A, "Hiring post, ops role", "Medium", "30/Nov/26 12:00 AM", "30/Nov/26 9:00 AM", "30/Nov/26 7:00 PM"),
    T("GOD-201", D, "Menu sync API", "Medium", "16/Nov/26 12:00 AM", "13/Nov/26 3:00 PM", "16/Nov/26 10:00 AM"),
    T("GOD-202", D, "Fix order totals rounding", "Highest", "10/Nov/26 12:00 AM", "10/Nov/26 4:00 PM", "11/Nov/26 10:00 AM", 0, 0, "Bug"),
    T("GOD-203", D, "Table QR flow", "High", "19/Nov/26 12:00 AM", "19/Nov/26 6:00 PM", "20/Nov/26 10:00 AM"),
    T("GOD-204", D, "Payment webhook retries", "Medium", "24/Nov/26 12:00 AM", "24/Nov/26 2:00 PM", "25/Nov/26 10:00 AM"),
    T("GOD-205", D, "Admin role permissions", "Low", "30/Nov/26 12:00 AM", "27/Nov/26 2:00 PM", "30/Nov/26 10:00 AM"),
    T("GOD-206", D, "Unit tests for cart", "Medium", "26/Nov/26 12:00 AM", "26/Nov/26 2:00 PM", "27/Nov/26 10:00 AM", 1, 0, "Subtask"),
    T("GOD-207", D, "Old promo banner", "Medium", "20/Nov/26 12:00 AM", "", "20/Nov/26 10:00 AM", 0, 0, "Task", "|cancelled"),
    T("AWE-301", L, "Onboard Cafe Central", "Medium", "20/Nov/26 12:00 AM", "25/Nov/26 2:00 PM", "26/Nov/26 10:00 AM"),
    T("AWE-302", L, "Venue photos checklist", "Low", "", "", "18/Nov/26 10:00 AM"),
    T("AWE-290", L, "Onboard Green Bean", "Medium", "", "", "15/Oct/26 10:00 AM"),
    T("AWE-291", L, "Pricing sheet update", "Medium", "", "", "22/Oct/26 10:00 AM", 1),
    T("AWE-292", L, "Partner FAQ", "Medium", "", "", "29/Oct/26 10:00 AM"),
    T("PRJ-120", "Former user", "Old roadmap", "Medium", "", "", "10/Nov/26 10:00 AM"),
  ];
  const parsed = E.parseJiraExport(E.toCSV([HDR, ...rows]));
  const month = "2026-11", uploadId = "sample";
  const put = (p, d) => db.doc(p).set(d);
  put("team/ani", { name: "Ani", jiraName: A, role: "Project Manager", salary: 900000, active: true });
  put("team/davit", { name: "Davit", jiraName: D, role: "Developer", salary: 1200000, active: true });
  put("team/lilit", { name: "Lilit", jiraName: L, role: "Onboarding", salary: 500000, start: "2026-11-09", active: true });
  put(`months/${month}/jira/p0`, { uploadId, tasks: parsed.tasks });
  put(`months/${month}`, { month, jira: { uploadId, parts: 1, fileName: "Sample Jira export.csv", uploadedAt: new Date().toISOString(), rowCount: parsed.rowCount, found: parsed.found, missing: parsed.missing, warnings: parsed.warnings },
    hours: { ani: { worked: 162.5, leave: 1, sick: 0, unpaid: 0 }, davit: { worked: 151, leave: 0, sick: 2, unpaid: 0 }, lilit: { worked: 131, leave: 0, sick: 0, unpaid: 0 } } });
  put(`months/${month}/incidents/i1`, { memberId: "ani", date: "2026-11-17", level: "major", aiSlop: true, note: "Partner contract summary was unchecked AI output" });
  put(`months/${month}/incidents/i2`, { memberId: "ani", date: "2026-11-24", level: "minor", note: "Jira status not updated for 3 days" });
  S.db = db; S.mode = "sample"; S.canEdit = true; S.month = month; S.tab = "payroll";
  subscribeAll(); render();
}

// ---------------- boot ----------------
/** Is this page served by server.js? Returns its status ({ ok, jira, site }) or null (opened as a file, static host). */
async function findServer() {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const t = setTimeout(() => ctrl && ctrl.abort(), 4000);
    const res = await fetch("api/status", { credentials: "same-origin", signal: ctrl && ctrl.signal });
    clearTimeout(t);
    const st = res.ok ? await res.json() : null;
    return st && st.ok === true ? st : null;
  } catch (e) { return null; }
}
async function boot() {
  S.mode = "loading"; render();
  clearInterval(S.syncTimer);
  let db = null, user = null;
  const cl = window.claude;
  if (cl && typeof cl.use === "function") {
    try { [db, user, S.downloads, S.mcp] = await Promise.all([cl.use("db"), cl.use("user").catch(() => null), cl.use("downloads").catch(() => null), cl.use("mcp").catch(() => null)]); } catch (e) { db = null; }
  }
  if (db) {
    S.db = db; S.mode = "live";
    if (user) { try { const ok = await user.canEdit(); S.canEdit = ok !== false; } catch (e) {} }
  } else {
    // Standalone website: keep the data in this browser. If storage is blocked, run in memory and say so.
    S.downloads = null; S.mcp = null; S.canEdit = true; S.loadError = "";
    S.jiraServer = await findServer();
    const out = $("#logoutForm"); if (out) out.classList.toggle("hide", !(S.jiraServer && S.jiraServer.auth)); // "Log out" only where there is a sign-in
    S.me = (S.jiraServer && S.jiraServer.me) || null; S.users = null; S.backups = null; S.history = null;
    if (S.me) { S.canEdit = !!S.me.edit; const b = out && out.querySelector("button"); if (b) b.title = "Log out (" + S.me.name + ")"; }
    if (S.jiraServer && S.jiraServer.db) {
      // Shared data on the Glana server: everyone with the password sees the same numbers.
      try { const remote = ServerDB(); const all = await remote.loadAll(); S.db = MemDB(null, remote); S.db.refresh(all); S.mode = "server"; }
      catch (e) { S.db = MemDB(); S.mode = "local"; S.loadError = e && e.code === "login_required" ? "Your sign-in expired. Reload the page and sign in again." : "Couldn't load the shared data from the server. Check the connection and reload the page."; }
    } else {
      try { S.db = MemDB(STORE_KEY); S.mode = "browser"; } catch (e) { S.db = MemDB(); S.mode = "local"; }
    }
  }
  subscribeAll(); render();
  if (S.mode === "server") {
    const sync = () => { if (S.mode === "server" && document.visibilityState !== "hidden" && S.db.sync) S.db.sync().catch(() => {}); };
    S.syncTimer = setInterval(sync, 8000);
    if (!S.syncBound) { S.syncBound = true; window.addEventListener("focus", () => S.mode === "server" && S.db.sync && S.db.sync().catch(() => {})); }
  }
}
render();
boot();
let resizeT; window.addEventListener("resize", () => { if (S.tab !== "analytics") return; clearTimeout(resizeT); resizeT = setTimeout(render, 180); });
window.__glana = { S, results, E, findIssues, analyticsData };
})();

/* Presentation only: tab indicator, entrance animations, save-state icon. No data or pay logic here. */
(function () {
  const view = document.getElementById("view"), tabs = document.getElementById("tabs"), bar = document.getElementById("tabbar");
  if (!view || !tabs || !bar || !window.MutationObserver) return;
  const track = bar.querySelector(".tabtrack"), ind = bar.querySelector(".tab-ind");
  const label = document.getElementById("monthLabel"), save = document.getElementById("saveState");
  const G = window.__glana || {};
  const still = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  let lastKey = null, pending = null, growT = null;

  const key = () => { const S = G.S; return S ? [S.tab, S.month, S.mode].join("|") : ""; };
  const restart = (c) => { view.classList.remove(c); void view.offsetWidth; view.classList.add(c); };
  const openGrow = () => { view.classList.add("grow"); clearTimeout(growT); growT = setTimeout(() => view.classList.remove("grow"), 1500); };

  function placeInd() {
    const btn = tabs.querySelector('[aria-selected="true"]');
    if (!btn || !ind || !track) return;
    const t = track.getBoundingClientRect(), b = btn.getBoundingClientRect();
    if (!b.width) return;
    const first = !bar.classList.contains("has-ind");
    if (first) ind.style.transition = "none";
    ind.style.width = b.width + "px"; ind.style.height = b.height + "px";
    ind.style.transform = "translate(" + (b.left - t.left - track.clientLeft) + "px," + (b.top - t.top - track.clientTop) + "px)";
    if (first) { void ind.offsetWidth; ind.style.transition = ""; bar.classList.add("has-ind"); }
  }

  function onView() {
    const k = key(), nav = pending; pending = null;
    if (still.matches) { lastKey = k; return; }
    if (nav && nav.kind === "tab") { view.classList.remove("enter"); restart("stagger"); openGrow(); }
    else if (k !== lastKey) {
      view.classList.remove("stagger"); restart("enter"); openGrow();
      if (nav && nav.kind === "month" && label && label.animate) label.animate([{ transform: "translateX(" + (nav.dir * 12) + "px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" });
    } else view.classList.remove("stagger");
    lastKey = k;
  }

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest && ev.target.closest("[data-action]"); if (!el) return;
    const a = el.dataset.action;
    if (a === "tab") pending = { kind: "tab" };
    else if (a === "month-prev" || a === "month-next") pending = { kind: "month", dir: a === "month-prev" ? -1 : 1 };
  }, true);

  new MutationObserver(onView).observe(view, { childList: true });
  new MutationObserver(placeInd).observe(tabs, { childList: true });
  window.addEventListener("resize", () => { bar.classList.remove("has-ind"); placeInd(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { bar.classList.remove("has-ind"); placeInd(); });

  if (save) {
    const mark = () => { const t = save.textContent.trim(); save.dataset.state = /^Saving/.test(t) ? "saving" : t === "Saved" ? "saved" : t === "Not saved" ? "error" : ""; };
    new MutationObserver(mark).observe(save, { childList: true, characterData: true, subtree: true });
    mark();
  }
  lastKey = key(); placeInd();
})();
