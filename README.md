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
| `index.html` | The page: layout and styles (sidebar navigation, top bar with the pay month, payslip side panel; icon rail on tablets, bottom bar on phones). |
| `engine.js` | All the pay math. Pure functions, no DOM. Runs in the browser, the server and the tests. |
| `app.js` | The app: tabs, payslip, Jira pull and CSV import, hours import, incidents, team, settings, storage. |
| `login.html` | The sign-in page (same colors and fonts as the app). |
| `server.js` | Small Node server: serves the site behind a sign-in page, reads Jira with an API token, stores the shared data. No packages needed. |
| `store.js` | Shared data storage: a file on this computer, or Upstash Redis on Vercel. |
| `api/index.js`, `vercel.json` | Runs the same server on Vercel. |
| `test_engine.js` | 54 unit tests of the engine with hand-checked values. |
| `tests/server.test.js` | Server tests: Jira paging, query checks, sign-in and cookie, which files are served, shared data (file, Redis). |
| `tests/e2e.js` | Browser test of the full month flow, including Pull from Jira (820,800 AMD worked example). |

## Put it online with Vercel (one time, about 10 minutes)

1. **Create the project.** On vercel.com: *Add New → Project → Import* `salary-calculator`.
   Framework preset: *Other*. Leave everything else as it is and press *Deploy*.
2. **Add the shared database.** In the project: *Storage → Create Database → Upstash for Redis* (free plan),
   and connect it to this project. Vercel adds its connection settings for you.
3. **Add the secrets.** *Settings → Environment Variables*, add these three:

   | Name | Value |
   |---|---|
   | `APP_PASSWORD` | a long password for the site (share it only with the founders) |
   | `JIRA_EMAIL` | the Atlassian account e-mail that owns the API token |
   | `JIRA_API_TOKEN` | the token from https://id.atlassian.com/manage-profile/security/api-tokens |

4. **Redeploy.** *Deployments → … → Redeploy*, so the new settings are picked up.
5. **Open the site.** Type your `APP_PASSWORD` on the sign-in page (you stay signed in for 7 days). Settings → Backup lets you load data you already have.

Every change pushed to `main` is published automatically. Other branches get their own preview link.

## Use your own domain (bought from internet.am)

The code needs no change for this: it works on any address. Two places to set up, Vercel and internet.am.
Below, `example.am` stands for your domain.

1. **Tell Vercel about the domain.** In the project: *Settings → Domains → Add*, type `example.am`, and accept
   the suggestion to also add `www.example.am` (one of them redirects to the other).
   Vercel then lists the DNS records it wants. **Copy the values from that screen**; they are the right ones for
   your project. They usually look like this:

   | Type | Name (host) | Value |
   |---|---|---|
   | `A` | `@` (empty, the domain itself) | `76.76.21.21` (or the IP Vercel shows) |
   | `CNAME` | `www` | `cname.vercel-dns.com` (or the `…vercel-dns…com` value Vercel shows) |

2. **Add the records at internet.am.** Sign in to your account on internet.am, open the domain, and find its
   DNS management (DNS records / zone editor). Add the two records above exactly as Vercel shows them,
   and delete any old `A` record for `@` or `CNAME` for `www` that points somewhere else (a parking page).
   - If the domain's DNS is not hosted at internet.am (no records page), use the other way instead:
     change the domain's **name servers** to `ns1.vercel-dns.com` and `ns2.vercel-dns.com`, and Vercel
     creates the records itself.

3. **Wait.** Usually minutes, sometimes a few hours. The Domains page turns to *Valid Configuration*, and
   Vercel issues the HTTPS certificate on its own. Then open `https://example.am`; it asks for the same
   password as before.

If it still says *Invalid Configuration* after a few hours, check the records from any computer:

```bash
nslookup example.am
```

```bash
nslookup www.example.am
```

The first must answer with Vercel's IP, the second with the Vercel `CNAME`. Anything else means an old record
is still there, or the name servers are not the ones you edited.

## Connecting Jira

The calculator reads Jira in one of two ways. It never changes anything in Jira.

| Where the page runs | How it reads Jira |
|---|---|
| Inside Claude (the artifact) | Your Atlassian connector. Nothing to set up. |
| As a website (Vercel or `npm start`) | The server, with a Jira API token. The token stays on the server; the browser never sees it. |

On your own computer:

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
- **On Vercel:** the Upstash Redis database. Everyone with the password sees the same data, and changes show up
  on the other founder's screen within a few seconds.
- **`npm start` on your computer:** the file `data/db.json` (never committed).
- **Opened as a plain file:** this browser only.
- **Settings → Backup** downloads everything as one file, and restores it. **Try sample data** never touches saved data.

## Security

- Salaries are confidential. Without `APP_PASSWORD` the server only listens on this computer (127.0.0.1) and refuses
  to start on a public address. On Vercel the site stays locked (a plain "set APP_PASSWORD" message) until it is set.
- **Sign-in page.** With `APP_PASSWORD` set, the site shows its own sign-in page at `/login` (no browser popup). Until
  you sign in, every page sends you to `/login` and every `/api/…` request answers `401` with JSON; `index.html`,
  `app.js` and `engine.js` are not sent. Only the password is asked (`APP_USER` is no longer needed).
- **Staying signed in.** A correct password sets a cookie that lasts 7 days. It is `HttpOnly` (page scripts can't read
  it), `SameSite=Lax`, and `Secure` on Vercel and anywhere behind HTTPS (only plain `http://` on your own computer
  leaves `Secure` out, or the browser would never send it back). The server keeps no list of sessions: the cookie is
  an expiry time signed with HMAC-SHA256, using a key made from `APP_PASSWORD`. It can't be forged or extended, and it
  never contains the password.
- **Changing the password:** Settings → Password (needs the shared database). Type the current password and the new
  one twice. The new one is stored only as a salted scrypt hash, in its own database key: it is not part of the
  shared documents, not in backups, and "Restore from backup" doesn't touch it. Everyone else is signed out at once
  (on Vercel, other running copies of the server notice within 5 seconds); the browser that made the change stays in.
  Wrong "current password" tries count toward the same 10-tries lock as the sign-in page.
- **Forgot the password set in Settings?** Change `APP_PASSWORD` in Vercel and redeploy. The stored password is tied
  to the `APP_PASSWORD` it replaced, so a new `APP_PASSWORD` makes it stop working and the new one works again.
- **Signing everyone out:** change the password in Settings, or change `APP_PASSWORD` in Vercel and redeploy. Every
  old cookie stops working at once.
  `SESSION_SECRET` is optional: if you set it, it is mixed into the signing key too (changing it also signs everyone
  out, without changing the password). You don't need to add it.
- **Log out** is the button at the right end of the top bar. It removes the cookie from that browser.
- **Wrong passwords:** 10 wrong tries from one address lock sign-in for that address for 15 minutes (people already
  signed in keep working). The password is compared in constant time. On Vercel the count is kept in the running
  server's memory, so it can restart when Vercel starts a fresh copy of the server; use a long password.
- Put the site behind HTTPS when it is online (Vercel, Render, Railway, Fly.io and similar do this for you).
- After sign-in the server only serves `index.html`, `app.js` and `engine.js`, never `.env` or the server code.

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

The browser test needs Playwright with Chromium. Screenshots are written to `tests/screenshots/`.
