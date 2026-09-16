const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit, notifyRoles } = require('../db/helpers');

const router = express.Router();

router.get('/', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const roleFilter = req.query.role ? 'WHERE role = $1' : '';
    const params = req.query.role ? [req.query.role] : [];
    const { rows } = await pool.query(
      `SELECT id, email, full_name, role, phone, is_active, created_at FROM users ${roleFilter} ORDER BY full_name`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(`[users] /?role= error:`, err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { email, password, full_name, role, phone } = req.body;
    if (!email || !password || !full_name || !role) return res.status(400).json({ error: 'All fields required' });
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ error: 'Invalid email format' });
    if (typeof password !== 'string' || password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const VALID_ROLES = ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance'];
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (role === 'owner' && req.user.role !== 'owner')
      return res.status(403).json({ error: 'Only owners can create owner accounts' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, full_name, role, phone`,
      [email.trim().toLowerCase(), hash, full_name, role, phone]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'user', rows[0].id, `Created user: ${full_name}`);
    await notifyRoles(['owner'], 'user_created',
      `New user created: ${full_name}`,
      `${req.user.full_name} created a new ${role} account for ${full_name} (${rows[0].email})`,
      `/users`, 'user', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' }); console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows: target } = await pool.query('SELECT id, email, full_name, role, phone, is_active FROM users WHERE id=$1', [req.params.id]);
    if (target.length === 0) return res.status(404).json({ error: 'User not found' });
    if (target[0].role === 'owner' && req.user.role !== 'owner')
      return res.status(403).json({ error: 'Owner accounts cannot be modified' });

    const { full_name, role, phone, is_active, password } = req.body;
    const VALID_ROLES = ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance'];
    if (role !== undefined && role !== null && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (role === 'owner' && req.user.role !== 'owner')
      return res.status(403).json({ error: 'Only owners can assign the owner role' });
    // Nobody may demote or deactivate their own account (prevents locking everyone out).
    if (req.params.id === req.user.id) {
      if (role !== undefined && role !== null && role !== req.user.role) return res.status(400).json({ error: 'You cannot change your own role' });
      if (is_active === false) return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    let passwordHash = null;
    if (password !== undefined && password !== null && password !== '') {
      if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      passwordHash = await bcrypt.hash(password, 10);
    }
    const { rows } = await pool.query(
      `UPDATE users SET full_name=COALESCE($1, full_name), role=COALESCE($2, role), phone=COALESCE($3, phone),
              is_active=COALESCE($4, is_active), password_hash=COALESCE($5, password_hash), updated_at=NOW()
       WHERE id=$6 RETURNING id, email, full_name, role, phone, is_active`,
      [full_name ?? null, role ?? null, phone ?? null, is_active ?? null, passwordHash, req.params.id]
    );
    const before = target[0], after = rows[0];
    const changed = ['full_name', 'role', 'phone', 'is_active'].filter(k => before[k] !== after[k]);
    if (passwordHash) changed.push('password');
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'updated', 'user', after.id,
      `Updated user: ${after.full_name} (${changed.join(', ') || 'no changes'})`,
      { before: { full_name: before.full_name, role: before.role, phone: before.phone, is_active: before.is_active },
        after: { full_name: after.full_name, role: after.role, phone: after.phone, is_active: after.is_active } });
    res.json(after);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Audit logs
router.get('/audit-logs', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const offset = (pageNum - 1) * limitNum;

    const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM audit_logs');
    const total = parseInt(countRows[0]?.count || '0');

    const { rows } = await pool.query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limitNum, offset]
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

module.exports = router;