const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications — current user's notifications, newest first (paginated)
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    console.log('NOTIFICATIONS: Fetching for user', req.user.id);

    // Count total unread for metadata
    console.log('NOTIFICATIONS: About to query unread count');
    let unreadResult;
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id = $1 AND is_read = false`,
        [req.user.id]
      );
      console.log('NOTIFICATIONS: Unread count query succeeded, result =', JSON.stringify(result));
      unreadResult = result;
    } catch (err) {
      console.error('NOTIFICATIONS: Unread count query FAILED:', err.message, err.stack);
      throw err;
    }

    console.log('NOTIFICATIONS: Unread count result rows =', unreadResult.rows);
    if (!unreadResult.rows || unreadResult.rows.length === 0) {
      console.error('NOTIFICATIONS: Unread count query returned empty result!');
      throw new Error('Unread count query returned empty result');
    }
    const unread_count = unreadResult.rows[0].unread_count;
    console.log('NOTIFICATIONS: Unread count =', unread_count);

    console.log('NOTIFICATIONS: About to query notifications');
    let notifResult;
    try {
      const result = await pool.query(
        `SELECT id, type, title, message, link, entity_type, entity_id, is_read, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limitNum, offset]
      );
      console.log('NOTIFICATIONS: Notifications query succeeded, rows =', result.rows.length);
      notifResult = result;
    } catch (err) {
      console.error('NOTIFICATIONS: Notifications query FAILED:', err.message, err.stack);
      throw err;
    }
    const { rows } = notifResult;

    console.log('NOTIFICATIONS: Notifications query succeeded, rows =', rows.length);
    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: unread_count,
        unreadCount: parseInt(unread_count)
      }
    });
  } catch (err) { console.error('NOTIFICATIONS ERROR:', err.message, err.stack); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/notifications/unread-count — count of unread notifications
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ count: rows[0].count });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// PATCH /api/notifications/mark-all-read — mark all notifications read
router.patch('/mark-all-read', authenticate, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
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
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
