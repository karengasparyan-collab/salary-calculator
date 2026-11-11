/* A fake Jira Cloud for tests: POST /rest/api/3/search/jql with basic auth, JQL date filter, and
 * small pages (nextPageToken / isLast) so paging is exercised. Issues use the real REST shape. */
const http = require("http");
const E = require("../engine.js");

const pad = (n) => String(n).padStart(2, "0");
/** "13/Nov/26 4:10 PM" → "2026-11-13T16:10:00.000+0400" (Jira returns Yerevan time). */
function isoTime(s) {
  const d = E.parseDateTime(s); if (!d) return null;
  const m = d.minutes || 0;
  return `${d.date}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00.000+0400`;
}
/** Ani's November from the pay document (scores 100, 80, 100, 75, 100, 100, 40, 100 → 86.9), plus noise. */
const ANI_ROWS = [
  { key: "PRJ-1", summary: "Competitor research, Georgia", due: "13/Nov/26", sub: "12/Nov/26 4:10 PM", resolved: "13/Nov/26 11:00 AM", rej: 0 },
  { key: "PRJ-2", summary: "Venue onboarding plan", priority: "High", due: "10/Nov/26", sub: "11/Nov/26 6:30 PM", resolved: "12/Nov/26 9:00 AM", rej: 0 },
  { key: "PRJ-3", summary: "Weekly sprint report", priority: "Highest", due: "06/Nov/26", sub: "06/Nov/26 5:00 PM", resolved: "06/Nov/26 6:00 PM" },
  { key: "PRJ-4", summary: "Partner contract summary", due: "18/Nov/26", sub: "17/Nov/26 1:00 PM", resolved: "19/Nov/26 1:00 PM", rej: 1 },
  { key: "PRJ-5", summary: "Loyalty feature spec", priority: "Low", due: "27/Nov/26", sub: "26/Nov/26 1:00 PM", resolved: "27/Nov/26 1:00 PM", rej: 0, reo: 0 },
  { key: "GOD-6", summary: "Bug triage, POS app", type: "Bug", priority: "High", due: "05/Nov/26", sub: "05/Nov/26 1:00 PM", resolved: "05/Nov/26 3:00 PM" },
  { key: "PRJ-7", summary: "Investor update draft", priority: "High", due: "19/Nov/26", sub: "23/Nov/26 10:00 AM", resolved: "25/Nov/26 10:00 AM", rej: 1 },
  { key: "AWE-8", summary: "Hiring post, ops role", due: "30/Nov/26", sub: "30/Nov/26 9:00 AM", resolved: "30/Nov/26 7:00 PM", rej: 0 },
  // must be ignored for Ani's November
  { key: "PRJ-9", summary: "Cancelled idea", labels: ["cancelled"], due: "10/Nov/26", sub: "20/Nov/26 10:00 AM", resolved: "20/Nov/26 10:00 AM", rej: 3 },
  { key: "PRJ-11", summary: "Nobody's task", assignee: null, resolved: "20/Nov/26 10:00 AM" },
  { key: "PRJ-12", summary: "Former user's task", assignee: "Former user", resolved: "21/Nov/26 10:00 AM" },
  // the two reserve months
  { key: "PRJ-20", summary: "October task A", resolved: "15/Oct/26 10:00 AM", rej: 2 },
  { key: "PRJ-21", summary: "October task B", resolved: "16/Oct/26 10:00 AM" },
  { key: "AWE-22", summary: "September task", resolved: "10/Sep/26 10:00 AM" },
  // outside the window: must never be returned
  { key: "PRJ-30", summary: "August task", resolved: "20/Aug/26 10:00 AM" },
  { key: "PRJ-31", summary: "December task", resolved: "01/Dec/26 10:00 AM" },
];
function restIssue(o, i) {
  const who = o.assignee === undefined ? "Ani Example" : o.assignee;
  return {
    expand: "names,schema", id: String(20000 + i), self: "https://example.invalid/rest/api/3/issue/" + (20000 + i), key: o.key,
    fields: {
      summary: o.summary,
      issuetype: { id: "10020", name: o.type || "Task", subtask: false },
      status: { id: "10166", name: "Done", statusCategory: { key: "done" } },
      priority: { id: "3", name: o.priority || "Medium" },
      assignee: who ? { accountId: "acc-" + who, displayName: who, emailAddress: who.toLowerCase().replace(/\W+/g, ".") + "@example.com", avatarUrls: { "48x48": "https://example.invalid/a.png" } } : null,
      created: "2026-11-02T10:00:00.000+0400",
      resolutiondate: isoTime(o.resolved),
      duedate: o.due ? E.parseDate(o.due) : null,
      labels: o.labels || [],
      customfield_10198: o.rej == null ? null : o.rej,
      customfield_10199: o.reo == null ? null : o.reo,
      customfield_10200: o.sub ? isoTime(o.sub) : null,
      customfield_10201: null,
    },
  };
}
const ISSUES = ANI_ROWS.map(restIssue);

/** Start the fake Jira. Returns { url, requests, close }. */
function startFakeJira(opts) {
  opts = Object.assign({ email: "bot@example.com", token: "secret-token", pageSize: 3, issues: ISSUES }, opts);
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const json = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.method !== "POST" || req.url !== "/rest/api/3/search/jql") return json(404, { errorMessages: ["not found"] });
      const auth = Buffer.from(String(req.headers.authorization || "").replace(/^Basic /, ""), "base64").toString();
      if (auth !== `${opts.email}:${opts.token}`) return json(401, { errorMessages: ["Client must be authenticated"] });
      const body = JSON.parse(raw);
      requests.push(body);
      const from = (body.jql.match(/resolved >= "(\d{4}-\d{2}-\d{2})"/) || [])[1];
      const to = (body.jql.match(/resolved < "(\d{4}-\d{2}-\d{2})"/) || [])[1];
      if (!from || !to) return json(400, { errorMessages: ["The JQL needs a resolved date range."] });
      const hit = opts.issues.filter((it) => { const d = (it.fields.resolutiondate || "").slice(0, 10); return d >= from && d < to; });
      const start = Number(body.nextPageToken || 0);
      const size = Math.min(body.maxResults || 50, opts.pageSize);
      const page = hit.slice(start, start + size);
      const more = start + size < hit.length;
      json(200, more ? { issues: page, nextPageToken: String(start + size), isLast: false } : { issues: page, isLast: true });
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close(), opts })));
}

module.exports = { startFakeJira, ISSUES, ANI_ROWS };
