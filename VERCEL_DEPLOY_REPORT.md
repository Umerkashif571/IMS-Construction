# Vercel Deployment Prep — Report

Date: 2026-08-09 (local verification complete; deployment not yet run)

## What changed

### Server (Express → serverless-ready)
- `server/src/app.js` (NEW) — the entire Express app extracted and exported as `module.exports = app`:
  - JSON limit 2mb, security headers, CORS with `Access-Control-Allow-Origin` supporting `isServerless` / `VERCEL_PROJECT_PRODUCTION_URL` / `*.vercel.app` + local origins
  - All `/api/...` routes (auth, projects, vendors, finance, banks, warehouses, tools, audit, notifications, etc.)
  - Production static serving of `client/dist` with SPA fallback to `index.html`, `/api` 404 handler
- `server/src/index.js` — slimmed to boot responsibilities only:
  - Database schema create/migrate + seed (guarded by env), cron jobs (daily backup 2am, hourly overdue-tool notifications)
  - `app.listen()` runs **only when NOT** `process.env.VERCEL` (serverless runtime serves via handler)
- `server/package.json` — added `serverless-http@^4.0.0`, `db:init` script → `node src/scripts/bootstrap.js`
- `server/src/scripts/bootstrap.js` (NEW) — standalone `db:init` (schema + migrate + seed), used by both local setup and Vercel's installCommand

### API layer (Vercel Functions)
- `api/index.js` (NEW) — `module.exports = serverless(app)` pointing at `../server/src/app`
- `vercel.json`:
  - `installCommand`: npm install in root + `server` + `client`
  - `buildCommand`: `cd client && npm run build`
  - `builds`: `api/index.js` → `@vercel/node`, `client/dist/**` → static
  - `routes`: `/api/(.*)` → the serverless function; everything else → `/client/dist/index.html` (SPA fallback)
  - `functions.api/index.js.maxDuration = 30`

### Database pool (serverless-safe)
- `server/src/db/pool.js`: `max: process.env.VERCEL ? 1 : 10`, `connectionTimeoutMillis: 10000`, `ssl: { rejectUnauthorized: false }`, `options: '-c search_path=public'` (Supabase pooler does not default search_path to public)

### Root
- `package.json` (NEW) — scripts: `build`, `dev:client`, `dev:server`, `db:init`

## Verified locally (all pass)
| Suite | Result |
|---|---|
| `harden_suite.js` | 73/73 |
| `finance_suite_5000.js` | 100/100 |
| `finance_v2_suite.js` | 100/100 |
| `finance_v2_ui_test.js` | 22/22 |
| `e2e_suite.js` | 23/23 |
| `notif_suite.js` | 52/52 |
| `bell_ui_test.js` | 18/18 |
| `handler_test.js` (serverless path) | health/login/projects/banks 200, /api 404 fallback, HANDLER OK |

- All suites now run against the **Supabase** database (pooler URL) with rotated passwords.
- Server refactor validated live: server restarted (PID 14508), health OK, login + data endpoints OK.
- Syntax-checked: index.js, app.js, api/index.js, bootstrap.js, pool.js, vercel.json (JSON.parse).

## Env vars required in Vercel dashboard
- `DATABASE_URL` — Supabase pooler URL (`postgresql://postgres.<ref>:<PASSWORD-ROTATED>@aws-0-<region>.pooler.supabase.com:6543/postgres`)
- `JWT_SECRET` — same as server/.env
- `JWT_EXPIRES_IN` (if used)
- `CORS_ORIGIN` — Vercel production domain if custom origin not auto-detected
- `SEED_ENABLED` / seed-related vars — off for production unless seeding desired
- `VERCEL_*` — set automatically by Vercel runtime

NOT set in git: .env files, Vercel env values (user sets in dashboard).

## Known caveats
- `process.env.VERCEL` not set locally — `app.listen()` still runs; handler test invoked `app` directly (no port) to simulate serverless path.
- Cron jobs (backup/overdue notifications) run only on the always-on local server; on Vercel serverless they will not execute — serverless functions are stateless/short-lived. Consider separately hosted cron (e.g., Vercel Cron) hitting the sync endpoints if needed.
- `max=1` pool + 10s connect timeout tuned for cold starts; heavy finance workloads may need Vercel's paid function scaling.
- Upload limits and file storage (if used) should be external (e.g., S3) — Vercel functions have read-only filesystem.

## Next steps
1. `vercel` CLI: `vercel login` → `vercel link` → `vercel env add` for all required vars → `vercel deploy --prod`.
2. Post-deploy smoke: hit `/api/health` and the login endpoint on the production URL, verify SPA routes (reload deep links).
3. Re-run `e2e_suite.js` against the production URL by overriding `APP` constant (currently `http://localhost:3000`).