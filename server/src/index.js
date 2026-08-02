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

const app = express();
const PORT = process.env.PORT || 5000;

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://localhost:5000'];

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

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

async function start() {
  try { await createSchema(); } catch (e) { console.error('Schema error:', e.message); }
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
  try { await seedDatabase(); } catch (e) { console.error('Seed error:', e.message); }
  app.listen(PORT, () => {
    console.log(`IMS Server running on port ${PORT}`);
    console.log(`API: http://localhost:${PORT}/api`);
  });
}

start();