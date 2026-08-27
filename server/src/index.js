require('dotenv').config();
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const app = require('./app');
const pool = require('./db/pool');
const { seedDatabase } = require('./db/seed');
const { dumpWithoutPgDump } = require('./routes/backup');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

const PORT = process.env.PORT || 5000;

const isServerless = !!process.env.VERCEL;

// Seeding policy: never automatic in production.
// Seed runs only when NOT in production, OR when SEED_ENABLED=true is set explicitly.
const isProduction = process.env.NODE_ENV === 'production';
const seedEnabled = process.env.SEED_ENABLED === 'true';
const seedAllowed = !isProduction || seedEnabled;

// Scheduled daily backup at 2:00 AM (long-running process only; cron does not run in Vercel functions)
if (!isServerless) {
  cron.schedule('0 2 * * *', async () => {
    try {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const filename = `ims_auto_backup_${new Date().toISOString().split('T')[0]}.sql`;
      const filepath = path.join(BACKUP_DIR, filename);
      const dump = await dumpWithoutPgDump();
      fs.writeFileSync(filepath, dump, 'utf8');
      console.log(`Automated backup created: ${filename}`);
    } catch (err) {
      console.error('Scheduled backup failed:', err.message);
    }
  });

  // Check for overdue tool checkouts hourly; notify Owner/Admin + the user who checked the tool out
  cron.schedule('0 * * * *', async () => {
    try {
      const { rows: overdue } = await pool.query(
        `SELECT t.id, t.name, t.return_due_date, t.checked_out_to,
                cl.user_id AS checkout_user_id, cl.employee_name
         FROM tools t
         JOIN tool_checkout_log cl ON cl.tool_id = t.id AND cl.actual_return_date IS NULL
         WHERE t.current_status = 'checked_out'
           AND t.is_active = true
           AND t.return_due_date IS NOT NULL
           AND t.return_due_date < NOW()
           AND NOT EXISTS (
             SELECT 1 FROM notifications n
             WHERE n.entity_type = 'tool' AND n.entity_id = t.id AND n.type = 'tool_overdue'
           )`
      );

      for (const tool of overdue) {
        const title = `Tool overdue: ${tool.name}`;
        const message = `${tool.name} was due for return on ${new Date(tool.return_due_date).toLocaleString()}`;
        const link = `/tools?tool=${tool.id}`;
        const recipientIds = new Set([tool.checkout_user_id]);
        const { rows: admins } = await pool.query(
          `SELECT id FROM users WHERE is_active = true AND role IN ('owner', 'admin')`
        );
        admins.forEach(a => recipientIds.add(a.id));
        for (const uid of recipientIds) {
          if (!uid) continue;
          await pool.query(
            `INSERT INTO notifications (user_id, type, title, message, link, entity_type, entity_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [uid, 'tool_overdue', title, message, link, 'tool', tool.id]
          );
        }
        console.log(`Overdue notification created for tool: ${tool.name} (${tool.id})`);
      }
    } catch (err) {
      console.error('Overdue tool check failed:', err.message);
    }
  });
}

async function start() {
  // Schema is initialized in app.js (module load)
  // Only run delivery status migration and seeding here
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
  if (seedAllowed) {
    try { await seedDatabase(); } catch (e) { console.error('Seed error:', e.message); }
  } else {
    console.log('Seeding skipped: NODE_ENV=production and SEED_ENABLED is not set to "true"');
  }
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`IMS Server running on port ${PORT}`);
    console.log(`API: http://localhost:${PORT}/api`);
  });
  server.on('error', (err) => {
    console.error('Server error:', err);
  });
}

// Serverless (Vercel) does not need a listening socket — the platform invokes the handler directly.
if (process.env.VERCEL) {
  console.log('Running in Vercel serverless mode — skipping app.listen()');
} else {
  start();
}