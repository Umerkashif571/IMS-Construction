const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
require('dotenv').config();
// Force rebuild: JWT_SECRET fix v3 - 2025-08-22

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

  // Role and active flag always come from the database, never from the token:
  // a demoted or deactivated user must lose access immediately, not when the
  // 24h token expires. One indexed primary-key lookup per request.
  try {
    const { rows } = await pool.query(
      'SELECT id, email, full_name, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );
    if (rows.length === 0 || !rows[0].is_active) return res.status(401).json({ error: 'Account deactivated' });
    req.user = {
      id: rows[0].id,
      email: rows[0].email,
      full_name: rows[0].full_name,
      role: rows[0].role
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

// Role groups — keep in sync with the sidebar role lists in client/src/components/Layout.jsx.
// Reference data (materials, vendors, warehouses, projects) stays readable by every signed-in
// role because most pages need it for dropdowns; these groups gate the module-specific reads.
const ROLES = {
  ALL: ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff', 'finance'],
  INVENTORY: ['owner', 'admin', 'store_manager', 'site_engineer', 'procurement_officer', 'manager', 'staff'],
  FLEET: ['owner', 'admin', 'store_manager', 'site_engineer', 'manager', 'staff'],
  PROCUREMENT: ['owner', 'admin', 'procurement_officer', 'store_manager', 'manager', 'staff', 'finance'],
  REPORTS: ['owner', 'admin', 'store_manager', 'procurement_officer', 'manager', 'staff'],
  GATEPASS: ['owner', 'admin', 'store_manager', 'manager', 'staff'],
  FINANCE: ['owner', 'admin', 'finance'],
};

module.exports = { authenticate, authorize, ROLES };
