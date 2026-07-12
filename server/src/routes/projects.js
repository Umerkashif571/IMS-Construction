const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = `SELECT p.*,
      (SELECT COUNT(*) FROM project_allocations WHERE project_id=p.id) as allocation_count,
      (SELECT COALESCE(SUM(mt.quantity * m.unit_cost), 0)
       FROM material_transactions mt
       JOIN materials m ON mt.material_id = m.id
       WHERE mt.project_id = p.id AND mt.type = 'out') as total_material_cost
      FROM projects p WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND p.status = $${idx}`; params.push(status); idx++; }
    if (search) { sql += ` AND (p.name ILIKE $${idx} OR p.client ILIKE $${idx} OR p.location ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    sql += ' ORDER BY p.created_at DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
        (SELECT COALESCE(SUM(mt.quantity * m.unit_cost), 0)
         FROM material_transactions mt
         JOIN materials m ON mt.material_id = m.id
         WHERE mt.project_id = p.id AND mt.type = 'out') as total_material_cost
       FROM projects p WHERE p.id = $1`,
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
    const { name, client, location, city, start_date, end_date, status, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { rows } = await pool.query(
      `INSERT INTO projects (name, client, location, city, start_date, end_date, status, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, client, location, city, start_date, end_date, status || 'planning', description]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'project', rows[0].id, `Created project: ${name}`);
    await addActivity(req.user.full_name, 'created', `Created project: ${name}`, 'project', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', authenticate, authorize('owner', 'admin', 'site_engineer'), async (req, res) => {
  try {
    const { name, client, location, city, start_date, end_date, status, description } = req.body;
    const { rows } = await pool.query(
      `UPDATE projects SET name=$1, client=$2, location=$3, city=$4, start_date=$5, end_date=$6, status=$7, description=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [name, client, location, city, start_date, end_date, status, description, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'project', rows[0].id, `Updated project: ${name}`);
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING name', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'deleted', 'project', req.params.id, `Deleted project: ${rows[0].name}`);
    res.json({ message: 'Project deleted' });
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
    if (!allocation_type || !entity_id) return res.status(400).json({ error: 'Allocation type and entity required' });
    const total_cost = (parseFloat(quantity) || 1) * (parseFloat(unit_cost) || 0);
    const { rows } = await pool.query(
      `INSERT INTO project_allocations (project_id, allocation_type, entity_id, entity_name, quantity, unit, unit_cost, total_cost, notes, allocated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, allocation_type, entity_id, entity_name, quantity || 1, unit, unit_cost, total_cost, notes, req.user.id]
    );
    await addActivity(req.user.full_name, 'allocated', `Allocated ${quantity || 1} ${unit || ''} ${entity_name} to project`, 'project', req.params.id);
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

module.exports = router;
