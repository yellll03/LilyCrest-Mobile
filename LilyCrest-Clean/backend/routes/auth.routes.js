const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const canonicalPasswordResetController = require('../controllers/canonicalPasswordReset.controller');
const { authMiddleware, authMiddlewareRecentSession, adminMiddleware, tenantMiddleware, tenantPasswordMiddleware } = require('../middleware/auth');

const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 30,
	standardHeaders: true,
	legacyHeaders: false,
	message: { detail: 'Too many authentication attempts. Please try again later.' }
});

router.post('/google', authLimiter, authController.googleSignIn);
router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/login/verify-otp', authLimiter, authController.verifyOtp);
router.post('/login/resend-otp', authLimiter, authController.resendOtp);
router.get('/me', authMiddleware, tenantMiddleware, authController.getMe);
router.get('/admin-session', authMiddleware, adminMiddleware, authController.getAdminBrowserSession);
router.post('/session/refresh', authLimiter, authController.refreshSession);
router.post('/logout', authMiddleware, authController.logout);
router.post('/session-teardown', authLimiter, authMiddlewareRecentSession, authController.sessionTeardown);
router.post('/change-password', authLimiter, authMiddleware, tenantPasswordMiddleware, authController.changePassword);
router.post('/forgot-password', authLimiter, canonicalPasswordResetController.requestPasswordReset);
// Transitional only: GET redirects already-issued custom links to the
// canonical API compatibility page. Status/reset below can consume only
// credentials minted before the cutover; Forgot Password cannot mint them.
router.get('/reset-password', authController.getResetPasswordPage);
// Read-only pre-check for a canonical web frontend's /auth-action page (see
// buildPasswordResetLink in auth.controller.js) — does not consume the token.
// POST + body, not GET + query string, so the single-use raw token is never
// placed in a URL (infra/access logs, browser/proxy history, etc).
router.post('/reset-password/status', authLimiter, authController.checkResetTokenValid);
router.post('/reset-password', authLimiter, authController.resetPassword);

module.exports = router;
