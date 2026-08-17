const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcement.controller');
const { authMiddleware, adminMiddleware, optionalAuthMiddleware, tenantMiddleware } = require('../middleware/auth');

router.get('/', optionalAuthMiddleware, announcementController.getAllAnnouncements);

// Admin: create announcement (pushes notification to all tenants)
router.post('/', authMiddleware, adminMiddleware, announcementController.createAnnouncement);

// Tenant: per-tenant hide from the News tab only (never deletes admin content)
router.post('/dismiss-bulk', authMiddleware, tenantMiddleware, announcementController.dismissAnnouncementsBulk);
router.post('/:announcementId/dismiss', authMiddleware, tenantMiddleware, announcementController.dismissAnnouncement);

module.exports = router;
