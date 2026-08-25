require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const isProduction = process.env.NODE_ENV === 'production';
const isServerless = !!process.env.VERCEL;

const app = express();

if (!isServerless) {
  const defaultOrigins = ['http://localhost:3000', 'http://localhost:5000'];
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : defaultOrigins;
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, origin);
      return cb(null, false);
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(isProduction ? 'combined' : 'dev'));
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Add routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const materialRoutes = require('./routes/materials');
app.use('/api/materials', materialRoutes);

const vehicleRoutes = require('./routes/vehicles');
app.use('/api/vehicles', vehicleRoutes);

const toolRoutes = require('./routes/tools');
app.use('/api/tools', toolRoutes);

const projectRoutes = require('./routes/projects');
app.use('/api/projects', projectRoutes);

const vendorRoutes = require('./routes/vendors');
app.use('/api/vendors', vendorRoutes);

const purchaseOrderRoutes = require('./routes/purchase_orders');
app.use('/api/purchase-orders', purchaseOrderRoutes);

const warehouseRoutes = require('./routes/warehouses');
app.use('/api/warehouses', warehouseRoutes);

const reportRoutes = require('./routes/reports');
app.use('/api/reports', reportRoutes);

const dashboardRoutes = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRoutes);

const userRoutes = require('./routes/users');
app.use('/api/users', userRoutes);

const gatepassRoutes = require('./routes/gatepass');
app.use('/api/gatepass', gatepassRoutes);

const financeRoutes = require('./routes/finance');
app.use('/api/projects/:projectId/finance', financeRoutes);
app.use('/api/finance', financeRoutes.globalRouter);

const bankRoutes = require('./routes/banks');
app.use('/api/banks', bankRoutes);

const notificationRoutes = require('./routes/notifications');
app.use('/api/notifications', notificationRoutes);

const backupRouter = require('./routes/backup').router;
app.use('/api/backup', backupRouter);

module.exports = app;