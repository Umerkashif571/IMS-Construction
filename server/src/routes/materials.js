const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles } = require('../db/helpers');

const router = express.Router();

function sanitize(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim();
}

function isValidPositiveNumber(val) {
  const n = parseFloat(val);
  return !isNaN(n) && n >= 0;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category, warehouse, low_stock, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    let sql = `SELECT m.*, c.name as category_name, v.name as supplier_name, w.name as warehouse_name
               FROM materials m LEFT JOIN categories c ON m.category_id = c.id
               LEFT JOIN vendors v ON m.supplier_id = v.id
               LEFT JOIN warehouses w ON m.warehouse_id = w.id
               WHERE m.is_active = true`;
    const params = [];
    let idx = 1;
    if (search) { sql += ` AND (m.name ILIKE $${idx} OR m.sku ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, c.name as category_name, v.name as supplier_name, w.name as warehouse_name
       FROM materials m LEFT JOIN categories c ON m.category_id = c.id
       LEFT JOIN vendors v ON m.supplier_id = v.id
       LEFT JOIN warehouses w ON m.warehouse_id = w.id WHERE m.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Material not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { sku, name, description, category_id, unit, quantity, reorder_level, unit_cost, supplier_id, storage_location, warehouse_id } = req.body;
    sku = sanitize(sku);
    name = sanitize(name);
    description = sanitize(description);
    if (!sku || !name || !unit) return res.status(400).json({ error: 'SKU, name, and unit required' });
    if (!isValidPositiveNumber(quantity)) return res.status(400).json({ error: 'Quantity must be a non-negative number' });
    if (reorder_level !== undefined && (isNaN(parseFloat(reorder_level)) || parseFloat(reorder_level) < 0))
      return res.status(400).json({ error: 'Reorder level must be a non-negative number' });
    if (unit_cost !== undefined && (isNaN(parseFloat(unit_cost)) || parseFloat(unit_cost) < 0))
      return res.status(400).json({ error: 'Unit cost must be a non-negative number' });
    if (!category_id) category_id = null;
    if (!supplier_id) supplier_id = null;
    if (!warehouse_id) warehouse_id = null;
    const { rows } = await pool.query(
      `INSERT INTO materials (sku, name, description, category_id, unit, quantity, reorder_level, unit_cost, supplier_id, storage_location, warehouse_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sku, name, description, category_id, unit, parseFloat(quantity) || 0, parseFloat(reorder_level) || 0, parseFloat(unit_cost) || 0, supplier_id, storage_location, warehouse_id]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'material', rows[0].id, `Created material: ${name}`);
    await addActivity(req.user.full_name, 'created', `Added ${name} to inventory`, 'material', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'SKU already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    let { name, description, category_id, unit, quantity, reorder_level, unit_cost, supplier_id, storage_location, warehouse_id } = req.body;
    name = sanitize(name);
    description = sanitize(description);
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (quantity !== undefined && !isValidPositiveNumber(quantity)) return res.status(400).json({ error: 'Quantity must be a non-negative number' });
    if (reorder_level !== undefined && (isNaN(parseFloat(reorder_level)) || parseFloat(reorder_level) < 0))
      return res.status(400).json({ error: 'Reorder level must be a non-negative number' });
    if (unit_cost !== undefined && (isNaN(parseFloat(unit_cost)) || parseFloat(unit_cost) < 0))
      return res.status(400).json({ error: 'Unit cost must be a non-negative number' });
    if (!category_id) category_id = null;
    if (!supplier_id) supplier_id = null;
    if (!warehouse_id) warehouse_id = null;
    const { rows } = await pool.query(
      `UPDATE materials SET name=$1, description=$2, category_id=$3, unit=$4, quantity=$5, reorder_level=$6, unit_cost=$7, supplier_id=$8, storage_location=$9, warehouse_id=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [name, description, category_id, unit, quantity, reorder_level, unit_cost, supplier_id, storage_location, warehouse_id, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Material not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'material', rows[0].id, `Updated material: ${name}`);
    await addActivity(req.user.full_name, 'updated', `Updated material: ${name}`, 'material', rows[0].id);
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('UPDATE materials SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING name', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Material not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'deleted', 'material', req.params.id, `Deleted material: ${rows[0].name}`);
    await addActivity(req.user.full_name, 'deleted', `Removed material: ${rows[0].name}`, 'material', req.params.id);
    res.json({ message: 'Material deleted' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Stock IN (atomic, TOCTOU-safe)
router.post('/:id/stock-in', authenticate, authorize('owner', 'admin', 'store_manager', 'manager', 'staff'), async (req, res) => {
  try {
    const { quantity, notes, warehouse_id, source, received_by, transaction_type, date, po_id } = req.body;
    if (!quantity || parseFloat(quantity) <= 0) return res.status(400).json({ error: 'Valid quantity required' });
    if (!warehouse_id) return res.status(400).json({ error: 'Warehouse is required' });

    const qty = parseFloat(quantity);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: mat } = await client.query('SELECT * FROM materials WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (mat.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Material not found' });
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
        `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, notes, user_id, user_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.params.id, mat[0].name, 'in', qty, mat[0].unit, notes, req.user.id, req.user.full_name]
      );

      // If linked to a PO, update delivery tracking
      if (po_id) {
        await client.query(
          'UPDATE purchase_order_items SET quantity_delivered = quantity_delivered + $1 WHERE po_id=$2 AND material_name=$3',
          [qty, po_id, mat[0].name]
        );
      }

      await client.query('COMMIT');

      // After commit, check PO status if linked
      let poStatus = null;
      if (po_id) {
        const { rows: items } = await pool.query('SELECT quantity, quantity_delivered FROM purchase_order_items WHERE po_id=$1', [po_id]);
        const allReceived = items.every(i => parseFloat(i.quantity_delivered || 0) >= parseFloat(i.quantity));
        const anyReceived = items.some(i => parseFloat(i.quantity_delivered || 0) > 0);
        const newPoStatus = allReceived ? 'received' : (anyReceived ? 'partial_received' : null);
        if (newPoStatus) {
          const deliveryMap = { 'received': 'delivered', 'partial_received': 'partial' };
          await pool.query(
            'UPDATE purchase_orders SET status=$1, delivery_status=$2, received_by=$3, updated_at=NOW() WHERE id=$4',
            [newPoStatus, deliveryMap[newPoStatus] || 'pending', req.user.full_name, po_id]
          );
          poStatus = newPoStatus;
        }
      }

      await logAudit(req.user.id, req.user.full_name, req.user.role, 'stock_in', 'material', req.params.id,
        `Stock in: ${qty} ${mat[0].unit} of ${mat[0].name}. Running total: ${newQty}${po_id ? ' (PO linked)' : ''}`);
      await addActivity(req.user.full_name, 'stock_in', `Added ${qty} ${mat[0].unit} of ${mat[0].name} to stock (running total: ${newQty})${poStatus ? '. PO status: ' + poStatus : ''}`, 'material', req.params.id);

      res.json({ message: 'Stock in recorded', new_quantity: newQty, transaction: { quantity: qty, running_total: newQty, po_id }, po_status: poStatus });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Stock OUT with required details (atomic, TOCTOU-safe)
router.post('/:id/stock-out', authenticate, authorize('owner', 'admin', 'store_manager', 'manager', 'staff'), async (req, res) => {
  try {
    const { quantity, project_id, warehouse_id, location, driver_name, vehicle_number, notes, transaction_type } = req.body;

    const errors = [];
    if (!quantity || parseFloat(quantity) <= 0) errors.push('Valid quantity required');
    if (!project_id) errors.push('Project is required');
    if (!warehouse_id) errors.push('Warehouse is required');
    if (!location || !location.trim()) errors.push('Location/site is required');
    if (!driver_name || !driver_name.trim()) errors.push('Driver name is required');
    if (!vehicle_number || !vehicle_number.trim()) errors.push('Vehicle number is required');
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const qty = parseFloat(quantity);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: mat } = await client.query('SELECT * FROM materials WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (mat.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Material not found' });
      }

      const prevQty = parseFloat(mat[0].quantity);
      if (qty > prevQty) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Insufficient stock. Available: ${prevQty} ${mat[0].unit}` });
      }

      const newQty = prevQty - qty;

      await client.query('UPDATE materials SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2', [qty, req.params.id]);

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
        [req.params.id, mat[0].name, 'out', qty, mat[0].unit, notes, null, req.user.id, req.user.full_name]
      );

      const gpNo = 'GP-' + Date.now();
      const { rows: gpRows } = await client.query(
        `INSERT INTO gate_passes (gate_pass_no, material_id, material_name, quantity, unit, project_id, project_name, vehicle_number, driver_name, destination, issued_by, authorized_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [gpNo, req.params.id, mat[0].name, qty, mat[0].unit, project_id, projectName, vehicle_number.trim(), driver_name.trim(), location.trim(), req.user.full_name, null]
      );

      // Track project budget usage
      const unitCost = parseFloat(mat[0].unit_cost || 0);
      if (unitCost > 0) {
        await client.query(
          'UPDATE projects SET budget_used = COALESCE(budget_used, 0) + $1 WHERE id = $2',
          [qty * unitCost, project_id]
        );
      }

      await client.query('COMMIT');

      const reorderLevel = parseFloat(mat[0].reorder_level || 0);
      if (reorderLevel > 0 && newQty <= reorderLevel) {
        await notifyRoles(['owner', 'admin', 'store_manager'], 'low_stock',
          `Low stock: ${mat[0].name}`,
          `${mat[0].name} is at ${newQty} ${mat[0].unit} (reorder level: ${reorderLevel})`,
          `/materials?material=${req.params.id}`, 'material', req.params.id);
      }

      await logAudit(req.user.id, req.user.full_name, req.user.role, 'stock_out', 'material', req.params.id,
        `Stock out: ${qty} ${mat[0].unit} of ${mat[0].name} to project ${project_id}. Remaining: ${newQty}`);
      await addActivity(req.user.full_name, 'stock_out', `Removed ${qty} ${mat[0].unit} of ${mat[0].name} from stock (remaining: ${newQty})`, 'material', req.params.id);

      const gp = gpRows ? gpRows[0] : null;
      res.json({ message: 'Stock out recorded', new_quantity: newQty, transaction: { quantity: qty, running_total: newQty }, gate_pass: gp });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Get all transactions for a material (both in/out)
router.get('/:id/transactions', authenticate, async (req, res) => {
  try {
    const { from, to, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

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
      sql += ` AND t.created_at >= $${idx}`;
      params.push(from);
      idx++;
    }
    if (to) {
      sql += ` AND t.created_at <= $${idx}`;
      params.push(to + 'T23:59:59.999Z');
      idx++;
    }

    // Count total
    const countSql = `SELECT COUNT(*) FROM (${sql}) as filtered`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = parseInt(countRows[0]?.count || '0');

    sql += ` ORDER BY t.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
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

// Legacy movement endpoint (kept for backward compatibility)
router.post('/:id/movement', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    const { movement_type, quantity, notes, warehouse_id, project_id, location, driver_name, vehicle_number } = req.body;
    if (!movement_type || !quantity) return res.status(400).json({ error: 'Movement type and quantity required' });
    if (!['in', 'out'].includes(movement_type)) return res.status(400).json({ error: 'Movement type must be "in" or "out"' });
    if (isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0)
      return res.status(400).json({ error: 'Quantity must be a positive number' });

    if (movement_type === 'out') {
      const errors = [];
      if (!project_id) errors.push('Project is required');
      if (!location || !location.trim()) errors.push('Location/site is required');
      if (!driver_name || !driver_name.trim()) errors.push('Driver name is required');
      if (!vehicle_number || !vehicle_number.trim()) errors.push('Vehicle number is required');
      if (errors.length) return res.status(400).json({ error: errors.join('; ') });
    }

    const qty = parseFloat(quantity);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: mat } = await client.query('SELECT * FROM materials WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (mat.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Material not found' });
      }
      if (movement_type === 'out' && qty > parseFloat(mat[0].quantity)) {
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
      } else if (movement_type === 'out') {
        const { rows: updated } = await client.query(
          'UPDATE materials SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2 AND quantity >= $1 RETURNING quantity',
          [qty, req.params.id]
        );
        newQty = parseFloat(updated[0].quantity);
      }

      await client.query(
        `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, notes, warehouse_id, user_id, user_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.params.id, mat[0].name, movement_type, qty, mat[0].unit, notes, warehouse_id, req.user.id, req.user.full_name]
      );

      await client.query(
        `INSERT INTO material_transactions (material_id, type, quantity, running_total, project_id, location, driver_name, vehicle_number, added_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          req.params.id,
          movement_type,
          qty,
          newQty,
          movement_type === 'out' ? project_id : null,
          movement_type === 'out' ? location : null,
          movement_type === 'out' ? driver_name : null,
          movement_type === 'out' ? vehicle_number : null,
          req.user.full_name,
          notes || null
        ]
      );

      await client.query('COMMIT');

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
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/movements', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const offset = (pageNum - 1) * limitNum;

    // Count total
    const [{ count }] = await pool.query(
      'SELECT COUNT(*) FROM stock_movements WHERE material_id=$1',
      [req.params.id]
    );
    const total = parseInt(count);

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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Categories
router.get('/categories/list', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
