const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbot.controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Regular chatbot routes
router.post('/message', authMiddleware, chatbotController.sendMessage);
router.post('/request-admin', authMiddleware, chatbotController.requestAdmin);
router.post('/reset', authMiddleware, chatbotController.resetSession);
router.get('/live-status/:sessionId', authMiddleware, chatbotController.getLiveStatus);
router.post('/close-live-chat', authMiddleware, chatbotController.closeLiveChat);
router.get('/history', authMiddleware, chatbotController.getChatHistory);

// Admin routes — adminMiddleware enforces admin/superadmin role
router.get('/admin/live-chats', authMiddleware, adminMiddleware, chatbotController.getLiveChats);
router.post('/admin/live-chat/accept', authMiddleware, adminMiddleware, chatbotController.acceptLiveChat);
router.post('/admin/live-chat/message', authMiddleware, adminMiddleware, chatbotController.sendAdminMessage);

module.exports = router;
