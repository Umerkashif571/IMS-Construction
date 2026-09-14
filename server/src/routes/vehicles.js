const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');
const { requireUuid, isUuid, dbError, toNumber, isDate, maxLen } = require('../middleware/validate');

const router = express.Router();
router.param('id', requireUuid);

// Enum mirrors the CHECK constraint in db/schema.js (vehicles.current_status)
const STATUSES = ['active', 'under_maintenance', 'idle', 'retired'];
const MANAGE_ROLES = ['owner', 'admin', 'store_manager'];

const trimOrNull = (v) => (typeof v === 'string' ? (v.trim() || null) : (v ?? null));

// Money/decimal helper: returns [error, value]. Optional when `v` is null/undefined.
function money(v, label, max = 9999999999) {
  if (v === null || v === undefined) return [null, null];
  const n = toNumber(v);
  if (Number.isNaN(n) || n < 0 || n > max) return [`${label} must be a number between 0 and ${max}`, null];
  return [null, n];
}

// Validates the shared create/edit body; mutates `b` into a normalised form.
function validateVehicleBody(b, { partial = false } = {}) {
  for (const [k, n] of [['registration_no', 100], ['type', 100], ['brand', 100], ['model', 100], ['fuel_type', 50]]) {
    if (k in b) { b[k] = trimOrNull(b[k]); if (!maxLen(b[k], n)) return `${k.replace(/_/g, ' ')} too long (max ${n})`; }
  }
  if (!partial && (!b.registration_no || !b.type)) return 'Registration number and type required';
  if (b.year != null) {
    const n = toNumber(b.year);
    if (Number.isNaN(n) || !Number.isInteger(n) || n < 1900 || n > 2100) return 'Year must be a whole number between 1900 and 2100';
    b.year = n;
  }
  let err;
  [err, b.purchase_cost] = money(b.purchase_cost, 'Purchase cost', 9999999999999); if (err) return err;
  [err, b.tank_capacity] = money(b.tank_capacity, 'Tank capacity', 99999999); if (err) return err;
  [err, b.odometer_reading] = money(b.odometer_reading, 'Odometer reading', 99999999); if (err) return err;
  if (b.current_status != null && !STATUSES.includes(b.current_status)) return `Invalid status (allowed: ${STATUSES.join(', ')})`;
  for (const k of ['purchase_date', 'insurance_expiry', 'registration_expiry']) {
    if (!isDate(b[k])) return `Invalid ${k.replace(/_/g, ' ')}`;
  }
  if (b.assigned_project_id !== undefined) {
    if (!b.assigned_project_id) b.assigned_project_id = null;
    else if (!isUuid(b.assigned_project_id)) return 'Invalid project id';
  }
  return null;
}

// Active vehicle lookup shared by the log/assign handlers (404 for missing or deactivated)
async function getActiveVehicle(db, id) {
  const { rows } = await db.query(
    'SELECT v.*, p.name AS project_name FROM vehicles v LEFT JOIN projects p ON p.id = v.assigned_project_id WHERE v.id=$1 AND v.is_active=true',
    [id]
  );
  return rows[0] || null;
}

router.get('/', authenticate, authorize(...ROLES.FLEET), async (req, res) => {
  try {
    const { status, type, project, search } = req.query;
    let sql = `SELECT v.*, p.name as project_name
               FROM vehicles v LEFT JOIN projects p ON v.assigned_project_id = p.id
               WHERE v.is_active = true`;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND v.current_status = $${idx}`; params.push(status); idx++; }
    if (type) { sql += ` AND v.type ILIKE $${idx}`; params.push(`%${type}%`); idx++; }
    if (project) {
      if (!isUuid(project)) return res.status(400).json({ error: 'Invalid project id' });
      sql += ` AND v.assigned_project_id = $${idx}`; params.push(project); idx++;
    }
    if (search && typeof search === 'string' && search.trim()) {
      sql += ` AND (v.registration_no ILIKE $${idx} OR v.brand ILIKE $${idx} OR v.model ILIKE $${idx})`;
      params.push(`%${search.trim()}%`); idx++;
    }
    sql += ' ORDER BY v.registration_no';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.get('/:id', authenticate, authorize(...ROLES.FLEET), async (req, res) => {
  try {
    const vehicle = await getActiveVehicle(pool, req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) { return dbError(res, err); }
});

router.post('/', authenticate, authorize(...MANAGE_ROLES), async (req, res) => {
  try {
    const b = { ...req.body };
    const verr = validateVehicleBody(b);
    if (verr) return res.status(400).json({ error: verr });
    const { odometer_reading,
      registration_no, type, brand, model, year, purchase_date, purchase_cost, fuel_type, tank_capacity, insurance_expiry, registration_expiry, assigned_project_id, notes, current_status } = b;
    if (assigned_project_id) {
      const { rows: p } = await pool.query('SELECT id FROM projects WHERE id=$1', [assigned_project_id]);
      if (p.length === 0) return res.status(400).json({ error: 'Project not found' });
    }
    const { rows } = await pool.query(
      `INSERT INTO vehicles (registration_no, type, brand, model, year, purchase_date, purchase_cost, fuel_type, tank_capacity, insurance_expiry, registration_expiry, assigned_project_id, notes, current_status, odometer_reading)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15, 0)) RETURNING *`,
      [registration_no, type, brand, model, year ?? null, purchase_date ?? null, purchase_cost, fuel_type, tank_capacity, insurance_expiry ?? null, registration_expiry ?? null, assigned_project_id || null, notes ?? null, current_status || 'active', odometer_reading ?? null]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'vehicle', rows[0].id, `Added vehicle: ${registration_no} (${type})`);
    await addActivity(req.user.full_name, 'created', `Added vehicle ${registration_no} (${type})`, 'vehicle', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Registration number already exists' });
    return dbError(res, err);
  }
});

router.put('/:id', authenticate, authorize(...MANAGE_ROLES), async (req, res) => {
  try {
    const b = { ...req.body };
    const verr = validateVehicleBody(b, { partial: true });
    if (verr) return res.status(400).json({ error: verr });
    const existing = await getActiveVehicle(pool, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Vehicle not found' });
    if (b.assigned_project_id) {
      const { rows: p } = await pool.query('SELECT id FROM projects WHERE id=$1', [b.assigned_project_id]);
      if (p.length === 0) return res.status(400).json({ error: 'Project not found' });
    }
    const { registration_no, type, brand, model, year, purchase_date, purchase_cost, current_status, assigned_project_id, fuel_type, tank_capacity, insurance_expiry, registration_expiry, odometer_reading, notes } = b;
    // COALESCE every field: a partial payload (or a form that does not manage a column, e.g.
    // odometer_reading) must never wipe unrelated data. Project is cleared through /unassign-project.
    const { rows } = await pool.query(
      `UPDATE vehicles SET
         registration_no=COALESCE($1, registration_no), type=COALESCE($2, type), brand=COALESCE($3, brand), model=COALESCE($4, model),
         year=COALESCE($5, year), purchase_date=COALESCE($6, purchase_date), purchase_cost=COALESCE($7, purchase_cost),
         current_status=COALESCE($8, current_status), assigned_project_id=CASE WHEN $17::boolean THEN $9 ELSE assigned_project_id END,
         fuel_type=COALESCE($10, fuel_type), tank_capacity=COALESCE($11, tank_capacity),
         insurance_expiry=COALESCE($12, insurance_expiry), registration_expiry=COALESCE($13, registration_expiry),
         odometer_reading=COALESCE($14, odometer_reading), notes=COALESCE($15, notes), updated_at=NOW()
       WHERE id=$16 AND is_active=true RETURNING *`,
      [registration_no ?? null, type ?? null, brand ?? null, model ?? null, year ?? null, purchase_date ?? null, purchase_cost, current_status ?? null,
       assigned_project_id ?? null, fuel_type ?? null, tank_capacity, insurance_expiry ?? null, registration_expiry ?? null, odometer_reading, notes ?? null, req.params.id, 'assigned_project_id' in req.body]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Vehicle not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'vehicle', rows[0].id, `Updated vehicle: ${rows[0].registration_no}`);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Registration number already exists' });
    return dbError(res, err);
  }
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
  } catch (err) { return dbError(res, err); }
});

// Fuel logs
router.post('/:id/fuel', authenticate, authorize(...MANAGE_ROLES), async (req, res) => {
  const { liters, cost, cost_per_liter, total_cost, odometer_reading, filled_by, notes } = req.body;
  const litersN = toNumber(liters);
  if (litersN === null || Number.isNaN(litersN) || litersN <= 0 || litersN > 99999999) return res.status(400).json({ error: 'Liters must be a number greater than 0' });
  let err, costPerLiter, totalCost, odometer;
  [err, costPerLiter] = money(cost_per_liter, 'Cost per liter', 99999999); if (err) return res.status(400).json({ error: err });
  [err, totalCost] = money(total_cost ?? cost, 'Cost'); if (err) return res.status(400).json({ error: err });
  [err, odometer] = money(odometer_reading, 'Odometer reading', 99999999); if (err) return res.status(400).json({ error: err });
  if (!maxLen(filled_by, 255)) return res.status(400).json({ error: 'Filled by too long (max 255)' });
  const finalCost = totalCost ?? (costPerLiter != null ? Math.round(litersN * costPerLiter * 100) / 100 : 0);

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const { rows: v } = await client.query('SELECT id, odometer_reading FROM vehicles WHERE id=$1 AND is_active=true FOR UPDATE', [req.params.id]);
    if (v.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Vehicle not found' }); }
    const currentOdo = parseFloat(v[0].odometer_reading || 0);
    if (odometer != null && odometer < currentOdo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Odometer reading cannot be lower than the current reading (${currentOdo})` });
    }
    const { rows } = await client.query(
      `INSERT INTO vehicle_fuel_logs (vehicle_id, liters, cost_per_liter, total_cost, odometer_reading, filled_by, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, litersN, costPerLiter, finalCost, odometer, filled_by ?? null, notes ?? null]
    );
    // Odometer only moves forward, and only when a reading was supplied
    if (odometer != null) {
      await client.query('UPDATE vehicles SET odometer_reading=$1, updated_at=NOW() WHERE id=$2 AND $1 >= COALESCE(odometer_reading, 0)', [odometer, req.params.id]);
    }
    await client.query('COMMIT');
    client.release(); released = true;
    res.status(201).json(rows[0]);
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

router.get('/:id/fuel', authenticate, authorize(...ROLES.FLEET), async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM vehicle_fuel_logs WHERE vehicle_id=$1 ORDER BY date DESC LIMIT 50', [req.params.id]);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

// Maintenance logs
router.post('/:id/maintenance', authenticate, authorize(...MANAGE_ROLES), async (req, res) => {
  const { description, service_date, cost, vendor_name, next_due_date, odometer_at_service } = req.body;
  const maintenance_type = trimOrNull(req.body.maintenance_type);
  if (!maintenance_type) return res.status(400).json({ error: 'Maintenance type required' });
  if (!maxLen(maintenance_type, 100)) return res.status(400).json({ error: 'Maintenance type too long (max 100)' });
  if (!maxLen(vendor_name, 255)) return res.status(400).json({ error: 'Vendor name too long (max 255)' });
  if (!isDate(service_date)) return res.status(400).json({ error: 'Invalid service date' });
  if (!isDate(next_due_date)) return res.status(400).json({ error: 'Invalid next due date' });
  let err, costN, odo;
  [err, costN] = money(cost, 'Cost'); if (err) return res.status(400).json({ error: err });
  [err, odo] = money(odometer_at_service, 'Odometer at service', 99999999); if (err) return res.status(400).json({ error: err });

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const { rows: v } = await client.query('SELECT id, registration_no FROM vehicles WHERE id=$1 AND is_active=true FOR UPDATE', [req.params.id]);
    if (v.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Vehicle not found' }); }
    const { rows } = await client.query(
      `INSERT INTO vehicle_maintenance_logs (vehicle_id, maintenance_type, description, service_date, cost, vendor_name, next_due_date, odometer_at_service)
       VALUES ($1,$2,$3,COALESCE($4::timestamptz, NOW()),$5,$6,$7,$8) RETURNING *`,
      [req.params.id, maintenance_type, description ?? null, service_date ?? null, costN, vendor_name ?? null, next_due_date ?? null, odo]
    );
    // Back-filled history must not move last_maintenance_date backwards or erase the upcoming due date
    await client.query(
      `UPDATE vehicles SET
         last_maintenance_date = GREATEST(COALESCE(last_maintenance_date, '1900-01-01'::date), COALESCE($1::timestamptz, NOW())::date),
         next_maintenance_date = COALESCE($2::date, next_maintenance_date),
         updated_at = NOW()
       WHERE id=$3`,
      [service_date ?? null, next_due_date ?? null, req.params.id]
    );
    await client.query('COMMIT');
    client.release(); released = true;
    await addActivity(req.user.full_name, 'maintenance', `Maintenance logged for vehicle ${v[0].registration_no}`, 'vehicle', req.params.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

router.get('/:id/maintenance', authenticate, authorize(...ROLES.FLEET), async (req, res) => {
  try { const { rows } = await pool.query('SELECT * FROM vehicle_maintenance_logs WHERE vehicle_id=$1 ORDER BY service_date DESC LIMIT 50', [req.params.id]);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

// Assign/Reassign vehicle to project
router.post('/:id/assign-project', authenticate, authorize(...MANAGE_ROLES), async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'Project ID required' });
    if (!isUuid(project_id)) return res.status(400).json({ error: 'Invalid project id' });

    const vehicle = await getActiveVehicle(pool, req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const oldProjectId = vehicle.assigned_project_id;
    const oldProjectName = vehicle.project_name || null;

    const { rows: proj } = await pool.query('SELECT name FROM projects WHERE id=$1', [project_id]);
    if (proj.length === 0) return res.status(400).json({ error: 'Project not found' });
    const newProjectName = proj[0].name;

    const { rows } = await pool.query(
      'UPDATE vehicles SET assigned_project_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [project_id, req.params.id]
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
  } catch (err) { return dbError(res, err); }
});

// Unassign vehicle from project
router.post('/:id/unassign-project', authenticate, authorize(...MANAGE_ROLES), async (req, res) => {
  try {
    const vehicle = await getActiveVehicle(pool, req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const oldProjectId = vehicle.assigned_project_id;
    const oldProjectName = vehicle.project_name || null;

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
  } catch (err) { return dbError(res, err); }
});

module.exports = router;
