/* Browser check of people (separate logins), permissions, analytics, history, salary history, taxes,
 * the payday reminder and server backups. Usage: node tests/e2e_features.js */
const assert = require("assert");
const { chromium } = require("playwright");
const { createServer, configFromEnv } = require("../server.js");
const { MemoryStore } = require("../store.js");
const seed = require("./seed.js");

let pass = 0, fail = 0;
async function step(name, fn) { try { await fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n      " + String(e.message).split("\n").slice(0, process.env.VERBOSE ? 14 : 1).join("\n      ")); } }

(async () => {
  const store = MemoryStore(seed());
  const srv = createServer(configFromEnv({ APP_PASSWORD: "pw-123456" }), { store });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch();
  const errs = [];
  const open = async (opts, login, pw, at) => {
    const page = await (await browser.newContext(opts)).newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
    if (at) await page.clock.setFixedTime(new Date(at));
    await page.goto(base + "/login"); if (login) await page.fill("#username", login); await page.fill("#password", pw); await page.click("#signIn"); await page.waitForURL(base + "/");
    await page.waitForFunction(() => window.__glana && window.__glana.S.mode === "server");
    return page;
  };
  const tab = async (page, t) => { await page.evaluate((k) => document.querySelector(`nav.tabs [data-tab="${k}"]`).click(), t); await page.waitForTimeout(250); };
  const tabsOf = (page) => page.$$eval("nav.tabs button", (x) => x.map((e) => e.dataset.tab).join(","));
  const toastIs = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById("toast").textContent), re.source);
  const page = await open({ viewport: { width: 1440, height: 900 } }, "", "pw-123456");

  await step("owner: every page, including Analytics and History", async () => {
    assert.strictEqual(await tabsOf(page), "payroll,tasks,hours,incidents,analytics,team,settings,history");
  });
  await step("analytics: charts, tiles, leaderboard and the yearly summary are drawn from every month", async () => {
    await tab(page, "analytics");
    await page.waitForSelector("svg.chart");
    assert.ok((await page.locator("svg.chart").count()) >= 5);
    assert.strictEqual(await page.locator(".an-kpi").count(), 6);
    const A = await page.evaluate(() => { const a = window.__glana.analyticsData(); return { n: a.months.length, total: a.months.reduce((s, m) => s + m.total, 0), people: a.people.length }; });
    assert.strictEqual(A.n, 10); assert.strictEqual(A.people, 5);
    assert.strictEqual(await page.innerText(".an-kpi >> nth=0 >> .v"), Math.round(A.total).toLocaleString("en-US"));
    assert.strictEqual(await page.locator(".lb li").count(), 5);
    assert.strictEqual(await page.locator("table.heat tbody tr").count(), 5);
    assert.match(await page.innerText(".insights"), /next month's payroll will be about/);
  });
  await step("analytics: hover shows the exact numbers; measure and highlight switch", async () => {
    await page.hover("svg.chart >> nth=0 >> .col >> nth=3");
    await page.waitForSelector(".tipbox.on");
    assert.match(await page.innerText(".tipbox"), /April 2026[\s\S]*Extra[\s\S]*60,000[\s\S]*Total/);
    await page.click('[data-action="an-metric"][data-v="score"]');
    assert.strictEqual(await page.getAttribute('[data-action="an-metric"][data-v="score"]', "aria-pressed"), "true");
    await page.click('[data-action="an-focus"] >> nth=1');
    assert.strictEqual(await page.locator("svg.chart >> nth=1 >> .ser.dim").count(), 4);
    await page.click('[data-action="an-range"][data-v="2026"]');
    assert.strictEqual(await page.evaluate(() => window.__glana.analyticsData().months.length), 10);
  });
  await step("people: the owner adds two accounts and chooses what each sees", async () => {
    await tab(page, "settings"); await page.waitForSelector(".userform");
    const add = async (name, login, pw, role, pages) => {
      await page.fill(".userform [name=name]", name); await page.fill(".userform [name=login]", login); await page.fill(".userform [name=password]", pw); await page.selectOption(".userform [name=role]", role);
      for (const k of ["payroll", "tasks", "hours", "incidents", "team", "analytics"]) await page.setChecked(`.userform [name=page_${k}]`, pages.includes(k));
      await page.click(".userform button[type=submit]");
      await page.waitForFunction((n) => [...document.querySelectorAll(".people tbody b")].some((x) => x.textContent === n), name);
    };
    await page.fill(".userform [name=name]", "X"); await page.fill(".userform [name=login]", "sona"); await page.fill(".userform [name=password]", "longenough1"); await page.fill(".userform [name=login]", "glana");
    await page.click(".userform button[type=submit]"); await toastIs(page, /belongs to the owner/);
    await add("Sona Manukyan", "sona", "sona-password", "edit", ["hours", "incidents"]);
    await add("Accountant", "books", "books-password", "view", ["payroll", "analytics"]);
    assert.strictEqual(await page.locator(".people tbody tr").count(), 3);
  });
  let sona, books;
  await step("an account without pay pages: only its pages, and no salary reaches the browser", async () => {
    sona = await open({ viewport: { width: 1280, height: 800 } }, "sona", "sona-password");
    assert.strictEqual(await tabsOf(sona), "hours,incidents,settings");
    assert.deepStrictEqual(await sona.evaluate(() => window.__glana.S.team.map((m) => m.salary == null)), [true, true, true, true, true]);
    assert.ok(!/\d{3},\d{3}/.test(await sona.innerText("#view")));
    await tab(sona, "settings");
    assert.match(await sona.innerText("#view"), /Signed in as Sona Manukyan/); assert.strictEqual(await sona.locator(".userform").count(), 0); assert.strictEqual(await sona.locator('[data-action="settings-save"]').count(), 0);
    await tab(sona, "hours");
    const input = sona.locator("[data-hours][data-field=worked] >> nth=0"); await input.fill("171"); await input.blur();
    await sona.waitForFunction(() => document.getElementById("saveState").textContent.trim() === "Saved");
    assert.strictEqual((await store.get("months/2026-10")).hours.ani.worked, 171);
  });
  await step("a view-only account sees pay but can change nothing", async () => {
    books = await open({ viewport: { width: 1280, height: 800 } }, "books", "books-password");
    assert.strictEqual(await tabsOf(books), "payroll,analytics,settings");
    assert.match(await books.innerText("#banners"), /View only/);
    assert.ok(/\d,\d{3},\d{3}/.test(await books.innerText("#view")));
    assert.strictEqual(await books.evaluate(() => fetch("api/db", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops: [{ op: "update", path: "team/ani", data: { salary: 1 } }] }) }).then((r) => r.status)), 403);
  });
  await step("lock: the person is signed out at once and can't sign back in", async () => {
    await page.click('.people tr:has-text("Sona Manukyan") [data-action="user-lock"]'); await toastIs(page, /locked out/);
    assert.strictEqual(await sona.evaluate(() => fetch("api/status").then((r) => r.status)), 401);
    const p = await (await browser.newContext()).newPage();
    await p.goto(base + "/login"); await p.fill("#username", "sona"); await p.fill("#password", "sona-password"); await p.click("#signIn");
    assert.match(await p.innerText("#loginError"), /Wrong login or password/); assert.strictEqual(await p.inputValue("#username"), "sona");
    await p.close();
    await page.click('.people tr:has-text("Sona Manukyan") [data-action="user-lock"]'); await toastIs(page, /can sign in again/);
  });
  await step("salary history: a raise counts from its month, earlier months keep the old salary", async () => {
    await tab(page, "team"); await page.click('[data-action="member-edit"][data-id="ani"]');
    await page.fill('form[data-form="member"] [name=salary]', "1000000"); await page.fill('form[data-form="member"] [name=salaryFrom]', "2026-08");
    await page.click('form[data-form="member"] button[type=submit]'); await toastIs(page, /Saved/);
    assert.deepStrictEqual((await store.get("team/ani")).salaryHistory, [{ from: "2000-01", salary: 900000 }, { from: "2026-08", salary: 1000000 }]);
    const A = await page.evaluate(() => { const a = window.__glana.analyticsData(); return a.people.find((p) => p.id === "ani").per.map((r) => r.salary); });
    assert.deepStrictEqual(A, [900000, 900000, 900000, 900000, 900000, 900000, 900000, 1000000, 1000000, 1000000]);
    await page.click('[data-action="member-edit"][data-id="ani"]');
    assert.match(await page.innerText(".salhist"), /900,000 AMD\s*from the start[\s\S]*1,000,000 AMD\s*from August 2026\s*\+11\.1%/);
    await page.click('[data-action="member-cancel"]');
  });
  await step("taxes: off by default; switched on, the payslip shows what is withheld and the net pay", async () => {
    await tab(page, "payroll"); await page.click("tr.click >> nth=0"); await page.waitForSelector("#slip[open]");
    assert.ok(!/Net pay/.test(await page.innerText("#slip"))); await page.click('[data-action="slip-close"]');
    await tab(page, "settings"); await page.check('[data-set="tax.enabled"]'); await page.click('[data-action="settings-save"]'); await toastIs(page, /Settings saved/);
    await tab(page, "payroll");
    assert.match(await page.innerText("thead"), /Net/);
    await page.click("tr.click >> nth=0"); await page.waitForSelector("#slip[open]");
    const r = await page.evaluate(() => window.__glana.results()[0]);
    assert.strictEqual(r.tax.net, r.total - r.tax.incomeTax - r.tax.pension - r.tax.stamp);
    const slip = await page.innerText("#slip");
    assert.match(slip, /Income tax \(20%\)/); assert.ok(slip.includes("Net pay (in hand)") && slip.includes(r.tax.net.toLocaleString("en-US") + " AMD"));
    assert.ok(await page.isVisible('[data-action="slip-print"]'));
    await page.click('[data-action="slip-close"]');
  });
  await step("history: who changed what, in plain words; filter by person", async () => {
    await tab(page, "history"); await page.waitForSelector(".hist li");
    const text = await page.innerText("#view");
    for (const re of [/Owner created the account of Sona Manukyan \(sona\)/, /Owner locked the account of Sona Manukyan/, /Owner changed Ani Petrosyan/, /salary 900,000 → 1,000,000/, /Owner changed the settings/, /tax: enabled no → yes/, /Sona Manukyan changed \(October 2026\)/, /Ani Petrosyan: hours worked \d+ → 171/, /Accountant signed in/]) assert.match(text, re);
    assert.ok(!/sona-password|books-password/.test(text));
    await page.selectOption('[data-hist="who"]', "Sona Manukyan");
    assert.ok((await page.$$eval(".hist li .hb b:first-child", (x) => x.map((e) => e.textContent))).every((n) => n === "Sona Manukyan"));
    await page.selectOption('[data-hist="who"]', "");
  });
  await step("backups: the server made one by itself; make one by hand; both are listed for admins", async () => {
    await tab(page, "settings"); await page.waitForSelector('[data-action="sbackup-now"]');
    await page.waitForSelector('[data-action="sbackup-download"]');
    assert.match(await page.innerText(".card:has([data-action=sbackup-now])"), /Weekly/);
    const before = await page.locator('[data-action="sbackup-download"]').count();
    await page.click('[data-action="sbackup-now"]'); await toastIs(page, /Backup made/);
    assert.strictEqual(await page.locator('[data-action="sbackup-download"]').count(), before + 1);
  });
  await step("payday reminder: a banner when the month about to be paid isn't ready", async () => {
    const p = await open({ viewport: { width: 1280, height: 800 } }, "", "pw-123456", "2026-11-03T09:00:00");
    await p.waitForSelector("#banners .banner");
    assert.match(await p.innerText("#banners"), /Payday is in 2 days\. October 2026 still needs: saved results\./);
    const q = await open({ viewport: { width: 1280, height: 800 } }, "", "pw-123456", "2026-11-12T09:00:00");
    await q.waitForTimeout(400); assert.ok(!/Payday/.test(await q.innerText("#banners")));
    await p.close(); await q.close();
  });
  await step("phone, dark: analytics fits the screen", async () => {
    const ph = await open({ viewport: { width: 390, height: 844 }, colorScheme: "dark" }, "", "pw-123456");
    await tab(ph, "analytics"); await ph.waitForSelector("svg.chart");
    assert.ok((await ph.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    await ph.close();
  });
  await step("no errors in the browser console", () => assert.deepStrictEqual(errs.filter((e) => !/status of 40[013]/.test(e)), []));

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
