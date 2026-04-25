const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authMiddleware } = require('../middleware/auth');

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
router.get('/me', authMiddleware, authController.getMe);
router.post('/logout', authMiddleware, authController.logout);
router.post('/change-password', authLimiter, authMiddleware, authController.changePassword);
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.get('/reset-password', authController.getResetPasswordPage);
router.post('/reset-password', authLimiter, authController.resetPassword);

module.exports = router;
