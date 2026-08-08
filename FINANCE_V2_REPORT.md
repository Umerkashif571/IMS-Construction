# IMS-Construction — Finance Module Extension v2 Report

Date: 2026-08-08
Scope: Vendor-payment ↔ Purchase Order linkage, Bank Book (banks + ledgers), Amount Received, Projected Profit/Loss summary, Vendors Overview drill-down — API + UI + regression.
State: **PASS — all suites green.**

---

## 1. Executive Summary

Finance Module v2 extended the finance area with PO-bound vendor payments, a Bank Book module, an amount-received register and a projected profit/loss summary, all role-gated. One real frontend bug was found **by** the UI suite (finance role never saw the vendor list in the payment form due to an off-by-one promise destructuring) and fixed during the session.

Headline numbers:

| Suite | Result |
|---|---|
| `finance_v2_suite.js` (new API suite) | **100 / 100 pass** |
| `finance_v2_ui_test.js` (new E2E browser suite) | **22 / 22 pass** |
| `finance_suite_5000.js` (finance regression) | **100 / 100 pass** |
| `harden_suite.js` (security regression) | **73 / 73 pass** |
| `e2e_suite.js` (roles/lazy/mobile regression) | **23 / 23 pass** |
| `notif_suite.js` (notifications regression) | **52 / 52 pass** |
| `bell_ui_test.js` (notification bell UI regression) | **18 / 18 pass** |

---

## 2. What Was Built

### 2.1 Vendor payments ↔ Purchase Orders
- `POST /api/projects/:id/finance/vendor-payments`:
  - `continuous` **requires** `po_id`; the PO must belong to the selected vendor and must not be cancelled (400 otherwise).
  - `po_number` / `bill_number` are taken **from the PO row** (not the request body) for continuous payments.
  - `fixed_otp` and `ipc` must not carry PO data — `po_id`, `po_number`, `bill_number` are normalized to `null`.
  - `ipc` requires `ipc_percent_complete` (0–100).
- Payments list `GET` now LEFT JOINs `projects` and returns `project_name`.
- `purchase_orders` list `GET` also joins `projects` → `project_name` (used by the PO dropdown).

### 2.2 Bank Book (owner / admin / finance only)

- New tables `banks` and `bank_transactions` (both soft-delete capable).
- `GET /api/banks` (+ `POST`), `GET/POST /api/banks/:id/transactions`.
- Ledger rows carry a **server-computed `running_balance`** (ordered by date, created_at); rows under deletion are marked `deleted_at` and excluded from balances (`running_balance: null`).
- All bank endpoints = 401 for `store_manager`/`manager`/`procurement_officer` (403 verified in API + UI).
- Deletion is **two-step**: request (with reason) → admin approval → owner approval (page `Pending` → `Deleted`).
- Global deletion requests (bank-only) reached projectless: `POST/GET /api/finance/deletion-requests` + `admin-approve` / `owner-approve`.

### 2.3 Amount Received + Projected Profit/Loss

- New table `amount_received` (project, amount, received_date, description, soft-delete).
- `GET/POST /api/projects/:id/finance/amount-received` (project/global routes).
- `GET /(:id/)finance/summary` now includes:
  - `amount_received_total`
  - `balance_received` = amount_received − actual_project_cost
  - `profit_loss` = project_cost_value − actual_project_cost (with `balance` preserved for legacy callers)
- Finance UI: two new stat cards — **Amount Received** and **Projected Profit / Loss** (red when negative), full Amount Received table + Add Receipt modal.

### 2.4 Vendors Overview drill-down

- `GET /api/finance/vendor-overview?vendor_id=` — aggregated POs + payments + `total_po_value` (excludes cancelled) + `total_paid` + `balance`, only roles `owner/admin/finance`.
- Vendors page: clicking **Purchase Orders** opens the modal; tabs **Purchase Orders** / **Payments & Totals** (totals cards + payment-type filter).

---

## 3. Bug Found & Fixed

| Bug | Symptom | Fix |
|---|---|---|
| Finance role couldn't add continuous payments | `Promise.all` results destructured positionally while a guard pushed conditional requests shifted the `/vendors` read for `finance` (not in `CAN_APPROVE`), so `setVendors(undefined)` → empty vendor dropdown | Positional assignment via a counter over the actual array (`client/src/components/ProjectFinance.jsx`) |

---

## 4. Schema Changes

- `vendor_payments.po_id` (uuid, FK purchase_orders, index) — nullable.
- `banks`, `bank_transactions`, `amount_received` tables + indexes.
- `deletion_requests.transaction_type` CHECK extended to `('salary','petty_cash','vendor_payment','bank_transaction','amount_received')`.
- `deletion_requests.project_id` made nullable (bank transactions carry no project).
- All mirrored in `server/migrations/schema.sql`; verified live via psql.

---

## 5. Test Evidence

- API v2 `finance_v2_suite.js`: 100 checks covering PO linkage rules (400s/403s), bank ledger ordering, running balances, deletion lifecycle (project + global), amount-received flow, summary formulas (full user + PM view), vendor-overview totals — **100/100**.
- UI `finance_v2_ui_test.js`: 22 checks — sidebar nav, bank card balance, ledger running balance, add-transaction modal row, deletion badge, Amount Received card/table/add, right & IPC PO field behavior, Vendors drill-down, store-manager denial — **22/22**.
- Regression reruns after the schema/backend changes: finance 100, security 73, E2E 23, notifications 52, bell UI 18 — all green (any state leftovers — stale deletion-request rows / unread manager notifications from earlier suites — were cleared before reruns and are unrelated to code behavior).

---

## 6. Files Changed

**Server**
- `server/src/routes/finance.js` — summary extensions, Amount Received routes, vendor-payment PO logic, global deletion-request/approve routes, `/vendor-overview`.
- `server/src/routes/banks.js` — new.
- `server/src/routes/purchase_orders.js` — `project_name` join.
- `server/src/index.js` — mounts `/api/banks`.
- `server/src/db/schema.js`, `server/migrations/schema.sql` — schema/migrations.

**Client**
- `client/src/pages/BankBook.jsx` — new.
- `client/src/components/ProjectFinance.jsx` — Amount Received section, Profit/Loss cards, PO-savvy VendorPaymentForm, destructure fix.
- `client/src/pages/Vendors.jsx` — overview modal (POs / Payments & Totals tabs).
- `client/src/App.jsx` — lazy `/bankbook` route (roles owner/admin/finance).
- `client/src/components/Layout.jsx` — Bank Book nav item.
- `client/src/components/ui.jsx` — StatCard `hint` prop, `green` / `teal` colors.