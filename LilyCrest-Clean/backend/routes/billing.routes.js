const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billing.controller');
const { authMiddleware, adminMiddleware, tenantMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, tenantMiddleware, billingController.getMyBilling);
router.get('/me/latest', authMiddleware, tenantMiddleware, billingController.getLatestBilling);
router.get('/history/paid', authMiddleware, tenantMiddleware, billingController.getPaymentHistory);
router.get('/history', authMiddleware, tenantMiddleware, billingController.getBillingHistory);
router.get('/:billingId', authMiddleware, tenantMiddleware, billingController.getBillingById);
router.get('/:billingId/pdf', authMiddleware, tenantMiddleware, billingController.downloadBillPdf);
router.get('/:billingId/receipt', authMiddleware, tenantMiddleware, billingController.downloadBillReceiptPdf);
router.post('/:billingId/payment-proof', authMiddleware, tenantMiddleware, billingController.submitPaymentProof);
router.post('/', authMiddleware, adminMiddleware, billingController.createBilling);
router.put('/:billingId', authMiddleware, adminMiddleware, billingController.updateBilling);

module.exports = router;
