const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Tenant routes
router.get('/me', authMiddleware, maintenanceController.getMyMaintenance);
router.post('/', authMiddleware, maintenanceController.createMaintenance);
router.put('/:requestId', authMiddleware, maintenanceController.updateMaintenance);
router.patch('/:requestId/cancel', authMiddleware, maintenanceController.cancelMaintenance);
router.patch('/:requestId/reopen', authMiddleware, maintenanceController.reopenMaintenance);

// Admin routes
router.get('/admin/all', authMiddleware, adminMiddleware, maintenanceController.adminGetAll);
router.patch('/admin/:requestId/status', authMiddleware, adminMiddleware, maintenanceController.adminUpdateStatus);

module.exports = router;
