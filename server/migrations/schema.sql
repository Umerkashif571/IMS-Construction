-- ============================================================
-- IMS (Inventory Management System) — Full Database Schema
-- Run against an empty PostgreSQL database to recreate all tables.
-- Usage: psql -U postgres -d ims_db -f schema.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. USERS & AUTH
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance')),
  phone VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  user_name VARCHAR(255),
  user_role VARCHAR(50),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  description TEXT,
  changes JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. VENDORS / SUPPLIERS
-- ============================================================
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(100),
  address TEXT,
  city VARCHAR(100),
  province VARCHAR(100),
  ntn VARCHAR(100),
  strn VARCHAR(100),
  payment_terms VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. PROJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  client VARCHAR(255),
  location TEXT,
  city VARCHAR(100),
  budget DECIMAL(15, 2) DEFAULT 0,
  budget_used DECIMAL(15, 2) DEFAULT 0,
  project_cost_value DECIMAL(15, 2) DEFAULT 0,
  start_date DATE,
  end_date DATE,
  status VARCHAR(50) DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. WAREHOUSES / SITES
-- ============================================================
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('main_store', 'site_store', 'warehouse')),
  location TEXT,
  city VARCHAR(100),
  manager_name VARCHAR(255),
  contact_phone VARCHAR(100),
  project_id UUID REFERENCES projects(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. MATERIALS
-- ============================================================
CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category_id UUID REFERENCES categories(id),
  unit VARCHAR(50) NOT NULL,
  quantity DECIMAL(15,2) DEFAULT 0,
  reorder_level DECIMAL(15,2) DEFAULT 0,
  unit_cost DECIMAL(12,2) DEFAULT 0,
  supplier_id UUID REFERENCES vendors(id),
  storage_location VARCHAR(255),
  warehouse_id UUID REFERENCES warehouses(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. STOCK MOVEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  material_id UUID REFERENCES materials(id),
  material_name VARCHAR(255),
  movement_type VARCHAR(50) NOT NULL CHECK (movement_type IN ('in', 'out', 'transfer_in', 'transfer_out')),
  quantity DECIMAL(15,2) NOT NULL,
  unit VARCHAR(50),
  reference_type VARCHAR(100),
  reference_id UUID,
  notes TEXT,
  warehouse_id UUID REFERENCES warehouses(id),
  from_warehouse_id UUID REFERENCES warehouses(id),
  to_warehouse_id UUID REFERENCES warehouses(id),
  user_id UUID REFERENCES users(id),
  user_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. VEHICLES
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_no VARCHAR(100) UNIQUE NOT NULL,
  type VARCHAR(100) NOT NULL,
  brand VARCHAR(100),
  model VARCHAR(100),
  year INT,
  purchase_date DATE,
  purchase_cost DECIMAL(15,2),
  current_status VARCHAR(50) DEFAULT 'active' CHECK (current_status IN ('active', 'under_maintenance', 'idle', 'retired')),
  assigned_project_id UUID REFERENCES projects(id),
  assigned_site VARCHAR(255),
  fuel_type VARCHAR(50),
  tank_capacity DECIMAL(10,2),
  insurance_expiry DATE,
  registration_expiry DATE,
  last_maintenance_date DATE,
  next_maintenance_date DATE,
  maintenance_interval_days INT DEFAULT 90,
  odometer_reading DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. VEHICLE FUEL LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_fuel_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  date TIMESTAMPTZ DEFAULT NOW(),
  liters DECIMAL(10,2) NOT NULL,
  cost_per_liter DECIMAL(10,2),
  total_cost DECIMAL(12,2),
  odometer_reading DECIMAL(10,2),
  filled_by VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. VEHICLE MAINTENANCE LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_maintenance_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  maintenance_type VARCHAR(100),
  description TEXT,
  service_date TIMESTAMPTZ DEFAULT NOW(),
  cost DECIMAL(12,2),
  vendor_name VARCHAR(255),
  next_due_date DATE,
  odometer_at_service DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'completed' CHECK (status IN ('scheduled', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 12. TOOLS & EQUIPMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  serial_number VARCHAR(255) UNIQUE,
  type VARCHAR(100),
  category VARCHAR(100),
  description TEXT,
  purchase_date DATE,
  purchase_cost DECIMAL(12,2),
  current_condition VARCHAR(50) DEFAULT 'good' CHECK (current_condition IN ('new', 'good', 'fair', 'poor', 'damaged')),
  current_status VARCHAR(50) DEFAULT 'available' CHECK (current_status IN ('available', 'checked_out', 'under_maintenance', 'retired')),
  checked_out_to VARCHAR(255),
  checked_out_employee VARCHAR(255),
  assigned_project_id UUID REFERENCES projects(id),
  assigned_site VARCHAR(255),
  return_due_date DATE,
  last_maintenance_date DATE,
  next_maintenance_date DATE,
  maintenance_interval_days INT DEFAULT 90,
  calibration_due_date DATE,
  warehouse_id UUID REFERENCES warehouses(id),
  storage_location VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 13. TOOL CHECKOUT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS tool_checkout_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tool_id UUID REFERENCES tools(id),
  tool_name VARCHAR(255),
  checked_out_to VARCHAR(255),
  employee_name VARCHAR(255),
  assigned_project_id UUID REFERENCES projects(id),
  check_out_date TIMESTAMPTZ DEFAULT NOW(),
  expected_return_date DATE,
  actual_return_date TIMESTAMPTZ,
  condition_on_return VARCHAR(50),
  notes TEXT,
  user_id UUID REFERENCES users(id),
  returned_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 14. PROJECT ALLOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS project_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id),
  allocation_type VARCHAR(50) NOT NULL CHECK (allocation_type IN ('material', 'vehicle', 'tool')),
  entity_id UUID NOT NULL,
  entity_name VARCHAR(255),
  quantity DECIMAL(15,2) DEFAULT 1,
  unit VARCHAR(50),
  unit_cost DECIMAL(12,2),
  total_cost DECIMAL(15,2),
  status VARCHAR(50) DEFAULT 'allocated' CHECK (status IN ('allocated', 'in_use', 'returned', 'consumed')),
  notes TEXT,
  allocated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 15. TRANSFER REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS transfer_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('material', 'tool', 'vehicle')),
  entity_id UUID,
  entity_name VARCHAR(255),
  quantity DECIMAL(15,2) DEFAULT 1,
  from_warehouse_id UUID REFERENCES warehouses(id),
  to_warehouse_id UUID REFERENCES warehouses(id),
  from_warehouse_name VARCHAR(255),
  to_warehouse_name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  requested_by UUID REFERENCES users(id),
  requested_by_name VARCHAR(255),
  approved_by UUID REFERENCES users(id),
  approved_by_name VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 16. PURCHASE ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number VARCHAR(100) UNIQUE NOT NULL,
  vendor_id UUID REFERENCES vendors(id),
  vendor_name VARCHAR(255),
  project_id UUID REFERENCES projects(id),
  order_date TIMESTAMPTZ DEFAULT NOW(),
  expected_delivery DATE,
  delivery_status VARCHAR(50) DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'partial', 'delivered', 'cancelled')),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'ordered', 'received', 'partial_received', 'cancelled', 'completed', 'delivered', 'returned')),
  total_amount DECIMAL(15,2) DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  received_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 17. PURCHASE ORDER ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id UUID REFERENCES purchase_orders(id),
  material_name VARCHAR(255),
  description TEXT,
  quantity DECIMAL(15,2) NOT NULL,
  unit VARCHAR(50),
  unit_price DECIMAL(12,2),
  total_price DECIMAL(15,2),
  quantity_delivered DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 18. MATERIAL TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS material_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  material_id UUID REFERENCES materials(id),
  type VARCHAR(10) NOT NULL CHECK (type IN ('in', 'out')),
  quantity DECIMAL(15,2) NOT NULL,
  running_total DECIMAL(15,2),
  date TIMESTAMPTZ DEFAULT NOW(),
  project_id UUID REFERENCES projects(id),
  warehouse_id UUID REFERENCES warehouses(id),
  location VARCHAR(255),
  driver_name VARCHAR(255),
  vehicle_number VARCHAR(255),
  added_by VARCHAR(255),
  notes TEXT,
  source VARCHAR(255),
  received_by VARCHAR(255),
  transaction_type VARCHAR(100),
  po_id UUID REFERENCES purchase_orders(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 19. GATE PASSES
-- ============================================================
CREATE TABLE IF NOT EXISTS gate_passes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gate_pass_no VARCHAR(50) UNIQUE NOT NULL,
  material_id UUID REFERENCES materials(id),
  material_name VARCHAR(255),
  quantity DECIMAL(15,2) NOT NULL,
  unit VARCHAR(50),
  project_id UUID REFERENCES projects(id),
  project_name VARCHAR(255),
  vehicle_number VARCHAR(255),
  driver_name VARCHAR(255),
  destination VARCHAR(255),
  issued_by VARCHAR(255),
  authorized_by VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 20. ACTIVITY FEED
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_feed (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_name VARCHAR(255),
  action VARCHAR(50),
  description TEXT,
  entity_type VARCHAR(100),
  entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 21. FINANCE MODULE
-- ============================================================

-- 21.1 SALARIES
CREATE TABLE IF NOT EXISTS salaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) NOT NULL,
  employee_name VARCHAR(255) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  month DATE NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'deletion_requested', 'deleted'))
);

-- 21.2 PETTY CASH
CREATE TABLE IF NOT EXISTS petty_cash (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  week_of DATE NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'deletion_requested', 'deleted'))
);

-- 21.3 VENDOR PAYMENTS
CREATE TABLE IF NOT EXISTS vendor_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) NOT NULL,
  vendor_id UUID REFERENCES vendors(id) NOT NULL,
  payment_type VARCHAR(50) NOT NULL CHECK (payment_type IN ('fixed_otp', 'continuous', 'ipc')),
  amount DECIMAL(15, 2) NOT NULL,
  po_id UUID REFERENCES purchase_orders(id),
  po_number VARCHAR(255),
  bill_number VARCHAR(255),
  ipc_percent_complete DECIMAL(5, 2),
  payment_date DATE NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'deletion_requested', 'deleted'))
);

-- 21.3.1 BANKS
CREATE TABLE IF NOT EXISTS banks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  account_number VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 21.3.2 BANK TRANSACTIONS
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_id UUID REFERENCES banks(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  payee_name VARCHAR(255) NOT NULL,
  cheque_no VARCHAR(255),
  amount_in DECIMAL(15, 2) DEFAULT 0,
  amount_out DECIMAL(15, 2) DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'deletion_requested', 'deleted'))
);

-- 21.3.3 AMOUNT RECEIVED
CREATE TABLE IF NOT EXISTS amount_received (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  received_date DATE NOT NULL,
  description VARCHAR(255),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'deletion_requested', 'deleted'))
);

-- 21.4 DELETION REQUESTS
CREATE TABLE IF NOT EXISTS deletion_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('salary', 'petty_cash', 'vendor_payment', 'bank_transaction', 'amount_received')),
  transaction_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id),
  requested_by UUID REFERENCES users(id),
  reason TEXT,
  admin_approval VARCHAR(20) DEFAULT 'pending' CHECK (admin_approval IN ('pending', 'approved', 'rejected')),
  admin_approved_by UUID REFERENCES users(id),
  admin_approved_at TIMESTAMPTZ,
  owner_approval VARCHAR(20) DEFAULT 'pending' CHECK (owner_approval IN ('pending', 'approved', 'rejected')),
  owner_approved_by UUID REFERENCES users(id),
  owner_approved_at TIMESTAMPTZ,
  final_status VARCHAR(20) DEFAULT 'pending' CHECK (final_status IN ('pending', 'approved', 'rejected')),
  snapshot_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 21.5 NOTIFICATIONS (per-user, system-wide)
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  link TEXT,
  entity_type VARCHAR(100),
  entity_id UUID,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 22. INDEXES (FK columns, status columns, timestamps)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_feed_created_at ON activity_feed(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_warehouses_project_id ON warehouses(project_id);
CREATE INDEX IF NOT EXISTS idx_materials_category_id ON materials(category_id);
CREATE INDEX IF NOT EXISTS idx_materials_supplier_id ON materials(supplier_id);
CREATE INDEX IF NOT EXISTS idx_materials_warehouse_id ON materials(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_materials_is_active ON materials(is_active);
CREATE INDEX IF NOT EXISTS idx_stock_movements_material_id ON stock_movements(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_assigned_project_id ON vehicles(assigned_project_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_current_status ON vehicles(current_status);
CREATE INDEX IF NOT EXISTS idx_vehicle_fuel_logs_vehicle_id ON vehicle_fuel_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_logs_vehicle_id ON vehicle_maintenance_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_tools_assigned_project_id ON tools(assigned_project_id);
CREATE INDEX IF NOT EXISTS idx_tools_warehouse_id ON tools(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_tools_current_status ON tools(current_status);
CREATE INDEX IF NOT EXISTS idx_tool_checkout_log_tool_id ON tool_checkout_log(tool_id);
CREATE INDEX IF NOT EXISTS idx_project_allocations_project_id ON project_allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_from_wh ON transfer_requests(from_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_to_wh ON transfer_requests(to_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_status ON transfer_requests(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_id ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_project_id ON purchase_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_material_transactions_material_id ON material_transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_material_transactions_project_id ON material_transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_material_transactions_created_at ON material_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_passes_material_id ON gate_passes(material_id);
CREATE INDEX IF NOT EXISTS idx_gate_passes_project_id ON gate_passes(project_id);
CREATE INDEX IF NOT EXISTS idx_salaries_project_id ON salaries(project_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_project_id ON petty_cash(project_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_project_id ON vendor_payments(project_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor_id ON vendor_payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_project_id ON deletion_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_final_status ON deletion_requests(final_status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_po_id ON vendor_payments(po_id);
CREATE INDEX IF NOT EXISTS idx_banks_created_at ON banks(created_at);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_id ON bank_transactions(bank_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_amount_received_project_id ON amount_received(project_id);
CREATE INDEX IF NOT EXISTS idx_amount_received_status ON amount_received(status);

-- ============================================================
-- 23. CONSTRAINTS (guarded — skip if existing data violates)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vendors_name_key') THEN
    BEGIN
      ALTER TABLE vendors ADD CONSTRAINT vendors_name_key UNIQUE (name);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'vendors.name contains duplicates; unique constraint not added';
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='salaries_project_employee_month_key') THEN
    BEGIN
      ALTER TABLE salaries ADD CONSTRAINT salaries_project_employee_month_key UNIQUE (project_id, employee_name, month);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'salaries contains duplicates; unique constraint not added';
    END;
  END IF;
END $$;
