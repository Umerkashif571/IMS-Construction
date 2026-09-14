const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const { logAudit, addActivity, notifyRoles, createNotification } = require('../db/helpers');
const { requireUuid, isUuid, dbError } = require('../middleware/validate');
const { d } = require('../utils/decimal');

const router = express.Router();

router.param('id', requireUuid);

const PO_STATUSES = ['pending', 'admin_approved', 'approved', 'rejected', 'ordered', 'partial_received', 'received', 'completed', 'cancelled', 'delivered', 'returned'];

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
router.get('/', authenticate, authorize(...ROLES.PROCUREMENT), async (req, res) => {
  try {
    const { status, vendor_id, search, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    if (status && !PO_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status filter' });
    if (vendor_id && !isUuid(vendor_id)) return res.status(400).json({ error: 'Invalid vendor id' });
    if (search !== undefined && typeof search !== 'string') return res.status(400).json({ error: 'Invalid search' });

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
  } catch (err) { return dbError(res, err); }
});

// Get single PO with items and terms
router.get('/:id', authenticate, authorize(...ROLES.PROCUREMENT), async (req, res) => {
  try {
    const { rows: po } = await pool.query(`${PO_JOIN} WHERE po.id=$1`, [req.params.id]);
    if (po.length === 0) return res.status(404).json({ error: 'PO not found' });
    const { rows: items } = await pool.query('SELECT * FROM purchase_order_items WHERE po_id=$1', [req.params.id]);
    const { rows: terms } = await pool.query('SELECT * FROM po_terms WHERE po_id=$1 ORDER BY display_order', [req.params.id]);
    res.json({ ...po[0], items, terms });
  } catch (err) { return dbError(res, err); }
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
  let released = false;
  // Every early exit after BEGIN must roll back, or the pooled connection goes back mid-transaction.
  const fail = async (code, error) => { await client.query('ROLLBACK'); return res.status(code).json({ error }); };
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE',
      [id]
    );
    if (rows.length === 0) return fail(404, 'PO not found');
    const po = rows[0];

    if (['rejected', 'cancelled', 'received', 'completed', 'delivered', 'returned'].includes(po.status))
      return fail(400, `PO is ${po.status} — no further decisions are possible`);

    if (level === 'admin') {
      // Only the FIRST (admin) stage, only from pending
      if (req.user.role !== 'admin')
        return fail(403, 'Only the Admin can approve at the first stage');
      if (po.status !== 'pending')
        return fail(400, `PO cannot be admin-approved in its current state (${po.status})`);
      if (po.admin_approval !== 'pending')
        return fail(400, 'Admin approval already submitted for this PO');
    } else {
      // Owner stage — MUST have admin approval first (backend enforcement,
      // not just UI hiding)
      if (req.user.role !== 'owner')
        return fail(403, 'Only the Owner can approve at the final stage');
      if (po.status !== 'admin_approved' || po.admin_approval !== 'approved')
        return fail(400, 'Owner cannot decide before the Admin has approved this PO');
      if (po.owner_approval !== 'pending')
        return fail(400, 'Owner approval already submitted for this PO');
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
    const { rows: items } = await client.query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at', [id]);
    await client.query('COMMIT');
    client.release(); released = true;   // before the helpers below borrow a second connection

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

    res.json({ ...poOut, items });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
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
// State machine:
//   cancelled : only from pending / admin_approved / approved, and only while nothing has been received
//   received  : only from approved / partial_received, and only once every item is fully delivered
//               (goods are booked through PUT /api/vendors/pos/:id/delivery, which moves stock)
//   delivered / cancelled / rejected are terminal.
router.put('/:id/status', authenticate, authorize('owner', 'admin', 'store_manager'), async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['received', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (status === 'cancelled' && !['owner', 'admin'].includes(req.user.role))
    return res.status(403).json({ error: 'Only owners and admins can cancel POs' });

  const client = await pool.connect();
  let released = false;
  const fail = async (code, error) => { await client.query('ROLLBACK'); return res.status(code).json({ error }); };
  try {
    await client.query('BEGIN');
    const { rows: po } = await client.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (po.length === 0) return fail(404, 'PO not found');
    const current = po[0];
    const { rows: items } = await client.query('SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY created_at', [req.params.id]);
    const anyReceived = items.some(i => d(i.quantity_delivered).gt(0));
    const allReceived = items.length > 0 && items.every(i => d(i.quantity_delivered).gte(d(i.quantity)));

    if (['rejected', 'cancelled', 'received', 'completed', 'delivered', 'returned'].includes(current.status))
      return fail(400, `PO is already ${current.status} — no further changes are possible`);

    if (status === 'cancelled') {
      if (!['pending', 'admin_approved', 'approved'].includes(current.status))
        return fail(400, `Cannot cancel a PO that is ${current.status}`);
      if (anyReceived)
        return fail(400, 'Cannot cancel a PO after goods have been received against it');
    }
    if (status === 'received') {
      if (!['approved', 'partial_received'].includes(current.status))
        return fail(400, `Only fully approved POs can be marked received (current status: ${current.status})`);
      if (!allReceived)
        return fail(400, 'Not every item has been received yet — record the delivery (Receive goods) first');
    }

    const deliveryStatus = status === 'received' ? 'delivered' : 'cancelled';
    const { rows } = await client.query(
      `UPDATE purchase_orders SET status=$1, delivery_status=$2, received_by=COALESCE($3, received_by), updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [status, deliveryStatus, status === 'received' ? req.user.full_name : null, req.params.id]
    );
    await client.query('COMMIT');
    client.release(); released = true;

    await logAudit(req.user.id, req.user.full_name, req.user.role, 'po_status', 'purchase_order', req.params.id,
      `PO ${current.po_number} status changed to ${status}`);
    await addActivity(req.user.full_name, 'po_status', `PO ${current.po_number} ${status}`, 'purchase_order', req.params.id);
    if (current.created_by) {
      await createNotification(current.created_by, 'purchase_order',
        `PO ${current.po_number} ${status}`,
        `Purchase order ${current.po_number} (${current.vendor_name || 'vendor'}) was ${status} by ${req.user.full_name}`,
        `/vendors?po=${current.id}`, 'purchase_order', current.id);
    }
    res.json({ ...rows[0], items });
  } catch (err) {
    if (!released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return dbError(res, err);
  } finally {
    if (!released) client.release();
  }
});

module.exports = router;