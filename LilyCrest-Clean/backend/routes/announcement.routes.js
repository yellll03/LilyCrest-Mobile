const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcement.controller');
const { authMiddleware, adminMiddleware, tenantMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, tenantMiddleware, announcementController.getAllAnnouncements);

// Admin management surfaces are separate from the tenant-filtered feed.
router.get('/admin', authMiddleware, adminMiddleware, announcementController.getAdminAnnouncements);
router.get('/admin/options', authMiddleware, adminMiddleware, announcementController.getAdminAnnouncementOptions);
router.patch('/admin/:announcementId/lifecycle', authMiddleware, adminMiddleware, announcementController.setAnnouncementLifecycle);

// Admin: create announcement and queue canonical audience delivery.
router.post('/', authMiddleware, adminMiddleware, announcementController.createAnnouncement);

// Tenant: per-tenant hide from the News tab only (never deletes admin content)
router.post('/dismiss-bulk', authMiddleware, tenantMiddleware, announcementController.dismissAnnouncementsBulk);
router.post('/:announcementId/dismiss', authMiddleware, tenantMiddleware, announcementController.dismissAnnouncement);

module.exports = router;
