const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authMiddleware, adminMiddleware, tenantMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, tenantMiddleware, userController.getMe);
router.put('/me', authMiddleware, tenantMiddleware, userController.updateMe);
router.post('/push-token', authMiddleware, tenantMiddleware, userController.savePushToken);

// Document management
router.post('/documents', authMiddleware, tenantMiddleware, userController.uploadDocument);
router.get('/documents', authMiddleware, tenantMiddleware, userController.getUserDocuments);
router.get('/documents/:docId', authMiddleware, tenantMiddleware, userController.getDocumentFile);
router.get('/documents/:docId/content', authMiddleware, tenantMiddleware, userController.getDocumentContent);
router.delete('/documents/:docId', authMiddleware, tenantMiddleware, userController.deleteDocument);

// Admin
router.get('/admin/all', authMiddleware, adminMiddleware, userController.adminGetAllUsers);

module.exports = router;
