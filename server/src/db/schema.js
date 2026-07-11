const pool = require('./pool');

async function createSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Extensions
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Users & Auth
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff')),
        phone VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Audit Log
    await client.query(`
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
      )
    `);

    // Vendors / Suppliers
    await client.query(`
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
      )
    `);

    // Projects
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        client VARCHAR(255),
        location TEXT,
        city VARCHAR(100),
        budget DECIMAL(15, 2) DEFAULT 0,
        budget_used DECIMAL(15, 2) DEFAULT 0,
        start_date DATE,
        end_date DATE,
        status VARCHAR(50) DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Warehouses / Sites
    await client.query(`
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
      )
    `);

    // Categories
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Materials Inventory
    await client.query(`
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
      )
    `);

    // Stock movements
    await client.query(`
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
      )
    `);

    // Vehicles
    await client.query(`
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
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Fuel Logs
    await client.query(`
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
      )
    `);

    // Vehicle Maintenance Logs
    await client.query(`
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
      )
    `);

    // Tools & Equipment
    await client.query(`
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
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Tool Checkout Log
    await client.query(`
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Project Allocations
    await client.query(`
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
      )
    `);

    // Transfer Requests (Warehouse transfers with approval)
    await client.query(`
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
      )
    `);

    // Purchase Orders
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        po_number VARCHAR(100) UNIQUE NOT NULL,
        vendor_id UUID REFERENCES vendors(id),
        vendor_name VARCHAR(255),
        project_id UUID REFERENCES projects(id),
        order_date TIMESTAMPTZ DEFAULT NOW(),
        expected_delivery DATE,
        delivery_status VARCHAR(50) DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'partial', 'delivered', 'cancelled')),
        status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'ordered', 'completed')),
        total_amount DECIMAL(15,2) DEFAULT 0,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        approved_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Purchase Order Items
    await client.query(`
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
      )
    `);

    // Material Transactions (detailed stock in/out tracking)
    await client.query(`
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Add warehouse_id to material_transactions if missing
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='material_transactions' AND column_name='warehouse_id'
        ) THEN
          ALTER TABLE material_transactions ADD COLUMN warehouse_id UUID REFERENCES warehouses(id);
        END IF;
      END $$;
    `);

    // Gate Passes table
    await client.query(`
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
      )
    `);

    // Add source, received_by, transaction_type to material_transactions if missing
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='material_transactions' AND column_name='source'
        ) THEN
          ALTER TABLE material_transactions ADD COLUMN source VARCHAR(255);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='material_transactions' AND column_name='received_by'
        ) THEN
          ALTER TABLE material_transactions ADD COLUMN received_by VARCHAR(255);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='material_transactions' AND column_name='transaction_type'
        ) THEN
          ALTER TABLE material_transactions ADD COLUMN transaction_type VARCHAR(100);
        END IF;
      END $$;
    `);

    // Activity Feed (denormalized for dashboard performance)
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_feed (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_name VARCHAR(255),
        action VARCHAR(50),
        description TEXT,
        entity_type VARCHAR(100),
        entity_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log('Schema created successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Schema creation error:', err);
    throw err;
  } finally {
    client.release();
    client._released = true;
  }
}

module.exports = { createSchema };