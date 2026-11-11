/* End-to-end check of the website in a real browser (Playwright + Chromium).
 * Runs the full month flow on the worked example from the pay document and checks the numbers.
 * Usage: node tests/e2e.js            (screenshots go to tests/screenshots/)  */
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const E = require("../engine.js");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(__dirname, "screenshots");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

// Ani's November from the pay document (same rows as test_engine.js), plus noise that must be ignored.
const HDR = ["Summary", "Issue key", "Issue id", "Issue Type", "Status", "Priority", "Assignee", "Reporter", "Created", "Updated", "Resolved", "Due date", "Labels", "Labels", "Custom field (Rejections)", "Custom field (Reopened)", "Custom field (Started)", "Custom field (Submitted)"];
const row = (o) => [o.summary || "Task", o.key, "1", o.type || "Task", o.status || "Done", o.priority || "Medium", o.assignee == null ? "Ani Example" : o.assignee, "Karen", "02/Nov/26 10:00 AM", "", o.resolved || "", o.due || "", (o.labels || [])[0] || "", (o.labels || [])[1] || "", o.rej == null ? "" : String(o.rej), o.reo == null ? "" : String(o.reo), "", o.sub || ""];
const ANI = [
  { key: "PRJ-1", summary: "Competitor research, Georgia", due: "13/Nov/26 12:00 AM", sub: "12/Nov/26 4:10 PM", resolved: "13/Nov/26 11:00 AM", rej: 0 },
  { key: "PRJ-2", summary: "Venue onboarding plan", priority: "High", due: "10/Nov/26 12:00 AM", sub: "11/Nov/26 6:30 PM", resolved: "12/Nov/26 9:00 AM", rej: 0 },
  { key: "PRJ-3", summary: "Weekly sprint report", priority: "Highest", due: "06/Nov/26 12:00 AM", sub: "06/Nov/26 5:00 PM", resolved: "06/Nov/26 6:00 PM" },
  { key: "PRJ-4", summary: "Partner contract summary", due: "18/Nov/26 12:00 AM", sub: "17/Nov/26 1:00 PM", resolved: "19/Nov/26 1:00 PM", rej: 1 },
  { key: "PRJ-5", summary: "Loyalty feature spec", priority: "Low", due: "27/Nov/26 12:00 AM", sub: "26/Nov/26 1:00 PM", resolved: "27/Nov/26 1:00 PM", rej: 0, reo: 0 },
  { key: "GOD-6", summary: "Bug triage, POS app", type: "Bug", priority: "High", due: "05/Nov/26 12:00 AM", sub: "05/Nov/26 1:00 PM", resolved: "05/Nov/26 3:00 PM" },
  { key: "PRJ-7", summary: "Investor update draft", priority: "High", due: "19/Nov/26 12:00 AM", sub: "23/Nov/26 10:00 AM", resolved: "25/Nov/26 10:00 AM", rej: 1 },
  { key: "AWE-8", summary: "Hiring post, ops role", due: "30/Nov/26 12:00 AM", sub: "30/Nov/26 9:00 AM", resolved: "30/Nov/26 7:00 PM", rej: 0 },
  { key: "PRJ-9", summary: "Cancelled idea", labels: ["", "cancelled"], due: "10/Nov/26 12:00 AM", sub: "20/Nov/26", resolved: "20/Nov/26 10:00 AM", rej: 3 },
  { key: "PRJ-10", summary: "An epic-ish story", type: "Story", resolved: "20/Nov/26 10:00 AM", rej: 3 },
  { key: "PRJ-11", summary: "Nobody's task", assignee: "", resolved: "20/Nov/26 10:00 AM" },
  { key: "PRJ-12", summary: "Former user's task", assignee: "Former user", resolved: "20/Nov/26 10:00 AM" },
  { key: "PRJ-13", summary: "Still open", status: "In Review", sub: "20/Nov/26 10:00 AM" },
];

let pass = 0, fail = 0;
async function step(name, fn) {
  try { await fn(); pass++; console.log("ok  ", name); }
  catch (e) { fail++; console.log("FAIL", name, "\n     ", e.message.split("\n")[0]); }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());

  const S = () => page.evaluate(() => ({ mode: window.__glana.S.mode, month: window.__glana.S.month, tab: window.__glana.S.tab }));
  const tab = async (k) => { await page.click(`nav.tabs [data-tab="${k}"]`); await page.waitForTimeout(150); };
  const gotoMonth = async (target) => {
    for (let i = 0; i < 48; i++) {
      const m = (await S()).month; if (m === target) return;
      await page.click(m < target ? '[data-action="month-next"]' : '[data-action="month-prev"]');
      await page.waitForTimeout(60);
    }
    throw new Error("could not reach " + target);
  };
  const rowText = async (name) => (await page.locator("tbody tr.click", { hasText: name }).first().innerText()).replace(/\s+/g, " ");
  const results = () => page.evaluate(() => window.__glana.results().map((r) => ({ name: r.name, total: r.total, bonus: r.bonus, score: r.score, gate: r.gate, extra: r.extra })));

  await page.goto(url);
  await page.waitForFunction(() => window.__glana && window.__glana.S.mode !== "loading");

  await step("standalone site saves in the browser", async () => {
    assert.strictEqual((await S()).mode, "browser");
    await page.waitForSelector("#banners .banner.info");
    assert.match(await page.innerText("#banners"), /saved in this browser/i);
  });

  // ---------- sample data: the worked example ----------
  await step("sample data: Ani = 820,800 (pay document example)", async () => {
    await page.click('[data-action="sample"]');
    await page.waitForSelector("tbody tr.click");
    await tab("payroll");
    assert.match(await rowText("Ani"), /86\.9.*35%.*820,800/);
    const rs = await results();
    const sum = rs.reduce((a, r) => a + r.total, 0);
    assert.match(await page.innerText("tfoot"), new RegExp(sum.toLocaleString("en-US")));
  });
  await step("sample data: payslip shows the formula", async () => {
    await page.click('tbody tr.click:has-text("Ani")');
    await page.waitForSelector("dialog#slip[open]");
    const t = await page.innerText("#slip");
    assert.match(t, /720,000/); assert.match(t, /100,800/); assert.match(t, /820,800 AMD/);
    await page.screenshot({ path: path.join(SHOTS, "payslip-desktop.png") });
    await page.click('[data-action="slip-close"]');
  });
  await page.screenshot({ path: path.join(SHOTS, "payroll-sample-desktop.png"), fullPage: true });
  await step("sample data does not touch saved data", async () => {
    const stored = await page.evaluate(() => localStorage.getItem("glanaPay.db.v1"));
    assert.ok(!stored || !stored.includes("Davit"), "sample leaked into storage");
    await page.click('[data-action="exit-sample"]');
    await page.waitForFunction(() => window.__glana.S.mode === "browser");
  });

  // ---------- real flow ----------
  await step("team: add Ani", async () => {
    await tab("team");
    await page.fill('form[data-form="member"] [name=name]', "Ani");
    await page.fill('form[data-form="member"] [name=jiraName]', "Ani Example");
    await page.fill('form[data-form="member"] [name=salary]', "900000");
    await page.click('form[data-form="member"] button[type=submit]');
    await page.waitForSelector('td:has-text("720,000")');
  });
  await gotoMonth("2026-11");
  await step("jira: upload CSV export, 8 of 13 rows scored", async () => {
    await tab("tasks");
    const csv = E.toCSV([HDR, ...ANI.map(row)]);
    await page.setInputFiles('input[data-file="jira"]', { name: "jira.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.click('[data-action="jira-save"]');
    await page.waitForSelector("text=Scored tasks");
    const keys = await page.locator(".card.tablewrap table tbody tr td:first-child b").allInnerTexts();
    assert.deepStrictEqual(keys, ["PRJ-1", "PRJ-2", "PRJ-3", "PRJ-4", "PRJ-5", "GOD-6", "PRJ-7", "AWE-8"]);
    assert.match(await page.innerText("#view"), /Former user \(1\)/);
    assert.match(await page.innerText("#view"), /\(unassigned\) \(1\)/);
  });
  await step("hours: 162.5 worked + 1 leave → gate 1.0", async () => {
    await tab("hours");
    await page.fill('input[data-hours][data-field="worked"]', "162.5"); await page.keyboard.press("Tab");
    await page.fill('input[data-hours][data-field="leave"]', "1"); await page.keyboard.press("Tab");
    await page.click("h2"); await page.waitForTimeout(200);
    assert.match(await page.innerText("#view tbody"), /160 h.*101\.6%/s);
  });
  await step("incidents: one major + one minor", async () => {
    await tab("incidents");
    for (const [level, note] of [["major", "AI slop"], ["minor", "Jira not updated"]]) {
      await page.selectOption('form[data-form="incident"] [name=level]', level);
      await page.fill('form[data-form="incident"] [name=note]', note);
      await page.click('form[data-form="incident"] button[type=submit]');
      await page.waitForSelector(`td:has-text("${note}")`);
    }
  });
  await step("payroll: Ani = 820,800 from real inputs", async () => {
    await tab("payroll");
    const [r] = await results();
    assert.deepStrictEqual([r.score, r.gate, r.bonus, r.total], [86.9, 1, 100800, 820800]);
    assert.match(await rowText("Ani"), /820,800/);
  });
  await step("data survives a reload", async () => {
    await page.reload();
    await page.waitForFunction(() => window.__glana && window.__glana.S.mode === "browser" && window.__glana.S.team.length > 0);
    await gotoMonth("2026-11");
    await page.waitForFunction(() => window.__glana.S.tasks.length > 0);
    assert.strictEqual((await results())[0].total, 820800);
  });
  await step("extra from founders: +50,000 → 870,800", async () => {
    await tab("payroll");
    await page.click('[data-action="extra-open"]');
    await page.fill('#slip [name=amount]', "50000");
    await page.fill('#slip [name=note]', "Weekend launch");
    await page.click('#slip button[type=submit]');
    await page.waitForFunction(() => window.__glana.results()[0].total === 870800);
    await page.click('[data-action="slip-close"]');
  });
  await step("save results marks the month done", async () => {
    await page.click('[data-action="finalize"]');
    await page.waitForSelector("text=Results saved");
  });
  await step("export CSV has the numbers", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="export-csv"]')]);
    const text = fs.readFileSync(await dl.path(), "utf8");
    assert.match(text, /2026-11,Ani,900000,720000,8,86\.9,month,35,162\.5,160,101\.6,1,60,100800,50000,Weekend launch,870800/);
  });
  let backupFile;
  await step("backup: download, wipe, restore", async () => {
    await tab("settings");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="backup-download"]')]);
    backupFile = path.join(SHOTS, "..", "backup.tmp.json"); await dl.saveAs(backupFile);
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await page.waitForFunction(() => window.__glana && window.__glana.S.mode === "browser");
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => window.__glana.S.team.length), 0);
    await tab("settings");
    await page.setInputFiles('input[data-file="backup"]', backupFile);
    await page.waitForFunction(() => window.__glana.S.team.length === 1);
    await gotoMonth("2026-11");
    await page.waitForTimeout(200);
    assert.strictEqual((await results())[0].total, 870800);
  });
  if (backupFile) fs.rmSync(backupFile, { force: true });
  await tab("payroll");
  await page.screenshot({ path: path.join(SHOTS, "payroll-desktop.png"), fullPage: true });

  // ---------- phone ----------
  await step("phone width: no sideways scrolling, bottom tab bar", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p2 = await phone.newPage();
    await p2.goto(url);
    await p2.waitForFunction(() => window.__glana && window.__glana.S.mode !== "loading");
    await p2.click('[data-action="sample"]'); await p2.waitForSelector("tbody tr.click");
    await p2.click('nav.tabs [data-tab="payroll"]'); await p2.waitForTimeout(600);
    for (const k of ["payroll", "tasks", "hours", "incidents", "team", "settings"]) {
      await p2.click(`nav.tabs [data-tab="${k}"]`); await p2.waitForTimeout(150);
      const over = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `${k} scrolls sideways by ${over}px`);
    }
    assert.strictEqual(await p2.evaluate(() => getComputedStyle(document.getElementById("tabbar")).position), "fixed");
    await p2.click('nav.tabs [data-tab="payroll"]'); await p2.waitForTimeout(700);
    await p2.screenshot({ path: path.join(SHOTS, "payroll-phone.png") });
    await phone.close();
  });

  await step("no errors in the browser console", async () => assert.deepStrictEqual(errors, []));

  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
