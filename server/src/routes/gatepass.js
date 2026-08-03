const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles } = require('../db/helpers');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM gate_passes ORDER BY created_at DESC LIMIT 200');
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM gate_passes WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Gate pass not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, authorize('owner', 'admin', 'store_manager', 'manager', 'staff'), async (req, res) => {
  try {
    const { material_id, material_name, quantity, unit, project_id, project_name, vehicle_number, driver_name, destination, authorized_by, notes } = req.body;
    if (!material_id || !quantity || !vehicle_number || !driver_name) return res.status(400).json({ error: 'Missing required fields' });
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: 'Quantity must be a positive number' });

    const { rows: material } = await pool.query('SELECT id, name, unit, quantity FROM materials WHERE id=$1 AND is_active = true', [material_id]);
    if (material.length === 0) return res.status(400).json({ error: 'Material not found' });
    const materialName = material_name || material[0].name;

    const gpNo = 'GP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const { rows } = await pool.query(
      `INSERT INTO gate_passes (gate_pass_no, material_id, material_name, quantity, unit, project_id, project_name, vehicle_number, driver_name, destination, issued_by, authorized_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [gpNo, material_id, materialName, qty, unit, project_id, project_name, vehicle_number, driver_name, destination, req.user.full_name, authorized_by, notes]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'gate_pass', rows[0].id,
      `Gate pass ${gpNo} issued for ${qty} ${unit || ''} of ${materialName} (vehicle: ${vehicle_number})`);
    await addActivity(req.user.full_name, 'gate_pass', `Gate pass ${gpNo} issued for ${materialName}`, 'gate_pass', rows[0].id);
    await notifyRoles(['owner', 'admin'], 'gate_pass',
      `Gate pass ${gpNo} issued`,
      `${req.user.full_name} issued gate pass ${gpNo} for ${qty} ${unit || ''} of ${materialName} (vehicle: ${vehicle_number})`,
      `/gatepass/${rows[0].id}`, 'gate_pass', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
