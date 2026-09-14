const { Pool, types } = require('pg');
// DATE columns (OID 1082) come back as plain 'YYYY-MM-DD' strings instead of JS Dates at local
// midnight — the latter shifted every date one day back in the UI when serialised to UTC.
types.setTypeParser(1082, (v) => v);
require('dotenv').config();

function createPool() {
  if (process.env.DATABASE_URL) {
    // Parse DATABASE_URL to extract individual components
    // This avoids potential parsing issues with Supabase pooler URLs
    const url = new URL(process.env.DATABASE_URL);
    // ?sslmode=disable → plain TCP (local Postgres); anything else → TLS without CA verification
    // (Supabase pooler presents a cert chain that pg cannot verify by default).
    const sslmode = url.searchParams.get('sslmode');
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    const ssl = sslmode === 'disable' ? false : { rejectUnauthorized: false };
    const config = {
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password), // passwords with @ # % are percent-encoded in URLs
      host: url.hostname,
      port: parseInt(url.port, 10) || 5432,
      database: url.pathname.slice(1), // Remove leading '/'
      ssl: localHost && sslmode === null ? false : ssl,
      options: '-c search_path=public',
      max: process.env.VERCEL ? 1 : 10,
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

// Safety net: if a route returns early after BEGIN without ROLLBACK, the pooled client would
// go back "idle in transaction" and silently discard the next borrower's writes. Track
// BEGIN/COMMIT/ROLLBACK on checked-out clients and roll back on release if still open.
const originalConnect = pool.connect.bind(pool);
pool.connect = function patchedConnect(cb) {
  const wrap = (client) => {
    if (client.__txPatched) return client;
    client.__txPatched = true;
    const origQuery = client.query.bind(client);
    client.query = function trackedQuery(text, ...rest) {
      const sql = typeof text === 'string' ? text : (text && text.text) || '';
      const head = sql.trim().slice(0, 8).toUpperCase();
      if (head.startsWith('BEGIN')) client.__inTx = true;
      else if (head.startsWith('COMMIT') || head.startsWith('ROLLBACK')) client.__inTx = false;
      return origQuery(text, ...rest);
    };
    const origRelease = client.release;
    client.release = function safeRelease(err) {
      if (client.__inTx && !err) {
        client.__inTx = false;
        console.error('Transaction left open on release — rolling back (fix the route that returned early after BEGIN)');
        return origQuery('ROLLBACK').catch(() => {}).finally(() => origRelease.call(client));
      }
      return origRelease.call(client, err);
    };
    return client;
  };
  if (typeof cb === 'function') return originalConnect((e, c, done) => cb(e, c && wrap(c), done));
  return originalConnect().then(wrap);
};

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
