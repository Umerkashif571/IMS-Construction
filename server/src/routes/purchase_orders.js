const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles, createNotification } = require('../db/helpers');

const router = express.Router();

const PO_JOIN = `
  SELECT po.*,
         v.name as vendor_name, v.contact_person as vendor_contact, v.phone as vendor_phone,
         v.email as vendor_email, v.city as vendor_city, v.address as vendor_address,
         p.name as project_name,
         au.full_name as admin_approved_by_name,
         ou.full_name as owner_approved_by_name,
         cu.full_name as created_by_name
  FROM purchase_orders po
  LEFT JOIN vendors v ON po.vendor_id=v.id
  LEFT JOIN projects p ON po.project_id=p.id
  LEFT JOIN users au ON po.admin_approved_by=au.id
  LEFT JOIN users ou ON po.owner_approved_by=ou.id
  LEFT JOIN users cu ON po.created_by=cu.id
`;

// List all POs with optional filters
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, vendor_id, search, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    let sql = `${PO_JOIN} WHERE 1=1`;
    const params = []; let idx = 1;
    if (status) { sql += ` AND po.status = $${idx}`; params.push(status); idx++; }
    if (vendor_id) { sql += ` AND po.vendor_id = $${idx}`; params.push(vendor_id); idx++; }
    if (search) { sql += ` AND (po.po_number ILIKE $${idx} OR v.name ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    // Count total
    const countSql = `SELECT COUNT(*) FROM (${sql}) as filtered`;
    const { rows: countRows } = await pool.query(countSql, params);
    const total = parseInt(countRows[0]?.count || '0');

    sql += ` ORDER BY po.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
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

// Get single PO with items and terms
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows: po } = await pool.query(`${PO_JOIN} WHERE po.id=$1`, [req.params.id]);
    if (po.length === 0) return res.status(404).json({ error: 'PO not found' });
    const { rows: items } = await pool.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [req.params.id]);
    const { rows: terms } = await pool.query('SELECT * FROM po_terms WHERE po_id=$1 ORDER BY display_order', [req.params.id]);
    res.json({ ...po[0], items, terms });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// =====================================================================
// Sequential approval workflow (spec: Admin first, THEN Owner).
//   pending        -> awaiting Admin decision
//   admin_approved -> Admin approved; awaiting Owner decision
//   approved       -> Owner approved (FINAL — only then can be paid)
//   rejected       -> either stage rejected (reason recorded)
// All state transitions happen inside a transaction with a row lock
// (SELECT ... FOR UPDATE) so simultaneous approval attempts are
// serialized — the second one sees the new state and is rejected.
// =====================================================================

async function applyDecision(req, res, level) {
  const { id } = req.params;
  const { approve, reason } = req.body;
  if (typeof approve !== 'boolean') return res.status(400).json({ error: 'approve must be true or false' });
  if (approve === false && (!reason || !String(reason).trim()))
    return res.status(400).json({ error: 'A reason is required when rejecting a PO' });
  const reasonText = reason ? String(reason).trim() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'PO not found' });
    const po = rows[0];

    if (level === 'admin') {
      // Only the FIRST (admin) stage
      if (po.status !== 'pending')
        return res.status(400).json({ error: `PO cannot be admin-approved in its current state (${po.status})` });
      if (po.admin_approval !== 'pending')
        return res.status(400).json({ error: 'Admin approval already submitted for this PO' });
      if (req.user.role !== 'admin')
        return res.status(403).json({ error: 'Only the Admin can approve at the first stage' });
    } else {
      // Owner stage — MUST have admin approval first (backend enforcement,
      // not just UI hiding)
      if (po.status !== 'admin_approved' || po.admin_approval !== 'approved')
        return res.status(400).json({ error: 'Owner cannot decide before the Admin has approved this PO' });
      if (po.owner_approval !== 'pending')
        return res.status(400).json({ error: 'Owner approval already submitted for this PO' });
      if (req.user.role !== 'owner')
        return res.status(403).json({ error: 'Only the Owner can approve at the final stage' });
    }

    const decision = approve ? 'approved' : 'rejected';
    const newStatus = approve
      ? (level === 'admin' ? 'admin_approved' : 'approved')
      : 'rejected';

    let sql;
    let params;
    if (level === 'admin') {
      sql = `
        UPDATE purchase_orders
        SET status=$1, admin_approval=$2, admin_approved_by=$3, admin_approved_at=NOW(),
            admin_reject_reason=$4, updated_at=NOW()
        WHERE id=$5 RETURNING *`;
      params = [newStatus, decision, req.user.id, approve ? null : reasonText, id];
    } else {
      sql = `
        UPDATE purchase_orders
        SET status=$1, owner_approval=$2, owner_approved_by=$3, owner_approved_at=NOW(),
            owner_reject_reason=$4, approved_by=$5, updated_at=NOW()
        WHERE id=$6 RETURNING *`;
      params = [newStatus, decision, req.user.id, approve ? null : reasonText, req.user.id, id];
    }
    const { rows: updated } = await client.query(sql, params);
    await client.query('COMMIT');

    const poOut = updated[0];
    const verb = approve ? (level === 'admin' ? 'approved' : 'fully approved') : 'rejected';
    const reasonPart = approve ? '' : ` Reason: ${reasonText}.`;
    const label = `${level === 'admin' ? 'Admin' : 'Owner'} ${verb} PO ${po.po_number}`;

    await logAudit(req.user.id, req.user.full_name, req.user.role, `${level}_approve`, 'purchase_order', id,
      `${label}${reasonPart}`);
    await addActivity(req.user.full_name, `${level}_approve`, `${label}${reasonPart}`, 'purchase_order', id);

    // Notify the creator (and Owner on admin-approval so they know to act).
    if (approve && level === 'admin') {
      await notifyRoles(['owner'], 'purchase_order',
        `PO ${po.po_number} awaiting your approval`,
        `PO ${po.po_number} (${po.vendor_name || 'vendor'}) was approved by ${req.user.full_name} and is awaiting your final approval`,
        `/vendors?po=${id}`, 'purchase_order', id);
    }
    await createNotification(po.created_by, 'purchase_order',
      approve ? `PO ${po.po_number} ${level === 'admin' ? 'approved (Admin)' : 'fully approved'}` : `PO ${po.po_number} rejected`,
      `${label}${reasonPart}`,
      `/vendors?po=${id}`, 'purchase_order', id);

    const { rows: items } = await client.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [id]);
    res.json({ ...poOut, items });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

// First stage — Admin only
router.put('/:id/admin-approve', authenticate, authorize('admin'), (req, res) => {
  return applyDecision(req, res, 'admin');
});

// Final stage — Owner only (blocked server-side until Admin has approved)
router.put('/:id/owner-approve', authenticate, authorize('owner'), (req, res) => {
  return applyDecision(req, res, 'owner');
});

// Legacy endpoint kept as an alias for the FIRST (admin) approval step —
// it can no longer jump the queue: it only transitions pending -> admin_approved.
router.put('/:id/approve', authenticate, authorize('admin'), (req, res) => {
  req.body = { ...req.body, approve: true };
  return applyDecision(req, res, 'admin');
});

// Update PO lifecycle (received / cancelled). Approval itself is NOT possible
// through this endpoint anymore — it goes through the two-step flow above.
router.put('/:id/status', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['received', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const { rows: po } = await pool.query('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
    if (po.length === 0) return res.status(404).json({ error: 'PO not found' });

    if (status === 'cancelled' && !['owner', 'admin'].includes(req.user.role))
      return res.status(403).json({ error: 'Only owners and admins can cancel POs' });
    if (status === 'received' && po[0].status !== 'approved')
      return res.status(400).json({ error: `Only fully approved POs can be marked received (current status: ${po[0].status})` });

    const deliveryMap = { 'received': 'delivered', 'partial_received': 'partial', 'cancelled': 'cancelled' };
    const deliveryStatus = deliveryMap[status] || 'pending';
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

    if (['received', 'cancelled'].includes(status)) {
      await createNotification(po[0].created_by, 'purchase_order',
        `PO ${po[0].po_number} ${status}`,
        `Purchase order ${po[0].po_number} (${po[0].vendor_name || 'vendor'}) was ${status} by ${req.user.full_name}`,
        `/vendors?po=${po[0].id}`, 'purchase_order', po[0].id);
    }

    const { rows: items } = await pool.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [req.params.id]);
    res.json({ ...rows[0], items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;