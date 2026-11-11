/* Tests for server.js (Jira connection + website protection). Run: node tests/server.test.js */
const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { createServer, buildSearch, configFromEnv } = require("../server.js");
const DB = require("../store.js");
const { startFakeJira } = require("./fake_jira.js");
const E = require("../engine.js");

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; } catch (e) { fail++; console.log("FAIL:", name, "\n   ", e.message); } }

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

(async () => {
  // ---------- query building (the browser never sends JQL) ----------
  await t("JQL built on the server, same as the engine", () => {
    const s = buildSearch({ from: "2026-12-01", to: "2027-01-01", projects: "GOD, PRJ, AWE", issueTypes: ["Task", "Subtask", "Sub-task", "Bug"] });
    assert.strictEqual(s.jql, 'project in (GOD, PRJ, AWE) AND issuetype in ("Task", "Subtask", "Bug") AND resolved >= "2026-12-01" AND resolved < "2027-01-01" ORDER BY resolved ASC');
    assert.strictEqual(s.maxResults, 100); assert.strictEqual(s.nextPageToken, null);
  });
  await t("bad requests are refused", () => {
    for (const b of [
      null, {}, { from: "2026-12-01" }, { from: "2026-12-01", to: "2026-11-01" }, { from: "2026-13-01", to: "2027-01-01" },
      { from: "2026-12-01", to: "2027-01-01", projects: 'GOD) OR project = "HR' },
      { from: "2026-12-01", to: "2027-01-01", issueTypes: ['Task") OR ("1'] },
      { from: "2024-01-01", to: "2027-01-01" },
      { from: "2026-12-01", to: "2027-01-01", nextPageToken: "x".repeat(5000) },
    ]) assert.ok(buildSearch(b).error, JSON.stringify(b));
  });
  await t("maxResults is clamped to 1..100", () => {
    assert.strictEqual(buildSearch({ from: "2026-12-01", to: "2027-01-01", maxResults: 5000 }).maxResults, 100);
    assert.strictEqual(buildSearch({ from: "2026-12-01", to: "2027-01-01", maxResults: -3 }).maxResults, 1);
  });

  // ---------- running server ----------
  const jira = await startFakeJira();
  const cfg = configFromEnv({ JIRA_BASE_URL: jira.url, JIRA_EMAIL: "bot@example.com", JIRA_API_TOKEN: "secret-token", APP_PASSWORD: "pw-123", JIRA_SITE: "glana.atlassian.net" });
  const srv = createServer(cfg); const base = await listen(srv);
  const AUTH = { authorization: basic("glana", "pw-123") };
  const search = (body, headers) => fetch(base + "/api/jira/search", { method: "POST", headers: Object.assign({ "content-type": "application/json" }, AUTH, headers || {}), body: JSON.stringify(body) });

  await t("password protects every page", async () => {
    for (const p of ["/", "/app.js", "/api/status"]) {
      const r = await fetch(base + p); assert.strictEqual(r.status, 401, p);
      assert.match(r.headers.get("www-authenticate"), /Basic/);
    }
    assert.strictEqual((await fetch(base + "/", { headers: { authorization: basic("glana", "wrong") } })).status, 401);
    assert.strictEqual((await fetch(base + "/", { headers: AUTH })).status, 200);
  });
  await t("only the app files are served", async () => {
    for (const p of ["/server.js", "/.env", "/package.json", "/tests/fake_jira.js", "/../server.js", "/docs/SPEC.md"]) assert.strictEqual((await fetch(base + p, { headers: AUTH })).status, 404, p);
    const r = await fetch(base + "/engine.js", { headers: AUTH });
    assert.strictEqual(r.status, 200); assert.match(r.headers.get("content-type"), /javascript/);
    assert.strictEqual(r.headers.get("x-frame-options"), "DENY");
  });
  await t("status says Jira is connected", async () => {
    assert.deepStrictEqual(await (await fetch(base + "/api/status", { headers: AUTH })).json(), { ok: true, jira: true, site: "glana.atlassian.net", db: null, hosted: false });
  });

  let pulled = [];
  await t("pages are followed to the end (3 per page)", async () => {
    for (const [from, to] of E.jiraRanges("2026-11", E.DEFAULT_SETTINGS)) {
      let token = null, pages = 0;
      do {
        const r = await search({ from, to, projects: "GOD, PRJ, AWE", issueTypes: E.DEFAULT_SETTINGS.issueTypes, nextPageToken: token });
        assert.strictEqual(r.status, 200);
        const d = await r.json(); pages++;
        pulled.push(...d.issues);
        token = d.isLast ? null : d.nextPageToken;
      } while (token);
      if (from === "2026-11-01") assert.strictEqual(pages, 4); // 11 November tasks / 3 per page
    }
    assert.deepStrictEqual(pulled.map((i) => i.key).sort(), ["AWE-22", "AWE-8", "GOD-6", "PRJ-1", "PRJ-11", "PRJ-12", "PRJ-2", "PRJ-20", "PRJ-21", "PRJ-3", "PRJ-4", "PRJ-5", "PRJ-7", "PRJ-9"]);
    assert.ok(jira.requests.every((b) => b.fields.includes("customfield_10200") && b.jql.startsWith("project in (GOD, PRJ, AWE)")));
  });
  await t("no e-mails or avatars leave the server", () => {
    const s = JSON.stringify(pulled);
    assert.ok(!s.includes("@") && !s.includes("avatar") && !s.includes("accountId"));
  });
  await t("pulled tasks map like the connector's", () => {
    const x = E.taskFromJiraApi(pulled.find((i) => i.key === "PRJ-7"));
    assert.deepStrictEqual([x.assignee, x.priority, x.resolved, x.due, x.submitted, x.rejections, x.reopened], ["Ani Example", "High", "2026-11-25", "2026-11-19", "2026-11-23", 1, 0]);
  });
  await t("worked example from pulled tasks: 820,800", () => {
    const tasks = pulled.map(E.taskFromJiraApi);
    const r = E.computePerson({ id: "ani", name: "Ani", jiraName: "Ani Example", salary: 900000 }, "2026-11",
      { tasks, hours: { worked: 162.5, leave: 1 }, incidents: [{ level: "major" }, { level: "minor" }] }, E.DEFAULT_SETTINGS);
    assert.deepStrictEqual(r.tasks.map((x) => x.score).sort((a, b) => a - b), [40, 75, 80, 100, 100, 100, 100, 100]);
    assert.strictEqual(r.score, 86.9); assert.strictEqual(r.total, 820800);
  });
  await t("bad request body → 400", async () => {
    const r = await search({ from: "2026-11-01", to: "2026-10-01" });
    assert.strictEqual(r.status, 400); assert.strictEqual((await r.json()).code, "bad_request");
    const r2 = await fetch(base + "/api/jira/search", { method: "POST", headers: AUTH, body: "not json" });
    assert.strictEqual(r2.status, 400);
  });

  // wrong token / not configured
  const srvBad = createServer(Object.assign({}, cfg, { jiraToken: "wrong" })); const baseBad = await listen(srvBad);
  await t("Jira refusing the token → jira_auth", async () => {
    const r = await fetch(baseBad + "/api/jira/search", { method: "POST", headers: AUTH, body: JSON.stringify({ from: "2026-11-01", to: "2026-12-01" }) });
    assert.strictEqual(r.status, 502); assert.strictEqual((await r.json()).code, "jira_auth");
  });
  const srvNone = createServer(Object.assign({}, cfg, { jiraEmail: "", jiraToken: "" })); const baseNone = await listen(srvNone);
  await t("no token → not_configured, status jira:false", async () => {
    assert.strictEqual((await (await fetch(baseNone + "/api/status", { headers: AUTH })).json()).jira, false);
    const r = await fetch(baseNone + "/api/jira/search", { method: "POST", headers: AUTH, body: JSON.stringify({ from: "2026-11-01", to: "2026-12-01" }) });
    assert.strictEqual(r.status, 503); assert.strictEqual((await r.json()).code, "not_configured");
  });
  await t("Jira down → server_unavailable", async () => {
    const srvDown = createServer(Object.assign({}, cfg, { jiraBase: "http://127.0.0.1:1" })); const b = await listen(srvDown);
    const r = await fetch(b + "/api/jira/search", { method: "POST", headers: AUTH, body: JSON.stringify({ from: "2026-11-01", to: "2026-12-01" }) });
    assert.strictEqual((await r.json()).code, "server_unavailable"); srvDown.close();
  });
  await t("10 wrong passwords → locked out for a while", async () => {
    const s = createServer(cfg); const b = await listen(s);
    for (let i = 0; i < 10; i++) assert.strictEqual((await fetch(b + "/", { headers: { authorization: basic("glana", "guess" + i) } })).status, 401);
    assert.strictEqual((await fetch(b + "/", { headers: AUTH })).status, 429);
    s.close();
  });
  await t("on Vercel without a password: everything stays locked", async () => {
    const s2 = createServer(configFromEnv({ VERCEL: "1", JIRA_EMAIL: "a", JIRA_API_TOKEN: "b" }), { store: DB.MemoryStore({ "team/a": { salary: 1 } }) }); const b2 = await listen(s2);
    for (const p of ["/", "/api/db", "/api/status", "/app.js"]) { const r = await fetch(b2 + p); assert.strictEqual(r.status, 503, p); assert.match(await r.text(), /APP_PASSWORD/); }
    s2.close();
  });
  await t("refuses to go online without a password", () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { PATH: process.env.PATH, HOST: "0.0.0.0", PORT: "0" }, encoding: "utf8", timeout: 10000 });
    assert.strictEqual(r.status, 1); assert.match(r.stderr, /APP_PASSWORD/);
  });

  // ---------- shared data ----------
  async function dbSuite(label, store) {
    const s = createServer(cfg, { store }); const b = await listen(s);
    const call = (method, p, body) => fetch(b + p, { method, headers: Object.assign({ "content-type": "application/json" }, AUTH), body: body ? JSON.stringify(body) : undefined });
    await t(`${label}: write, merge, read back`, async () => {
      let r = await call("POST", "/api/db", { ops: [{ op: "set", path: "team/ani", data: { name: "Ani", salary: 900000 } }, { op: "set", path: "months/2026-11", data: { month: "2026-11" } }] });
      assert.strictEqual(r.status, 200);
      r = await call("POST", "/api/db", { ops: [{ op: "update", path: "months/2026-11", data: { hours: { ani: { worked: 162.5 } } } }] });
      r = await call("POST", "/api/db", { ops: [{ op: "update", path: "months/2026-11", data: { hours: { ani: { leave: 1 } } } }] });
      assert.deepStrictEqual((await r.json()).results[0].data, { month: "2026-11", hours: { ani: { worked: 162.5, leave: 1 } } });
      const all = await (await call("GET", "/api/db")).json();
      assert.deepStrictEqual(Object.keys(all.docs).sort(), ["months/2026-11", "team/ani"]);
      assert.strictEqual(all.docs["team/ani"].salary, 900000);
      assert.deepStrictEqual(await (await call("GET", "/api/db?since=" + all.rev)).json(), { unchanged: true, rev: all.rev });
      assert.deepStrictEqual((await (await call("GET", "/api/db/doc?path=team/ani")).json()).data, { name: "Ani", salary: 900000 });
      assert.strictEqual((await (await call("GET", "/api/db/doc?path=team/nobody")).json()).data, null);
    });
    await t(`${label}: delete, missing update, bad paths`, async () => {
      assert.strictEqual((await call("POST", "/api/db", { ops: [{ op: "delete", path: "team/ani" }] })).status, 200);
      assert.strictEqual((await call("POST", "/api/db", { ops: [{ op: "update", path: "team/ani", data: { x: 1 } }] })).status, 404);
      for (const p of ["../etc", "secrets/x", "team/a/b", "months/2026-11/salaries/x", ""]) assert.strictEqual((await call("POST", "/api/db", { ops: [{ op: "set", path: p, data: {} }] })).status, 400, p);
      assert.strictEqual((await call("POST", "/api/db", { ops: [{ op: "set", path: "team/x", data: [1] }] })).status, 400);
    });
    await t(`${label}: restore a backup replaces everything`, async () => {
      const r = await call("PUT", "/api/db", { docs: { "team/a": { name: "A" }, "config/settings": { basePct: 80 } } });
      assert.deepStrictEqual(Object.keys((await r.json()).docs).sort(), ["config/settings", "team/a"]);
      assert.strictEqual((await call("PUT", "/api/db", { docs: { "evil/x": {} } })).status, 400);
    });
    await t(`${label}: password needed`, async () => {
      assert.strictEqual((await fetch(b + "/api/db")).status, 401);
    });
    s.close();
  }
  await dbSuite("memory db", DB.MemoryStore());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "glana-"));
  const file = path.join(tmp, "db.json");
  await dbSuite("file db", DB.FileStore(file));
  await t("file db survives a restart", async () => {
    const again = DB.FileStore(file);
    assert.deepStrictEqual((await again.all()).docs, { "team/a": { name: "A" }, "config/settings": { basePct: 80 } });
  });
  fs.rmSync(tmp, { recursive: true, force: true });

  // fake Upstash REST API (just the commands store.js uses)
  const hash = new Map(); let rev = 0; const seen = [];
  const run = (c) => {
    const [cmd, ...a] = c; seen.push(cmd);
    if (cmd === "HGETALL") return [...hash].flat();
    if (cmd === "HGET") return hash.has(a[1]) ? hash.get(a[1]) : null;
    if (cmd === "HSET") { for (let i = 1; i < a.length; i += 2) hash.set(a[i], a[i + 1]); return 1; }
    if (cmd === "HDEL") return hash.delete(a[1]) ? 1 : 0;
    if (cmd === "DEL") { hash.clear(); return 1; }
    if (cmd === "INCR") return ++rev;
    if (cmd === "GET") return rev ? String(rev) : null;
    throw new Error("unknown " + cmd);
  };
  const upstash = http.createServer((req, res) => {
    let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
      if (req.headers.authorization !== "Bearer up-token") { res.writeHead(401); return res.end(JSON.stringify({ error: "Unauthorized" })); }
      const body = JSON.parse(raw);
      const out = req.url === "/" ? { result: run(body) } : body.map((c) => ({ result: run(c) }));
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
    });
  });
  const upUrl = await listen(upstash);
  await dbSuite("redis db", DB.storeFromEnv({ KV_REST_API_URL: upUrl, KV_REST_API_TOKEN: "up-token", VERCEL: "1" }, "/nowhere"));
  await t("redis db uses transactions for writes", () => assert.ok(seen.includes("INCR") && seen.includes("HGETALL")));
  await t("redis db: wrong token → clear error", async () => {
    const bad = DB.RedisStore(upUrl, "nope");
    await assert.rejects(bad.all(), (e) => e.code === "unavailable");
  });
  upstash.close();
  await t("database found under any Vercel prefix", () => {
    assert.strictEqual(DB.storeFromEnv({ VERCEL: "1", STORAGE_REST_API_URL: "https://x", STORAGE_REST_API_TOKEN: "t", STORAGE_REST_API_READ_ONLY_TOKEN: "r" }, "/x").kind, "redis");
    assert.strictEqual(DB.storeFromEnv({ VERCEL: "1", STORAGE_REST_API_URL: "https://x" }, "/x"), null);
  });
  await t("Vercel without a database → none (not the read-only disk)", () => assert.strictEqual(DB.storeFromEnv({ VERCEL: "1" }, "/x"), null));
  await t("no database → clear 503", async () => {
    const r = await fetch(base + "/api/db", { headers: AUTH });
    assert.strictEqual(r.status, 503); assert.strictEqual((await r.json()).code, "no_database");
  });

  srv.close(); srvBad.close(); srvNone.close(); jira.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
