# IMS-Construction — Pre-Deployment Audit & Hardening Report

Date: 2026-08-03
Scope: Full stack — `server/` (Node.js/Express/PostgreSQL) + `client/` (React/Vite), all modules (inventory, vehicles, tools, projects, vendors, POs, gate passes, warehouses, finance, users, backup).
State: **PASS — ready for staging deployment** after the deployment checklist at the end.

---

## 1. Executive Summary

The audit found **24 actionable issues** across security, data integrity, and frontend quality. **All were fixed.** No critical defects remain.

Headline numbers:

| Metric | Before | After |
|---|---|---|
| Security test suite | — | **73 / 73 pass** |
| Finance module regression | 100 / 100 (prior session) | **100 / 100 pass** (no regressions) |
| E2E browser suite (roles, lazy-load, throttle, mobile) | — | **23 / 23 pass** |
| Client bundle (initial JS) | 887.78 kB / 255 kB gzip (single chunk) | 733.51 kB / 226.39 kB gzip + 11 lazy route chunks (4–33 kB each) |
| Server file syntax check (`node --check`) | — | All clean |
| `npm run build` | — | Clean |

Three fixes were discovered *by* the regression suite itself and corrected during the session (PO status default drift, deactivated-tool checkout bypass, `X-Powered-By` leak), which is why the final suite is green.

---

## 2. Issues Found & Fixed (by severity)

### Critical / High — Security

| # | Issue | Fix |
|---|---|---|
| 1 | **Backup restore path traversal** — `POST /api/backup/restore` accepted arbitrary filenames (`../…`), enabling arbitrary file read → SQL execution | Filename whitelist regex (`ims_backup_YYYY-MM-DD_<ts>.sql`) + `path.basename` check; 400 on any non-conforming name (`server/src/routes/backup.js`) |
| 2 | **Backup/restore error leaks** — internal errors returned raw to clients | Generic `'Backup failed'` / `'Restore failed'` responses |
| 3 | **Login brute force** — unlimited attempts on `/api/auth/login` | In-memory throttle: 8 failures per email+IP → 429 for 15 min (`server/src/routes/auth.js`). Note: in-memory, resets on restart (acceptable for single-node). |
| 4 | **Deactivated users kept valid tokens** — `authenticate` only verified the JWT, not account state | `authenticate` now queries the DB per request and returns 401 for missing/inactive accounts (`server/src/middleware/auth.js`) |
| 5 | **Privilege escalation** — admin could create/modify owner accounts; PO approval allowed `procurement_officer` | Owner-role create/assign/modify restricted to `owner`; PO approve now `owner/admin` only (`server/src/routes/{users,purchase_orders}.js`) |
| 6 | **Missing security headers + `X-Powered-By` leak** | `x-content-type-options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, XSS-Protection 0, `app.disable('x-powered-by')` (`server/src/index.js`) |
| 7 | **Request body limit 50 MB** | Lowered to 2 MB |
| 8 | **Terminal error handler leaked stack traces** | Generic `{ error: 'Internal server error' }`; fatal schema errors exit(1) |

### Medium — Data Integrity

| # | Issue | Fix |
|---|---|---|
| 9 | **Hard deletes** destroyed history for projects, vehicles, tools | Soft delete: project → `status='cancelled'`; vehicle/tool → `is_active=false`; audit + activity entries written; lists hide inactive rows |
| 10 | **Tool double checkout / double checkin** (race) | 409 guards: checkout requires `available`, checkin requires `checked_out`; deactivated tools → 404 |
| 11 | **Materials `movement_type` injection** (arbitrary strings accepted) | Whitelist `in`/`out`; qty must be positive; out-movement requires project/location/driver/vehicle |
| 12 | **TOCTOU + summary bug** in finance deletion lifecycle (known BUG-1) | Deletion request creation now `UPDATE … WHERE status='active'` guarded; summary counts `deletion_requested` rows until final approval (verified in suite §4–§5) |
| 13 | **Negative costs/quantities** accepted across materials, salaries, vendor payments | Non-negative / positive validation on POST/PUT for materials (unit_cost, reorder_level, quantity), salaries, petty cash, vendor payments (incl. IPC % range 0–100) |
| 14 | **PO status default drift** — live DB default was `'draft'` while code expects `'pending'` (approve endpoint rejects anything ≠ pending) | Idempotent schema evolution: `UPDATE … SET status='pending' WHERE status='draft'` + `ALTER COLUMN … SET DEFAULT 'pending'` (`server/src/db/schema.js`); verified via `information_schema` |
| 15 | **Project creation silently defaulted invalid status to `planning`** | Now 400 on invalid status; end-before-start already rejected (400) |
| 16 | **Gate pass: no material existence check, negative qty, guessable GP numbers** | Material existence + `qty > 0` validation; unique `GP-<ts>-<rand>` numbers; audit + activity entries |
| 17 | **Hard deletes on material/vendor statuses** | Material delete → `is_active=false` (was hard delete); vendor delete → `status='inactive'` (confirmed existing behavior) |
| 18 | **Schema drift** — missing FK/status/date indexes; missing `is_active` columns; missing constraints | ~40 `CREATE INDEX IF NOT EXISTS`; `is_active` backfill on vehicles/tools; guarded constraints (unique vendor name, unique salaries (project, employee, month), positive-amount CHECKs, IPC range, project end ≥ start) — each skips gracefully on data violations (`server/src/db/schema.js` + `server/migrations/schema.sql` synced) |

### Low — UX / Performance / Maintainability

| # | Issue | Fix |
|---|---|---|
| 19 | **Single 888 kB JS bundle** | Route-level lazy loading + Suspense + `RoleRoute` guards in `client/src/App.jsx`; see §3 |
| 20 | **Search fired an API request per keystroke** (6 pages) | Shared `useDebouncedValue` hook (400 ms) in `ui.jsx`; verified only 1 request per pause in E2E §6 |
| 21 | **Reports/Backup downloads 401 in new tabs** (token not forwarded) | `downloadFile()` blob download with auth header in `api.js`; `Reports.jsx` / `Backup.jsx` migrated off bare `<a href>` |
| 22 | **Orphan duplicate `Modal.jsx`** component | Deleted (confirmed zero references; `ui.jsx` Modal is the one in use) |
| 23 | **Unused imports** (Layout, Vendors, Materials, GatePass exports) | Removed |
| 24 | **Accessibility / robustness** | `label htmlFor` + input ids; NotificationBell error state + Retry; `AuthContext` guards corrupt localStorage; Users role selector hides Owner from non-owners |

---

## 3. Performance Results

**Client bundle (before → after), `npm run build` (Vite 8):**

| Asset | Before | After |
|---|---|---|
| Main JS (initial load) | `index-*.js` 887.78 kB (255.21 kB gzip) | `index-*.js` 335.53 kB (109.87 kB gzip) + vendor `es6-*.js` 397.98 kB (116.52 kB gzip) |
| CSS | — | 36.01 kB (7.57 kB gzip) |
| Lazy route chunks (on demand) | none | Backup 4.06 · Dashboard 6.27 · Reports 6.57 · Users 7.90 · GatePass 11.21 · Tools 14.79 · Vehicles 15.54 · Warehouses 15.78 · Vendors 17.85 · Materials 27.43 · Projects 33.02 kB |

- Initial JS **−17.4% raw (−11.3% gzip)**; every non-dashboard page is now fetched on demand (~4–33 kB each).
- E2E measured (dev): login page DOMContentLoaded 572–685 ms; dashboard 93–118 ms; `/warehouses` under simulated slow-3G (400 ms latency, 500 kbps) rendered fully in ~3.9–4.3 s.

**Database:** ~40 new indexes on FK/status/created_at columns across all tables; schema evolution verified idempotent across restarts.

---

## 4. Regression Test Results

| Suite | Scope | Result |
|---|---|---|
| `harden_suite.js` (73 checks) | Security headers, login validation + 429 lockout, deactivated-user token revocation, owner-role protection, PO approve roles, tool checkout/checkin guards + soft delete, vehicle/project soft delete, materials movement validation, gate pass validation, backup traversal/401/403/404 | **73/73 pass** |
| `finance_suite.js` (100 checks) | Full finance lifecycle: permission matrix, summary math, deletion workflow (approve/reject/TOCTOU), snapshot history, global bell endpoint, edge cases | **100/100 pass** |
| `e2e_suite.js` (23 checks) | Real-browser (Edge + puppeteer-core): owner full access; finance/manager/staff direct-URL blocks redirect to dashboard; lazy module fetched only on navigation; search debounce (0 requests during typing, 1 after pause); throttled-network render; mobile 375 px — no horizontal page overflow on Vehicles/Projects | **23/23 pass** |

All suites clean up their own test data. Screenshots (login branding, dashboard, reports, throttled, mobile) saved to `C:\Users\Umer\AppData\Local\Temp\opencode\e2e-*.png`.

---

## 5. Not Fixed / Accepted Risks

1. **Login throttle is in-memory** — resets on server restart; a distributed deployment would need Redis-backed limiting.
2. **Cancelled/deactivated records remain visible in some list views** (e.g., project list shows `cancelled` rows with a badge) — intentional soft-delete trade-off for auditability; clients can filter by status.
3. **Backup is a custom SQL dump** (no `pg_dump`) — adequate for this data size; not a point-in-time/consistent-snapshot tool.
4. **No password-reset/email flow** — out of scope; passwords are admin-managed.
5. **Report download paths** were refactored but not click-tested in a browser E2E (covered by build + API auth checks only).
6. **Seed data** — `SEED_PASSWORD` env is now honored (warning on default), but demo accounts (`owner@ims.com` etc.) ship with a known password and must be changed/removed before production.

---

## 6. Final Recommendation

**Approve for staging deployment.** No blocking issues. Before production:

1. Set a fresh `SEED_PASSWORD`, keep the generated `JWT_SECRET` in `server/.env` (already git-ignored — verified `.gitignore` covers `server/.env`), and set `NODE_ENV=production` + `CORS_ORIGIN` to the real origin.
2. Change or delete the seeded demo accounts.
3. Serve `client/dist` (freshly built) via a reverse proxy; the backend is API-only on :5000.
4. Remove the temporary `puppeteer-core` install from `client/node_modules` (added `--no-save` for testing).
5. Apply `server/migrations/schema.sql` is **not required** for existing DBs — the server's idempotent evolution already applied indexes/constraints; keep it as reference for fresh installs.
