# Glana Pay Calculator: full specification

Build a web app that calculates monthly pay for Glana employees from three inputs: Jira tasks, office hours, and logged misconduct. This document is the complete description of the rules and data. Two files come with it and are the source of truth for the math:

- `engine.js`: the working calculation engine (pure JavaScript, no dependencies, runs in Node and the browser). Reuse it as is, or port it and keep the behaviour identical.
- `test_engine.js`: 54 unit tests with hand-checked expected values. Run `node test_engine.js`. Any port must pass the same cases.

If this document and `engine.js` ever disagree, `engine.js` wins.

---

## 1. The pay model in one page

Every employee has a **current salary** (what they earn today). Under the system:

- **Base salary** = 80% of current salary. Always paid.
- **Monthly bonus** = 0% to 60% of base, earned through performance.
- **Extra** = an optional amount the founders add by hand for one month.

```
Bonus = BasePaid × Bonus% × AttendanceGate × (1 − EthicsDeduction)
Total = BasePaid + Bonus + Extra
```

| Input | Source | Produces |
|---|---|---|
| Tasks | Jira | Monthly score 0–100 → Bonus % (0, 10, 20, 35, 48, 60) |
| Attendance | Door scanner / manual entry | Gate: 1.0, 0.5 or 0 |
| Ethics | Incidents logged by founders | Deduction 0–100% of the bonus |

Example (current salary 900,000 AMD): base 720,000; score 86.9 → 35%; gate 1.0; one major + one minor incident → 60% deduction. Bonus = 720,000 × 0.35 × 1 × 0.40 = 100,800. Total = 820,800.

Currency is AMD, whole numbers. Round base, bonus and totals to the nearest integer.

The same rules apply to every role. Scoring is per person, across all Jira projects.

---

## 2. Settings (all editable, these are the defaults)

```js
{
  basePct: 80,              // base = 80% of current salary
  hoursPerDay: 8,           // includes lunch
  minTasks: 4,              // fewer than this in the pay month = "quiet month"
  poolMonths: 3,            // quiet month: use tasks from the last 3 months (pay month included)
  defaultBonusPct: 35,      // used when there is not enough task data
  bands: [                  // checked top-down against the score rounded to 1 decimal
    { min: 96, pct: 60, label: "Excellent" },
    { min: 92, pct: 48, label: "Strong" },
    { min: 85, pct: 35, label: "Normal good" },
    { min: 75, pct: 20, label: "Weak" },
    { min: 65, pct: 10, label: "Poor" },
    { min: 0,  pct: 0,  label: "Fail" },
  ],
  timing:  { onTime: 100, late1: 60, late2to3: 30, late4plus: 0 },
  quality: { firstTime: 100, rejectedOnce: 50, rejected2plus: 0 },
  gates: [ { min: 100, gate: 1 }, { min: 90, gate: 0.5 }, { min: 0, gate: 0 } ],  // % of required hours
  penalties: { minor: 10, major: 50 },   // % of the bonus per incident; critical = 100%
  issueTypes: ["Task", "Subtask", "Sub-task", "Bug"],   // only these are scored
  excludeLabel: "cancelled",             // tasks with this label are skipped
  shadowMonths: ["2026-12", "2027-01"],  // trial months: current salary is paid, new pay is shown for comparison
  jiraProjects: "GOD, PRJ, AWE",
  holidays: [ /* ISO dates, Armenian public holidays, see section 9 */ ],
}
```

---

## 3. Task scoring

### 3.1 Which tasks count for a person

A task counts when all of these are true:

1. It has a **Resolved** date (it was accepted, i.e. moved to Done by a founder).
2. Its issue type is in `issueTypes` (case-insensitive). A task with no type is allowed.
3. It does not carry the `excludeLabel` label (case-insensitive).
4. Its **Assignee** display name matches the employee's Jira name (or their name), compared case-insensitively after trimming and collapsing spaces.

Unassigned tasks and tasks assigned to people who are not on the team (founders, "Former user") are ignored. The app should list those names with counts so a missing employee is noticed.

A task belongs to the month of its **Resolved** date (the calendar month, `YYYY-MM`).

### 3.2 Score of one task

Each task gets a timing score and a quality score.

**Timing**: compare the **Submitted** date with the **Due date**, in whole days.

- Submitted = the moment the employee moved the task to In Review (Jira custom field). If it is empty, fall back to the Resolved date.
- `late` = number of **working days** strictly after the due date, up to and including the submitted date. Working days are Monday to Friday, excluding the holidays list. On time or early = 0.
- Points: 0 late → 100; 1 → 60; 2 or 3 → 30; 4 or more → 0.

Examples: due Thursday, submitted the next Monday = 2 late (Friday, Monday). Due 30 Dec, submitted 4 Jan with 31 Dec and 1 Jan as holidays = 1 late.

**Quality**: from the Jira counters.

- Reopened ≥ 1, or Rejections ≥ 2 → 0
- Rejections = 1 → 50
- Otherwise → 100

**Task score**

- With a due date: `(timing + quality) / 2`
- Without a due date: `quality` only (timing is not counted)

### 3.3 Monthly score and bonus %

Let `inMonth` = the person's counted tasks resolved in the pay month, and `pool` = their counted tasks resolved in the last `poolMonths` months including the pay month (for December: October, November, December).

1. If `inMonth` has at least `minTasks` (4) tasks: score = simple average of the `inMonth` task scores. Basis = "month".
2. Else if `pool` has at least 4 tasks: score = simple average of all `pool` task scores. Basis = "pool" (quiet month).
3. Else: no band is applied; Bonus % = `defaultBonusPct` (35). Basis = "default". (Covers new joiners.)

There are no task weights. Every task counts equally.

Round the score to 1 decimal, then find the first band whose `min` ≤ score. Because rounding happens first, 95.95 becomes 96.0 and pays 60%; 95.94 becomes 95.9 and pays 48%.

**Important for the Jira pull:** always load three months of tasks (the pay month and the two before it), because rule 2 needs them. Only the pay month's tasks are scored in the normal case; the earlier months are a reserve. In the UI, show the pay month's count as the headline number and the earlier months separately, otherwise the total looks wrong.

---

## 4. Attendance

Per person per month, the founders enter (or import): `worked` hours, `leave` days, `sick` days, `unpaid` days.

```
monthDays     = working days in the month (Mon–Fri minus holidays)
employedDays  = working days between max(startDate, monthStart) and min(endDate, monthEnd)
paidDays      = employedDays − unpaid          (never below 0)
requiredDays  = paidDays − leave − sick        (never below 0)
requiredHours = requiredDays × hoursPerDay
attendance%   = worked / requiredHours × 100   (100 if requiredHours is 0)
```

Gate: attendance ≥ 100% → 1.0; ≥ 90% → 0.5; below 90% → 0.

Special cases:

- **Hours not entered** → the gate is 0, the bonus is 0, and the row is flagged "Hours not entered". The month is not complete until hours exist for everyone.
- **"Don't count working hours this month"** switch (per month): gate = 1.0 for everyone, hours are ignored. Leave and unpaid days still affect proration. Used until the door scanner is installed.

### Door-scanner import

The scanner records a scan when someone arrives and when they leave. Accept a CSV in any of three shapes and total the hours per person for the pay month:

1. **Totals**: a name column and an hours column (decimal, `hh:mm`, or `8h 30m`).
2. **Daily in/out**: name, date, check-in time, check-out time → sum of (out − in).
3. **Raw scans**: one row per scan with a name and a timestamp → per day, last scan minus first scan.

Match the name in the file to the employee by name, Jira name, or a separate "scan name" field. Show a preview with matched and unmatched names before applying. All-numeric dates are day-first (`dd/mm/yyyy`) unless a value proves otherwise. `engine.js` → `parseHoursFile` implements this.

---

## 5. Ethics

Founders log incidents: employee, date, level (`minor`, `major`, `critical`), a description, and an optional "AI slop" flag (submitting unchecked AI output; logged as major, a second one within 3 months is logged as critical).

```
deduction = 100                                   if any critical incident this month
          = min(100, minors × 10 + majors × 50)   otherwise
```

Flags to show: a critical incident ("no bonus + formal reprimand"); 3 or more minors in a month ("formal talk with founders"). The deduction applies only to that month's bonus, never to the base.

---

## 6. Pay calculation

```
base        = round(salary × basePct / 100)
prorate     = paidDays / monthDays
basePaid    = round(base × prorate)
bonus       = round(basePaid × bonusPct/100 × gate × (1 − deduction/100))
extra       = founders' extra amount for this person this month (≥ 0, with a reason)
total       = basePaid + bonus + extra
currentPaid = round(salary × prorate)        // what today's salary would pay for the same days
difference  = total − currentPaid
```

- Someone who joined or left mid-month, or took unpaid days, has base and bonus prorated by paid working days.
- **Shadow months**: the employee is actually paid `currentPaid`. The calculated `total` is shown as "would have earned".
- A normal good month pays 108% of today's salary; the maximum is 128%; a zero-bonus month pays 80%.

---

## 7. Jira integration

Site: `glana.atlassian.net` (Jira Cloud, team-managed projects GOD, PRJ, AWE).

### 7.1 Fields the calculator reads

| Meaning | Jira field | Notes |
|---|---|---|
| Key | `key` | e.g. PRJ-224 |
| Summary | `summary` | |
| Issue type | `issuetype.name` | Task, Subtask, Bug |
| Status | `status.name` | |
| Priority | `priority.name` | Highest, High, Medium, Low, Lowest |
| Assignee | `assignee.displayName` | matched to the employee's Jira name |
| Resolved | `resolutiondate` | set when a founder moves the task to Done |
| Due date | `duedate` | date only, set automatically from priority |
| Labels | `labels` | `cancelled` = skip; `manual-due` = due date typed by hand |
| Rejections | `customfield_10198` | number |
| Reopened | `customfield_10199` | number |
| Submitted | `customfield_10200` | datetime, set when moved to In Review |
| Started | `customfield_10201` | datetime, when the clock started (not used in scoring) |

Dates are used at day precision. Take the calendar date as written in the value (Jira returns Asia/Yerevan local time with a +0400 offset); do not convert to UTC first.

### 7.2 Query

One query per month of the three-month window (this keeps every page small):

```
project in (GOD, PRJ, AWE) AND issuetype in ("Task", "Subtask", "Bug")
AND resolved >= "2026-12-01" AND resolved < "2027-01-01" ORDER BY resolved ASC
```

For a standalone website, call the Jira Cloud REST search endpoint from your **server** (never from the browser, the token must stay secret): `POST https://glana.atlassian.net/rest/api/3/search/jql` with basic auth (Atlassian account email + API token), a body of `{ jql, fields: [...], maxResults: 100 }`, and follow `nextPageToken` until the response has no next page. Check the current Atlassian documentation for the exact request shape before coding. Request the fields in the table above by id.

Lesson from the current app: a page that comes back full (100 results) with no "next page" marker must not be trusted as complete. Either keep paging, or split the date range in half and query again. Deduplicate by issue key. Show the per-month counts after a pull so a truncated pull is visible.

`engine.js` → `taskFromJiraApi(issue)` maps one issue to a task record; adapt it to the raw REST shape (custom fields arrive as `fields.customfield_10198` etc.; the function already falls back to those ids). `jiraJql` and `jiraRanges` build the queries.

A CSV upload (Jira's "Export CSV, all fields") is also supported as a fallback: `parseJiraExport` reads headers such as `Issue key`, `Assignee`, `Resolved`, `Due date`, repeated `Labels` columns, and `Custom field (Submitted)`, with dates like `09/Nov/26 1:35 PM`.

### 7.3 How Jira is set up (already done, the calculator depends on it)

Workflow: Backlog → To Do → In Progress → In Review → Done → Archived (after 30 days).

- **Deadlines come from priority.** When a task first enters To Do or In Progress, an automation sets Started = now and Due date = Started + Highest 1 / High 3 / Medium 5 / Low 10 / Lowest 15 working days. Changing priority recalculates from the original start. Moving to Backlog clears the clock.
- **Only founders** can change priority or due date, and only founders can move a task to Done. Other people's changes are reverted automatically.
- **Submitted** is set when the task is moved to In Review.
- **Rejections** +1 each time a task goes from In Review back to work. **Reopened** +1 each time it leaves Done or Archived.
- Done = accepted. The Resolved date is set at that moment.

The calculator only reads Jira. It never writes to it.

---

## 8. Data model

```
Employee   { id, name, jiraName, scanName?, role?, salary, startDate?, endDate?, active }
Settings   { ...section 2 }                                   // one record
Month      { month: "YYYY-MM", skipHours: bool,
             hours:  { [employeeId]: { worked, leave, sick, unpaid } },
             extras: { [employeeId]: { amount, note } },
             jira:   { source: "jira"|"csv", pulledAt, taskCount },
             final?: { savedAt, rows: [...result snapshot per employee] } }
Task       { month (the pull it belongs to), key, summary, type, status, priority, assignee,
             resolved, due, submitted, started, rejections, reopened, labels[] }   // dates as "YYYY-MM-DD"
Incident   { id, month, employeeId, date, level, note, aiSlop, createdAt, loggedBy? }
```

Results are always computed from the inputs with the current settings; nothing calculated is stored except the optional "Save results" snapshot, which freezes a month's numbers for the record. If the live numbers later differ from the snapshot, show a warning.

Salaries and results are confidential: founders only. Employees must never see each other's numbers.

---

## 9. Holidays

Non-working days are excluded from required hours and from late-day counts. Defaults (Armenia), editable in settings:

```
2026-09-21, 2026-12-31,
2027-01-01, 2027-01-02, 2027-01-06, 2027-01-27, 2027-01-28, 2027-03-08, 2027-04-24,
2027-05-01, 2027-05-09, 2027-05-28, 2027-07-05, 2027-09-21, 2027-12-31
```

Add each new year's dates, and any extra days off the government announces.

---

## 10. Screens

1. **Payroll** (per month): one row per employee with tasks, score, bonus %, hours, gate, ethics deduction, base, bonus, extra, total, difference vs current salary. Totals row. A checklist of what is still missing (salaries, Jira tasks, hours). Export CSV. Save results.
2. **Payslip** (per employee per month): the three inputs, the formula with the actual numbers, every task with due date, submitted date, days late, rejections, timing, quality and score, the incidents, and the extra with its reason. Downloadable.
3. **Jira tasks**: Pull from Jira button, per-month counts, list of scored tasks, list of assignees not on the team.
4. **Hours**: the "don't count hours" switch, scanner file import with preview, manual entry of worked / leave / sick / unpaid.
5. **Incidents**: log, list, delete.
6. **Team**: add, edit, deactivate; shows base salary and a normal month's pay.
7. **Settings**: everything in section 2, plus holidays.

A month selector sits above everything. Shadow months are labelled.

---

## 11. Test cases to keep passing

All from `test_engine.js`:

- **Worked example**: salary 900,000; eight November 2026 tasks scoring 100, 80, 100, 75, 100, 100, 40, 100 → 86.9 → 35%; 162.5 h worked with 1 leave day (160 required) → gate 1; one major + one minor → 60% deduction → bonus 100,800, total 820,800. Without the major: 946,800. With 145 h (90.6%): gate 0.5.
- **Working days**: November 2026 = 21; December 2026 = 22 (31st is a holiday); January 2027 = 17.
- **Bands**: 100, 96 → 60; 95.9, 92 → 48; 91.9, 85 → 35; 84.9, 75 → 20; 74.9, 65 → 10; 64.9 → 0.
- **Gates**: 100 → 1; 99.9 and 90 → 0.5; 89.99 → 0.
- **Quiet month**: 2 tasks in December plus 3 in October–November → scored on all 5. One task in three months → default 35%.
- **Proration**: joined 16 Dec 2026 on 500,000 → 11 of 22 days, base paid 200,000, required 88 h, bonus 70,000 at the default 35%.
- **Skipped**: label `cancelled`, type Story, unassigned, not on the team, unresolved.
- **Ethics**: 3 majors cap at 100%; critical = 100%; 3 minors raise the flag.
- **Extra**: 50,000 added to the worked example → total 870,800; negative amounts are ignored.
