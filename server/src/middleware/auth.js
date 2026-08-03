const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
require('dotenv').config();

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, email, full_name, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid or expired token' });
    if (!rows[0].is_active) return res.status(401).json({ error: 'Account deactivated' });
    req.user = { id: rows[0].id, email: rows[0].email, full_name: rows[0].full_name, role: rows[0].role };
    next();
  } catch (err) {
    console.error('Auth DB error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
