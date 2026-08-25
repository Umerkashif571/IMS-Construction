const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Optimized query using LEFT JOIN with aggregation instead of correlated subqueries
    let sql = `
      SELECT p.*,
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, authorize('owner', 'admin', 'site_engineer'), async (req, res) => {
  try {
    const { name, client, location, city, start_date, end_date, status, description, project_cost_value } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const VALID_STATUS = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
    if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const finalStatus = VALID_STATUS.includes(status) ? status : 'planning';
    if (start_date && isNaN(Date.parse(start_date))) return res.status(400).json({ error: 'Invalid start date' });
    if (end_date && isNaN(Date.parse(end_date))) return res.status(400).json({ error: 'Invalid end date' });
    if (start_date && end_date && new Date(end_date) < new Date(start_date))
      return res.status(400).json({ error: 'End date cannot be before start date' });
    const costValue = parseFloat(project_cost_value);
    const pcv = isNaN(costValue) || costValue < 0 ? 0 : costValue;
    const { rows } = await pool.query(
      `INSERT INTO projects (name, client, location, city, start_date, end_date, status, description, project_cost_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, client, location, city, start_date, end_date, finalStatus, description, pcv]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'project', rows[0].id, `Created project: ${name}`);
    await addActivity(req.user.full_name, 'created', `Created project: ${name}`, 'project', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', authenticate, authorize('owner', 'admin', 'site_engineer'), async (req, res) => {
  try {
    const { name, client, location, city, start_date, end_date, status, description, project_cost_value } = req.body;
    const VALID_STATUS = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
    if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (start_date && isNaN(Date.parse(start_date))) return res.status(400).json({ error: 'Invalid start date' });
    if (end_date && isNaN(Date.parse(end_date))) return res.status(400).json({ error: 'Invalid end date' });
    if (!name && !client && !location && !city && !start_date && !end_date && !status && !description && project_cost_value === undefined)
      return res.status(400).json({ error: 'No fields to update' });
    const costValue = parseFloat(project_cost_value);
    const pcv = isNaN(costValue) || costValue < 0 ? 0 : costValue;
    const { rows } = await pool.query(
      `UPDATE projects SET name=COALESCE($1,name), client=COALESCE($2,client), location=COALESCE($3,location), city=COALESCE($4,city), start_date=COALESCE($5,start_date), end_date=COALESCE($6,end_date), status=COALESCE($7,status), description=COALESCE($8,description), project_cost_value=COALESCE($9,project_cost_value), updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [name ?? null, client ?? null, location ?? null, city ?? null, start_date ?? null, end_date ?? null, status ?? null, description ?? null, pcv, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'project', rows[0].id, `Updated project: ${rows[0].name}`);
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Allocations
router.get('/:id/allocations', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM project_allocations WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/allocations', authenticate, authorize('owner', 'admin', 'site_engineer', 'store_manager'), async (req, res) => {
  try {
    const { allocation_type, entity_id, entity_name, quantity, unit, unit_cost, notes } = req.body;
    const VALID_TYPES = ['material', 'vehicle', 'tool'];
    if (!allocation_type || !entity_id) return res.status(400).json({ error: 'Allocation type and entity required' });
    if (!VALID_TYPES.includes(allocation_type)) return res.status(400).json({ error: 'Invalid allocation type' });
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: 'Quantity must be a positive number' });
    const cost = parseFloat(unit_cost);
    if (unit_cost !== undefined && (isNaN(cost) || cost < 0)) return res.status(400).json({ error: 'Invalid unit cost' });
    const total_cost = qty * (isNaN(cost) ? 0 : cost);
    const { rows } = await pool.query(
      `INSERT INTO project_allocations (project_id, allocation_type, entity_id, entity_name, quantity, unit, unit_cost, total_cost, notes, allocated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, allocation_type, entity_id, entity_name, qty, unit, cost, total_cost, notes, req.user.id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'allocated', 'project_allocation', rows[0].id, `Allocated ${qty} ${unit || ''} ${entity_name} to project`);
    await addActivity(req.user.full_name, 'allocated', `Allocated ${qty} ${unit || ''} ${entity_name} to project`, 'project', req.params.id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/vehicles', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.* FROM vehicles v WHERE v.assigned_project_id = $1 ORDER BY v.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/tools', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.* FROM tools t WHERE t.assigned_project_id = $1 ORDER BY t.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id/managers/:userId', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows: u } = await pool.query('SELECT id, role FROM users WHERE id=$1', [req.params.userId]);
    if (u.length === 0) return res.status(404).json({ error: 'User not found' });
    if (u[0].role !== 'manager')
      return res.status(400).json({ error: 'Only users with the Manager role can be assigned to projects' });
    await pool.query(
      'INSERT INTO project_managers (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, req.params.userId]
    );
    res.status(201).json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id/managers/:userId', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM project_managers WHERE project_id=$1 AND user_id=$2', [req.params.id, req.params.userId]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
