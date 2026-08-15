-- ============================================================
-- PO approval workflow (Admin -> Owner sequential) + Site required
-- + Petty Cash utilization entries
-- 2026-08-15 — run against Supabase (see server/migrations/README)
-- ============================================================

-- ------------------------------------------------------------
-- 1. PURCHASE ORDERS — sequential two-step approval state
--    status stays the source of truth for the payment dropdown:
--    'pending' -> 'admin_approved' -> 'approved' (final) | 'rejected'
-- ------------------------------------------------------------

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS admin_approval VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (admin_approval IN ('pending', 'approved', 'rejected'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS admin_approved_by UUID REFERENCES users(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS admin_reject_reason TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS owner_approval VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (owner_approval IN ('pending', 'approved', 'rejected'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS owner_approved_by UUID REFERENCES users(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS owner_approved_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS owner_reject_reason TEXT;

-- Extend the status CHECK to include the intermediate 'admin_approved' state.
DO $$
BEGIN
  ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
  ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
    CHECK (status IN ('pending', 'admin_approved', 'approved', 'rejected', 'ordered', 'received', 'partial_received', 'cancelled', 'completed', 'delivered', 'returned'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'purchase_orders status CHECK could not be replaced: %', SQLERRM;
END $$;

-- Backfill: existing fully-`approved` POs were approved before the two-step
-- rule existed — treat them as already two-step approved so payment linking
-- keeps working; 'pending'/'received'/etc. keep their current approval state.
UPDATE purchase_orders
SET admin_approval = 'approved',
    owner_approval  = 'approved'
WHERE status = 'approved' AND admin_approval = 'pending' AND owner_approval = 'pending';

-- 1a. Site (project) is mandatory for new POs.
--     Existing NULL rows are backfilled to the most recent active project
--     (keeps history queryable; the API now requires a project going forward).
UPDATE purchase_orders po
SET project_id = (
  SELECT p.id FROM projects p
  WHERE p.status = 'active'
  ORDER BY p.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE po.project_id IS NULL;

-- Only enforce NOT NULL when every existing row could be backfilled
-- (a PO with no active project is left in place rather than breaking the migration).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE project_id IS NULL) THEN
    ALTER TABLE purchase_orders ALTER COLUMN project_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'purchase_orders.project_id stays nullable: % row(s) have no backfill target', (SELECT COUNT(*) FROM purchase_orders WHERE project_id IS NULL);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. PETTY CASH UTILIZATION — partial-spend tracking ledger
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS petty_cash_utilization (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  petty_cash_id UUID NOT NULL REFERENCES petty_cash(id),
  utilization_date DATE NOT NULL,
  category VARCHAR(100) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  note TEXT,
  receipt_ref VARCHAR(255),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'deletion_requested', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_pcu_petty_cash_id ON petty_cash_utilization(petty_cash_id);
CREATE INDEX IF NOT EXISTS idx_pcu_category ON petty_cash_utilization(category);
CREATE INDEX IF NOT EXISTS idx_pcu_date ON petty_cash_utilization(utilization_date);
CREATE INDEX IF NOT EXISTS idx_pcu_status ON petty_cash_utilization(status);

-- ------------------------------------------------------------
-- 3. DELETION REQUESTS — accept utilization entries (same two-step flow)
-- ------------------------------------------------------------
-- project_id becomes nullable: utilization entries belong to a disbursement,
-- so their deletion requests carry the project via the parent.
DO $$
BEGIN
  ALTER TABLE deletion_requests ALTER COLUMN project_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'deletion_requests.project_id NOT NULL drop skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE deletion_requests DROP CONSTRAINT IF EXISTS deletion_requests_transaction_type_check;
  ALTER TABLE deletion_requests ADD CONSTRAINT deletion_requests_transaction_type_check
    CHECK (transaction_type IN ('salary', 'petty_cash', 'vendor_payment', 'bank_transaction', 'amount_received', 'petty_cash_utilization'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'deletion_requests transaction_type CHECK could not be replaced: %', SQLERRM;
END $$;

-- ------------------------------------------------------------
-- 4. PROJECT MANAGERS — project-scoping for the Manager role
--    A manager may only view finance data (incl. Petty Cash breakdown)
--    for projects they are explicitly assigned to (server-enforced).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_managers (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pm_user ON project_managers(user_id);