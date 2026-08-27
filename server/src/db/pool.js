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
      // Serverless (Vercel) + Supabase pooler (port 6543, ap-southeast-2).
      // Cross-region latency (iad1 -> ap-southeast-2) can be 300-500ms per round-trip.
      // Cold start needs full TCP+TLS handshake + pooler assignment.
      // Use single connection per instance, generous timeouts.
      // For long-running server: small pool, longer idle timeout to avoid pooler circuit breaker
      max: process.env.VERCEL ? 1 : 3,
      connectionTimeoutMillis: process.env.VERCEL ? 15000 : 30000,
      idleTimeoutMillis: process.env.VERCEL ? 60000 : 300000,
      allowExitOnIdle: true,
      // Disable prepared statements for pooler compatibility
      statement_timeout: false,
      query_timeout: false,
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

// Graceful handling of connection errors - don't crash the process
pool.on('connect', (client) => {
  client.on('error', (err) => {
    console.error('Client connection error:', err.message);
  });
});

module.exports = pool;
