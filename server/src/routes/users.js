const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit } = require('../db/helpers');

const router = express.Router();

router.get('/', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, full_name, role, phone, is_active, created_at FROM users ORDER BY full_name'
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { email, password, full_name, role, phone } = req.body;
    if (!email || !password || !full_name || !role) return res.status(400).json({ error: 'All fields required' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, full_name, role, phone`,
      [email, hash, full_name, role, phone]
    );
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'created', 'user', rows[0].id, `Created user: ${full_name}`);
    res.status(201).json(rows[0]);
  } catch (err) { if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' }); res.status(500).json({ error: 'Server error' }); }
});

router.put('/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows: target } = await pool.query('SELECT role FROM users WHERE id=$1', [req.params.id]);
    if (target.length === 0) return res.status(404).json({ error: 'User not found' });
    if (target[0].role === 'owner' && req.user.role !== 'owner')
      return res.status(403).json({ error: 'Owner accounts cannot be modified' });

    const { full_name, role, phone, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET full_name=COALESCE($1, full_name), role=COALESCE($2, role), phone=COALESCE($3, phone), is_active=COALESCE($4, is_active) WHERE id=$5 RETURNING id, email, full_name, role, phone, is_active`,
      [full_name ?? null, role ?? null, phone ?? null, is_active ?? null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Audit logs
router.get('/audit-logs', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;