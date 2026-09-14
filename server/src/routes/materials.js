const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles, nextGatePassNo } = require('../db/helpers');
const { requireUuid, dbError, isUuid, toNumber, isDate, maxLen } = require('../middleware/validate');

const router = express.Router();
router.param('id', requireUuid);

function sanitize(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim();
}

// numeric(15,2): anything at or above 1e13 overflows the column
const MAX_QTY = 1e13;

// Non-negative finite number (rounded to 2 dp) or NaN. Used for quantity/reorder_level/unit_cost.
function nonNegative(val) {
  const n = toNumber(val);
  if (n === null || Number.isNaN(n) || n < 0 || n >= MAX_QTY) return NaN;
  return Math.round(n * 100) / 100;
}

// Strictly positive stock quantity: finite, >= 0.01 (smallest storable unit), < 1e13. Returns NaN when invalid.
function stockQty(val) {
  const n = nonNegative(val);
  if (Number.isNaN(n) || n < 0.01) return NaN;
  return n;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

// Shared validation for stock-in / stock-out / movement bodies. Returns an error string or null.
function validateStockRefs({ warehouse_id, project_id, po_id, date, location, driver_name, vehicle_number, notes }) {
  if (warehouse_id != null && !isUuid(warehouse_id)) return 'Invalid warehouse id';
  if (project_id != null && !isUuid(project_id)) return 'Invalid project id';
  if (po_id != null && !isUuid(po_id)) return 'Invalid purchase order id';
  if (date != null && !isDate(date)) return 'Invalid date';
  if (!maxLen(location, 255)) return 'Location too long (max 255)';
  if (!maxLen(driver_name, 255)) return 'Driver name too long (max 255)';
  if (!maxLen(vehicle_number, 255)) return 'Vehicle number too long (max 255)';
  if (!maxLen(notes, 5000)) return 'Notes too long';
  return null;
}

// Look up referenced rows on the transaction client. Returns { status, error } or null when all exist.
async function checkRefs(client, { warehouse_id, project_id, po_id }) {
  if (warehouse_id) {
    const { rows } = await client.query('SELECT is_active FROM warehouses WHERE id=$1', [warehouse_id]);
    if (!rows.length) return { status: 404, error: 'Warehouse not found' };
    if (rows[0].is_active === false) return { status: 400, error: 'Warehouse is inactive' };
  }
  if (project_id) {
    const { rows } = await client.query('SELECT name FROM projects WHERE id=$1', [project_id]);
    if (!rows.length) return { status: 404, error: 'Project not found' };
  }
  if (po_id) {
    const { rows } = await client.query('SELECT id FROM purchase_orders WHERE id=$1', [po_id]);
    if (!rows.length) return { status: 404, error: 'Purchase order not found' };
  }
  return null;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category, warehouse, low_stock, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;
    if (category && !isUuid(category)) return res.status(400).json({ error: 'Invalid category id' });
    if (warehouse && !isUuid(warehouse)) return res.status(400).json({ error: 'Invalid warehouse id' });

    let sql = `SELECT m.*, c.name as category_name, v.name as supplier_name, w.name as warehouse_name
               FROM materials m LEFT JOIN categories c ON m.category_id = c.id
               LEFT JOIN vendors v ON m.supplier_id = v.id
               LEFT JOIN warehouses w ON m.warehouse_id = w.id
               WHERE m.is_active = true`;
    const params = [];
    let idx = 1;
    if (search && typeof search === 'string') { sql += ` AND (m.name ILIKE $${idx} OR m.sku ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (category) { sql += ` AND m.category_id = $${idx}`; params.push(category); idx++; }
    if (warehouse) { sql += ` AND m.warehouse_id = $${idx}`; params.push(warehouse); idx++; }
    if (low_stock === 'true') { sql += ` AND m.quantity <= m.reorder_level`; }

    // Count total for pagination metadata
    const countSql = `SELECT COUNT(*) FROM (${sql}) as filtered`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = parseInt(countRows[0]?.count || '0');

    sql += ` ORDER BY m.name ASC LIMIT $${idx} OFFSET $${idx + 1}`;
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

// Categories (must be declared before /:id)
router.get('/categories/list', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('Categories list error:', err?.message || err, err?.code || '');
    if (err?.code === '42P01') {
      // Table doesn't exist - return empty array instead of 500
      return res.json([]);
    }
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, c.name as category_name, v.name as supplier_name, w.name as warehouse_name
       FROM materials m LEFT JOIN categories c ON m.category_id = c.id
       LEFT JOIN vendors v ON m.supplier_id = v.id
       LEFT JOIN warehouses w ON m.warehouse_id = w.id WHERE m.id = $1 AND m.is_active = true`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Material not found' });
    res.json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

// Validates the optional/text fields shared by POST and PUT. Returns an error string or null.
function validateMaterialFields({ sku, name, description, unit, category_id, supplier_id, storage_location, warehouse_id }) {
  if (!maxLen(sku, 100)) return 'SKU too long (max 100)';
  if (!maxLen(name, 255)) return 'Name too long (max 255)';
  if (!maxLen(unit, 50)) return 'Unit too long (max 50)';
  if (!maxLen(storage_location, 255)) return 'Storage location too long (max 255)';
  if (!maxLen(description, 5000)) return 'Description too long';
  if (category_id != null && !isUuid(category_id)) return 'Invalid category id';
  if (supplier_id != null && !isUuid(supplier_id)) return 'Invalid supplier id';
  if (warehouse_id != null && !isUuid(warehouse_id)) return 'Invalid warehouse id';
  return null;
}

router.post('/', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { sku, name, description, category_id, unit, quantity, reorder_level, unit_cost, supplier_id, storage_location, warehouse_id } = req.body;
    sku = sanitize(sku);
    name = sanitize(name);
    description = sanitize(description);
    unit = sanitize(unit);
    if (!sku || !name || !unit) return res.status(400).json({ error: 'SKU, name, and unit required' });
    const fieldErr = validateMaterialFields({ sku, name, description, unit, category_id, supplier_id, storage_location, warehouse_id });
    if (fieldErr) return res.status(400).json({ error: fieldErr });
    const qty = quantity == null ? 0 : nonNegative(quantity);
    if (Number.isNaN(qty)) return res.status(400).json({ error: 'Quantity must be a non-negative number' });
    const reorder = reorder_level == null ? 0 : nonNegative(reorder_level);
    if (Number.isNaN(reorder)) return res.status(400).json({ error: 'Reorder level must be a non-negative number' });
    const cost = unit_cost == null ? 0 : nonNegative(unit_cost);
    if (Number.isNaN(cost)) return res.status(400).json({ error: 'Unit cost must be a non-negative number' });
    if (!category_id) category_id = null;
    if (!supplier_id) supplier_id = null;
    if (!warehouse_id) warehouse_id = null;
    const { rows } = await pool.query(
      `INSERT INTO materials (sku, name, description, category_id, unit, quantity, reorder_level, unit_cost, supplier_id, storage_location, warehouse_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sku, name, description || null, category_id, unit, qty, reorder, cost, supplier_id, storage_location || null, warehouse_id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'material', rows[0].id, `Created material: ${name}`);
    await addActivity(req.user.full_name, 'created', `Added ${name} to inventory`, 'material', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'SKU already exists' });
    return dbError(res, err);
  }
});

// Partial update. Only keys present in the body are written; quantity is never touched here
// (stock changes go through stock-in / stock-out / movement so the ledger stays consistent).
router.put('/:id', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    const body = req.body || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    let { sku, name, description, category_id, unit, reorder_level, unit_cost, supplier_id, storage_location, warehouse_id } = body;
    sku = sanitize(sku);
    name = sanitize(name);
    description = sanitize(description);
    unit = sanitize(unit);
    if (has('name') && !name) return res.status(400).json({ error: 'Name is required' });
    if (has('unit') && !unit) return res.status(400).json({ error: 'Unit is required' });
    if (has('sku') && !sku) return res.status(400).json({ error: 'SKU is required' });
    const fieldErr = validateMaterialFields({ sku, name, description, unit, category_id, supplier_id, storage_location, warehouse_id });
    if (fieldErr) return res.status(400).json({ error: fieldErr });
    let reorder = null, cost = null;
    if (has('reorder_level') && reorder_level != null) {
      reorder = nonNegative(reorder_level);
      if (Number.isNaN(reorder)) return res.status(400).json({ error: 'Reorder level must be a non-negative number' });
    }
    if (has('unit_cost') && unit_cost != null) {
      cost = nonNegative(unit_cost);
      if (Number.isNaN(cost)) return res.status(400).json({ error: 'Unit cost must be a non-negative number' });
    }

    // Build the SET list from the keys actually sent. Nullable FKs/text may be cleared with null;
    // NOT NULL / numeric columns fall back to their current value when null is sent.
    const sets = [];
    const params = [];
    const add = (col, val, nullable) => {
      params.push(val);
      sets.push(nullable ? `${col}=$${params.length}` : `${col}=COALESCE($${params.length}, ${col})`);
    };
    if (has('sku')) add('sku', sku, false);
    if (has('name')) add('name', name, false);
    if (has('unit')) add('unit', unit, false);
    if (has('description')) add('description', description || null, true);
    if (has('storage_location')) add('storage_location', storage_location || null, true);
    if (has('category_id')) add('category_id', category_id || null, true);
    if (has('supplier_id')) add('supplier_id', supplier_id || null, true);
    if (has('warehouse_id')) add('warehouse_id', warehouse_id || null, true);
    if (has('reorder_level')) add('reorder_level', reorder, false);
    if (has('unit_cost')) add('unit_cost', cost, false);
    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' });

    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE materials SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length} AND is_active = true RETURNING *`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Material not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'material', rows[0].id, `Updated material: ${rows[0].name}`);
    await addActivity(req.user.full_name, 'updated', `Updated material: ${rows[0].name}`, 'material', rows[0].id);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'SKU already exists' });
    return dbError(res, err);
  }
});

router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows: cur } = await pool.query('SELECT name, quantity, is_active FROM materials WHERE id=$1', [req.params.id]);
    if (cur.length === 0 || cur[0].is_active === false) return res.status(404).json({ error: 'Material not found' });
    if (parseFloat(cur[0].quantity) > 0) return res.status(400).json({ error: `Material still has stock (${cur[0].quantity}). Stock it out before deleting.` });
    const { rows } = await pool.query('UPDATE materials SET is_active=false, updated_at=NOW() WHERE id=$1 AND is_active = true RETURNING name', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Material not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'deleted', 'material', req.params.id, `Deleted material: ${rows[0].name}`);
    await addActivity(req.user.full_name, 'deleted', `Removed material: ${rows[0].name}`, 'material', req.params.id);
    res.json({ message: 'Material deleted' });
  } catch (err) { return dbError(res, err); }
});

// Stock IN (atomic, TOCTOU-safe)
router.post('/:id/stock-in', authenticate, authorize('owner', 'admin', 'store_manager', 'manager', 'staff'), async (req, res) => {
  const { quantity, notes, warehouse_id, source, received_by, transaction_type, date, po_id } = req.body;
  const qty = stockQty(quantity);
  if (Number.isNaN(qty)) return res.status(400).json({ error: 'Valid quantity required' });
  if (!warehouse_id) return res.status(400).json({ error: 'Warehouse is required' });
  const refErr = validateStockRefs({ warehouse_id, po_id, date, notes });
  if (refErr) return res.status(400).json({ error: refErr });
  if (!maxLen(source, 100)) return res.status(400).json({ error: 'Source too long (max 100)' });
  if (!maxLen(received_by, 255)) return res.status(400).json({ error: 'Received by too long (max 255)' });
  if (!maxLen(transaction_type, 50)) return res.status(400).json({ error: 'Transaction type too long (max 50)' });

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');

    const { rows: mat } = await client.query('SELECT * FROM materials WHERE id=$1 AND is_active = true FOR UPDATE', [req.params.id]);
    if (mat.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Material not found' });
    }
    const missing = await checkRefs(client, { warehouse_id });
    if (missing) {
      await client.query('ROLLBACK');
      return res.status(missing.status).json({ error: missing.error });
    }

    // PO-linked receipt: lock the PO, require it to be receivable, and cap the receipt at the
    // ordered quantity of the matching line (mirrors PUT /vendors/pos/:poId/delivery).
    let po = null;
    let poItem = null;
    if (po_id) {
      const { rows: poRows } = await client.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [po_id]);
      if (!poRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Purchase order not found' }); }
      po = poRows[0];
      if (!['approved', 'partial_received'].includes(po.status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Only fully approved POs can be received (current status: ${po.status})` });
      }
      const { rows: items } = await client.query(
        'SELECT * FROM purchase_order_items WHERE po_id=$1 AND LOWER(material_name)=LOWER($2) ORDER BY created_at FOR UPDATE',
        [po_id, mat[0].name]
      );
      if (!items.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: `PO ${po.po_number} has no line for ${mat[0].name}` }); }
      // Receive against the first line that still has an outstanding quantity
      poItem = items.find(it => parseFloat(it.quantity_delivered || 0) < parseFloat(it.quantity)) || items[items.length - 1];
      const ordered = parseFloat(poItem.quantity);
      const delivered = parseFloat(poItem.quantity_delivered || 0);
      if (Math.round((delivered + qty) * 100) / 100 > ordered) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `${mat[0].name}: receiving ${qty} exceeds ordered quantity ${ordered} (already received ${delivered})` });
      }
    }

    const { rows: updated } = await client.query(
      'UPDATE materials SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2 RETURNING quantity',
      [qty, req.params.id]
    );
    const newQty = parseFloat(updated[0].quantity);

    const txnDate = date ? new Date(date) : new Date();
    await client.query(
      `INSERT INTO material_transactions (material_id, type, quantity, running_total, warehouse_id, added_by, notes, source, received_by, transaction_type, date, po_id)
       VALUES ($1, 'in', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [req.params.id, qty, newQty, warehouse_id, req.user.full_name, notes || null, source || null, received_by || null, transaction_type || null, txnDate, po_id || null]
    );

    await client.query(
      `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, notes, warehouse_id, user_id, user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.params.id, mat[0].name, 'in', qty, mat[0].unit, notes || null, warehouse_id, req.user.id, req.user.full_name]
    );

    // If linked to a PO, update delivery tracking and derive the PO status in the same transaction
    let poStatus = null;
    if (po) {
      await client.query(
        'UPDATE purchase_order_items SET quantity_delivered = COALESCE(quantity_delivered, 0) + $1 WHERE id=$2 AND po_id=$3',
        [qty, poItem.id, po.id]
      );
      const { rows: items } = await client.query('SELECT quantity, quantity_delivered FROM purchase_order_items WHERE po_id=$1', [po.id]);
      const allReceived = items.every(i => parseFloat(i.quantity_delivered || 0) >= parseFloat(i.quantity));
      const anyReceived = items.some(i => parseFloat(i.quantity_delivered || 0) > 0);
      const newDeliveryStatus = allReceived ? 'delivered' : (anyReceived ? 'partial' : 'pending');
      poStatus = allReceived ? 'received' : (anyReceived ? 'partial_received' : po.status);
      await client.query(
        'UPDATE purchase_orders SET status=$1, delivery_status=$2, received_by=COALESCE($3, received_by), updated_at=NOW() WHERE id=$4',
        [poStatus, newDeliveryStatus, poStatus === 'received' ? req.user.full_name : null, po.id]
      );
    }

    await client.query('COMMIT');
    client.release(); released = true;

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'stock_in', 'material', req.params.id,
      `Stock in: ${qty} ${mat[0].unit} of ${mat[0].name}. Running total: ${newQty}${po_id ? ' (PO linked)' : ''}`);
    await addActivity(req.user.full_name, 'stock_in', `Added ${qty} ${mat[0].unit} of ${mat[0].name} to stock (running total: ${newQty})${poStatus ? '. PO status: ' + poStatus : ''}`, 'material', req.params.id);

    res.json({ message: 'Stock in recorded', new_quantity: newQty, transaction: { quantity: qty, running_total: newQty, po_id }, po_status: poStatus });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

// Stock OUT with required details (atomic, TOCTOU-safe)
router.post('/:id/stock-out', authenticate, authorize('owner', 'admin', 'store_manager', 'manager', 'staff'), async (req, res) => {
  const { quantity, project_id, warehouse_id, location, driver_name, vehicle_number, notes, transaction_type } = req.body;

  const errors = [];
  const qty = stockQty(quantity);
  if (Number.isNaN(qty)) errors.push('Valid quantity required');
  if (!project_id) errors.push('Project is required');
  if (!warehouse_id) errors.push('Warehouse is required');
  if (typeof location !== 'string' || !location.trim()) errors.push('Location/site is required');
  if (typeof driver_name !== 'string' || !driver_name.trim()) errors.push('Driver name is required');
  if (typeof vehicle_number !== 'string' || !vehicle_number.trim()) errors.push('Vehicle number is required');
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const refErr = validateStockRefs({ warehouse_id, project_id, location, driver_name, vehicle_number, notes });
  if (refErr) return res.status(400).json({ error: refErr });
  if (!maxLen(transaction_type, 50)) return res.status(400).json({ error: 'Transaction type too long (max 50)' });

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');

    const { rows: mat } = await client.query('SELECT * FROM materials WHERE id=$1 AND is_active = true FOR UPDATE', [req.params.id]);
    if (mat.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Material not found' });
    }
    const missing = await checkRefs(client, { warehouse_id, project_id });
    if (missing) {
      await client.query('ROLLBACK');
      return res.status(missing.status).json({ error: missing.error });
    }

    const prevQty = parseFloat(mat[0].quantity);
    if (!Number.isFinite(prevQty) || qty > prevQty) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient stock. Available: ${Number.isFinite(prevQty) ? prevQty : 0} ${mat[0].unit}` });
    }

    const { rows: updated } = await client.query(
      'UPDATE materials SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2 AND quantity >= $1 RETURNING quantity',
      [qty, req.params.id]
    );
    if (!updated.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient stock. Available: ${prevQty} ${mat[0].unit}` });
    }
    const newQty = parseFloat(updated[0].quantity);

    const { rows: project } = await client.query('SELECT name FROM projects WHERE id=$1', [project_id]);
    const projectName = project.length > 0 ? project[0].name : '';

    await client.query(
      `INSERT INTO material_transactions (material_id, type, quantity, running_total, warehouse_id, project_id, location, driver_name, vehicle_number, added_by, notes, transaction_type, date)
       VALUES ($1, 'out', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [req.params.id, qty, newQty, warehouse_id, project_id, location.trim(), driver_name.trim(), vehicle_number.trim(), req.user.full_name, notes || null, transaction_type || null]
    );

    await client.query(
      `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, notes, warehouse_id, user_id, user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.params.id, mat[0].name, 'out', qty, mat[0].unit, notes || null, warehouse_id, req.user.id, req.user.full_name]
    );

    const gpNo = await nextGatePassNo(client);
    const { rows: gpRows } = await client.query(
      `INSERT INTO gate_passes (gate_pass_no, material_id, material_name, quantity, unit, project_id, project_name, vehicle_number, driver_name, destination, issued_by, authorized_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [gpNo, req.params.id, mat[0].name, qty, mat[0].unit, project_id, projectName, vehicle_number.trim(), driver_name.trim(), location.trim(), req.user.full_name, null]
    );

    // Track project budget usage
    const unitCost = parseFloat(mat[0].unit_cost || 0);
    if (Number.isFinite(unitCost) && unitCost > 0) {
      await client.query(
        'UPDATE projects SET budget_used = COALESCE(budget_used, 0) + $1 WHERE id = $2',
        [Math.round(qty * unitCost * 100) / 100, project_id]
      );
    }

    await client.query('COMMIT');
    client.release(); released = true;

    const reorderLevel = parseFloat(mat[0].reorder_level || 0);
    if (reorderLevel > 0 && newQty <= reorderLevel) {
      await notifyRoles(['owner', 'admin', 'store_manager'], 'low_stock',
        `Low stock: ${mat[0].name}`,
        `${mat[0].name} is at ${newQty} ${mat[0].unit} (reorder level: ${reorderLevel})`,
        `/materials?material=${req.params.id}`, 'material', req.params.id);
    }

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'stock_out', 'material', req.params.id,
      `Stock out: ${qty} ${mat[0].unit} of ${mat[0].name} to project ${projectName || project_id}. Remaining: ${newQty}`);
    await addActivity(req.user.full_name, 'stock_out', `Removed ${qty} ${mat[0].unit} of ${mat[0].name} from stock (remaining: ${newQty})`, 'material', req.params.id);

    const gp = gpRows ? gpRows[0] : null;
    res.json({ message: 'Stock out recorded', new_quantity: newQty, transaction: { quantity: qty, running_total: newQty }, gate_pass: gp });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

// Get all transactions for a material (both in/out). Date filters apply to the transaction date
// (t.date, which may be back-dated), not the row's created_at.
router.get('/:id/transactions', authenticate, async (req, res) => {
  try {
    const { from, to, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;
    if (from && !isDay(from)) return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
    if (to && !isDay(to)) return res.status(400).json({ error: 'to must be YYYY-MM-DD' });

    let sql = `
      SELECT t.*, p.name as project_name, w.name as warehouse_name
      FROM material_transactions t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN warehouses w ON t.warehouse_id = w.id
      WHERE t.material_id = $1
    `;
    const params = [req.params.id];
    let idx = 2;

    if (from) {
      sql += ` AND COALESCE(t.date, t.created_at)::date >= $${idx}::date`;
      params.push(from);
      idx++;
    }
    if (to) {
      sql += ` AND COALESCE(t.date, t.created_at)::date <= $${idx}::date`;
      params.push(to);
      idx++;
    }

    // Count total
    const countSql = `SELECT COUNT(*) FROM (${sql}) as filtered`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = parseInt(countRows[0]?.count || '0');

    sql += ` ORDER BY COALESCE(t.date, t.created_at) DESC, t.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
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

// Legacy movement endpoint (kept for backward compatibility)
router.post('/:id/movement', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  const { movement_type, quantity, notes, warehouse_id, project_id, location, driver_name, vehicle_number } = req.body;
  if (!movement_type || quantity == null) return res.status(400).json({ error: 'Movement type and quantity required' });
  if (!['in', 'out'].includes(movement_type)) return res.status(400).json({ error: 'Movement type must be "in" or "out"' });
  const qty = stockQty(quantity);
  if (Number.isNaN(qty)) return res.status(400).json({ error: 'Quantity must be a positive number' });

  if (movement_type === 'out') {
    const errors = [];
    if (!project_id) errors.push('Project is required');
    if (typeof location !== 'string' || !location.trim()) errors.push('Location/site is required');
    if (typeof driver_name !== 'string' || !driver_name.trim()) errors.push('Driver name is required');
    if (typeof vehicle_number !== 'string' || !vehicle_number.trim()) errors.push('Vehicle number is required');
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  }
  const refErr = validateStockRefs({ warehouse_id, project_id, location, driver_name, vehicle_number, notes });
  if (refErr) return res.status(400).json({ error: refErr });

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');

    const { rows: mat } = await client.query('SELECT * FROM materials WHERE id=$1 AND is_active = true FOR UPDATE', [req.params.id]);
    if (mat.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Material not found' });
    }
    const missing = await checkRefs(client, { warehouse_id, project_id: movement_type === 'out' ? project_id : null });
    if (missing) {
      await client.query('ROLLBACK');
      return res.status(missing.status).json({ error: missing.error });
    }
    const prevQty = parseFloat(mat[0].quantity);
    if (movement_type === 'out' && (!Number.isFinite(prevQty) || qty > prevQty)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient stock. Available: ${mat[0].quantity} ${mat[0].unit}` });
    }

    let newQty;
    if (movement_type === 'in') {
      const { rows: updated } = await client.query(
        'UPDATE materials SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2 RETURNING quantity',
        [qty, req.params.id]
      );
      newQty = parseFloat(updated[0].quantity);
    } else {
      const { rows: updated } = await client.query(
        'UPDATE materials SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2 AND quantity >= $1 RETURNING quantity',
        [qty, req.params.id]
      );
      if (!updated.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Insufficient stock. Available: ${mat[0].quantity} ${mat[0].unit}` });
      }
      newQty = parseFloat(updated[0].quantity);
    }

    await client.query(
      `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, notes, warehouse_id, user_id, user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.params.id, mat[0].name, movement_type, qty, mat[0].unit, notes || null, warehouse_id || null, req.user.id, req.user.full_name]
    );

    await client.query(
      `INSERT INTO material_transactions (material_id, type, quantity, running_total, warehouse_id, project_id, location, driver_name, vehicle_number, added_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        req.params.id,
        movement_type,
        qty,
        newQty,
        warehouse_id || null,
        movement_type === 'out' ? project_id : null,
        movement_type === 'out' ? location.trim() : null,
        movement_type === 'out' ? driver_name.trim() : null,
        movement_type === 'out' ? vehicle_number.trim() : null,
        req.user.full_name,
        notes || null
      ]
    );

    await client.query('COMMIT');
    client.release(); released = true;

    const reorderLevel = parseFloat(mat[0].reorder_level || 0);
    if (movement_type === 'out' && reorderLevel > 0 && newQty <= reorderLevel) {
      await notifyRoles(['owner', 'admin', 'store_manager'], 'low_stock',
        `Low stock: ${mat[0].name}`,
        `${mat[0].name} is at ${newQty} ${mat[0].unit} (reorder level: ${reorderLevel})`,
        `/materials?material=${req.params.id}`, 'material', req.params.id);
    }

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'stock_movement', 'material', req.params.id,
      `Stock ${movement_type}: ${qty} ${mat[0].unit} of ${mat[0].name}`);
    await addActivity(req.user.full_name, 'stock_movement', `${movement_type === 'in' ? 'Added' : 'Removed'} ${qty} ${mat[0].unit} of ${mat[0].name} ${movement_type === 'in' ? 'to' : 'from'} stock`, 'material', req.params.id);

    res.json({ message: 'Stock movement recorded', new_quantity: newQty });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

router.get('/:id/movements', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const offset = (pageNum - 1) * limitNum;

    // Count total
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) FROM stock_movements WHERE material_id=$1',
      [req.params.id]
    );
    const total = parseInt(countRows[0]?.count || '0');

    const { rows } = await pool.query(
      'SELECT * FROM stock_movements WHERE material_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.params.id, limitNum, offset]
    );
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

module.exports = router;
