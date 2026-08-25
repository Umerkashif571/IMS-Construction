const pool = require('../src/db/pool');
const bcrypt = require('bcryptjs');

const demoProjects = [
  {
    name: 'Bahria Town Phase 9',
    client: 'Bahria Town Pvt Ltd',
    location: 'Rawalpindi Bypass, Rawalpindi',
    city: 'Rawalpindi',
    project_cost_value: 5000000000,
    start_date: '2025-01-15',
    end_date: '2027-06-30',
    status: 'active',
    description: 'Development of 2,500 residential plots with full infrastructure including roads, water supply, electricity, and sewerage.'
  },
  {
    name: 'Karachi Metro Bus Project',
    client: 'Government of Sindh',
    location: 'M.A. Jinnah Road, Karachi',
    city: 'Karachi',
    project_cost_value: 12000000000,
    start_date: '2025-03-01',
    end_date: '2027-12-31',
    status: 'active',
    description: '22km BRT corridor with 24 stations, dedicated bus lanes, and terminal facilities.'
  },
  {
    name: 'Blue Area Highrise Tower',
    client: 'Capital Development Authority',
    location: 'Blue Area, Jinnah Avenue',
    city: 'Islamabad',
    project_cost_value: 8500000000,
    start_date: '2025-06-01',
    end_date: '2028-03-31',
    status: 'active',
    description: '40-story commercial tower with 3-level basement parking, retail podium, and helipad.'
  },
  {
    name: 'Faisalabad Industrial Zone',
    client: 'Punjab Industrial Estates',
    location: 'M-4 Motorway Interchange',
    city: 'Faisalabad',
    project_cost_value: 3500000000,
    start_date: '2025-04-01',
    end_date: '2026-09-30',
    status: 'active',
    description: 'Industrial park with 150 plots, warehouses, utilities, and common effluent treatment plant.'
  },
  {
    name: 'Hyderabad Bypass Bridge',
    client: 'National Highway Authority',
    location: 'Indus Highway',
    city: 'Hyderabad',
    project_cost_value: 2100000000,
    start_date: '2025-02-01',
    end_date: '2026-08-31',
    status: 'active',
    description: '2.5km bridge over Indus River with 4-lane approach roads and toll plaza.'
  },
  {
    name: 'Margalla Enclave Housing',
    client: 'FGEHA (CDA)',
    location: 'Bhara Kahu',
    city: 'Islamabad',
    project_cost_value: 7500000000,
    start_date: '2025-09-01',
    end_date: '2028-06-30',
    status: 'planning',
    description: '800 residential units with community center, mosque, commercial area, and parks.'
  }
];

// Salary templates per role (monthly salary in PKR)
const salaryRanges = {
  site_engineer: { min: 120000, max: 200000 },
  store_manager: { min: 100000, max: 180000 },
  procurement_officer: { min: 110000, max: 190000 },
  manager: { min: 150000, max: 250000 },
  staff: { min: 40000, max: 80000 },
  admin: { min: 200000, max: 350000 },
  owner: { min: 500000, max: 1000000 },
  finance: { min: 180000, max: 300000 },
  procurement_officer: { min: 110000, max: 190000 }
};

// Petty cash categories
const pcCategories = ['Material', 'Labor', 'Transport', 'Misc'];

// Vendor payment types
const paymentTypes = ['fixed_otp', 'continuous', 'ipc'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max, decimals = 2) {
  const value = Math.random() * (max - min) + min;
  return parseFloat(value.toFixed(decimals));
}

function randomDate(start, end) {
  const startDate = new Date(start).getTime();
  const endDate = new Date(end).getTime();
  return new Date(startDate + Math.random() * (endDate - startDate));
}

async function seedDemoData() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Starting demo data seeding...');

    // Get existing users (seeded users)
    const { rows: users } = await client.query('SELECT id, email, full_name, role FROM users WHERE is_active=true');
    const userMap = {};
    users.forEach(u => { userMap[u.email] = u; });
    console.log(`Found ${users.length} users`);

    // Get existing vendors
    const { rows: vendors } = await client.query('SELECT id, name FROM vendors WHERE status=\'active\'');
    console.log(`Found ${vendors.length} vendors`);

    // Get existing materials
    const { rows: materials } = await client.query('SELECT id, name, unit_cost, unit FROM materials WHERE is_active=true');
    console.log(`Found ${materials.length} materials`);

    // Get existing warehouses
    const { rows: warehouses } = await client.query('SELECT id, name FROM warehouses WHERE is_active=true');
    console.log(`Found ${warehouses.length} warehouses`);

    // Get existing banks
    const { rows: banks } = await client.query('SELECT id FROM banks');
    console.log(`Found ${banks.length} banks`);

    // Get existing purchase orders
    const { rows: pos } = await client.query('SELECT id, po_number, total_amount, vendor_id, project_id FROM purchase_orders WHERE status=\'approved\'');
    console.log(`Found ${pos.length} approved POs`);

    // Insert demo projects
    const projMap = {};
    for (const proj of demoProjects) {
      const { rows } = await client.query(
        `INSERT INTO projects (name, client, location, city, project_cost_value, start_date, end_date, status, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name`,
        [proj.name, proj.client, proj.location, proj.city, proj.project_cost_value, proj.start_date, proj.end_date, proj.status, proj.description]
      );
      projMap[proj.name] = rows[0].id;
      console.log(`Created project: ${proj.name} (${rows[0].id})`);
    }

    // For each project, add financial data
    const financeUsers = users.filter(u => ['owner', 'admin', 'finance', 'manager', 'procurement_officer'].includes(u.role));
    const storeUsers = users.filter(u => ['store_manager', 'owner', 'admin', 'finance'].includes(u.role));
    const allUsers = users.filter(u => u.is_active);

    for (const [projName, projId] of Object.entries(projMap)) {
      console.log(`\n--- Seeding financial data for: ${projName} ---`);

      // 1. SALARIES - 15-50 employees per project, 3-6 months of data
      const numEmployees = randomInt(15, 50);
      const projectUsers = financeUsers.slice(0, Math.min(numEmployees, financeUsers.length));
      
      for (let i = 0; i < projectUsers.length; i++) {
        const user = projectUsers[i];
        const range = salaryRanges[user.role] || { min: 80000, max: 150000 };
        const amount = randomInt(range.min, range.max);
        const month = randomDate('2025-01-01', '2025-06-30');
        const bank = banks[randomInt(0, banks.length - 1)];
        
        if (!bank) continue;
        
        try {
          const { rows } = await client.query(
            `INSERT INTO salaries (project_id, employee_name, amount, month, bank_id, created_by) 
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [projId, `${user.full_name} (${user.role})`, amount, month.toISOString().slice(0, 10), bank.id, user.id]
          );
          await client.query(
            `INSERT INTO bank_transactions (bank_id, date, payee_name, amount_out, created_by, source_type, source_ref, source_party)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [bank.id, month.toISOString().slice(0, 10), user.full_name, amount, user.id, 'salary', rows[0].id, user.full_name]
          );
        } catch (e) {
          console.log(`  Salary insert error for ${user.email}: ${e.message}`);
        }
      }
      console.log(`  Added ${projectUsers.length} salary records`);

      // 2. PETTY CASH - Weekly disbursements (3-6 per project)
      const numPettyCash = randomInt(3, 6);
      const pcDescriptions = ['Site Office Expenses', 'Labor Daily Wages', 'Material Transport', 'Site Office Supplies', 'Equipment Rental', 'Fuel & Lubricants'];
      
      for (let i = 0; i < numPettyCash; i++) {
        const amount = randomInt(50000, 200000);
        const weekOf = randomDate('2025-01-01', '2025-06-30');
        const bank = banks[randomInt(0, banks.length - 1)];
        const description = pcDescriptions[randomInt(0, pcDescriptions.length - 1)];
        const createdBy = storeUsers[randomInt(0, storeUsers.length - 1)] || allUsers[0];
        
        if (!bank) continue;
        
        try {
          const { rows } = await client.query(
            `INSERT INTO petty_cash (project_id, description, amount, week_of, bank_id, created_by) 
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [projId, description, amount, weekOf.toISOString().slice(0, 10), bank.id, createdBy.id]
          );
          
          // Auto-link bank transaction
          await client.query(
            `INSERT INTO bank_transactions (bank_id, date, payee_name, amount_out, created_by, source_type, source_ref, source_party)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [bank.id, weekOf.toISOString().slice(0, 10), description, amount, createdBy.id, 'petty_cash', rows[0].id, description]
          );
        } catch (e) {
          console.log(`  Petty cash insert error: ${e.message}`);
        }
      }
      console.log(`  Added ${numPettyCash} petty cash disbursements`);

      // 3. VENDOR PAYMENTS - Mix of payment types, linked to POs
      const projectPOs = pos.filter(po => po.project_id === projId);
      const numPayments = randomInt(3, 8);
      
      for (let i = 0; i < numPayments; i++) {
        const vendor = vendors.length > 0 ? vendors[randomInt(0, vendors.length - 1)] : null;
        const paymentType = paymentTypes[randomInt(0, paymentTypes.length - 1)];
        const amount = randomInt(500000, 15000000);
        const paymentDate = randomDate('2025-01-01', '2025-06-30');
        const bank = banks.length > 0 ? banks[randomInt(0, banks.length - 1)] : null;
        const createdBy = allUsers.length > 0 ? allUsers[randomInt(0, allUsers.length - 1)] : null;
        
        let poId = null, poNumber = null, billNo = null, ipcPct = null;
        
        if (paymentType === 'continuous' && projectPOs.length > 0) {
          const po = projectPOs[randomInt(0, projectPOs.length - 1)];
          // Check if PO is approved
          const { rows: poCheck } = await client.query(
            `SELECT id, po_number, total_amount, status, admin_approval, owner_approval 
             FROM purchase_orders WHERE id=$1`, [po.id]
          );
          if (poCheck.length > 0 && poCheck[0].status === 'approved' && 
              poCheck[0].admin_approval === 'approved' && poCheck[0].owner_approval === 'approved') {
            poId = po.id;
            poNumber = poCheck[0].po_number;
            
            // Validate outstanding
            const { rows: paidQ } = await client.query(
              `SELECT COALESCE(SUM(amount), 0)::float AS paid FROM vendor_payments WHERE po_id=$1 AND status<>'deleted'`,
              [po.id]
            );
            const poTotal = poCheck[0].total_amount;
            const alreadyPaid = parseFloat(paidQ[0].paid || 0);
            const outstanding = poTotal - alreadyPaid;
            
            if (amount > outstanding) continue; // skip this payment
          } else {
            continue; // skip if PO not approved
          }
        }
        
        if (paymentType === 'ipc') {
          ipcPct = randomInt(10, 90);
        }
        
        if (paymentType === 'continuous') {
          billNo = `BILL-${Date.now()}-${i}`;
        }
        
        try {
          await client.query(
            `INSERT INTO vendor_payments (project_id, vendor_id, payment_type, amount, po_id, po_number, bill_number, ipc_percent_complete, payment_date, bank_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [projId, vendor.id, paymentType, amount, poId, poNumber, billNo, ipcPct, paymentDate.toISOString().slice(0, 10), bank?.id, createdBy.id]
          );
          
          // Auto-link bank transaction
          if (bank) {
            await client.query(
              `INSERT INTO bank_transactions (bank_id, date, payee_name, cheque_no, amount_out, created_by, source_type, source_ref, source_party)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [bank.id, paymentDate.toISOString().slice(0, 10), vendor.name, billNo || poNumber, amount, createdBy.id, 'vendor_payment', poId || `vp-${Date.now()}`, vendor.name]
            );
          }
        } catch (e) {
          console.log(`  Vendor payment insert error: ${e.message}`);
        }
      }
      console.log(`  Added ${numPayments} vendor payments`);

      // 4. MATERIAL COSTS - Stock out transactions (material issued to project)
      const numMaterialTxns = randomInt(10, 25);
      for (let i = 0; i < numMaterialTxns; i++) {
        const material = materials.length > 0 ? materials[randomInt(0, materials.length - 1)] : null;
        const warehouse = warehouses.length > 0 ? warehouses[randomInt(0, warehouses.length - 1)] : null;
        const qty = randomInt(10, 500);
        const unitCost = parseFloat(material?.unit_cost || 0);
        const projectId = projId;
        const date = randomDate('2025-01-01', '2025-06-30');
        const createdBy = (storeUsers.length > 0 ? storeUsers[randomInt(0, storeUsers.length - 1)] : null) || (allUsers.length > 0 ? allUsers[0] : null);
        
        if (!material || !warehouse) continue;
        
        try {
          await client.query(
            `INSERT INTO material_transactions (material_id, type, quantity, running_total, date, project_id, warehouse_id, location, driver_name, vehicle_number, added_by, notes, transaction_type)
             VALUES ($1, 'out', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'project_issue')`,
            [material.id, qty, qty, date.toISOString().slice(0, 10), projectId, warehouse.id, material.storage_location || 'Site', `Driver ${randomInt(1, 100)}`, `Veh-${randomInt(1000, 9999)}`, createdBy.id, 'Material issued to project site']
          );
          
          // Update material quantity
          await client.query(
            'UPDATE materials SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2',
            [qty, material.id]
          );
          
          // Update project budget_used
          const totalCost = qty * unitCost;
          await client.query(
            'UPDATE projects SET budget_used = COALESCE(budget_used, 0) + $1 WHERE id = $2',
            [totalCost, projId]
          );
        } catch (e) {
          console.log(`  Material transaction error: ${e.message}`);
        }
      }
      console.log(`  Added ${numMaterialTxns} material transactions (stock out)`);

      // 5. AMOUNT RECEIVED - 2-3 progress payments per project
      const numReceived = randomInt(2, 3);
      for (let i = 0; i < numReceived; i++) {
        const amount = randomInt(500000, 5000000);
        const receivedDate = randomDate('2025-01-01', '2025-06-30');
        const bank = banks.length > 0 ? banks[randomInt(0, banks.length - 1)] : null;
        const party = ['Client Payment', 'Progress Payment', 'Advance Payment', 'Final Settlement'][randomInt(0, 3)];
        const createdBy = allUsers.length > 0 ? allUsers[randomInt(0, allUsers.length - 1)] : null;
        
        if (!bank || !createdBy) continue;
        
        try {
          const { rows } = await client.query(
            `INSERT INTO amount_received (project_id, amount, received_date, description, bank_id, received_from, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [projId, amount, receivedDate.toISOString().slice(0, 10), `Progress payment #${i+1}`, bank.id, party, createdBy.id]
          );
          
          // Auto-link bank transaction
          await client.query(
            `INSERT INTO bank_transactions (bank_id, date, payee_name, amount_in, created_by, source_type, source_ref, source_party)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [bank.id, receivedDate.toISOString().slice(0, 10), party, amount, createdBy.id, 'amount_received', rows[0].id, party]
          );
        } catch (e) {
          console.log(`  Amount received insert error: ${e.message}`);
        }
      }
      console.log(`  Added ${numReceived} amount received records`);
    }

    await client.query('COMMIT');
    console.log('\n=== Demo data seeding completed successfully! ===');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seedDemoData();