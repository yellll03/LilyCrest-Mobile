const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, notificationController.getMyNotifications);
router.patch('/read-all', authMiddleware, notificationController.markAllNotificationsRead);
router.patch('/:notificationId/read', authMiddleware, notificationController.markNotificationRead);

module.exports = router;
