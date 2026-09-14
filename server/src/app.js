require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const { router: backupRouter } = require('./routes/backup');
const { normalizeBody } = require('./middleware/validate');

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

const isProduction = process.env.NODE_ENV === 'production';
const isServerless = !!process.env.VERCEL;

// Schema initialisation.
//  - development: runs on every start unless RUN_MIGRATIONS=false (fresh checkouts just work)
//  - production:  runs ONLY when RUN_MIGRATIONS=true — ~150 DDL statements (with an exclusive
//    lock on users) must not run on every serverless cold start. Set it for one deploy after
//    a schema change, then unset it.
// `app.ready` resolves when initialisation is finished; API requests wait for it so the first
// request (or the seeder) never races the CREATE TABLE statements.
const shouldInitSchema = isProduction ? process.env.RUN_MIGRATIONS === 'true' : process.env.RUN_MIGRATIONS !== 'false';
let ready = Promise.resolve();
if (shouldInitSchema) {
  const { createSchema } = require('./db/schema');
  console.log(`Schema initialization: running${isProduction ? ' (RUN_MIGRATIONS=true)' : ''}`);
  ready = createSchema().catch(err => console.error('Schema init failed:', err.message));
} else {
  console.log(`Schema initialization skipped${isProduction ? ' (set RUN_MIGRATIONS=true for one deploy after schema changes)' : ' (RUN_MIGRATIONS=false)'}`);
}
app.ready = ready;
app.use('/api', (req, res, next) => { ready.then(() => next(), () => next()); });

// Auto-seed production database on first request if users table is empty
// This ensures the default users are created in Vercel serverless environments
let seedPromise = null;
async function ensureSeed() {
  if (seedPromise) return seedPromise;
  const seedEnabled = process.env.SEED_ENABLED === 'true';
  if (!seedEnabled) return;
  
  seedPromise = (async () => {
    try {
      const pool = require('./db/pool');
      const { seedDatabase } = require('./db/seed');
      
      // Check if users table has any users
      const { rows } = await pool.query('SELECT COUNT(*) as count FROM users');
      const userCount = parseInt(rows[0]?.count || '0');
      
      if (userCount === 0) {
        console.log('Users table empty, running seed...');
        await seedDatabase();
        console.log('Seed completed successfully');
      } else {
        console.log(`Users table has ${userCount} users, skipping seed`);
      }
    } catch (err) {
      console.error('Auto-seed failed:', err.message);
      seedPromise = null; // Allow retry on next request
    }
  })();
  return seedPromise;
}

// Middleware to ensure seed runs before any API route
app.use('/api', async (req, res, next) => {
  // Skip ensureSeed for health endpoint
  if (req.path === '/health') return next();
  await ensureSeed();
  next();
});

const defaultOrigins = ['http://localhost:3000', 'http://localhost:5000'];
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : defaultOrigins;

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (corsOrigins.includes(origin)) return cb(null, origin);
    if (isServerless) {
      const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || '';
      if (prodUrl && origin.includes(prodUrl)) return cb(null, origin);
      if (origin.endsWith('.vercel.app')) return cb(null, origin);
    }
    return cb(null, false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
if (!isServerless) {
  app.use(morgan(isProduction ? 'combined' : 'dev'));
}
app.use(express.json({ limit: '2mb' }));
app.use(normalizeBody); // '' -> null so optional DATE/INT/UUID fields never 500
app.disable('x-powered-by');

// Basic security headers (no external deps)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// Body-parser errors (bad JSON, too large, wrong charset) must stop the request here —
// calling next() without the error would let the route run with an empty body.
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large' || err.status === 413) return res.status(413).json({ error: 'Request body too large (max 2 MB)' });
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return res.status(400).json({ error: 'Invalid JSON in request body' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message || 'Bad request' });
  next(err);
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
// Alias for backward compatibility
app.use('/api/bank-accounts', bankRoutes);
app.use('/api/notifications', notificationRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Final error handler — never leaks stack traces to the client
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Unhandled error:', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;