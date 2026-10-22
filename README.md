# Chai Options

A private options journal for sell puts, sell calls, and buy puts. Record opening premiums, fees and full closes; view daily cash flow, realized profit/loss, strategy results and open positions. Trades are entered manually. USD only; no broker integration, partial closes, assignment or stock accounting.

## Run locally

Requires Node.js 24 (uses built-in SQLite). Run `npm ci` to install the locked dependencies. Local development defaults to SQLite.

1. Copy `.env.example` to `.env`.
2. Set `ROOT_EMAIL` and a strong `ROOT_PASSWORD` (12–128 characters) in `.env`. Never commit this file.
3. Run `npm ci`, `npm test`, then `npm start`.
4. Sign in with these credentials. You must change the initial password before accessing trading records.

Default port: 3000. `PORT` overrides it. `DATA_DIR` defaults to `./data`. The local SQLite database contains hashed passwords, session hashes, and trade records. Keep this directory persistent and private. Hosted PostgreSQL stores the same records remotely. Initial root variables create the first user only; changing the variables later does not reset an existing user's password. There is no public registration or email password reset service.

## Migrate to Vercel Hobby + the existing Neon database

The Vercel configuration separates static pages from the database API. `npm run build:vercel` generates the login and dashboard pages and fingerprinted public assets in `dist/` without connecting to Neon or embedding secrets. Vercel serves these from its CDN. `api/index.js` starts the shared application only when an API request arrives, removing the need to wake a Render container before displaying the login page. Small serverless/database startup delays can still occur.

Use the free Hobby plan for personal, non-commercial journals. Do not create a paid plan or paid add-on. In the Vercel project, select this GitHub repository and use the committed `vercel.json`: Other framework, Node 24, `npm ci`, build `npm run build:vercel`, output `dist`, and the bundled API function. Existing cookies are tied to the old domain, so users sign in again on the new domain; their stored password hashes and trade records stay in Neon.

For ChaiOptions, configure these values in Vercel's secure environment settings:

| Variable           | Setting                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`     | Copy the existing Neon connection securely; never put it in Git or chat.                                           |
| `ROOT_EMAIL`       | `huatchaisg@gmail.com`                                                                                             |
| `ROOT_PASSWORD`    | Existing bootstrap secret, or a generated strong secret for a new database only. Existing passwords are preserved. |
| `DB_SCHEMA`        | `public`                                                                                                           |
| `APP_NAME`         | `Chai`                                                                                                             |
| `APP_SLUG`         | `chai-options`                                                                                                     |
| `REQUIRE_DATABASE` | `true`                                                                                                             |

Vercel supplies `VERCEL` and the production Node environment. Production startup requires PostgreSQL. The API uses secure cookies, the same sessions and trade schema, and database-backed login limits that survive function restarts. SQL schema initialization and bootstrap insertion are idempotent; no migration resets a user's password or replaces trading records. Use the existing `jean_options` schema and Jean's own branding and root email for any separate JeanOptions project.

`npm run dev:vercel` runs a local static/CDN and parsed-body API routing harness. Automated integration tests cover both the conventional server and this serverless adapter, including login limits surviving a restart. `SMOKE_SERVER=scripts/serve-vercel-local.mjs` runs the browser workflow through the new path.

Deploy and verify the static login page, `/health`, sign-in, trade persistence and logout on Vercel before retiring the old site. Vercel deployment access must be available in the current chat or official CLI; an account connection elsewhere does not expose deployment tools automatically. No Vercel deployment has been published by this migration preparation alone.

## Legacy Render deployment

`render.yaml` uses Render's free Node web service and a separate Neon free PostgreSQL database. There is no Render persistent disk or paid database in this configuration. Free-tier quotas and terms apply; Render may sleep when idle, so the first request can take time. Never enable paid upgrades without reviewing their price.

1. Create a free Neon project at https://console.neon.tech/. Choose a region near Singapore if available. Copy its PostgreSQL connection string with TLS enabled.
2. Connect this GitHub repository to Render as a Blueprint. Set `DATABASE_URL` securely in Render Environment settings to the Neon connection string. Do not put it in Git or chat. `ROOT_EMAIL` is set to `huatchaisg@gmail.com` and `ROOT_PASSWORD` is generated as an environment secret.
3. Deploy. The service intentionally refuses startup while `REQUIRE_DATABASE=true` and `DATABASE_URL` is missing, preventing accidental storage of real trades on an ephemeral filesystem. The schema is created automatically; no SQL scripts are required.
4. Wait for the service to become Live, then verify `/health` returns `{"status":"ok"}`. This check queries the database.
5. Sign in with the root email and generated password. Change the password at first sign-in. The change and your trades persist in Neon across web-server restarts.
6. Record and close a test trade, reload, and verify the results. Use Export for additional backups.

The deployment helper can also provision this configuration using Render's API without logging credentials. Deployment still needs Render access plus a user-configured Neon database. A deployed service awaiting `DATABASE_URL` is not a working app.

For another host, run `npm ci && npm start` on Node 24 with `NODE_ENV=production`, `REQUIRE_DATABASE=true`, `DATABASE_URL`, `ROOT_EMAIL` and `ROOT_PASSWORD`. Use a TLS-enabled PostgreSQL connection. TLS verification is not disabled. The host must terminate HTTPS and forward to `PORT`.

Without `DATABASE_URL`, local development uses SQLite in `DATA_DIR` (default `./data`). Switching to PostgreSQL does not migrate existing SQLite records; export a JSON backup before switching and import it after signing in to the new database.

## Accounting

- Sell put/call: opening premium minus closing premium, multiplied by contracts × multiplier, minus both sets of fees.
- Buy put: closing premium minus opening premium, multiplied by contracts × multiplier, minus both sets of fees.
- An open trade is never counted as realized profit. A close at zero records expiration without value.
- Realized profit belongs to the close date. Cash flow belongs to each transaction date. Dates are calendar dates chosen by the user; the default date comes from the device.
- Opening premium collected is gross, while net cash flow and realized results include fees. Daily cash-in/out are net transaction amounts, not gross turnover.
- Filters apply to transaction/close dates; open position counts show current open trades across all dates for the selected strategy.

## Security and backups

Passwords are salted and hashed with scrypt. Sessions use random tokens, hashed server storage, HttpOnly/SameSite cookies, seven-day expiry and secure cookies in production. Login is rate-limited by connecting IP; behind a shared reverse proxy the limit may be shared. Password updates invalidate other sessions. Writes require a same-site custom-header JSON request. Revision checks prevent stale browser windows from silently overwriting newer trades. Import validates the entire backup and replaces the account's trade list only after confirmation.

Use HTTPS in production. Use the database provider’s access controls and backup options. Restrict access to local database directories. Exported JSON contains trading data; protect it. The initial local instance's generated credentials are in ignored `credentials.local.md`, not in Git or the public directory.

## Validation

`npm test` covers premium calculations, fees, winning/losing closes, expiry, custom multipliers, event dates, login, first-password change, CSRF checks, stale-write conflicts, invalid inputs, session logout and database persistence after restart. Run the same integration suite against an isolated PostgreSQL test database by setting `TEST_DATABASE_URL`; never point tests at a real trading database. Concurrent writes are tested so only one request for the same revision can succeed. Browser smoke checks were also performed for login, trade entry, early close, reload, mobile layout and logout.

### Deployment and browser helpers

The free-service API helper is `scripts/deploy-render.py`. Supply `--owner-id`, `--root-email`, and a private `--credentials-dir` outside this checkout. It uses `RENDER_API_KEY` from the environment, creates only a free web service, and never prints credentials. Use `--dry-run` to inspect the configuration without making API calls. Add the Neon connection string in Render's Environment settings after service creation.

`scripts/browser-smoke.mjs` runs the browser workflow against an isolated local server and temporary credentials. It requires Playwright and Chromium. Set `PLAYWRIGHT_MODULE` to the Playwright module path if it is installed outside this project. Optionally set `TEST_DATABASE_URL` to an isolated PostgreSQL database; the browser check writes test data, so never use the production database.

## Separate private journals

One codebase can host separate Chai and JeanOptions services. Each service must have its own `ROOT_EMAIL`, generated `ROOT_PASSWORD`, `APP_NAME`, `APP_SLUG`, and `DB_SCHEMA` (for example, `jean_options`). Each PostgreSQL query explicitly names its schema, without a public-schema fallback or reliance on pooled session settings. Account, session and trade tables are separate; the Chai login cannot access JeanOptions. Local SQLite instances also use separate files when schema names differ.

This provides separation between app accounts, not privacy from the hosting/database administrator. Anyone controlling Render or Neon can still access the underlying records or reset accounts. Full independence requires Jean-controlled hosting and database accounts. There is no shared admin dashboard in the app.

The deployment helper accepts `--service-name jean-options --app-name JeanOptions --db-schema jean_options` and can copy the existing database connection directly between Render services using `--copy-database-from-service <id>`. Connection values are never printed or written to source. Store each app's generated credentials in a different private directory outside the checkout.

## Loading speed

Render's free web service may sleep when idle. Opening it afterward can take tens of seconds while it wakes; browser caching cannot remove that server startup delay. Once awake, normal requests are much faster. Public CSS, scripts and the icon use versioned URLs and long-lived browser caching, with ETag revalidation for unversioned requests. Deployment changes update the asset version automatically. HTML, account responses and trade records remain `no-store`. No background traffic is scheduled to keep the free service awake.
