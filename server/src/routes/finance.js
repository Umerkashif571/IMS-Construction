const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');

const router = express.Router({ mergeParams: true });

const FULL_ACCESS = ['owner', 'admin', 'finance'];
const PM_ACCESS = ['manager'];
const APPROVERS = ['owner', 'admin'];

const TX_TABLES = {
  salary: 'salaries',
  petty_cash: 'petty_cash',
  vendor_payment: 'vendor_payments',
};

const TX_LABELS = {
  salary: 'Salary',
  petty_cash: 'Petty Cash',
  vendor_payment: 'Vendor Payment',
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

// GET /summary — project_cost_value, actual_cost, balance, percent_utilized
// PM: limited summary (salaries + petty cash only, no vendor breakdown)
router.get('/summary', authenticate, async (req, res) => {
  try {
    const isFull = FULL_ACCESS.includes(req.user.role);
    const isPM = PM_ACCESS.includes(req.user.role);
    if (!isFull && !isPM) return res.status(403).json({ error: 'Insufficient permissions' });

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
    const vendorQ = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::float as total FROM vendor_payments WHERE project_id=$1 AND status<>'deleted'`,
      [req.params.projectId]
    );

    const salariesTotal = parseFloat(salaryQ.rows[0].total) || 0;
    const pettyCashTotal = parseFloat(pettyQ.rows[0].total) || 0;
    const vendorPaymentsTotal = parseFloat(vendorQ.rows[0].total) || 0;

    const vendorIncluded = isFull;
    const actualCost = salariesTotal + pettyCashTotal + (vendorIncluded ? vendorPaymentsTotal : 0);
    const projectCostValue = parseFloat(project.project_cost_value) || 0;
    const balance = projectCostValue - actualCost;
    const percentUtilized = projectCostValue > 0 ? (actualCost / projectCostValue) * 100 : 0;

    const payload = {
      project_cost_value: projectCostValue,
      actual_cost: actualCost,
      balance,
      percent_utilized: Math.round(percentUtilized * 100) / 100,
      salaries_total: salariesTotal,
      petty_cash_total: pettyCashTotal,
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
    const { employee_name, amount, month } = req.body;
    if (!employee_name) return res.status(400).json({ error: 'Employee name required' });
    if (!month) return res.status(400).json({ error: 'Month required' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount required' });
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { rows } = await pool.query(
      `INSERT INTO salaries (project_id, employee_name, amount, month, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.projectId, employee_name, amt, month, req.user.id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'salary', rows[0].id,
      `Created salary record: ${employee_name} - PKR ${amt} for ${project.name}`);
    await addActivity(req.user.full_name, 'created', `Added salary for ${employee_name} on project: ${project.name}`, 'salary', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ============ PETTY CASH ============

router.get('/petty-cash', authenticate, async (req, res) => {
  try {
    if (!FULL_ACCESS.includes(req.user.role) && !PM_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'Insufficient permissions' });
    const { rows } = await pool.query(
      `SELECT p.*, u.full_name as created_by_name
       FROM petty_cash p LEFT JOIN users u ON p.created_by = u.id
       WHERE p.project_id=$1 ORDER BY p.week_of DESC, p.created_at DESC`,
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/petty-cash', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
    const { description, amount, week_of } = req.body;
    if (!description) return res.status(400).json({ error: 'Description required' });
    if (!week_of) return res.status(400).json({ error: 'Week date required' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount required' });
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { rows } = await pool.query(
      `INSERT INTO petty_cash (project_id, description, amount, week_of, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.projectId, description, amt, week_of, req.user.id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'petty_cash', rows[0].id,
      `Created petty cash record: ${description} - PKR ${amt} on ${project.name}`);
    await addActivity(req.user.full_name, 'created', `Added petty cash: ${description} on project: ${project.name}`, 'petty_cash', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ============ VENDOR PAYMENTS ============

router.get('/vendor-payments', authenticate, async (req, res) => {
  try {
    if (!FULL_ACCESS.includes(req.user.role))
      return res.status(403).json({ error: 'Vendor payment data is restricted' });
    const { rows } = await pool.query(
      `SELECT vp.*, v.name as vendor_name, u.full_name as created_by_name
       FROM vendor_payments vp
       LEFT JOIN vendors v ON vp.vendor_id = v.id
       LEFT JOIN users u ON vp.created_by = u.id
       WHERE vp.project_id=$1 ORDER BY vp.payment_date DESC, vp.created_at DESC`,
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/vendor-payments', authenticate, authorize('owner', 'admin', 'finance'), async (req, res) => {
  try {
    const { vendor_id, payment_type, amount, po_number, bill_number, ipc_percent_complete, payment_date } = req.body;
    if (!vendor_id) return res.status(400).json({ error: 'Vendor required' });
    if (!payment_type || !['fixed_otp', 'continuous', 'ipc'].includes(payment_type))
      return res.status(400).json({ error: 'Valid payment type required' });
    if (!payment_date) return res.status(400).json({ error: 'Payment date required' });
    const amt = parseAmount(amount);
    if (amt === null) return res.status(400).json({ error: 'Valid amount required' });
    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const vendorQ = await pool.query('SELECT id, name FROM vendors WHERE id=$1', [vendor_id]);
    if (vendorQ.rows.length === 0) return res.status(400).json({ error: 'Vendor not found' });

    let ipcPct = null;
    if (payment_type === 'ipc') {
      const pct = parseFloat(ipc_percent_complete);
      if (isNaN(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'Valid IPC % complete (0-100) required' });
      ipcPct = pct;
    }

    const { rows } = await pool.query(
      `INSERT INTO vendor_payments (project_id, vendor_id, payment_type, amount, po_number, bill_number, ipc_percent_complete, payment_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.projectId, vendor_id, payment_type, amt, po_number || null, bill_number || null, ipcPct, payment_date, req.user.id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'vendor_payment', rows[0].id,
      `Created vendor payment: ${vendorQ.rows[0].name} - PKR ${amt} on ${project.name}`);
    await addActivity(req.user.full_name, 'created', `Added vendor payment for ${vendorQ.rows[0].name} on project: ${project.name}`, 'vendor_payment', rows[0].id);
    res.status(201).json({ ...rows[0], vendor_name: vendorQ.rows[0].name });
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

    const project = await projectExists(res, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const table = TX_TABLES[transaction_type];
    const { rows: tx } = await pool.query(
      `SELECT * FROM ${table} WHERE id=$1 AND project_id=$2`,
      [transaction_id, req.params.projectId]
    );
    if (tx.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    if (tx[0].status !== 'active')
      return res.status(400).json({ error: 'Only active transactions can be requested for deletion' });

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
  }
  return finalStatus;
}

async function applyApproval(req, res, level) {
  const { id } = req.params;
  const { approve } = req.body;
  if (typeof approve !== 'boolean') return res.status(400).json({ error: 'approve must be true or false' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: reqRows } = await client.query(
      'SELECT * FROM deletion_requests WHERE id=$1 AND project_id=$2 FOR UPDATE',
      [id, req.params.projectId]
    );
    if (reqRows.length === 0) return res.status(404).json({ error: 'Deletion request not found' });
    const dreq = reqRows[0];

    if (dreq.final_status !== 'pending')
      return res.status(400).json({ error: 'This request has already been finalized' });

    const levelKey = level === 'admin' ? 'admin_approval' : 'owner_approval';
    if (dreq[levelKey] !== 'pending')
      return res.status(400).json({ error: `${level === 'admin' ? 'Admin' : 'Owner'} approval already submitted for this request` });

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
  return applyApproval(req, res, 'admin');
});

// PATCH /deletion-requests/:id/owner-approve — Owner only (final approval)
router.patch('/deletion-requests/:id/owner-approve', authenticate, authorize('owner'), (req, res) => {
  return applyApproval(req, res, 'owner');
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

module.exports = router;
module.exports.globalRouter = globalRouter;
