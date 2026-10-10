import express from 'express';
import { otpRequestLimiter, otpSubmitLimiter } from '../middleware/rateLimiter.js';
import {
  register,
  login,
  logout,
  resendVerification,
  verifyEmailOtp,
  verifyEmailLink,
  activationStatus,
  activateAccount,
  resendActivation,
  forgotPassword,
  verifyResetOtp,
  resetPassword
} from '../controllers/authController.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);

// Asking for a code sends mail; submitting one does not. They are limited
// separately so a person working through a normal flow - request, mistype,
// retype, finish - never runs out partway.
router.post('/resend-verification', otpRequestLimiter, resendVerification);
router.post('/forgot-password', otpRequestLimiter, forgotPassword);

router.post('/verify-email-otp', otpSubmitLimiter, verifyEmailOtp);
router.post('/verify-email', otpSubmitLimiter, verifyEmailLink);
// A delivery person setting up the account their shop made for them, from the
// emailed link. Checking the link and submitting the password are cheap;
// asking for a new link sends mail, so it shares the request budget.
router.post('/activate/status', otpSubmitLimiter, activationStatus);
router.post('/activate', otpSubmitLimiter, activateAccount);
router.post('/activate/resend', otpRequestLimiter, resendActivation);
router.post('/verify-reset-otp', otpSubmitLimiter, verifyResetOtp);
router.post('/reset-password', otpSubmitLimiter, resetPassword);

export default router;
