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

// First line of every dump this app writes. /restore refuses files without it so a random
// .sql dropped into the backups directory can never be executed against the database.
const DUMP_MARKER = '-- IMS Database Backup v2';
const MAX_RESTORE_BYTES = 200 * 1024 * 1024; // 200 MB — far above any realistic dump

function ensureBackupDir() {
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (err) { console.error('Backup dir unavailable:', err.message); }
}
ensureBackupDir();

// Accepts only names this app itself produces (manual exports and the daily cron's
// ims_auto_backup_YYYY-MM-DD.sql) and never anything containing a path separator.
function safeBackupName(filename) {
  if (typeof filename !== 'string' || filename.length > 80) return null;
  const base = path.basename(filename);
  if (base !== filename) return null;
  if (!/^ims_(auto_)?backup_\d{4}-\d{2}-\d{2}(_\d+)?\.sql$/.test(base)) return null;
  return base;
}

function resolveBackupPath(filename) {
  const filepath = path.resolve(BACKUP_DIR, filename);
  // belt and braces: the resolved path must stay inside the backups directory
  if (path.dirname(filepath) !== path.resolve(BACKUP_DIR)) return null;
  return filepath;
}

async function writeBackupFile() {
  ensureBackupDir();
  const filename = `ims_backup_${new Date().toISOString().split('T')[0]}_${Date.now()}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);
  const dump = await dumpWithoutPgDump();
  fs.writeFileSync(filepath, dump, 'utf8');
  return { filename, filepath };
}

router.get('/export', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const { filename, filepath } = await writeBackupFile();
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'backup', 'system', null, `Manual backup created: ${filename}`);
    res.download(filepath, filename, (err) => {
      if (err) console.error('Download error:', err);
    });
  } catch (err) {
    console.error('Backup export error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Backup failed' });
  }
});

router.get('/list', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => safeBackupName(f))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, created: stat.birthtime };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json(files);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Download one of the listed backup files (the bytes on disk, not a fresh export).
router.get('/download/:filename', authenticate, authorize('owner', 'admin'), (req, res) => {
  const filename = safeBackupName(req.params.filename);
  if (!filename) return res.status(400).json({ error: 'Invalid backup filename' });
  const filepath = resolveBackupPath(filename);
  if (!filepath || !fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found' });
  res.download(filepath, filename, (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' });
  });
});

// Restore is owner-only: it replaces every row in the database.
router.post('/restore', authenticate, authorize('owner'), async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const filename = safeBackupName(body.filename);
  if (!filename) return res.status(400).json({ error: 'Invalid backup filename' });
  const filepath = resolveBackupPath(filename);
  if (!filepath || !fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found' });

  let sql;
  try {
    const stat = fs.statSync(filepath);
    if (stat.size > MAX_RESTORE_BYTES) return res.status(400).json({ error: 'Backup file too large to restore' });
    sql = fs.readFileSync(filepath, 'utf8');
  } catch (err) {
    console.error('Restore read error:', err);
    return res.status(500).json({ error: 'Could not read backup file' });
  }
  if (!sql.startsWith(DUMP_MARKER)) {
    return res.status(400).json({ error: 'File is not a backup produced by this application' });
  }

  // Snapshot the current data first so a bad restore can itself be undone.
  let snapshot = null;
  try { snapshot = (await writeBackupFile()).filename; } catch (err) { console.error('Pre-restore snapshot failed:', err.message); }

  let client;
  let released = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // The dump is a single multi-statement script (TRUNCATE ... INSERTs ... setval). Executing it
    // inside our own transaction makes the restore all-or-nothing: any failing statement aborts
    // the transaction and ROLLBACK below restores the previous data untouched.
    await client.query(sql);
    await client.query('COMMIT');
    client.release(); released = true;
    await logAudit(req.user.id, req.user.full_name, req.user.role, 'restore', 'system', null,
      `Database restored from: ${filename}` + (snapshot ? ` (pre-restore snapshot: ${snapshot})` : ''));
    return res.json({ message: 'Database restored successfully', snapshot });
  } catch (err) {
    if (client && !released) { try { await client.query('ROLLBACK'); } catch (_) {} }
    console.error('Restore error:', err.message, err.position ? `(position ${err.position})` : '');
    if (res.headersSent) return;
    return res.status(500).json({ error: 'Restore failed — database left unchanged' });
  } finally {
    if (client && !released) client.release();
  }
});

// ---------------------------------------------------------------------------
// Dump generation (no pg_dump on the host)

// Order tables so that every referenced table is emitted before the tables that reference it.
// Reads the FK graph from the catalog, so new tables are picked up automatically.
async function orderedTables() {
  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  );
  const { rows: fks } = await pool.query(
    `SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`
  );
  const names = tables.map(t => t.table_name);
  const deps = new Map(names.map(n => [n, new Set()]));
  for (const { child, parent } of fks) if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
  const ordered = [];
  const done = new Set();
  let progress = true;
  while (ordered.length < names.length && progress) {
    progress = false;
    for (const n of names) {
      if (done.has(n)) continue;
      if ([...deps.get(n)].every(p => done.has(p))) { ordered.push(n); done.add(n); progress = true; }
    }
  }
  // cyclic leftovers (none today) go last in name order
  for (const n of names) if (!done.has(n)) ordered.push(n);
  return ordered;
}

async function tableColumns(table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]
  );
  return rows;
}

const quoteIdent = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// SQL literal for a value already normalised to string/number/boolean/null by the SELECT below.
function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'::bytea`;
  if (typeof v === 'object') v = JSON.stringify(v);
  // standard_conforming_strings is forced on in the dump header, so only quotes need doubling
  // and backslashes are literal.
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function dumpWithoutPgDump() {
  const tables = await orderedTables();
  const lines = [
    DUMP_MARKER,
    '-- Generated: ' + new Date().toISOString(),
    '-- Restore replaces ALL data: run as a single transaction.',
    '',
    'SET standard_conforming_strings = on;',
    "SET client_encoding = 'UTF8';",
    'BEGIN;',
    '',
    `TRUNCATE ${tables.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE;`,
    ''
  ];
  for (const table of tables) {
    const cols = await tableColumns(table);
    if (!cols.length) continue;
    // Every non-numeric/boolean column is selected as text so pg returns Postgres' own literal
    // representation (dates without timezone shifts, timestamptz with offset, jsonb verbatim).
    const select = cols.map(c => {
      const t = c.data_type;
      if (t === 'integer' || t === 'bigint' || t === 'smallint' || t === 'boolean' || t === 'numeric' || t === 'real' || t === 'double precision') return quoteIdent(c.column_name);
      return `${quoteIdent(c.column_name)}::text AS ${quoteIdent(c.column_name)}`;
    }).join(', ');
    const hasCreated = cols.some(c => c.column_name === 'created_at');
    let retries = 3;
    while (retries > 0) {
      try {
        const { rows } = await pool.query(`SELECT ${select} FROM ${quoteIdent(table)}${hasCreated ? ' ORDER BY created_at' : ''}`);
        if (rows.length === 0) { lines.push(`-- Table ${table}: no data`, ''); break; }
        const colList = cols.map(c => quoteIdent(c.column_name)).join(', ');
        for (const row of rows) {
          const vals = cols.map(c => sqlLiteral(row[c.column_name]));
          lines.push(`INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${vals.join(', ')});`);
        }
        lines.push('');
        break;
      } catch (e) {
        retries--;
        if (retries === 0) {
          // A skipped table would make the dump lossy while TRUNCATE still wipes it — refuse instead.
          throw new Error(`Backup failed on table ${table}: ${e.message}`);
        }
        console.log(`Retrying table ${table} (${retries} retries left): ${e.message}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  // Sequences (gate pass numbering) — restore their position too
  const { rows: seqs } = await pool.query(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'`);
  for (const { sequence_name } of seqs) {
    const { rows } = await pool.query(`SELECT last_value, is_called FROM ${quoteIdent(sequence_name)}`);
    if (rows.length) lines.push(`SELECT setval('${sequence_name.replace(/'/g, "''")}', ${rows[0].last_value}, ${rows[0].is_called ? 'true' : 'false'});`);
  }
  lines.push('', 'COMMIT;', '');
  return lines.join('\n');
}

module.exports = { router, dumpWithoutPgDump, BACKUP_DIR, safeBackupName, DUMP_MARKER };
