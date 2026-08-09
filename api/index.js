// Vercel serverless entry point — wraps the existing Express app as a single
// catch-all serverless function so all routes/business logic are preserved as-is.
const serverless = require('serverless-http');
const app = require('../server/src/app');

module.exports = serverless(app);