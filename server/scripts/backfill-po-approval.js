require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query(
    `UPDATE purchase_orders SET admin_approval='approved', owner_approval='approved'
     WHERE status IN ('approved','ordered','received','partial_received') AND admin_approval='pending'`
  );
  console.log('backfilled rows:', r.rowCount);
  const q = await p.query("select status, admin_approval, owner_approval, count(*)::int n from purchase_orders group by 1,2,3 order by 1");
  q.rows.forEach(r => console.log(r.status, '| admin=' + r.admin_approval, '| owner=' + r.owner_approval, '| n=' + r.n));
  await p.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1) });