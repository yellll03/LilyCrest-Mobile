const express = require('express');
const router = express.Router();
const paymongoController = require('../controllers/paymongo.controller');
const { authMiddleware } = require('../middleware/auth');

// Create a PayMongo checkout session (requires auth)
router.post('/checkout', authMiddleware, paymongoController.createCheckoutSession);

// Check checkout session status (requires auth)
router.get('/checkout/:checkoutId/status', authMiddleware, paymongoController.getCheckoutStatus);

// PayMongo webhook (NO auth — called by PayMongo servers)
router.post('/webhook', paymongoController.handleWebhook);

// Redirect handlers — PayMongo redirects the browser here after payment,
// then we bounce the user back to the app via deep link (NO auth needed)
router.get('/redirect/success', paymongoController.redirectSuccess);
router.get('/redirect/cancel', paymongoController.redirectCancel);

module.exports = router;
