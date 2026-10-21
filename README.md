# Chai Options

A private options journal for sell puts, sell calls, and buy puts. Record opening premiums, fees and full closes; view daily cash flow, realized profit/loss, strategy results and open positions. Trades are entered manually. USD only; no broker integration, partial closes, assignment or stock accounting.

## Run locally

Requires Node.js 24 (uses built-in SQLite). No external packages or installation step.

1. Copy `.env.example` to `.env`.
2. Set `ROOT_EMAIL` and a strong `ROOT_PASSWORD` (12–128 characters) in `.env`. Never commit this file.
3. Run `npm test`, then `npm start`.
4. Sign in with these credentials. You must change the initial password before accessing trading records.

Default port: 3000. `PORT` overrides it. `DATA_DIR` defaults to `./data`. The SQLite database contains hashed passwords, session hashes, and trade records. Keep this directory persistent and private. Initial root variables create the first user only; changing the variables later does not reset an existing user's password. There is no public registration or email password reset service.

## Publish on Render

`render.yaml` defines a single Node 24 web service with a persistent disk. **This uses Render's paid Starter plan and persistent storage.** Review the provider's current pricing before creating it.

1. Push this project to GitHub and connect that repository in Render as a Blueprint.
2. Review the service settings, root email and generated secret `ROOT_PASSWORD`. Retrieve the generated password securely through Render environment settings, not build logs.
3. Deploy the Blueprint. Wait for `/health` to return `{"status":"ok"}` and use the HTTPS URL assigned by Render.
4. Sign in with `huatchaisg@gmail.com` and the generated password; change it immediately when prompted.
5. Record and close a test trade, reload, and verify the results. Use Export to keep a backup.

For another host, run `npm start` on Node 24 with `NODE_ENV=production`, `ROOT_EMAIL`, `ROOT_PASSWORD` and a persistent writable `DATA_DIR`. The host must terminate HTTPS and forward to `PORT`. Do not use an ephemeral/serverless filesystem for SQLite. Run one instance with this database. Public hosting requires a hosting account and deployment access; local startup alone does not publish the app.

## Accounting

- Sell put/call: opening premium minus closing premium, multiplied by contracts × multiplier, minus both sets of fees.
- Buy put: closing premium minus opening premium, multiplied by contracts × multiplier, minus both sets of fees.
- An open trade is never counted as realized profit. A close at zero records expiration without value.
- Realized profit belongs to the close date. Cash flow belongs to each transaction date. Dates are calendar dates chosen by the user; the default date comes from the device.
- Opening premium collected is gross, while net cash flow and realized results include fees. Daily cash-in/out are net transaction amounts, not gross turnover.
- Filters apply to transaction/close dates; open position counts show current open trades across all dates for the selected strategy.

## Security and backups

Passwords are salted and hashed with scrypt. Sessions use random tokens, hashed server storage, HttpOnly/SameSite cookies, seven-day expiry and secure cookies in production. Login is rate-limited by connecting IP; behind a shared reverse proxy the limit may be shared. Password updates invalidate other sessions. Writes require a same-site custom-header JSON request. Revision checks prevent stale browser windows from silently overwriting newer trades. Import validates the entire backup and replaces the account's trade list only after confirmation.

Use HTTPS in production. Configure the host to restrict access to the database directory and take persistent-volume backups. Exported JSON contains trading data; protect it. The initial local instance's generated credentials are in ignored `credentials.local.md`, not in Git or the public directory.

## Validation

`npm test` covers premium calculations, fees, winning/losing closes, expiry, custom multipliers, event dates, login, first-password change, CSRF checks, stale-write conflicts, invalid inputs, session logout and database persistence after restart. Browser smoke checks were also performed for login, trade entry, early close, reload, mobile layout and logout.
