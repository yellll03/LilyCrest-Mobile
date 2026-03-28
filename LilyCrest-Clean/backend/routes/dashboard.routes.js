const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, dashboardController.getDashboard);

module.exports = router;
