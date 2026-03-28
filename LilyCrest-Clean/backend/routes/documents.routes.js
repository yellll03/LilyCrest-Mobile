const express = require('express');
const router = express.Router();
const documentsController = require('../controllers/documents.controller');
const { authMiddleware } = require('../middleware/auth');

router.get('/:docId', authMiddleware, documentsController.downloadDocument);

module.exports = router;