const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');
const { requireUuid, dbError, isDate, maxLen, isUuid } = require('../middleware/validate');

const router = express.Router();

router.param('id', requireUuid);
router.param('userId', requireUuid);

const VALID_STATUS = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
const MAX_COST = 1e13; // DECIMAL(15,2)

// DATE columns come back from pg as JS Dates shifted into the server TZ; return them as
// plain YYYY-MM-DD strings so the client can bind them straight into <input type=date>.
const DATE_COLS = `to_char(p.start_date, 'YYYY-MM-DD') AS start_date, to_char(p.end_date, 'YYYY-MM-DD') AS end_date`;
const RETURNING_COLS = `*, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date`;

// project_cost_value: undefined/null -> null (keep stored value); otherwise must be a finite
// non-negative number that fits DECIMAL(15,2). Returns { value } or { error }.
function parseCost(v) {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== 'number' && typeof v !== 'string') return { error: 'Project cost value must be a number' };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { error: 'Project cost value must be a non-negative number' };
  if (n >= MAX_COST) return { error: 'Project cost value out of range' };
  return { value: Math.round(n * 100) / 100 };
}

// Common string-field validation for POST/PUT. Returns an error message or null.
function validateStrings({ name, client, location, city, description }, { requireName }) {
  if (requireName && (!name || typeof name !== 'string' || !name.trim())) return 'Name required';
  if (name !== undefined && name !== null && (typeof name !== 'string' || !name.trim())) return 'Name must be a non-empty string';
  if (!maxLen(name, 255)) return 'Name too long (max 255)';
  if (client !== undefined && client !== null && typeof client !== 'string') return 'Client must be a string';
  if (!maxLen(client, 255)) return 'Client too long (max 255)';
  if (city !== undefined && city !== null && typeof city !== 'string') return 'City must be a string';
  if (!maxLen(city, 100)) return 'City too long (max 100)';
  if (location !== undefined && location !== null && typeof location !== 'string') return 'Location must be a string';
  if (description !== undefined && description !== null && typeof description !== 'string') return 'Description must be a string';
  return null;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Optimized query using LEFT JOIN with aggregation instead of correlated subqueries
    let sql = `
      SELECT p.*, ${DATE_COLS},
        COALESCE(alloc.alloc_count, 0) as allocation_count,
        COALESCE(mat.total_cost, 0) as total_material_cost
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) as alloc_count
        FROM project_allocations
        GROUP BY project_id
      ) alloc ON alloc.project_id = p.id
      LEFT JOIN (
        SELECT mt.project_id, COALESCE(SUM(mt.quantity * m.unit_cost), 0) as total_cost
        FROM material_transactions mt
        JOIN materials m ON mt.material_id = m.id
        WHERE mt.type = 'out'
        GROUP BY mt.project_id
      ) mat ON mat.project_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND p.status = $${idx}`; params.push(status); idx++; }
    if (search) { sql += ` AND (p.name ILIKE $${idx} OR p.client ILIKE $${idx} OR p.location ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    // Count total
    const countSql = `SELECT COUNT(*) FROM (${sql}) as filtered`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = parseInt(countRows[0]?.count || '0');

    sql += ` ORDER BY p.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limitNum, offset);

    const { rows } = await pool.query(sql, params);
    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) { return dbError(res, err); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, ${DATE_COLS},
        COALESCE(alloc.alloc_count, 0) as allocation_count,
        COALESCE(mat.total_cost, 0) as total_material_cost
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) as alloc_count
        FROM project_allocations
        GROUP BY project_id
      ) alloc ON alloc.project_id = p.id
      LEFT JOIN (
        SELECT mt.project_id, COALESCE(SUM(mt.quantity * m.unit_cost), 0) as total_cost
        FROM material_transactions mt
        JOIN materials m ON mt.material_id = m.id
        WHERE mt.type = 'out'
        GROUP BY mt.project_id
      ) mat ON mat.project_id = p.id
      WHERE p.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

// Material cost breakdown for a project
router.get('/:id/material-cost', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         m.id as material_id,
         m.name as material_name,
         m.sku,
         m.unit,
         m.unit_cost,
         SUM(mt.quantity) as total_quantity,
         SUM(mt.quantity * m.unit_cost) as total_cost
       FROM material_transactions mt
       JOIN materials m ON mt.material_id = m.id
       WHERE mt.project_id = $1 AND mt.type = 'out'
       GROUP BY m.id, m.name, m.sku, m.unit, m.unit_cost
       ORDER BY total_cost DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.post('/', authenticate, authorize('owner', 'admin', 'site_engineer'), async (req, res) => {
  try {
    const { name, client, location, city, start_date, end_date, status, description, project_cost_value } = req.body;
    const strErr = validateStrings(req.body, { requireName: true });
    if (strErr) return res.status(400).json({ error: strErr });
    if (status !== undefined && status !== null && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const finalStatus = VALID_STATUS.includes(status) ? status : 'planning';
    if (start_date && !isDate(start_date)) return res.status(400).json({ error: 'Invalid start date' });
    if (end_date && !isDate(end_date)) return res.status(400).json({ error: 'Invalid end date' });
    if (start_date && end_date && new Date(end_date) < new Date(start_date))
      return res.status(400).json({ error: 'End date cannot be before start date' });
    const cost = parseCost(project_cost_value);
    if (cost.error) return res.status(400).json({ error: cost.error });
    const pcv = cost.value ?? 0;
    const { rows } = await pool.query(
      `INSERT INTO projects (name, client, location, city, start_date, end_date, status, description, project_cost_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${RETURNING_COLS}`,
      [name.trim(), client ?? null, location ?? null, city ?? null, start_date ?? null, end_date ?? null, finalStatus, description ?? null, pcv]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'project', rows[0].id, `Created project: ${rows[0].name}`);
    await addActivity(req.user.full_name, 'created', `Created project: ${rows[0].name}`, 'project', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

router.put('/:id', authenticate, authorize('owner', 'admin', 'site_engineer'), async (req, res) => {
  try {
    const { name, client, location, city, start_date, end_date, status, description, project_cost_value } = req.body;
    const strErr = validateStrings(req.body, { requireName: false });
    if (strErr) return res.status(400).json({ error: strErr });
    if (status !== undefined && status !== null && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (start_date && !isDate(start_date)) return res.status(400).json({ error: 'Invalid start date' });
    if (end_date && !isDate(end_date)) return res.status(400).json({ error: 'Invalid end date' });
    if (start_date && end_date && new Date(end_date) < new Date(start_date))
      return res.status(400).json({ error: 'End date cannot be before start date' });
    const cost = parseCost(project_cost_value);
    if (cost.error) return res.status(400).json({ error: cost.error });
    const pcv = cost.value; // null when omitted -> COALESCE keeps the stored value
    if ([name, client, location, city, start_date, end_date, status, description].every(v => v === undefined || v === null) && pcv === null)
      return res.status(400).json({ error: 'No fields to update' });

    const client_ = await pool.connect();
    let released = false;
    try {
      await client_.query('BEGIN');
      const { rows: cur } = await client_.query(
        `SELECT status, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
         FROM projects WHERE id=$1 FOR UPDATE`,
        [req.params.id]
      );
      if (cur.length === 0) { await client_.query('ROLLBACK'); return res.status(404).json({ error: 'Project not found' }); }

      // Validate end >= start against the stored values when only one side is supplied
      const effStart = start_date ?? cur[0].start_date;
      const effEnd = end_date ?? cur[0].end_date;
      if (effStart && effEnd && new Date(effEnd) < new Date(effStart)) {
        await client_.query('ROLLBACK');
        return res.status(400).json({ error: 'End date cannot be before start date' });
      }

      // Cancelled (soft-deleted) projects are read-only; only owner/admin may explicitly
      // reactivate one by sending a non-cancelled status.
      if (cur[0].status === 'cancelled') {
        const reactivating = status && status !== 'cancelled';
        if (!reactivating || !['owner', 'admin'].includes(req.user.role)) {
          await client_.query('ROLLBACK');
          return res.status(409).json({ error: 'Project is cancelled. Only an owner or admin can reactivate it by setting a new status.' });
        }
      }

      const { rows } = await client_.query(
        `UPDATE projects SET name=COALESCE($1,name), client=COALESCE($2,client), location=COALESCE($3,location), city=COALESCE($4,city), start_date=COALESCE($5,start_date), end_date=COALESCE($6,end_date), status=COALESCE($7,status), description=COALESCE($8,description), project_cost_value=COALESCE($9,project_cost_value), updated_at=NOW()
         WHERE id=$10 RETURNING ${RETURNING_COLS}`,
        [name ? name.trim() : null, client ?? null, location ?? null, city ?? null, start_date ?? null, end_date ?? null, status ?? null, description ?? null, pcv, req.params.id]
      );
      await client_.query('COMMIT');
      client_.release(); released = true;
      await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'project', rows[0].id, `Updated project: ${rows[0].name}`);
      return res.json(rows[0]);
    } catch (err) {
      if (!released) { try { await client_.query('ROLLBACK'); } catch (_) {} }
      throw err;
    } finally {
      if (!released) client_.release();
    }
  } catch (err) { return dbError(res, err); }
});

router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE projects SET status='cancelled', updated_at=NOW() WHERE id=$1 AND status <> 'cancelled' RETURNING name",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found or already cancelled' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'deleted', 'project', req.params.id, `Cancelled (soft-deleted) project: ${rows[0].name}`);
    await addActivity(req.user.full_name, 'deleted', `Cancelled project: ${rows[0].name}`, 'project', req.params.id);
    res.json({ message: 'Project cancelled', name: rows[0].name });
  } catch (err) { return dbError(res, err); }
});

// Allocations
router.get('/:id/allocations', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM project_allocations WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.post('/:id/allocations', authenticate, authorize('owner', 'admin', 'site_engineer', 'store_manager'), async (req, res) => {
  try {
    const { allocation_type, entity_id, entity_name, quantity, unit, unit_cost, notes } = req.body;
    const VALID_TYPES = ['material', 'vehicle', 'tool'];
    if (!allocation_type || !entity_id) return res.status(400).json({ error: 'Allocation type and entity required' });
    if (!VALID_TYPES.includes(allocation_type)) return res.status(400).json({ error: 'Invalid allocation type' });
    if (!isUuid(entity_id)) return res.status(400).json({ error: 'Invalid entity id' });
    if (!maxLen(entity_name, 255) || !maxLen(unit, 50)) return res.status(400).json({ error: 'Value too long' });
    const qty = Number(quantity);
    if (typeof quantity === 'boolean' || !Number.isFinite(qty) || qty <= 0 || qty >= 1e13) return res.status(400).json({ error: 'Quantity must be a positive number' });
    const cost = unit_cost === undefined || unit_cost === null ? 0 : Number(unit_cost);
    if (typeof unit_cost === 'boolean' || !Number.isFinite(cost) || cost < 0 || cost >= 1e13) return res.status(400).json({ error: 'Invalid unit cost' });
    const total_cost = Math.round(qty * cost * 100) / 100;
    if (total_cost >= 1e13) return res.status(400).json({ error: 'Total cost out of range' });
    const { rows: proj } = await pool.query('SELECT id, name FROM projects WHERE id=$1', [req.params.id]);
    if (proj.length === 0) return res.status(404).json({ error: 'Project not found' });

    // A material allocation IS a stock issue: it must deduct stock and write the ledger in the
    // same transaction, exactly like POST /materials/:id/stock-out — otherwise the same bags
    // could be "allocated" here and issued again through the store (double counting).
    const client = await pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      let name = entity_name, u = unit, unitCost = cost;
      if (allocation_type === 'material') {
        const { rows: mat } = await client.query('SELECT id, name, unit, quantity, unit_cost, warehouse_id FROM materials WHERE id=$1 AND is_active = true FOR UPDATE', [entity_id]);
        if (mat.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Material not found' }); }
        const available = Number(mat[0].quantity) || 0;
        if (qty > available) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Insufficient stock: ${available} ${mat[0].unit} available` }); }
        name = mat[0].name; u = mat[0].unit; unitCost = unit_cost === undefined || unit_cost === null ? Number(mat[0].unit_cost) || 0 : cost;
        const newQty = available - qty;
        await client.query('UPDATE materials SET quantity=$1, updated_at=NOW() WHERE id=$2', [newQty, entity_id]);
        await client.query(
          `INSERT INTO material_transactions (material_id, type, quantity, running_total, warehouse_id, project_id, location, driver_name, vehicle_number, added_by, notes, transaction_type, date)
           VALUES ($1, 'out', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'allocation', NOW())`,
          [entity_id, qty, newQty, mat[0].warehouse_id, req.params.id, proj[0].name, null, null, req.user.full_name, notes || null]
        );
        await client.query(
          `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, notes, warehouse_id, user_id, user_name)
           VALUES ($1,$2,'out',$3,$4,$5,$6,$7,$8)`,
          [entity_id, name, qty, u, notes || `Allocated to ${proj[0].name}`, mat[0].warehouse_id, req.user.id, req.user.full_name]
        );
      } else {
        const table = allocation_type === 'vehicle' ? 'vehicles' : 'tools';
        const { rows: ent } = await client.query(`SELECT id, ${allocation_type === 'vehicle' ? 'registration_no AS name' : 'name'} FROM ${table} WHERE id=$1 AND is_active = true`, [entity_id]);
        if (ent.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: `${allocation_type} not found` }); }
        name = ent[0].name;
      }
      const totalCost = Math.round(qty * unitCost * 100) / 100;
      const { rows } = await client.query(
        `INSERT INTO project_allocations (project_id, allocation_type, entity_id, entity_name, quantity, unit, unit_cost, total_cost, notes, allocated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.params.id, allocation_type, entity_id, name, qty, u, unitCost, totalCost, notes, req.user.id]
      );
      await client.query('COMMIT');
      client.release(); released = true;
      await logAudit(req.user.id, req.user.full_name, req.user.role, 'allocated', 'project_allocation', rows[0].id, `Allocated ${qty} ${u || ''} ${name} to ${proj[0].name}`);
      await addActivity(req.user.full_name, 'allocated', `Allocated ${qty} ${u || ''} ${name} to ${proj[0].name}`, 'project', req.params.id);
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
      return dbError(res, err);
    } finally {
      if (!released) client.release();
    }
  } catch (err) { return dbError(res, err); }
});

// Legacy: allocations for materials, vehicles, tools (separate endpoints)
router.get('/:id/materials', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mt.*, m.name as material_name, m.unit, m.unit_cost
       FROM material_transactions mt
       JOIN materials m ON mt.material_id = m.id
       WHERE mt.project_id = $1 AND mt.type = 'out'
       ORDER BY mt.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.get('/:id/vehicles', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.* FROM vehicles v WHERE v.assigned_project_id = $1 ORDER BY v.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.get('/:id/tools', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.* FROM tools t WHERE t.assigned_project_id = $1 ORDER BY t.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

// ============ PROJECT MANAGERS (PM project-scoping) ============
// A manager can only view finance data for projects they are assigned to.
// Assigned by Owner/Admin.

router.get('/:id/managers', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role
       FROM project_managers pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id=$1 ORDER BY u.full_name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.put('/:id/managers/:userId', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows: u } = await pool.query('SELECT id, role FROM users WHERE id=$1', [req.params.userId]);
    if (u.length === 0) return res.status(404).json({ error: 'User not found' });
    if (u[0].role !== 'manager')
      return res.status(400).json({ error: 'Only users with the Manager role can be assigned to projects' });
    const { rows: proj } = await pool.query('SELECT id FROM projects WHERE id=$1', [req.params.id]);
    if (proj.length === 0) return res.status(404).json({ error: 'Project not found' });
    await pool.query(
      'INSERT INTO project_managers (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, req.params.userId]
    );
    res.status(201).json({ ok: true });
  } catch (err) { return dbError(res, err); }
});

router.delete('/:id/managers/:userId', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM project_managers WHERE project_id=$1 AND user_id=$2', [req.params.id, req.params.userId]);
    res.json({ ok: true });
  } catch (err) { return dbError(res, err); }
});

module.exports = router;
