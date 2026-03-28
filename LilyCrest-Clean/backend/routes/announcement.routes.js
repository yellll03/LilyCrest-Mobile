const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcement.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, announcementController.getAllAnnouncements);

module.exports = router;
