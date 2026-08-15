const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authMiddleware, tenantMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, tenantMiddleware, notificationController.getMyNotifications);
router.patch('/read-all', authMiddleware, tenantMiddleware, notificationController.markAllNotificationsRead);
router.patch('/:notificationId/read', authMiddleware, tenantMiddleware, notificationController.markNotificationRead);

module.exports = router;
