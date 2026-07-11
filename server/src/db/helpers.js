const pool = require('./pool');

async function logAudit(userId, userName, userRole, action, entityType, entityId, description, changes = null) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, entity_type, entity_id, description, changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, userName, userRole, action, entityType, entityId, description, changes ? JSON.stringify(changes) : null]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

async function addActivity(userName, action, description, entityType, entityId = null) {
  try {
    await pool.query(
      `INSERT INTO activity_feed (user_name, action, description, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [userName, action, description, entityType, entityId]
    );
  } catch (err) {
    console.error('Activity feed error:', err.message);
  }
}

module.exports = { logAudit, addActivity };