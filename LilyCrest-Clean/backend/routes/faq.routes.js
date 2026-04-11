const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faq.controller');

router.get('/categories', faqController.getFAQCategories);
router.get('/', faqController.getAllFaqs);

module.exports = router;
