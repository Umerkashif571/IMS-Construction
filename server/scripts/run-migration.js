require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const file = process.argv[2];
  if (!file) { console.error('usage: node run-migration.js <file.sql>'); process.exit(1); }
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('MIGRATION OK:', file);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('MIGRATION FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await p.end();
  }
})();