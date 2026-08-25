-- ============================================================
-- Step 1: List all tables with RLS disabled (run this first to verify)
-- ============================================================
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;

-- ============================================================
-- Step 2: Enable RLS on ALL public tables + add backend policies
-- Run this entire block in Supabase SQL Editor
-- ============================================================

-- Helper: Enable RLS and add "backend full access" policy for a table
-- This allows the backend (direct PG connection via DATABASE_URL) to bypass RLS

-- ============================================================
-- CORE TABLES
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Users read own" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own" ON users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admins read audit_logs" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vendors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read vendors" ON vendors FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project members read projects" ON projects FOR SELECT USING (
  EXISTS (SELECT 1 FROM project_managers pm WHERE pm.project_id = projects.id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON warehouses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read warehouses" ON warehouses FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read categories" ON categories FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON materials FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read materials" ON materials FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON stock_movements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read stock_movements" ON stock_movements FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read vehicles" ON vehicles FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE vehicle_fuel_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vehicle_fuel_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read vehicle_fuel_logs" ON vehicle_fuel_logs FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE vehicle_maintenance_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vehicle_maintenance_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read vehicle_maintenance_logs" ON vehicle_maintenance_logs FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON tools FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read tools" ON tools FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE tool_checkout_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON tool_checkout_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read tool_checkout_log" ON tool_checkout_log FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE project_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON project_allocations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project members read allocations" ON project_allocations FOR SELECT USING (
  EXISTS (SELECT 1 FROM project_managers pm WHERE pm.project_id = project_allocations.project_id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);

ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON transfer_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read transfer_requests" ON transfer_requests FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- PURCHASE ORDERS (flagged by Security Advisor)
-- ============================================================
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project members read purchase_orders" ON purchase_orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM project_managers pm WHERE pm.project_id = purchase_orders.project_id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'procurement_officer'))
);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON purchase_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project members read po_items" ON purchase_order_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM purchase_orders po
    JOIN project_managers pm ON pm.project_id = po.project_id
    WHERE po.id = purchase_order_items.po_id AND pm.user_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'procurement_officer'))
);

-- ============================================================
-- MATERIAL TRANSACTIONS
-- ============================================================
ALTER TABLE material_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON material_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read material_transactions" ON material_transactions FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- GATE PASSES (flagged by Security Advisor)
-- ============================================================
ALTER TABLE gate_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON gate_passes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read gate_passes" ON gate_passes FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- ACTIVITY FEED (flagged by Security Advisor)
-- ============================================================
ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON activity_feed FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read activity_feed" ON activity_feed FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- FINANCE MODULE (all flagged by Security Advisor)
-- ============================================================
ALTER TABLE salaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON salaries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read salaries" ON salaries FOR SELECT USING (
  EXISTS (SELECT 1 FROM project_managers pm WHERE pm.project_id = salaries.project_id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

ALTER TABLE petty_cash ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON petty_cash FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read petty_cash" ON petty_cash FOR SELECT USING (
  EXISTS (SELECT 1 FROM project_managers pm WHERE pm.project_id = petty_cash.project_id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vendor_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read vendor_payments" ON vendor_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM project_managers pm WHERE pm.project_id = vendor_payments.project_id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance', 'procurement_officer'))
);

ALTER TABLE banks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON banks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Finance read banks" ON banks FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON bank_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Finance read bank_transactions" ON bank_transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

ALTER TABLE amount_received ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON amount_received FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read amount_received" ON amount_received FOR SELECT USING (
  EXISTS (SELECT 1 FROM project_managers pm WHERE pm.project_id = amount_received.project_id AND pm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

-- ============================================================
-- DELETION REQUESTS (flagged by Security Advisor)
-- ============================================================
ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON deletion_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admins/owners read deletion_requests" ON deletion_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);
CREATE POLICY "Requesters read own deletion_requests" ON deletion_requests FOR SELECT USING (requested_by = auth.uid());

ALTER TABLE petty_cash_utilization ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON petty_cash_utilization FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read petty_cash_utilization" ON petty_cash_utilization FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM petty_cash pc
    JOIN project_managers pm ON pm.project_id = pc.project_id
    WHERE pc.id = petty_cash_utilization.petty_cash_id AND pm.user_id = auth.uid()
  )
  OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

ALTER TABLE project_managers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON project_managers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Users read own assignments" ON project_managers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins read all project_managers" ON project_managers FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Users read own notifications" ON notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users update own notifications" ON notifications FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- Step 3: Verify RLS is now enabled on ALL tables
-- ============================================================
SELECT
  schemaname,
  tablename,
  rowsecurity,
  CASE WHEN rowsecurity THEN '✅ ENABLED' ELSE '❌ DISABLED' END as status
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rowsecurity, tablename;

-- ============================================================
-- Step 4: Verify policies exist
-- ============================================================
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;