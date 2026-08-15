require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const QAPASS = 'ImsQa!Pass2026';
const accounts = [
  ['qa-admin@ims.com', 'QA Admin', 'admin'],
  ['qa-owner@ims.com', 'QA Owner', 'owner'],
  ['qa-finance@ims.com', 'QA Finance', 'finance'],
  ['qa-pm@ims.com', 'QA PM', 'manager'],
  ['qa-procurement@ims.com', 'QA Procurement', 'procurement_officer'],
  ['qa-store@ims.com', 'QA Store', 'store_manager'],
];
(async () => {
  const hash = await bcrypt.hash(QAPASS, 10);
  for (const [email, name, role] of accounts) {
    const { rows } = await p.query(
      `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET password_hash=$2, full_name=$3, role=$4, is_active=true
       RETURNING id, email, role`,
      [email, hash, name, role]
    );
    console.log('OK', rows[0].email, rows[0].role);
  }
  await p.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1) });