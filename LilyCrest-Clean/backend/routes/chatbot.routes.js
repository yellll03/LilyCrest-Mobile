const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbot.controller');
const { authMiddleware, adminMiddleware, tenantMiddleware } = require('../middleware/auth');

// Regular chatbot routes — tenant-only. Session ownership is separately
// enforced inside the controller (normalizeSessionId + getOwnedLiveChat +
// identity-fingerprint reset), but tenantMiddleware keeps an authenticated
// admin/superadmin session from using this surface at all, consistent with
// every other tenant-scoped router.
router.post('/message', authMiddleware, tenantMiddleware, chatbotController.sendMessage);
router.post('/request-admin', authMiddleware, tenantMiddleware, chatbotController.requestAdmin);
router.post('/reset', authMiddleware, tenantMiddleware, chatbotController.resetSession);
router.get('/live-status/:sessionId', authMiddleware, tenantMiddleware, chatbotController.getLiveStatus);
// Exception: closeLiveChat's controller has legitimate owner-OR-admin
// semantics (an admin can also close a live chat they're handling), and no
// separate /admin/live-chat/close route exists to move that case to — so
// this one route intentionally keeps only authMiddleware. Ownership/role is
// enforced inside the controller itself (isOwner || isAdmin check).
router.post('/close-live-chat', authMiddleware, chatbotController.closeLiveChat);
router.get('/history', authMiddleware, tenantMiddleware, chatbotController.getChatHistory);

// Admin routes — adminMiddleware enforces admin/superadmin role
router.get('/admin/live-chats', authMiddleware, adminMiddleware, chatbotController.getLiveChats);
router.post('/admin/live-chat/accept', authMiddleware, adminMiddleware, chatbotController.acceptLiveChat);
router.post('/admin/live-chat/message', authMiddleware, adminMiddleware, chatbotController.sendAdminMessage);

module.exports = router;
