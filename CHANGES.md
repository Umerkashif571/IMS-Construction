# IMS-Construction — audit & fix pass (September 2026)

This document describes what was found, what changed, and what you must do before deploying.
Every change is in the working tree of this copy (nothing was pushed). `git diff` shows the exact edits.

## 1. Do these before you deploy — security

The public GitHub repo exposed live credentials. Rotate them **today**, in this order:

1. **Supabase → Settings → API → rotate the `service_role` key.** The old key was committed in `server/.env.example`.
2. **Supabase → Settings → Database → reset the database password.** The old pooler URL with the password was committed in `VERCEL_DEPLOY_REPORT.md`. Update `DATABASE_URL` in Vercel afterwards.
3. **Change the admin password** (`admin@ims.com / password123` was committed in `login.json`). Users → Edit → set a new password (this now works — see §3).
4. **Remove the open Row-Level-Security policies.** `server/migrations/2026-08-26_enable_rls.sql` and `2026-08-27_enable_rls_all.sql` created `"Backend full access" … FOR ALL USING (true)` on 30 tables. That policy applies to the *anon* role too, so anyone holding the public anon key (it is in the JS bundle) can read and write every table, including `users.password_hash`. The backend connects as the Postgres owner role, which bypasses RLS anyway, so the policy protects nothing. In the Supabase SQL editor:
   ```sql
   DO $$ DECLARE r record; BEGIN
     FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname='public' LOOP
       EXECUTE format('DROP POLICY IF EXISTS "Backend full access" ON %I.%I', r.schemaname, r.tablename);
     END LOOP; END $$;
   ```
   Realtime subscriptions from the browser will then stop receiving events (they were only working because the tables were open). The app no longer depends on them for correctness — lists refresh after every action and the header bell polls the API — so this is safe. If you want realtime back, move to Supabase Auth or add narrow `SELECT` policies per table for the `authenticated` role.

Git history still contains the old secrets; rotating them is what makes that harmless.

## 2. Deploying this version

- `client/dist` is committed and served by Vercel as-is. It has been rebuilt from this source — commit it with the source changes.
- **Schema:** the app no longer runs `createSchema()` on every production cold start (it ran ~150 DDL statements, including an exclusive lock on `users`, on every serverless start and made the first login wait). Production runs it **only when `RUN_MIGRATIONS=true`**. This version adds columns and two sequences (`gate_pass_seq`, `po_number_seq`) and folds the previously un-applied `2026-08-10_bankbook_linking.sql` into `createSchema()`, so for **one** deploy set `RUN_MIGRATIONS=true` in Vercel, verify, then remove it.
- `DATABASE_URL` may now include `?sslmode=disable` for a local Postgres; hosted URLs work as before. Passwords containing `@ # %` must be URL-encoded (the app decodes them).
- Pool size is 10 locally and still 1 on Vercel; the code now releases the transaction connection *before* writing audit/notification rows, so the single-connection pool no longer deadlocks.

## 3. What was wrong and what changed

A QA pass exercised every endpoint and screen with valid, malformed and wrong-role input and verified
results in SQL. It produced 100 reproducible findings; all were addressed (two were deliberately
scoped, see §5). The repo's 120 Jest tests only cover `utils/decimal.js` arithmetic — they were
green throughout and never exercised a route.

### Crashes
- **"Something went wrong — m is not a function"** (the production crash): `useRealtime.js` returned a Supabase channel object as a `useEffect` cleanup; React called it on unmount. Fixed. A second cause — the `manualChunks` block in `vite.config.js`, which Vite 8/Rolldown turns into a cyclic chunk graph — was removed. Each page now has its own error boundary, so one page failing no longer blanks the whole app.
- Add/Edit Tool, Tool Checkout, Add/Edit Vehicle and other forms returned 500 whenever an optional date/number was left blank (`''` bound into DATE/INT columns). A global body normaliser converts `''` to `null`; every route also validates types, ranges, enums, lengths and UUIDs (`server/src/middleware/validate.js`), so user input now yields 400/404/409, never 500.
- Users → Add/Edit crashed (`user is not defined`). Fixed.
- Fresh installs could never be logged into: the seed inserted POs without the `NOT NULL project_id` and rolled back everything; schema creation also raced the seeder. Fixed and awaited.

### Security
- Authorization is now read from the database on every request. Previously role and active flag came from the JWT, so a demoted or deactivated user kept their old access for up to 24 h.
- Admin "change password" silently did nothing (no password change existed anywhere). Fixed; user changes are audit-logged; admins cannot demote/deactivate themselves; login no longer 500s on a non-string password or leaks whether an email exists via timing.
- Server-side role checks added to reports, vehicles, tools, gate passes and purchase orders (one shared `ROLES` map in `middleware/auth.js` mirrors the sidebar). Reference data (materials, vendors, warehouses, projects) stays readable by all signed-in roles because every page needs it for dropdowns.
- **Stored XSS** in gate-pass printing: driver/material/notes were written unescaped into a print popup that could read the printing user's token. Escaped in both print templates.
- `POST /gatepass` let staff issue a pass for any quantity with a made-up material name without touching stock. It is now owner/admin/store-manager only and is a real transactional stock-out.
- Backup restore is owner-only and refuses files not produced by this app; the per-file download endpoint validates filenames.

### Data integrity
- **Stock**: `quantity: "abc"` made `materials.quantity` literally `NaN`, after which every "insufficient stock" check passed forever. Rejected now; all numeric input is checked with `Number.isFinite`.
- **Transfers never worked end to end** (placeholder/param mismatch, wrong status strings from the UI, no stock movement on completion). The lifecycle is now request → approve/reject (approver ≠ requester) → complete, and completion moves stock between warehouses with ledger rows, in one transaction.
- **Transaction leaks**: several routes `return`ed 4xx after `BEGIN` without `ROLLBACK`, leaving pooled connections idle-in-transaction; later writes on that connection were silently discarded. Every early return now rolls back, and `pool.js` has a safety net that rolls back an open transaction on release.
- **Pool self-deadlock**: routes wrote audit/notification rows (a second pool connection) while still holding the transaction connection. Under load the whole API stalled for 30–60 s and returned 500s after the change had already committed (double stock-outs on retry). Connections are released before side effects everywhere.
- Partial updates (`PUT`) on tools, vehicles, projects, vendors and materials overwrote every column from the body — editing a checked-out tool wiped its checkout, any project edit reset `project_cost_value` to 0, a fuel log reset the odometer to 0. All use presence-based partial updates now; `PUT /materials/:id` no longer changes quantity at all (only stock-in/out/adjust do, with ledger rows).
- PO creation under concurrency produced duplicate numbers and 500s; PO and gate-pass numbers come from Postgres sequences. `items:[{}]` no longer stores `total_amount = NaN`. Receiving goods is validated (approved POs only, cumulative ≤ ordered, items must belong to the PO) and **now increases stock and writes `stock_movements` / `material_transactions`**; `stock-in?po_id` is capped at the ordered quantity and derives PO status inside the transaction.
- Finance: the bank-book linking migration was never run by the app, so every finance write 500ed on a fresh database — folded into `createSchema()`. Bank Book balances were all `Rs. 0` and no ledger entry could be posted (a hand-rolled decimal class); replaced with the tested `utils/decimal`. Manual debits beyond the balance are refused. Deletion requests: requester cannot approve their own, owner-level approver must differ from admin-level, bank-transaction deletions work, auto-linked entries must be deleted through their source. Vendor payments must reference a PO of the same project and the outstanding check is serialised.
- Material allocations to a project (`POST /projects/:id/allocations`) now deduct stock like a stock-out instead of double-counting.
- Backup/restore actually works: exports are valid SQL (ISO timestamps, JSON columns, FK-safe order, `TRUNCATE … CASCADE`, single transaction); verified by a full round trip. Old backup files were never loadable and are rejected with a clear message.
- Reports: six of seven Excel exports had no header row; PDF export existed for one report with blank columns. All seven export both formats correctly; the gate-pass PDF endpoint (called by two buttons) did not exist and was implemented.
- Dashboard/report KPIs exclude soft-deleted assets; DATE columns are returned as `YYYY-MM-DD` (dates no longer drift a day on each edit); `formatPKR` shows 2 decimals (`formatPKRWhole` for tiles).

### UI
- Sign-in page redesigned (brand panel, inline errors, show/hide password, Caps Lock warning, autocomplete, mobile layout).
- App shell redesigned: grouped sidebar with active rail, **working mobile menu** (the hamburger was wired to an empty function — phones had no navigation), breadcrumb header, working notification bell (polls the API; no Supabase realtime), pinned user card.
- Component kit: dialogs close on Escape/backdrop, lock scroll and move focus; consistent inputs, buttons, badges, empty/loading states and pagination; one global table style; unified palette; Inter typography.
- Role constants on every page match the server, so no button leads to a 403; every failure toast shows the API's message; lists refresh after actions.
- Printed gate passes said **"AL-FAJAR CONSTRUCTION, Sector G-11, Islamabad"** — a leftover template. Now Al Shafi Enterprises.

## 4. Running locally

```bash
npm install && npm --prefix server install && npm --prefix client install
cp server/.env.example server/.env        # set DATABASE_URL (…?sslmode=disable for a local Postgres) and JWT_SECRET
npm run dev:server                          # first start creates the schema and seeds demo data (password123)
npm run dev:client                          # http://localhost:3000
```
Server tests: `cd server && TEST_DATABASE_URL=<url> npx jest`. A browser walk of every page and a
cross-area API verification script were used for this pass; both are outside the repo.

## 5. Decisions and known limits

- Overdraft protection applies to manual Bank Book debits. Auto-linked debits (salary, petty cash, vendor payment posted against a bank) are recorded as-is and can take a balance negative — tell me if those should be blocked too.
- Clearing a tool's/vehicle's project from the edit form sends `null` and works; omitting the field keeps the current value.
- `materials.sku` is globally unique; a partial transfer that creates the material in the destination warehouse suffixes the SKU (`SKU@<warehouse>`). A per-warehouse unique index would be cleaner.
- Cron jobs (daily backup, overdue-tool alerts) still only run in a long-lived process, not on Vercel serverless.
- Local QA left `QA-*`/`FV*` records in the test database used for this pass; none of that touched your Supabase project.
