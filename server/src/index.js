require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cron = require('node-cron');
const path = require('path');

const { createSchema } = require('./db/schema');
const pool = require('./db/pool');
const { seedDatabase } = require('./db/seed');
const { router: backupRouter, dumpWithoutPgDump } = require('./routes/backup');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const materialRoutes = require('./routes/materials');
const vehicleRoutes = require('./routes/vehicles');
const toolRoutes = require('./routes/tools');
const projectRoutes = require('./routes/projects');
const vendorRoutes = require('./routes/vendors');
const purchaseOrderRoutes = require('./routes/purchase_orders');
const warehouseRoutes = require('./routes/warehouses');
const reportRoutes = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const userRoutes = require('./routes/users');
const gatepassRoutes = require('./routes/gatepass');
const financeRoutes = require('./routes/finance');
const bankRoutes = require('./routes/banks');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 5000;

// Seeding policy: never automatic in production.
// Seed runs only when NOT in production, OR when SEED_ENABLED=true is set explicitly.
const isProduction = process.env.NODE_ENV === 'production';
const seedEnabled = process.env.SEED_ENABLED === 'true';
const seedAllowed = !isProduction || seedEnabled;

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://localhost:5000'];

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.disable('x-powered-by');

// Basic security headers (no external deps)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// Global JSON parse error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next();
});

// API Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/tools', toolRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/backup', backupRouter);
app.use('/api/gatepass', gatepassRoutes);
app.use('/api/projects/:projectId/finance', financeRoutes);
app.use('/api/finance', financeRoutes.globalRouter);
app.use('/api/banks', bankRoutes);
app.use('/api/notifications', notificationRoutes);

// Scheduled daily backup at 2:00 AM
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

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Production frontend serving: client/dist via Express (SPA fallback for client-side routes).
// Dev mode uses the vite dev server on :3000 — this block is inactive there.
if (isProduction) {
  const distDir = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
    console.log(`Serving client build from ${distDir}`);
  } else {
    console.warn(`WARNING: client/dist not found at ${distDir} — frontend is NOT being served`);
  }
}

// Final error handler — never leaks stack traces to the client
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Unhandled error:', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    await createSchema();
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
  if (seedAllowed) {
    try { await seedDatabase(); } catch (e) { console.error('Seed error:', e.message); }
  } else {
    console.log('Seeding skipped: NODE_ENV=production and SEED_ENABLED is not set to "true"');
  }
  app.listen(PORT, () => {
    console.log(`IMS Server running on port ${PORT}`);
    console.log(`API: http://localhost:${PORT}/api`);
  });
}

start();