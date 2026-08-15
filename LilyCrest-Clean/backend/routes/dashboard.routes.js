const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authMiddleware, tenantMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, tenantMiddleware, dashboardController.getDashboard);

module.exports = router;
