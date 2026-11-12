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
/** Post the sign-in form like a browser does (without following the redirect). */
const signIn = (base, password, headers) => fetch(base + "/login", { method: "POST", redirect: "manual", headers: Object.assign({ "content-type": "application/x-www-form-urlencoded" }, headers || {}), body: new URLSearchParams({ username: "glana", password }).toString() });
const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
const get = (url, headers) => fetch(url, { redirect: "manual", headers: headers || {} });

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
  const AUTH = { cookie: cookieOf(await signIn(base, "pw-123")) }; // the cookie is signed with the password, so it works on every test server with "pw-123"
  const search = (body, headers) => fetch(base + "/api/jira/search", { method: "POST", headers: Object.assign({ "content-type": "application/json" }, AUTH, headers || {}), body: JSON.stringify(body) });

  await t("not signed in: pages go to /login, the API answers 401 JSON, no browser popup", async () => {
    for (const p of ["/", "/index.html", "/app.js", "/engine.js", "/server.js", "/anything"]) {
      const r = await get(base + p); assert.strictEqual(r.status, 303, p); assert.strictEqual(r.headers.get("location"), "/login", p);
      assert.strictEqual(await r.text(), "", p);
    }
    for (const p of ["/api/status", "/api/db", "/api/jira/search"]) {
      const r = await get(base + p); assert.strictEqual(r.status, 401, p);
      assert.strictEqual(r.headers.get("www-authenticate"), null);
      assert.strictEqual((await r.json()).code, "login_required");
    }
    // the old Basic header no longer opens anything
    assert.strictEqual((await get(base + "/", { authorization: "Basic " + Buffer.from("glana:pw-123").toString("base64") })).status, 303);
  });
  await t("the sign-in page is shown before sign-in and has nothing of the app in it", async () => {
    const r = await get(base + "/login"); assert.strictEqual(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
    const html = await r.text();
    assert.match(html, /<form method="post" action="\/login"/); assert.match(html, /type="password"/); assert.match(html, /Sign in/);
    assert.ok(!/app\.js|engine\.js|loginError/.test(html));
  });
  await t("wrong password: 401, a clear message, no cookie", async () => {
    const r = await signIn(base, "wrong"); assert.strictEqual(r.status, 401);
    assert.strictEqual(r.headers.get("set-cookie"), null);
    assert.match(await r.text(), /id="loginError"[^>]*>Wrong password\. Please try again\./);
    assert.strictEqual((await signIn(base, "")).status, 401);
  });
  await t("right password: cookie for 7 days (HttpOnly, SameSite=Lax), then the app opens", async () => {
    const r = await signIn(base, "pw-123"); assert.strictEqual(r.status, 303); assert.strictEqual(r.headers.get("location"), "/");
    const c = r.headers.get("set-cookie");
    assert.match(c, /^glana_session=v1\.\d+\.[\w-]{43}; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
    assert.ok(!c.includes("pw-123"));
    const home = await get(base + "/", AUTH); assert.strictEqual(home.status, 200); assert.match(await home.text(), /<title>Glana Pay<\/title>/);
    assert.strictEqual((await get(base + "/app.js", AUTH)).status, 200);
    assert.strictEqual((await get(base + "/login", AUTH)).headers.get("location"), "/"); // already signed in
    const viaJson = await fetch(base + "/login", { method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "pw-123" }) });
    assert.strictEqual(viaJson.status, 303);
  });
  await t("the cookie is marked Secure on Vercel and behind HTTPS", async () => {
    const s = createServer(configFromEnv({ VERCEL: "1", APP_PASSWORD: "pw-123" })); const b = await listen(s);
    assert.match((await signIn(b, "pw-123")).headers.get("set-cookie"), /; HttpOnly; SameSite=Lax; Secure$/);
    s.close();
    assert.match((await signIn(base, "pw-123", { "x-forwarded-proto": "https" })).headers.get("set-cookie"), /; Secure$/);
  });
  await t("forged, changed and expired cookies are refused", async () => {
    const [, exp, sig] = AUTH.cookie.split("=")[1].split(".");
    const realNow = Date.now;
    const bad = [
      "glana_session=", "glana_session=v1", `glana_session=v1.${Number(exp) + 1000}.${sig}`, `glana_session=v1.${exp}.${"A".repeat(43)}`,
      `glana_session=v1.${exp}.${sig}x`, `glana_session=v2.${exp}.${sig}`, `other=v1.${exp}.${sig}`,
    ];
    for (const c of bad) assert.strictEqual((await get(base + "/api/status", { cookie: c })).status, 401, c);
    assert.strictEqual((await get(base + "/api/status", { cookie: "a=b; " + AUTH.cookie + "; c=d" })).status, 200);
    try {
      Date.now = () => realNow() + 7 * 86400000 - 60000; assert.strictEqual((await get(base + "/api/status", AUTH)).status, 200);
      Date.now = () => realNow() + 7 * 86400000 + 60000; assert.strictEqual((await get(base + "/api/status", AUTH)).status, 401);
    } finally { Date.now = realNow; }
  });
  await t("changing APP_PASSWORD (or SESSION_SECRET) signs everyone out", async () => {
    for (const env of [{ APP_PASSWORD: "new-pw" }, { APP_PASSWORD: "pw-123", SESSION_SECRET: "extra" }]) {
      const s = createServer(configFromEnv(env)); const b = await listen(s);
      assert.strictEqual((await get(b + "/api/status", AUTH)).status, 401);
      assert.strictEqual((await get(b + "/", AUTH)).headers.get("location"), "/login");
      const fresh = { cookie: cookieOf(await signIn(b, env.APP_PASSWORD)) };
      assert.strictEqual((await get(b + "/api/status", fresh)).status, 200);
      s.close();
    }
  });
  await t("log out clears the cookie", async () => {
    const r = await fetch(base + "/logout", { method: "POST", redirect: "manual", headers: AUTH });
    assert.strictEqual(r.status, 303); assert.strictEqual(r.headers.get("location"), "/login");
    assert.match(r.headers.get("set-cookie"), /^glana_session=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax$/);
    assert.strictEqual((await get(base + "/logout", AUTH)).headers.get("set-cookie"), null); // a plain link can't log you out
  });
  await t("only the app files are served", async () => {
    for (const p of ["/server.js", "/.env", "/package.json", "/tests/fake_jira.js", "/../server.js", "/docs/SPEC.md"]) assert.strictEqual((await fetch(base + p, { headers: AUTH })).status, 404, p);
    const r = await fetch(base + "/engine.js", { headers: AUTH });
    assert.strictEqual(r.status, 200); assert.match(r.headers.get("content-type"), /javascript/);
    assert.strictEqual(r.headers.get("x-frame-options"), "DENY");
  });
  await t("status says Jira is connected", async () => {
    assert.deepStrictEqual(await (await fetch(base + "/api/status", { headers: AUTH })).json(), { ok: true, jira: true, site: "glana.atlassian.net", db: null, hosted: false, auth: true, user: "glana", passwordChange: false, passwordChangedAt: null });
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
    for (let i = 0; i < 10; i++) assert.strictEqual((await signIn(b, "guess" + i)).status, 401);
    const r = await signIn(b, "pw-123"); // even the right password has to wait now
    assert.strictEqual(r.status, 429); assert.strictEqual(r.headers.get("set-cookie"), null);
    assert.match(await r.text(), /Too many wrong passwords\. Try again in 15 minutes\./);
    assert.strictEqual((await get(b + "/api/status", AUTH)).status, 200); // someone already signed in keeps working
    const realNow = Date.now;
    try { Date.now = () => realNow() + 15 * 60000 + 1000; assert.strictEqual((await signIn(b, "pw-123")).status, 303); } finally { Date.now = realNow; }
    s.close();
  });
  await t("a right password resets the wrong-password count", async () => {
    const s = createServer(cfg); const b = await listen(s);
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 9; i++) assert.strictEqual((await signIn(b, "guess" + i)).status, 401);
      assert.strictEqual((await signIn(b, "pw-123")).status, 303);
    }
    s.close();
  });
  await t("no password (this computer only): no sign-in, /login goes to the app", async () => {
    const s = createServer(configFromEnv({})); const b = await listen(s);
    assert.strictEqual((await get(b + "/")).status, 200);
    assert.strictEqual((await (await get(b + "/api/status")).json()).auth, false);
    assert.strictEqual((await get(b + "/login")).headers.get("location"), "/");
    s.close();
  });
  await t("on Vercel without a password: everything stays locked", async () => {
    const s2 = createServer(configFromEnv({ VERCEL: "1", JIRA_EMAIL: "a", JIRA_API_TOKEN: "b" }), { store: DB.MemoryStore({ "team/a": { salary: 1 } }) }); const b2 = await listen(s2);
    for (const p of ["/", "/login", "/api/db", "/api/status", "/app.js"]) { const r = await fetch(b2 + p); assert.strictEqual(r.status, 503, p); assert.match(await r.text(), /APP_PASSWORD/); }
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
      assert.strictEqual((await fetch(b + "/api/db", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops: [{ op: "set", path: "team/x", data: { name: "X" } }] }) })).status, 401);
    });
    s.close();
  }
  await dbSuite("memory db", DB.MemoryStore());

  // ---------- Settings → Password ----------
  const changePw = (b, cookie, body, raw) => fetch(b + "/api/password", { method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/json" }, body: raw || JSON.stringify(body) });
  await t("password: change it, old cookies stop working, this browser stays in", async () => {
    const store = DB.MemoryStore({ "team/a": { name: "A" } });
    const s = createServer(configFromEnv({ APP_PASSWORD: "pw-123" }), { store }); const b = await listen(s);
    const me = cookieOf(await signIn(b, "pw-123")), other = cookieOf(await signIn(b, "pw-123"));
    const st = await (await get(b + "/api/status", { cookie: me })).json();
    assert.strictEqual(st.passwordChange, true); assert.strictEqual(st.passwordChangedAt, null);
    assert.strictEqual((await fetch(b + "/api/password", { headers: { cookie: me } })).status, 405);
    assert.strictEqual((await changePw(b, "", { current: "pw-123", next: "new-password-1" })).status, 401);
    for (const [body, re] of [[{ current: "pw-123", next: "short" }, /at least 8/], [{ current: "pw-123", next: "pw-123" }, /same/], [{ current: "pw-123", next: "        " }, /spaces/], [{ current: "pw-123", next: "x".repeat(201) }, /200/], [{ next: "new-password-1" }, /current/]]) {
      const r = await changePw(b, me, body); assert.strictEqual(r.status, 400); assert.match((await r.json()).message, re);
    }
    assert.strictEqual((await changePw(b, me, null, "{oops")).status, 400);
    const wrong = await changePw(b, me, { current: "nope", next: "new-password-1" });
    assert.strictEqual(wrong.status, 403); assert.strictEqual((await wrong.json()).code, "wrong_password");
    const ok = await changePw(b, me, { current: "pw-123", next: "new-password-1" });
    assert.strictEqual(ok.status, 200);
    const fresh = cookieOf(ok); assert.match(ok.headers.get("set-cookie"), /^glana_session=v1\.\d+\.[\w-]{43}; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
    // the record holds a hash, never the password, and is not in the shared documents or backups
    const rec = await store.getAuth(); assert.ok(rec.hash && rec.salt); assert.ok(!JSON.stringify(rec).includes("new-password-1"));
    assert.deepStrictEqual(Object.keys((await (await get(b + "/api/db", { cookie: fresh })).json()).docs), ["team/a"]);
    assert.strictEqual((await get(b + "/api/status", { cookie: me })).status, 401);
    assert.strictEqual((await get(b + "/api/status", { cookie: other })).status, 401);
    const st2 = await (await get(b + "/api/status", { cookie: fresh })).json(); assert.strictEqual(st2.passwordChangedAt, rec.changedAt);
    assert.strictEqual((await signIn(b, "pw-123")).status, 401);
    assert.strictEqual((await signIn(b, "new-password-1")).status, 303);
    // restoring a backup keeps the new password
    await fetch(b + "/api/db", { method: "PUT", headers: { cookie: fresh, "content-type": "application/json" }, body: JSON.stringify({ docs: {} }) });
    assert.strictEqual((await signIn(b, "new-password-1")).status, 303);
    s.close();
    // a fresh copy of the server (Vercel) reads it from the database
    const s2 = createServer(configFromEnv({ APP_PASSWORD: "pw-123" }), { store }); const b2 = await listen(s2);
    assert.strictEqual((await get(b2 + "/api/status", { cookie: fresh })).status, 200);
    assert.strictEqual((await signIn(b2, "pw-123")).status, 401);
    s2.close();
    // forgot it? changing APP_PASSWORD on the server brings the server password back
    const s3 = createServer(configFromEnv({ APP_PASSWORD: "reset-pw" }), { store }); const b3 = await listen(s3);
    assert.strictEqual((await signIn(b3, "new-password-1")).status, 401);
    assert.strictEqual((await signIn(b3, "reset-pw")).status, 303);
    s3.close();
  });
  await t("password: wrong current passwords count toward the sign-in lock", async () => {
    const s = createServer(configFromEnv({ APP_PASSWORD: "pw-123" }), { store: DB.MemoryStore() }); const b = await listen(s);
    const me = cookieOf(await signIn(b, "pw-123"));
    for (let i = 0; i < 9; i++) assert.strictEqual((await changePw(b, me, { current: "bad", next: "new-password-1" })).status, 403);
    assert.strictEqual((await changePw(b, me, { current: "bad", next: "new-password-1" })).status, 429);
    assert.strictEqual((await changePw(b, me, { current: "pw-123", next: "new-password-1" })).status, 429);
    assert.strictEqual((await signIn(b, "pw-123")).status, 429);
    s.close();
  });
  await t("password: without a database it can't be changed (clear 503)", async () => {
    const r = await changePw(base, AUTH.cookie, { current: "pw-123", next: "new-password-1" });
    assert.strictEqual(r.status, 503); assert.strictEqual((await r.json()).code, "no_database");
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "glana-"));
  const file = path.join(tmp, "db.json");
  await dbSuite("file db", DB.FileStore(file));
  await t("file db survives a restart", async () => {
    const again = DB.FileStore(file);
    assert.deepStrictEqual((await again.all()).docs, { "team/a": { name: "A" }, "config/settings": { basePct: 80 } });
  });
  await t("file db keeps the password record across restarts and restores", async () => {
    const a = DB.FileStore(file); await a.putAuth({ v: 1, hash: "h" });
    await a.replaceAll({ "team/b": { name: "B" } });
    assert.deepStrictEqual(await DB.FileStore(file).getAuth(), { v: 1, hash: "h" });
  });
  fs.rmSync(tmp, { recursive: true, force: true });

  // fake Upstash REST API (just the commands store.js uses)
  const hash = new Map(); const kv = new Map(); let rev = 0; const seen = [];
  const run = (c) => {
    const [cmd, ...a] = c; seen.push(cmd);
    if (cmd === "HGETALL") return [...hash].flat();
    if (cmd === "HGET") return hash.has(a[1]) ? hash.get(a[1]) : null;
    if (cmd === "HSET") { for (let i = 1; i < a.length; i += 2) hash.set(a[i], a[i + 1]); return 1; }
    if (cmd === "HDEL") return hash.delete(a[1]) ? 1 : 0;
    if (cmd === "DEL") { hash.clear(); return 1; }
    if (cmd === "INCR") return ++rev;
    if (cmd === "GET" && a[0].endsWith(":auth")) return kv.has(a[0]) ? kv.get(a[0]) : null;
    if (cmd === "SET") { kv.set(a[0], a[1]); return "OK"; }
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
  await t("redis db keeps the password record", async () => {
    const r = DB.RedisStore(upUrl, "up-token"); assert.strictEqual(await r.getAuth(), null);
    await r.putAuth({ v: 1, hash: "h" }); assert.deepStrictEqual(await r.getAuth(), { v: 1, hash: "h" });
    assert.ok(!(await r.all()).docs["auth"]);
  });
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
