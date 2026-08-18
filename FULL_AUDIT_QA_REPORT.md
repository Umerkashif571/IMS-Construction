# Full Audit + QA Report — PO Approval Workflow, Petty Cash Utilization & PM Scoping

**Environment under test:** deployed production `https://ims-construction.vercel.app` (Vercel, sin1, Node 24.x) → shared Supabase/Postgres.
**Date:** 2026-08-15 · **Result:** everything passes on the live deployment.

---

## 1. What was built (all deployed & verified)

### 1.1 Two-step PO approval (Procurement → Admin → Owner)
- PO created by `procurement_officer` only, **Site (project) mandatory** `purchase_orders.project_id NOT NULL` (backfill migration + guarded `SET NOT NULL`).
- Strict sequential enforcement in API: Admin approve requires `status='pending'`; Owner approve requires `status='admin_approved'` **and** `admin_approval='approved'`; both under `SELECT … FOR UPDATE` row locks. Rejections require a reason.
- `admin_approved` intermediate status in DB CHECK + filter dropdown; running badges show Admin: pending/approved/rejected and Owner: pending/approved/rejected per PO.
- Continuous vendor payments may only link to **fully approved** POs (`approved` + both approvals, PO belongs to vendor, not cancelled) — otherwise specific 400.

### 1.2 Petty Cash utilization ledger
- `petty_cash_utilization` rows: allowed roles owner/admin/finance (manager denied), categories `Material | Labor | Transport | Misc`, `date` or `utilization_date` accepted, `receipt_ref`, no negative/split-drift amounts (overspend → 400 with remaining balance).
- Utilization deletion via 2-step `deletion_requests` (`petty_cash_utilization` type): Owner blocked until Admin approves; approved deletion restores the petty-cash remaining balance. Utilization requires parent petty cash `status='active'`; project scoping resolved via join to `petty_cash` (no redundant column).
- UI: Disbursed / Utilized / Remaining summary per kit, record-expense modal, breakdown modal with category/date filter, running balance, receipt text, delete-request action, ReceiptText link. Chart now uses `petty_cash_utilized_total`.

### 1.3 Project Manager (PM) scoping
- `project_managers` table + `GET/PUT/DELETE /projects/:id/managers/:userId` (owner/admin only, `role='manager'` enforced); assignment UI in the project detail modal.
- Every finance workload endpoint enforced through `assertManagerProjectAccess(projectId, …)` directly after the existing 403 role checks — managers see only assigned projects.

### 1.4 Housekeeping
- `users?role=` filter; `seed.js` double `client.release()` boot-crash fixed; `pool.js` local timeouts; Bank Book auto-linking retained.

---

## 2. Test artifacts

| Harness | Location | Runs against |
|---|---|---|
| `server/scripts/audit-qa-suite.js` | repo (committed) | deployed prod, arg2 = origin, arg3 = QA password |
| `server/scripts/e2e-flow-check.js` | repo (committed) | deployed prod, prints the full-chain timeline |

Demo accounts all share one consistent password: **`Demo@12345`** (rotated 2026-08-15; supersedes the earlier `Qa!Set2026x9`). The value inside `server/.env` is the *seed-time* password and no longer matches — QA harnesses take the live password as an argument.

---

**Results — audit suite vs deployed prod (most recent full run, ts=1786820218478):**

| Section | Checks | Result |
|---|---|---|
| Setup (login) | 1 | PASS |
| Part 1 — PO workflow & approvals | 13 | **13/13 PASS** |
| Part 2 — utilization, deletion, exact-bounds | 12 | **12/12 PASS** |
| Part 3 — edge cases & PM scoping | 11 | **11/11 PASS** |
| **Total** | **37 checks + setup** | **38 PASS, 0 FAIL** |

Key assertions, all green:
- PO creation: blocked for owner/finance/manager; allowed for procurement; site required (400, message shown).
- Approvals: admin → `admin_approved`; double admin approve blocked; **owner before admin blocked**; owner final → `approved`.
- Payments: `approved` PO links; `pending` PO rejected; admin-only-approved PO rejected (no bypass).
- Admin rejection recorded with reason.
- Utilization: allowed for owner/admin/finance; **manager denied**; boundary `499.99 + 500.01 = 1000.00` with **zero paisa drift**; over-disbursement blocked; restriction to two decimal places preserved; deletion request → admin → owner restores remaining balance exactly (`500.01`).
- Zero-data accounts and 9.99-crore entries render with correct precision; empty lists are arrays, not errors.
- PM: assign to project → allowed; unassigned access → 403; manager cannot approve POs; deactivated user → 401; mid-deletion parent lock respected.

## 4. Results — end-to-end flow (single-project timeline)

`scripts/e2e-flow-check.js` on prod: PO-2026-034 created by Procurement → approved by Admin → approved by Owner → continuous payment PKR 3,000,000 linked → petty cash PKR 50,000 → utilization Material 20,000 + Labor 30,000 → deletion request for the labor entry → Admin + Owner approve → utilization = 20,000, remaining = 30,000, `actual_cost = 3,020,000`, `profit_loss = 1,980,000` — **5/5 checks PASS** (`E2E FLOW: ALL CHECKS PASS (9 steps)`).

## 5. Currency/display formatting

`client/src/format.js` (`formatPKR`) exercised in isolation against 7 cases — negative (`Rs. -1,234`), zero, 9.99-crore (`Rs. 100,000,000`), paisa rounding, string input, `null`/junk → **7/7 PASS**.

## 6. Deployment verification

- First deploy failed verification (date-alias absent); fixed and re-deployed. Alias `https://ims-construction.vercel.app` points at the fixed deployment (`Ready`).
- Remote `index.html` asset hashes match the local `client/dist` build exactly (entry `index-CTV7Hnuv.js`); lazy chunks `Vendors-DjOOZ8gy.js` (contains new `admin_approved` UI ×4) and `Projects-DfumSkPT.js` (contains `Record Expense`, `petty_cash_utilized_total`) served with HTTP 200 → **deployed client == local source build**.

## 7. Migration & data hygiene

- `server/migrations/2026-08-15_po_workflow_petty_cash_utilization.sql` applied to Supabase and verified: `project_id` backfilled, `NOT NULL` set (0 NULL rows), status CHECK extended, `petty_cash_utilization` + `project_managers` + index exist, `deletion_requests.project_id` nullable for utilization requests. PO status distribution: approved=3, ordered=1, pending=12, received=3.
- All QA fixtures from this session (9 projects, 6 vendors, 22 QA users, their bank transactions) **deleted** — demo DB clean, zero leftovers.
- All 11 demo accounts use one consistent password: **`Demo@12345`** (rotated 2026-08-15; supersedes `Qa!Set2026x9`). Includes admin@ims.com, owner@ims.com, procurement@ims.com, finance@ims.com, manager@ims.com, store@ims.com, engineer@ims.com, staff@ims.com, plus test accounts owner2-*, po-*, deact-*.

## 8. Notes / follow-ups

- Working tree contains the uncommitted feature changes (list below) — not committed, per convention (no commit requested).
- `seed.js` boot-crash and pool local-timeout changes are the only non-feature diffs.
- Suggested optional next steps: manual browser pass on the live UI (PO detail modal, utilization breakdown), then `git add`/commit the feature set.

**Changed files**
`client/src/pages/Vendors.jsx`, `client/src/components/ProjectFinance.jsx`, `client/src/pages/Projects.jsx`, `client/src/format.js` (verified, unchanged), `server/src/routes/finance.js`, `server/src/routes/projects.js`, `server/src/routes/users.js`, `server/src/routes/vendors.js` (modified PO routes live here), `server/src/db/schema.js`, `server/src/db/seed.js`, `server/src/db/pool.js`, `server/migrations/schema.sql`, `server/scripts/audit-qa-suite.js` (new), `server/scripts/e2e-flow-check.js` (new).