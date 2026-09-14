const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireUuid, dbError } = require('../middleware/validate');

const router = express.Router();
router.param('id', requireUuid);

// GET /api/notifications — current user's notifications, newest first (paginated)
router.get('/', authenticate, async (req, res) => {
  try {
    const { page, limit } = req.query;
    if (page !== undefined && !/^\d+$/.test(String(page))) return res.status(400).json({ error: 'Invalid page' });
    if (limit !== undefined && !/^\d+$/.test(String(limit))) return res.status(400).json({ error: 'Invalid limit' });
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    // total = every notification for this user (drives paging); unread is reported separately
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_read = false)::int AS unread_count
       FROM notifications WHERE user_id = $1`,
      [req.user.id]
    );
    const total = countRows[0]?.total || 0;
    const unread_count = countRows[0]?.unread_count || 0;

    const { rows } = await pool.query(
      `SELECT id, type, title, message, link, entity_type, entity_id, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limitNum, offset]
    );

    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        unreadCount: unread_count
      }
    });
  } catch (err) { return dbError(res, err); }
});

// GET /api/notifications/unread-count — count of unread notifications
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ count: rows[0].count });
  } catch (err) { return dbError(res, err); }
});

// PATCH /api/notifications/mark-all-read — mark all notifications read
router.patch('/mark-all-read', authenticate, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) { return dbError(res, err); }
});

// PATCH /api/notifications/:id/read — mark a single notification read
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json(rows[0]);
  } catch (err) { return dbError(res, err); }
});

module.exports = router;
