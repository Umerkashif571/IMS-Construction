const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');
const { requireUuid, dbError, isUuid, toNumber, maxLen } = require('../middleware/validate');

const router = express.Router();
router.param('id', requireUuid);

const WAREHOUSE_TYPES = ['main_store', 'site_store', 'warehouse'];
const TRANSFER_TYPES = ['material', 'tool', 'vehicle'];
// State machine for transfer requests
const TRANSFER_TRANSITIONS = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['completed', 'cancelled'],
  rejected: [],
  completed: [],
  cancelled: [],
};
const MAX_QTY = 1e13;

function validateWarehouseBody({ name, type, location, city, manager_name, contact_phone, project_id }, partial = false) {
  if (!partial || name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return 'Name is required';
    if (!maxLen(name, 255)) return 'Name too long (max 255)';
  }
  if (!partial || type !== undefined) {
    if (!WAREHOUSE_TYPES.includes(type)) return `Type must be one of: ${WAREHOUSE_TYPES.join(', ')}`;
  }
  if (!maxLen(location, 5000)) return 'Location too long';
  if (!maxLen(city, 100)) return 'City too long (max 100)';
  if (!maxLen(manager_name, 255)) return 'Manager name too long (max 255)';
  if (!maxLen(contact_phone, 100)) return 'Contact phone too long (max 100)';
  if (project_id != null && !isUuid(project_id)) return 'Invalid project id';
  return null;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { search, active } = req.query;
    let sql = 'SELECT w.*, p.name as project_name FROM warehouses w LEFT JOIN projects p ON w.project_id=p.id WHERE 1=1';
    const params = [];
    if (search && typeof search === 'string') {
      params.push(`%${search}%`);
      sql += ` AND (w.name ILIKE $${params.length} OR w.city ILIKE $${params.length} OR w.location ILIKE $${params.length})`;
    }
    if (active === 'true') sql += ' AND w.is_active = true';
    sql += ' ORDER BY w.name';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

// ---- Transfers (declared before /:id so 'transfers' is never parsed as an id) ----

router.get('/transfers/list', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM transfer_requests';
    const params = [];
    if (status) {
      if (!Object.keys(TRANSFER_TRANSITIONS).includes(status)) return res.status(400).json({ error: 'Invalid status' });
      sql += ' WHERE status=$1'; params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.post('/transfers', authenticate, authorize('owner', 'admin', 'store_manager', 'site_engineer'), async (req, res) => {
  try {
    const { request_type, entity_id, quantity, from_warehouse_id, to_warehouse_id, notes } = req.body;
    if (!request_type || !entity_id || !from_warehouse_id || !to_warehouse_id)
      return res.status(400).json({ error: 'Missing required fields' });
    if (!TRANSFER_TYPES.includes(request_type)) return res.status(400).json({ error: `request_type must be one of: ${TRANSFER_TYPES.join(', ')}` });
    if (!isUuid(entity_id) || !isUuid(from_warehouse_id) || !isUuid(to_warehouse_id)) return res.status(400).json({ error: 'Invalid id format' });
    if (from_warehouse_id === to_warehouse_id) return res.status(400).json({ error: 'Source and destination warehouse must differ' });
    if (!maxLen(notes, 5000)) return res.status(400).json({ error: 'Notes too long' });

    let qty = 1;
    if (request_type === 'material') {
      const n = toNumber(quantity);
      if (n === null || Number.isNaN(n) || n <= 0 || n >= MAX_QTY) return res.status(400).json({ error: 'Quantity must be a positive number' });
      qty = Math.round(n * 100) / 100;
      if (qty < 0.01) return res.status(400).json({ error: 'Quantity must be at least 0.01' });
    } else if (quantity != null) {
      const n = toNumber(quantity);
      if (n !== 1) return res.status(400).json({ error: `Quantity must be 1 for a ${request_type} transfer` });
    }

    const { rows: fw } = await pool.query('SELECT name, is_active FROM warehouses WHERE id=$1', [from_warehouse_id]);
    if (!fw.length) return res.status(404).json({ error: 'Source warehouse not found' });
    const { rows: tw } = await pool.query('SELECT name, is_active FROM warehouses WHERE id=$1', [to_warehouse_id]);
    if (!tw.length) return res.status(404).json({ error: 'Destination warehouse not found' });
    if (tw[0].is_active === false) return res.status(400).json({ error: 'Destination warehouse is inactive' });

    // Entity must exist; the stored name always comes from the database, never the client.
    let entityName;
    if (request_type === 'material') {
      const { rows } = await pool.query('SELECT name, quantity, warehouse_id FROM materials WHERE id=$1 AND is_active = true', [entity_id]);
      if (!rows.length) return res.status(404).json({ error: 'Material not found' });
      if (rows[0].warehouse_id && rows[0].warehouse_id !== from_warehouse_id) return res.status(400).json({ error: 'Material is not stocked in the source warehouse' });
      const available = parseFloat(rows[0].quantity);
      if (!Number.isFinite(available) || qty > available) return res.status(400).json({ error: `Insufficient stock. Available: ${Number.isFinite(available) ? available : 0}` });
      entityName = rows[0].name;
    } else if (request_type === 'tool') {
      const { rows } = await pool.query('SELECT name FROM tools WHERE id=$1', [entity_id]);
      if (!rows.length) return res.status(404).json({ error: 'Tool not found' });
      entityName = rows[0].name;
    } else {
      const { rows } = await pool.query('SELECT registration_no FROM vehicles WHERE id=$1', [entity_id]);
      if (!rows.length) return res.status(404).json({ error: 'Vehicle not found' });
      entityName = rows[0].registration_no;
    }

    const { rows } = await pool.query(
      `INSERT INTO transfer_requests (request_type, entity_id, entity_name, quantity, from_warehouse_id, to_warehouse_id, from_warehouse_name, to_warehouse_name, requested_by, requested_by_name, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [request_type, entity_id, entityName, qty, from_warehouse_id, to_warehouse_id,
       fw[0].name, tw[0].name, req.user.id, req.user.full_name, notes || null]
    );
    await addActivity(req.user.full_name, 'requested', `Requested transfer of ${entityName} from ${fw[0].name} to ${tw[0].name}`, 'transfer', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

// Completes a material transfer inside the caller's transaction: moves quantity from the source
// material row to the matching row in the destination warehouse (created if absent), writes the
// ledger rows for both sides. Returns { status, error } on a business-rule failure, else null.
async function completeMaterialTransfer(client, transfer, user) {
  const qty = parseFloat(transfer.quantity);
  const { rows: srcRows } = await client.query('SELECT * FROM materials WHERE id=$1 AND is_active = true FOR UPDATE', [transfer.entity_id]);
  if (!srcRows.length) return { status: 404, error: 'Material not found' };
  const src = srcRows[0];
  const available = parseFloat(src.quantity);
  if (!Number.isFinite(available) || qty > available) return { status: 400, error: `Insufficient stock. Available: ${Number.isFinite(available) ? available : 0} ${src.unit}` };

  const { rows: whRows } = await client.query('SELECT id, name, is_active FROM warehouses WHERE id = ANY($1::uuid[])', [[transfer.from_warehouse_id, transfer.to_warehouse_id]]);
  const toWh = whRows.find(w => w.id === transfer.to_warehouse_id);
  if (!toWh) return { status: 404, error: 'Destination warehouse not found' };
  if (toWh.is_active === false) return { status: 400, error: 'Destination warehouse is inactive' };

  const outNote = `Transfer to ${transfer.to_warehouse_name || toWh.name}`;
  const inNote = `Transfer from ${transfer.from_warehouse_name || ''}`.trim();

  // Destination row: same SKU in the destination warehouse (or the per-warehouse SKU variant /
  // same name+unit, since materials.sku is globally UNIQUE).
  const derivedSku = `${src.sku}@${String(transfer.to_warehouse_id).slice(0, 8)}`;
  const { rows: dstRows } = await client.query(
    `SELECT * FROM materials
     WHERE warehouse_id = $1 AND is_active = true AND id <> $2
       AND (sku = $3 OR sku = $4 OR (lower(name) = lower($5) AND unit = $6))
     ORDER BY (sku = $3) DESC, (sku = $4) DESC, created_at ASC
     LIMIT 1 FOR UPDATE`,
    [transfer.to_warehouse_id, src.id, src.sku, derivedSku, src.name, src.unit]
  );

  let dst = dstRows[0] || null;
  let srcNewQty;
  let dstNewQty;

  if (!dst && qty === available) {
    // Whole stock moves and nothing exists at the destination: re-home the row (keeps the SKU).
    await client.query('UPDATE materials SET warehouse_id=$1, updated_at=NOW() WHERE id=$2', [transfer.to_warehouse_id, src.id]);
    dst = src;
    srcNewQty = 0;
    dstNewQty = available;
  } else {
    const { rows: upd } = await client.query(
      'UPDATE materials SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2 AND quantity >= $1 RETURNING quantity',
      [qty, src.id]
    );
    if (!upd.length) return { status: 400, error: `Insufficient stock. Available: ${available} ${src.unit}` };
    srcNewQty = parseFloat(upd[0].quantity);

    if (dst) {
      const { rows: upd2 } = await client.query(
        'UPDATE materials SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2 RETURNING quantity',
        [qty, dst.id]
      );
      dstNewQty = parseFloat(upd2[0].quantity);
    } else {
      const { rows: ins } = await client.query(
        `INSERT INTO materials (sku, name, description, category_id, unit, quantity, reorder_level, unit_cost, supplier_id, storage_location, warehouse_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [derivedSku, src.name, src.description, src.category_id, src.unit, qty, src.reorder_level, src.unit_cost, src.supplier_id, null, transfer.to_warehouse_id]
      );
      dst = ins[0];
      dstNewQty = qty;
    }
  }

  // Ledger: material_transactions (warehouse views) + stock_movements (movement history), both sides.
  await client.query(
    `INSERT INTO material_transactions (material_id, type, quantity, running_total, warehouse_id, added_by, notes, transaction_type)
     VALUES ($1, 'out', $2, $3, $4, $5, $6, 'transfer')`,
    [src.id, qty, srcNewQty, transfer.from_warehouse_id, user.full_name, outNote]
  );
  await client.query(
    `INSERT INTO material_transactions (material_id, type, quantity, running_total, warehouse_id, added_by, notes, transaction_type)
     VALUES ($1, 'in', $2, $3, $4, $5, $6, 'transfer')`,
    [dst.id, qty, dstNewQty, transfer.to_warehouse_id, user.full_name, inNote]
  );
  await client.query(
    `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, reference_type, reference_id, notes, warehouse_id, from_warehouse_id, to_warehouse_id, user_id, user_name)
     VALUES ($1,$2,'transfer_out',$3,$4,'transfer',$5,$6,$7,$8,$9,$10,$11)`,
    [src.id, src.name, qty, src.unit, transfer.id, outNote, transfer.from_warehouse_id, transfer.from_warehouse_id, transfer.to_warehouse_id, user.id, user.full_name]
  );
  await client.query(
    `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, reference_type, reference_id, notes, warehouse_id, from_warehouse_id, to_warehouse_id, user_id, user_name)
     VALUES ($1,$2,'transfer_in',$3,$4,'transfer',$5,$6,$7,$8,$9,$10,$11)`,
    [dst.id, dst.name, qty, dst.unit, transfer.id, inNote, transfer.to_warehouse_id, transfer.from_warehouse_id, transfer.to_warehouse_id, user.id, user.full_name]
  );
  return null;
}

router.put('/transfers/:id', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  const { status, notes } = req.body || {}; // approved, rejected, completed, cancelled
  if (!['approved', 'rejected', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (!maxLen(notes, 5000)) return res.status(400).json({ error: 'Notes too long' });

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const { rows: tr } = await client.query('SELECT * FROM transfer_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (tr.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Transfer not found' }); }
    const transfer = tr[0];

    const allowed = TRANSFER_TRANSITIONS[transfer.status] || [];
    if (!allowed.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot change a ${transfer.status} transfer to ${status}` });
    }
    if ((status === 'approved' || status === 'rejected') && transfer.requested_by === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot approve or reject your own transfer request' });
    }

    if (status === 'approved' || status === 'rejected') {
      await client.query(
        `UPDATE transfer_requests SET status=$1, approved_by=$2, approved_by_name=$3, notes=COALESCE($4, notes), updated_at=NOW() WHERE id=$5`,
        [status, req.user.id, req.user.full_name, notes || null, req.params.id]
      );
    } else if (status === 'cancelled') {
      await client.query(`UPDATE transfer_requests SET status='cancelled', notes=COALESCE($1, notes), updated_at=NOW() WHERE id=$2`, [notes || null, req.params.id]);
    } else {
      // completed: perform the physical move atomically with the status change
      if (transfer.request_type === 'material') {
        const fail = await completeMaterialTransfer(client, transfer, req.user);
        if (fail) { await client.query('ROLLBACK'); return res.status(fail.status).json({ error: fail.error }); }
      } else if (transfer.request_type === 'tool') {
        const { rows } = await client.query('UPDATE tools SET warehouse_id=$1, updated_at=NOW() WHERE id=$2 RETURNING id', [transfer.to_warehouse_id, transfer.entity_id]);
        if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Tool not found' }); }
      } else if (transfer.request_type === 'vehicle') {
        // Vehicles have no warehouse column; follow the destination warehouse's project when it has one.
        const { rows } = await client.query(
          `UPDATE vehicles v SET assigned_project_id = COALESCE(w.project_id, v.assigned_project_id), updated_at=NOW()
           FROM warehouses w WHERE w.id=$1 AND v.id=$2 RETURNING v.id`,
          [transfer.to_warehouse_id, transfer.entity_id]
        );
        if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Vehicle not found' }); }
      }
      await client.query(`UPDATE transfer_requests SET status='completed', notes=COALESCE($1, notes), updated_at=NOW() WHERE id=$2`, [notes || null, req.params.id]);
    }

    const { rows } = await client.query('SELECT * FROM transfer_requests WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    client.release(); released = true;

    const verb = { approved: 'Approved', rejected: 'Rejected', completed: 'Completed', cancelled: 'Cancelled' }[status];
    await logAudit(req.user.id, req.user.full_name, req.user.role, status, 'transfer', req.params.id,
      `${verb} transfer of ${transfer.quantity} x ${transfer.entity_name} from ${transfer.from_warehouse_name} to ${transfer.to_warehouse_name}`);
    await addActivity(req.user.full_name, status, `${verb} transfer request for ${transfer.entity_name}`, 'transfer', req.params.id);
    res.json(rows[0]);
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

// ---- Warehouses ----

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT w.*, p.name as project_name FROM warehouses w LEFT JOIN projects p ON w.project_id=p.id WHERE w.id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

router.post('/', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { name, type, location, city, manager_name, contact_phone, project_id } = req.body;
    const err = validateWarehouseBody({ name, type, location, city, manager_name, contact_phone, project_id });
    if (err) return res.status(400).json({ error: err });
    if (!project_id) project_id = null;
    const { rows } = await pool.query(
      `INSERT INTO warehouses (name, type, location, city, manager_name, contact_phone, project_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name.trim(), type, location || null, city || null, manager_name || null, contact_phone || null, project_id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'warehouse', rows[0].id, `Added warehouse: ${rows[0].name}`);
    res.status(201).json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

// Partial update: only the keys present in the body are written.
router.put('/:id', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    const body = req.body || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const { name, type, location, city, manager_name, contact_phone, project_id, is_active } = body;
    const err = validateWarehouseBody({ name, type, location, city, manager_name, contact_phone, project_id }, true);
    if (err) return res.status(400).json({ error: err });
    if (has('is_active') && typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be true or false' });

    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };
    if (has('name')) add('name', name.trim());
    if (has('type')) add('type', type);
    if (has('location')) add('location', location || null);
    if (has('city')) add('city', city || null);
    if (has('manager_name')) add('manager_name', manager_name || null);
    if (has('contact_phone')) add('contact_phone', contact_phone || null);
    if (has('project_id')) add('project_id', project_id || null);
    if (has('is_active')) add('is_active', is_active);
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE warehouses SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length} RETURNING *`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Warehouse not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'warehouse', rows[0].id, `Updated warehouse: ${rows[0].name}`);
    res.json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

// Soft delete: refused while active materials still hold stock in the warehouse.
router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT name, is_active FROM warehouses WHERE id=$1', [req.params.id]);
    if (!cur.length || cur[0].is_active === false) return res.status(404).json({ error: 'Warehouse not found' });
    const { rows: stock } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM materials WHERE warehouse_id=$1 AND is_active = true AND quantity > 0', [req.params.id]
    );
    if (stock[0].n > 0) return res.status(409).json({ error: `Warehouse still holds stock for ${stock[0].n} material(s)` });
    const { rows: tools } = await pool.query('SELECT COUNT(*)::int AS n FROM tools WHERE warehouse_id=$1', [req.params.id]);
    if (tools[0].n > 0) return res.status(409).json({ error: `Warehouse still holds ${tools[0].n} tool(s)` });
    const { rows } = await pool.query('UPDATE warehouses SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING name', [req.params.id]);
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'deleted', 'warehouse', req.params.id, `Deactivated warehouse: ${rows[0].name}`);
    res.json({ message: 'Warehouse deactivated' });
  } catch (err) { return dbError(res, err); }
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
  } catch (err) { return dbError(res, err); }
});

module.exports = router;
