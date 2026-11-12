const E = require("./engine.js");
const assert = require("assert");
const cfg = JSON.parse(JSON.stringify(E.DEFAULT_SETTINGS));
const hol = E.holidaySet(cfg.holidays);
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL:", name, "\n   ", e.message); } }

// ---------- CSV ----------
t("csv quotes, commas, newlines, BOM, CRLF", () => {
  const rows = E.parseCSV('﻿a,b,c\r\n"x, y","say ""hi""","multi\nline"\r\n1,,3\r\n');
  assert.deepStrictEqual(rows, [["a", "b", "c"], ["x, y", 'say "hi"', "multi\nline"], ["1", "", "3"]]);
});
t("csv semicolon delimiter", () => assert.deepStrictEqual(E.parseCSV("a;b\n1;2"), [["a", "b"], ["1", "2"]]));
t("toCSV round trip", () => { const r = [["a,b", 'q"t', "x"]]; assert.deepStrictEqual(E.parseCSV(E.toCSV(r)), r); });

// ---------- dates ----------
t("jira date dd/MMM/yy h:mm PM", () => assert.deepStrictEqual(E.parseDateTime("09/Nov/26 1:35 PM"), { date: "2026-11-09", minutes: 13 * 60 + 35 }));
t("jira date 12 AM = midnight", () => assert.strictEqual(E.parseDateTime("16/Nov/26 12:00 AM").minutes, 0));
t("iso with offset", () => assert.strictEqual(E.parseDate("2026-11-09T13:35:00.000+0400"), "2026-11-09"));
t("dd.mm.yyyy", () => assert.strictEqual(E.parseDate("03.12.2026"), "2026-12-03"));
t("dd/mm/yyyy day>12", () => assert.strictEqual(E.parseDate("25/12/2026"), "2026-12-25"));
t("mdy when asked", () => assert.strictEqual(E.parseDate("12/03/2026", "mdy"), "2026-12-03"));
t("full month name", () => assert.strictEqual(E.parseDate("9 November 2026"), "2026-11-09"));
t("garbage → null", () => { assert.strictEqual(E.parseDate("soon"), null); assert.strictEqual(E.parseDate(""), null); });

// ---------- working days ----------
t("Nov 2026 has 21 working days", () => assert.strictEqual(E.workingDaysInMonth("2026-11", hol), 21));
t("Dec 2026 has 22 working days (Dec 31 holiday)", () => assert.strictEqual(E.workingDaysInMonth("2026-12", hol), 22));
t("Jan 2027 working days", () => assert.strictEqual(E.workingDaysInMonth("2027-01", hol), 21 - 4)); // 21 weekdays − Jan 1, 6, 27, 28
t("on time / early = 0 late", () => { assert.strictEqual(E.workingDaysLate("2026-11-10", "2026-11-10", hol), 0); assert.strictEqual(E.workingDaysLate("2026-11-10", "2026-11-05", hol), 0); });
t("weekend not counted", () => assert.strictEqual(E.workingDaysLate("2026-11-19", "2026-11-23", hol), 2)); // Fri + Mon
t("Friday due, Monday submit = 1", () => assert.strictEqual(E.workingDaysLate("2026-11-20", "2026-11-23", hol), 1));
t("holidays not counted", () => assert.strictEqual(E.workingDaysLate("2026-12-30", "2027-01-04", hol), 1));

// ---------- points ----------
t("timing points", () => assert.deepStrictEqual([0, 1, 2, 3, 4, 9].map((d) => E.timingPoints(d, cfg)), [100, 60, 30, 30, 0, 0]));
t("quality points", () => {
  assert.strictEqual(E.qualityPoints(0, 0, cfg), 100);
  assert.strictEqual(E.qualityPoints(1, 0, cfg), 50);
  assert.strictEqual(E.qualityPoints(2, 0, cfg), 0);
  assert.strictEqual(E.qualityPoints(0, 1, cfg), 0);
});
t("no due date → quality only", () => { const r = E.scoreTask({ rejections: 1, reopened: 0, resolved: "2026-11-05" }, cfg, hol); assert.strictEqual(r.score, 50); assert.strictEqual(r.timingCounted, false); });
t("submitted falls back to resolved", () => { const r = E.scoreTask({ due: "2026-11-10", resolved: "2026-11-11", rejections: 0, reopened: 0 }, cfg, hol); assert.strictEqual(r.late, 1); assert.strictEqual(r.score, 80); });
t("bands", () => {
  const p = (s) => E.bandFor(s, cfg).pct;
  assert.deepStrictEqual([100, 96, 95.9, 92, 91.9, 85, 84.9, 75, 74.9, 65, 64.9, 0].map(p), [60, 60, 48, 48, 35, 35, 20, 20, 10, 10, 0, 0]);
  assert.strictEqual(p(95.95), 60); // shown as 96.0, so it pays as 96
  assert.strictEqual(p(95.94), 48);
});
t("gates", () => assert.deepStrictEqual([120, 100, 99.9, 90, 89.99, 0].map((x) => E.gateFor(x, cfg)), [1, 1, 0.5, 0.5, 0, 0]));
t("ethics", () => {
  assert.strictEqual(E.ethicsFor([{ level: "major" }, { level: "minor" }, { level: "minor" }], cfg).deduction, 70);
  assert.strictEqual(E.ethicsFor([{ level: "major" }, { level: "major" }, { level: "major" }], cfg).deduction, 100);
  assert.strictEqual(E.ethicsFor([{ level: "critical" }], cfg).deduction, 100);
  assert.strictEqual(E.ethicsFor([{ level: "minor" }, { level: "minor" }, { level: "minor" }], cfg).flags.length, 1);
  assert.strictEqual(E.ethicsFor([], cfg).deduction, 0);
});

// ---------- Jira export ----------
const HDR = ["Summary", "Issue key", "Issue id", "Issue Type", "Status", "Priority", "Assignee", "Reporter", "Created", "Updated", "Resolved", "Due date", "Labels", "Labels", "Custom field (Rejections)", "Custom field (Reopened)", "Custom field (Started)", "Custom field (Submitted)"];
function row(o) {
  return [o.summary || "Task", o.key, "1", o.type || "Task", o.status || "Done", o.priority || "Medium", o.assignee == null ? "Ani Example" : o.assignee, "Karen", "02/Nov/26 10:00 AM", "", o.resolved || "", o.due || "", (o.labels || [])[0] || "", (o.labels || [])[1] || "", o.rej == null ? "" : String(o.rej), o.reo == null ? "" : String(o.reo), "", o.sub || ""];
}
// Ani's November (from the pay document): 8 tasks, score 86.9
const ani = [
  { key: "PRJ-1", summary: "Competitor research, Georgia", due: "13/Nov/26 12:00 AM", sub: "12/Nov/26 4:10 PM", resolved: "13/Nov/26 11:00 AM", rej: 0 },
  { key: "PRJ-2", summary: "Venue onboarding plan", priority: "High", due: "10/Nov/26 12:00 AM", sub: "11/Nov/26 6:30 PM", resolved: "12/Nov/26 9:00 AM", rej: 0 },
  { key: "PRJ-3", summary: "Weekly sprint report", priority: "Highest", due: "06/Nov/26 12:00 AM", sub: "06/Nov/26 5:00 PM", resolved: "06/Nov/26 6:00 PM" },
  { key: "PRJ-4", summary: "Partner contract summary", due: "18/Nov/26 12:00 AM", sub: "17/Nov/26 1:00 PM", resolved: "19/Nov/26 1:00 PM", rej: 1 },
  { key: "PRJ-5", summary: "Loyalty feature spec", priority: "Low", due: "27/Nov/26 12:00 AM", sub: "26/Nov/26 1:00 PM", resolved: "27/Nov/26 1:00 PM", rej: 0, reo: 0 },
  { key: "GOD-6", summary: "Bug triage, POS app", type: "Bug", priority: "High", due: "05/Nov/26 12:00 AM", sub: "05/Nov/26 1:00 PM", resolved: "05/Nov/26 3:00 PM" },
  { key: "PRJ-7", summary: "Investor update draft", priority: "High", due: "19/Nov/26 12:00 AM", sub: "23/Nov/26 10:00 AM", resolved: "25/Nov/26 10:00 AM", rej: 1 },
  { key: "AWE-8", summary: "Hiring post, ops role", due: "30/Nov/26 12:00 AM", sub: "30/Nov/26 9:00 AM", resolved: "30/Nov/26 7:00 PM", rej: 0 },
  // noise that must be ignored
  { key: "PRJ-9", summary: "Cancelled idea", labels: ["", "cancelled"], due: "10/Nov/26 12:00 AM", sub: "20/Nov/26", resolved: "20/Nov/26 10:00 AM", rej: 3 },
  { key: "PRJ-10", summary: "An epic-ish story", type: "Story", resolved: "20/Nov/26 10:00 AM", rej: 3 },
  { key: "PRJ-11", summary: "Nobody's task", assignee: "", resolved: "20/Nov/26 10:00 AM" },
  { key: "PRJ-12", summary: "Former user's task", assignee: "Former user", resolved: "20/Nov/26 10:00 AM" },
  { key: "PRJ-13", summary: "Still open", status: "In Review", sub: "20/Nov/26 10:00 AM" },
  { key: "PRJ-14", summary: "Last month task", resolved: "28/Oct/26 10:00 AM", rej: 2 },
];
const csv = E.toCSV([HDR, ...ani.map(row)]);
const parsed = E.parseJiraExport(csv);
t("jira: columns found", () => assert.deepStrictEqual(parsed.missing, []));
t("jira: rows parsed", () => assert.strictEqual(parsed.tasks.length, 14));
t("jira: second Labels column read", () => assert.ok(parsed.tasks.find((x) => x.key === "PRJ-9").labels.includes("cancelled")));
t("jira: missing columns reported", () => {
  const p = E.parseJiraExport("Issue key,Summary,Assignee,Resolved\nA-1,x,Ani,01/Nov/26\n");
  assert.deepStrictEqual(p.missing.sort(), ["due", "rejections", "reopened", "submitted"].sort());
});

const aniMember = { id: "ani", name: "Ani", jiraName: "Ani Example", salary: 900000 };
const anIncidents = [{ level: "major", note: "AI slop" }, { level: "minor", note: "Jira not updated" }];
const r = E.computePerson(aniMember, "2026-11", { tasks: parsed.tasks, hours: { worked: 162.5, leave: 1, sick: 0, unpaid: 0 }, incidents: anIncidents }, cfg);
t("ani: 8 tasks counted", () => assert.strictEqual(r.tasks.length, 8));
t("ani: task scores", () => assert.deepStrictEqual(r.tasks.map((x) => x.score), [100, 80, 100, 75, 100, 100, 40, 100]));
t("ani: score 86.9 → 35%", () => { assert.strictEqual(r.score, 86.9); assert.strictEqual(r.bonusPct, 35); assert.strictEqual(r.scoreBasis, "month"); });
t("ani: 160 required hours, gate 1", () => { assert.strictEqual(r.requiredHours, 160); assert.strictEqual(r.gate, 1); });
t("ani: base 720,000, bonus 100,800, total 820,800", () => { assert.strictEqual(r.base, 720000); assert.strictEqual(r.bonus, 100800); assert.strictEqual(r.total, 820800); });
t("ani: without AI slop → 946,800", () => {
  const r2 = E.computePerson(aniMember, "2026-11", { tasks: parsed.tasks, hours: { worked: 162.5, leave: 1 }, incidents: [anIncidents[1]] }, cfg);
  assert.strictEqual(r2.total, 946800);
});
t("ani: 145 hours (90.6%) → gate 0.5", () => {
  const r3 = E.computePerson(aniMember, "2026-11", { tasks: parsed.tasks, hours: { worked: 145, leave: 1 }, incidents: [] }, cfg);
  assert.strictEqual(r3.gate, 0.5); assert.strictEqual(r3.bonus, Math.round(720000 * 0.35 * 0.5));
});
t("ani: hours missing → no bonus + warning", () => {
  const r4 = E.computePerson(aniMember, "2026-11", { tasks: parsed.tasks, incidents: [] }, cfg);
  assert.strictEqual(r4.hoursMissing, true); assert.strictEqual(r4.bonus, 0); assert.strictEqual(r4.total, 720000);
});
t("unmatched assignees", () => {
  const u = E.unmatchedAssignees(parsed.tasks, [aniMember], "2026-11", cfg).map((x) => x.name).sort();
  assert.deepStrictEqual(u, ["(unassigned)", "Former user"]);
});

// ---------- quiet month & default ----------
const quiet = E.parseJiraExport(E.toCSV([HDR,
  row({ key: "A-1", resolved: "05/Oct/26", rej: 0 }), row({ key: "A-2", resolved: "06/Oct/26", rej: 1 }),
  row({ key: "A-3", resolved: "05/Nov/26", rej: 0 }),
  row({ key: "A-4", resolved: "07/Dec/26", rej: 0 }), row({ key: "A-5", resolved: "08/Dec/26", rej: 2 }),
  row({ key: "A-6", resolved: "03/Sep/26", rej: 2 }), // outside the 3-month window for December
])).tasks;
t("quiet month pools last 3 months", () => {
  const q = E.computePerson(aniMember, "2026-12", { tasks: quiet, hours: { worked: 200 }, incidents: [] }, cfg);
  assert.strictEqual(q.scoreBasis, "pool"); assert.strictEqual(q.tasksUsed, 5); assert.strictEqual(q.score, 70); assert.strictEqual(q.bonusPct, 10);
  assert.strictEqual(q.tasks.length, 2);
});
t("not enough data → default 35%", () => {
  const q = E.computePerson(aniMember, "2026-11", { tasks: quiet.filter((x) => x.key === "A-3"), hours: { worked: 200 }, incidents: [] }, cfg);
  assert.strictEqual(q.scoreBasis, "default"); assert.strictEqual(q.bonusPct, 35);
});

// ---------- proration ----------
t("joined mid-month: base, bonus and hours prorated", () => {
  const m = { id: "n", name: "New", salary: 500000, start: "2026-12-16" };
  const q = E.computePerson(m, "2026-12", { tasks: [], hours: { worked: 88 }, incidents: [] }, cfg);
  // Dec 16..31: 16,17,18,21,22,23,24,25,28,29,30 = 11 working days (31st is a holiday); month = 22
  assert.strictEqual(q.paidDays, 11); assert.strictEqual(q.requiredHours, 88); assert.strictEqual(q.gate, 1);
  assert.strictEqual(q.basePaid, 200000); assert.strictEqual(q.bonus, 70000); assert.strictEqual(q.currentPaid, 250000);
});
t("unpaid leave days prorate", () => {
  const q = E.computePerson({ id: "x", name: "X", salary: 1100000 }, "2026-12", { tasks: [], hours: { worked: 160, unpaid: 2 }, incidents: [] }, cfg);
  assert.strictEqual(q.paidDays, 20); assert.strictEqual(q.basePaid, 800000); assert.strictEqual(q.requiredHours, 160);
});
t("shadow month flag", () => {
  assert.strictEqual(E.computePerson(aniMember, "2026-12", { tasks: [], hours: { worked: 1 } }, cfg).shadow, true);
  assert.strictEqual(E.computePerson(aniMember, "2027-02", { tasks: [], hours: { worked: 1 } }, cfg).shadow, false);
});

// ---------- hours import ----------
t("hours: name + total hours", () => {
  const h = E.parseHoursFile("Employee,Total hours\nAni Example,162.5\nBob,140:30\n", "2026-11");
  assert.strictEqual(h.mode, "hours"); assert.strictEqual(h.totals.get("Ani Example"), 162.5); assert.strictEqual(h.totals.get("Bob"), 140.5);
});
t("hours: daily in/out, filters month", () => {
  const h = E.parseHoursFile("Name,Date,Check In,Check Out\nAni,02/11/2026,09:00,17:30\nAni,03/11/2026,10:15,18:45\nAni,01/12/2026,09:00,17:00\n", "2026-11");
  assert.strictEqual(h.mode, "in/out"); assert.strictEqual(h.totals.get("Ani"), 17); assert.strictEqual(h.days.get("Ani"), 2);
});
t("hours: raw scans, first-to-last per day", () => {
  const h = E.parseHoursFile("No.,Name,Time,State\n1,Ani,2026-11-02 09:01:00,Check In\n1,Ani,2026-11-02 13:00:00,Check Out\n1,Ani,2026-11-02 17:31:00,Check Out\n1,Ani,2026-11-03 09:00:00,Check In\n1,Ani,2026-11-03 17:00:00,Check Out\n", "2026-11");
  assert.strictEqual(h.mode, "scans"); assert.strictEqual(E.round1(h.totals.get("Ani")), 16.5);
});
t("hours: no name column → error", () => assert.ok(E.parseHoursFile("a,b\n1,2", "2026-11").error));

// ---------- Jira API (real response shape) + skip hours ----------
const apiIssue = {"id":"14584","key":"GOD-83","fields":{"summary":"разобраться","issuetype":{"name":"Subtask"},"resolutiondate":"2026-10-09T17:42:35.344+0400","duedate":"2026-10-08","assignee":{"displayName":"Diana Tashchyan"},"priority":{"name":"Medium","id":"3"},"status":{"name":"Archived"},"labels":["archived"],"customFields":{"Rejections":{"id":"customfield_10198","value":1},"Reopened":{"id":"customfield_10199"},"Submitted":{"id":"customfield_10200","value":"2026-10-09T16:53:00.000+0400"},"Started":{"id":"customfield_10201","value":"2026-10-05T10:00:00.000+0400"}}}};
t("api issue mapped", () => {
  const x = E.taskFromJiraApi(apiIssue);
  assert.deepStrictEqual([x.key, x.type, x.assignee, x.resolved, x.due, x.submitted, x.started, x.rejections, x.reopened, x.labels[0]], ["GOD-83", "Subtask", "Diana Tashchyan", "2026-10-09", "2026-10-08", "2026-10-09", "2026-10-05", 1, 0, "archived"]);
  const s = E.scoreTask(x, cfg, hol); assert.strictEqual(s.late, 1); assert.strictEqual(s.score, 55);
});
t("api issue: missing fields are safe", () => { const x = E.taskFromJiraApi({ key: "A-1", fields: { assignee: null } }); assert.strictEqual(x.assignee, ""); assert.strictEqual(x.resolved, null); assert.strictEqual(x.rejections, 0); });
t("jql window", () => assert.strictEqual(E.jiraJql("2026-12", cfg), 'project in (GOD, PRJ, AWE) AND issuetype in ("Task", "Subtask", "Bug") AND resolved >= "2026-10-01" AND resolved < "2027-01-01" ORDER BY resolved ASC'));
t("skip hours: gate 1 without hours", () => {
  const q = E.computePerson(aniMember, "2026-11", { tasks: parsed.tasks, incidents: anIncidents, skipHours: true }, cfg);
  assert.strictEqual(q.gate, 1); assert.strictEqual(q.hoursMissing, false); assert.strictEqual(q.total, 820800);
});
t("skip hours: unpaid days still prorate", () => {
  const q = E.computePerson({ id: "x", name: "X", salary: 1100000 }, "2026-12", { tasks: [], hours: { unpaid: 2 }, incidents: [], skipHours: true }, cfg);
  assert.strictEqual(q.basePaid, 800000); assert.strictEqual(q.gate, 1);
});

t("founders' extra added on top", () => {
  const q = E.computePerson(aniMember, "2026-11", { tasks: parsed.tasks, hours: { worked: 162.5, leave: 1 }, incidents: anIncidents, extra: { amount: 50000, note: "Weekend launch" } }, cfg);
  assert.strictEqual(q.bonus, 100800); assert.strictEqual(q.extra, 50000); assert.strictEqual(q.total, 870800); assert.strictEqual(q.extraNote, "Weekend launch");
  assert.strictEqual(E.computePerson(aniMember, "2026-11", { tasks: parsed.tasks, hours: { worked: 162.5 }, extra: { amount: -5 } }, cfg).extra, 0);
});

t("jira ranges + split", () => {
  assert.deepStrictEqual(E.jiraRanges("2027-01", cfg), [["2026-11-01", "2026-12-01"], ["2026-12-01", "2027-01-01"], ["2027-01-01", "2027-02-01"]]);
  assert.deepStrictEqual(E.splitRange("2026-10-01", "2026-11-01"), [["2026-10-01", "2026-10-16"], ["2026-10-16", "2026-11-01"]]);
  assert.strictEqual(E.splitRange("2026-10-01", "2026-10-02"), null);
});

t("salary history: a raise counts from its month, earlier months keep the old salary", () => {
  const m = { id: "x", name: "X", salary: 1000000, salaryHistory: [{ from: "2026-09", salary: 800000 }, { from: "2026-12", salary: 1000000 }] };
  assert.strictEqual(E.salaryFor(m, "2026-11"), 800000); assert.strictEqual(E.salaryFor(m, "2026-12"), 1000000); assert.strictEqual(E.salaryFor(m, "2027-05"), 1000000);
  assert.strictEqual(E.salaryFor(m, "2026-01"), 800000); // before the first entry: the first known salary
  assert.strictEqual(E.salaryFor({ salary: 700000 }, "2026-11"), 700000); assert.strictEqual(E.salaryFor({ salary: 700000, salaryHistory: [] }, "2026-11"), 700000);
  const q = (mo) => E.computePerson(m, mo, { tasks: [], hours: { worked: 999 }, incidents: [] }, cfg);
  assert.strictEqual(q("2026-11").salary, 800000); assert.strictEqual(q("2026-11").base, 640000); assert.strictEqual(q("2027-02").base, 800000);
});
t("tax: off by default, Armenian rules when on", () => {
  assert.strictEqual(E.computePerson(aniMember, "2026-11", { tasks: parsed.tasks, hours: { worked: 162.5, leave: 1 }, incidents: anIncidents }, cfg).tax, null);
  const T = E.DEFAULT_SETTINGS.tax;
  assert.deepStrictEqual(E.netPay(400000, T), { gross: 400000, incomeTax: 80000, pension: 20000, stamp: 5500, withheld: 105500, net: 294500 });
  assert.deepStrictEqual(E.netPay(820800, T), { gross: 820800, incomeTax: 164160, pension: 57080, stamp: 8500, withheld: 229740, net: 591060 });
  assert.strictEqual(E.netPay(500000, T).pension, 25000); assert.strictEqual(E.netPay(500001, T).pension, 25000);
  assert.strictEqual(E.netPay(2000000, T).pension, 87500); assert.strictEqual(E.netPay(2000000, T).stamp, 15000);
  assert.deepStrictEqual([90000, 100000, 100001, 200000, 1000000, 1000001].map((g) => E.netPay(g, T).stamp), [1500, 1500, 3000, 3000, 8500, 15000]);
  assert.deepStrictEqual(E.netPay(0, T), { gross: 0, incomeTax: 0, pension: 0, stamp: 0, withheld: 0, net: 0 });
  assert.deepStrictEqual(E.netPay(400000, Object.assign({}, T, { pension: false, stampDuty: false, incomeTaxPct: 10 })), { gross: 400000, incomeTax: 40000, pension: 0, stamp: 0, withheld: 40000, net: 360000 });
  const on = Object.assign({}, cfg, { tax: { enabled: true } }); // stored settings may hold only the switch
  const q = E.computePerson(aniMember, "2026-11", { tasks: parsed.tasks, hours: { worked: 162.5, leave: 1 }, incidents: anIncidents }, on);
  assert.strictEqual(q.total, 820800); assert.strictEqual(q.tax.net, 591060);
  const sh = E.computePerson(aniMember, "2026-12", { tasks: [], hours: { worked: 999 }, incidents: [] }, on); // shadow month: tax on the salary actually paid
  assert.strictEqual(sh.shadow, true); assert.strictEqual(sh.tax.gross, sh.currentPaid);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
