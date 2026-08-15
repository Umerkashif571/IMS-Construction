const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles, createNotification } = require('../db/helpers');

const router = express.Router({ mergeParams: true });

const FULL_ACCESS = ['owner', 'admin', 'finance'];
const PM_ACCESS = ['manager'];
const APPROVERS = ['owner', 'admin'];

const TX_TABLES = {
  salary: 'salaries',
  petty_cash: 'petty_cash',
  vendor_payment: 'vendor_payments',
  bank_transaction: 'bank_transactions',
  amount_received: 'amount_received',
  petty_cash_utilization: 'petty_cash_utilization',
};

const TX_LABELS = {
  salary: 'Salary',
  petty_cash: 'Petty Cash',
  vendor_payment: 'Vendor Payment',
  bank_transaction: 'Bank Transaction',
  amount_received: 'Amount Received',
  petty_cash_utilization: 'Petty Cash Utilization',
};

const VALID_TX_TYPES = Object.keys(TX_TABLES);

async function projectExists(res, projectId) {
  const { rows } = await pool.query('SELECT id, name, project_cost_value FROM projects WHERE id=$1', [projectId]);
  if (rows.length === 0) return null;
  return rows[0];
}

function parseAmount(v) {
  const n = parseFloat(v);
  return isNaN(n) || n < 0 ? null : n;
}

// Part 3: project-scoping for PM — a manager may only access finance data for
// projects they are explicitly assigned to (project_managers table).
// This is enforced server-side, not just hidden in the UI.
async function assertManagerProjectAccess(projectId, user, res) {
  if (user.role !== 'manager') return true;
  const { rows } = await pool.query(
    'SELECT 1 FROM project_managers WHERE project_id=$1 AND user_id=$2',
    [projectId, user.id]
  );
  if (rows.length === 0) {
    res.status(403).json({ error: 'Access denied: you are not assigned to this project' });
    return false;
  }
  return true;
}

// GET /summary — project_cost_value, actual_cost, balance_received, profit_loss, percent_utilized
// PM: limited summary (salaries + petty cash only, no vendor breakdown)
router.get('/summary', authenticate, async (req, res) => {
  try {
const isFull = FULL_ACCESS.includes(req.user.role);
    const isPM = PM_ACCESS.includes(req.user.role);
    if (!isFull && !isPM) return res.status(403).json({ error: 'Insufficient permissions' });
    if (!(await assertManagerProjectAccess(req.params.projectId, req.user, res))) return;

    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const salaryQ = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::float as total FROM salaries WHERE project_id=$1 AND status<>'deleted'`,
      [req.params.projectId]
    );
    const pettyQ = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::float as total FROM petty_cash WHERE project_id=$1 AND status<>'deleted'`,
      [req.params.projectId]
    );
    // "Utilized" = what has actually been spent out of each disbursement
    // (partial spends over time). Profit/Loss reflects utilized, not disbursed.
    const pettyUtilQ = await pool.query(
      `SELECT COALESCE(SUM(pu.amount), 0)::float as total
       FROM petty_cash_utilization pu
       JOIN petty_cash p ON p.id = pu.petty_cash_id
       WHERE p.project_id=$1 AND pu.status<>'deleted' AND p.status<>'deleted'`,
      [req.params.projectId]
    );
    const vendorQ = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::float as total FROM vendor_payments WHERE project_id=$1 AND status<>'deleted'`,
      [req.params.projectId]
    );
    const receivedQ = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::float as total FROM amount_received WHERE project_id=$1 AND status<>'deleted'`,
      [req.params.projectId]
    );

    const salariesTotal = parseFloat(salaryQ.rows[0].total) || 0;
    const pettyCashTotal = parseFloat(pettyQ.rows[0].total) || 0;
    const pettyCashUtilized = parseFloat(pettyUtilQ.rows[0].total) || 0;
    const vendorPaymentsTotal = parseFloat(vendorQ.rows[0].total) || 0;
    const amountReceivedTotal = parseFloat(receivedQ.rows[0].total) || 0;

    const vendorIncluded = isFull;
    const actualCost = salariesTotal + pettyCashUtilized + (vendorIncluded ? vendorPaymentsTotal : 0);
    const projectCostValue = parseFloat(project.project_cost_value) || 0;
    const balanceReceived = amountReceivedTotal - actualCost;
    const profitLoss = projectCostValue - actualCost;
    const percentUtilized = projectCostValue > 0 ? (actualCost / projectCostValue) * 100 : 0;

    const payload = {
      project_cost_value: projectCostValue,
      actual_cost: actualCost,
      balance_received: balanceReceived,
      profit_loss: profitLoss,
      amount_received_total: amountReceivedTotal,
      percent_utilized: Math.round(percentUtilized * 100) / 100,
      salaries_total: salariesTotal,
      petty_cash_total: pettyCashTotal,
      petty_cash_utilized_total: pettyCashUtilized,
      petty_cash_remaining: Math.max(0, Math.round((pettyCashTotal - pettyCashUtilized) * 100) / 100),
      petty_cash_utilization_rate: pettyCashTotal > 0 ? Math.round((pettyCashUtilized / pettyCashTotal) * 10000) / 100 : 0,
    };
    if (vendorIncluded) payload.vendor_payments_total = vendorPaymentsTotal;

    res.json(payload);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ============ SALARIES ============

router.get('/salaries', authenticate, async (req, res) => {
  try {
    if (!FULL_ACCESS.includes(req.user.role) && !PM_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'Insufficient permissions' });
    if (!(await assertManagerProjectAccess(req.params.projectId, req.user, res))) return;
    const { rows } = await pool.query(
      `SELECT s.*, u.full_name as created_by_name
       FROM salaries s LEFT JOIN users u ON s.created_by = u.id
       WHERE s.project_id=$1 ORDER BY s.month DESC, s.created_at DESC`,
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/salaries', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
    const { employee_name, amount, month, bank_id } = req.body;
    if (!employee_name) return res.status(400).json({ error: 'Employee name required' });
    if (!month) return res.status(400).json({ error: 'Month required' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount required' });
    if (!bank_id) return res.status(400).json({ error: 'Bank is required' });
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { rows: bankQ } = await pool.query('SELECT id FROM banks WHERE id=$1', [bank_id]);
    if (bankQ.length === 0) return res.status(400).json({ error: 'Bank not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO salaries (project_id, employee_name, amount, month, bank_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.projectId, employee_name, amt, month, bank_id, req.user.id]
      );
      // Auto-link: salary paid from the selected bank account
      await client.query(
        `INSERT INTO bank_transactions (bank_id, date, payee_name, amount_out, created_by, source_type, source_ref, source_party)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [bank_id, month, employee_name, amt, req.user.id, 'salary', rows[0].id, employee_name]
      );
      await client.query('COMMIT');
      await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'salary', rows[0].id,
        `Created salary record: ${employee_name} - PKR ${amt} for ${project.name}`);
      await addActivity(req.user.full_name, 'created', `Added salary for ${employee_name} on project: ${project.name}`, 'salary', rows[0].id);
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ============ PETTY CASH ============

router.get('/petty-cash', authenticate, async (req, res) => {
  try {
    if (!FULL_ACCESS.includes(req.user.role) && !PM_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'Insufficient permissions' });
    if (!(await assertManagerProjectAccess(req.params.projectId, req.user, res))) return;
    const { rows } = await pool.query(
      `SELECT p.*, u.full_name as created_by_name,
              COALESCE(ut.used, 0)::float as utilized,
              COALESCE(p.amount, 0) - COALESCE(ut.used, 0) as remaining
       FROM petty_cash p
       LEFT JOIN users u ON p.created_by = u.id
       LEFT JOIN (
         SELECT petty_cash_id, SUM(amount)::float AS used
         FROM petty_cash_utilization WHERE status <> 'deleted'
         GROUP BY petty_cash_id
       ) ut ON ut.petty_cash_id = p.id
       WHERE p.project_id=$1 ORDER BY p.week_of DESC, p.created_at DESC`,
      [req.params.projectId]
    );
    res.json(rows.map(r => ({
      ...r,
      utilized: parseFloat(r.utilized) || 0,
      remaining: Math.max(0, Math.round((parseFloat(r.amount) - (parseFloat(r.utilized) || 0)) * 100) / 100),
      utilization_rate: parseFloat(r.amount) > 0 ? Math.round((parseFloat(r.utilized) / parseFloat(r.amount)) * 10000) / 100 : 0,
    })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/petty-cash', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
    const { description, amount, week_of, bank_id } = req.body;
    if (!description) return res.status(400).json({ error: 'Description required' });
    if (!week_of) return res.status(400).json({ error: 'Week date required' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount required' });
    if (!bank_id) return res.status(400).json({ error: 'Bank is required' });
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { rows: bankQ } = await pool.query('SELECT id FROM banks WHERE id=$1', [bank_id]);
    if (bankQ.length === 0) return res.status(400).json({ error: 'Bank not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO petty_cash (project_id, description, amount, week_of, bank_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.projectId, description, amt, week_of, bank_id, req.user.id]
      );
      // Auto-link: petty cash spent from the selected bank account
      await client.query(
        `INSERT INTO bank_transactions (bank_id, date, payee_name, amount_out, created_by, source_type, source_ref, source_party)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [bank_id, week_of, description, amt, req.user.id, 'petty_cash', rows[0].id, description]
      );
      await client.query('COMMIT');
      await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'petty_cash', rows[0].id,
        `Created petty cash record: ${description} - PKR ${amt} on ${project.name}`);
      await addActivity(req.user.full_name, 'created', `Added petty cash: ${description} on project: ${project.name}`, 'petty_cash', rows[0].id);
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ============ PETTY CASH UTILIZATION (partial-spend breakdown) ============
// RBAC mirrors petty cash: view = Owner/Admin/Finance/PM; add = Owner/Admin/Finance.
// Deletion reuses the existing Admin->Owner two-step deletion_requests flow
// (transaction_type='petty_cash_utilization').

// Project-wide utilization breakdown with filters: ?category= &from= &to=
router.get('/petty-cash/utilizations', authenticate, async (req, res) => {
  try {
    if (!FULL_ACCESS.includes(req.user.role) && !PM_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'Insufficient permissions' });
    if (!(await assertManagerProjectAccess(req.params.projectId, req.user, res))) return;
    const { category, from, to } = req.query;
    let sql = `SELECT pu.*, u.full_name as created_by_name,
                      p.id as petty_cash_id, p.description as petty_cash_description,
                      p.amount as petty_cash_amount, p.status as petty_cash_status, p.week_of
               FROM petty_cash_utilization pu
               LEFT JOIN users u ON pu.created_by = u.id
               JOIN petty_cash p ON p.id = pu.petty_cash_id
               WHERE p.project_id=$1`;
    const params = [req.params.projectId];
    let idx = 2;
    if (category) { sql += ` AND pu.category = $${idx}`; params.push(category); idx++; }
    if (from) { sql += ` AND pu.utilization_date >= $${idx}`; params.push(from); idx++; }
    if (to) { sql += ` AND pu.utilization_date <= $${idx}`; params.push(to); idx++; }
    sql += ' ORDER BY pu.utilization_date DESC, pu.created_at DESC';
    const { rows } = await pool.query(sql, params);

    // Running balance per disbursement (chronological), matching the ledger style
    const byDisbursement = {};
    rows.forEach(r => {
      if (!byDisbursement[r.petty_cash_id] && r.status !== 'deleted') byDisbursement[r.petty_cash_id] = 0;
    });
    const balanced = rows.slice().sort((a, b) =>
      (a.utilization_date + a.created_at).localeCompare(b.utilization_date + b.created_at));
    balanced.forEach(r => {
      if (r.status === 'deleted') { r.running_remaining = null; return; }
      const used = (byDisbursement[r.petty_cash_id] || 0) + (parseFloat(r.amount) || 0);
      byDisbursement[r.petty_cash_id] = used;
      const remaining = Math.round((parseFloat(r.petty_cash_amount) - used) * 100) / 100;
      r.running_remaining = Math.max(0, remaining);
    });

    res.json({
      total_utilized: Math.round(rows.filter(r => r.status !== 'deleted').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0) * 100) / 100,
      count: rows.length,
      entries: rows,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Utilization entries for a single disbursement (with running balance)
router.get('/petty-cash/:id/utilizations', authenticate, async (req, res) => {
  try {
    if (!FULL_ACCESS.includes(req.user.role) && !PM_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'Insufficient permissions' });
    if (!(await assertManagerProjectAccess(req.params.projectId, req.user, res))) return;
    const { rows: pc } = await pool.query(
      'SELECT * FROM petty_cash WHERE id=$1 AND project_id=$2',
      [req.params.id, req.params.projectId]
    );
    if (pc.length === 0) return res.status(404).json({ error: 'Petty cash entry not found' });

    const { rows } = await pool.query(
      `SELECT pu.*, u.full_name as created_by_name
       FROM petty_cash_utilization pu LEFT JOIN users u ON pu.created_by = u.id
       WHERE pu.petty_cash_id=$1 ORDER BY pu.utilization_date ASC, pu.created_at ASC`,
      [req.params.id]
    );

    let used = 0;
    const entries = rows.map(r => {
      if (r.status === 'deleted') return { ...r, running_remaining: null };
      used = Math.round((used + parseFloat(r.amount)) * 100) / 100;
      return { ...r, running_remaining: Math.max(0, Math.round((parseFloat(pc[0].amount) - used) * 100) / 100) };
    });

    res.json({
      petty_cash: { ...pc[0], utilized: used, remaining: Math.max(0, Math.round((parseFloat(pc[0].amount) - used) * 100) / 100) },
      entries,
      total_utilized: used,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Add a utilization entry — locked rows prevent a concurrent add from
// overspending the disbursement (race-condition safe).
router.post('/petty-cash/:id/utilizations', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
const { utilization_date, date, category, amount, note, receipt_ref } = req.body;
    const useDate = utilization_date || date;
    if (!useDate) return res.status(400).json({ error: 'Utilization date required' });
    if (!category || !String(category).trim()) return res.status(400).json({ error: 'Category required' });
    const amt = parseAmount(amount);
    if (amt === null || amt === 0) return res.status(400).json({ error: 'Valid amount (> 0) required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: pc } = await client.query(
        'SELECT * FROM petty_cash WHERE id=$1 AND project_id=$2 FOR UPDATE',
        [req.params.id, req.params.projectId]
      );
      if (pc.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Petty cash entry not found' });
      }
      if (pc[0].status !== 'active')
        return res.status(400).json({ error: 'Cannot add utilization while the disbursement is not active (pending deletion/deleted)' });

      const { rows: usedRows } = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS used FROM petty_cash_utilization
         WHERE petty_cash_id=$1 AND status<>'deleted'`,
        [req.params.id]
      );
      const used = parseFloat(usedRows[0].used) || 0;
      const disbursed = parseFloat(pc[0].amount) || 0;
      if (used + amt > disbursed + 0.0001)
        return res.status(400).json({ error: `Utilization exceeds disbursement. Remaining: PKR ${Math.max(0, Math.round((disbursed - used) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}` });

const { rows } = await client.query(
        `INSERT INTO petty_cash_utilization (petty_cash_id, utilization_date, category, amount, note, receipt_ref, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.params.id, useDate, String(category).trim(), amt, note || null, receipt_ref || null, req.user.id]
      );
      await client.query('COMMIT');
      await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'petty_cash_utilization', rows[0].id,
        `Added utilization PKR ${amt} (${category}) on petty cash: ${pc[0].description}`);
      await addActivity(req.user.full_name, 'created',
        `Added utilization PKR ${amt} (${category}) to petty cash: ${pc[0].description}`, 'petty_cash_utilization', rows[0].id);
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ============ VENDOR PAYMENTS ============

router.get('/vendor-payments', authenticate, async (req, res) => {
  try {
    if (!FULL_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'Vendor payment data is restricted' });
    const { rows } = await pool.query(
      `SELECT vp.*, v.name as vendor_name, p.name as project_name, u.full_name as created_by_name
       FROM vendor_payments vp
       LEFT JOIN vendors v ON vp.vendor_id = v.id
       LEFT JOIN projects p ON vp.project_id = p.id
       LEFT JOIN users u ON vp.created_by = u.id
       WHERE vp.project_id=$1 ORDER BY vp.payment_date DESC, vp.created_at DESC`,
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/vendor-payments', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
    const { vendor_id, payment_type, amount, po_id, bill_number, ipc_percent_complete, payment_date, bank_id } = req.body;
    if (!vendor_id) return res.status(400).json({ error: 'Vendor required' });
    if (!payment_type || !['fixed_otp', 'continuous', 'ipc'].includes(payment_type))
      return res.status(400).json({ error: 'Valid payment type required' });
    if (!payment_date) return res.status(400).json({ error: 'Payment date required' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount required' });
    if (!bank_id) return res.status(400).json({ error: 'Bank is required' });
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const vendorQ = await pool.query('SELECT id, name FROM vendors WHERE id=$1', [vendor_id]);
    if (vendorQ.rows.length === 0) return res.status(400).json({ error: 'Vendor not found' });
    const { rows: bankQ } = await pool.query('SELECT id FROM banks WHERE id=$1', [bank_id]);
    if (bankQ.length === 0) return res.status(400).json({ error: 'Bank not found' });

    let ipcPct = null;
    if (payment_type === 'ipc') {
      const pct = parseFloat(ipc_percent_complete);
      if (isNaN(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'Valid IPC % complete (0-100) required' });
      ipcPct = pct;
    }

    // PO linkage: 'continuous' payments must reference a PO from the purchase_orders table.
    // Only FULLY approved POs (Admin -> Owner two-step complete) are payable —
    // a PO awaiting either approval must stay OUT of vendor payments.
    // 'fixed_otp'/'ipc' payments are never linked to a PO — any PO fields are normalized away.
    let poId = null;
    let poNumber = null;
    let billNo = null;
    if (payment_type === 'continuous') {
      if (!po_id) return res.status(400).json({ error: 'PO selection required for continuous payments' });
      const poQ = await pool.query(
        `SELECT id, po_number, total_amount, status, admin_approval, owner_approval
         FROM purchase_orders WHERE id=$1 AND vendor_id=$2`,
        [po_id, vendor_id]
      );
      if (poQ.rows.length === 0) return res.status(400).json({ error: 'Selected PO not found for this vendor' });
      const poRow = poQ.rows[0];
      if (poRow.status === 'cancelled') return res.status(400).json({ error: 'Cannot link payment to a cancelled PO' });
      if (poRow.status !== 'approved' || poRow.admin_approval !== 'approved' || poRow.owner_approval !== 'approved')
        return res.status(400).json({ error: 'Only fully approved POs (Admin and Owner) can be linked to continuous payments' });
      poId = po_id;
      poNumber = poRow.po_number;
      billNo = bill_number || null;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO vendor_payments (project_id, vendor_id, payment_type, amount, po_id, po_number, bill_number, ipc_percent_complete, payment_date, bank_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.params.projectId, vendor_id, payment_type, amt, poId, poNumber, billNo, ipcPct, payment_date, bank_id, req.user.id]
      );
      // Auto-link: vendor payment debited from the selected bank account
      await client.query(
        `INSERT INTO bank_transactions (bank_id, date, payee_name, cheque_no, amount_out, created_by, source_type, source_ref, source_party)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [bank_id, payment_date, vendorQ.rows[0].name, billNo || poNumber, amt, req.user.id, 'vendor_payment', rows[0].id, vendorQ.rows[0].name]
      );
      await client.query('COMMIT');
      await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'vendor_payment', rows[0].id,
        `Created vendor payment: ${vendorQ.rows[0].name} - PKR ${amt} on ${project.name}`);
      await addActivity(req.user.full_name, 'created', `Added vendor payment for ${vendorQ.rows[0].name} on project: ${project.name}`, 'vendor_payment', rows[0].id);
      res.status(201).json({ ...rows[0], vendor_name: vendorQ.rows[0].name });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ============ AMOUNT RECEIVED ============

router.get('/amount-received', authenticate, async (req, res) => {
  try {
    if (!FULL_ACCESS.includes(req.user.role) && !PM_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'Insufficient permissions' });
    if (!(await assertManagerProjectAccess(req.params.projectId, req.user, res))) return;
    const { rows } = await pool.query(
      `SELECT ar.*, u.full_name as created_by_name
       FROM amount_received ar LEFT JOIN users u ON ar.created_by = u.id
       WHERE ar.project_id=$1 ORDER BY ar.received_date DESC, ar.created_at DESC`,
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/amount-received', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
    const { amount, received_date, description, bank_id, received_from } = req.body;
    if (!received_date) return res.status(400).json({ error: 'Received date required' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount required' });
    if (!bank_id) return res.status(400).json({ error: 'Bank is required' });
    if (!received_from || !String(received_from).trim()) return res.status(400).json({ error: 'Received from (client/party) is required' });
    const party = String(received_from).trim();
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { rows: bankQ } = await pool.query('SELECT id FROM banks WHERE id=$1', [bank_id]);
    if (bankQ.length === 0) return res.status(400).json({ error: 'Bank not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO amount_received (project_id, amount, received_date, description, bank_id, received_from, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.params.projectId, amt, received_date, description || null, bank_id, party, req.user.id]
      );
      // Auto-link: amount received credited into the selected bank account
      await client.query(
        `INSERT INTO bank_transactions (bank_id, date, payee_name, amount_in, created_by, source_type, source_ref, source_party)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [bank_id, received_date, party, amt, req.user.id, 'amount_received', rows[0].id, party]
      );
      await client.query('COMMIT');
      await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'amount_received', rows[0].id,
        `Created amount received record: PKR ${amt} on ${project.name}`);
      await addActivity(req.user.full_name, 'created', `Recorded payment received: PKR ${amt} on project: ${project.name}`, 'amount_received', rows[0].id);
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ============ DELETION REQUESTS ============

// POST /deletion-requests — body: { transaction_type, transaction_id, reason }
router.post('/deletion-requests', authenticate, async (req, res) => {
  try {
    const { transaction_type, transaction_id, reason } = req.body;
    if (!VALID_TX_TYPES.includes(transaction_type))
      return res.status(400).json({ error: 'Invalid transaction type' });
    if (!transaction_id) return res.status(400).json({ error: 'Transaction id required' });

    // PM can only request deletion of salary/petty_cash; Owner/Admin/Finance can request all types
    const canRequest = FULL_ACCESS.includes(req.user.role)
      || (PM_ACCESS.includes(req.user.role) && ['salary', 'petty_cash'].includes(transaction_type));
    if (!canRequest) return res.status(403).json({ error: 'You cannot request deletion of this transaction type' });
    if (!(await assertManagerProjectAccess(req.params.projectId, req.user, res))) return;

    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const table = TX_TABLES[transaction_type];
    let tx;
    if (transaction_type === 'petty_cash_utilization') {
      const { rows } = await pool.query(
        `SELECT pu.*, p.project_id
         FROM petty_cash_utilization pu JOIN petty_cash p ON p.id = pu.petty_cash_id
         WHERE pu.id=$1 AND p.project_id=$2`,
        [transaction_id, req.params.projectId]
      );
      tx = rows;
    } else {
      const { rows } = await pool.query(
        `SELECT * FROM ${table} WHERE id=$1 AND project_id=$2`,
        [transaction_id, req.params.projectId]
      );
      tx = rows;
    }
    if (tx.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    if (tx[0].status !== 'active')
      return res.status(400).json({ error: 'Only active transactions can be requested for deletion' });

    // A utilization entry under a disbursement that is itself being deleted
    // cannot be deleted separately — the parent is already locked.
    if (transaction_type === 'petty_cash_utilization') {
      const { rows: parent } = await pool.query(
        'SELECT status FROM petty_cash WHERE id=$1', [tx[0].petty_cash_id]
      );
      if (parent.length === 0 || parent[0].status !== 'active')
        return res.status(400).json({ error: 'The parent petty cash disbursement is not active — utilization cannot be deleted separately' });
    }

    const { rows } = await pool.query(
      `INSERT INTO deletion_requests (transaction_type, transaction_id, project_id, requested_by, reason, snapshot_data)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [transaction_type, transaction_id, req.params.projectId, req.user.id, reason || null, JSON.stringify(tx[0])]
    );
    const { rowCount } = await pool.query(
      `UPDATE ${table} SET status='deletion_requested' WHERE id=$1 AND status='active'`,
      [transaction_id]
    );
    if (rowCount === 0) {
      await pool.query('DELETE FROM deletion_requests WHERE id=$1', [rows[0].id]);
      return res.status(400).json({ error: 'Transaction is no longer active' });
    }

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'requested', 'deletion_request', rows[0].id,
      `Deletion requested for ${TX_LABELS[transaction_type]} on project: ${project.name}${reason ? ` - ${reason}` : ''}`);
    await addActivity(req.user.full_name, 'requested', `Deletion requested for ${TX_LABELS[transaction_type]} on project: ${project.name}`, 'deletion_request', rows[0].id);
    await notifyRoles(APPROVERS, 'deletion_request',
      `Deletion requested: ${TX_LABELS[transaction_type]}`,
      `${req.user.full_name} requested deletion of ${TX_LABELS[transaction_type]} on ${project.name}`,
      `/projects?project=${req.params.projectId}&tab=finance`, 'deletion_request', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// GET /deletion-requests — Owner/Admin only
router.get('/deletion-requests', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dr.*,
         ru.full_name as requested_by_name,
         au.full_name as admin_approved_by_name,
         ou.full_name as owner_approved_by_name,
         p.name as project_name
       FROM deletion_requests dr
       LEFT JOIN users ru ON dr.requested_by = ru.id
       LEFT JOIN users au ON dr.admin_approved_by = au.id
       LEFT JOIN users ou ON dr.owner_approved_by = ou.id
       LEFT JOIN projects p ON dr.project_id = p.id
       WHERE dr.project_id=$1
       ORDER BY dr.created_at DESC`,
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Evaluate and finalize a deletion request after any approval action.
// If both approvals become 'approved' -> final 'approved', transaction status 'deleted'.
// If either is 'rejected' -> final 'rejected', transaction status back to 'active'.
async function finalizeDeletionRequest(client, deletionRequest) {
  let finalStatus = 'pending';
  if (deletionRequest.admin_approval === 'rejected' || deletionRequest.owner_approval === 'rejected') {
    finalStatus = 'rejected';
  } else if (deletionRequest.admin_approval === 'approved' && deletionRequest.owner_approval === 'approved') {
    finalStatus = 'approved';
  }

  if (finalStatus !== 'pending') {
    const table = TX_TABLES[deletionRequest.transaction_type];
    const txStatus = finalStatus === 'approved' ? 'deleted' : 'active';
    await client.query(`UPDATE ${table} SET status=$1 WHERE id=$2`, [txStatus, deletionRequest.transaction_id]);
    // Auto-linked bank book entry (when the finance entry is deleted, the
    // paired bank transaction is deleted too — no orphaned records).
    if (finalStatus === 'approved' && ['vendor_payment', 'salary', 'petty_cash', 'amount_received'].includes(deletionRequest.transaction_type)) {
      await client.query(
        `UPDATE bank_transactions SET status='deleted' WHERE source_type=$1 AND source_ref=$2 AND status<>'deleted'`,
        [deletionRequest.transaction_type, deletionRequest.transaction_id]
      );
    }
  }
  return finalStatus;
}

async function applyApproval(req, res, level, projectId = undefined) {
  const { id } = req.params;
  const { approve } = req.body;
  if (typeof approve !== 'boolean') return res.status(400).json({ error: 'approve must be true or false' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: reqRows } = projectId
      ? await client.query(
          'SELECT * FROM deletion_requests WHERE id=$1 AND project_id=$2 FOR UPDATE',
          [id, projectId]
        )
      : await client.query(
          'SELECT * FROM deletion_requests WHERE id=$1 FOR UPDATE',
          [id]
        );
    if (reqRows.length === 0) return res.status(404).json({ error: 'Deletion request not found' });
    const dreq = reqRows[0];

    if (dreq.final_status !== 'pending')
      return res.status(400).json({ error: 'This request has already been finalized' });

    const levelKey = level === 'admin' ? 'admin_approval' : 'owner_approval';
    if (dreq[levelKey] !== 'pending')
      return res.status(400).json({ error: `${level === 'admin' ? 'Admin' : 'Owner'} approval already submitted for this request` });

    // Sequential order is enforced server-side: the Owner can only act AFTER
    // the Admin has approved. An early Owner action is rejected, not queued.
    if (level === 'owner' && dreq.admin_approval !== 'approved')
      return res.status(400).json({ error: 'Owner cannot approve before the Admin has approved this request' });

    const decision = approve ? 'approved' : 'rejected';
    const newDreq = {
      ...dreq,
      [levelKey]: decision,
      [level === 'admin' ? 'admin_approved_by' : 'owner_approved_by']: req.user.id,
      [level === 'admin' ? 'admin_approved_at' : 'owner_approved_at']: new Date(),
    };

    const finalStatus = await finalizeDeletionRequest(client, newDreq);
    newDreq.final_status = finalStatus;

    const { rows } = await client.query(
      `UPDATE deletion_requests SET
         admin_approval=$1, admin_approved_by=$2, admin_approved_at=$3,
         owner_approval=$4, owner_approved_by=$5, owner_approved_at=$6,
         final_status=$7
       WHERE id=$8 RETURNING *`,
      [
        newDreq.admin_approval, newDreq.admin_approved_by, newDreq.admin_approved_at,
        newDreq.owner_approval, newDreq.owner_approved_by, newDreq.owner_approved_at,
        finalStatus, id
      ]
    );

    await client.query('COMMIT');

    const label = TX_LABELS[dreq.transaction_type] || dreq.transaction_type;
    const actionWord = decision === 'approved' ? 'approved' : 'rejected';
    await logAudit(req.user.id, req.user.full_name, req.user.role, `${level}_approve`, 'deletion_request', id,
      `${level === 'admin' ? 'Admin' : 'Owner'} ${actionWord} deletion of ${label} (final status: ${finalStatus})`);
    await addActivity(req.user.full_name, `${level}_approve`, `${level === 'admin' ? 'Admin' : 'Owner'} ${actionWord} deletion of ${label}`, 'deletion_request', id);
    if (finalStatus !== 'pending') {
      const link = dreq.project_id
        ? `/projects?project=${dreq.project_id}&tab=finance`
        : '/bankbook';
      await createNotification(dreq.requested_by, 'deletion_request',
        `Deletion request ${finalStatus}`,
        `Your deletion request for ${label} was ${finalStatus} by ${req.user.full_name}`,
        link, 'deletion_request', id);
    }
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

// PATCH /deletion-requests/:id/admin-approve — Admin, Owner only (first-level approval)
router.patch('/deletion-requests/:id/admin-approve', authenticate, authorize('owner', 'admin'), (req, res) => {
  return applyApproval(req, res, 'admin', req.params.projectId);
});

// PATCH /deletion-requests/:id/owner-approve — Owner only (final approval)
router.patch('/deletion-requests/:id/owner-approve', authenticate, authorize('owner'), (req, res) => {
  return applyApproval(req, res, 'owner', req.params.projectId);
});

// ============ GLOBAL ROUTES (mounted separately at /api/finance) ============

// GET /api/finance/deletion-requests — open (not finalized) deletion requests across all projects, for the notification bell
const globalRouter = express.Router();

globalRouter.get('/deletion-requests', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dr.id, dr.transaction_type, dr.transaction_id, dr.project_id, dr.reason,
              dr.admin_approval, dr.admin_approved_by, dr.admin_approved_at,
              dr.owner_approval, dr.owner_approved_by, dr.owner_approved_at,
              dr.final_status, dr.snapshot_data, dr.created_at,
              ru.full_name as requested_by_name, p.name as project_name
       FROM deletion_requests dr
       LEFT JOIN users ru ON dr.requested_by = ru.id
       LEFT JOIN projects p ON dr.project_id = p.id
       WHERE dr.final_status = 'pending'
       ORDER BY dr.created_at DESC`
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/finance/deletion-requests — global-level deletion request (bank transactions only)
globalRouter.post('/deletion-requests', authenticate, async (req, res) => {
  try {
    const { transaction_type, transaction_id, reason } = req.body;
    if (transaction_type !== 'bank_transaction')
      return res.status(400).json({ error: 'Only bank transactions can be requested at global scope' });
    if (!transaction_id) return res.status(400).json({ error: 'Transaction id required' });
    if (!FULL_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'You cannot request deletion of this transaction type' });

    const { rows: tx } = await pool.query(
      'SELECT * FROM bank_transactions WHERE id=$1',
      [transaction_id]
    );
if (tx.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    if (tx[0].status !== 'active')
      return res.status(400).json({ error: 'Only active transactions can be requested for deletion' });
    if (!tx[0].project_id && transaction_type !== 'petty_cash_utilization')
      return res.status(400).json({ error: 'Transaction does not belong to this project' });

    const { rows } = await pool.query(
      `INSERT INTO deletion_requests (transaction_type, transaction_id, project_id, requested_by, reason, snapshot_data)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [transaction_type, transaction_id, req.params.projectId, req.user.id, reason || null, JSON.stringify(tx[0])]
    );
    const { rowCount } = await pool.query(
      `UPDATE bank_transactions SET status='deletion_requested' WHERE id=$1 AND status='active'`,
      [transaction_id]
    );
    if (rowCount === 0) {
      await pool.query('DELETE FROM deletion_requests WHERE id=$1', [rows[0].id]);
      return res.status(400).json({ error: 'Transaction is no longer active' });
    }

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'requested', 'deletion_request', rows[0].id,
      `Deletion requested for Bank Transaction${reason ? ` - ${reason}` : ''}`);
    await addActivity(req.user.full_name, 'requested', `Deletion requested for a Bank Transaction`, 'deletion_request', rows[0].id);
    await notifyRoles(APPROVERS, 'deletion_request',
      `Deletion requested: Bank Transaction`,
      `${req.user.full_name} requested deletion of a bank transaction`,
      '/bankbook', 'deletion_request', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/finance/deletion-requests/:id/admin-approve — global (projectless) approval
globalRouter.patch('/deletion-requests/:id/admin-approve', authenticate, authorize('owner', 'admin'), (req, res) => {
  return applyApproval(req, res, 'admin');
});

// PATCH /api/finance/deletion-requests/:id/owner-approve — Owner only
globalRouter.patch('/deletion-requests/:id/owner-approve', authenticate, authorize('owner'), (req, res) => {
  return applyApproval(req, res, 'owner');
});

// GET /api/finance/vendor-overview?vendor_id=... — POs + payments + running totals (Owner/Admin/Finance)
globalRouter.get('/vendor-overview', authenticate, async (req, res) => {
  try {
    if (!FULL_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'Vendor payment data is restricted' });
    const { vendor_id } = req.query;
    if (!vendor_id) return res.status(400).json({ error: 'vendor_id query parameter required' });

    const vendorQ = await pool.query('SELECT * FROM vendors WHERE id=$1', [vendor_id]);
    if (vendorQ.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });

    const pos = await pool.query(
      `SELECT po.*, p.name as project_name
       FROM purchase_orders po LEFT JOIN projects p ON po.project_id = p.id
       WHERE po.vendor_id=$1 ORDER BY po.created_at DESC`,
      [vendor_id]
    );
    const payments = await pool.query(
      `SELECT vp.*, v.name as vendor_name, p.name as project_name, u.full_name as created_by_name
       FROM vendor_payments vp
       LEFT JOIN vendors v ON vp.vendor_id = v.id
       LEFT JOIN projects p ON vp.project_id = p.id
       LEFT JOIN users u ON vp.created_by = u.id
       WHERE vp.vendor_id=$1 ORDER BY vp.payment_date DESC, vp.created_at DESC`,
      [vendor_id]
    );

    const activePos = pos.rows.filter((po) => po.status !== 'cancelled');
    const activePayments = payments.rows.filter((vp) => vp.status !== 'deleted');
    const totalPoValue = activePos.reduce((sum, po) => sum + (parseFloat(po.total_amount) || 0), 0);
    const totalPaid = activePayments.reduce((sum, vp) => sum + (parseFloat(vp.amount) || 0), 0);

    res.json({
      vendor: vendorQ.rows[0],
      purchase_orders: pos.rows,
      payments: payments.rows,
      total_po_value: totalPoValue,
      total_paid: totalPaid,
      balance: totalPoValue - totalPaid,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
module.exports.globalRouter = globalRouter;
