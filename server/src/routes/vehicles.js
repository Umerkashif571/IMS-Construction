const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, type, project } = req.query;
    let sql = `SELECT v.*, p.name as project_name
               FROM vehicles v LEFT JOIN projects p ON v.assigned_project_id = p.id
               WHERE v.is_active = true`;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND v.current_status = $${idx}`; params.push(status); idx++; }
    if (type) { sql += ` AND v.type ILIKE $${idx}`; params.push(`%${type}%`); idx++; }
    if (project) { sql += ` AND v.assigned_project_id = $${idx}`; params.push(project); idx++; }
    sql += ' ORDER BY v.registration_no';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT v.*, p.name as project_name FROM vehicles v LEFT JOIN projects p ON v.assigned_project_id = p.id WHERE v.id=$1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { registration_no, type, brand, model, year, purchase_date, purchase_cost, fuel_type, tank_capacity, insurance_expiry, registration_expiry, assigned_project_id, notes } = req.body;
    if (!registration_no || !type) return res.status(400).json({ error: 'Registration number and type required' });
    if (!assigned_project_id) assigned_project_id = null;
    const { rows } = await pool.query(
      `INSERT INTO vehicles (registration_no, type, brand, model, year, purchase_date, purchase_cost, fuel_type, tank_capacity, insurance_expiry, registration_expiry, assigned_project_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [registration_no, type, brand, model, year, purchase_date, purchase_cost, fuel_type, tank_capacity, insurance_expiry, registration_expiry, assigned_project_id, notes]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'vehicle', rows[0].id, `Added vehicle: ${registration_no} (${type})`);
    await addActivity(req.user.full_name, 'created', `Added vehicle ${registration_no} (${type})`, 'vehicle', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Registration number already exists' });
    console.error(err); res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { type, brand, model, year, purchase_date, purchase_cost, current_status, assigned_project_id, fuel_type, tank_capacity, insurance_expiry, registration_expiry, odometer_reading, notes } = req.body;
    if (!assigned_project_id) assigned_project_id = null;
    const { rows } = await pool.query(
      `UPDATE vehicles SET type=$1, brand=$2, model=$3, year=$4, purchase_date=$5, purchase_cost=$6, current_status=$7, assigned_project_id=$8, fuel_type=$9, tank_capacity=$10, insurance_expiry=$11, registration_expiry=$12, odometer_reading=$13, notes=$14, updated_at=NOW() WHERE id=$15 RETURNING *`,
      [type, brand, model, year, purchase_date, purchase_cost, current_status, assigned_project_id, fuel_type, tank_capacity, insurance_expiry, registration_expiry, odometer_reading, notes, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Vehicle not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'vehicle', rows[0].id, `Updated vehicle: ${rows[0].registration_no}`);
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE vehicles SET is_active=false, updated_at=NOW() WHERE id=$1 AND is_active = true RETURNING registration_no',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Vehicle not found or already deactivated' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'deleted', 'vehicle', req.params.id, `Deactivated vehicle: ${rows[0].registration_no}`);
    await addActivity(req.user.full_name, 'deleted', `Deactivated vehicle ${rows[0].registration_no}`, 'vehicle', req.params.id);
    res.json({ message: 'Vehicle deactivated' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Fuel logs
router.post('/:id/fuel', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try { const { liters, cost, cost_per_liter, total_cost, odometer_reading, filled_by, notes } = req.body;
    if (!liters) return res.status(400).json({ error: 'Liters required' });
    const finalCost = total_cost || cost || (cost_per_liter ? liters * cost_per_liter : 0);
    const { rows } = await pool.query(
      `INSERT INTO vehicle_fuel_logs (vehicle_id, liters, cost_per_liter, total_cost, odometer_reading, filled_by, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, liters, cost_per_liter, finalCost, odometer_reading, filled_by, notes]
    );
    await pool.query('UPDATE vehicles SET odometer_reading=$1 WHERE id=$2', [odometer_reading || 0, req.params.id]);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/fuel', authenticate, async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM vehicle_fuel_logs WHERE vehicle_id=$1 ORDER BY date DESC LIMIT 50', [req.params.id]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Maintenance logs
router.post('/:id/maintenance', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try { const { maintenance_type, description, service_date, cost, vendor_name, next_due_date, odometer_at_service } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO vehicle_maintenance_logs (vehicle_id, maintenance_type, description, service_date, cost, vendor_name, next_due_date, odometer_at_service) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, maintenance_type, description, service_date || new Date(), cost, vendor_name, next_due_date, odometer_at_service]
    );
    await pool.query('UPDATE vehicles SET last_maintenance_date=$1, next_maintenance_date=$2 WHERE id=$3', [service_date || new Date(), next_due_date, req.params.id]);
    await addActivity(req.user.full_name, 'maintenance', `Maintenance logged for vehicle`, 'vehicle', req.params.id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/maintenance', authenticate, async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM vehicle_maintenance_logs WHERE vehicle_id=$1 ORDER BY service_date DESC LIMIT 50', [req.params.id]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Assign/Reassign vehicle to project
router.post('/:id/assign-project', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'Project ID required' });

    const { rows: vehicle } = await pool.query('SELECT * FROM vehicles WHERE id=$1 AND is_active=true', [req.params.id]);
    if (vehicle.length === 0) return res.status(404).json({ error: 'Vehicle not found' });

    const oldProjectId = vehicle[0].assigned_project_id;
    const oldProjectName = vehicle[0].project_name || null;

    let newProjectName = null;
    if (project_id) {
      const { rows: proj } = await pool.query('SELECT name FROM projects WHERE id=$1', [project_id]);
      if (proj.length === 0) return res.status(400).json({ error: 'Project not found' });
      newProjectName = proj[0].name;
    }

    const { rows } = await pool.query(
      'UPDATE vehicles SET assigned_project_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [project_id || null, req.params.id]
    );

    const action = oldProjectId ? 'reassigned' : 'assigned';
    const desc = oldProjectId
      ? `Reassigned vehicle ${rows[0].registration_no} from project "${oldProjectName}" to "${newProjectName}"`
      : `Assigned vehicle ${rows[0].registration_no} to project "${newProjectName}"`;

    await logAudit(
      req.user.id, req.user.full_name, req.user.role,
      action, 'vehicle', rows[0].id, desc,
      { old_project_id: oldProjectId, old_project_name: oldProjectName, new_project_id: project_id, new_project_name: newProjectName }
    );
    await addActivity(req.user.full_name, action, desc, 'vehicle', rows[0].id);

    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Unassign vehicle from project
router.post('/:id/unassign-project', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    const { rows: vehicle } = await pool.query('SELECT * FROM vehicles WHERE id=$1 AND is_active=true', [req.params.id]);
    if (vehicle.length === 0) return res.status(404).json({ error: 'Vehicle not found' });

    const oldProjectId = vehicle[0].assigned_project_id;
    const oldProjectName = vehicle[0].project_name || null;

    if (!oldProjectId) return res.status(400).json({ error: 'Vehicle is not assigned to any project' });

    const { rows } = await pool.query(
      'UPDATE vehicles SET assigned_project_id=NULL, updated_at=NOW() WHERE id=$1 RETURNING *',
      [req.params.id]
    );

    const desc = `Unassigned vehicle ${rows[0].registration_no} from project "${oldProjectName}"`;

    await logAudit(
      req.user.id, req.user.full_name, req.user.role,
      'unassigned', 'vehicle', rows[0].id, desc,
      { old_project_id: oldProjectId, old_project_name: oldProjectName }
    );
    await addActivity(req.user.full_name, 'unassigned', desc, 'vehicle', rows[0].id);

    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;