require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const c = await p.query("select column_name,is_nullable from information_schema.columns where table_name='purchase_orders' and column_name in ('project_id','admin_approval','admin_approved_by','admin_reject_reason','owner_approval','owner_approved_by','owner_reject_reason') order by column_name");
  c.rows.forEach(r => console.log('PO.', r.column_name, 'null=' + r.is_nullable));
  const chk = await p.query("select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid='purchase_orders'::regclass and conname='purchase_orders_status_check'");
  console.log('status check:', chk.rows[0].def);
  const chk2 = await p.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='deletion_requests'::regclass and conname='deletion_requests_transaction_type_check'");
  console.log('dr check:', chk2.rows[0].def);
  const t = await p.query("select column_name,is_nullable from information_schema.columns where table_name='petty_cash_utilization' order by ordinal_position");
  t.rows.forEach(r => console.log('PCU.', r.column_name));
  const nul = await p.query('select count(*)::int n from purchase_orders where project_id is null');
  console.log('POs with null project:', nul.rows[0].n);
  const back = await p.query("select status, admin_approval, owner_approval, count(*)::int n from purchase_orders group by 1,2,3 order by 1");
  back.rows.forEach(r => console.log('PO state:', r.status, '| admin=' + r.admin_approval, '| owner=' + r.owner_approval, '| n=' + r.n));
  await p.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1) });