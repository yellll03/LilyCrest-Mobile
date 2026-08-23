const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbot.controller');
const { authMiddleware, adminMiddleware, tenantMiddleware } = require('../middleware/auth');

// Regular chatbot routes — tenant-only. Tenant middleware keeps an
// authenticated admin/superadmin session from using this surface, consistent
// with every other tenant-scoped router.
router.get('/suggestions', authMiddleware, tenantMiddleware, chatbotController.getSuggestions);
router.post('/message', authMiddleware, tenantMiddleware, chatbotController.sendMessage);
router.post('/request-admin', authMiddleware, tenantMiddleware, chatbotController.requestAdmin);
router.post('/reset', authMiddleware, tenantMiddleware, chatbotController.resetSession);
// Compatibility-only legacy paths fail closed with 410 and direct upgraded
// clients to /api/chat. They intentionally never read or mutate legacy data.
router.get('/live-status/:sessionId', authMiddleware, tenantMiddleware, chatbotController.getLiveStatus);
router.post('/close-live-chat', authMiddleware, chatbotController.closeLiveChat);
router.get('/history', authMiddleware, tenantMiddleware, chatbotController.getChatHistory);

// Admin routes — adminMiddleware enforces admin/superadmin role
router.get('/admin/live-chats', authMiddleware, adminMiddleware, chatbotController.getLiveChats);
router.post('/admin/live-chat/accept', authMiddleware, adminMiddleware, chatbotController.acceptLiveChat);
router.post('/admin/live-chat/message', authMiddleware, adminMiddleware, chatbotController.sendAdminMessage);

module.exports = router;
