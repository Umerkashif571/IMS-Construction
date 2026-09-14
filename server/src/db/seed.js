const pool = require('./pool');
const bcrypt = require('bcryptjs');

async function seedDatabase() {
  // Defense in depth: even if called directly, never seed automatically in production.
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ENABLED !== 'true') {
    console.log('SeedDatabase skipped: production mode requires SEED_ENABLED=true to seed.');
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if already seeded
    const { rows: existing } = await client.query('SELECT COUNT(*) as count FROM users');
    if (parseInt(existing[0].count) > 0) {
      console.log('Database already seeded, skipping...');
      // NOTE: do NOT release here — the finally block owns the single release.
      // An early release here caused a double-release (pg-pool throws
      // "Release called on client which has already been released to the pool")
      // which crashed the long-running server after boot.
      await client.query('ROLLBACK');
      return;
    }

    // === USERS ===
    // Per-account passwords via SEED_PASSWORD_<EMAIL_PREFIX> (e.g. SEED_PASSWORD_OWNER),
    // falling back to SEED_PASSWORD. In production these must be supplied explicitly.
    const seedPassword = process.env.SEED_PASSWORD || 'password123';
    if (!process.env.SEED_PASSWORD) {
      console.warn('WARNING: SEED_PASSWORD not set — using default "password123". Change before production deployment.');
    }
    const accountData = [
      ['admin@ims.com', 'Imran Khan', 'admin', '0300-1234567'],
      ['store@ims.com', 'Ahmed Ali', 'store_manager', '0301-2345678'],
      ['engineer@ims.com', 'Usman Malik', 'site_engineer', '0302-3456789'],
      ['procurement@ims.com', 'Sana Tariq', 'procurement_officer', '0303-4567890'],
      ['owner@ims.com', 'Owner User', 'owner', '0304-5678901'],
      ['manager@ims.com', 'Manager User', 'manager', '0305-6789012'],
      ['staff@ims.com', 'Staff User', 'staff', '0306-7890123'],
      ['finance@ims.com', 'Finance User', 'finance', '0307-8901234']
    ];
    const users = [];
    for (const [email, fullName, role, phone] of accountData) {
      const envKey = 'SEED_PASSWORD_' + email.split('@')[0].toUpperCase();
      const accountPassword = process.env[envKey] || seedPassword;
      const hashedPassword = await bcrypt.hash(accountPassword, 10);
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, full_name, role`,
        [email, hashedPassword, fullName, role, phone]
      );
      users.push(rows[0]);
    }
    console.log('Users seeded');

    // === CATEGORIES ===
    const categories = await client.query(`
      INSERT INTO categories (name, description) VALUES
        ('Cement & Binders', 'Cement, lime, plaster, and binding materials'),
        ('Steel & Reinforcement', 'Steel bars, mesh, structural steel'),
        ('Aggregates & Sand', 'Crush, sand, gravel and aggregates'),
        ('Bricks & Blocks', 'Clay bricks, concrete blocks, aerated blocks'),
        ('Electrical', 'Cables, switches, panels, lighting, wiring'),
        ('Plumbing', 'Pipes, fittings, valves, fixtures'),
        ('Paints & Finishes', 'Paint, primer, putty, waterproofing'),
        ('Wood & Timber', 'Lumber, plywood, formwork timber'),
        ('Chemicals & Additives', 'Admixtures, sealants, adhesives'),
        ('Safety Equipment', 'PPE, helmets, harnesses, safety gear')
      RETURNING id, name
    `);
    const catMap = {};
    categories.rows.forEach(c => { catMap[c.name] = c.id; });
    console.log('Categories seeded');

    // === VENDORS ===
    const vendors = await client.query(`
      INSERT INTO vendors (name, contact_person, email, phone, address, city, province, ntn, strn, payment_terms) VALUES
        ('Lucky Cement Ltd', 'Rashid Mehmood', 'rashid@luckycement.com', '021-111-111-222', 'Main Boulevard, Gulshan-e-Iqbal', 'Karachi', 'Sindh', 'NTN-1234567-1', 'STRN-7654321-1', 'Net 30'),
        ('Pakistan Steel Mills', 'Farhan Akbar', 'farhan@steelmill.com.pk', '021-992-01100', 'Steel Town, Bin Qasim', 'Karachi', 'Sindh', 'NTN-2345678-2', 'STRN-6543210-2', 'Net 45'),
        ('Maple Leaf Cement', 'Hassan Raza', 'hassan@mapleleaf.com', '042-111-222-333', 'Ferozepur Road', 'Lahore', 'Punjab', 'NTN-3456789-3', 'STRN-5432109-3', 'Net 30'),
        ('Al-Fatah Hardware', 'Khalid Mahmood', 'khalid@alfatah.com', '051-444-555-666', 'Rawalpindi Bazaar', 'Rawalpindi', 'Punjab', 'NTN-4567890-4', 'STRN-4321098-4', 'Cash on Delivery'),
        ('Siemens Pakistan', 'Ahmed Riaz', 'ahmed@siemens.com.pk', '021-3567-8901', 'Siemens Building, Clifton', 'Karachi', 'Sindh', 'NTN-5678901-5', 'STRN-3210987-5', 'Net 60'),
        ('Engro Construction', 'Tariq Mahmood', 'tariq@engro.com', '021-111-000-111', 'Engro Tower, Saddar', 'Karachi', 'Sindh', 'NTN-6789012-6', 'STRN-2109876-6', 'Net 30'),
        ('Ghani Automobiles', 'Usman Ghani', 'usman@ghaniauto.com', '042-3578-1234', 'Multan Road', 'Lahore', 'Punjab', 'NTN-7890123-7', 'STRN-1098765-7', 'Net 15'),
        ('Islamabad Tools Mart', 'Naveed Ahmed', 'naveed@itm.com', '051-234-5678', 'I-8 Markaz', 'Islamabad', 'Islamabad', 'NTN-8901234-8', 'STRN-0987654-8', 'Cash')
      RETURNING id, name
    `);
    const vendorMap = {};
    vendors.rows.forEach(v => { vendorMap[v.name] = v.id; });
    console.log('Vendors seeded');

    // === PROJECTS ===
    const projects = await client.query(`
      INSERT INTO projects (name, client, location, city, budget, start_date, end_date, status, description) VALUES
        ('Bahria Town Phase 9', 'Bahria Town Pvt Ltd', 'Rawalpindi Bypass', 'Rawalpindi', 5000000000, '2025-01-15', '2027-06-30', 'active', 'Development of 2500 residential plots with infrastructure'),
        ('Karachi Metro Bus Project', 'Government of Sindh', 'M.A. Jinnah Road', 'Karachi', 12000000000, '2025-03-01', '2027-12-31', 'active', 'Construction of 22km BRT corridor with 24 stations'),
        ('Blue Area Highrise Tower', 'Capital Development Authority', 'Blue Area, Jinnah Ave', 'Islamabad', 8500000000, '2025-06-01', '2028-03-31', 'active', '40-story commercial tower with parking and retail'),
        ('Faisalabad Industrial Zone', 'Punjab Industrial Estates', 'M-4 Motorway Interchange', 'Faisalabad', 3500000000, '2025-04-01', '2026-09-30', 'active', 'Industrial park with warehouses and utilities'),
        ('Hyderabad Bypass Bridge', 'National Highway Authority', 'Indus Highway', 'Hyderabad', 2100000000, '2025-02-01', '2026-08-31', 'active', '2.5km bridge over Indus River with approach roads'),
        ('Margalla Enclave Housing', 'FGEHA (CDA)', 'Bhara Kahu', 'Islamabad', 7500000000, '2025-09-01', '2028-06-30', 'planning', '800 residential units with amenities')
      RETURNING id, name
    `);
    const projMap = {};
    projects.rows.forEach(p => { projMap[p.name] = p.id; });
    console.log('Projects seeded');

    // === WAREHOUSES ===
    const whRows = [];
    for (const [wname, wtype, wloc, wcity, wproj] of [
      ['Main Store - Lahore', 'main_store', 'Ferozepur Road Industrial Area', 'Lahore', null],
      ['Site Store - Bahria Town', 'site_store', 'Rawalpindi Bypass Site', 'Rawalpindi', 'Bahria Town Phase 9'],
      ['Site Store - Metro Bus', 'site_store', 'M.A. Jinnah Road Site', 'Karachi', 'Karachi Metro Bus Project'],
      ['Site Store - Blue Area', 'site_store', 'Blue Area Construction', 'Islamabad', 'Blue Area Highrise Tower'],
      ['Central Warehouse - Islamabad', 'warehouse', 'I-9 Industrial Area', 'Islamabad', null],
      ['Site Store - Faisalabad', 'site_store', 'M-4 Interchange Site', 'Faisalabad', 'Faisalabad Industrial Zone'],
      ['Site Store - Hyderabad Bridge', 'site_store', 'Indus Highway Site', 'Hyderabad', 'Hyderabad Bypass Bridge']
    ]) {
      const { rows: wr } = await client.query(
        `INSERT INTO warehouses (name, type, location, city, project_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, name`,
        [wname, wtype, wloc, wcity, wproj ? projMap[wproj] : null]
      );
      whRows.push(wr[0]);
    }
    const whMap = {};
    whRows.forEach(w => { whMap[w.name] = w.id; });
    console.log('Warehouses seeded');

    // === MATERIALS (using dynamic INSERT building) ===
    const materialData = [
      ['CEM-OPC-001', 'Ordinary Portland Cement (50kg)', 'Lucky Cement OPC 50kg bags', catMap['Cement & Binders'], 'bags', 5000, 500, 1380.00, vendorMap['Engro Construction'], 'Aisle A, Rack 1-10', whMap['Central Warehouse - Islamabad']],
      ['CEM-SRC-002', 'Sulphate Resistant Cement', 'Maple Leaf SRC 50kg', catMap['Cement & Binders'], 'bags', 2000, 300, 1520.00, vendorMap['Maple Leaf Cement'], 'Aisle A, Rack 11-20', whMap['Central Warehouse - Islamabad']],
      ['STL-40-GR60', '40mm Steel Bars Grade 60', 'Pakistan Steel 40mm TMT bars', catMap['Steel & Reinforcement'], 'tonnes', 450, 50, 245000.00, vendorMap['Pakistan Steel Mills'], 'Yard B, Section 1', whMap['Main Store - Lahore']],
      ['STL-20-GR60', '20mm Steel Bars Grade 60', 'Pakistan Steel 20mm TMT bars', catMap['Steel & Reinforcement'], 'tonnes', 680, 80, 248000.00, vendorMap['Pakistan Steel Mills'], 'Yard B, Section 2', whMap['Main Store - Lahore']],
      ['STL-12-GR60', '12mm Steel Bars Grade 60', 'Pakistan Steel 12mm TMT bars', catMap['Steel & Reinforcement'], 'tonnes', 520, 75, 250000.00, vendorMap['Pakistan Steel Mills'], 'Yard B, Section 3', whMap['Main Store - Lahore']],
      ['SND-RIV-001', 'River Sand', 'Fine river sand for concrete', catMap['Aggregates & Sand'], 'cubic_ft', 24000, 3000, 45.00, vendorMap['Lucky Cement Ltd'], 'Yard C', whMap['Main Store - Lahore']],
      ['SND-CRSH-02', 'Crush Sand (Quarry)', 'Crushed sand for plaster', catMap['Aggregates & Sand'], 'cubic_ft', 18000, 2000, 55.00, vendorMap['Lucky Cement Ltd'], 'Yard C, Section 2', whMap['Main Store - Lahore']],
      ['AGG-20-CRSH', '20mm Crush Aggregate', 'Coarse aggregate for concrete', catMap['Aggregates & Sand'], 'cubic_ft', 36000, 4000, 62.00, vendorMap['Engro Construction'], 'Yard D', whMap['Main Store - Lahore']],
      ['BLK-CLC-001', 'Clay Bricks (1000 pcs)', 'Standard red clay bricks per thousand', catMap['Bricks & Blocks'], 'thousand', 1200, 200, 14500.00, vendorMap['Engro Construction'], 'Yard E', whMap['Main Store - Lahore']],
      ['BLK-AAC-002', 'AAC Blocks (4 inch)', '4 inch aerated concrete blocks', catMap['Bricks & Blocks'], 'cubic_m', 800, 100, 8200.00, vendorMap['Engro Construction'], 'Yard F', whMap['Main Store - Lahore']],
      ['ELC-CBL-CU', 'Copper Cable 4mm 100m', 'Single core copper cable 4mm', catMap['Electrical'], 'rolls', 350, 50, 12500.00, vendorMap['Siemens Pakistan'], 'Shelf A1-B2', whMap['Central Warehouse - Islamabad']],
      ['ELC-SWT-10A', '10A Single Switch', 'Piano type switch 10A', catMap['Electrical'], 'pcs', 2500, 300, 185.00, vendorMap['Siemens Pakistan'], 'Shelf A2-C1', whMap['Main Store - Lahore']],
      ['ELC-LED-18W', '18W LED Panel Light', 'Square LED panel 18W warm white', catMap['Electrical'], 'pcs', 1800, 200, 1650.00, vendorMap['Siemens Pakistan'], 'Shelf A3-D1', whMap['Main Store - Lahore']],
      ['PLB-PVC-4IN', 'PVC Pipe 4 inch 10ft', 'Schedule 40 PVC pipe 10ft length', catMap['Plumbing'], 'pcs', 1500, 200, 750.00, vendorMap['Al-Fatah Hardware'], 'Shelf B1-A1', whMap['Main Store - Lahore']],
      ['PLB-BALL-GY', 'GI Ball Valve 2 inch', 'Galvanized iron ball valve 2 inch', catMap['Plumbing'], 'pcs', 800, 100, 2850.00, vendorMap['Al-Fatah Hardware'], 'Shelf B2-B1', whMap['Main Store - Lahore']],
      ['PLB-FTX-15M', '15mm Brass Faucet', 'Chrome finish basin mixer', catMap['Plumbing'], 'pcs', 600, 80, 4200.00, vendorMap['Al-Fatah Hardware'], 'Shelf B2-C1', whMap['Main Store - Lahore']],
      ['PNT-EML-WHT', 'Emulsion Paint White (5L)', 'Dulux emulsion paint white 5L tin', catMap['Paints & Finishes'], 'tins', 900, 120, 3850.00, vendorMap['Maple Leaf Cement'], 'Shelf C1-A1', whMap['Main Store - Lahore']],
      ['PNT-WPRF-LIQ', 'Waterproofing Liquid (20L)', 'Bitumen based waterproof coating', catMap['Paints & Finishes'], 'tins', 400, 60, 5200.00, vendorMap['Maple Leaf Cement'], 'Shelf C1-B1', whMap['Central Warehouse - Islamabad']],
      ['WOD-PLY-6MM', '6mm Plywood Sheet (8x4)', '6mm commercial plywood', catMap['Wood & Timber'], 'sheets', 1200, 200, 2800.00, vendorMap['Al-Fatah Hardware'], 'Yard G, Section 1', whMap['Main Store - Lahore']],
      ['WOD-SHUT-1M', 'Shuttering Plywood (18mm)', '18mm concrete formwork plywood 8x4', catMap['Wood & Timber'], 'sheets', 800, 150, 6200.00, vendorMap['Al-Fatah Hardware'], 'Yard G, Section 2', whMap['Main Store - Lahore']],
      ['CHM-PWX-001', 'Concrete Water Reducer', 'Plastol HW superplasticizer 25L', catMap['Chemicals & Additives'], 'liters', 1500, 200, 380.00, vendorMap['Siemens Pakistan'], 'Shelf D1-A1', whMap['Main Store - Lahore']],
      ['SFT-HLM-VST', 'Safety Helmet (ISIPRO)', 'V-Profile safety helmet yellow', catMap['Safety Equipment'], 'pcs', 2000, 300, 450.00, vendorMap['Islamabad Tools Mart'], 'Shelf E1-A1', whMap['Central Warehouse - Islamabad']],
      ['SFT-HRNS-FUL', 'Full Body Safety Harness', 'Full body harness with shock absorber', catMap['Safety Equipment'], 'pcs', 350, 50, 6800.00, vendorMap['Islamabad Tools Mart'], 'Shelf E1-B1', whMap['Main Store - Lahore']],
      ['SFT-VST-HIV', 'Hi-Visibility Vest', 'Orange hi-vis vest with reflective tape', catMap['Safety Equipment'], 'pcs', 1500, 200, 650.00, vendorMap['Islamabad Tools Mart'], 'Shelf E2-A1', whMap['Main Store - Lahore']]
    ];
    const materialPlaceholders = [];
    const materialValues = [];
    materialData.forEach((m, i) => {
      const paramStart = i * 11 + 1;
      materialPlaceholders.push(`($${paramStart},$${paramStart+1},$${paramStart+2},$${paramStart+3},$${paramStart+4},$${paramStart+5},$${paramStart+6},$${paramStart+7},$${paramStart+8},$${paramStart+9},$${paramStart+10})`);
      materialValues.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10]);
    });
    const materials = await client.query(
      `INSERT INTO materials (sku, name, description, category_id, unit, quantity, reorder_level, unit_cost, supplier_id, storage_location, warehouse_id) VALUES ${materialPlaceholders.join(', ')} RETURNING id, name, sku, unit, quantity, unit_cost`,
      materialValues
    );
    const matMap = {};
    materials.rows.forEach(m => { matMap[m.name] = m; });
    console.log('Materials seeded');

    // === VEHICLES (individual inserts) ===
    const vehicleData = [
      ['LEC-2026', 'Concrete Mixer Truck', 'Howo', '6x4 10m³', 2023, '2023-03-15', 28500000, 'active', projMap['Bahria Town Phase 9'], 'Diesel', 350, '2026-12-31', '2027-01-15', '2026-05-15', '2026-08-15', 85240.50],
      ['LEC-2027', 'Concrete Mixer Truck', 'Howo', '6x4 10m³', 2024, '2024-06-01', 29200000, 'active', projMap['Karachi Metro Bus Project'], 'Diesel', 350, '2026-12-31', '2027-02-20', '2026-04-20', '2026-07-20', 42150.00],
      ['LEC-2021', 'Concrete Mixer Truck', 'Sitrak', '6x4 10m³', 2023, '2023-08-10', 27500000, 'under_maintenance', projMap['Bahria Town Phase 9'], 'Diesel', 350, '2026-11-15', '2027-02-10', '2026-05-10', '2026-08-10', 124500.00],
      ['PSE-001', 'Hydraulic Excavator', 'Caterpillar', '320D', 2022, '2022-01-20', 42500000, 'active', projMap['Blue Area Highrise Tower'], 'Diesel', 400, '2026-10-15', '2027-03-01', '2026-03-01', '2026-06-01', 8520.00],
      ['PSE-002', 'Hydraulic Excavator', 'Komatsu', 'PC200', 2023, '2023-11-05', 45800000, 'active', projMap['Faisalabad Industrial Zone'], 'Diesel', 380, '2027-01-15', '2027-05-01', '2026-02-15', '2026-05-15', 4250.50],
      ['LEC-2028', 'Dump Truck', 'Howo', '6x4 24m³', 2024, '2024-04-20', 18200000, 'active', projMap['Bahria Town Phase 9'], 'Diesel', 300, '2026-12-31', '2027-04-15', '2026-04-01', '2026-07-01', 45600.00],
      ['LEC-2029', 'Dump Truck', 'Sinotruk', '6x4 24m³', 2024, '2024-04-20', 17800000, 'idle', null, 'Diesel', 300, '2026-09-30', '2027-04-15', '2026-03-01', '2026-06-01', 28300.00],
      ['CR-001', 'Tower Crane', 'Liebherr', '125 HC', 2022, '2022-07-01', 52000000, 'active', projMap['Blue Area Highrise Tower'], 'Diesel', 200, '2027-02-28', '2027-06-01', '2026-04-10', '2026-07-10', 0],
      ['CR-002', 'Mobile Crane', 'XCMG', '25 Ton', 2023, '2023-02-15', 22500000, 'active', projMap['Bahria Town Phase 9'], 'Diesel', 250, '2026-12-15', '2027-04-20', '2026-01-20', '2026-04-20', 12500.00],
      ['PSE-003', 'Wheel Loader', 'Cat', '950 GC', 2023, '2023-09-10', 19800000, 'active', projMap['Karachi Metro Bus Project'], 'Diesel', 320, '2027-01-31', '2027-05-15', '2026-03-15', '2026-06-15', 8230.50]
    ];
    for (const v of vehicleData) {
      await client.query(
        `INSERT INTO vehicles (registration_no, type, brand, model, year, purchase_date, purchase_cost, current_status, assigned_project_id, fuel_type, tank_capacity, insurance_expiry, registration_expiry, last_maintenance_date, next_maintenance_date, odometer_reading) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        v
      );
    }
    console.log('Vehicles seeded');

    // === TOOLS ===
    for (const t of [
      ['Bosch GSB 21-2 Hammer Drill', 'BSCH-32100-01', 'Power Tool', 'Drilling', '2025-01-15', 28500, 'good', 'available', null, '2026-04-01', '2026-07-01', null],
      ['Makita HR2450 Rotary Hammer', 'MAKT-24500-02', 'Power Tool', 'Demolition', '2025-02-01', 42000, 'good', 'checked_out', projMap['Bahria Town Phase 9'], '2026-03-15', '2026-06-15', null],
      ['Total Station Sokkia CX-105', 'SOKK-CX105-01', 'Surveying', 'Surveying', '2024-06-01', 890000, 'good', 'checked_out', projMap['Karachi Metro Bus Project'], '2026-02-01', '2026-05-01', '2026-08-15'],
      ['Auto Level Sokkia B30', 'SOKK-B30-03', 'Surveying', 'Surveying', '2024-08-15', 185000, 'good', 'available', null, '2026-03-01', '2026-06-01', '2026-09-01'],
      ['DeWalt DWE431 7" Grinder', 'DEWT-43100-04', 'Power Tool', 'Cutting/Grinding', '2025-03-01', 22500, 'good', 'available', null, '2026-04-10', '2026-07-10', null],
      ['Welding Machine 400A', 'WELD-400A-05', 'Power Tool', 'Welding', '2024-11-01', 175000, 'fair', 'available', null, '2026-02-20', '2026-05-20', null],
      ['Vibrating Poker 2"', 'VBR-2IN-06', 'Power Tool', 'Concrete', '2025-01-10', 38000, 'good', 'checked_out', projMap['Bahria Town Phase 9'], '2026-04-05', '2026-07-05', null],
      ['Plate Compactor Honda', 'COMP-HND-07', 'Power Tool', 'Compaction', '2024-09-01', 245000, 'good', 'available', null, '2026-01-15', '2026-04-15', null],
      ['Full Harness Safety Kit Set', 'SFTY-HAR-08', 'Safety Gear', 'Fall Protection', '2025-05-01', 12000, 'new', 'available', null, null, null, null],
      ['Welding Helmet Auto Dark', 'WELD-HLM-09', 'Safety Gear', 'Welding', '2025-04-15', 8500, 'good', 'available', null, null, null, null],
      ['Aluminum Scaffolding 10ft', 'SCFF-10FT-10', 'Scaffolding', 'Scaffolding', '2024-07-01', 42000, 'good', 'available', null, '2026-03-01', '2026-06-01', null],
      ['Concrete Test Hammer', 'TEST-HMR-11', 'Surveying', 'Testing', '2025-02-15', 95000, 'good', 'available', null, null, null, '2026-09-01'],
      ['Rebound Hammer Schmidt', 'SCHM-RBH-12', 'Surveying', 'Testing', '2024-10-01', 145000, 'good', 'available', null, '2026-01-01', '2026-04-01', '2026-08-01'],
      ['Chainsaw Stihl MS 180', 'STHL-MS180-13', 'Power Tool', 'Cutting', '2025-06-01', 32000, 'fair', 'available', null, '2026-05-01', '2026-08-01', null],
      ['Survey Tripod Aluminum', 'TRPD-AL-14', 'Surveying', 'Surveying', '2024-12-01', 18500, 'good', 'available', null, null, null, null]
    ]) {
      await client.query(
        `INSERT INTO tools (name, serial_number, type, category, purchase_date, purchase_cost, current_condition, current_status, assigned_project_id, last_maintenance_date, next_maintenance_date, calibration_due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        t
      );
    }
    console.log('Tools seeded');

    // === STOCK MOVEMENTS ===
    const adminUser = users[0];
    const storeUser = users[1];
    await client.query(`
      INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, reference_type, notes, warehouse_id, user_id, user_name, created_at) VALUES
        ((SELECT id FROM materials WHERE sku='CEM-OPC-001'), 'Ordinary Portland Cement (50kg)', 'in', 5000, 'bags', 'initial_stock', 'Opening stock - Main Store', $1, $2, $3, NOW() - INTERVAL '90 days'),
        ((SELECT id FROM materials WHERE sku='STL-40-GR60'), '40mm Steel Bars Grade 60', 'in', 450, 'tonnes', 'initial_stock', 'Opening stock - Yard B', $1, $2, $3, NOW() - INTERVAL '90 days'),
        ((SELECT id FROM materials WHERE sku='SND-RIV-001'), 'River Sand', 'in', 24000, 'cubic_ft', 'initial_stock', 'Opening stock - Yard C', $1, $2, $3, NOW() - INTERVAL '90 days')
    `, [whMap['Main Store - Lahore'], storeUser.id, storeUser.full_name]);
    console.log('Stock movements seeded');

    // === ACTIVITY FEED ===
    await client.query(`
      INSERT INTO activity_feed (user_name, action, description, entity_type, created_at) VALUES
        ('Imran Khan', 'logged_in', 'Admin user logged in', 'auth', NOW() - INTERVAL '2 hours'),
        ('Ahmed Ali', 'created', 'Added 5000 bags of OPC Cement to inventory', 'material', NOW() - INTERVAL '1 hour'),
        ('Usman Malik', 'requested', 'Requested 200 bags of cement for Bahria Town site', 'material', NOW() - INTERVAL '45 minutes'),
        ('Sana Tariq', 'created', 'Created purchase order PO-2026-001 for Lucky Steel', 'purchase_order', NOW() - INTERVAL '30 minutes'),
        ('Ahmed Ali', 'assigned', 'Transfer approved: 500 bags of cement to Bahria Town store', 'transfer', NOW() - INTERVAL '15 minutes'),
        ('Usman Malik', 'checked_out', 'Checked out Total Station to Metro Bus project', 'tool', NOW() - INTERVAL '10 minutes')
    `);
    console.log('Activity feed seeded');

    // === PURCHASE ORDERS ===
    // purchase_orders.project_id is NOT NULL (schema.js) — every demo PO must belong to a project
    for (const [ponum, vendorKey, vname, delStatus, poStatus, amount, projName] of [
      ['PO-2026-001', vendorMap['Lucky Cement Ltd'], 'Lucky Cement Ltd', 'pending', 'approved', 110250000, 'Bahria Town Phase 9'],
      ['PO-2026-002', vendorMap['Maple Leaf Cement'], 'Maple Leaf Cement', 'partial', 'ordered', 6200000, 'Karachi Metro Bus Project'],
      ['PO-2026-003', vendorMap['Siemens Pakistan'], 'Siemens Pakistan', 'pending', 'approved', 8750000, 'Blue Area Highrise Tower']
    ]) {
      await client.query(
        `INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, project_id, order_date, expected_delivery, delivery_status, status, total_amount, created_by) VALUES ($1,$2,$3,$4,NOW() - INTERVAL '14 days',NOW() + INTERVAL '15 days',$5,$6,$7,$8)`,
        [ponum, vendorKey, vname, projMap[projName], delStatus, poStatus, amount, users[0].id]
      );
    }
    console.log('Purchase orders seeded');

    await client.query('COMMIT');
    console.log('Database seeded successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed error:', err);
    throw err;
  } finally {
    // Idempotent release — pg-pool throws if a client is released twice.
    try { client.release(); } catch (e) {
      console.error('Seed client release error:', e.message);
    }
  }
}

module.exports = { seedDatabase };