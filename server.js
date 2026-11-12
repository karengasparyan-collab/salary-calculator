/* Glana Pay server: serves the website and reads Jira for it.
 *
 * The browser never sees the Jira token. It asks this server for "tasks resolved between two dates";
 * the server builds the JQL itself (engine.js → jiraJql), calls Jira Cloud's REST search, and returns
 * only the fields the calculator needs (no e-mail addresses or avatars). Nothing in Jira is changed.
 *
 * Settings come from environment variables (or a .env file next to this one, see .env.example):
 *   JIRA_EMAIL, JIRA_API_TOKEN   Atlassian account e-mail + API token (read access to the projects)
 *   JIRA_SITE                    default glana.atlassian.net
 *   APP_PASSWORD                 password for the website's sign-in page (/login).
 *                                Required unless the server only listens on this computer.
 *                                Can be replaced from Settings → Password (needs the shared database).
 *   SESSION_SECRET               optional extra secret for signing the sign-in cookie (see "sign-in" below)
 *   PORT, HOST                   default 8080; 127.0.0.1 without a password, 0.0.0.0 with one
 *   KV_REST_API_URL / _TOKEN     shared database (Upstash Redis, added by Vercel). Without it, a normal
 *                                computer saves to data/db.json; on Vercel the app falls back to the browser.
 *
 * Run: node server.js   (Node 18 or newer, no packages needed). On Vercel, api/index.js runs the same handler. */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const E = require("./engine.js");
const DB = require("./store.js");

const ROOT = __dirname;
/** Only these files are served, and only after sign-in. Everything else (server.js, .env, tests…) is never sent.
 *  login.html is the one page shown before sign-in (at /login). */
const FILES = { "/": "index.html", "/index.html": "index.html", "/engine.js": "engine.js", "/app.js": "app.js" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};
const COOKIE = "glana_session";
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 86400000;
const MAX_FAILS = 10, LOCK_MS = 15 * 60000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,19}$/;
const ISSUE_TYPE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

// ---------- config ----------
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
function configFromEnv(env) {
  const site = (env.JIRA_SITE || "glana.atlassian.net").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const password = env.APP_PASSWORD || "";
  return {
    jiraSite: site,
    jiraBase: (env.JIRA_BASE_URL || `https://${site}`).replace(/\/+$/, ""), // override only for tests
    jiraEmail: env.JIRA_EMAIL || "",
    jiraToken: env.JIRA_API_TOKEN || "",
    user: env.APP_USER || "glana", // only pre-fills a hidden field so password managers can file the password under a name
    password,
    sessionSecret: env.SESSION_SECRET || "",
    port: Number(env.PORT) || 8080,
    host: env.HOST || (password ? "0.0.0.0" : "127.0.0.1"),
    trustProxy: !!env.VERCEL, // behind Vercel the visitor's address is in X-Forwarded-For
    hosted: !!env.VERCEL,
  };
}
const isLoopback = (h) => h === "127.0.0.1" || h === "::1" || h === "localhost";

// ---------- helpers ----------
function send(res, status, body, headers) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS, isJson ? { "Content-Type": "application/json; charset=utf-8" } : {}, headers || {}));
  res.end(isJson ? JSON.stringify(body) : body);
}
function readBody(req, limit) {
  // On Vercel the platform may already have read the body (req.body); elsewhere it is read from the stream.
  if (Object.prototype.hasOwnProperty.call(req, "body") || (req.body !== undefined && !req.readable)) {
    let b; try { b = req.body; } catch (e) { return Promise.reject(new SyntaxError("bad body")); }
    const text = b == null ? "" : Buffer.isBuffer(b) ? b.toString("utf8") : typeof b === "string" ? b : JSON.stringify(b);
    return Buffer.byteLength(text) > limit ? Promise.reject({ status: 413 }) : Promise.resolve(text);
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject({ status: 413 }); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();

// ---------- sign-in ----------
// No sessions are kept on the server (Vercel starts a fresh copy of it whenever it likes). The cookie itself is the
// proof: an expiry time signed with a key made from that person's password (+ SESSION_SECRET if set).
// Nobody can forge or extend it without the key, and changing a password makes that person's old cookies invalid.
//
// There are two kinds of people:
//   the owner   signs in with APP_PASSWORD (login: APP_USER, or left empty). Can do everything. If the owner changes
//               the password in Settings, the database keeps { salt, hash, envTag, changedAt }: the new password
//               hashed with scrypt. envTag ties it to the APP_PASSWORD it replaced: change APP_PASSWORD in Vercel
//               and the stored one is ignored. That is the way back in when nobody remembers it.
//   accounts    made by an admin in Settings → People: { login, name, salt, hash, admin, edit, pages, locked }.
//               `pages` are the sections the person may open, `edit` whether they may change anything,
//               `admin` gives everything (settings, people, history, backups). A locked account can't sign in.
// Both live in one record beside the documents (store.getAuth): { v: 1, ...owner password, users: { id: account } }.
const PW_MIN = 8, PW_MAX = 200;
const PAGES = ["payroll", "tasks", "hours", "incidents", "team", "analytics"];
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const envTag = (cfg) => crypto.createHmac("sha256", "glana-pay-env-tag").update(cfg.password).digest("hex");
const scrypt = (pw, salt) => crypto.scryptSync(String(pw), Buffer.from(salt, "base64"), 32, { N: 16384, r: 8, p: 1 });
function hashPassword(pw) { const salt = crypto.randomBytes(16).toString("base64"); return { salt, hash: scrypt(pw, salt).toString("base64") }; }
function hashOk(given, rec) {
  if (typeof given !== "string" || given.length > PW_MAX) return false;
  const want = Buffer.from(rec.hash, "base64");
  return want.length === 32 && crypto.timingSafeEqual(scrypt(given, rec.salt), want);
}
/** The owner's stored password if it is in force (made while today's APP_PASSWORD was set), else null. */
function ownerRecord(auth, cfg) {
  return auth && typeof auth.salt === "string" && typeof auth.hash === "string" && auth.envTag === envTag(cfg) ? auth : null;
}
const usersOf = (auth) => (auth && auth.users && typeof auth.users === "object" ? auth.users : {});
function passwordOk(given, cfg, rec) {
  if (typeof given !== "string") return false;
  return rec ? hashOk(given, rec) : crypto.timingSafeEqual(sha(given), sha(cfg.password));
}
const sessionKey = (cfg, rec) => sha("glana-pay-session\n" + cfg.sessionSecret + "\n" + cfg.password + (rec ? "\n" + rec.hash : ""));
const userKey = (cfg, id, u) => sha("glana-pay-user\n" + cfg.sessionSecret + "\n" + cfg.password + "\n" + id + "\n" + u.hash);
const sign = (key, text) => crypto.createHmac("sha256", key).update(text).digest("base64url");
/** Owner: "v1.<expiry>.<signature>". Account: "u1.<id>.<expiry>.<signature>". */
function makeToken(key, now, uid) {
  const exp = now + SESSION_MS;
  return uid ? `u1.${uid}.${exp}.${sign(key, `u1.${uid}.${exp}`)}` : `v1.${exp}.${sign(key, "v1." + exp)}`;
}
const sameSig = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ownerWho = (cfg, auth) => ({ id: "owner", owner: true, login: cfg.user, name: (auth && auth.ownerName) || "Owner", admin: true, edit: true, pages: PAGES.slice() });
function userWho(id, u) { return { id, login: u.login, name: u.name || u.login, admin: !!u.admin, edit: !!(u.admin || u.edit), pages: u.admin ? PAGES.slice() : PAGES.filter((p) => (u.pages || []).includes(p)) }; }
/** Who sent this cookie? Returns the person, or null (no cookie, forged, expired, account removed or locked). */
function whoFromToken(token, cfg, auth, now) {
  let m = /^v1\.(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(token || "");
  if (m) return sameSig(m[2], sign(sessionKey(cfg, ownerRecord(auth, cfg)), "v1." + m[1])) && Number(m[1]) > now ? ownerWho(cfg, auth) : null;
  m = /^u1\.([a-z0-9]{6,20})\.(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(token || "");
  if (!m) return null;
  const u = Object.prototype.hasOwnProperty.call(usersOf(auth), m[1]) ? usersOf(auth)[m[1]] : null;
  if (!u || u.locked) return null;
  return sameSig(m[3], sign(userKey(cfg, m[1], u), `u1.${m[1]}.${m[2]}`)) && Number(m[2]) > now ? userWho(m[1], u) : null;
}
/** May this person see salaries and pay? Only with the Payroll or Analytics page (or admin). */
const seesPay = (who) => who.admin || who.pages.includes("payroll") || who.pages.includes("analytics");
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}
/** Secure is always set on Vercel / behind HTTPS. Only plain http (npm start on your own computer) leaves it out,
 *  because browsers would otherwise never send the cookie back there. */
function cookieHeader(req, cfg, value, maxAgeSec) {
  const https = cfg.hosted || !!(req.socket && req.socket.encrypted) || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${https ? "; Secure" : ""}`;
}
const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function loginPage(cfg, error, login) {
  return fs.readFileSync(path.join(ROOT, "login.html"), "utf8")
    .replace("<!--ERROR-->", error ? `<p class="err" id="loginError" role="alert">${escHtml(error)}</p>` : "")
    .replace("__USER__", escHtml(login || ""));
}
function checkNewPassword(next, current) {
  if (typeof next !== "string") return "Send the new password.";
  if (current != null && next === current) return "The new password is the same as the current one.";
  if (next.length < PW_MIN) return `The new password needs at least ${PW_MIN} characters.`;
  if (next.length > PW_MAX) return `The new password can have ${PW_MAX} characters at most.`;
  if (!next.trim()) return "The new password can't be only spaces.";
  return null;
}
/** Settings → Password: { current, next } as JSON. Returns { current, next } or { error }. */
async function readPasswordChange(req) {
  const o = JSON.parse(await readBody(req, 4096));
  if (!o || typeof o.current !== "string" || typeof o.next !== "string") return { error: "Send the current and the new password." };
  const error = checkNewPassword(o.next, o.current);
  return error ? { error } : { current: o.current, next: o.next };
}
/** The login and password from the sign-in form (a normal form post; JSON is accepted too). */
async function readLogin(req) {
  const text = await readBody(req, 4096);
  const str = (v) => (typeof v === "string" ? v : "");
  if (text.trimStart().startsWith("{")) { const o = JSON.parse(text) || {}; return { login: str(o.username).trim().toLowerCase(), password: str(o.password) }; }
  const q = new URLSearchParams(text);
  return { login: (q.get("username") || "").trim().toLowerCase(), password: q.get("password") || "" };
}
/** Settings → People: check one account's fields. Returns the clean fields or { error }. */
function cleanUser(o, auth, cfg, id) {
  const out = {};
  if (o.login !== undefined) {
    const login = String(o.login).trim().toLowerCase();
    if (!LOGIN_RE.test(login)) return { error: "The login needs 2 to 32 letters, digits, dots, dashes or underscores." };
    if (login === String(cfg.user).toLowerCase()) return { error: "That login belongs to the owner." };
    for (const [k, u] of Object.entries(usersOf(auth))) if (k !== id && u.login === login) return { error: "That login is already used." };
    out.login = login;
  }
  if (o.name !== undefined) { out.name = String(o.name).trim().slice(0, 80); if (!out.name) return { error: "Enter a name." }; }
  if (o.password !== undefined && o.password !== "") { const e = checkNewPassword(o.password, null); if (e) return { error: e.replace("new password", "password") }; Object.assign(out, hashPassword(o.password)); }
  if (o.admin !== undefined) out.admin = !!o.admin;
  if (o.edit !== undefined) out.edit = !!o.edit;
  if (o.locked !== undefined) out.locked = !!o.locked;
  if (o.pages !== undefined) { if (!Array.isArray(o.pages) || !o.pages.every((p) => PAGES.includes(p))) return { error: "Unknown page." }; out.pages = PAGES.filter((p) => o.pages.includes(p)); }
  return out;
}
const publicUser = (id, u) => ({ id, login: u.login, name: u.name, admin: !!u.admin, edit: !!(u.admin || u.edit), pages: u.admin ? PAGES.slice() : (u.pages || []), locked: !!u.locked, createdAt: u.createdAt || null, passwordAt: u.passwordAt || null });

// ---------- Jira ----------
/** Validate the browser's request and build the JQL on the server. Returns { jql, maxResults, nextPageToken } or { error }. */
function buildSearch(body) {
  if (!body || typeof body !== "object") return { error: "Send a JSON object." };
  const { from, to } = body;
  if (!ISO_DAY.test(from || "") || !ISO_DAY.test(to || "") || !E.parseDate(from) || !E.parseDate(to)) return { error: "from and to must be dates (YYYY-MM-DD)." };
  if (from >= to) return { error: "from must be before to." };
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 400) return { error: "The date range is too long (400 days at most)." };
  const projects = String(body.projects || "GOD, PRJ, AWE").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (!projects.length || projects.length > 20 || !projects.every((p) => PROJECT_KEY.test(p))) return { error: "projects must be Jira project keys, comma separated." };
  const issueTypes = Array.isArray(body.issueTypes) && body.issueTypes.length ? body.issueTypes.map((x) => String(x).trim()).filter(Boolean) : E.DEFAULT_SETTINGS.issueTypes;
  if (!issueTypes.length || issueTypes.length > 10 || !issueTypes.every((t) => ISSUE_TYPE.test(t))) return { error: "issueTypes must be plain issue type names." };
  const maxResults = Math.max(1, Math.min(100, Math.floor(Number(body.maxResults) || 100)));
  const nextPageToken = body.nextPageToken == null || body.nextPageToken === "" ? null : String(body.nextPageToken);
  if (nextPageToken && nextPageToken.length > 4000) return { error: "nextPageToken is too long." };
  const jql = E.jiraJql(null, { poolMonths: 1, issueTypes, jiraProjects: projects.join(", ") }, from, to);
  return { jql, maxResults, nextPageToken };
}
/** Keep only what the calculator reads (same shape taskFromJiraApi expects). */
function slimIssue(it) {
  const f = (it && it.fields) || {};
  const named = (o) => (o && typeof o === "object" ? { name: o.name || "" } : null);
  const out = {
    summary: f.summary || "",
    issuetype: named(f.issuetype),
    status: named(f.status),
    priority: named(f.priority),
    assignee: f.assignee && typeof f.assignee === "object" ? { displayName: f.assignee.displayName || "" } : null,
    created: f.created || null,
    resolutiondate: f.resolutiondate || null,
    duedate: f.duedate || null,
    labels: Array.isArray(f.labels) ? f.labels : [],
  };
  for (const id of E.JIRA_FIELDS) if (id.startsWith("customfield_")) out[id] = f[id] === undefined ? null : f[id];
  return { key: it.key, fields: out };
}
async function searchJira(cfg, search, fetchImpl) {
  const body = { jql: search.jql, fields: E.JIRA_FIELDS, maxResults: search.maxResults };
  if (search.nextPageToken) body.nextPageToken = search.nextPageToken;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 25000);
  let r;
  try {
    r = await fetchImpl(`${cfg.jiraBase}/rest/api/3/search/jql`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString("base64"),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    return { status: 504, body: { code: "server_unavailable", message: "Jira didn't answer." } };
  } finally { clearTimeout(timer); }
  let data = null; try { data = await r.json(); } catch (e) {}
  if (r.status === 401 || r.status === 403) return { status: 502, body: { code: "jira_auth", message: "Jira refused the server's e-mail / API token." } };
  if (r.status === 429) return { status: 503, body: { code: "server_unavailable", message: "Jira asked to slow down.", retryAfterMs: (Number(r.headers.get("retry-after")) || 2) * 1000 } };
  if (!r.ok) {
    const msg = data && (data.errorMessages || []).concat(Object.values(data.errors || {})).join(" ");
    return { status: 502, body: { code: r.status === 400 ? "tool_error" : "server_unavailable", message: msg || `Jira answered ${r.status}.` } };
  }
  if (!data || !Array.isArray(data.issues)) return { status: 502, body: { code: "bad_shape", message: "Jira's answer had no issues list." } };
  const next = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : null;
  return {
    status: 200,
    body: { issues: data.issues.map(slimIssue), nextPageToken: data.isLast === true ? null : next, isLast: data.isLast === true || !next, jql: search.jql },
  };
}

// ---------- shared data ----------
/** Without the Payroll or Analytics page, salaries and pay never leave the server. */
function strip(p, data, who) {
  if (!data || seesPay(who)) return data;
  if (p.startsWith("team/")) { const o = Object.assign({}, data); delete o.salary; delete o.salaryHistory; return o; }
  if (/^months\/\d{4}-\d{2}$/.test(p)) { const o = Object.assign({}, data); delete o.extras; delete o.final; return o; }
  return data;
}
const MONTH_KEYS = { hours: "hours", hoursImport: "hours", skipHours: "hours", jira: "tasks", extras: "payroll", final: "payroll" };
/** May this person make this change? Returns null (yes) or the reason (no). `prev` is the stored document. */
function denyWrite(who, op, prev) {
  if (!who.edit) return "Your account can view the calculator but not change it.";
  if (who.admin) return null;
  const p = op.path, has = (page) => who.pages.includes(page);
  if (p === "config/settings") return "Only an admin can change the settings.";
  if (p === "debug/lastPull") return null;
  if (p.startsWith("team/")) return has("team") && seesPay(who) ? null : "Your account can't change the team.";
  const m = /^months\/\d{4}-\d{2}\/(incidents|jira)\//.exec(p);
  if (m) return has(m[1] === "jira" ? "tasks" : "incidents") ? null : `Your account can't change ${m[1] === "jira" ? "the Jira tasks" : "incidents"}.`;
  if (op.op === "delete") return "Only an admin can delete a month.";
  if (op.op === "set" && prev) return "Only an admin can replace a month.";
  for (const k of Object.keys(op.data || {})) if (MONTH_KEYS[k] && !has(MONTH_KEYS[k])) return `Your account can't change the ${MONTH_KEYS[k] === "tasks" ? "Jira tasks" : MONTH_KEYS[k]}.`;
  return null;
}
// ----- change history -----
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const LEAF = new Set(["final", "jira", "hoursImport", "salaryHistory", "holidays", "bands", "gates", "shadowMonths", "issueTypes"]);
function brief(k, v) {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return typeof v === "string" && v.length > 160 ? v.slice(0, 160) + "…" : v;
  if (k === "jira") return { tasks: v.rowCount, source: v.source || "csv" };
  if (k === "final") return { people: Array.isArray(v.rows) ? v.rows.length : 0 };
  if (k === "hoursImport") return { file: v.fileName };
  return JSON.stringify(v).length <= 400 ? v : Array.isArray(v) ? { items: v.length } : { fields: Object.keys(v).length };
}
/** What changed between two versions of a document: [{ k: "hours.ani.worked", from, to }] (at most 40). */
function diff(a, b, prefix, out, depth) {
  out = out || []; depth = depth || 0;
  for (const k of [...new Set(Object.keys(a || {}).concat(Object.keys(b || {})))].sort()) {
    if (out.length >= 40) break;
    const av = a ? a[k] : undefined, bv = b ? b[k] : undefined;
    if (JSON.stringify(av) === JSON.stringify(bv)) continue;
    if ((av == null || av === "") && (bv == null || bv === "")) continue; // "" and nothing are the same to a reader
    if (!LEAF.has(k) && depth < 3 && (isObj(av) || isObj(bv)) && (isObj(av) || av == null) && (isObj(bv) || bv == null)) diff(av || {}, bv || {}, (prefix || "") + k + ".", out, depth + 1);
    else out.push({ k: (prefix || "") + k, from: brief(k, av), to: brief(k, bv) });
  }
  return out;
}
async function handleDb(req, res, url, store, who, hooks) {
  if (!store) return send(res, 503, { code: "no_database", message: "The shared database isn't connected." });
  const forbid = (message) => send(res, 403, { code: "forbidden", message });
  try {
    if (req.method === "GET" && url.pathname === "/api/db") {
      const since = url.searchParams.get("since");
      if (since != null && Number(since) === (await store.rev())) return send(res, 200, { unchanged: true, rev: Number(since) });
      const all = await store.all();
      if (!seesPay(who)) for (const k of Object.keys(all.docs)) all.docs[k] = strip(k, all.docs[k], who);
      return send(res, 200, all);
    }
    if (req.method === "GET" && url.pathname === "/api/db/doc") {
      const p = url.searchParams.get("path");
      if (!DB.validPath(p)) return send(res, 400, { code: "invalid_argument", message: "Unknown document path." });
      return send(res, 200, { path: p, data: strip(p, await store.get(p), who) });
    }
    if (req.method === "POST" && url.pathname === "/api/db") {
      const body = JSON.parse(await readBody(req, 3 * 1024 * 1024));
      const ops = Array.isArray(body && body.ops) ? body.ops : [];
      if (!ops.length || ops.length > 50) return send(res, 400, { code: "invalid_argument", message: "Send 1 to 50 changes." });
      const before = [];
      for (const op of ops) {
        if (!op || !DB.validPath(op.path)) return send(res, 400, { code: "invalid_argument", message: "Unknown document path." });
        const prev = await store.get(op.path); before.push(prev);
        const no = denyWrite(who, op, prev); if (no) return forbid(no);
      }
      await hooks.beforeWrite();
      const results = [];
      for (let i = 0; i < ops.length; i++) {
        const r = await DB.applyOp(store, ops[i]);
        results.push({ path: r.path, data: strip(r.path, r.data, who) });
        if (/\/jira\/|^debug\//.test(r.path)) continue; // the tasks themselves are not history; "jira" on the month says what was pulled
        const changes = diff(before[i] || {}, r.data || {});
        if (changes.length) await hooks.log(who, "doc", { op: before[i] ? ops[i].op : "create", path: r.path, label: (r.data && r.data.name) || (before[i] && before[i].name) || undefined, changes });
      }
      return send(res, 200, { results, rev: await store.rev() });
    }
    if (req.method === "PUT" && url.pathname === "/api/db") {
      if (!who.admin) return forbid("Only an admin can restore a backup.");
      const body = JSON.parse(await readBody(req, 4 * 1024 * 1024));
      const bad = DB.checkAll(body && body.docs);
      if (bad) return send(res, 400, { code: "invalid_argument", message: bad });
      await hooks.beforeRestore();
      await store.replaceAll(body.docs);
      await hooks.log(who, "restore", { count: Object.keys(body.docs).length });
      return send(res, 200, await store.all());
    }
    return send(res, 405, { code: "bad_request", message: "Not allowed." });
  } catch (e) {
    if (e instanceof SyntaxError) return send(res, 400, { code: "invalid_argument", message: "Send JSON." });
    if (e && e.status === 413) return send(res, 413, { code: "invalid_argument", message: "Too large." });
    if (e && e.status && e.code) return send(res, e.status, { code: e.code, message: e.message });
    throw e;
  }
}

// ---------- server ----------
const BACKUP_KEEP = 10, WEEK_MS = 7 * 86400000;
function statusBody(cfg, store, canChange, auth, who) {
  const out = { ok: true, jira: !!(cfg.jiraEmail && cfg.jiraToken), site: cfg.jiraSite, db: store ? store.kind : null, hosted: !!cfg.hosted, auth: !!cfg.password };
  if (cfg.password) {
    const rec = who.owner ? ownerRecord(auth, cfg) : null, u = who.owner ? null : usersOf(auth)[who.id];
    Object.assign(out, { user: who.login, passwordChange: canChange, passwordChangedAt: rec ? rec.changedAt : (u && u.passwordAt) || null });
    out.me = { id: who.id, name: who.name, login: who.login, owner: !!who.owner, admin: who.admin, edit: who.edit, pages: who.pages, seesPay: seesPay(who) };
  }
  return out;
}
/** The request handler, shared by the Node server below and Vercel (api/index.js).
 *  opts.store: shared database (store.js) or null; opts.fetch: for tests. */
function createHandler(cfg, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetch || globalThis.fetch;
  const store = opts.store || null;
  const fails = new Map(); // ip -> [timestamps] of wrong passwords
  const canChange = !!(store && store.getAuth && store.putAuth);
  // The sign-in record is read again at most every few seconds. On Vercel other running copies of the server
  // therefore notice a change within AUTH_TTL_MS; the copy that made the change knows at once.
  const AUTH_TTL_MS = 5000;
  let authCache = { at: -Infinity, auth: null };
  async function authRecord(now) {
    if (!canChange || !cfg.password) return null;
    if (now - authCache.at < AUTH_TTL_MS) return authCache.auth;
    try { authCache = { at: now, auth: await store.getAuth() }; }
    catch (e) { if (authCache.at === -Infinity) throw e; } // database down: keep using what we last knew
    return authCache.auth;
  }
  async function saveAuth(auth, now) { await store.putAuth(auth); authCache = { at: now, auth }; }
  const tooMany = (ip, now) => (fails.get(ip) || []).filter((t) => now - t < LOCK_MS).length >= MAX_FAILS;
  const failed = (ip, now) => { const r = (fails.get(ip) || []).filter((t) => now - t < LOCK_MS); r.push(now); fails.set(ip, r); return MAX_FAILS - r.length; };
  /** Change history: who did what. A failure here never blocks the change itself. */
  async function log(who, kind, data) {
    if (!store || !store.addLog) return;
    try { await store.addLog(Object.assign({ at: new Date().toISOString(), who: who.name, whoId: who.id, kind }, data)); } catch (e) { console.error("history:", e && e.message); }
  }
  // Backups kept on the server: one before the first change of each week, one before every restore, and on request.
  let lastBackup = null, lastLooked = -Infinity;
  async function backupNow(reason, now) {
    const all = await store.all();
    if (!Object.keys(all.docs).length) return null;
    const at = new Date(now).toISOString();
    const b = { id: at.replace(/\D/g, "").slice(0, 14) + "-" + crypto.randomBytes(3).toString("hex"), at, reason, docs: all.docs };
    await store.addBackup(b, BACKUP_KEEP); lastBackup = now;
    return b;
  }
  async function weeklyBackup(now) {
    if (!store || !store.addBackup) return;
    try {
      if (lastBackup == null || now - lastLooked > 3600000) { const l = await store.listBackups(); lastBackup = l.length ? Date.parse(l[0].at) : 0; lastLooked = now; }
      if (now - lastBackup >= WEEK_MS) await backupNow("weekly", now);
    } catch (e) { console.error("backup:", e && e.message); }
  }
  const hooks = (now) => ({ log, beforeWrite: () => weeklyBackup(now), beforeRestore: async () => { if (store.addBackup) { try { await backupNow("before restore", now); } catch (e) { console.error("backup:", e && e.message); } } } });
  const json = async (req, limit) => { const o = JSON.parse(await readBody(req, limit)); if (!o || typeof o !== "object") throw new SyntaxError("not an object"); return o; };

  /** Settings → People (admins only). */
  async function handleUsers(req, res, who, auth, now) {
    if (!who.admin) return send(res, 403, { code: "forbidden", message: "Only an admin can manage people." });
    if (!canChange) return send(res, 503, { code: "no_database", message: "Separate logins need the shared database." });
    const list = () => Object.entries(usersOf(authCache.auth)).map(([id, u]) => publicUser(id, u)).sort((a, b) => a.name.localeCompare(b.name));
    if (req.method === "GET") return send(res, 200, { users: list(), owner: { login: cfg.user }, pages: PAGES });
    if (req.method !== "POST") return send(res, 405, { code: "bad_request", message: "Not allowed." });
    let o; try { o = await json(req, 8192); } catch (e) { return send(res, 400, { code: "bad_request", message: "Send a small JSON body." }); }
    const next = Object.assign({ v: 1 }, auth || {}); next.users = Object.assign({}, usersOf(auth));
    const bad = (message) => send(res, 400, { code: "invalid_argument", message });
    if (o.action === "create") {
      if (Object.keys(next.users).length >= 50) return bad("50 accounts at most.");
      if (!o.password) return bad("Enter a password.");
      const f = cleanUser({ login: o.login, name: o.name || o.login, password: o.password, admin: o.admin, edit: o.edit, pages: o.pages || [] }, auth, cfg, null);
      if (f.error) return bad(f.error);
      const id = crypto.randomBytes(6).toString("hex");
      next.users[id] = Object.assign({ admin: false, edit: false, pages: [], locked: false }, f, { createdAt: new Date(now).toISOString(), passwordAt: new Date(now).toISOString() });
      await saveAuth(next, now);
      await log(who, "user", { action: "created", login: f.login, label: f.name });
    } else if (o.action === "update" || o.action === "delete") {
      const u = Object.prototype.hasOwnProperty.call(next.users, o.id) ? next.users[o.id] : null;
      if (!u) return send(res, 404, { code: "invalid_argument", message: "No such account." });
      if (o.id === who.id && (o.action === "delete" || o.locked || o.admin === false)) return bad("You can't lock, remove or demote your own account.");
      if (o.action === "delete") { delete next.users[o.id]; await saveAuth(next, now); await log(who, "user", { action: "removed", login: u.login, label: u.name }); }
      else {
        const f = cleanUser({ login: o.login, name: o.name, password: o.password, admin: o.admin, edit: o.edit, pages: o.pages, locked: o.locked }, auth, cfg, o.id);
        if (f.error) return bad(f.error);
        if (f.hash) f.passwordAt = new Date(now).toISOString();
        const was = publicUser(o.id, u);
        next.users[o.id] = Object.assign({}, u, f);
        await saveAuth(next, now);
        const is = publicUser(o.id, next.users[o.id]);
        const changes = diff(was, is).filter((c) => c.k !== "passwordAt");
        if (f.hash) changes.push({ k: "password", from: null, to: "changed" });
        if (changes.length) await log(who, "user", { action: f.locked === true && !was.locked ? "locked" : f.locked === false && was.locked ? "unlocked" : "changed", login: is.login, label: is.name, changes });
      }
    } else return bad("Unknown action.");
    return send(res, 200, { ok: true, users: list() });
  }
  /** Settings → Backup (admins only): list, download one, make one now. */
  async function handleBackups(req, res, url, who, now) {
    if (!who.admin) return send(res, 403, { code: "forbidden", message: "Only an admin can use backups." });
    if (!store || !store.addBackup) return send(res, 503, { code: "no_database", message: "Server backups need the shared database." });
    if (req.method === "GET" && url.pathname === "/api/backups") return send(res, 200, { backups: await store.listBackups(), keep: BACKUP_KEEP });
    if (req.method === "GET" && url.pathname === "/api/backups/get") {
      const b = await store.getBackup(String(url.searchParams.get("id") || ""));
      if (!b) return send(res, 404, { code: "invalid_argument", message: "No such backup." });
      return send(res, 200, { app: "glana-pay", version: 1, exportedAt: b.at, reason: b.reason, docs: b.docs });
    }
    if (req.method === "POST" && url.pathname === "/api/backups") {
      const b = await backupNow("manual", now);
      if (!b) return send(res, 400, { code: "invalid_argument", message: "There is nothing to back up yet." });
      await log(who, "backup", { id: b.id });
      return send(res, 200, { ok: true, backups: await store.listBackups(), keep: BACKUP_KEEP });
    }
    return send(res, 405, { code: "bad_request", message: "Not allowed." });
  }

  return async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const fwd = cfg.trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
      const ip = fwd || (req.socket && req.socket.remoteAddress) || "";
      if (cfg.hosted && !cfg.password) {
        return send(res, 503, "This site is locked until APP_PASSWORD is set (Vercel: Settings → Environment Variables), then redeploy.", { "Content-Type": "text/plain; charset=utf-8" });
      }
      const isApi = url.pathname.startsWith("/api/");
      const html = { "Content-Type": "text/html; charset=utf-8" };
      const now = Date.now();
      let who = { id: "local", owner: true, login: "", name: "This computer", admin: true, edit: true, pages: PAGES.slice() }, auth = null;
      if (!cfg.password) {
        // Only possible on this computer (see the bottom of this file): no sign-in, so no sign-in page either.
        if (url.pathname === "/login" || url.pathname === "/logout") return send(res, 303, "", { Location: "/" });
      } else {
        try { auth = await authRecord(now); }
        catch (e) { return send(res, 503, isApi ? { code: "unavailable", message: "The database didn't answer. Try again in a minute." } : "The database didn't answer. Try again in a minute.", isApi ? {} : { "Content-Type": "text/plain; charset=utf-8" }); }
        const rec = ownerRecord(auth, cfg);
        who = whoFromToken(readCookie(req, COOKIE), cfg, auth, now);
        const signedIn = !!who;
        if (url.pathname === "/logout") {
          if (req.method !== "POST") return send(res, 303, "", { Location: signedIn ? "/" : "/login" });
          return send(res, 303, "", { Location: "/login", "Set-Cookie": cookieHeader(req, cfg, "", 0) });
        }
        if (url.pathname === "/login") {
          if (req.method === "GET") return signedIn ? send(res, 303, "", { Location: "/" }) : send(res, 200, loginPage(cfg, ""), html);
          if (req.method !== "POST") return send(res, 405, "Not allowed.", { "Content-Type": "text/plain; charset=utf-8" });
          if (tooMany(ip, now)) return send(res, 429, loginPage(cfg, "Too many wrong passwords. Try again in 15 minutes."), html);
          let given;
          try { given = await readLogin(req); } catch (e) { return send(res, 400, loginPage(cfg, "That didn't work. Please try again."), html); }
          // An empty login (or the owner's) is the owner; anything else must be an account made in Settings → People.
          const isOwner = !given.login || given.login === String(cfg.user).toLowerCase();
          const hit = isOwner ? null : Object.entries(usersOf(auth)).find(([, u]) => u.login === given.login);
          const ok = isOwner ? passwordOk(given.password, cfg, rec) : !!hit && !hit[1].locked && hashOk(given.password, hit[1]);
          if (!ok) {
            const left = failed(ip, now);
            return send(res, 401, loginPage(cfg, left <= 0 ? "Too many wrong passwords. Try again in 15 minutes." : isOwner ? "Wrong password. Please try again." : "Wrong login or password. Please try again.", isOwner ? "" : given.login), html);
          }
          fails.delete(ip);
          const me = isOwner ? ownerWho(cfg, auth) : userWho(hit[0], hit[1]);
          await log(me, "signin", {});
          const token = isOwner ? makeToken(sessionKey(cfg, rec), now) : makeToken(userKey(cfg, hit[0], hit[1]), now, hit[0]);
          return send(res, 303, "", { Location: "/", "Set-Cookie": cookieHeader(req, cfg, token, SESSION_MS / 1000) });
        }
        if (!signedIn) {
          if (isApi) return send(res, 401, { code: "login_required", message: "Sign in first." });
          return send(res, 303, "", { Location: "/login" });
        }
        if (url.pathname === "/api/password") {
          if (req.method !== "POST") return send(res, 405, { code: "bad_request", message: "Use POST." });
          if (!canChange) return send(res, 503, { code: "no_database", message: "Changing the password needs the shared database. Until then, change APP_PASSWORD on the server." });
          if (tooMany(ip, now)) return send(res, 429, { code: "too_many", message: "Too many wrong passwords. Try again in 15 minutes." });
          let ch;
          try { ch = await readPasswordChange(req); } catch (e) { return send(res, 400, { code: "bad_request", message: "Send a small JSON body." }); }
          if (ch.error) return send(res, 400, { code: "invalid_argument", message: ch.error });
          const mine = who.owner ? null : usersOf(auth)[who.id];
          if (!(who.owner ? passwordOk(ch.current, cfg, rec) : hashOk(ch.current, mine))) {
            const left = failed(ip, now);
            return send(res, left > 0 ? 403 : 429, { code: "wrong_password", message: left > 0 ? "The current password is wrong." : "Too many wrong passwords. Try again in 15 minutes." });
          }
          const changedAt = new Date(now).toISOString();
          const next = Object.assign({ v: 1 }, auth || {});
          let token;
          if (who.owner) { Object.assign(next, hashPassword(ch.next), { envTag: envTag(cfg), changedAt }); token = makeToken(sessionKey(cfg, next), now); }
          else { next.users = Object.assign({}, usersOf(auth)); next.users[who.id] = Object.assign({}, mine, hashPassword(ch.next), { passwordAt: changedAt }); token = makeToken(userKey(cfg, who.id, next.users[who.id]), now, who.id); }
          await saveAuth(next, now);
          await log(who, "password", {});
          // This person's other browsers are signed out (their cookies were signed with the old key). This one stays in.
          return send(res, 200, { ok: true, changedAt }, { "Set-Cookie": cookieHeader(req, cfg, token, SESSION_MS / 1000) });
        }
        if (url.pathname === "/api/users") return await handleUsers(req, res, who, auth, now);
      }
      if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, statusBody(cfg, store, canChange, auth, who));
      if (url.pathname === "/api/db" || url.pathname === "/api/db/doc") return await handleDb(req, res, url, store, who, hooks(now));
      if (url.pathname === "/api/history") {
        if (req.method !== "GET") return send(res, 405, { code: "bad_request", message: "Use GET." });
        if (!who.admin) return send(res, 403, { code: "forbidden", message: "Only an admin can read the change history." });
        if (!store || !store.getLog) return send(res, 503, { code: "no_database", message: "The change history needs the shared database." });
        const limit = Math.max(1, Math.min(1000, Math.floor(Number(url.searchParams.get("limit")) || 300)));
        return send(res, 200, { entries: await store.getLog(limit) });
      }
      if (url.pathname === "/api/backups" || url.pathname === "/api/backups/get") return await handleBackups(req, res, url, who, now);
      if (url.pathname === "/api/jira/search") {
        if (req.method !== "POST") return send(res, 405, { code: "bad_request", message: "Use POST." });
        if (!who.admin && !(who.edit && who.pages.includes("tasks"))) return send(res, 403, { code: "forbidden", message: "Your account can't pull from Jira." });
        if (!cfg.jiraEmail || !cfg.jiraToken) return send(res, 503, { code: "not_configured", message: "Set JIRA_EMAIL and JIRA_API_TOKEN on the server." });
        let body;
        try { body = JSON.parse(await readBody(req, 16 * 1024)); } catch (e) { return send(res, e && e.status === 413 ? 413 : 400, { code: "bad_request", message: "Send a small JSON body." }); }
        const search = buildSearch(body);
        if (search.error) return send(res, 400, { code: "bad_request", message: search.error });
        const out = await searchJira(cfg, search, fetchImpl);
        return send(res, out.status, out.body);
      }
      const file = FILES[url.pathname];
      if (req.method === "GET" && file) {
        const data = fs.readFileSync(path.join(ROOT, file));
        return send(res, 200, data, { "Content-Type": TYPES[path.extname(file)] });
      }
      return send(res, 404, "Not found.", { "Content-Type": "text/plain; charset=utf-8" });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { code: "server_error", message: "Something went wrong on the server." });
    }
  };
}
function createServer(cfg, opts) { return http.createServer(createHandler(cfg, opts)); }

if (require.main === module) {
  loadEnvFile(path.join(ROOT, ".env"));
  const cfg = configFromEnv(process.env);
  if (!cfg.password && !isLoopback(cfg.host)) {
    console.error("Refusing to start: set APP_PASSWORD before listening on " + cfg.host + " (salaries are confidential).");
    process.exit(1);
  }
  const store = DB.storeFromEnv(process.env, ROOT);
  createServer(cfg, { store }).listen(cfg.port, cfg.host, () => {
    console.log(`Glana Pay running at http://${cfg.host === "0.0.0.0" ? "localhost" : cfg.host}:${cfg.port}`);
    console.log(cfg.jiraEmail && cfg.jiraToken ? `Jira: ${cfg.jiraSite} as ${cfg.jiraEmail}` : "Jira: not connected (set JIRA_EMAIL and JIRA_API_TOKEN). CSV upload still works.");
    console.log(cfg.password ? "Website password: on (sign-in page at /login)" : "Website password: off (only this computer can open it)");
    console.log(store ? `Shared data: ${store.kind === "file" ? "data/db.json" : store.kind}` : "Shared data: none");
  });
}

module.exports = { createServer, createHandler, configFromEnv, buildSearch, slimIssue, searchJira, diff, PAGES };
