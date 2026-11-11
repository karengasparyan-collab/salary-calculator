/* Glana pay engine — pure functions, no DOM. Works in Node (module.exports) and the browser (window.PayEngine). */
(function (root) {
  "use strict";

  // ---------- defaults ----------
  const DEFAULT_SETTINGS = {
    basePct: 80,                 // base = 80% of current salary
    hoursPerDay: 8,
    minTasks: 4,                 // fewer than this in the pay month = quiet month
    poolMonths: 3,               // quiet month: pool tasks from the last 3 months (pay month included)
    defaultBonusPct: 35,         // new joiner / not enough data
    bands: [                     // checked top-down, score rounded to 1 decimal
      { min: 96, pct: 60, label: "Excellent" },
      { min: 92, pct: 48, label: "Strong" },
      { min: 85, pct: 35, label: "Normal good" },
      { min: 75, pct: 20, label: "Weak" },
      { min: 65, pct: 10, label: "Poor" },
      { min: 0, pct: 0, label: "Fail" },
    ],
    timing: { onTime: 100, late1: 60, late2to3: 30, late4plus: 0 },
    quality: { firstTime: 100, rejectedOnce: 50, rejected2plus: 0 },
    gates: [ { min: 100, gate: 1 }, { min: 90, gate: 0.5 }, { min: 0, gate: 0 } ],
    penalties: { minor: 10, major: 50 },  // % of bonus; critical = 100%
    issueTypes: ["Task", "Subtask", "Sub-task", "Bug"],
    excludeLabel: "cancelled",
    shadowMonths: ["2026-12", "2027-01"],
    jiraSite: "99b8e946-94d7-4938-96a7-e73559c4816a",   // glana.atlassian.net
    jiraProjects: "GOD, PRJ, AWE",
    // Armenian public holidays (non-working). Edit in Settings.
    holidays: [
      "2026-09-21", "2026-12-31",
      "2027-01-01", "2027-01-02", "2027-01-06", "2027-01-27", "2027-01-28", "2027-03-08", "2027-04-24",
      "2027-05-01", "2027-05-09", "2027-05-28", "2027-07-05", "2027-09-21", "2027-12-31",
    ],
  };

  // ---------- small helpers ----------
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const round1 = (x) => Math.round(x * 10 + 1e-9) / 10;
  const norm = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");

  function dateFromISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  function isoFromDate(dt) { return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function addDays(s, n) { const dt = dateFromISO(s); dt.setUTCDate(dt.getUTCDate() + n); return isoFromDate(dt); }
  function monthOf(s) { return s ? s.slice(0, 7) : null; }
  function monthAdd(month, n) { let [y, m] = month.split("-").map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${pad(m)}`; }
  function daysInMonth(month) { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  // ---------- CSV ----------
  function detectDelimiter(text) {
    const line = text.split(/\r?\n/).find((l) => l.trim()) || "";
    const counts = { ",": 0, ";": 0, "\t": 0 };
    let q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ",";
  }
  function parseCSV(text, delim) {
    text = String(text || "").replace(/^﻿/, "");
    delim = delim || detectDelimiter(text);
    const rows = []; let row = []; let field = ""; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((c) => c !== "")) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((c) => c !== "")) rows.push(row);
    return rows;
  }
  function toCSV(rows) {
    return rows.map((r) => r.map((v) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\r\n");
  }

  // ---------- dates ----------
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function fullYear(y) { y = Number(y); return y < 100 ? 2000 + y : y; }
  function validDate(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100; }
  /** Parse a date/time string into { date: "YYYY-MM-DD", minutes: minutes since midnight or null }.
   *  order: "dmy" or "mdy" for all-numeric slash dates (Jira uses month names so this rarely matters). */
  function parseDateTime(s, order) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    let y, m, d, rest = "", mm;
    if ((mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(.*))?$/))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; rest = mm[4] || ""; }
    else if ((mm = s.match(/^(\d{1,2})[\/\-\s.]([A-Za-z]{3,9})[\/\-\s.,]+(\d{2,4})(?:[\sT,]+(.*))?$/))) { d = +mm[1]; m = MONTHS[mm[2].toLowerCase().slice(0, 3)] || MONTHS[mm[2].toLowerCase()]; y = fullYear(mm[3]); rest = mm[4] || ""; }
    else if ((mm = s.match(/^([A-Za-z]{3,9})[\s.]+(\d{1,2}),?\s+(\d{4})(?:[\sT,]+(.*))?$/))) { m = MONTHS[mm[1].toLowerCase().slice(0, 3)]; d = +mm[2]; y = +mm[3]; rest = mm[4] || ""; }
    else if ((mm = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})(?:[\sT,]+(.*))?$/))) {
      const a = +mm[1], b = +mm[2]; y = fullYear(mm[3]); rest = mm[4] || "";
      const dotted = s.includes(".");
      if (a > 12) { d = a; m = b; } else if (b > 12) { m = a; d = b; }
      else if ((order || (dotted ? "dmy" : "dmy")) === "mdy") { m = a; d = b; } else { d = a; m = b; }
    } else return null;
    if (!validDate(y, m, d)) return null;
    let minutes = null;
    const t = rest.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?/);
    if (t) {
      let h = +t[1]; const mi = +t[2];
      if (t[4]) { const pm = t[4].toLowerCase() === "pm"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
      minutes = h * 60 + mi + (t[3] ? +t[3] / 60 : 0);
    }
    return { date: iso(y, m, d), minutes };
  }
  function parseDate(s, order) { const r = parseDateTime(s, order); return r ? r.date : null; }

  // ---------- working days ----------
  function holidaySet(list) { return new Set((list || []).filter(Boolean)); }
  function isWorkingDay(s, hol) { const wd = dateFromISO(s).getUTCDay(); return wd !== 0 && wd !== 6 && !hol.has(s); }
  /** Working days strictly after `due` up to and including `submitted`. 0 if on time or early. */
  function workingDaysLate(due, submitted, hol) {
    if (!due || !submitted || submitted <= due) return 0;
    let n = 0, cur = addDays(due, 1);
    while (cur <= submitted) { if (isWorkingDay(cur, hol)) n++; cur = addDays(cur, 1); if (n > 400) break; }
    return n;
  }
  /** Working days in [from, to] (inclusive). */
  function workingDaysBetween(from, to, hol) {
    let n = 0, cur = from;
    while (cur <= to) { if (isWorkingDay(cur, hol)) n++; cur = addDays(cur, 1); }
    return n;
  }
  function monthRange(month) { return [month + "-01", month + "-" + pad(daysInMonth(month))]; }
  function workingDaysInMonth(month, hol) { const [a, b] = monthRange(month); return workingDaysBetween(a, b, hol); }

  // ---------- Jira export ----------
  const COLS = {
    key: ["issue key", "key"],
    summary: ["summary", "title"],
    type: ["issue type", "issuetype", "type", "work type"],
    status: ["status"],
    priority: ["priority"],
    assignee: ["assignee"],
    created: ["created"],
    resolved: ["resolved", "resolution date", "resolutiondate"],
    due: ["due date", "due", "duedate"],
    submitted: ["custom field (submitted)", "submitted"],
    started: ["custom field (started)", "started"],
    rejections: ["custom field (rejections)", "rejections"],
    reopened: ["custom field (reopened)", "reopened"],
  };
  const REQUIRED = ["key", "assignee", "resolved", "due", "submitted", "rejections", "reopened"];
  function mapColumns(header) {
    const h = header.map(norm);
    const map = {}; const labels = [];
    for (const [k, names] of Object.entries(COLS)) {
      let idx = -1;
      for (const nm of names) { idx = h.indexOf(nm); if (idx >= 0) break; }
      map[k] = idx;
    }
    h.forEach((x, i) => { if (x === "labels" || x === "label") labels.push(i); });
    map.labels = labels;
    const missing = REQUIRED.filter((k) => map[k] < 0);
    return { map, missing };
  }
  function num(v) { if (v == null) return 0; const s = String(v).trim().replace(",", "."); if (!s) return 0; const n = Number(s); return isFinite(n) ? n : 0; }

  /** Parse a Jira CSV export into minimal task records. */
  function parseJiraExport(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { tasks: [], missing: REQUIRED.slice(), found: [], rowCount: 0, warnings: ["The file is empty."] };
    const header = rows[0];
    const { map, missing } = mapColumns(header);
    const found = Object.keys(COLS).filter((k) => map[k] >= 0);
    const warnings = [];
    const tasks = [];
    let badDates = 0;
    for (const r of rows.slice(1)) {
      const g = (k) => (map[k] >= 0 ? (r[map[k]] || "").trim() : "");
      const key = g("key");
      if (!key) continue;
      const t = {
        key,
        summary: g("summary").slice(0, 140),
        type: g("type"),
        status: g("status"),
        priority: g("priority"),
        assignee: g("assignee"),
        created: parseDate(g("created")),
        resolved: parseDate(g("resolved")),
        due: parseDate(g("due")),
        submitted: parseDate(g("submitted")),
        started: parseDate(g("started")),
        rejections: num(g("rejections")),
        reopened: num(g("reopened")),
        labels: map.labels.map((i) => (r[i] || "").trim()).filter(Boolean),
      };
      for (const k of ["resolved", "due", "submitted"]) if (g(k) && !t[k]) badDates++;
      tasks.push(t);
    }
    if (badDates) warnings.push(`${badDates} date value(s) could not be read.`);
    return { tasks, missing, found, rowCount: rows.length - 1, warnings };
  }

  /** Map one issue from the Jira search API (Atlassian connector, view "full") to a task record. */
  function taskFromJiraApi(issue) {
    const f = issue.fields || {};
    const cf = f.customFields || {};
    const custom = (label, id) => {
      const c = cf[label] || Object.values(cf).find((x) => x && x.id === id);
      let v = c && "value" in c ? c.value : f[id];
      if (v && typeof v === "object" && "value" in v) v = v.value;
      return v == null ? "" : v;
    };
    const name = (o) => (o && (o.displayName || o.name)) || "";
    return {
      key: issue.key,
      summary: String(f.summary || "").slice(0, 140),
      type: name(f.issuetype),
      status: name(f.status),
      priority: name(f.priority),
      assignee: name(f.assignee),
      created: parseDate(f.created),
      resolved: parseDate(f.resolutiondate),
      due: parseDate(f.duedate),
      submitted: parseDate(custom("Submitted", "customfield_10200")),
      started: parseDate(custom("Started", "customfield_10201")),
      rejections: num(custom("Rejections", "customfield_10198")),
      reopened: num(custom("Reopened", "customfield_10199")),
      labels: Array.isArray(f.labels) ? f.labels.slice() : [],
    };
  }
  /** JQL for a pay month: everything resolved in the pooling window ending with that month. */
  function jiraJql(month, cfg, from, to) {
    cfg = cfg || DEFAULT_SETTINGS;
    from = from || monthAdd(month, -(cfg.poolMonths - 1)) + "-01";
    to = to || monthAdd(month, 1) + "-01";
    const types = (cfg.issueTypes || []).filter((t) => t !== "Sub-task").map((t) => `"${t}"`).join(", ");
    return `project in (${cfg.jiraProjects || "GOD, PRJ, AWE"}) AND issuetype in (${types}) AND resolved >= "${from}" AND resolved < "${to}" ORDER BY resolved ASC`;
  }
  /** One [from, to) date range per month of the pooling window. */
  function jiraRanges(month, cfg) {
    cfg = cfg || DEFAULT_SETTINGS; const out = [];
    for (let i = cfg.poolMonths - 1; i >= 0; i--) { const m = monthAdd(month, -i); out.push([m + "-01", monthAdd(m, 1) + "-01"]); }
    return out;
  }
  /** Split a [from, to) range in two; null if it is a single day. */
  function splitRange(from, to) {
    const days = Math.round((dateFromISO(to) - dateFromISO(from)) / 86400000);
    if (days <= 1) return null;
    const mid = addDays(from, Math.floor(days / 2));
    return [[from, mid], [mid, to]];
  }
  const JIRA_FIELDS = ["summary", "issuetype", "status", "priority", "assignee", "created", "resolutiondate", "duedate", "labels", "customfield_10198", "customfield_10199", "customfield_10200", "customfield_10201"];

  // ---------- scoring ----------
  function timingPoints(late, cfg) {
    const p = cfg.timing;
    if (late <= 0) return p.onTime;
    if (late === 1) return p.late1;
    if (late <= 3) return p.late2to3;
    return p.late4plus;
  }
  function qualityPoints(rejections, reopened, cfg) {
    const p = cfg.quality;
    if (reopened > 0 || rejections >= 2) return p.rejected2plus;
    if (rejections === 1) return p.rejectedOnce;
    return p.firstTime;
  }
  /** Score one task. No due date → quality only. Submitted falls back to Resolved. */
  function scoreTask(t, cfg, hol) {
    const quality = qualityPoints(t.rejections || 0, t.reopened || 0, cfg);
    const submittedOn = t.submitted || t.resolved || null;
    if (!t.due) return { late: null, timing: null, quality, score: quality, submittedOn, timingCounted: false };
    const late = workingDaysLate(t.due, submittedOn, hol);
    const timing = timingPoints(late, cfg);
    return { late, timing, quality, score: (timing + quality) / 2, submittedOn, timingCounted: true };
  }
  function bandFor(score, cfg) {
    const s = round1(score);
    for (const b of cfg.bands) if (s >= b.min) return b;
    return cfg.bands[cfg.bands.length - 1];
  }
  function gateFor(pct, cfg) {
    for (const g of cfg.gates) if (pct + 1e-9 >= g.min) return g.gate;
    return 0;
  }
  function ethicsFor(incidents, cfg) {
    let minors = 0, majors = 0, criticals = 0;
    for (const i of incidents || []) { if (i.level === "minor") minors++; else if (i.level === "major") majors++; else if (i.level === "critical") criticals++; }
    const raw = criticals > 0 ? 100 : minors * cfg.penalties.minor + majors * cfg.penalties.major;
    const deduction = Math.min(100, raw);
    const flags = [];
    if (criticals) flags.push("Critical incident: no bonus + formal reprimand");
    if (minors >= 3) flags.push("3+ minor incidents: formal talk with founders");
    return { minors, majors, criticals, deduction, flags };
  }

  /** Is this task counted for the person at all (type, label, status)? */
  function countable(t, cfg) {
    if (!t.resolved) return false;
    if (cfg.issueTypes && cfg.issueTypes.length && t.type && !cfg.issueTypes.map(norm).includes(norm(t.type))) return false;
    const ex = norm(cfg.excludeLabel || "");
    if (ex && (t.labels || []).some((l) => norm(l) === ex)) return false;
    return true;
  }
  function matchesMember(t, member) {
    const a = norm(t.assignee);
    if (!a) return false;
    return [member.jiraName, member.name].filter(Boolean).map(norm).includes(a);
  }

  /** Full monthly result for one person.
   *  member: {id, name, jiraName, salary, start?, end?}
   *  input:  {hours: {worked, leave, sick, unpaid} | undefined, incidents: [...], tasks: [...all parsed tasks]} */
  function computePerson(member, month, input, cfg) {
    cfg = cfg || DEFAULT_SETTINGS;
    const hol = holidaySet(cfg.holidays);
    const warnings = [];
    const [mStart, mEnd] = monthRange(month);
    const salary = Number(member.salary) || 0;
    const base = Math.round(salary * cfg.basePct / 100);

    // --- employment / proration ---
    const from = member.start && member.start > mStart ? member.start : mStart;
    const to = member.end && member.end < mEnd ? member.end : mEnd;
    const monthDays = workingDaysInMonth(month, hol);
    const employedDays = from <= to ? workingDaysBetween(from, to, hol) : 0;
    const h = input.hours || null;
    const unpaid = h ? num(h.unpaid) : 0;
    const leave = h ? num(h.leave) : 0;
    const sick = h ? num(h.sick) : 0;
    const paidDays = Math.max(0, employedDays - unpaid);
    const prorate = monthDays ? paidDays / monthDays : 0;
    const basePaid = Math.round(base * prorate);
    if (employedDays < monthDays || unpaid > 0) warnings.push(`Prorated: ${paidDays} of ${monthDays} working days paid`);

    // --- attendance ---
    const requiredDays = Math.max(0, paidDays - leave - sick);
    const requiredHours = requiredDays * cfg.hoursPerDay;
    let worked = null, attendancePct = null, gate = 0, hoursMissing = false;
    const hoursSkipped = !!input.skipHours;
    if (hoursSkipped) { gate = 1; if (h && h.worked !== "" && h.worked != null) worked = num(h.worked); }
    else if (!h || h.worked === "" || h.worked == null) { hoursMissing = true; warnings.push("Hours not entered"); }
    else {
      worked = num(h.worked);
      attendancePct = requiredHours > 0 ? (worked / requiredHours) * 100 : 100;
      gate = gateFor(attendancePct, cfg);
    }

    // --- tasks ---
    const mine = (input.tasks || []).filter((t) => countable(t, cfg) && matchesMember(t, member));
    const scored = mine.map((t) => Object.assign({}, t, scoreTask(t, cfg, hol)));
    const inMonth = scored.filter((t) => monthOf(t.resolved) === month);
    const poolFrom = monthAdd(month, -(cfg.poolMonths - 1));
    const pool = scored.filter((t) => { const mo = monthOf(t.resolved); return mo >= poolFrom && mo <= month; });
    let scoreBasis, score = null, band = null, bonusPct, used;
    if (inMonth.length >= cfg.minTasks) { scoreBasis = "month"; used = inMonth; }
    else if (pool.length >= cfg.minTasks) { scoreBasis = "pool"; used = pool; }
    else { scoreBasis = "default"; used = inMonth; }
    if (scoreBasis === "default") {
      bonusPct = cfg.defaultBonusPct;
      warnings.push(`Fewer than ${cfg.minTasks} tasks in the last ${cfg.poolMonths} months: default ${cfg.defaultBonusPct}%`);
      if (inMonth.length) score = round1(inMonth.reduce((a, t) => a + t.score, 0) / inMonth.length);
    } else {
      score = round1(used.reduce((a, t) => a + t.score, 0) / used.length);
      band = bandFor(score, cfg);
      bonusPct = band.pct;
      if (scoreBasis === "pool") warnings.push(`Quiet month (${inMonth.length} task${inMonth.length === 1 ? "" : "s"}): scored on ${pool.length} tasks from the last ${cfg.poolMonths} months`);
    }

    // --- ethics ---
    const ethics = ethicsFor(input.incidents, cfg);

    // --- pay ---
    const bonus = Math.round(basePaid * (bonusPct / 100) * gate * (1 - ethics.deduction / 100));
    const extra = Math.max(0, Math.round(num(input.extra && input.extra.amount)));
    const extraNote = (input.extra && input.extra.note) || "";
    const total = basePaid + bonus + extra;
    const shadow = (cfg.shadowMonths || []).includes(month);
    const currentPaid = Math.round(salary * prorate);

    return {
      memberId: member.id, name: member.name, month,
      salary, base, basePaid, prorate, monthDays, employedDays, paidDays,
      requiredDays, requiredHours, worked, leave, sick, unpaid, attendancePct, gate, hoursMissing, hoursSkipped,
      tasks: inMonth, tasksUsed: used.length, poolCount: pool.length, scoreBasis, score, band, bonusPct,
      ethics, bonus, extra, extraNote, total, shadow, currentPaid, diff: total - currentPaid,
      warnings: warnings.concat(ethics.flags),
    };
  }

  /** Assignees in the export that are not on the team (resolved in the pool window). */
  function unmatchedAssignees(tasks, team, month, cfg) {
    const poolFrom = monthAdd(month, -((cfg || DEFAULT_SETTINGS).poolMonths - 1));
    const names = new Map();
    for (const t of tasks) {
      const mo = monthOf(t.resolved);
      if (!mo || mo < poolFrom || mo > month) continue;
      if (!t.assignee) { names.set("(unassigned)", (names.get("(unassigned)") || 0) + 1); continue; }
      if (team.some((m) => matchesMember(t, m))) continue;
      names.set(t.assignee, (names.get(t.assignee) || 0) + 1);
    }
    return [...names.entries()].map(([name, count]) => ({ name, count }));
  }

  // ---------- face-scan hours import ----------
  const NAME_H = ["name", "employee", "employee name", "full name", "person", "user", "staff", "first name"];
  const HOURS_H = ["hours", "total hours", "worked hours", "work hours", "total", "duration", "worked", "work time", "total time"];
  const DATE_H = ["date", "day", "work date"];
  const IN_H = ["in", "check in", "check-in", "clock in", "clock-in", "time in", "first in", "first scan", "arrival", "entry", "on duty", "start"];
  const OUT_H = ["out", "check out", "check-out", "clock out", "clock-out", "time out", "last out", "last scan", "departure", "exit", "off duty", "end"];
  const TIME_H = ["time", "datetime", "date time", "date/time", "timestamp", "punch time", "scan time", "check time", "event time"];
  function findCol(h, list) { for (const n of list) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; }
  function hoursValue(v) {
    v = String(v || "").trim();
    if (!v) return null;
    let m = v.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (m) return +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
    m = v.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?/i);
    if (m) return +m[1] + (m[2] ? +m[2] / 60 : 0);
    const n = Number(v.replace(",", "."));
    return isFinite(n) ? n : null;
  }
  function timeOnly(v) {
    v = String(v || "").trim();
    const m = v.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$/);
    if (!m) return null;
    let hh = +m[1]; if (m[4]) { const pm = m[4].toLowerCase() === "pm"; if (hh === 12) hh = pm ? 12 : 0; else if (pm) hh += 12; }
    return hh * 60 + +m[2] + (m[3] ? +m[3] / 60 : 0);
  }
  function guessOrder(values) {
    let dmy = false, mdy = false;
    for (const v of values) { const m = String(v).match(/^(\d{1,2})[\/.](\d{1,2})[\/.]/); if (!m) continue; if (+m[1] > 12) dmy = true; if (+m[2] > 12) mdy = true; }
    return mdy && !dmy ? "mdy" : "dmy";
  }
  /** Returns { mode, totals: Map(name -> hours), days: Map(name -> count), skipped, error } for rows within `month` (if dates exist). */
  function parseHoursFile(text, month) {
    const rows = parseCSV(text);
    if (rows.length < 2) return { error: "The file has no data rows." };
    const h = rows[0].map(norm);
    const nameI = findCol(h, NAME_H);
    if (nameI < 0) return { error: "No name column found (expected a header like Name or Employee)." };
    const totals = new Map(), days = new Map(); let skipped = 0;
    const add = (name, hrs, dayKey) => {
      totals.set(name, (totals.get(name) || 0) + hrs);
      if (!days.has(name)) days.set(name, new Set());
      if (dayKey) days.get(name).add(dayKey);
    };
    const data = rows.slice(1);
    const hoursI = findCol(h, HOURS_H), dateI = findCol(h, DATE_H), inI = findCol(h, IN_H), outI = findCol(h, OUT_H), timeI = findCol(h, TIME_H);
    const order = guessOrder(data.map((r) => r[dateI >= 0 ? dateI : timeI] || ""));
    const inMonth = (d) => !month || !d || monthOf(d) === month;
    let mode;
    if (inI >= 0 && outI >= 0) {
      mode = "in/out";
      for (const r of data) {
        const name = (r[nameI] || "").trim(); if (!name) continue;
        const dIn = parseDateTime(r[inI], order), dOut = parseDateTime(r[outI], order);
        const day = dateI >= 0 ? parseDate(r[dateI], order) : (dIn && dIn.date);
        const a = dIn && dIn.minutes != null ? dIn.minutes : timeOnly(r[inI]);
        let b = dOut && dOut.minutes != null ? dOut.minutes : timeOnly(r[outI]);
        if (a == null || b == null) { skipped++; continue; }
        if (dIn && dOut && dOut.date > dIn.date) b += 1440;
        if (!inMonth(day)) continue;
        add(name, Math.max(0, b - a) / 60, day);
      }
    } else if (hoursI >= 0) {
      mode = "hours";
      for (const r of data) {
        const name = (r[nameI] || "").trim(); if (!name) continue;
        const v = hoursValue(r[hoursI]); if (v == null) { skipped++; continue; }
        const day = dateI >= 0 ? parseDate(r[dateI], order) : null;
        if (!inMonth(day)) continue;
        add(name, v, day);
      }
    } else if (timeI >= 0 || dateI >= 0) {
      mode = "scans";  // one row per scan: first and last scan of each day
      const per = new Map();
      for (const r of data) {
        const name = (r[nameI] || "").trim(); if (!name) continue;
        let dt = timeI >= 0 ? parseDateTime(r[timeI], order) : null;
        if ((!dt || dt.minutes == null) && dateI >= 0) {
          const d = parseDate(r[dateI], order); const tm = timeI >= 0 ? timeOnly(r[timeI]) : null;
          dt = d && tm != null ? { date: d, minutes: tm } : null;
        }
        if (!dt || dt.minutes == null) { skipped++; continue; }
        if (!inMonth(dt.date)) continue;
        const k = name + "\u0000" + dt.date;
        const cur = per.get(k) || { name, date: dt.date, first: Infinity, last: -Infinity };
        cur.first = Math.min(cur.first, dt.minutes); cur.last = Math.max(cur.last, dt.minutes);
        per.set(k, cur);
      }
      for (const v of per.values()) add(v.name, Math.max(0, v.last - v.first) / 60, v.date);
    } else return { error: "Could not find hours, in/out, or scan-time columns." };
    const dayCounts = new Map([...days.entries()].map(([k, s]) => [k, s.size]));
    return { mode, totals, days: dayCounts, skipped };
  }

  const api = {
    DEFAULT_SETTINGS, parseCSV, toCSV, parseDateTime, parseDate, workingDaysLate, workingDaysBetween, workingDaysInMonth,
    isWorkingDay, holidaySet, monthAdd, monthOf, mapColumns, parseJiraExport, timingPoints, qualityPoints, scoreTask,
    bandFor, gateFor, ethicsFor, taskFromJiraApi, jiraJql, jiraRanges, splitRange, JIRA_FIELDS, computePerson, unmatchedAssignees, parseHoursFile, hoursValue, round1, norm, countable,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PayEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
