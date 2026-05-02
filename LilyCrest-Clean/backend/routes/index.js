const express = require('express');
const router = express.Router();
const seedController = require('../controllers/seed.controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

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

// FAQ routes
const faqRoutes = require('./faq.routes');
router.use('/faqs', faqRoutes);

// Ticket routes
const ticketRoutes = require('./ticket.routes');
router.use('/tickets', ticketRoutes);

// Human support chat routes
const chatRoutes = require('./chat.routes');
router.use('/chat', chatRoutes);

// Documents routes
const documentRoutes = require('./documents.routes');
router.use('/documents', documentRoutes);

// Chatbot routes
const chatbotRoutes = require('./chatbot.routes');
router.use('/chatbot', chatbotRoutes);

// PayMongo routes
const paymongoRoutes = require('./paymongo.routes');
router.use('/paymongo', paymongoRoutes);

// Seed route (auth only — for demo/presentation use)
router.post('/seed', authMiddleware, seedController.seedData);

// Health check
router.get('/health', (req, res) => {
  res.json({
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
