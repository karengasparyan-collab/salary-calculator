# Glana Pay Calculator

Monthly pay for Glana employees: **base (80% of current salary) + performance bonus (0–60% of base) + optional extra**,
calculated from three inputs: Jira tasks, office hours, and logged misconduct.

```
Bonus = BasePaid × Bonus% × AttendanceGate × (1 − EthicsDeduction)
Total = BasePaid + Bonus + Extra
```

The full rules are in [`docs/SPEC.md`](docs/SPEC.md). If the spec and `engine.js` ever disagree, `engine.js` wins.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: layout and styles (same look as the Glana Pay Calculator artifact). |
| `engine.js` | All the pay math. Pure functions, no DOM. Runs in the browser, the server and the tests. |
| `app.js` | The app: tabs, payslip, Jira pull and CSV import, hours import, incidents, team, settings, storage. |
| `server.js` | Small Node server: serves the site behind a password and reads Jira with an API token. No packages needed. |
| `test_engine.js` | 54 unit tests of the engine with hand-checked values. |
| `tests/server.test.js` | Server tests: Jira paging, query checks, password, which files are served. |
| `tests/e2e.js` | Browser test of the full month flow, including Pull from Jira (820,800 AMD worked example). |

## Connecting Jira

The calculator reads Jira in one of two ways. It never changes anything in Jira.

| Where the page runs | How it reads Jira |
|---|---|
| Inside Claude (the artifact) | Your Atlassian connector. Nothing to set up. |
| As a website (`npm start`) | The server, with a Jira API token. The token stays on the server; the browser never sees it. |

Website setup:

1. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens with an account that can see
   the GOD, PRJ and AWE projects.
2. Copy `.env.example` to `.env` and fill in `JIRA_EMAIL`, `JIRA_API_TOKEN` and `APP_PASSWORD`.
3. Start it:

   ```bash
   npm start
   ```

4. Open http://localhost:8080, sign in (user `glana`, your `APP_PASSWORD`), go to **Jira tasks → Pull from Jira**.

How a pull works: one request per month of the 3-month window (the pay month and the two before it). The server builds
the JQL itself (`project in (GOD, PRJ, AWE) AND issuetype in ("Task", "Subtask", "Bug") AND resolved >= … AND resolved < …`),
follows Jira's `nextPageToken` until the last page, and returns only the fields the calculator uses (no e-mails).
If a page comes back full with no next-page marker, the date range is split and asked again.
The per-month counts are shown after every pull so a missing month is easy to spot.

The Jira CSV export (*Export → Export CSV (all fields)*) still works as a fallback on the same tab.

## Where the data is saved

- **Inside Claude:** the shared artifact database.
- **As a website:** this browser's local storage, on this computer only. Use **Settings → Backup** to download a backup
  regularly and to move the data to another computer.
- **Try sample data** never touches saved data.

## Security

- Salaries are confidential. Without `APP_PASSWORD` the server only listens on this computer (127.0.0.1) and refuses
  to start on a public address. With it, every page asks for the password; 10 wrong tries lock that address out for 15 minutes.
- Put the site behind HTTPS when it is online (Render, Railway, Fly.io and similar do this for you).
- The server only serves `index.html`, `app.js` and `engine.js`, never `.env` or the server code.

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

The browser test needs Playwright with Chromium. Screenshots are written to `tests/screenshots/`.
