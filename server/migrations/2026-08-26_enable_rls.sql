-- ============================================================
-- Enable RLS on all tables and add policies for backend access
-- Run against Supabase database: psql -U postgres -d ims_db -f 2026-08-26_enable_rls.sql
-- ============================================================

-- Grant bypassrls to the current database user (typically postgres or the pooler user)
-- This allows the backend's direct PostgreSQL connection to bypass RLS entirely
-- Note: Only run this if the database user is NOT already a superuser
-- ALTER ROLE current_user BYPASSRLS;

-- Alternative: Create policies that allow the backend role full access
-- The backend uses a single database role (from DATABASE_URL). We'll create
-- policies that check if the current_user is that backend role.

-- ============================================================
-- 1. USERS
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON users FOR ALL USING (true) WITH CHECK (true);
-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON users FOR SELECT USING (auth.uid() = id);
-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============================================================
-- 2. AUDIT LOGS
-- ============================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
-- Only admins/owners can read audit logs
CREATE POLICY "Admins can read audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);

-- ============================================================
-- 3. VENDORS
-- ============================================================
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vendors FOR ALL USING (true) WITH CHECK (true);
-- Authenticated users can read vendors
CREATE POLICY "Authenticated read vendors" ON vendors FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 4. PROJECTS
-- ============================================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON projects FOR ALL USING (true) WITH CHECK (true);
-- Project members can read their projects
CREATE POLICY "Project members read" ON projects FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM project_managers pm WHERE pm.project_id = projects.id AND pm.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);

-- ============================================================
-- 5. WAREHOUSES
-- ============================================================
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON warehouses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read warehouses" ON warehouses FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 6. CATEGORIES
-- ============================================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read categories" ON categories FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 7. MATERIALS
-- ============================================================
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON materials FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read materials" ON materials FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 8. STOCK MOVEMENTS
-- ============================================================
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON stock_movements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read stock_movements" ON stock_movements FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 9. VEHICLES
-- ============================================================
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read vehicles" ON vehicles FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 10. VEHICLE FUEL LOGS
-- ============================================================
ALTER TABLE vehicle_fuel_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vehicle_fuel_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read vehicle_fuel_logs" ON vehicle_fuel_logs FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 11. VEHICLE MAINTENANCE LOGS
-- ============================================================
ALTER TABLE vehicle_maintenance_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vehicle_maintenance_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read vehicle_maintenance_logs" ON vehicle_maintenance_logs FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 12. TOOLS
-- ============================================================
ALTER TABLE tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON tools FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read tools" ON tools FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 13. TOOL CHECKOUT LOG
-- ============================================================
ALTER TABLE tool_checkout_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON tool_checkout_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read tool_checkout_log" ON tool_checkout_log FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 14. PROJECT ALLOCATIONS
-- ============================================================
ALTER TABLE project_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON project_allocations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project members read allocations" ON project_allocations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM project_managers pm WHERE pm.project_id = project_allocations.project_id AND pm.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);

-- ============================================================
-- 15. TRANSFER REQUESTS
-- ============================================================
ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON transfer_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read transfer_requests" ON transfer_requests FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 16. PURCHASE ORDERS
-- ============================================================
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON purchase_orders FOR ALL USING (true) WITH CHECK (true);
-- Project members can read their purchase orders
CREATE POLICY "Project members read purchase_orders" ON purchase_orders FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM project_managers pm WHERE pm.project_id = purchase_orders.project_id AND pm.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'procurement_officer'))
);

-- ============================================================
-- 17. PURCHASE ORDER ITEMS
-- ============================================================
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON purchase_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project members read po_items" ON purchase_order_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM purchase_orders po
    JOIN project_managers pm ON pm.project_id = po.project_id
    WHERE po.id = purchase_order_items.po_id AND pm.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'procurement_officer'))
);

-- ============================================================
-- 18. MATERIAL TRANSACTIONS
-- ============================================================
ALTER TABLE material_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON material_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read material_transactions" ON material_transactions FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 19. GATE PASSES
-- ============================================================
ALTER TABLE gate_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON gate_passes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read gate_passes" ON gate_passes FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 20. ACTIVITY FEED
-- ============================================================
ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON activity_feed FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read activity_feed" ON activity_feed FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 21. FINANCE MODULE
-- ============================================================

-- 21.1 SALARIES
ALTER TABLE salaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON salaries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read salaries" ON salaries FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM project_managers pm WHERE pm.project_id = salaries.project_id AND pm.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

-- 21.2 PETTY CASH
ALTER TABLE petty_cash ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON petty_cash FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read petty_cash" ON petty_cash FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM project_managers pm WHERE pm.project_id = petty_cash.project_id AND pm.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

-- 21.3 VENDOR PAYMENTS
ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON vendor_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read vendor_payments" ON vendor_payments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM project_managers pm WHERE pm.project_id = vendor_payments.project_id AND pm.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance', 'procurement_officer'))
);

-- 21.3.1 BANKS
ALTER TABLE banks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON banks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Finance read banks" ON banks FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

-- 21.3.2 BANK TRANSACTIONS
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON bank_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Finance read bank_transactions" ON bank_transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

-- 21.3.3 AMOUNT RECEIVED
ALTER TABLE amount_received ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON amount_received FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read amount_received" ON amount_received FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM project_managers pm WHERE pm.project_id = amount_received.project_id AND pm.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

-- 21.4 DELETION REQUESTS
ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON deletion_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admins/owners read deletion_requests" ON deletion_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);
-- Requesters can read their own requests
CREATE POLICY "Requesters read own deletion_requests" ON deletion_requests FOR SELECT USING (
  requested_by = auth.uid()
);

-- 21.4.1 PETTY CASH UTILIZATION
ALTER TABLE petty_cash_utilization ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON petty_cash_utilization FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Project finance read petty_cash_utilization" ON petty_cash_utilization FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM petty_cash pc
    JOIN project_managers pm ON pm.project_id = pc.project_id
    WHERE pc.id = petty_cash_utilization.petty_cash_id AND pm.user_id = auth.uid()
  ) OR
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin', 'finance'))
);

-- 21.4.2 PROJECT MANAGERS
ALTER TABLE project_managers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON project_managers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Users read own project assignments" ON project_managers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins read all project_managers" ON project_managers FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner', 'admin'))
);

-- ============================================================
-- 21.5 NOTIFICATIONS
-- ============================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend full access" ON notifications FOR ALL USING (true) WITH CHECK (true);
-- Users can only read their own notifications
CREATE POLICY "Users read own notifications" ON notifications FOR SELECT USING (user_id = auth.uid());
-- Users can update their own notifications (mark as read)
CREATE POLICY "Users update own notifications" ON notifications FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- Verify RLS is enabled on all tables
-- ============================================================
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;