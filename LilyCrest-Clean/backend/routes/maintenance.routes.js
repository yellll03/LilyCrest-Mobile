const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const { authMiddleware } = require('../middleware/auth');

// Tenant routes
router.get('/me', authMiddleware, maintenanceController.getMyMaintenance);
router.post('/', authMiddleware, maintenanceController.createMaintenance);
router.get('/:requestId', authMiddleware, maintenanceController.getMaintenanceDetail);
router.post('/:requestId/replies', authMiddleware, maintenanceController.addTenantMaintenanceReply);
router.patch('/:requestId/read', authMiddleware, maintenanceController.markMaintenanceRead);
router.patch('/:requestId/confirm-resolved', authMiddleware, maintenanceController.confirmMaintenanceResolved);
router.put('/:requestId', authMiddleware, maintenanceController.updateMaintenance);
router.patch('/:requestId/cancel', authMiddleware, maintenanceController.cancelMaintenance);
router.patch('/:requestId/reopen', authMiddleware, maintenanceController.reopenMaintenance);

module.exports = router;
