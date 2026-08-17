const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authMiddleware, tenantMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, tenantMiddleware, notificationController.getMyNotifications);
router.patch('/read-all', authMiddleware, tenantMiddleware, notificationController.markAllNotificationsRead);
router.patch('/:notificationId/read', authMiddleware, tenantMiddleware, notificationController.markNotificationRead);
// Clear-all must be registered before the :notificationId route so 'DELETE /notifications'
// doesn't get swallowed by 'DELETE /notifications/:notificationId'.
router.delete('/', authMiddleware, tenantMiddleware, notificationController.clearAllNotifications);
router.delete('/:notificationId', authMiddleware, tenantMiddleware, notificationController.dismissNotification);

module.exports = router;
