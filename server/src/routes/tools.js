const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');
const { requireUuid, isUuid, dbError, toNumber, isDate, maxLen } = require('../middleware/validate');

const router = express.Router();
router.param('id', requireUuid);

// Enums mirror the CHECK constraints in db/schema.js (tools table)
const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];
const STATUSES = ['available', 'checked_out', 'under_maintenance', 'retired'];
const MANAGE_ROLES = ['owner', 'admin', 'store_manager'];
const CHECKOUT_ROLES = ['owner', 'admin', 'store_manager', 'site_engineer'];

const trimOrNull = (v) => (typeof v === 'string' ? (v.trim() || null) : (v ?? null));

// Validates the shared create/edit body. Returns an error string or null; mutates `b` into a
// normalised form (trimmed strings, numeric cost, null for blanks).
function validateToolBody(b, { partial = false } = {}) {
  b.name = trimOrNull(b.name);
  if (!partial && !b.name) return 'Name required';
  if (b.name !== null && b.name !== undefined && !maxLen(b.name, 255)) return 'Name too long (max 255)';
  b.serial_number = trimOrNull(b.serial_number);
  if (!maxLen(b.serial_number, 255)) return 'Serial number too long (max 255)';
  for (const [k, n] of [['type', 100], ['category', 100], ['storage_location', 255], ['checked_out_to', 255], ['checked_out_employee', 255]]) {
    if (k in b) { b[k] = trimOrNull(b[k]); if (!maxLen(b[k], n)) return `${k.replace(/_/g, ' ')} too long (max ${n})`; }
  }
  if (b.current_condition != null && !CONDITIONS.includes(b.current_condition)) return `Invalid condition (allowed: ${CONDITIONS.join(', ')})`;
  if (b.current_status != null && !STATUSES.includes(b.current_status)) return `Invalid status (allowed: ${STATUSES.join(', ')})`;
  if (b.purchase_cost != null) {
    const n = toNumber(b.purchase_cost);
    if (Number.isNaN(n) || n < 0 || n > 9999999999) return 'Purchase cost must be a number >= 0';
    b.purchase_cost = n;
  }
  if (b.maintenance_interval_days != null) {
    const n = toNumber(b.maintenance_interval_days);
    if (Number.isNaN(n) || !Number.isInteger(n) || n < 0 || n > 100000) return 'Maintenance interval must be a whole number of days';
    b.maintenance_interval_days = n;
  }
  for (const k of ['purchase_date', 'next_maintenance_date', 'return_due_date']) {
    if (!isDate(b[k])) return `Invalid ${k.replace(/_/g, ' ')}`;
  }
  for (const k of ['warehouse_id', 'assigned_project_id']) {
    if (b[k] === undefined) continue;
    if (!b[k]) { b[k] = null; continue; }
    if (!isUuid(b[k])) return `Invalid ${k.replace(/_/g, ' ')}`;
  }
  return null;
}

router.get('/', authenticate, authorize(...ROLES.FLEET), async (req, res) => {
  try {
    const { status, condition, type, project, search } = req.query;
    let sql = `SELECT t.*, p.name as project_name, w.name as warehouse_name
               FROM tools t LEFT JOIN projects p ON t.assigned_project_id = p.id
               LEFT JOIN warehouses w ON t.warehouse_id = w.id
               WHERE t.is_active = true`;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND t.current_status = $${idx}`; params.push(status); idx++; }
    if (condition) { sql += ` AND t.current_condition = $${idx}`; params.push(condition); idx++; }
    if (type) { sql += ` AND t.type ILIKE $${idx}`; params.push(`%${type}%`); idx++; }
    if (project) {
      if (!isUuid(project)) return res.status(400).json({ error: 'Invalid project id' });
      sql += ` AND t.assigned_project_id = $${idx}`; params.push(project); idx++;
    }
    if (search && typeof search === 'string' && search.trim()) {
      sql += ` AND (t.name ILIKE $${idx} OR t.serial_number ILIKE $${idx} OR t.category ILIKE $${idx})`;
      params.push(`%${search.trim()}%`); idx++;
    }
    sql += ' ORDER BY t.name';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.get('/:id', authenticate, authorize(...ROLES.FLEET), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT t.*, p.name as project_name FROM tools t LEFT JOIN projects p ON t.assigned_project_id = p.id WHERE t.id=$1 AND t.is_active = true',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Tool not found' });
    res.json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

router.post('/', authenticate, authorize(...MANAGE_ROLES), async (req, res) => {
  try {
    const b = { ...req.body };
    const verr = validateToolBody(b);
    if (verr) return res.status(400).json({ error: verr });
    if (b.current_status === 'checked_out') return res.status(400).json({ error: 'Use checkout to check a tool out' });
    const { name, serial_number, type, category, description, purchase_date, purchase_cost, current_condition, current_status, next_maintenance_date, warehouse_id, storage_location, notes } = b;
    if (warehouse_id) {
      const { rows: w } = await pool.query('SELECT id FROM warehouses WHERE id=$1', [warehouse_id]);
      if (w.length === 0) return res.status(400).json({ error: 'Warehouse not found' });
    }
    const { rows } = await pool.query(
      `INSERT INTO tools (name, serial_number, type, category, description, purchase_date, purchase_cost, current_condition, current_status, next_maintenance_date, warehouse_id, storage_location, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [name, serial_number, type, category, description ?? null, purchase_date ?? null, purchase_cost ?? null, current_condition || 'good', current_status || 'available', next_maintenance_date ?? null, warehouse_id || null, storage_location, notes ?? null]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'tool', rows[0].id, `Added tool: ${name}`);
    await addActivity(req.user.full_name, 'created', `Added tool: ${name}`, 'tool', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Serial number already exists' });
    return dbError(res, err);
  }
});

router.put('/:id', authenticate, authorize(...MANAGE_ROLES), async (req, res) => {
  try {
    const b = { ...req.body };
    const verr = validateToolBody(b, { partial: true });
    if (verr) return res.status(400).json({ error: verr });
    const { rows: existing } = await pool.query('SELECT * FROM tools WHERE id=$1 AND is_active = true', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Tool not found' });
    const cur = existing[0];

    // Checkout state can only change through /checkout and /checkin (they write tool_checkout_log)
    if (b.current_status != null && b.current_status !== cur.current_status) {
      if (b.current_status === 'checked_out') return res.status(400).json({ error: 'Use checkout/checkin to change checkout status' });
      if (cur.current_status === 'checked_out') return res.status(400).json({ error: 'Use checkout/checkin to change checkout status' });
    }
    if (b.warehouse_id) {
      const { rows: w } = await pool.query('SELECT id FROM warehouses WHERE id=$1', [b.warehouse_id]);
      if (w.length === 0) return res.status(400).json({ error: 'Warehouse not found' });
    }
    if (b.assigned_project_id) {
      const { rows: p } = await pool.query('SELECT id FROM projects WHERE id=$1', [b.assigned_project_id]);
      if (p.length === 0) return res.status(400).json({ error: 'Project not found' });
    }

    const { name, serial_number, type, category, description, current_condition, current_status, purchase_date, purchase_cost, next_maintenance_date, maintenance_interval_days, checked_out_to, checked_out_employee, assigned_project_id, return_due_date, warehouse_id, storage_location, notes } = b;
    // Fields the edit form always sends are written as-is (serial may legitimately be cleared);
    // everything else is COALESCEd so a partial payload never wipes unrelated columns.
    const { rows } = await pool.query(
      `UPDATE tools SET
         name=COALESCE($1, name),
         serial_number=CASE WHEN $19::boolean THEN $2 ELSE serial_number END,
         type=COALESCE($3, type), category=COALESCE($4, category), description=COALESCE($5, description),
         current_condition=COALESCE($6, current_condition), current_status=COALESCE($7, current_status),
         purchase_date=COALESCE($8, purchase_date), purchase_cost=COALESCE($9, purchase_cost),
         next_maintenance_date=COALESCE($10, next_maintenance_date),
         maintenance_interval_days=COALESCE($11, maintenance_interval_days),
         checked_out_to=COALESCE($12, checked_out_to), checked_out_employee=COALESCE($13, checked_out_employee),
         assigned_project_id=CASE WHEN $21::boolean THEN $14 ELSE assigned_project_id END, return_due_date=COALESCE($15, return_due_date),
         warehouse_id=COALESCE($16, warehouse_id), storage_location=COALESCE($17, storage_location),
         notes=COALESCE($18, notes), updated_at=NOW()
       WHERE id=$20 AND is_active = true RETURNING *`,
      [name ?? null, serial_number ?? null, type ?? null, category ?? null, description ?? null, current_condition ?? null, current_status ?? null,
       purchase_date ?? null, purchase_cost ?? null, next_maintenance_date ?? null, maintenance_interval_days ?? null,
       checked_out_to ?? null, checked_out_employee ?? null, assigned_project_id ?? null, return_due_date ?? null,
       warehouse_id ?? null, storage_location ?? null, notes ?? null, 'serial_number' in req.body, req.params.id, 'assigned_project_id' in req.body]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Tool not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'tool', rows[0].id, `Updated tool: ${rows[0].name}`);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Serial number already exists' });
    return dbError(res, err);
  }
});

router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT name, current_status FROM tools WHERE id=$1 AND is_active = true', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Tool not found or already deactivated' });
    if (existing[0].current_status === 'checked_out') return res.status(409).json({ error: 'Tool is checked out; check it in first' });
    const { rows } = await pool.query(
      `UPDATE tools SET is_active=false, updated_at=NOW() WHERE id=$1 AND is_active = true AND current_status <> 'checked_out' RETURNING name`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Tool is checked out; check it in first' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'deleted', 'tool', req.params.id, `Deactivated tool: ${rows[0].name}`);
    await addActivity(req.user.full_name, 'deleted', `Deactivated tool ${rows[0].name}`, 'tool', req.params.id);
    res.json({ message: 'Tool deactivated' });
  } catch (err) { return dbError(res, err); }
});

// Checkout / Checkin
router.post('/:id/checkout', authenticate, authorize(...CHECKOUT_ROLES), async (req, res) => {
  const checked_out_to = trimOrNull(req.body.checked_out_to);
  const employee_name = trimOrNull(req.body.employee_name);
  let { assigned_project_id, expected_return_date, notes } = req.body;
  if (!checked_out_to) return res.status(400).json({ error: 'Checked out to required' });
  if (!maxLen(checked_out_to, 255) || !maxLen(employee_name, 255)) return res.status(400).json({ error: 'Name too long (max 255)' });
  if (!isDate(expected_return_date)) return res.status(400).json({ error: 'Invalid expected return date' });
  if (!assigned_project_id) assigned_project_id = null;
  else if (!isUuid(assigned_project_id)) return res.status(400).json({ error: 'Invalid project id' });

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const { rows: tool } = await client.query('SELECT * FROM tools WHERE id=$1 AND is_active = true FOR UPDATE', [req.params.id]);
    if (tool.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Tool not found' }); }
    if (tool[0].current_status !== 'available') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Tool is not available (current status: ${tool[0].current_status})` });
    }
    if (assigned_project_id) {
      const { rows: proj } = await client.query('SELECT id FROM projects WHERE id=$1', [assigned_project_id]);
      if (proj.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Project not found' }); }
    }
    await client.query(
      `UPDATE tools SET current_status='checked_out', checked_out_to=$1, checked_out_employee=$2, assigned_project_id=$3, return_due_date=$4, updated_at=NOW() WHERE id=$5`,
      [checked_out_to, employee_name, assigned_project_id, expected_return_date ?? null, req.params.id]
    );
    await client.query(
      `INSERT INTO tool_checkout_log (tool_id, tool_name, checked_out_to, employee_name, assigned_project_id, expected_return_date, notes, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.params.id, tool[0].name, checked_out_to, employee_name, assigned_project_id, expected_return_date ?? null, notes ?? null, req.user.id]
    );
    await client.query('COMMIT');
    client.release(); released = true;
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'check_out', 'tool', req.params.id,
      `Checked out ${tool[0].name} to ${checked_out_to}${assigned_project_id ? ' (project: ' + assigned_project_id + ')' : ''}`);
    await addActivity(req.user.full_name, 'checked_out', `Checked out ${tool[0].name} to ${checked_out_to}`, 'tool', req.params.id);
    res.json({ message: 'Tool checked out' });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

router.post('/:id/checkin', authenticate, authorize(...CHECKOUT_ROLES), async (req, res) => {
  const { condition_on_return, notes } = req.body;
  const returned_by = trimOrNull(req.body.returned_by);
  if (!returned_by) return res.status(400).json({ error: 'Returned by is required' });
  if (!maxLen(returned_by, 255)) return res.status(400).json({ error: 'Returned by too long (max 255)' });
  if (condition_on_return != null && !CONDITIONS.includes(condition_on_return))
    return res.status(400).json({ error: `Invalid condition (allowed: ${CONDITIONS.join(', ')})` });

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const { rows: tool } = await client.query('SELECT * FROM tools WHERE id=$1 AND is_active = true FOR UPDATE', [req.params.id]);
    if (tool.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Tool not found' }); }
    if (tool[0].current_status !== 'checked_out') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Tool is not currently checked out (status: ${tool[0].current_status})` });
    }

    const checkedOutTo = tool[0].checked_out_to;
    const cond = condition_on_return || 'good';
    // If condition is damaged or poor, flag for maintenance
    const needsMaintenance = ['damaged', 'poor'].includes(cond);
    const newStatus = needsMaintenance ? 'under_maintenance' : 'available';

    await client.query(
      `UPDATE tools SET current_status=$1, checked_out_to=NULL, checked_out_employee=NULL, assigned_project_id=NULL, return_due_date=NULL, current_condition=$2, updated_at=NOW() WHERE id=$3`,
      [newStatus, cond, req.params.id]
    );
    await client.query(
      `UPDATE tool_checkout_log SET actual_return_date=NOW(), condition_on_return=$1, returned_by=$2,
         notes=CASE WHEN $3::text IS NULL THEN notes WHEN notes IS NULL THEN $3 ELSE notes || ' | Return: ' || $3 END
       WHERE tool_id=$4 AND actual_return_date IS NULL`,
      [cond, returned_by, notes ?? null, req.params.id]
    );
    await client.query('COMMIT');
    client.release(); released = true;

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'check_in', 'tool', req.params.id,
      `Checked in ${tool[0].name} (checked out to: ${checkedOutTo}, returned by: ${returned_by}, condition: ${cond})`);
    await addActivity(req.user.full_name, 'checked_in', `Checked in ${tool[0].name} (returned by: ${returned_by})`, 'tool', req.params.id);
    res.json({ message: 'Tool checked in' });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

router.get('/:id/checkout-history', authenticate, authorize(...ROLES.FLEET), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tool_checkout_log WHERE tool_id=$1 ORDER BY created_at DESC LIMIT 50', [req.params.id]);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

module.exports = router;
