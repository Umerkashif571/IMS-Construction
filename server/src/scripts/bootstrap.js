// Manual database bootstrap for environments where the app runs without a long-lived
// process (Vercel serverless). Run once (or after schema changes):
//   npm run db:init
// Applies: schema sync (idempotent) -> delivery_status backfill -> optional seed.
require('dotenv').config();
const pool = require('../db/pool');
const { createSchema } = require('../db/schema');
const { seedDatabase } = require('../db/seed');

(async () => {
  try {
    await createSchema(pool);
  } catch (e) {
    console.error('Schema creation failed:', e.message, e.stack);
    process.exit(1);
  }
  try {
    await pool.query(`
      UPDATE purchase_orders SET delivery_status = CASE status
        WHEN 'received' THEN 'delivered'
        WHEN 'partial_received' THEN 'partial'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'pending'
      END
      WHERE delivery_status IS DISTINCT FROM CASE status
        WHEN 'received' THEN 'delivered'
        WHEN 'partial_received' THEN 'partial'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'pending'
      END
    `);
    console.log('Delivery status migration: done');
  } catch (e) { console.error('Delivery status migration error:', e.message); }

  const isProduction = process.env.NODE_ENV === 'production';
  const seedEnabled = process.env.SEED_ENABLED === 'true';
  if (!isProduction || seedEnabled) {
    try { await seedDatabase(); } catch (e) { console.error('Seed error:', e.message); }
  } else {
    console.log('Seeding skipped: NODE_ENV=production and SEED_ENABLED is not set to "true"');
  }
  console.log('Bootstrap complete. Host:', (pool.options.connectionString || '').replace(/\/\/[^@]+@/, '//***@'));
  await pool.end();
})().catch(e => { console.error('Bootstrap failed:', e.message); process.exit(1); });