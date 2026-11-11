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
| `engine.js` | All the pay math. Pure functions, no DOM. Runs in the browser and in Node. |
| `app.js` | The app: tabs, payslip, Jira CSV import, hours import, incidents, team, settings, storage. |
| `test_engine.js` | 54 unit tests of the engine with hand-checked values. |
| `tests/e2e.js` | Browser test of the full month flow on the worked example (820,800 AMD). |

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
npm start
```

Then go to http://localhost:8080.

## Where the data is saved

- **Opened as the Claude artifact:** the shared artifact database (same as before).
- **Opened as a website:** this browser's local storage, on this computer only. Use **Settings → Backup** to download
  a backup regularly and to move the data to another computer.
- **Try sample data** never touches saved data.

Pulling directly from Jira works inside Claude (Atlassian connector). On the website, upload the Jira CSV export
(*Export → Export CSV (all fields)*) on the Jira tasks tab.

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

The browser test needs Playwright with Chromium. Screenshots are written to `tests/screenshots/`.
