-- ============================================================
-- PO Terms & Conditions + Format Fields
-- 2026-08-29 — Al Shafi Enterprises PO Format Implementation
-- ============================================================

-- ------------------------------------------------------------
-- 1. VENDOR DEFAULT TERMS
--    Company-approved default terms per vendor.
--    Copied into new POs at creation time (snapshot).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_default_terms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  term_text TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_default_terms_vendor ON vendor_default_terms(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_default_terms_order ON vendor_default_terms(vendor_id, display_order);

-- ------------------------------------------------------------
-- 2. PO TERMS (SNAPSHOT)
--    Terms belonging to a specific PO.
--    Copied from vendor defaults at PO creation, then fully editable.
--    Historical POs retain their exact terms regardless of vendor default changes.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_terms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  term_text TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_terms_po ON po_terms(po_id);
CREATE INDEX IF NOT EXISTS idx_po_terms_order ON po_terms(po_id, display_order);

-- ------------------------------------------------------------
-- 3. PO FORMAT FIELDS
--    Additional fields for the official Al Shafi Enterprises PO format
-- ------------------------------------------------------------
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS special_discount DECIMAL(15,2) DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS discounted_total DECIMAL(15,2) DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS account_charged TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS product_category VARCHAR(255);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by_name VARCHAR(255);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS note_to_accounts TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS seller_acceptance TEXT;

-- Backfill discounted_total = total_amount - special_discount for existing POs
UPDATE purchase_orders
SET discounted_total = total_amount - COALESCE(special_discount, 0)
WHERE discounted_total IS NULL OR discounted_total = 0;

-- ------------------------------------------------------------
-- 4. VENDOR FIELDS FOR PO FORMAT
--    Vendor contact details used in PO header
-- ------------------------------------------------------------
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS attn VARCHAR(255);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS position VARCHAR(255);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_email VARCHAR(255);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_tel VARCHAR(100);

-- ------------------------------------------------------------
-- 5. RLS POLICIES
-- ------------------------------------------------------------
ALTER TABLE vendor_default_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vendor_default_terms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Vendor default terms readable by project members" ON vendor_default_terms FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM vendors v
    JOIN projects p ON p.id = v.id
    JOIN project_managers pm ON pm.project_id = p.id
    WHERE v.id = vendor_default_terms.vendor_id AND pm.user_id = auth.uid()
  )
);

ALTER TABLE po_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON po_terms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "PO terms readable by project members" ON po_terms FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM purchase_orders po
    JOIN project_managers pm ON pm.project_id = po.project_id
    WHERE po.id = po_terms.po_id AND pm.user_id = auth.uid()
  )
);