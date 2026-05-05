const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const chatController = require('../controllers/chat.controller');

const router = express.Router();

router.use(authMiddleware);

router.post('/start', chatController.startConversation);
router.get('/me', chatController.getMyConversations);
router.get('/admin/conversations', adminMiddleware, chatController.getAdminConversations);
router.get('/admin/:conversationId/messages', adminMiddleware, chatController.getAdminConversationMessages);
router.post('/admin/:conversationId/messages', adminMiddleware, chatController.sendAdminMessage);
router.patch('/admin/:conversationId/status', adminMiddleware, chatController.updateAdminConversationStatus);
router.get('/:conversationId/messages', chatController.getConversationMessages);
router.post('/:conversationId/messages', chatController.sendTenantMessage);
router.patch('/:conversationId/close', chatController.closeConversation);

module.exports = router;
