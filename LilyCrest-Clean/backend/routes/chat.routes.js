const express = require('express');
const { authMiddleware, adminMiddleware, tenantMiddleware } = require('../middleware/auth');
const chatController = require('../controllers/chat.controller');

const router = express.Router();

router.use(authMiddleware);

// Tenant support-chat routes: gated by tenantMiddleware so an authenticated
// admin/superadmin session (still valid here since /auth/login also
// authenticates admins — see backend/middleware/auth.js) cannot use the
// tenant-only chat surface. Ownership itself is separately enforced inside
// the controller via buildTenantConversationFilter(req.user).
router.post('/start', tenantMiddleware, chatController.startConversation);
router.get('/me', tenantMiddleware, chatController.getMyConversations);
router.get('/:conversationId/messages', tenantMiddleware, chatController.getConversationMessages);
router.post('/:conversationId/messages', tenantMiddleware, chatController.sendTenantMessage);
router.patch('/:conversationId/close', tenantMiddleware, chatController.closeConversation);
// Register an already-uploaded file (bytes went through
// POST /upload/firebase-storage) against a conversation the tenant owns.
router.post('/:conversationId/attachments', tenantMiddleware, chatController.uploadConversationAttachment);
// The one protected read path for attachment bytes. Authenticated, scoped to
// the tenant's own conversations, and bound to the conversation the
// attachment was registered against. There is deliberately no unauthenticated
// or storage-URL alternative.
router.get('/:conversationId/attachments/:attachmentId', tenantMiddleware, chatController.downloadConversationAttachment);
// Rollback for a send that failed part-way through a multi-file upload.
// Only the uploader, only their own conversation, and only while nothing has
// referenced the attachment yet — see discardConversationAttachment.
router.delete('/:conversationId/attachments/:attachmentId', tenantMiddleware, chatController.deleteConversationAttachment);
// Tenant's answer to the admin's "was this resolved?" prompt.
router.patch('/:conversationId/resolution', tenantMiddleware, chatController.confirmConversationResolution);
// Reopen a resolved/closed concern on the same thread.
router.patch('/:conversationId/reopen', tenantMiddleware, chatController.reopenConversation);

// Admin support-chat routes: separately gated by adminMiddleware, unaffected
// by the tenant-only restriction above.
router.get('/admin/conversations', adminMiddleware, chatController.getAdminConversations);
router.get('/admin/:conversationId/messages', adminMiddleware, chatController.getAdminConversationMessages);
router.post('/admin/:conversationId/messages', adminMiddleware, chatController.sendAdminMessage);
router.patch('/admin/:conversationId/status', adminMiddleware, chatController.updateAdminConversationStatus);
router.post('/admin/:conversationId/attachments', adminMiddleware, chatController.uploadAdminConversationAttachment);
// Admin read path. Same conversation-bound attachment resolution, but the
// conversation is located through buildAdminConversationFilter, so a
// branch-scoped admin still cannot reach another branch's attachment.
router.get('/admin/:conversationId/attachments/:attachmentId', adminMiddleware, chatController.downloadAdminConversationAttachment);
router.delete('/admin/:conversationId/attachments/:attachmentId', adminMiddleware, chatController.deleteAdminConversationAttachment);

module.exports = router;
