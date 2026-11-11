/* Glana Pay server: serves the website and reads Jira for it.
 *
 * The browser never sees the Jira token. It asks this server for "tasks resolved between two dates";
 * the server builds the JQL itself (engine.js → jiraJql), calls Jira Cloud's REST search, and returns
 * only the fields the calculator needs (no e-mail addresses or avatars). Nothing in Jira is changed.
 *
 * Settings come from environment variables (or a .env file next to this one, see .env.example):
 *   JIRA_EMAIL, JIRA_API_TOKEN   Atlassian account e-mail + API token (read access to the projects)
 *   JIRA_SITE                    default glana.atlassian.net
 *   APP_PASSWORD                 password for the website (user name APP_USER, default "glana").
 *                                Required unless the server only listens on this computer.
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
/** Only these files are served. Everything else (server.js, .env, tests…) is never sent. */
const FILES = { "/": "index.html", "/index.html": "index.html", "/engine.js": "engine.js", "/app.js": "app.js" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};
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
    user: env.APP_USER || "glana",
    password,
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
function checkPassword(req, cfg) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const raw = Buffer.from(h.slice(6), "base64").toString("utf8");
  const i = raw.indexOf(":");
  if (i < 0) return false;
  const userOk = crypto.timingSafeEqual(sha(raw.slice(0, i)), sha(cfg.user));
  const passOk = crypto.timingSafeEqual(sha(raw.slice(i + 1)), sha(cfg.password));
  return userOk && passOk;
}

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
async function handleDb(req, res, url, store) {
  if (!store) return send(res, 503, { code: "no_database", message: "The shared database isn't connected." });
  try {
    if (req.method === "GET" && url.pathname === "/api/db") {
      const since = url.searchParams.get("since");
      if (since != null && Number(since) === (await store.rev())) return send(res, 200, { unchanged: true, rev: Number(since) });
      return send(res, 200, await store.all());
    }
    if (req.method === "GET" && url.pathname === "/api/db/doc") {
      const p = url.searchParams.get("path");
      if (!DB.validPath(p)) return send(res, 400, { code: "invalid_argument", message: "Unknown document path." });
      return send(res, 200, { path: p, data: await store.get(p) });
    }
    if (req.method === "POST" && url.pathname === "/api/db") {
      const body = JSON.parse(await readBody(req, 3 * 1024 * 1024));
      const ops = Array.isArray(body && body.ops) ? body.ops : [];
      if (!ops.length || ops.length > 50) return send(res, 400, { code: "invalid_argument", message: "Send 1 to 50 changes." });
      const results = [];
      for (const op of ops) results.push(await DB.applyOp(store, op));
      return send(res, 200, { results, rev: await store.rev() });
    }
    if (req.method === "PUT" && url.pathname === "/api/db") {
      const body = JSON.parse(await readBody(req, 4 * 1024 * 1024));
      const bad = DB.checkAll(body && body.docs);
      if (bad) return send(res, 400, { code: "invalid_argument", message: bad });
      await store.replaceAll(body.docs);
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
/** The request handler, shared by the Node server below and Vercel (api/index.js).
 *  opts.store: shared database (store.js) or null; opts.fetch: for tests. */
function createHandler(cfg, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetch || globalThis.fetch;
  const store = opts.store || null;
  const fails = new Map(); // ip -> [timestamps] of wrong passwords
  return async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const fwd = cfg.trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
      const ip = fwd || (req.socket && req.socket.remoteAddress) || "";
      if (cfg.hosted && !cfg.password) {
        return send(res, 503, "This site is locked until APP_PASSWORD is set (Vercel: Settings → Environment Variables), then redeploy.", { "Content-Type": "text/plain; charset=utf-8" });
      }
      if (cfg.password) {
        const now = Date.now(); const recent = (fails.get(ip) || []).filter((t) => now - t < 15 * 60000);
        if (recent.length >= 10) return send(res, 429, "Too many wrong passwords. Try again in 15 minutes.", { "Content-Type": "text/plain; charset=utf-8" });
        if (!checkPassword(req, cfg)) {
          if (req.headers.authorization) { recent.push(now); fails.set(ip, recent); }
          return send(res, 401, "Password required.", { "Content-Type": "text/plain; charset=utf-8", "WWW-Authenticate": 'Basic realm="Glana Pay", charset="UTF-8"' });
        }
        fails.delete(ip);
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        return send(res, 200, { ok: true, jira: !!(cfg.jiraEmail && cfg.jiraToken), site: cfg.jiraSite, db: store ? store.kind : null, hosted: !!cfg.hosted });
      }
      if (url.pathname === "/api/db" || url.pathname === "/api/db/doc") return await handleDb(req, res, url, store);
      if (url.pathname === "/api/jira/search") {
        if (req.method !== "POST") return send(res, 405, { code: "bad_request", message: "Use POST." });
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
    console.log(cfg.password ? `Website password: on (user "${cfg.user}")` : "Website password: off (only this computer can open it)");
    console.log(store ? `Shared data: ${store.kind === "file" ? "data/db.json" : store.kind}` : "Shared data: none");
  });
}

module.exports = { createServer, createHandler, configFromEnv, buildSearch, slimIssue, searchJira };
