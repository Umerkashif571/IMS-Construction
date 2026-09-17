const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles, createNotification } = require('../db/helpers');
const { requireUuid, isUuid, dbError, isDate, maxLen } = require('../middleware/validate');
const { d, add, sub, mul, div, round2, toNumber, gt } = require('../utils/decimal');

// Safe wrapper for non-critical side effects (audit, activity, notifications)
async function safe(fn, label, ...args) {
  try {
    await fn(...args);
  } catch (err) {
    console.error(`Side effect ${label} failed:`, err?.message || err);
  }
}
function safeAudit(userId, userName, userRole, action, entityType, entityId, description, changes = null) {
  return safe(logAudit, 'logAudit', userId, userName, userRole, action, entityType, entityId, description, changes);
}
function safeActivity(userName, action, description, entityType, entityId = null) {
  return safe(addActivity, 'addActivity', userName, action, description, entityType, entityId);
}
function safeNotification(userId, type, title, message = null, link = null, entityType = null, entityId = null) {
  return safe(createNotification, 'createNotification', userId, type, title, message, link, entityType, entityId);
}
function safeNotifyRoles(roles, type, title, message = null, link = null, entityType = null, entityId = null) {
  return safe(notifyRoles, 'notifyRoles', roles, type, title, message, link, entityType, entityId);
}

const router = express.Router({ mergeParams: true });

// One-time migration endpoint to create missing indexes on production DB
// Protected by auth + secret token in header
router.post('/_migrate', authenticate, authorize('owner', 'admin'), async (req, res) => {
  const token = req.headers['x-migration-token'];
  const expectedToken = process.env.MIGRATION_TOKEN || 'run-migration-once';
  if (token !== expectedToken) return res.status(403).json({ error: 'Invalid migration token' });
  try {
    const results = [];
    // Create the composite index for material_transactions summary query
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_material_transactions_project_type_material
      ON material_transactions(project_id, type, material_id)
    `);
    results.push('idx_material_transactions_project_type_material created');
    // Also ensure other indexes exist
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_material_transactions_project_type
      ON material_transactions(project_id, type)
    `);
    results.push('idx_material_transactions_project_type ensured');
    
    // Covering index for summary query (index-only scan for project_id, type filter + quantity, unit_cost)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_material_transactions_project_type_cover
      ON material_transactions(project_id, type) INCLUDE (quantity, unit_cost)
    `);
    results.push('idx_material_transactions_project_type_cover created (covering index)');
    
    // Covering partial index for summary query (index-only scan for project_id filter + quantity, material_id)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_material_transactions_project_out_cover
      ON material_transactions(project_id) INCLUDE (quantity, material_id) WHERE type = 'out'
    `);
    results.push('idx_material_transactions_project_out_cover created (covering partial index)');
    
    // Add unit_cost column to material_transactions if missing (for fast summary query)
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='material_transactions' AND column_name='unit_cost'
        ) THEN
          ALTER TABLE material_transactions ADD COLUMN unit_cost DECIMAL(12,2) DEFAULT 0;
        END IF;
      END $$;
    `);
    results.push('unit_cost column added to material_transactions');
    
    // Backfill unit_cost for existing 'out' transactions from materials table
    await pool.query(`
      UPDATE material_transactions mt
      SET unit_cost = m.unit_cost
      FROM materials m
      WHERE mt.material_id = m.id
        AND mt.unit_cost IS NULL
        AND mt.type = 'out'
    `);
    results.push('unit_cost backfilled for existing out transactions');
    
    // Update statistics for query planner
    await pool.query('ANALYZE material_transactions');
    results.push('ANALYZE material_transactions completed');
    
    // Create materialized view for instant project material cost lookup
    await pool.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS project_material_cost_summary AS
      SELECT 
        mt.project_id,
        COALESCE(SUM(mt.quantity * m.unit_cost), 0)::float as total_material_cost
      FROM material_transactions mt
      JOIN materials m ON mt.material_id = m.id
      WHERE mt.type = 'out'
      GROUP BY mt.project_id
    `);
    results.push('project_material_cost_summary materialized view created');
    
    // Create unique index on the materialized view for fast lookups
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_material_cost_summary_project_id
      ON project_material_cost_summary(project_id)
    `);
    results.push('Unique index on materialized view created');
    
    // Drop trigger if exists (from previous migration runs)
    await pool.query(`
      DROP TRIGGER IF EXISTS trigger_refresh_material_cost_summary ON material_transactions;
    `).catch(() => {});
    results.push('Old trigger dropped if existed');
    
    // Create function to refresh the materialized view (manual only, not on every change)
    await pool.query(`
      DROP FUNCTION IF EXISTS refresh_project_material_cost_summary();
      CREATE OR REPLACE FUNCTION refresh_project_material_cost_summary()
      RETURNS VOID AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY project_material_cost_summary;
      END;
      $$ LANGUAGE plpgsql
    `);
    results.push('Refresh function recreated (manual only)');
    
    // Initial refresh
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY project_material_cost_summary');
    results.push('Materialized view initially refreshed');
    
    res.json({ success: true, results });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// :projectId comes from the parent mount path (mergeParams), so router.param() never fires for
// it — validate it up front. :id is declared by this router's own routes.
router.use((req, res, next) => {
  if (!isUuid(req.params.projectId)) return res.status(400).json({ error: 'Invalid id format' });
  next();
});
router.param('id', requireUuid);

// Thrown inside a transaction helper to produce a specific 4xx after ROLLBACK.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

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

// Strict money parser: finite, > 0, fits DECIMAL(15,2). Returns a Decimal (2dp) or null.
function parseAmount(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n >= 1e13) return null;
  return round2(d(v));
}
// Optional short text field: null when absent, error when not a string / too long.
function optText(v, max) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== 'string') return { error: 'must be text' };
  const t = v.trim();
  if (max && t.length > max) return { error: `too long (max ${max})` };
  return { value: t || null };
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

    // Run all independent aggregation queries in parallel
    const [
      salaryQ,
      pettyQ,
      pettyUtilQ,
      vendorQ,
      receivedQ,
      materialCostQ
    ] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::float as total FROM salaries WHERE project_id=$1 AND status<>'deleted'`,
        [req.params.projectId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::float as total FROM petty_cash WHERE project_id=$1 AND status<>'deleted'`,
        [req.params.projectId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(pu.amount), 0)::float as total
         FROM petty_cash_utilization pu
         JOIN petty_cash p ON p.id = pu.petty_cash_id
         WHERE p.project_id=$1 AND pu.status<>'deleted' AND p.status<>'deleted'`,
        [req.params.projectId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::float as total FROM vendor_payments WHERE project_id=$1 AND status<>'deleted'`,
        [req.params.projectId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::float as total FROM amount_received WHERE project_id=$1 AND status<>'deleted'`,
        [req.params.projectId]
      ),
      pool.query(
        `SELECT COALESCE((SELECT total_material_cost FROM project_material_cost_summary WHERE project_id=$1), 0)::float as total`,
        [req.params.projectId]
      )
    ]);

    const salariesTotal = toNumber(d(salaryQ.rows[0].total));
    const pettyCashTotal = toNumber(d(pettyQ.rows[0].total));
    const pettyCashUtilized = toNumber(d(pettyUtilQ.rows[0].total));
    const vendorPaymentsTotal = toNumber(d(vendorQ.rows[0].total));
    const amountReceivedTotal = toNumber(d(receivedQ.rows[0].total));
    const materialCostTotal = toNumber(d(materialCostQ.rows[0].total));

    const vendorIncluded = isFull;
    const pettyCashReceivedOnsite = pettyCashTotal;
    const actualCost = toNumber(
      add(
        add(add(d(salariesTotal), d(pettyCashReceivedOnsite)), d(materialCostTotal)),
        vendorIncluded ? d(vendorPaymentsTotal) : d(0)
      )
    );
    const projectCostValue = toNumber(d(project.project_cost_value));
    const balanceReceived = toNumber(sub(d(amountReceivedTotal), d(actualCost)));
    const profitLoss = toNumber(sub(d(projectCostValue), d(actualCost)));
    const percentUtilized = projectCostValue > 0 ? toNumber(mul(div(d(actualCost), d(projectCostValue)), d(100))) : 0;

    const payload = {
      project_cost_value: projectCostValue,
      actual_cost: actualCost,
      balance_received: balanceReceived,
      profit_loss: profitLoss,
      amount_received_total: amountReceivedTotal,
      percent_utilized: toNumber(round2(d(percentUtilized))),
      salaries_total: salariesTotal,
      petty_cash_total: pettyCashTotal,
      petty_cash_utilized_total: pettyCashUtilized,
      petty_cash_received_onsite: pettyCashReceivedOnsite,
      petty_cash_remaining: toNumber(round2(sub(d(pettyCashTotal), d(pettyCashUtilized)))),
      petty_cash_utilization_rate: pettyCashTotal > 0 ? toNumber(round2(mul(div(d(pettyCashUtilized), d(pettyCashTotal)), d(100)))) : 0,
      material_cost_total: materialCostTotal,
    };
    if (vendorIncluded) payload.vendor_payments_total = vendorPaymentsTotal;

    res.json(payload);
  } catch (err) { return dbError(res, err); }
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
  } catch (err) { return dbError(res, err); }
});

router.post('/salaries', authenticate, authorize(...FULL_ACCESS), async (req, res) => {
  try {
    const { employee_name, amount, month, bank_id } = req.body;
    if (!employee_name || typeof employee_name !== 'string' || !employee_name.trim()) return res.status(400).json({ error: 'Employee name required' });
    if (!maxLen(employee_name, 255)) return res.status(400).json({ error: 'Employee name too long (max 255)' });
    if (!month) return res.status(400).json({ error: 'Month required' });
    if (!isDate(month)) return res.status(400).json({ error: 'Invalid month date' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount (> 0) required' });
    if (!bank_id) return res.status(400).json({ error: 'Bank is required' });
    if (!isUuid(bank_id)) return res.status(400).json({ error: 'Invalid bank id' });
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { rows: bankQ } = await pool.query('SELECT id FROM banks WHERE id=$1', [bank_id]);
    if (bankQ.length === 0) return res.status(400).json({ error: 'Bank not found' });
    const name = employee_name.trim();

    const client = await pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      const amtValue = amt.toFixed(2);
      const { rows } = await client.query(
        `INSERT INTO salaries (project_id, employee_name, amount, month, bank_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.projectId, name, amtValue, month, bank_id, req.user.id]
      );
      // Auto-link: salary paid from the selected bank account
      await client.query(
        `INSERT INTO bank_transactions (bank_id, date, payee_name, amount_out, created_by, source_type, source_ref, source_party)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [bank_id, month, name, amtValue, req.user.id, 'salary', rows[0].id, name]
      );
      await client.query('COMMIT');
      client.release(); released = true;
      await safeAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'salary', rows[0].id,
        `Created salary record: ${name} - PKR ${amtValue} for ${project.name}`);
      await safeActivity(req.user.full_name, 'created', `Added salary for ${name} on project: ${project.name}`, 'salary', rows[0].id);
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
      throw err;
    } finally {
      if (!released) client.release();
    }
  } catch (err) { return dbError(res, err); }
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
      utilized: toNumber(d(r.utilized)),
      received_onsite: toNumber(d(r.amount)), // amount = disbursed/received onsite
      remaining: toNumber(round2(sub(d(r.amount), d(r.utilized)))),
      utilization_rate: gt(d(r.amount), 0) ? toNumber(round2(mul(div(d(r.utilized), d(r.amount)), d(100)))) : 0,
    })));
  } catch (err) { return dbError(res, err); }
});

router.post('/petty-cash', authenticate, authorize(...FULL_ACCESS), async (req, res) => {
  try {
    const { description, amount, week_of, bank_id } = req.body;
    if (!description || typeof description !== 'string' || !description.trim()) return res.status(400).json({ error: 'Description required' });
    if (!maxLen(description, 255)) return res.status(400).json({ error: 'Description too long (max 255)' });
    if (!week_of) return res.status(400).json({ error: 'Week date required' });
    if (!isDate(week_of)) return res.status(400).json({ error: 'Invalid week date' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount (> 0) required' });
    if (!bank_id) return res.status(400).json({ error: 'Bank is required' });
    if (!isUuid(bank_id)) return res.status(400).json({ error: 'Invalid bank id' });
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { rows: bankQ } = await pool.query('SELECT id FROM banks WHERE id=$1', [bank_id]);
    if (bankQ.length === 0) return res.status(400).json({ error: 'Bank not found' });
    const desc = description.trim();

    const client = await pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      const amtValue = amt.toFixed(2);
      const { rows } = await client.query(
        `INSERT INTO petty_cash (project_id, description, amount, week_of, bank_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.projectId, desc, amtValue, week_of, bank_id, req.user.id]
      );
      // Auto-link: petty cash spent from the selected bank account
      await client.query(
        `INSERT INTO bank_transactions (bank_id, date, payee_name, amount_out, created_by, source_type, source_ref, source_party)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [bank_id, week_of, desc, amtValue, req.user.id, 'petty_cash', rows[0].id, desc]
      );
      await client.query('COMMIT');
      client.release(); released = true;
      await safeAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'petty_cash', rows[0].id,
        `Created petty cash record: ${desc} - PKR ${amtValue} on ${project.name}`);
      await safeActivity(req.user.full_name, 'created', `Added petty cash: ${desc} on project: ${project.name}`, 'petty_cash', rows[0].id);
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
      throw err;
    } finally {
      if (!released) client.release();
    }
  } catch (err) { return dbError(res, err); }
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
    if ((from && !isDate(String(from))) || (to && !isDate(String(to)))) return res.status(400).json({ error: 'Invalid date filter' });
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
      if (!byDisbursement[r.petty_cash_id] && r.status !== 'deleted') byDisbursement[r.petty_cash_id] = d(0);
    });
    const balanced = rows.slice().sort((a, b) =>
      (a.utilization_date + a.created_at).localeCompare(b.utilization_date + b.created_at));
    balanced.forEach(r => {
      if (r.status === 'deleted') { r.running_remaining = null; return; }
      const used = toNumber(add(d(byDisbursement[r.petty_cash_id]), d(r.amount)));
      byDisbursement[r.petty_cash_id] = used;
      const remaining = toNumber(round2(sub(d(r.petty_cash_amount), d(used))));
      r.running_remaining = Math.max(0, remaining);
    });

    // Parallel aggregation for total utilized
    const totalUtilizedQ = await pool.query(
      `SELECT COALESCE(SUM(pu.amount), 0)::float as total
       FROM petty_cash_utilization pu
       JOIN petty_cash p ON p.id = pu.petty_cash_id
       WHERE p.project_id=$1 AND pu.status<>'deleted' AND p.status<>'deleted'`,
      [req.params.projectId]
    );

    res.json({
      total_utilized: toNumber(round2(d(totalUtilizedQ.rows[0].total))),
      count: rows.length,
      entries: rows || [],
    });
  } catch (err) { return dbError(res, err); }
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

let used = d(0);
    const entries = rows.map(r => {
      if (r.status === 'deleted') return { ...r, running_remaining: null };
      used = round2(add(used, d(r.amount)));
      return { ...r, running_remaining: Math.max(0, toNumber(round2(sub(d(pc[0].amount), used)))) };
    });

res.json({
      petty_cash: { ...pc[0], utilized: toNumber(used), remaining: Math.max(0, toNumber(round2(sub(d(pc[0].amount), used)))) },
      entries: rows || [],
      total_utilized: toNumber(used),
    });
  } catch (err) { return dbError(res, err); }
});

// Add a utilization entry — locked rows prevent a concurrent add from
// overspending the disbursement (race-condition safe).
router.post('/petty-cash/:id/utilizations', authenticate, authorize(...FULL_ACCESS), async (req, res) => {
  try {
    const { utilization_date, date, category, amount, note, receipt_ref } = req.body;
    const useDate = utilization_date || date;
    if (!useDate) return res.status(400).json({ error: 'Utilization date required' });
    if (!isDate(useDate)) return res.status(400).json({ error: 'Invalid utilization date' });
    if (!category || typeof category !== 'string' || !category.trim()) return res.status(400).json({ error: 'Category required' });
    if (!maxLen(category, 100)) return res.status(400).json({ error: 'Category too long (max 100)' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount (> 0) required' });
    const noteV = optText(note); if (noteV.error) return res.status(400).json({ error: `Note ${noteV.error}` });
    const refV = optText(receipt_ref, 255); if (refV.error) return res.status(400).json({ error: `Receipt ref ${refV.error}` });

    const client = await pool.connect();
    let released = false;
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
      if (pc[0].status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot add utilization while the disbursement is not active (pending deletion/deleted)' });
      }

      const { rows: usedRows } = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::text AS used FROM petty_cash_utilization
         WHERE petty_cash_id=$1 AND status<>'deleted'`,
        [req.params.id]
      );
      const used = d(usedRows[0].used);
      const disbursed = d(pc[0].amount);
      if (gt(add(used, amt), disbursed)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Utilization exceeds disbursement. Remaining: PKR ${toNumber(sub(disbursed, used)).toLocaleString(undefined, { maximumFractionDigits: 2 })}` });
      }

      const { rows } = await client.query(
        `INSERT INTO petty_cash_utilization (petty_cash_id, utilization_date, category, amount, note, receipt_ref, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.params.id, useDate, category.trim(), amt.toFixed(2), noteV.value, refV.value, req.user.id]
      );
      await client.query('COMMIT');
      client.release(); released = true;
      await safeAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'petty_cash_utilization', rows[0].id,
        `Added utilization PKR ${amt.toFixed(2)} (${category.trim()}) on petty cash: ${pc[0].description}`);
      await safeActivity(req.user.full_name, 'created',
        `Added utilization PKR ${amt.toFixed(2)} (${category.trim()}) to petty cash: ${pc[0].description}`, 'petty_cash_utilization', rows[0].id);
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
      throw err;
    } finally {
      if (!released) client.release();
    }
  } catch (err) { return dbError(res, err); }
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
  } catch (err) { return dbError(res, err); }
});

router.post('/vendor-payments', authenticate, authorize(...FULL_ACCESS), async (req, res) => {
  try {
    const { vendor_id, payment_type, amount, po_id, bill_number, ipc_percent_complete, payment_date, bank_id } = req.body;
    if (!vendor_id) return res.status(400).json({ error: 'Vendor required' });
    if (!isUuid(vendor_id)) return res.status(400).json({ error: 'Invalid vendor id' });
    if (!payment_type || !['fixed_otp', 'continuous', 'ipc'].includes(payment_type))
      return res.status(400).json({ error: 'Valid payment type required' });
    if (!payment_date) return res.status(400).json({ error: 'Payment date required' });
    if (!isDate(payment_date)) return res.status(400).json({ error: 'Invalid payment date' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount (> 0) required' });
    if (!bank_id) return res.status(400).json({ error: 'Bank is required' });
    if (!isUuid(bank_id)) return res.status(400).json({ error: 'Invalid bank id' });
    const billV = optText(bill_number, 255); if (billV.error) return res.status(400).json({ error: `Bill number ${billV.error}` });
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const vendorQ = await pool.query('SELECT id, name FROM vendors WHERE id=$1', [vendor_id]);
    if (vendorQ.rows.length === 0) return res.status(400).json({ error: 'Vendor not found' });
    const { rows: bankQ } = await pool.query('SELECT id FROM banks WHERE id=$1', [bank_id]);
    if (bankQ.length === 0) return res.status(400).json({ error: 'Bank not found' });

    let ipcPct = null;
    if (payment_type === 'ipc') {
      const pct = (typeof ipc_percent_complete === 'number' || typeof ipc_percent_complete === 'string') ? Number(ipc_percent_complete) : NaN;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'Valid IPC % complete (0-100) required' });
      ipcPct = Math.round(pct * 100) / 100;
    }
    if (payment_type === 'continuous') {
      if (!po_id) return res.status(400).json({ error: 'PO selection required for continuous payments' });
      if (!isUuid(po_id)) return res.status(400).json({ error: 'Invalid PO id' });
    }

    const client = await pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');

      // PO linkage: 'continuous' payments must reference a PO from the purchase_orders table
      // raised for THIS project and vendor. Only FULLY approved POs (Admin -> Owner two-step
      // complete) are payable. The PO row is locked so two concurrent payments cannot both
      // pass the outstanding check. 'fixed_otp'/'ipc' payments are never linked to a PO.
      let poId = null;
      let poNumber = null;
      let billNo = null;
      if (payment_type === 'continuous') {
        const poQ = await client.query(
          `SELECT id, po_number, total_amount, status, admin_approval, owner_approval
           FROM purchase_orders WHERE id=$1 AND vendor_id=$2 AND project_id=$3 FOR UPDATE`,
          [po_id, vendor_id, req.params.projectId]
        );
        if (poQ.rows.length === 0) throw new HttpError(400, 'Selected PO not found for this vendor on this project');
        const poRow = poQ.rows[0];
        if (poRow.status === 'cancelled') throw new HttpError(400, 'Cannot link payment to a cancelled PO');
        if (poRow.status !== 'approved' || poRow.admin_approval !== 'approved' || poRow.owner_approval !== 'approved')
          throw new HttpError(400, 'Only fully approved POs (Admin and Owner) can be linked to continuous payments');

        const existingPaymentsQ = await client.query(
          `SELECT COALESCE(SUM(amount), 0)::text AS paid FROM vendor_payments
           WHERE po_id=$1 AND status<>'deleted'`,
          [po_id]
        );
        const outstanding = sub(poRow.total_amount, existingPaymentsQ.rows[0].paid);
        if (gt(amt, outstanding))
          throw new HttpError(400, `Payment exceeds PO outstanding. PO: ${poRow.po_number}, Outstanding: PKR ${toNumber(outstanding).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

        poId = po_id;
        poNumber = poRow.po_number;
        billNo = billV.value;
      }

      const amtValue = amt.toFixed(2);
      const { rows } = await client.query(
        `INSERT INTO vendor_payments (project_id, vendor_id, payment_type, amount, po_id, po_number, bill_number, ipc_percent_complete, payment_date, bank_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.params.projectId, vendor_id, payment_type, amtValue, poId, poNumber, billNo, ipcPct, payment_date, bank_id, req.user.id]
      );
      // Auto-link: vendor payment debited from the selected bank account
      await client.query(
        `INSERT INTO bank_transactions (bank_id, date, payee_name, cheque_no, amount_out, created_by, source_type, source_ref, source_party)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [bank_id, payment_date, vendorQ.rows[0].name, billNo || poNumber, amtValue, req.user.id, 'vendor_payment', rows[0].id, vendorQ.rows[0].name]
      );
      await client.query('COMMIT');
      client.release(); released = true;
      await safeAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'vendor_payment', rows[0].id,
        `Created vendor payment: ${vendorQ.rows[0].name} - PKR ${amtValue} on ${project.name}`);
      await safeActivity(req.user.full_name, 'created', `Added vendor payment for ${vendorQ.rows[0].name} on project: ${project.name}`, 'vendor_payment', rows[0].id);
      return res.status(201).json({ ...rows[0], vendor_name: vendorQ.rows[0].name });
    } catch (err) {
      if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      throw err;
    } finally {
      if (!released) client.release();
    }
  } catch (err) { return dbError(res, err); }
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
  } catch (err) { return dbError(res, err); }
});

router.post('/amount-received', authenticate, authorize(...FULL_ACCESS), async (req, res) => {
  try {
    const { amount, received_date, description, bank_id, received_from } = req.body;
    if (!received_date) return res.status(400).json({ error: 'Received date required' });
    if (!isDate(received_date)) return res.status(400).json({ error: 'Invalid received date' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount (> 0) required' });
    if (!bank_id) return res.status(400).json({ error: 'Bank is required' });
    if (!isUuid(bank_id)) return res.status(400).json({ error: 'Invalid bank id' });
    if (!received_from || typeof received_from !== 'string' || !received_from.trim()) return res.status(400).json({ error: 'Received from (client/party) is required' });
    if (!maxLen(received_from, 255)) return res.status(400).json({ error: 'Received from too long (max 255)' });
    const descV = optText(description, 255); if (descV.error) return res.status(400).json({ error: `Description ${descV.error}` });
    const party = received_from.trim();
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { rows: bankQ } = await pool.query('SELECT id FROM banks WHERE id=$1', [bank_id]);
    if (bankQ.length === 0) return res.status(400).json({ error: 'Bank not found' });

    const client = await pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      const amtValue = amt.toFixed(2);
      const { rows } = await client.query(
        `INSERT INTO amount_received (project_id, amount, received_date, description, bank_id, received_from, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.params.projectId, amtValue, received_date, descV.value, bank_id, party, req.user.id]
      );
      // Auto-link: amount received credited into the selected bank account
      await client.query(
        `INSERT INTO bank_transactions (bank_id, date, payee_name, amount_in, created_by, source_type, source_ref, source_party)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [bank_id, received_date, party, amtValue, req.user.id, 'amount_received', rows[0].id, party]
      );
      await client.query('COMMIT');
      client.release(); released = true;
      await safeAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'amount_received', rows[0].id,
        `Created amount received record: PKR ${amtValue} on ${project.name}`);
      await safeActivity(req.user.full_name, 'created', `Recorded payment received: PKR ${amtValue} on project: ${project.name}`, 'amount_received', rows[0].id);
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
      throw err;
    } finally {
      if (!released) client.release();
    }
  } catch (err) { return dbError(res, err); }
});

// ============ DELETION REQUESTS ============

// POST /deletion-requests — body: { transaction_type, transaction_id, reason }
router.post('/deletion-requests', authenticate, async (req, res) => {
  try {
    const { transaction_type, transaction_id, reason } = req.body;
    if (!VALID_TX_TYPES.includes(transaction_type))
      return res.status(400).json({ error: 'Invalid transaction type' });
    // bank_transactions have no project; manual ledger entries go through POST /api/finance/deletion-requests
    if (transaction_type === 'bank_transaction')
      return res.status(400).json({ error: 'Bank transactions are requested at global scope (/api/finance/deletion-requests), not per project' });
    if (!transaction_id) return res.status(400).json({ error: 'Transaction id required' });
    if (!isUuid(transaction_id)) return res.status(400).json({ error: 'Invalid transaction id' });
    const reasonV = optText(reason); if (reasonV.error) return res.status(400).json({ error: `Reason ${reasonV.error}` });

    // PM can only request deletion of salary/petty_cash; Owner/Admin/Finance can request all types
    const canRequest = FULL_ACCESS.includes(req.user.role)
      || (PM_ACCESS.includes(req.user.role) && ['salary', 'petty_cash'].includes(transaction_type));
    if (!canRequest) return res.status(403).json({ error: 'You cannot request deletion of this transaction type' });
    if (!(await assertManagerProjectAccess(req.params.projectId, req.user, res))) return;

    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const table = TX_TABLES[transaction_type];
    const client = await pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      let tx;
      if (transaction_type === 'petty_cash_utilization') {
        const { rows } = await client.query(
          `SELECT pu.*, p.project_id, p.status AS parent_status
           FROM petty_cash_utilization pu JOIN petty_cash p ON p.id = pu.petty_cash_id
           WHERE pu.id=$1 AND p.project_id=$2 FOR UPDATE OF pu`,
          [transaction_id, req.params.projectId]
        );
        tx = rows;
      } else {
        const { rows } = await client.query(
          `SELECT * FROM ${table} WHERE id=$1 AND project_id=$2 FOR UPDATE`,
          [transaction_id, req.params.projectId]
        );
        tx = rows;
      }
      if (tx.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Transaction not found' }); }
      if (tx[0].status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Only active transactions can be requested for deletion' });
      }
      // A utilization entry under a disbursement that is itself being deleted
      // cannot be deleted separately — the parent is already locked.
      if (transaction_type === 'petty_cash_utilization' && tx[0].parent_status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'The parent petty cash disbursement is not active — utilization cannot be deleted separately' });
      }
      const { parent_status, ...snapshot } = tx[0];

      const { rows } = await client.query(
        `INSERT INTO deletion_requests (transaction_type, transaction_id, project_id, requested_by, reason, snapshot_data)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [transaction_type, transaction_id, req.params.projectId, req.user.id, reasonV.value, JSON.stringify(snapshot)]
      );
      await client.query(`UPDATE ${table} SET status='deletion_requested' WHERE id=$1`, [transaction_id]);
      await client.query('COMMIT');
      client.release(); released = true;

      await safeAudit(req.user.id, req.user.full_name, req.user.role, 'requested', 'deletion_request', rows[0].id,
        `Deletion requested for ${TX_LABELS[transaction_type]} on project: ${project.name}${reasonV.value ? ` - ${reasonV.value}` : ''}`);
      await safeActivity(req.user.full_name, 'requested', `Deletion requested for ${TX_LABELS[transaction_type]} on project: ${project.name}`, 'deletion_request', rows[0].id);
      await safeNotifyRoles(APPROVERS, 'deletion_request',
        `Deletion requested: ${TX_LABELS[transaction_type]}`,
        `${req.user.full_name} requested deletion of ${TX_LABELS[transaction_type]} on ${project.name}`,
        `/projects?project=${req.params.projectId}&tab=finance`, 'deletion_request', rows[0].id);
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
      throw err;
    } finally {
      if (!released) client.release();
    }
  } catch (err) { return dbError(res, err); }
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
  } catch (err) { return dbError(res, err); }
});

// Evaluate and finalize a deletion request after any approval action.
// If both approvals become 'approved' -> final 'approved', transaction status 'deleted'.
// If either is 'rejected' -> final 'rejected', transaction status back to 'active'.
// Throws HttpError(409) when deleting would leave paired records inconsistent.
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

    if (finalStatus === 'approved' && deletionRequest.transaction_type === 'bank_transaction') {
      // An auto-linked bank entry mirrors a salary / petty cash / vendor payment / receipt.
      // Deleting it alone would leave the source entry counted while the money "reappears"
      // in the bank — refuse and point at the source entry instead.
      const { rows } = await client.query('SELECT source_type FROM bank_transactions WHERE id=$1 FOR UPDATE', [deletionRequest.transaction_id]);
      if (rows.length && rows[0].source_type && rows[0].source_type !== 'manual') {
        throw new HttpError(409, `This bank entry was created automatically from a ${TX_LABELS[rows[0].source_type] || rows[0].source_type}. Request deletion of that source entry instead; its bank entry is removed with it.`);
      }
    }

    await client.query(`UPDATE ${table} SET status=$1 WHERE id=$2`, [txStatus, deletionRequest.transaction_id]);
    // Auto-linked bank book entry (when the finance entry is deleted, the
    // paired bank transaction is deleted too — no orphaned records).
    if (finalStatus === 'approved' && ['vendor_payment', 'salary', 'petty_cash', 'amount_received', 'petty_cash_utilization'].includes(deletionRequest.transaction_type)) {
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
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid id format' });

  const client = await pool.connect();
  let released = false;
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
    if (reqRows.length === 0) throw new HttpError(404, 'Deletion request not found');
    const dreq = reqRows[0];

    if (dreq.final_status !== 'pending')
      throw new HttpError(400, 'This request has already been finalized');

    const levelKey = level === 'admin' ? 'admin_approval' : 'owner_approval';
    if (dreq[levelKey] !== 'pending')
      throw new HttpError(400, `${level === 'admin' ? 'Admin' : 'Owner'} approval already submitted for this request`);

    // Sequential order is enforced server-side: the Owner can only act AFTER
    // the Admin has approved. An early Owner action is rejected, not queued.
    if (level === 'owner' && dreq.admin_approval !== 'approved')
      throw new HttpError(400, 'Owner cannot approve before the Admin has approved this request');

    // Separation of duties: the requester never approves their own request, and the
    // owner-level approver must be a different person from the admin-level approver.
    if (dreq.requested_by === req.user.id)
      throw new HttpError(403, 'You cannot approve or reject your own deletion request');
    if (level === 'owner' && dreq.admin_approved_by === req.user.id)
      throw new HttpError(403, 'Owner-level approval must come from a different user than the admin-level approval');

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
    client.release(); released = true;

    const label = TX_LABELS[dreq.transaction_type] || dreq.transaction_type;
    const actionWord = decision === 'approved' ? 'approved' : 'rejected';
    await safeAudit(req.user.id, req.user.full_name, req.user.role, `${level}_approve`, 'deletion_request', id,
      `${level === 'admin' ? 'Admin' : 'Owner'} ${actionWord} deletion of ${label} (final status: ${finalStatus})`);
    await safeActivity(req.user.full_name, `${level}_approve`, `${level === 'admin' ? 'Admin' : 'Owner'} ${actionWord} deletion of ${label}`, 'deletion_request', id);
    if (finalStatus !== 'pending') {
      const link = dreq.project_id
        ? `/projects?project=${dreq.project_id}&tab=finance`
        : '/bankbook';
      await safeNotification(dreq.requested_by, 'deletion_request',
        `Deletion request ${finalStatus}`,
        `Your deletion request for ${label} was ${finalStatus} by ${req.user.full_name}`,
        link, 'deletion_request', id);
    }
    return res.json(rows[0]);
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    return dbError(res, err);
  } finally {
    if (!released) client.release();
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
globalRouter.param('id', requireUuid);

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
  } catch (err) { return dbError(res, err); }
});

// POST /api/finance/deletion-requests — global-level deletion request (bank transactions only)
globalRouter.post('/deletion-requests', authenticate, async (req, res) => {
  try {
    const { transaction_type, transaction_id, reason } = req.body;
    if (transaction_type !== 'bank_transaction')
      return res.status(400).json({ error: 'Only bank transactions can be requested at global scope' });
    if (!transaction_id) return res.status(400).json({ error: 'Transaction id required' });
    if (!isUuid(transaction_id)) return res.status(400).json({ error: 'Invalid transaction id' });
    if (!FULL_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'You cannot request deletion of this transaction type' });
    const reasonV = optText(reason); if (reasonV.error) return res.status(400).json({ error: `Reason ${reasonV.error}` });

    const client = await pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      const { rows: tx } = await client.query('SELECT * FROM bank_transactions WHERE id=$1 FOR UPDATE', [transaction_id]);
      if (tx.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Transaction not found' }); }
      if (tx[0].status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Only active transactions can be requested for deletion' });
      }
      // Auto-linked entries are deleted through their source finance entry (keeps the pair consistent)
      if (tx[0].source_type && tx[0].source_type !== 'manual') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `This bank entry was created automatically from a ${TX_LABELS[tx[0].source_type] || tx[0].source_type}. Request deletion of that source entry instead; its bank entry is removed with it.` });
      }

      const { rows } = await client.query(
        `INSERT INTO deletion_requests (transaction_type, transaction_id, project_id, requested_by, reason, snapshot_data)
         VALUES ($1,$2,NULL,$3,$4,$5) RETURNING *`,
        [transaction_type, transaction_id, req.user.id, reasonV.value, JSON.stringify(tx[0])]
      );
      await client.query(`UPDATE bank_transactions SET status='deletion_requested' WHERE id=$1`, [transaction_id]);
      await client.query('COMMIT');
      client.release(); released = true;

      await safeAudit(req.user.id, req.user.full_name, req.user.role, 'requested', 'deletion_request', rows[0].id,
        `Deletion requested for Bank Transaction${reasonV.value ? ` - ${reasonV.value}` : ''}`);
      await safeActivity(req.user.full_name, 'requested', `Deletion requested for a Bank Transaction`, 'deletion_request', rows[0].id);
      await safeNotifyRoles(APPROVERS, 'deletion_request',
        `Deletion requested: Bank Transaction`,
        `${req.user.full_name} requested deletion of a bank transaction`,
        '/bankbook', 'deletion_request', rows[0].id);
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
      throw err;
    } finally {
      if (!released) client.release();
    }
  } catch (err) { return dbError(res, err); }
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
    if (!isUuid(vendor_id)) return res.status(400).json({ error: 'Invalid vendor id' });

    const vendorQ = await pool.query('SELECT * FROM vendors WHERE id=$1', [vendor_id]);
    if (vendorQ.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });

    const [pos, payments] = await Promise.all([
      pool.query(
        `SELECT po.*, p.name as project_name
         FROM purchase_orders po LEFT JOIN projects p ON po.project_id = p.id
         WHERE po.vendor_id=$1 ORDER BY po.created_at DESC`,
        [vendor_id]
      ),
      pool.query(
        `SELECT vp.*, v.name as vendor_name, p.name as project_name, u.full_name as created_by_name
         FROM vendor_payments vp
         LEFT JOIN vendors v ON vp.vendor_id = v.id
         LEFT JOIN projects p ON vp.project_id = p.id
         LEFT JOIN users u ON vp.created_by = u.id
         WHERE vp.vendor_id=$1 ORDER BY vp.payment_date DESC, vp.created_at DESC`,
        [vendor_id]
      )
    ]);

    const activePos = pos.rows.filter((po) => po.status !== 'cancelled');
    const activePayments = payments.rows.filter((vp) => vp.status !== 'deleted');
    const totalPoValue = toNumber(activePos.reduce((sum, po) => add(d(sum), d(po.total_amount)), d(0)));
    const totalPaid = toNumber(activePayments.reduce((sum, vp) => add(d(sum), d(vp.amount)), d(0)));

    res.json({
      vendor: vendorQ.rows[0],
      purchase_orders: pos.rows,
      payments: payments.rows,
      total_po_value: totalPoValue,
      total_paid: totalPaid,
      balance: toNumber(sub(d(totalPoValue), d(totalPaid))),
    });
  } catch (err) { return dbError(res, err); }
});

module.exports = router;
module.exports.globalRouter = globalRouter;
