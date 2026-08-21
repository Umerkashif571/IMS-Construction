const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
require('dotenv').config();
// Force rebuild: JWT_SECRET fix v2

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

  // The token carries the user identity signed at login, so reads can be
  // served without an extra round trip to the database. Mutations still
  // verify the account is active (cheap indexed lookup) so deactivated
  // users cannot keep writing before their token expires.
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    req.user = {
      id: decoded.id,
      email: decoded.email,
      full_name: decoded.full_name,
      role: decoded.role
    };
    return next();
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, is_active FROM users WHERE id = $1',
      [decoded.id]
    );
    if (rows.length === 0 || !rows[0].is_active) return res.status(401).json({ error: 'Account deactivated' });
    req.user = {
      id: decoded.id,
      email: decoded.email,
      full_name: decoded.full_name,
      role: decoded.role
    };
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
