const { Pool } = require('pg');
require('dotenv').config();

const required = ['PGUSER', 'PGHOST', 'PGDATABASE', 'PGPASSWORD', 'PGPORT'];
if (!process.env.DATABASE_URL && required.some(k => !process.env[k])) {
  console.error('Missing database configuration. Set DATABASE_URL or PG* env vars (PGUSER, PGHOST, PGDATABASE, PGPASSWORD, PGPORT).');
  process.exit(1);
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      options: '-c search_path=public',
      // Serverless (Vercel) uses short-lived processes and the Supabase
      // transaction pooler — each function instance handles one request,
      // so a single connection per instance is the right sizing.
      max: process.env.VERCEL ? 1 : 10,
      connectionTimeoutMillis: 10000,
    })
  : new Pool({
      user: process.env.PGUSER,
      host: process.env.PGHOST,
      database: process.env.PGDATABASE,
      password: process.env.PGPASSWORD,
      port: parseInt(process.env.PGPORT, 10) || 5432,
    });

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = pool;
