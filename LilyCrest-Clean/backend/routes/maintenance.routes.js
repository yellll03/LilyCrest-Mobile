const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const { authMiddleware, adminMiddleware, tenantMiddleware } = require('../middleware/auth');

// Admin routes
router.get('/admin/all', authMiddleware, adminMiddleware, maintenanceController.adminGetAll);
router.patch('/admin/:requestId/status', authMiddleware, adminMiddleware, maintenanceController.adminUpdateStatus);

// Tenant routes
router.get('/me', authMiddleware, tenantMiddleware, maintenanceController.getMyMaintenance);
router.post('/', authMiddleware, tenantMiddleware, maintenanceController.createMaintenance);
router.get('/:requestId', authMiddleware, tenantMiddleware, maintenanceController.getMaintenanceDetail);
router.post('/:requestId/replies', authMiddleware, tenantMiddleware, maintenanceController.addTenantMaintenanceReply);
router.patch('/:requestId/read', authMiddleware, tenantMiddleware, maintenanceController.markMaintenanceRead);
router.patch('/:requestId/confirm-resolved', authMiddleware, tenantMiddleware, maintenanceController.confirmMaintenanceResolved);
router.put('/:requestId', authMiddleware, tenantMiddleware, maintenanceController.updateMaintenance);
router.patch('/:requestId/cancel', authMiddleware, tenantMiddleware, maintenanceController.cancelMaintenance);
router.patch('/:requestId/reopen', authMiddleware, tenantMiddleware, maintenanceController.reopenMaintenance);

module.exports = router;
