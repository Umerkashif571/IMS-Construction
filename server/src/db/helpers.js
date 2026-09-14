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

async function createNotification(userId, type, title, message = null, link = null, entityType = null, entityId = null) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, link, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, title, message, link, entityType, entityId]
    );
  } catch (err) {
    console.error('Notification error:', err.message);
  }
}

// Create a notification for every active user holding one of the given roles
async function notifyRoles(roles, type, title, message = null, link = null, entityType = null, entityId = null) {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE is_active = true AND role = ANY($1)`,
      [roles]
    );
    if (rows.length === 0) return

    // Batch insert notifications in a single query
    const values = []
    const params = []
    rows.forEach((u, i) => {
      const base = i * 7
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
      )
      params.push(u.id, type, title, message, link, entityType, entityId)
    })
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, link, entity_type, entity_id)
       VALUES ${values.join(', ')}`,
      params
    )
  } catch (err) {
    console.error('notifyRoles error:', err.message);
  }
}

// Next gate pass number, e.g. GP-2026-000123. Pass the transaction client when inside BEGIN.
async function nextGatePassNo(client = pool) {
  const { rows } = await client.query(`SELECT nextval('gate_pass_seq') AS n`);
  return `GP-${new Date().getFullYear()}-${String(rows[0].n).padStart(6, '0')}`;
}

module.exports = { logAudit, addActivity, createNotification, notifyRoles, nextGatePassNo };