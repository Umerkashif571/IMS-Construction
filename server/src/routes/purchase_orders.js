const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity } = require('../db/helpers');

const router = express.Router();

// List all POs with optional filters
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, vendor_id, search } = req.query;
    let sql = `SELECT po.*, v.name as vendor_name, v.contact_person as vendor_contact, v.phone as vendor_phone, v.email as vendor_email, v.city as vendor_city, v.address as vendor_address FROM purchase_orders po LEFT JOIN vendors v ON po.vendor_id=v.id WHERE 1=1`;
    const params = []; let idx = 1;
    if (status) { sql += ` AND po.status = $${idx}`; params.push(status); idx++; }
    if (vendor_id) { sql += ` AND po.vendor_id = $${idx}`; params.push(vendor_id); idx++; }
    if (search) { sql += ` AND (po.po_number ILIKE $${idx} OR v.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    sql += ' ORDER BY po.created_at DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Get single PO with items
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows: po } = await pool.query(
      `SELECT po.*, v.name as vendor_name, v.contact_person as vendor_contact, v.phone as vendor_phone, v.email as vendor_email, v.city as vendor_city, v.address as vendor_address FROM purchase_orders po LEFT JOIN vendors v ON po.vendor_id=v.id WHERE po.id=$1`,
      [req.params.id]
    );
    if (po.length === 0) return res.status(404).json({ error: 'PO not found' });
    const { rows: items } = await pool.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [req.params.id]);
    res.json({ ...po[0], items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Update PO status (pending -> approved -> received, or cancelled)
router.put('/:id/status', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'approved', 'received', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const { rows: po } = await pool.query('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (po.length === 0) return res.status(404).json({ error: 'PO not found' });

    if (status === 'approved' && !['owner', 'admin'].includes(req.user.role))
      return res.status(403).json({ error: 'Only owners and admins can approve POs' });

    const deliveryMap = { 'received': 'delivered', 'partial_received': 'partial', 'cancelled': 'cancelled' };
    let deliveryStatus = deliveryMap[status] || 'pending';
    let updateFields = 'status=$1, delivery_status=$2, updated_at=NOW()';
    const params = [status, deliveryStatus];

    if (status === 'received') {
      updateFields += ', received_by=$3';
      params.push(req.user.full_name);
    }

    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE purchase_orders SET ${updateFields} WHERE id=$${params.length} RETURNING *`,
      params
    );

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'po_status', 'purchase_order', req.params.id,
      `PO ${po[0].po_number} status changed to ${status}`);
    await addActivity(req.user.full_name, 'po_status', `PO ${po[0].po_number} ${status}`, 'purchase_order', req.params.id);

    // Fetch items to return full PO object
    const { rows: items } = await pool.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [req.params.id]);
    res.json({ ...rows[0], items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Approve PO (helper endpoint for frontend)
router.put('/:id/approve', authenticate, authorize('owner', 'admin', 'procurement_officer'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE purchase_orders SET status='approved', approved_by=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'PO not found' });
    const { rows: items } = await pool.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [req.params.id]);
    res.json({ ...rows[0], items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
