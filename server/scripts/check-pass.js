require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const seed = process.env.SEED_PASSWORD;
  const { rows } = await p.query('select email, password_hash from users where email in ($1,$2,$3,$4)',
    ['admin@ims.com', 'owner@ims.com', 'finance@ims.com', 'procurement@ims.com']);
  for (const r of rows) {
    const ok = await bcrypt.compare(seed, r.password_hash);
    console.log(r.email, 'seed-match:', ok);
  }
  await p.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1) });