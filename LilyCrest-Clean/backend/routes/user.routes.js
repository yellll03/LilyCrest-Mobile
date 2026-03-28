const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, userController.getMe);
router.put('/me', authMiddleware, userController.updateMe);
router.post('/push-token', authMiddleware, userController.savePushToken);

// Document management
router.post('/documents', authMiddleware, userController.uploadDocument);
router.get('/documents', authMiddleware, userController.getUserDocuments);
router.get('/documents/:docId', authMiddleware, userController.getDocumentFile);
router.delete('/documents/:docId', authMiddleware, userController.deleteDocument);

module.exports = router;
