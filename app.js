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
  return { doc: docRef, collection: colRef, exportAll, importAll, refresh, sync };
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
  pendingRender: false, jiraPreview: null, hoursPreview: null, filter: "", mcp: null, jiraServer: null, pull: null, pageSize: 100,
};
try { const t = localStorage.getItem("glanaPayTab"); if (t) S.tab = t; } catch (e) {}

const TABS = [
  ["payroll", "Payroll"], ["tasks", "Jira tasks"], ["hours", "Hours"], ["incidents", "Incidents"], ["team", "Team"], ["settings", "Settings"],
];

function cfg() { const c = Object.assign(clone(E.DEFAULT_SETTINGS), clone(S.settings || {})); return c; }
function activeTeam() { const [a, b] = [S.month + "-01", S.month + "-31"]; return S.team.filter((m) => m.active !== false && (!m.start || m.start <= b) && (!m.end || m.end >= a)).sort((x, y) => x.name.localeCompare(y.name)); }
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
    if (e && e.code === "quota_exceeded") msg = "Storage is full. Delete old months to free space.";
    if (e && e.code === "login_required") msg = "Your sign-in expired. Reload the page and enter the password.";
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
  renderBanners();
  renderTabs();
  renderChrome();
  const v = $("#view");
  const scroll = window.scrollY;
  if (S.mode === "loading") { v.innerHTML = `<div class="empty loading"><div class="sk-grid" aria-hidden="true"><span class="sk"></span><span class="sk"></span><span class="sk"></span><span class="sk"></span></div><span class="sk sk-table" aria-hidden="true"></span><p>Loading saved data…</p></div>`; return; }
  v.innerHTML = ({ payroll: viewPayroll, tasks: viewTasks, hours: viewHours, incidents: viewIncidents, team: viewTeam, settings: viewSettings })[S.tab]();
  window.scrollTo(0, scroll);
  bindDrops();
  if (S.animatePull && S.tab === "tasks") { clearTimeout(S.animT); S.animT = setTimeout(playPullAnim, 180); }
}
/** Browser tab title and the sidebar note that says where the data is kept. Display only. */
function renderChrome() {
  const tabLabel = (TABS.find(([k]) => k === S.tab) || [])[1];
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
  if (!S.canEdit && S.mode === "live") b.push(`<div class="banner info"><span class="grow">View only: you don't have edit access to this calculator.</span></div>`);
  $("#banners").innerHTML = b.join("");
}
function status() {
  const team = activeTeam();
  const hrs = team.filter((m) => { const h = hoursFor(m.id); return h && h.worked !== "" && h.worked != null; }).length;
  return {
    team: team.length > 0 && team.every((m) => Number(m.salary) > 0),
    tasks: !!S.monthDoc.jira && S.tasks.length > 0,
    hours: team.length > 0 && (!!S.monthDoc.skipHours || hrs === team.length),
    hrs, teamN: team.length,
  };
}
function renderTabs() {
  const st = status();
  const dots = { tasks: st.tasks, hours: st.hours, team: st.team };
  const groups = { payroll: "This month", team: "Setup" };
  $("#tabs").innerHTML = TABS.map(([k, label]) => `${groups[k] ? `<span class="nav-h" role="presentation">${groups[k]}</span>` : ""}<button role="tab" aria-selected="${S.tab === k}" data-action="tab" data-tab="${k}"><span class="ico">${ICON[k]}</span><span class="lbl">${label}</span>${k in dots ? `<span class="dot ${dots[k] ? "ok" : "todo"}" title="${dots[k] ? "Ready" : "Needs attention"}"></span>` : ""}${k === "incidents" && S.incidents.length ? `<span class="tag">${S.incidents.length}</span>` : ""}</button>`).join("");
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
    <thead><tr><th>Employee</th><th class="n">Score</th><th class="c">Bonus %</th><th class="n hide-sm">Hours</th><th class="c hide-sm">Gate</th><th class="c hide-sm">Ethics</th><th class="n hide-sm">Base</th><th class="n hide-sm">Bonus</th><th class="n hide-sm">Extra</th><th class="n">Total</th><th class="n hide-sm">vs current</th></tr></thead>
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
        <td class="n hide-sm ${r.diff >= 0 ? "pos" : "neg"}">${r.diff >= 0 ? "+" : "−"}${amd(Math.abs(r.diff))}</td>
      </tr>`).join("")}</tbody>
    <tfoot><tr><td>Total</td><td></td><td></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="n hide-sm">${amd(tot.base)}</td><td class="n hide-sm">${amd(tot.bonus)}</td><td class="n hide-sm">${amd(tot.extra)}</td><td class="n">${amd(tot.total)}</td><td class="n hide-sm ${tot.total - tot.cur >= 0 ? "pos" : "neg"}">${tot.total - tot.cur >= 0 ? "+" : "−"}${amd(Math.abs(tot.total - tot.cur))}</td></tr></tfoot>
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
    ${standalone ? "" : `<button class="btn" data-action="slip-download" data-id="${esc(r.memberId)}">${ICON.download}Download</button><button class="btn" data-action="slip-close" aria-label="Close">✕</button>`}
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
  const c = cfg();
  const list = S.team.slice().sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  const edit = S.editing ? S.team.find((m) => m.id === S.editing) : null;
  const m = edit || {};
  return `<h2>Team</h2><p class="sub">Everyone paid under the system. <b>Jira name</b> must match the Assignee name in Jira exactly. Base salary = ${c.basePct}% of current salary.</p>
  <form class="card pad form" data-form="member">
    <div class="form-title"><b>${edit ? `Edit ${esc(m.name)}` : "Add an employee"}</b></div>
    <label class="f">Name<input type="text" name="name" value="${esc(m.name || "")}" required maxlength="80"></label>
    <label class="f">Jira name<input type="text" name="jiraName" value="${esc(m.jiraName || "")}" placeholder="same as Name" maxlength="80"></label>
    <label class="f">Face-scan name<input type="text" name="scanName" value="${esc(m.scanName || "")}" placeholder="if different" maxlength="80"></label>
    <label class="f">Role<input type="text" name="role" value="${esc(m.role || "")}" maxlength="60"></label>
    <label class="f">Current salary (AMD)<input type="number" name="salary" min="0" step="1000" value="${esc(m.salary || "")}" required></label>
    <label class="f">Start date<input type="date" name="start" value="${esc(m.start || "")}"></label>
    <label class="f">End date<input type="date" name="end" value="${esc(m.end || "")}"></label>
    <div class="row"><button class="btn primary" type="submit">${edit ? "Save changes" : "Add employee"}</button>${edit ? `<button class="btn ghost" type="button" data-action="member-cancel">Cancel</button>` : ""}</div>
  </form>
  <div class="card tablewrap section"><div class="panel-h"><h3>Employees</h3><span class="tag">${list.length}</span></div>${list.length ? `<table><thead><tr><th>Name</th><th class="hide-sm">Jira name</th><th class="hide-sm">Role</th><th class="n">Current salary</th><th class="n">Base (${c.basePct}%)</th><th class="n hide-sm">Normal month</th><th></th></tr></thead><tbody>${list.map((x) => {
    const base = Math.round((Number(x.salary) || 0) * c.basePct / 100);
    return `<tr${x.active === false ? ` style="opacity:.55"` : ""}><td><div class="who">${avatar(x.name)}<div><b>${esc(x.name)}</b>${x.end ? `<div class="small muted">until ${fmtDate(x.end)}</div>` : ""}</div></div></td><td class="hide-sm">${esc(x.jiraName || x.name)}</td><td class="hide-sm">${esc(x.role || "")}</td><td class="n">${Number(x.salary) > 0 ? amd(x.salary) : `<span class="tag warn">missing</span>`}</td><td class="n">${amd(base)}</td><td class="n hide-sm">${amd(base * (1 + (c.defaultBonusPct || 35) / 100))}</td><td class="n" style="white-space:nowrap"><button class="btn ghost" data-action="member-edit" data-id="${esc(x.id)}">Edit</button><button class="btn ghost" data-action="member-toggle" data-id="${esc(x.id)}">${x.active === false ? "Activate" : "Deactivate"}</button></td></tr>`;
  }).join("")}</tbody></table>` : `<div class="empty">No employees yet.</div>`}</div>`;
}

// ----- settings -----
function viewSettings() {
  const c = cfg();
  const numIn = (path, v, step) => `<input type="number" step="${step || 1}" data-set="${path}" value="${esc(v)}" data-live="0">`;
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
  ${S.mode === "browser" || S.mode === "server" ? `<div class="card pad section"><h3 style="margin-top:0">Backup</h3><p class="small muted" style="margin-top:0">${S.mode === "server" ? "Everything (team, salaries, months, tasks, incidents, settings) is saved on the Glana server. Download a backup now and then to keep a copy of your own. Restoring replaces the shared data for everyone." : "Everything (team, salaries, months, tasks, incidents, settings) is saved in this browser only. Download a backup regularly, and use it to move the data to another computer. Clearing the browser's site data deletes it."}</p><div class="row"><button class="btn" data-action="backup-download">${ICON.download}Download backup</button><label class="btn">${ICON.upload}Restore from backup<input type="file" accept=".json,application/json" data-file="backup" hidden></label></div></div>` : ""}
  <div class="row section savebar"><button class="btn primary" data-action="settings-save">Save settings</button><button class="btn ghost" data-action="settings-reset">Reset to document defaults</button><span class="small muted">${S.settingsStored ? "Custom settings saved." : "Using the document defaults."}</span></div>`;
}

// ---------------- actions ----------------
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-action]"); if (!el) return;
  const a = el.dataset.action;
  if (el.tagName === "A") ev.preventDefault();
  if (a === "tab") { S.tab = el.dataset.tab; try { localStorage.setItem("glanaPayTab", S.tab); } catch (e) {} S.editing = null; render(); window.scrollTo(0, 0); }
  else if (a === "month-prev" || a === "month-next") { S.month = E.monthAdd(S.month, a === "month-prev" ? -1 : 1); S.filter = ""; if (S.db) subscribeMonth(); render(); }
  else if (a === "extra-open") { ev.stopPropagation(); openSlip(el.dataset.id); const f = $("#slip [name=amount]"); if (f) { f.focus(); f.scrollIntoView({ block: "center" }); } }
  else if (a === "extra-clear") { const id = el.dataset.id; if (await write(async () => { await S.db.doc("months/" + S.month).update({ extras: { [id]: { amount: 0, note: "" } } }); }, "Extra removed")) setTimeout(() => openSlip(id), 60); }
  else if (a === "slip") openSlip(el.dataset.id);
  else if (a === "slip-close") $("#slip").close();
  else if (a === "slip-download") { const r = results().find((x) => x.memberId === el.dataset.id); if (r) download(`Payslip ${r.name} ${r.month}.html`, standaloneSlip(r)); }
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
  else if (a === "settings-save") saveSettings();
  else if (a === "settings-reset") { await write(() => S.db.doc("config/settings").set(clone(E.DEFAULT_SETTINGS)), "Settings reset to the document defaults"); }
  else if (a === "backup-download") backupDownload();
  else if (a === "sample") startSample();
  else if (a === "exit-sample") boot();
});
$("#slip").addEventListener("click", (e) => { if (e.target === $("#slip")) $("#slip").close(); });
document.addEventListener("change", async (ev) => {
  const el = ev.target;
  if (el.dataset.hours) await setHours(el.dataset.hours, el.dataset.field, el.value.trim());
  else if (el.dataset.file) { const f = el.files[0]; if (f) readFile(f, el.dataset.file); el.value = ""; }
  else if (el.dataset.action === "filter") { S.filter = el.value; render(); }
  else if (el.dataset.action === "skip-hours") { const v = el.checked; el.blur(); await write(async () => { await ensureMonthDoc(); await S.db.doc("months/" + S.month).update({ skipHours: v }); }, v ? "Working hours not counted for " + monthName(S.month) : "Working hours counted again"); render(); }
});
document.addEventListener("submit", async (ev) => {
  const form = ev.target; ev.preventDefault();
  const fd = Object.fromEntries(new FormData(form).entries());
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
    if (path[0] === "holidays") { v = v.split(/[\s,]+/).map((x) => E.parseDate(x)).filter(Boolean).sort(); }
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
  const rows = [["Month", "Employee", "Current salary", "Base paid", "Tasks", "Score", "Score basis", "Bonus %", "Worked h", "Required h", "Attendance %", "Gate", "Ethics deduction %", "Bonus", "Extra from founders", "Extra reason", "Total", "Difference vs current", "Shadow month", "Notes"]];
  for (const r of rs) rows.push([r.month, r.name, r.salary, r.basePaid, r.tasks.length, r.score == null ? "" : r.score, r.scoreBasis, r.bonusPct, r.worked == null ? "" : r.worked, r.requiredHours, r.attendancePct == null ? "" : r.attendancePct.toFixed(1), r.hoursMissing ? "" : r.gate, r.ethics.deduction, r.bonus, r.extra, r.extraNote, r.total, r.diff, r.shadow ? "yes" : "no", r.warnings.join("; ")]);
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
function standaloneSlip(r) {
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payslip ${esc(r.name)} ${esc(r.month)}</title><style>${css} body{background:var(--bg)} .sheet{max-width:860px;margin:24px auto;background:var(--surface);border-radius:16px;overflow:hidden;border:1px solid var(--line)}</style></head><body><div class="sheet">${slipHTML(r, true)}</div></body></html>`;
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
    login_required: "Your sign-in to this site expired. Reload the page and enter the password.",
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
    if (S.jiraServer && S.jiraServer.db) {
      // Shared data on the Glana server: everyone with the password sees the same numbers.
      try { const remote = ServerDB(); const all = await remote.loadAll(); S.db = MemDB(null, remote); S.db.refresh(all); S.mode = "server"; }
      catch (e) { S.db = MemDB(); S.mode = "local"; S.loadError = e && e.code === "login_required" ? "Your sign-in expired. Reload the page and enter the password." : "Couldn't load the shared data from the server. Check the connection and reload the page."; }
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
window.__glana = { S, results, E, findIssues };
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
