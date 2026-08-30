const { Pool } = require('pg');
require('dotenv').config();

function createPool() {
  if (process.env.DATABASE_URL) {
    // Parse DATABASE_URL to extract individual components
    // This avoids potential parsing issues with Supabase pooler URLs
    const url = new URL(process.env.DATABASE_URL);
    const config = {
      user: url.username,
      password: url.password,
      host: url.hostname,
      port: parseInt(url.port, 10) || 5432,
      database: url.pathname.slice(1), // Remove leading '/'
      ssl: { rejectUnauthorized: false },
      options: '-c search_path=public',
      max: process.env.VERCEL ? 1 : 3,
      connectionTimeoutMillis: process.env.VERCEL ? 15000 : 30000,
      idleTimeoutMillis: process.env.VERCEL ? 60000 : 300000,
      allowExitOnIdle: true,
      statement_timeout: false,
      query_timeout: false,
    };
    console.log('Pool config:', { user: config.user, host: config.host, port: config.port, database: config.database });
    return new Pool(config);
  }

  const required = ['PGUSER', 'PGHOST', 'PGDATABASE', 'PGPASSWORD', 'PGPORT'];
  if (required.some(k => !process.env[k])) {
    console.error('Missing database configuration. Set DATABASE_URL or PG* env vars (PGUSER, PGHOST, PGDATABASE, PGPASSWORD, PGPORT).');
    process.exit(1);
  }

  return new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: parseInt(process.env.PGPORT, 10) || 5432,
  });
}

const pool = createPool();

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
