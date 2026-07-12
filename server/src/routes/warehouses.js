const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT w.*, p.name as project_name FROM warehouses w LEFT JOIN projects p ON w.project_id=p.id ORDER BY w.name'
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM warehouses WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { name, type, location, city, manager_name, contact_phone, project_id } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'Name and type required' });
    if (!project_id) project_id = null;
    const { rows } = await pool.query(
      `INSERT INTO warehouses (name, type, location, city, manager_name, contact_phone, project_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, type, location, city, manager_name, contact_phone, project_id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'warehouse', rows[0].id, `Added warehouse: ${name}`);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { name, type, location, city, manager_name, contact_phone, project_id, is_active } = req.body;
    if (!project_id) project_id = null;
    const { rows } = await pool.query(
      `UPDATE warehouses SET name=$1, type=$2, location=$3, city=$4, manager_name=$5, contact_phone=$6, project_id=$7, is_active=$8, updated_at=NOW() WHERE id=$9 RETURNING *`,
      [name, type, location, city, manager_name, contact_phone, project_id, is_active, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Get material transactions for a warehouse
router.get('/:id/transactions', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, m.name as material_name, m.sku, p.name as project_name
       FROM material_transactions t
       LEFT JOIN materials m ON t.material_id = m.id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.warehouse_id = $1
       ORDER BY t.created_at DESC
       LIMIT 200`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Transfers
router.get('/transfers/list', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM transfer_requests';
    const params = [];
    if (status) { sql += ' WHERE status=$1'; params.push(status); }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/transfers', authenticate, authorize('owner', 'admin', 'store_manager', 'site_engineer'), async (req, res) => {
  try {
    const { request_type, entity_id, entity_name, quantity, from_warehouse_id, to_warehouse_id, notes } = req.body;
    if (!request_type || !entity_id || !from_warehouse_id || !to_warehouse_id)
      return res.status(400).json({ error: 'Missing required fields' });
    const { rows: fw } = await pool.query('SELECT name FROM warehouses WHERE id=$1', [from_warehouse_id]);
    const { rows: tw } = await pool.query('SELECT name FROM warehouses WHERE id=$1', [to_warehouse_id]);
    const { rows } = await pool.query(
      `INSERT INTO transfer_requests (request_type, entity_id, entity_name, quantity, from_warehouse_id, to_warehouse_id, from_warehouse_name, to_warehouse_name, requested_by, requested_by_name, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [request_type, entity_id, entity_name, quantity || 1, from_warehouse_id, to_warehouse_id,
       fw[0].name, tw[0].name, req.user.id, req.user.full_name, notes]
    );
    await addActivity(req.user.full_name, 'requested', `Requested transfer of ${entity_name} from ${fw[0].name} to ${tw[0].name}`, 'transfer', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/transfers/:id', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    const { status } = req.body; // approved, rejected, completed
    const { rows: transfer } = await pool.query('SELECT * FROM transfer_requests WHERE id=$1', [req.params.id]);
    if (transfer.length === 0) return res.status(404).json({ error: 'Transfer not found' });

    if (status === 'approved' || status === 'rejected') {
      await pool.query(
        `UPDATE transfer_requests SET status=$1, approved_by=$2, approved_by_name=$3, updated_at=NOW() WHERE id=$4`,
        [status, req.user.id, req.user.full_name, req.params.id]
      );
      await addActivity(req.user.full_name, 'approved', `${status === 'approved' ? 'Approved' : 'Rejected'} transfer request for ${transfer[0].entity_name}`, 'transfer', req.params.id);
    }
    if (status === 'completed') {
      await pool.query(`UPDATE transfer_requests SET status='completed', updated_at=NOW() WHERE id=$1`, [req.params.id]);
      // Record stock movement for materials
      if (transfer[0].request_type === 'material') {
        const { rows: mat } = await pool.query('SELECT name, unit FROM materials WHERE id=$1', [transfer[0].entity_id]);
        await pool.query(
          `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, reference_type, notes, from_warehouse_id, to_warehouse_id, user_id, user_name)
           VALUES ($1,$2,'transfer_out',$3,$4,'transfer',$5,$6,$7,$8,$9)`,
          [transfer[0].entity_id, mat[0].name, transfer[0].quantity, mat[0].unit, `Transfer to ${transfer[0].to_warehouse_name}`, transfer[0].to_warehouse_id, req.user.id, req.user.full_name]
        );
        await pool.query(
          `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, reference_type, notes, from_warehouse_id, to_warehouse_id, user_id, user_name)
           VALUES ($1,$2,'transfer_in',$3,$4,'transfer',$5,$6,$7,$8,$9)`,
          [transfer[0].entity_id, mat[0].name, transfer[0].quantity, mat[0].unit, `Transfer from ${transfer[0].from_warehouse_name}`, transfer[0].from_warehouse_id, req.user.id, req.user.full_name]
        );
      }
      await addActivity(req.user.full_name, 'completed', `Completed transfer of ${transfer[0].entity_name}`, 'transfer', req.params.id);
    }
    const { rows } = await pool.query('SELECT * FROM transfer_requests WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;