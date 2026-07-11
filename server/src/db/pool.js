const { Pool } = require('pg');
require('dotenv').config();

let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
} else {
  pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ims_db',
    password: 'postgres',
    port: 5432,
  });
}

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = pool;