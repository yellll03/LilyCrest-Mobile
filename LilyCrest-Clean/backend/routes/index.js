const { execSync } = require('child_process');
const express = require('express');
const router = express.Router();
const seedController = require('../controllers/seed.controller');
const { authMiddleware } = require('../middleware/auth');

// Resolved once at process start, not per-request — the commit a running
// process is serving never changes without a redeploy. Render sets
// RENDER_GIT_COMMIT automatically; `git rev-parse` covers any other host
// that ships the .git dir. Mirrors frontend/app.config.js's resolveGitCommit()
// so "does the app commit descend from a given backend commit" is a plain
// string/ancestry comparison, not a guess.
const DEPLOYED_COMMIT = (() => {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 9);
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch (_error) {
    return 'unknown';
  }
})();
const DEPLOYED_AT = new Date().toISOString();

// Auth routes
const authRoutes = require('./auth.routes');
router.use('/auth', authRoutes);

// User routes
const userRoutes = require('./user.routes');
router.use('/users', userRoutes);

// Dashboard routes
const dashboardRoutes = require('./dashboard.routes');
router.use('/dashboard', dashboardRoutes);

// Room routes
const roomRoutes = require('./room.routes');
router.use('/rooms', roomRoutes);

// Billing routes
const billingRoutes = require('./billing.routes');
router.use('/billing', billingRoutes);

// Maintenance routes
const maintenanceRoutes = require('./maintenance.routes');
router.use('/maintenance', maintenanceRoutes);

// Announcement routes
const announcementRoutes = require('./announcement.routes');
router.use('/announcements', announcementRoutes);

// Notification routes
const notificationRoutes = require('./notification.routes');
router.use('/notifications', notificationRoutes);

// FAQ routes
const faqRoutes = require('./faq.routes');
router.use('/faqs', faqRoutes);

// Ticket routes
const ticketRoutes = require('./ticket.routes');
router.use('/tickets', ticketRoutes);

// Support chat routes
const chatRoutes = require('./chat.routes');
router.use('/chat', chatRoutes);

// Upload routes
const uploadRoutes = require('./upload.routes');
router.use('/upload', uploadRoutes);

// Documents routes
const documentRoutes = require('./documents.routes');
router.use('/documents', documentRoutes);

// Chatbot routes
const chatbotRoutes = require('./chatbot.routes');
router.use('/chatbot', chatbotRoutes);

// PayMongo routes
const paymongoRoutes = require('./paymongo.routes');
router.use('/paymongo', paymongoRoutes);

// Tenant survey and authorized survey-management routes
const surveyRoutes = require('./survey.routes');
router.use('/surveys', surveyRoutes);

// Authoritative Contract bridge (proxies to Capstone-Website; see
// contracts.routes.js for why this isn't a local implementation)
const contractRoutes = require('./contracts.routes');
router.use('/contracts', contractRoutes);

function seedAccessMiddleware(req, res, next) {
  if (String(process.env.LILYCREST_ENVIRONMENT || '').toLowerCase() !== 'staging') {
    return res.status(404).json({ detail: 'Not found' });
  }

  const role = String(req.user?.role || '').toLowerCase();
  if (!['admin', 'superadmin', 'owner'].includes(role)) {
    return res.status(403).json({ detail: 'Admin access required' });
  }

  return next();
}

// Legacy seed route is staging-only, admin/owner gated, and additionally
// protected by the target guard inside seedData. Prefer the QA fixture CLI.
router.post('/seed', authMiddleware, seedAccessMiddleware, seedController.seedData);

// Health check — also the source of truth for "which commit is this backend
// actually running", so a mismatch between this and a device's Profile
// footer (frontend/app/(tabs)/profile.jsx) proves a deployment/build gap
// rather than a code bug.
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    commit: DEPLOYED_COMMIT,
    deployedAt: DEPLOYED_AT,
    env: process.env.NODE_ENV || 'development',
  });
});

// Root route
router.get('/', (req, res) => {
  res.json({ message: 'Lilycrest Dormitory Management API - Node.js' });
});

module.exports = router;
