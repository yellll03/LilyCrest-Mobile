const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcement.controller');
const { authMiddleware, adminMiddleware, tenantMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, tenantMiddleware, announcementController.getAllAnnouncements);

// Admin: create announcement (pushes notification to all tenants)
router.post('/', authMiddleware, adminMiddleware, announcementController.createAnnouncement);

// Tenant: per-tenant hide from the News tab only (never deletes admin content)
router.post('/dismiss-bulk', authMiddleware, tenantMiddleware, announcementController.dismissAnnouncementsBulk);
router.post('/:announcementId/dismiss', authMiddleware, tenantMiddleware, announcementController.dismissAnnouncement);
// Undo a dismiss. Same resource as the POST above (this tenant's dismissal of
// this announcement), so it is expressed as DELETE on that resource rather
// than a second verb-shaped path. Admin content is never touched either way.
router.delete('/:announcementId/dismiss', authMiddleware, tenantMiddleware, announcementController.restoreAnnouncement);

module.exports = router;
