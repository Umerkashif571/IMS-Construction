const pool = require('./src/db/pool');

pool.query('SELECT column_name FROM information_schema.columns WHERE table_name = \'purchase_orders\'')
  .then(r => console.log(r.rows))
  .catch(e => console.error(e))
  .finally(() => pool.end());