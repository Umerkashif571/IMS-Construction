const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logAudit } = require('../db/helpers');

const router = express.Router();
const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

router.get('/export', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
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
    res.status(500).json({ error: 'Backup failed: ' + err.message });
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
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/restore', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename required' });
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found' });
    const sql = fs.readFileSync(filepath, 'utf8');
    await pool.query(sql);
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'restore', 'system', 'id', `Database restored from: ${filename}`);
    res.json({ message: 'Database restored successfully' });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

async function spawnDatabase() {
  return new Promise((resolve, reject) => {
    const dump = [];
    const pgDump = spawn('pg_dump', [
      '-h', 'localhost', '-p', '5432', '-U', 'postgres',
      '-d', 'ims_db', '--clean', '--if-exists'
    ], { env: { ...process.env, PGPASSWORD: 'postgres' } });
    pgDump.stdout.on('data', (data) => dump.push(data));
    pgDump.stderr.on('data', (data) => console.error('pg_dump stderr:', data.toString()));
    pgDump.on('close', (code) => {
      if (code === 0) resolve(dump.join(''));
      else reject(new Error(`pg_dump exited with code ${code}`));
    });
    pgDump.on('error', (err) => reject(err));
  });
}

async function dumpWithoutPgDump() {
  const tables = ['users', 'categories', 'vendors', 'projects', 'warehouses', 'materials',
    'stock_movements', 'vehicles', 'vehicle_fuel_logs', 'vehicle_maintenance_logs',
    'tools', 'tool_checkout_log', 'project_allocations', 'transfer_requests',
    'purchase_orders', 'purchase_order_items', 'audit_logs', 'activity_feed'
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
          if (v instanceof Date || typeof v === 'string') return `'${String(v).replace(/'/g, "''")}'`;
          return v;
        });
        sql += `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});\n`;
      }
      sql += '\n';
    } catch (e) { console.log(`Skipping table ${table}: ${e.message}`); }
  }
  return sql;
}

module.exports = { router, spawnDatabase, dumpWithoutPgDump, BACKUP_DIR };