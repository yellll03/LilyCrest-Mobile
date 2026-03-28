const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, maintenanceController.getMyMaintenance);
router.post('/', authMiddleware, maintenanceController.createMaintenance);
router.put('/:requestId', authMiddleware, maintenanceController.updateMaintenance);
router.patch('/:requestId/cancel', authMiddleware, maintenanceController.cancelMaintenance);
router.patch('/:requestId/reopen', authMiddleware, maintenanceController.reopenMaintenance);

module.exports = router;
