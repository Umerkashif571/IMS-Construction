const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit } = require('../db/helpers');

const router = express.Router();

// Backups live on disk next to the repo. In serverless (Vercel) the bundle
// filesystem is read-only (/var/task), so we resolve to the writable /tmp
// directory instead. Never crash the module on import — a backup dir that
// cannot be created is handled per-request instead.
const BACKUP_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'ims-backups')
  : path.join(__dirname, '..', '..', 'backups');

function ensureBackupDir() {
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (err) { console.error('Backup dir unavailable:', err.message); }
}
ensureBackupDir();

function safeBackupName(filename) {
  if (typeof filename !== 'string') return null;
  const base = path.basename(filename);
  if (base !== filename) return null;
  if (!/^ims_backup_\d{4}-\d{2}-\d{2}_\d+\.sql$/.test(base)) return null;
  return base;
}

router.get('/export', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    ensureBackupDir();
    const filename = `ims_backup_${new Date().toISOString().split('T')[0]}_${Date.now()}.sql`;
    const filepath = path.join(BACKUP_DIR, filename);
    const dump = await dumpWithoutPgDump();
    fs.writeFileSync(filepath, dump, 'utf8');
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'backup', 'system', null, `Manual backup created: ${filename}`);
    res.download(filepath, filename, (err) => {
      if (err) console.error('Download error:', err);
    });
  } catch (err) {
    console.error('Backup export error:', err);
    res.status(500).json({ error: 'Backup failed' });
  }
});

router.get('/list', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, created: stat.birthtime };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json(files);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/restore', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const filename = safeBackupName(req.body.filename);
    if (!filename) return res.status(400).json({ error: 'Invalid backup filename' });
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found' });
    const sql = fs.readFileSync(filepath, 'utf8');
    await pool.query(sql);
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'restore', 'system', 'id', `Database restored from: ${filename}`);
    res.json({ message: 'Database restored successfully' });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Restore failed' });
  }
});

async function dumpWithoutPgDump() {
  const tables = ['users', 'categories', 'vendors', 'projects', 'warehouses', 'materials',
    'stock_movements', 'vehicles', 'vehicle_fuel_logs', 'vehicle_maintenance_logs',
    'tools', 'tool_checkout_log', 'project_allocations', 'transfer_requests',
    'purchase_orders', 'purchase_order_items', 'material_transactions', 'gate_passes',
    'audit_logs', 'activity_feed', 'salaries', 'petty_cash', 'vendor_payments', 'deletion_requests'
  ];
  let sql = '-- IMS Database Backup\n-- Generated: ' + new Date().toISOString() + '\n\n';
  for (const table of tables) {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY created_at`);
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      for (const row of rows) {
        const vals = cols.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return 'NULL';
          if (v instanceof Date || typeof v === 'string') {
            return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
          }
          return v;
        });
        sql += `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});\n`;
      }
      sql += '\n';
    } catch (e) { console.log(`Skipping table ${table}: ${e.message}`); }
  }
  return sql;
}

module.exports = { router, dumpWithoutPgDump, BACKUP_DIR };
