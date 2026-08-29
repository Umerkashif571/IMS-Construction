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

// SPECIFIC ROUTES MUST COME BEFORE GENERIC /:id ROUTE
// Vendor Default Terms Management
router.get('/:id/terms', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendor_default_terms WHERE vendor_id=$1 AND is_active=true ORDER BY display_order', [req.params.id]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/terms', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { term_text, display_order } = req.body;
    if (!term_text || !term_text.trim()) return res.status(400).json({ error: 'Term text required' });
    const { rows } = await pool.query(
      `INSERT INTO vendor_default_terms (vendor_id, term_text, display_order, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, term_text.trim(), display_order || 0, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id/terms/:termId', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { term_text, display_order, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE vendor_default_terms SET term_text=$1, display_order=$2, is_active=$3, updated_at=NOW() WHERE id=$4 AND vendor_id=$5 RETURNING *`,
      [term_text?.trim(), display_order || 0, is_active !== false, req.params.termId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Term not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id/terms/:termId', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE vendor_default_terms SET is_active=false, updated_at=NOW() WHERE id=$1 AND vendor_id=$2 RETURNING id`,
      [req.params.termId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Term not found' });
    res.json({ message: 'Term deactivated' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id/terms/reorder', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { termIds } = req.body; // array of term IDs in new order
    if (!Array.isArray(termIds)) return res.status(400).json({ error: 'termIds array required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < termIds.length; i++) {
        await client.query(
          `UPDATE vendor_default_terms SET display_order=$1, updated_at=NOW() WHERE id=$2 AND vendor_id=$3`,
          [i, termIds[i], req.params.id]
        );
      }
      await client.query('COMMIT');
      res.json({ message: 'Terms reordered' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Purchase Orders list for a vendor
router.get('/:id/purchase-orders', authenticate, async (req, res) => {
  try {
    const vendorId = req.params.id;
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(vendorId)) {
      return res.status(400).json({ error: 'Invalid vendor ID format' });
    }

    const { status } = req.query;
    let sql = `SELECT po.*, v.name as vendor_name, p.name as project_name
             FROM purchase_orders po
             LEFT JOIN vendors v ON po.vendor_id=v.id
             LEFT JOIN projects p ON po.project_id=p.id
             WHERE po.vendor_id=$1`;
    const params = [vendorId];
    let idx = 2;
    if (status) { sql += ` AND po.status = $${idx}`; params.push(status); idx++; }
    sql += ' ORDER BY po.created_at DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /vendors/:id/purchase-orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create PO for a specific vendor
router.post('/:id/purchase-orders', authenticate, authorize('procurement_officer'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { items, notes, project_id, special_discount, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Items required' });
    if (!project_id) return res.status(400).json({ error: 'Site (project) selection is required for a purchase order' });

    const { rows: vendor } = await client.query('SELECT name FROM vendors WHERE id=$1', [req.params.id]);
    if (vendor.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    const proj = await client.query('SELECT id, name FROM projects WHERE id=$1', [project_id]);
    if (proj.rows.length === 0) return res.status(400).json({ error: 'Selected site (project) does not exist' });

    const poNum = await nextPoNumber();
    const total_amount = items.reduce((sum, i) => sum + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);
    const discount = parseFloat(special_discount) || 0;
    const discounted_total = total_amount - discount;

    const { rows: po } = await client.query(
      `INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, project_id, total_amount, special_discount, discounted_total, notes, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') RETURNING *`,
      [poNum, req.params.id, vendor[0].name, project_id, total_amount, discount, discounted_total, notes, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance, req.user.id]
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_order_items (po_id, material_name, quantity, unit, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [po[0].id, item.material_name, parseFloat(item.quantity) || 0, item.unit || 'pcs', parseFloat(item.unit_price) || 0,
         (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)]
      );
    }

    // Copy vendor default terms to PO
    const { rows: vendorTerms } = await client.query(
      `SELECT term_text, display_order FROM vendor_default_terms WHERE vendor_id=$1 AND is_active=true ORDER BY display_order`,
      [req.params.id]
    );
    for (const vt of vendorTerms) {
      await client.query(
        `INSERT INTO po_terms (po_id, term_text, display_order) VALUES ($1,$2,$3)`,
        [po[0].id, vt.term_text, vt.display_order]
      );
    }

    await client.query('COMMIT');

    // Fetch PO with items to return
    const { rows: items_ } = await client.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [po[0].id]);
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'purchase_order', po[0].id,
      `Created PO ${poNum} for ${vendor[0].name} (site: ${proj.rows[0].name})`);
    await addActivity(req.user.full_name, 'created', `Created ${poNum} for ${vendor[0].name} on ${proj.rows[0].name}`, 'purchase_order', po[0].id);
    await notifyRoles(['owner', 'admin'], 'purchase_order',
      `New purchase order ${poNum}`,
      `${req.user.full_name} created PO ${poNum} for ${vendor[0].name} (site: ${proj.rows[0].name})`,
      `/vendors?po=${po[0].id}`, 'purchase_order', po[0].id);
    res.status(201).json({ ...po[0], project_name: proj.rows[0].name, items: items_ });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GENERIC /:id ROUTE MUST BE LAST
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendors WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    const { rows: terms } = await pool.query('SELECT * FROM vendor_default_terms WHERE vendor_id=$1 AND is_active=true ORDER BY display_order', [req.params.id]);
    res.json({ ...rows[0], default_terms: terms });
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

router.post('/:id/terms', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { term_text, display_order } = req.body;
    if (!term_text || !term_text.trim()) return res.status(400).json({ error: 'Term text required' });
    const { rows } = await pool.query(
      `INSERT INTO vendor_default_terms (vendor_id, term_text, display_order, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, term_text.trim(), display_order || 0, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id/terms/:termId', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { term_text, display_order, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE vendor_default_terms SET term_text=$1, display_order=$2, is_active=$3, updated_at=NOW() WHERE id=$4 AND vendor_id=$5 RETURNING *`,
      [term_text?.trim(), display_order || 0, is_active !== false, req.params.termId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Term not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id/terms/:termId', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE vendor_default_terms SET is_active=false, updated_at=NOW() WHERE id=$1 AND vendor_id=$2 RETURNING id`,
      [req.params.termId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Term not found' });
    res.json({ message: 'Term deactivated' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id/terms/reorder', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { termIds } = req.body; // array of term IDs in new order
    if (!Array.isArray(termIds)) return res.status(400).json({ error: 'termIds array required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < termIds.length; i++) {
        await client.query(
          `UPDATE vendor_default_terms SET display_order=$1, updated_at=NOW() WHERE id=$2 AND vendor_id=$3`,
          [i, termIds[i], req.params.id]
        );
      }
      await client.query('COMMIT');
      res.json({ message: 'Terms reordered' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let { vendor_id, vendor_name, project_id, expected_delivery, notes, items, special_discount, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance } = req.body;
    if (!vendor_id || !items || items.length === 0) return res.status(400).json({ error: 'Vendor and items required' });
    if (!project_id) return res.status(400).json({ error: 'Site (project) selection is required for a purchase order' });
    const proj = await client.query('SELECT id, name FROM projects WHERE id=$1', [project_id]);
    if (proj.rows.length === 0) return res.status(400).json({ error: 'Selected site (project) does not exist' });
    const vendorQ = await client.query('SELECT id, name FROM vendors WHERE id=$1', [vendor_id]);
    if (vendorQ.rows.length === 0) return res.status(400).json({ error: 'Selected vendor does not exist' });
    // Generate PO number
    const poNum = await nextPoNumber();

    const total_amount = items.reduce((sum, i) => sum + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);
    const discount = parseFloat(special_discount) || 0;
    const discounted_total = total_amount - discount;

    const { rows: po } = await client.query(
      `INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, project_id, expected_delivery, total_amount, special_discount, discounted_total, notes, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [poNum, vendor_id, vendorQ.rows[0].name, project_id, expected_delivery, total_amount, discount, discounted_total, notes, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance, req.user.id]
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_order_items (po_id, material_name, description, quantity, unit, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [po[0].id, item.material_name, item.description, item.quantity, item.unit, item.unit_price, item.quantity * item.unit_price]
      );
    }

    // Copy vendor default terms to PO
    const { rows: vendorTerms } = await client.query(
      `SELECT term_text, display_order FROM vendor_default_terms WHERE vendor_id=$1 AND is_active=true ORDER BY display_order`,
      [vendor_id]
    );
    for (const vt of vendorTerms) {
      await client.query(
        `INSERT INTO po_terms (po_id, term_text, display_order) VALUES ($1,$2,$3)`,
        [po[0].id, vt.term_text, vt.display_order]
      );
    }

    await client.query('COMMIT');

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'purchase_order', po[0].id, `Created PO ${poNum}: ${vendorQ.rows[0].name} (site: ${proj.rows[0].name})`);
    await addActivity(req.user.full_name, 'created', `Created ${poNum} for ${vendorQ.rows[0].name} on ${proj.rows[0].name}`, 'purchase_order', po[0].id);
    await notifyRoles(['owner', 'admin'], 'purchase_order',
      `New purchase order ${poNum}`,
      `${req.user.full_name} created PO ${poNum} for ${vendorQ.rows[0].name} (site: ${proj.rows[0].name})`,
      `/vendors?po=${po[0].id}`, 'purchase_order', po[0].id);
    res.status(201).json({ ...po[0], project_name: proj.rows[0].name, items });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { items, notes, project_id, special_discount, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Items required' });
    if (!project_id) return res.status(400).json({ error: 'Site (project) selection is required for a purchase order' });

    const { rows: vendor } = await client.query('SELECT name FROM vendors WHERE id=$1', [req.params.id]);
    if (vendor.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    const proj = await client.query('SELECT id, name FROM projects WHERE id=$1', [project_id]);
    if (proj.rows.length === 0) return res.status(400).json({ error: 'Selected site (project) does not exist' });

    const poNum = await nextPoNumber();
    const total_amount = items.reduce((sum, i) => sum + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);
    const discount = parseFloat(special_discount) || 0;
    const discounted_total = total_amount - discount;

    const { rows: po } = await client.query(
      `INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, project_id, total_amount, special_discount, discounted_total, notes, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending') RETURNING *`,
      [poNum, req.params.id, vendor[0].name, project_id, total_amount, discount, discounted_total, notes, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance, req.user.id]
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_order_items (po_id, material_name, quantity, unit, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [po[0].id, item.material_name, parseFloat(item.quantity) || 0, item.unit || 'pcs', parseFloat(item.unit_price) || 0,
         (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)]
      );
    }

    // Copy vendor default terms to PO
    const { rows: vendorTerms } = await client.query(
      `SELECT term_text, display_order FROM vendor_default_terms WHERE vendor_id=$1 AND is_active=true ORDER BY display_order`,
      [req.params.id]
    );
    for (const vt of vendorTerms) {
      await client.query(
        `INSERT INTO po_terms (po_id, term_text, display_order) VALUES ($1,$2,$3)`,
        [po[0].id, vt.term_text, vt.display_order]
      );
    }

    await client.query('COMMIT');

    // Fetch PO with items to return
    const { rows: items_ } = await client.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [po[0].id]);
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'purchase_order', po[0].id,
      `Created PO ${poNum} for ${vendor[0].name} (site: ${proj.rows[0].name})`);
    await addActivity(req.user.full_name, 'created', `Created ${poNum} for ${vendor[0].name} on ${proj.rows[0].name}`, 'purchase_order', po[0].id);
    await notifyRoles(['owner', 'admin'], 'purchase_order',
      `New purchase order ${poNum}`,
      `${req.user.full_name} created PO ${poNum} for ${vendor[0].name} (site: ${proj.rows[0].name})`,
      `/vendors?po=${po[0].id}`, 'purchase_order', po[0].id);
    res.status(201).json({ ...po[0], project_name: proj.rows[0].name, items: items_ });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;