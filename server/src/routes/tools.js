const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, condition, type, project } = req.query;
    let sql = `SELECT t.*, p.name as project_name, w.name as warehouse_name
               FROM tools t LEFT JOIN projects p ON t.assigned_project_id = p.id
               LEFT JOIN warehouses w ON t.warehouse_id = w.id WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND t.current_status = $${idx}`; params.push(status); idx++; }
    if (condition) { sql += ` AND t.current_condition = $${idx}`; params.push(condition); idx++; }
    if (type) { sql += ` AND t.type ILIKE $${idx}`; params.push(`%${type}%`); idx++; }
    if (project) { sql += ` AND t.assigned_project_id = $${idx}`; params.push(project); idx++; }
    sql += ' ORDER BY t.name';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT t.*, p.name as project_name FROM tools t LEFT JOIN projects p ON t.assigned_project_id = p.id WHERE t.id=$1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Tool not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { name, serial_number, type, category, description, purchase_date, purchase_cost, current_condition, current_status, next_maintenance_date, warehouse_id, storage_location, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    if (!warehouse_id) warehouse_id = null;
    const { rows } = await pool.query(
      `INSERT INTO tools (name, serial_number, type, category, description, purchase_date, purchase_cost, current_condition, current_status, next_maintenance_date, warehouse_id, storage_location, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [name, serial_number, type, category, description, purchase_date, purchase_cost, current_condition || 'good', current_status || 'available', next_maintenance_date, warehouse_id, storage_location, notes]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'tool', rows[0].id, `Added tool: ${name}`);
    await addActivity(req.user.full_name, 'created', `Added tool: ${name}`, 'tool', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { if (err.code === '23505') return res.status(400).json({ error: 'Serial number already exists' }); console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { name, serial_number, type, category, description, current_condition, current_status, purchase_date, purchase_cost, next_maintenance_date, maintenance_interval_days, checked_out_to, checked_out_employee, assigned_project_id, return_due_date, warehouse_id, storage_location, notes } = req.body;
    if (!assigned_project_id) assigned_project_id = null;
    if (!warehouse_id) warehouse_id = null;
    const { rows } = await pool.query(
      `UPDATE tools SET name=$1, serial_number=$2, type=$3, category=$4, description=$5, current_condition=$6, current_status=$7, purchase_date=$8, purchase_cost=$9, next_maintenance_date=$10, maintenance_interval_days=$11, checked_out_to=$12, checked_out_employee=$13, assigned_project_id=$14, return_due_date=$15, warehouse_id=$16, storage_location=$17, notes=$18, updated_at=NOW() WHERE id=$19 RETURNING *`,
      [name, serial_number, type, category, description, current_condition, current_status, purchase_date, purchase_cost, next_maintenance_date, maintenance_interval_days, checked_out_to, checked_out_employee, assigned_project_id, return_due_date, warehouse_id, storage_location, notes, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Tool not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'tool', rows[0].id, `Updated tool: ${name}`);
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM tools WHERE id=$1 RETURNING name', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Tool not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'deleted', 'tool', req.params.id, `Deleted tool: ${rows[0].name}`);
    res.json({ message: 'Tool deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Checkout / Checkin
router.post('/:id/checkout', authenticate, authorize('owner', 'admin', 'store_manager', 'site_engineer'), async (req, res) => {
  try {
    let { checked_out_to, employee_name, assigned_project_id, expected_return_date, notes } = req.body;
    if (!checked_out_to) return res.status(400).json({ error: 'Checked out to required' });
    if (!assigned_project_id) assigned_project_id = null;
    const { rows: tool } = await pool.query('SELECT * FROM tools WHERE id=$1', [req.params.id]);
    if (tool.length === 0) return res.status(404).json({ error: 'Tool not found' });
    await pool.query(
      `UPDATE tools SET current_status='checked_out', checked_out_to=$1, checked_out_employee=$2, assigned_project_id=$3, return_due_date=$4 WHERE id=$5`,
      [checked_out_to, employee_name, assigned_project_id, expected_return_date, req.params.id]
    );
    await pool.query(
      `INSERT INTO tool_checkout_log (tool_id, tool_name, checked_out_to, employee_name, assigned_project_id, expected_return_date, notes, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.params.id, tool[0].name, checked_out_to, employee_name, assigned_project_id, expected_return_date, notes, req.user.id]
    );
    await addActivity(req.user.full_name, 'checked_out', `Checked out ${tool[0].name} to ${checked_out_to}`, 'tool', req.params.id);
    res.json({ message: 'Tool checked out' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/checkin', authenticate, authorize('owner', 'admin', 'store_manager', 'site_engineer'), async (req, res) => {
  try {
    const { condition_on_return, notes, returned_by } = req.body;
    if (!returned_by) return res.status(400).json({ error: 'Returned by is required' });

    // Get current tool data before update
    const { rows: tool } = await pool.query('SELECT * FROM tools WHERE id=$1', [req.params.id]);
    if (tool.length === 0) return res.status(404).json({ error: 'Tool not found' });

    const checkedOutTo = tool[0].checked_out_to;

    // If condition is damaged or poor, flag for maintenance
    const needsMaintenance = ['damaged', 'poor'].includes(condition_on_return);
    const newStatus = needsMaintenance ? 'under_maintenance' : 'available';

    await pool.query(
      `UPDATE tools SET current_status=$1, checked_out_to=NULL, checked_out_employee=NULL, assigned_project_id=NULL, return_due_date=NULL, current_condition=$2 WHERE id=$3`,
      [newStatus, condition_on_return || 'good', req.params.id]
    );

    await pool.query(
      `UPDATE tool_checkout_log SET actual_return_date=NOW(), condition_on_return=$1, returned_by=$2, notes=CASE WHEN notes IS NULL THEN $3 ELSE notes || ' | Return: ' || $3 END WHERE tool_id=$4 AND actual_return_date IS NULL`,
      [condition_on_return, returned_by, notes, req.params.id]
    );

    // Audit log entry
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'check_in', 'tool', req.params.id,
      `Checked in ${tool[0].name} (checked out to: ${checkedOutTo}, returned by: ${returned_by}, condition: ${condition_on_return || 'good'})`);

    await addActivity(req.user.full_name, 'checked_in', `Checked in ${tool[0].name} (returned by: ${returned_by})`, 'tool', req.params.id);
    res.json({ message: 'Tool checked in' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/checkout-history', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tool_checkout_log WHERE tool_id=$1 ORDER BY created_at DESC LIMIT 50', [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;