const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles, createNotification } = require('../db/helpers');
const { requireUuid, isUuid, dbError, toNumber, isDate } = require('../middleware/validate');
const { d, add, mul, sub, round2, toFixed } = require('../utils/decimal');

const router = express.Router();

// Malformed ids → 400 instead of a Postgres 22P02 → 500
router.param('id', requireUuid);
router.param('termId', requireUuid);
router.param('poId', requireUuid);

const VENDOR_STATUSES = ['active', 'inactive'];
// PO states that still expect goods / money — a vendor with one of these cannot be deactivated
const OPEN_PO_STATUSES = ['pending', 'admin_approved', 'approved', 'ordered', 'partial_received'];
const PO_STATUSES = ['pending', 'admin_approved', 'approved', 'rejected', 'ordered', 'partial_received', 'received', 'completed', 'cancelled', 'delivered', 'returned'];
const MAX_PO_ITEMS = 500;
const MAX_LIST = 200;

const isStr = (v) => typeof v === 'string';
const optStr = (v, n) => v === null || v === undefined || (isStr(v) && v.length <= n);
const pageOf = (query, def = 100) => {
  const limit = Math.min(MAX_LIST, Math.max(1, parseInt(query.limit, 10) || def));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  return { limit, offset: (page - 1) * limit };
};

// ---------------------------------------------------------------------------
// PO numbering: PO-<year>-<6 digits> from a Postgres sequence, so parallel
// creates never collide and no MAX()+1 read is needed. The sequence lives in
// schema.js eventually; until then it is created lazily once per process
// (never while a transaction client is checked out).
// ---------------------------------------------------------------------------
let poSeqReady = null;
function ensurePoSequence() {
  if (!poSeqReady) {
    poSeqReady = (async () => {
      try {
        await pool.query('CREATE SEQUENCE IF NOT EXISTS po_number_seq START 1');
        // A freshly created sequence continues after the highest legacy PO-YYYY-NNN number
        const { rows } = await pool.query(`SELECT is_called FROM po_number_seq`);
        if (rows.length && !rows[0].is_called) {
          await pool.query(
            `SELECT setval('po_number_seq', GREATEST(1, (
               SELECT COALESCE(MAX((REGEXP_MATCH(po_number, '^PO-[0-9]{4}-([0-9]+)$'))[1]::bigint), 0)
               FROM purchase_orders WHERE po_number ~ '^PO-[0-9]{4}-[0-9]+$')), true)`
          );
        }
      } catch (err) {
        // 23505/42P07: another process created it first — fine
        if (!['23505', '42P07'].includes(err.code)) { poSeqReady = null; throw err; }
      }
    })();
  }
  return poSeqReady;
}
async function nextPoNumber(client) {
  const { rows } = await client.query(`SELECT nextval('po_number_seq') AS n`);
  return `PO-${new Date().getFullYear()}-${String(rows[0].n).padStart(6, '0')}`;
}

// Validate + normalise the items/discount of a PO body. Returns { error } or the parsed values.
function parsePoItems(items, special_discount) {
  if (!Array.isArray(items) || items.length === 0) return { error: 'Items required' };
  if (items.length > MAX_PO_ITEMS) return { error: `A purchase order may have at most ${MAX_PO_ITEMS} items` };
  const parsed = [];
  let total = d(0);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const n = i + 1;
    if (!it || typeof it !== 'object' || Array.isArray(it)) return { error: `Item ${n} is invalid` };
    const name = isStr(it.material_name) ? it.material_name.trim() : '';
    if (!name) return { error: `Item ${n}: material name is required` };
    if (name.length > 255) return { error: `Item ${n}: material name must be 255 characters or less` };
    const q = toNumber(it.quantity);
    if (q === null || Number.isNaN(q) || q <= 0) return { error: `Item ${n}: quantity must be a number greater than 0` };
    const p = toNumber(it.unit_price);
    if (p === null || Number.isNaN(p) || p < 0) return { error: `Item ${n}: unit price must be a number of 0 or more` };
    if (q >= 1e13) return { error: `Item ${n}: quantity is out of range` };
    if (p >= 1e10) return { error: `Item ${n}: unit price is out of range` };
    if (!optStr(it.unit, 50)) return { error: `Item ${n}: unit must be 50 characters or less` };
    if (it.description !== undefined && it.description !== null && !isStr(it.description)) return { error: `Item ${n}: description must be text` };
    const lineTotal = round2(mul(q, p));
    total = add(total, lineTotal);
    parsed.push({
      material_name: name, description: it.description || null, quantity: toFixed(q), unit: (it.unit && it.unit.trim()) || 'pcs',
      unit_price: toFixed(p), total_price: toFixed(lineTotal),
    });
  }
  const discountNum = special_discount === undefined || special_discount === null ? 0 : toNumber(special_discount);
  if (discountNum === null || Number.isNaN(discountNum)) return { error: 'Special discount must be a number' };
  const discount = round2(discountNum);
  if (discount.lt(0) || discount.gt(total)) return { error: 'Special discount must be between 0 and the PO total' };
  total = round2(total);
  if (!total.isFinite() || total.gte(1e13)) return { error: 'PO total is out of range' };
  return { items: parsed, total_amount: toFixed(total), special_discount: toFixed(discount), discounted_total: toFixed(sub(total, discount)) };
}

function parseTerms(terms) {
  if (terms === undefined || terms === null) return { terms: [] };
  if (!Array.isArray(terms)) return { error: 'terms must be an array' };
  const out = [];
  for (const t of terms) {
    if (!t || typeof t !== 'object') continue;
    if (!isStr(t.term_text) || !t.term_text.trim()) continue; // blank custom terms are skipped
    const order = toNumber(t.display_order);
    out.push({ term_text: t.term_text.trim(), display_order: Number.isInteger(order) && order >= 0 ? order : out.length });
  }
  return { terms: out };
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status } = req.query;
    let sql = 'SELECT * FROM vendors WHERE 1=1';
    const params = [];
    let idx = 1;
    if (isStr(search) && search) { sql += ` AND (name ILIKE $${idx} OR contact_person ILIKE $${idx} OR city ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    // Deactivated vendors are hidden unless explicitly asked for (?status=inactive or ?status=all)
    if (status !== 'all') {
      const st = VENDOR_STATUSES.includes(status) ? status : 'active';
      sql += ` AND status = $${idx}`; params.push(st); idx++;
    }
    const { limit, offset } = pageOf(req.query, MAX_LIST);
    sql += ` ORDER BY name LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

// SPECIFIC ROUTES MUST COME BEFORE GENERIC /:id ROUTE
// Vendor Default Terms Management
router.get('/:id/terms', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendor_default_terms WHERE vendor_id=$1 AND is_active=true ORDER BY display_order', [req.params.id]);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.post('/:id/terms', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { term_text, display_order } = req.body;
    if (!isStr(term_text) || !term_text.trim()) return res.status(400).json({ error: 'Term text required' });
    const order = display_order === undefined || display_order === null ? 0 : toNumber(display_order);
    if (!Number.isInteger(order) || order < 0) return res.status(400).json({ error: 'display_order must be a non-negative integer' });
    const { rows: vendor } = await pool.query('SELECT id FROM vendors WHERE id=$1', [req.params.id]);
    if (vendor.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    const { rows } = await pool.query(
      `INSERT INTO vendor_default_terms (vendor_id, term_text, display_order, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, term_text.trim(), order, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

// Must be registered BEFORE /:id/terms/:termId or 'reorder' is bound as a termId
router.put('/:id/terms/reorder', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  const { termIds } = req.body; // array of term IDs in new order
  if (!Array.isArray(termIds) || termIds.length === 0) return res.status(400).json({ error: 'termIds array required' });
  if (termIds.length > 500) return res.status(400).json({ error: 'Too many terms' });
  if (!termIds.every(isUuid)) return res.status(400).json({ error: 'termIds must be valid ids' });
  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const { rows: vendor } = await client.query('SELECT id FROM vendors WHERE id=$1', [req.params.id]);
    if (vendor.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Vendor not found' }); }
    for (let i = 0; i < termIds.length; i++) {
      const { rowCount } = await client.query(
        `UPDATE vendor_default_terms SET display_order=$1, updated_at=NOW() WHERE id=$2 AND vendor_id=$3`,
        [i, termIds[i], req.params.id]
      );
      if (rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: `Term ${termIds[i]} not found for this vendor` }); }
    }
    await client.query('COMMIT');
    client.release(); released = true;
    const { rows } = await pool.query('SELECT * FROM vendor_default_terms WHERE vendor_id=$1 AND is_active=true ORDER BY display_order', [req.params.id]);
    res.json({ message: 'Terms reordered', terms: rows });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

router.put('/:id/terms/:termId', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { term_text, display_order, is_active } = req.body;
    if (term_text !== undefined && term_text !== null && (!isStr(term_text) || !term_text.trim()))
      return res.status(400).json({ error: 'Term text cannot be blank' });
    let order = null;
    if (display_order !== undefined && display_order !== null) {
      order = toNumber(display_order);
      if (!Number.isInteger(order) || order < 0) return res.status(400).json({ error: 'display_order must be a non-negative integer' });
    }
    if (is_active !== undefined && is_active !== null && typeof is_active !== 'boolean')
      return res.status(400).json({ error: 'is_active must be true or false' });
    const { rows } = await pool.query(
      `UPDATE vendor_default_terms
       SET term_text=COALESCE($1, term_text), display_order=COALESCE($2, display_order), is_active=COALESCE($3, is_active), updated_at=NOW()
       WHERE id=$4 AND vendor_id=$5 RETURNING *`,
      [isStr(term_text) ? term_text.trim() : null, order, typeof is_active === 'boolean' ? is_active : null, req.params.termId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Term not found' });
    res.json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

router.delete('/:id/terms/:termId', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE vendor_default_terms SET is_active=false, updated_at=NOW() WHERE id=$1 AND vendor_id=$2 RETURNING id`,
      [req.params.termId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Term not found' });
    res.json({ message: 'Term deactivated' });
  } catch (err) { return dbError(res, err); }
});

// Purchase Orders list for a vendor
router.get('/:id/purchase-orders', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    if (status && !PO_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status filter' });
    let sql = `SELECT po.*, v.name as vendor_name, p.name as project_name
             FROM purchase_orders po
             LEFT JOIN vendors v ON po.vendor_id=v.id
             LEFT JOIN projects p ON po.project_id=p.id
             WHERE po.vendor_id=$1`;
    const params = [req.params.id];
    let idx = 2;
    if (status) { sql += ` AND po.status = $${idx}`; params.push(status); idx++; }
    const { limit, offset } = pageOf(req.query);
    sql += ` ORDER BY po.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

// Shared PO creation (used by POST /:id/purchase-orders and the legacy POST /pos).
// PO creation is exclusive to the Procurement role (spec). The Site (project_id)
// is mandatory — no project means no PO.
async function createPurchaseOrder(req, res, vendorId) {
  const { notes, project_id, special_discount, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance, terms, expected_delivery, items } = req.body;

  // ---- validate everything BEFORE touching the pool ----
  const parsed = parsePoItems(items, special_discount);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (!project_id) return res.status(400).json({ error: 'Site (project) selection is required for a purchase order' });
  if (!isUuid(project_id)) return res.status(400).json({ error: 'Selected site (project) is invalid' });
  const parsedTerms = parseTerms(terms);
  if (parsedTerms.error) return res.status(400).json({ error: parsedTerms.error });
  if (!isDate(expected_delivery)) return res.status(400).json({ error: 'expected_delivery must be a valid date' });
  for (const [field, val, n] of [['notes', notes, 5000], ['account_charged', account_charged, 5000], ['product_category', product_category, 255],
    ['approved_by_name', approved_by_name, 255], ['note_to_accounts', note_to_accounts, 5000], ['seller_acceptance', seller_acceptance, 5000]]) {
    if (!optStr(val, n)) return res.status(400).json({ error: `${field} must be text of at most ${n} characters` });
  }

  await ensurePoSequence();

  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');

    const { rows: vendor } = await client.query('SELECT id, name, status FROM vendors WHERE id=$1', [vendorId]);
    if (vendor.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Vendor not found' }); }
    if (vendor[0].status !== 'active') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Vendor is inactive — reactivate it before creating a purchase order' }); }
    const { rows: projRows } = await client.query('SELECT id, name, status FROM projects WHERE id=$1', [project_id]);
    if (projRows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Selected site (project) does not exist' }); }
    if (['completed', 'cancelled'].includes(projRows[0].status)) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Selected site (project) is ${projRows[0].status} — purchase orders cannot be raised for it` }); }
    const proj = projRows[0];

    const poNum = await nextPoNumber(client);

    const { rows: po } = await client.query(
      `INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, project_id, expected_delivery, total_amount, special_discount, discounted_total, notes, account_charged, product_category, approved_by_name, note_to_accounts, seller_acceptance, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending') RETURNING *`,
      [poNum, vendorId, vendor[0].name, project_id, expected_delivery || null, parsed.total_amount, parsed.special_discount, parsed.discounted_total,
        notes || null, account_charged || null, product_category || null, approved_by_name || null, note_to_accounts || null, seller_acceptance || null, req.user.id]
    );

    for (const item of parsed.items) {
      await client.query(
        `INSERT INTO purchase_order_items (po_id, material_name, description, quantity, unit, unit_price, total_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [po[0].id, item.material_name, item.description, item.quantity, item.unit, item.unit_price, item.total_price]
      );
    }

    // Copy vendor default terms to PO (frozen snapshot)
    const { rows: vendorTerms } = await client.query(
      `SELECT term_text, display_order FROM vendor_default_terms WHERE vendor_id=$1 AND is_active=true ORDER BY display_order`,
      [vendorId]
    );
    // If the client sent its own (edited) list of terms, that list is the snapshot; otherwise use the defaults.
    const finalTerms = parsedTerms.terms.length > 0 ? parsedTerms.terms : vendorTerms;
    for (const t of finalTerms) {
      await client.query(`INSERT INTO po_terms (po_id, term_text, display_order) VALUES ($1,$2,$3)`, [po[0].id, t.term_text, t.display_order]);
    }

    const { rows: items_ } = await client.query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at', [po[0].id]);
    const { rows: poTerms } = await client.query('SELECT * FROM po_terms WHERE po_id=$1 ORDER BY display_order', [po[0].id]);
    await client.query('COMMIT');
    client.release(); released = true;

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'purchase_order', po[0].id,
      `Created PO ${poNum} for ${vendor[0].name} (site: ${proj.name})`);
    await addActivity(req.user.full_name, 'created', `Created ${poNum} for ${vendor[0].name} on ${proj.name}`, 'purchase_order', po[0].id);
    await notifyRoles(['owner', 'admin'], 'purchase_order',
      `New purchase order ${poNum}`,
      `${req.user.full_name} created PO ${poNum} for ${vendor[0].name} (site: ${proj.name})`,
      `/vendors?po=${po[0].id}`, 'purchase_order', po[0].id);
    return res.status(201).json({ ...po[0], project_name: proj.name, items: items_, terms: poTerms });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
}

// Create PO for a specific vendor
router.post('/:id/purchase-orders', authenticate, authorize('procurement_officer'), (req, res) => createPurchaseOrder(req, res, req.params.id));

// Legacy body-based create (vendor_id in body) — same handler, same rules
router.post('/pos', authenticate, authorize('procurement_officer'), (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).json({ error: 'Vendor and items required' });
  if (!isUuid(vendor_id)) return res.status(400).json({ error: 'Invalid vendor id' });
  return createPurchaseOrder(req, res, vendor_id);
});

// GENERIC /:id ROUTE MUST BE LAST among the /:id* GET routes
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendors WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    const { rows: terms } = await pool.query('SELECT * FROM vendor_default_terms WHERE vendor_id=$1 AND is_active=true ORDER BY display_order', [req.params.id]);
    res.json({ ...rows[0], default_terms: terms });
  } catch (err) { return dbError(res, err); }
});

const VENDOR_FIELDS = [
  ['name', 255], ['contact_person', 255], ['email', 255], ['phone', 100], ['address', 5000], ['city', 100], ['province', 100],
  ['ntn', 100], ['strn', 100], ['payment_terms', 255], ['attn', 255], ['position', 255], ['vendor_email', 255], ['vendor_tel', 100],
];
function vendorFieldError(body) {
  for (const [f, n] of VENDOR_FIELDS) {
    if (!optStr(body[f], n)) return `${f} must be text of at most ${n} characters`;
  }
  if (body.status !== undefined && body.status !== null && !VENDOR_STATUSES.includes(body.status)) return 'status must be active or inactive';
  return null;
}

router.post('/', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!isStr(b.name) || !b.name.trim()) return res.status(400).json({ error: 'Vendor name required' });
    const fieldErr = vendorFieldError(b);
    if (fieldErr) return res.status(400).json({ error: fieldErr });
    const name = b.name.trim();
    const { rows: dup } = await pool.query('SELECT id FROM vendors WHERE LOWER(name)=LOWER($1)', [name]);
    if (dup.length) return res.status(409).json({ error: 'A vendor with this name already exists' });
    const { rows } = await pool.query(
      `INSERT INTO vendors (name, contact_person, email, phone, address, city, province, ntn, strn, payment_terms, attn, position, vendor_email, vendor_tel, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [name, b.contact_person, b.email, b.phone, b.address, b.city, b.province, b.ntn, b.strn, b.payment_terms, b.attn, b.position, b.vendor_email, b.vendor_tel, b.status || 'active']
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'vendor', rows[0].id, `Added vendor: ${name}`);
    await addActivity(req.user.full_name, 'created', `Added vendor: ${name}`, 'vendor', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

// Partial update: omitted fields keep their value (COALESCE)
router.put('/:id', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const b = req.body || {};
    if (b.name !== undefined && b.name !== null && (!isStr(b.name) || !b.name.trim())) return res.status(400).json({ error: 'Vendor name cannot be blank' });
    const fieldErr = vendorFieldError(b);
    if (fieldErr) return res.status(400).json({ error: fieldErr });
    const name = isStr(b.name) ? b.name.trim() : null;
    if (name) {
      const { rows: dup } = await pool.query('SELECT id FROM vendors WHERE LOWER(name)=LOWER($1) AND id<>$2', [name, req.params.id]);
      if (dup.length) return res.status(409).json({ error: 'A vendor with this name already exists' });
    }
    const { rows } = await pool.query(
      `UPDATE vendors SET name=COALESCE($1,name), contact_person=COALESCE($2,contact_person), email=COALESCE($3,email), phone=COALESCE($4,phone),
         address=COALESCE($5,address), city=COALESCE($6,city), province=COALESCE($7,province), ntn=COALESCE($8,ntn), strn=COALESCE($9,strn),
         payment_terms=COALESCE($10,payment_terms), status=COALESCE($11,status), attn=COALESCE($12,attn), position=COALESCE($13,position),
         vendor_email=COALESCE($14,vendor_email), vendor_tel=COALESCE($15,vendor_tel), updated_at=NOW()
       WHERE id=$16 RETURNING *`,
      [name, b.contact_person, b.email, b.phone, b.address, b.city, b.province, b.ntn, b.strn, b.payment_terms, b.status || null,
        b.attn, b.position, b.vendor_email, b.vendor_tel, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'vendor', rows[0].id, `Updated vendor: ${rows[0].name}`);
    res.json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

// Soft delete (status='inactive'); refused while the vendor still has open POs
router.delete('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows: vendor } = await pool.query('SELECT id, name, status FROM vendors WHERE id=$1', [req.params.id]);
    if (vendor.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    if (vendor[0].status === 'inactive') return res.json({ message: 'Vendor is already inactive', already_inactive: true });
    const { rows: open } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM purchase_orders WHERE vendor_id=$1 AND status = ANY($2)', [req.params.id, OPEN_PO_STATUSES]);
    if (open[0].n > 0) return res.status(409).json({ error: `Vendor has ${open[0].n} open purchase order(s) — receive or cancel them before deactivating` });
    await pool.query(`UPDATE vendors SET status='inactive', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'deactivated', 'vendor', req.params.id, `Deactivated vendor: ${vendor[0].name}`);
    await addActivity(req.user.full_name, 'deactivated', `Deactivated vendor: ${vendor[0].name}`, 'vendor', req.params.id);
    res.json({ message: 'Vendor deactivated' });
  } catch (err) { return dbError(res, err); }
});

// ---------------------------------------------------------------------------
// Purchase Orders (legacy /pos/* paths still used by the UI list)
// ---------------------------------------------------------------------------
router.get('/pos/list', authenticate, async (req, res) => {
  try {
    const { status, vendor_id } = req.query;
    if (status && !PO_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status filter' });
    if (vendor_id && !isUuid(vendor_id)) return res.status(400).json({ error: 'Invalid vendor id' });
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
    const { limit, offset } = pageOf(req.query);
    sql += ` ORDER BY po.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { return dbError(res, err); }
});

router.get('/pos/:poId', authenticate, async (req, res) => {
  try {
    const { rows: po } = await pool.query(`SELECT po.*, v.name as vendor_name, p.name as project_name,
        au.full_name as admin_approved_by_name, ou.full_name as owner_approved_by_name
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id=v.id
      LEFT JOIN projects p ON po.project_id=p.id
      LEFT JOIN users au ON po.admin_approved_by=au.id
      LEFT JOIN users ou ON po.owner_approved_by=ou.id
      WHERE po.id=$1`, [req.params.poId]);
    if (po.length === 0) return res.status(404).json({ error: 'PO not found' });
    const { rows: items } = await pool.query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at', [req.params.poId]);
    const { rows: terms } = await pool.query('SELECT * FROM po_terms WHERE po_id=$1 ORDER BY display_order', [req.params.poId]);
    res.json({ ...po[0], items, terms });
  } catch (err) { return dbError(res, err); }
});

// Legacy single-step approve endpoint — the approval flow is now the
// two-step (Admin -> Owner) sequence on /purchase-orders/:id/* . Kept as a
// no-op guard so an old client cannot bypass the workflow.
router.put('/pos/:poId/approve', authenticate, authorize('owner', 'admin'), async (req, res) => {
  return res.status(400).json({
    error: 'Single-step PO approval is disabled. Use POST /api/purchase-orders/:id/admin-approve (Admin) then /api/purchase-orders/:id/owner-approve (Owner).',
  });
});

// Receive goods against a fully-approved PO. One atomic operation:
//   - only status approved / partial_received
//   - per-item quantities: finite, >= 0, cumulative <= ordered, item must belong to this PO
//   - stock moves in for every item that matches a material by exact name
//     (materials.quantity + material_transactions + stock_movements, like materials.js stock-in)
//   - delivery_status / status derived from the items afterwards
// Body: { delivered_items: [{ item_id, quantity }], warehouse_id?, notes? }
router.put('/pos/:poId/delivery', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  const { delivered_items, warehouse_id, notes, delivery_status } = req.body;
  if (!Array.isArray(delivered_items) || delivered_items.length === 0) return res.status(400).json({ error: 'delivered_items array required' });
  if (delivered_items.length > MAX_PO_ITEMS) return res.status(400).json({ error: 'Too many items' });
  if (delivery_status !== undefined && delivery_status !== null && !['partial', 'delivered'].includes(delivery_status))
    return res.status(400).json({ error: 'delivery_status must be partial or delivered (it is derived from the received quantities)' });
  if (warehouse_id !== undefined && warehouse_id !== null && !isUuid(warehouse_id)) return res.status(400).json({ error: 'Invalid warehouse id' });
  if (!optStr(notes, 5000)) return res.status(400).json({ error: 'notes must be text of at most 5000 characters' });
  const receipts = new Map();
  for (let i = 0; i < delivered_items.length; i++) {
    const di = delivered_items[i];
    if (!di || typeof di !== 'object' || !isUuid(di.item_id)) return res.status(400).json({ error: `delivered_items[${i}]: valid item_id required` });
    const q = toNumber(di.quantity);
    if (q === null || Number.isNaN(q) || q < 0 || q >= 1e13) return res.status(400).json({ error: `delivered_items[${i}]: quantity must be a number of 0 or more` });
    receipts.set(di.item_id, add(receipts.get(di.item_id) || 0, round2(q)));
  }
  if (![...receipts.values()].some(q => q.gt(0))) return res.status(400).json({ error: 'Nothing to receive — every quantity is 0' });

  const client = await pool.connect();
  let released = false;
  const fail = async (code, error) => { await client.query('ROLLBACK'); return res.status(code).json({ error }); };
  try {
    await client.query('BEGIN');
    const { rows: poRows } = await client.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.poId]);
    if (poRows.length === 0) return fail(404, 'PO not found');
    const po = poRows[0];
    if (!['approved', 'partial_received'].includes(po.status))
      return fail(400, `Only fully approved POs can be received (current status: ${po.status})`);

    let warehouseId = warehouse_id || null;
    if (warehouseId) {
      const { rows: wh } = await client.query('SELECT id FROM warehouses WHERE id=$1', [warehouseId]);
      if (wh.length === 0) return fail(400, 'Warehouse not found');
    }

    const { rows: items } = await client.query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at FOR UPDATE', [po.id]);
    const byId = new Map(items.map(it => [it.id, it]));
    for (const itemId of receipts.keys()) {
      if (!byId.has(itemId)) return fail(400, `Item ${itemId} does not belong to this PO`);
    }
    for (const [itemId, qty] of receipts) {
      const it = byId.get(itemId);
      const newDelivered = add(it.quantity_delivered, qty);
      if (newDelivered.gt(d(it.quantity)))
        return fail(400, `${it.material_name}: receiving ${toFixed(qty)} would exceed the ordered ${toFixed(it.quantity)} (already received ${toFixed(it.quantity_delivered)})`);
    }

    const unmatched = [];
    const stocked = [];
    for (const [itemId, qty] of receipts) {
      const it = byId.get(itemId);
      if (qty.gt(0)) {
        const { rows: mat } = await client.query(
          'SELECT * FROM materials WHERE LOWER(name)=LOWER($1) AND is_active=true ORDER BY created_at LIMIT 1 FOR UPDATE', [it.material_name]);
        if (mat.length === 0) {
          unmatched.push({ item_id: it.id, material_name: it.material_name, quantity: toFixed(qty) });
        } else {
          const m = mat[0];
          const whId = warehouseId || m.warehouse_id || null;
          const { rows: upd } = await client.query(
            'UPDATE materials SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2 RETURNING quantity', [toFixed(qty), m.id]);
          const newQty = upd[0].quantity;
          await client.query(
            `INSERT INTO material_transactions (material_id, type, quantity, running_total, warehouse_id, project_id, added_by, notes, source, received_by, transaction_type, date, po_id)
             VALUES ($1, 'in', $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`,
            [m.id, toFixed(qty), newQty, whId, po.project_id, req.user.full_name, notes || `Received against PO ${po.po_number}`,
              po.vendor_name || null, req.user.full_name, 'purchase', po.id]
          );
          await client.query(
            `INSERT INTO stock_movements (material_id, material_name, movement_type, quantity, unit, reference_type, reference_id, notes, warehouse_id, user_id, user_name)
             VALUES ($1,$2,'in',$3,$4,'purchase_order',$5,$6,$7,$8,$9)`,
            [m.id, m.name, toFixed(qty), m.unit, po.id, notes || `PO ${po.po_number}`, whId, req.user.id, req.user.full_name]
          );
          stocked.push({ item_id: it.id, material_id: m.id, material_name: m.name, quantity: toFixed(qty), new_quantity: newQty });
        }
      }
      const { rows: updItem } = await client.query(
        'UPDATE purchase_order_items SET quantity_delivered = quantity_delivered + $1 WHERE id=$2 AND po_id=$3 RETURNING *', [toFixed(qty), it.id, po.id]);
      byId.set(it.id, updItem[0]);
    }

    const finalItems = items.map(it => byId.get(it.id));
    const allReceived = finalItems.every(it => d(it.quantity_delivered).gte(d(it.quantity)));
    const anyReceived = finalItems.some(it => d(it.quantity_delivered).gt(0));
    const newDeliveryStatus = allReceived ? 'delivered' : (anyReceived ? 'partial' : 'pending');
    const newStatus = allReceived ? 'received' : (anyReceived ? 'partial_received' : po.status);
    const { rows: updatedPo } = await client.query(
      `UPDATE purchase_orders SET status=$1, delivery_status=$2, received_by=COALESCE($3, received_by), updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [newStatus, newDeliveryStatus, newStatus === 'received' ? req.user.full_name : null, po.id]
    );
    await client.query('COMMIT');
    client.release(); released = true;

    const summary = stocked.map(s => `${s.quantity} x ${s.material_name}`).join(', ');
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'po_receive', 'purchase_order', po.id,
      `Received against PO ${po.po_number}: ${summary || 'no stocked items'}${unmatched.length ? `; unmatched: ${unmatched.map(u => u.material_name).join(', ')}` : ''} → ${newStatus}`);
    await addActivity(req.user.full_name, 'po_receive', `Received goods for PO ${po.po_number} (${newDeliveryStatus})`, 'purchase_order', po.id);
    if (po.created_by) {
      await createNotification(po.created_by, 'purchase_order', `PO ${po.po_number} ${newStatus === 'received' ? 'received' : 'partially received'}`,
        `${req.user.full_name} received goods against PO ${po.po_number} (${po.vendor_name || 'vendor'})`, `/vendors?po=${po.id}`, 'purchase_order', po.id);
    }
    res.json({ ...updatedPo[0], items: finalItems, stocked_items: stocked, unmatched_items: unmatched });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

module.exports = router;
