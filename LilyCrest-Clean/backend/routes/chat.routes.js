const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { authMiddleware } = require('../middleware/auth');

router.post('/start', authMiddleware, chatController.startConversation);
router.get('/me', authMiddleware, chatController.getMyConversations);
router.get('/:conversationId/messages', authMiddleware, chatController.getConversationMessages);
router.post('/:conversationId/messages', authMiddleware, chatController.sendMessage);

module.exports = router;
