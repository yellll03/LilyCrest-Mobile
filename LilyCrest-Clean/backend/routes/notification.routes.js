const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, notificationController.getMyNotifications);

module.exports = router;
