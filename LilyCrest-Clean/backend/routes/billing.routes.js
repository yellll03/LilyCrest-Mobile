const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billing.controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, billingController.getMyBilling);
router.get('/me/latest', authMiddleware, billingController.getLatestBilling);
router.get('/history/paid', authMiddleware, billingController.getPaymentHistory);
router.get('/history', authMiddleware, billingController.getBillingHistory);
router.get('/:billingId', authMiddleware, billingController.getBillingById);
router.get('/:billingId/pdf', authMiddleware, billingController.downloadBillPdf);
router.post('/:billingId/payment-proof', authMiddleware, billingController.submitPaymentProof);
router.post('/', authMiddleware, adminMiddleware, billingController.createBilling);
router.put('/:billingId', authMiddleware, adminMiddleware, billingController.updateBilling);

module.exports = router;
