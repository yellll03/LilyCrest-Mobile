const express = require('express');
const router = express.Router();
const seedController = require('../controllers/seed.controller');
const { authMiddleware } = require('../middleware/auth');

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

function seedAccessMiddleware(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ detail: 'Not found' });
  }

  const role = String(req.user?.role || '').toLowerCase();
  if (!['admin', 'superadmin', 'owner'].includes(role)) {
    return res.status(403).json({ detail: 'Admin access required' });
  }

  return next();
}

// Seed route is development-only and admin/owner gated.
router.post('/seed', authMiddleware, seedAccessMiddleware, seedController.seedData);

// Health check
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'LilyCrest Mobile Backend',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    backend: 'Node.js/Express',
    auth: 'Firebase-only'
  });
});

// Root route
router.get('/', (req, res) => {
  res.json({ message: 'Lilycrest Dormitory Management API - Node.js' });
});

module.exports = router;
