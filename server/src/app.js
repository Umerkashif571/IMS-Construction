require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const { router: backupRouter } = require('./routes/backup');

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

const defaultOrigins = ['http://localhost:3000', 'http://localhost:5000'];
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : defaultOrigins;

app.use(cors({
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
}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));
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

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Production frontend serving: client/dist via Express (SPA fallback for client-side routes).
// Dev mode uses the vite dev server on :3000 — this block is inactive there.
// On Vercel, static files are served by the CDN, not this function.
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

module.exports = app;