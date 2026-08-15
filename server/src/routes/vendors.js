const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles, createNotification } = require('../db/helpers');

const router = express.Router();

// Sequential, human-readable PO number: PO-YYYY-NNN (zero-padded, per year).
// Historical POs keep their existing numbers; only new POs use this format.
async function nextPoNumber() {
  const year = new Date().getFullYear();
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX((REGEXP_MATCH(po_number, '^PO-' || $1 || '-([0-9]+)$'))[1]::int), 0)::int AS max_seq
     FROM purchase_orders WHERE po_number ~ ('^PO-' || $1 || '-[0-9]+$')`,
    [String(year)]
  );
  return `PO-${year}-${String(rows[0].max_seq + 1).padStart(3, '0')}`;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status } = req.query;
    let sql = 'SELECT * FROM vendors WHERE 1=1';
    const params = [];
    let idx = 1;
    if (search) { sql += ` AND (name ILIKE $${idx} OR contact_person ILIKE $${idx} OR city ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (status) { sql += ` AND status = $${idx}`; params.push(status); idx++; }
    sql += ' ORDER BY name';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendors WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { name, contact_person, email, phone, address, city, province, ntn, strn, payment_terms } = req.body;
    if (!name) return res.status(400).json({ error: 'Vendor name required' });
    const { rows } = await pool.query(
      `INSERT INTO vendors (name, contact_person, email, phone, address, city, province, ntn, strn, payment_terms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, contact_person, email, phone, address, city, province, ntn, strn, payment_terms]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'vendor', rows[0].id, `Added vendor: ${name}`);
    await addActivity(req.user.full_name, 'created', `Added vendor: ${name}`, 'vendor', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { name, contact_person, email, phone, address, city, province, ntn, strn, payment_terms, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE vendors SET name=$1, contact_person=$2, email=$3, phone=$4, address=$5, city=$6, province=$7, ntn=$8, strn=$9, payment_terms=$10, status=$11, updated_at=NOW() WHERE id=$12 RETURNING *`,
      [name, contact_person, email, phone, address, city, province, ntn, strn, payment_terms, status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('UPDATE vendors SET status=$1 WHERE id=$2 RETURNING name', ['inactive', req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ message: 'Vendor deactivated' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Purchase Orders
router.get('/pos/list', authenticate, async (req, res) => {
  try {
    const { status, vendor_id } = req.query;
    let sql = `SELECT po.*, v.name as vendor_name, p.name as project_name,
                      au.full_name as admin_approved_by_name, ou.full_name as owner_approved_by_name
               FROM purchase_orders po
               LEFT JOIN vendors v ON po.vendor_id=v.id
               LEFT JOIN projects p ON po.project_id=p.id
               LEFT JOIN users au ON po.admin_approved_by=au.id
               LEFT JOIN users ou ON po.owner_approved_by=ou.id
               WHERE 1=1`;
    const params = []; let idx = 1;
    if (status) { sql += ` AND po.status = $${idx}`; params.push(status); idx++; }
    if (vendor_id) { sql += ` AND po.vendor_id = $${idx}`; params.push(vendor_id); idx++; }
    sql += ' ORDER BY po.created_at DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/pos/:id', authenticate, async (req, res) => {
  try {
    const { rows: po } = await pool.query(`SELECT po.*, v.name as vendor_name, p.name as project_name,
        au.full_name as admin_approved_by_name, ou.full_name as owner_approved_by_name
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id=v.id
      LEFT JOIN projects p ON po.project_id=p.id
      LEFT JOIN users au ON po.admin_approved_by=au.id
      LEFT JOIN users ou ON po.owner_approved_by=ou.id
      WHERE po.id=$1`, [req.params.id]);
    if (po.length === 0) return res.status(404).json({ error: 'PO not found' });
    const { rows: items } = await pool.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [req.params.id]);
    res.json({ ...po[0], items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// PO creation is exclusive to the Procurement role (spec). The Site
// (project_id) is mandatory — no project means no PO.
router.post('/pos', authenticate, authorize('procurement_officer'), async (req, res) => {
  try {
    let { vendor_id, vendor_name, project_id, expected_delivery, notes, items } = req.body;
    if (!vendor_id || !items || items.length === 0) return res.status(400).json({ error: 'Vendor and items required' });
    if (!project_id) return res.status(400).json({ error: 'Site (project) selection is required for a purchase order' });
    const proj = await pool.query('SELECT id, name FROM projects WHERE id=$1', [project_id]);
    if (proj.rows.length === 0) return res.status(400).json({ error: 'Selected site (project) does not exist' });
    const vendorQ = await pool.query('SELECT id, name FROM vendors WHERE id=$1', [vendor_id]);
    if (vendorQ.rows.length === 0) return res.status(400).json({ error: 'Selected vendor does not exist' });
    // Generate PO number
    const poNum = await nextPoNumber();

    const total_amount = items.reduce((sum, i) => sum + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);

    const { rows: po } = await pool.query(
      `INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, project_id, expected_delivery, total_amount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [poNum, vendor_id, vendorQ.rows[0].name, project_id, expected_delivery, total_amount, notes, req.user.id]
    );

    for (const item of items) {
      await pool.query(
        `INSERT INTO purchase_order_items (po_id, material_name, description, quantity, unit, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [po[0].id, item.material_name, item.description, item.quantity, item.unit, item.unit_price, item.quantity * item.unit_price]
      );
    }
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'purchase_order', po[0].id, `Created PO ${poNum}: ${vendorQ.rows[0].name} (site: ${proj.rows[0].name})`);
    await addActivity(req.user.full_name, 'created', `Created ${poNum} for ${vendorQ.rows[0].name} on ${proj.rows[0].name}`, 'purchase_order', po[0].id);
    await notifyRoles(['owner', 'admin'], 'purchase_order',
      `New purchase order ${poNum}`,
      `${req.user.full_name} created PO ${poNum} for ${vendorQ.rows[0].name} (site: ${proj.rows[0].name})`,
      `/vendors?po=${po[0].id}`, 'purchase_order', po[0].id);
    res.status(201).json({ ...po[0], project_name: proj.rows[0].name, items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Legacy single-step approve endpoint — the approval flow is now the
// two-step (Admin -> Owner) sequence on /purchase-orders/:id/* . Kept as a
// no-op guard so an old client cannot bypass the workflow: any attempt here
// fails with a clear message pointing to the new endpoints.
router.put('/pos/:id/approve', authenticate, authorize('owner', 'admin'), async (req, res) => {
  return res.status(400).json({
    error: 'Single-step PO approval is disabled. Use POST /api/purchase-orders/:id/admin-approve (Admin) then /api/purchase-orders/:id/owner-approve (Owner).',
  });
});

router.put('/pos/:id/delivery', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    const { delivery_status, delivered_items } = req.body;
    if (delivered_items) {
      for (const di of delivered_items) {
        await pool.query('UPDATE purchase_order_items SET quantity_delivered=quantity_delivered+$1 WHERE id=$2', [di.quantity, di.item_id]);
      }
    }
    const { rows } = await pool.query(
      `UPDATE purchase_orders SET delivery_status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [delivery_status, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Create PO for a specific vendor (POST /vendors/:id/purchase-orders)
// Procurement role only; the Site (project_id) is mandatory.
router.post('/:id/purchase-orders', authenticate, authorize('procurement_officer'), async (req, res) => {
  try {
    const { items, notes, project_id } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Items required' });
    if (!project_id) return res.status(400).json({ error: 'Site (project) selection is required for a purchase order' });

    const { rows: vendor } = await pool.query('SELECT name FROM vendors WHERE id=$1', [req.params.id]);
    if (vendor.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    const proj = await pool.query('SELECT id, name FROM projects WHERE id=$1', [project_id]);
    if (proj.rows.length === 0) return res.status(400).json({ error: 'Selected site (project) does not exist' });

    const poNum = await nextPoNumber();
    const total_amount = items.reduce((sum, i) => sum + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);

    const { rows: po } = await pool.query(
      `INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, project_id, total_amount, notes, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
      [poNum, req.params.id, vendor[0].name, project_id, total_amount, notes || null, req.user.id]
    );

    for (const item of items) {
      await pool.query(
        `INSERT INTO purchase_order_items (po_id, material_name, quantity, unit, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [po[0].id, item.material_name, parseFloat(item.quantity) || 0, item.unit || 'pcs', parseFloat(item.unit_price) || 0,
         (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)]
      );
    }

    // Fetch PO with items to return
    const { rows: items_ } = await pool.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [po[0].id]);
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'purchase_order', po[0].id,
      `Created PO ${poNum} for ${vendor[0].name} (site: ${proj.rows[0].name})`);
    await addActivity(req.user.full_name, 'created', `Created ${poNum} for ${vendor[0].name} on ${proj.rows[0].name}`, 'purchase_order', po[0].id);
    await notifyRoles(['owner', 'admin'], 'purchase_order',
      `New purchase order ${poNum}`,
      `${req.user.full_name} created PO ${poNum} for ${vendor[0].name} (site: ${proj.rows[0].name})`,
      `/vendors?po=${po[0].id}`, 'purchase_order', po[0].id);
    res.status(201).json({ ...po[0], project_name: proj.rows[0].name, items: items_ });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;