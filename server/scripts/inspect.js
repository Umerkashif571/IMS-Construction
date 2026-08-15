require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const t = await p.query("select table_name from information_schema.tables where table_schema='public' order by table_name");
  console.log('TABLES:', t.rows.map(r => r.table_name).join(', '));
  const c = await p.query("select column_name,data_type,is_nullable,column_default from information_schema.columns where table_name='purchase_orders' order by ordinal_position");
  console.log('PO COLS:');
  c.rows.forEach(r => console.log(' ', r.column_name, r.data_type, 'null=' + r.is_nullable, r.column_default || ''));
  const u = await p.query('select id,email,role,is_active from users order by role');
  console.log('USERS:');
  u.rows.forEach(r => console.log(' ', r.email, '|', r.role, '| active=' + r.is_active));
  const po = await p.query('select count(*)::int n from purchase_orders');
  console.log('PO count:', po.rows[0].n);
  const pc = await p.query('select count(*)::int n from petty_cash');
  console.log('petty_cash count:', pc.rows[0].n);
  await p.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1) });