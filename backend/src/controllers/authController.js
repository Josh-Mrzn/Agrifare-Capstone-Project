import { authService } from '../services/authService.js';
import { passwordResetService, emailVerificationService } from '../services/passwordResetService.js';
import { activationService } from '../services/activationService.js';

/** Never let the client fall back to a bare "Login failed" - always send real text. */
function fail(res, status, err, fallback) {
  console.error(`[auth] ${fallback}:`, err);
  return res.status(status).json({
    success: false,
    message: err?.message || fallback,
    // Only set for failures a client should handle rather than just display -
    // an unverified email sends the app to the code screen, not to an alert.
    ...(err?.code ? { code: err.code } : {}),
    ...(err?.email ? { email: err.email } : {}),
    ...(err?.retryAfter ? { retryAfter: err.retryAfter } : {})
  });
}

/** Asking again inside the one-minute wait is "too many requests", not bad input. */
const statusFor = (err) => (err?.code === 'RESEND_COOLDOWN' ? 429 : 400);

export const register = async (req, res) => {
  try {
    const user = await authService.register(req.body, { client: req.headers['x-client'] });

    res.status(201).json({
      success: true,
      message: user.verificationEmailSent
        ? 'Account created. Check your email for the verification link.'
        : 'Account created, but the verification email could not be sent. Use Resend.',
      user
    });
  } catch (err) {
    // A taken name is the same class of failure as a taken email: the request
    // conflicts with something already there, not malformed input.
    const isDuplicate = /already (exists|taken)/i.test(err?.message || '');
    return fail(res, isDuplicate ? 409 : 400, err, 'Registration failed');
  }
};

export const resendVerification = async (req, res) => {
  try {
    const result = await authService.resendVerification(req.body, { client: req.headers['x-client'] });
    return res.status(200).json({
      success: true,
      message: 'If that account exists, a verification email was sent.',
      ...result
    });
  } catch (err) {
    return fail(res, statusFor(err), err, 'Could not resend verification email');
  }
};

export const login = async (req, res) => {
  let result;

  try {
    result = await authService.login(req.body, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      client: req.headers['x-client'],
    });
  } catch (err) {
    return fail(res, 401, err, 'Login failed');
  }

  res.cookie('accessToken', result.token, authService.getAuthCookieOptions());

  return res.status(200).json({
    success: true,
    message: 'Login successful',
    token: result.token,
    user: result.user
  });
};

export const logout = (req, res) => {
  res.cookie('accessToken', '', authService.getLogoutCookieOptions());

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

export const forgotPassword = async (req, res) => {
  try {
    await passwordResetService.requestOtp(req.body);
  } catch (err) {
    // Config and rate-limit problems are real failures the caller must see.
    // A missing account is not - that answer would leak who is registered.
    return fail(res, statusFor(err), err, 'Could not send the reset code');
  }

  return res.status(200).json({
    success: true,
    message: 'If that account exists, a 6-digit code is on its way to that email.'
  });
};

export const verifyResetOtp = async (req, res) => {
  try {
    const result = await passwordResetService.verifyOtp(req.body);
    return res.status(200).json({
      success: true,
      message: 'Code accepted. You can set a new password now.',
      ...result
    });
  } catch (err) {
    return fail(res, 400, err, 'Could not verify that code');
  }
};

export const resetPassword = async (req, res) => {
  try {
    const result = await passwordResetService.resetPassword(req.body);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return fail(res, 400, err, 'Could not reset the password');
  }
};

/** The web's verification link, opened on the sign-in page and posted here. */
export const verifyEmailLink = async (req, res) => {
  try {
    const result = await emailVerificationService.verifySignupLink(req.body || {});
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return fail(res, 400, err, 'Could not verify this email');
  }
};

export const verifyEmailOtp = async (req, res) => {
  try {
    const result = await emailVerificationService.verifySignupOtp(req.body);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return fail(res, 400, err, 'Could not verify that code');
  }
};

/**
 * What an activation link is: valid, expired, already used, or not a link at
 * all. Posted rather than read from the query string, so the token does not
 * end up in request logs.
 */
export const activationStatus = async (req, res) => {
  try {
    const result = await activationService.status(req.body?.token);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return fail(res, 400, err, 'Could not check this link');
  }
};

/**
 * Finishes an account created by somebody else - a rider's, made by their
 * seller. The link proved the address; this sets the password they chose.
 */
export const activateAccount = async (req, res) => {
  try {
    const result = await activationService.activate(req.body || {});
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return fail(res, 400, err, 'Could not set up this account');
  }
};

/** A new link, from an expired one, to the address already on the account. */
export const resendActivation = async (req, res) => {
  try {
    const result = await activationService.resendFromLink(req.body || {});
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return fail(res, statusFor(err), err, 'Could not send a new link');
  }
};
