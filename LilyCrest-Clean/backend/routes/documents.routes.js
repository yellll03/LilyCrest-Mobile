const express = require('express');
const router = express.Router();
const documentsController = require('../controllers/documents.controller');
const { authMiddleware, tenantMiddleware } = require('../middleware/auth');

router.get('/:docId', authMiddleware, tenantMiddleware, documentsController.downloadDocument);

module.exports = router;