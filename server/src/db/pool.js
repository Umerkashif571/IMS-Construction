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
      // transaction pooler — a handful of connections per instance lets
      // Promise.all() batches inside one request run concurrently instead
      // of serializing on a single connection (4 was verified safe well
      // under the pooler's 60-connection limit; instances reap lazily).
      // Long-running local processes tolerate longer idle/connect windows.
      max: process.env.VERCEL ? 4 : 10,
      connectionTimeoutMillis: process.env.VERCEL ? 3000 : 8000,
      idleTimeoutMillis: process.env.VERCEL ? 5000 : 30000,
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
