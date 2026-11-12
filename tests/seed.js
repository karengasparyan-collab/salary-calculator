/* Made-up data for tests/e2e_features.js: 5 people, January to October 2026 (October not saved yet). */
const E = require("../engine.js");
module.exports = function seed() {
  let seedN = 7; const rnd = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
  const docs = {};
  const people = [["ani", "Ani Petrosyan", 900000, 0.9], ["davit", "Davit Sargsyan", 1200000, 0.97], ["lilit", "Lilit Hakobyan", 500000, 0.8], ["tigran", "Tigran Avetisyan", 750000, 0.7], ["mariam", "Mariam Grigoryan", 650000, 0.93]];
  for (const [id, name, salary] of people) docs["team/" + id] = { name, jiraName: name, role: "Team", salary, active: true };
  docs["team/davit"].salaryHistory = [{ from: "2000-01", salary: 1000000 }, { from: "2026-06", salary: 1200000 }];
  docs["team/mariam"].start = "2026-04-06";
  const months = []; for (let i = 0; i < 10; i++) months.push(E.monthAdd("2026-01", i));
  let key = 100;
  months.forEach((m, mi) => {
    const tasks = [];
    for (const [id, name, , skill] of people) {
      if (id === "mariam" && m < "2026-04") continue;
      const n = 5 + Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++) {
        const day = String(3 + Math.floor(rnd() * 24)).padStart(2, "0"), due = `${m}-${day}`;
        const p = skill + (id === "tigran" ? mi * 0.025 : 0);
        const late = rnd() < p ? 0 : rnd() < 0.5 ? 1 : rnd() < 0.6 ? 3 : 6;
        const sub = E.parseDate(due) && late ? (() => { let d = due, c = 0; const hol = E.holidaySet([]); while (c < late) { const dt = new Date(d + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() + 1); d = dt.toISOString().slice(0, 10); if (E.isWorkingDay(d, hol)) c++; } return d; })() : due;
        if (sub.slice(0, 7) !== m) continue;
        tasks.push({ key: "PRJ-" + key++, summary: "Task " + key, type: "Task", status: "Done", priority: "Medium", assignee: name, created: m + "-01", resolved: sub, due, submitted: sub, started: null, rejections: rnd() < p ? 0 : rnd() < 0.7 ? 1 : 2, reopened: 0, labels: [] });
      }
    }
    docs[`months/${m}/jira/p0`] = { uploadId: "u" + mi, tasks };
    const hours = {};
    const hol = E.holidaySet(E.DEFAULT_SETTINGS.holidays);
    for (const [id] of people) { if (id === "mariam" && m < "2026-04") continue; const req = E.workingDaysInMonth(m, hol) * 8; hours[id] = { worked: Math.round(req * (id === "lilit" && mi % 4 === 2 ? 0.93 : 1 + rnd() * 0.06)), leave: 0, sick: 0, unpaid: 0 }; }
    if (m === "2026-04") hours.mariam.worked = 150;
    docs["months/" + m] = { month: m, jira: { uploadId: "u" + mi, source: "jira", parts: 1, fileName: "Pulled from Jira", uploadedAt: m + "-28T10:00:00Z", rowCount: tasks.length, found: [], missing: [], warnings: [] }, hours, final: mi < 9 ? { savedAt: m + "-28T10:00:00Z", rows: [] } : undefined };
    if (mi === 3) docs["months/" + m].extras = { ani: { amount: 60000, note: "Weekend launch" } };
    if (mi === 2) docs[`months/${m}/incidents/i1`] = { memberId: "tigran", date: m + "-12", level: "minor", note: "Jira status not updated" };
    if (mi === 6) { docs[`months/${m}/incidents/i1`] = { memberId: "tigran", date: m + "-09", level: "major", note: "Unchecked AI output sent to a partner", aiSlop: true }; docs[`months/${m}/incidents/i2`] = { memberId: "lilit", date: m + "-20", level: "minor", note: "Late to client call" }; }
  });
  docs["config/settings"] = Object.assign(JSON.parse(JSON.stringify(E.DEFAULT_SETTINGS)), { shadowMonths: [] });
  return JSON.parse(JSON.stringify(docs));
};
