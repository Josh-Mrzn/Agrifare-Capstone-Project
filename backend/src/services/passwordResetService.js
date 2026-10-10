import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { authRepository } from '../repositories/authRepository.js';
import { updatePasswordByUserId } from '../repositories/userRepository.js';
import { sendMailWithin, SEND_TIMEOUT_MS } from '../config/mailer.js';
import { getAppUrl } from './authService.js';
import { otpService, normalizeEmail, OTP_PURPOSES } from './otpService.js';
import { claimSendSlot } from './sendCooldown.js';

const RESET_TOKEN_TTL = '15m';
const RESET_TOKEN_PURPOSE = 'password-reset';

const VERIFY_TOKEN_TTL = '24h';
const VERIFY_TOKEN_PURPOSE = 'verify-email';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

export const passwordResetService = {
  /**
   * Always resolves the same way whether or not the address exists. Telling a
   * caller "no such user" turns this endpoint into a way to harvest which
   * emails are registered.
   */
  async requestOtp({ email }) {
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) throw new Error('Email is required');

    const user = await authRepository.findByEmail(cleanEmail);
    if (!user) {
      // Same minute as a real account gets from otpService, so a repeated
      // request answers "wait" either way and says nothing about who exists.
      claimSendSlot(`reset:${cleanEmail}`);
      return { sent: false };
    }

    return otpService.issue({
      email: cleanEmail,
      purpose: OTP_PURPOSES.passwordReset,
      name: user.name,
    });
  },

  /**
   * Trades a correct code for a short-lived token. The password change itself
   * is a separate call, so the code never has to travel with the new password.
   */
  async verifyOtp({ email, code }) {
    const verified = await otpService.verify({
      email,
      code,
      purpose: OTP_PURPOSES.passwordReset,
    });

    const resetToken = jwt.sign(
      { purpose: RESET_TOKEN_PURPOSE, email: verified.email },
      getJwtSecret(),
      { expiresIn: RESET_TOKEN_TTL }
    );

    return { resetToken };
  },

  async resetPassword({ resetToken, newPassword }) {
    if (!resetToken || !newPassword) {
      throw new Error('Reset token and new password are required');
    }

    if (newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    let payload;
    try {
      payload = jwt.verify(resetToken, getJwtSecret());
    } catch {
      throw new Error('This reset link has expired. Start again.');
    }

    if (payload.purpose !== RESET_TOKEN_PURPOSE) {
      throw new Error('Invalid reset token');
    }

    const user = await authRepository.findByEmail(payload.email);
    if (!user) throw new Error('User not found');

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await updatePasswordByUserId(user.userId, hashedPassword);

    return { message: 'Password updated. You can sign in with your new password.' };
  }
};

export const emailVerificationService = {
  /**
   * The phone has a 6-digit screen, the web has a link. Sending the code only
   * to the client that can actually collect it keeps sellers - who sign up on
   * the web and are blocked from signing in until verified - on the flow their
   * UI already supports.
   */
  async sendSignupOtp(user) {
    return otpService.issue({
      email: user.email,
      purpose: OTP_PURPOSES.signup,
      name: user.name,
    });
  },

  async verifySignupOtp({ email, code }) {
    const verified = await otpService.verify({
      email,
      code,
      purpose: OTP_PURPOSES.signup,
    });

    const user = await authRepository.findByEmail(verified.email);
    if (!user) throw new Error('User not found');

    if (user.emailVerified) {
      return { message: 'This email is already verified. You can sign in.' };
    }

    user.emailVerified = true;
    await user.save();

    return { message: 'Email verified. You can sign in now.' };
  },

  /**
   * The web's way to prove an address: a signed link instead of a code, since
   * the sign-up page has no box to type six digits into.
   *
   * The token is a JWT rather than a stored value. It only ever says "this
   * address was reachable", so opening it twice, or after the account is
   * already verified, does no harm.
   */
  async sendSignupLink(user) {
    const token = jwt.sign(
      { purpose: VERIFY_TOKEN_PURPOSE, email: user.email },
      getJwtSecret(),
      { expiresIn: VERIFY_TOKEN_TTL }
    );
    const link = `${getAppUrl()}/login?verify=${encodeURIComponent(token)}`;

    await sendMailWithin(SEND_TIMEOUT_MS, {
      to: user.email,
      subject: 'Verify your AgriFair email',
      html: `
        <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;color:#16211b">
          <h2 style="color:#3f6b4c;margin:0 0 8px">Verify your AgriFair email</h2>
          <p style="margin:0 0 20px;color:#4c5b51">
            Hi ${user.name || 'there'}, confirm this address to finish setting up your seller account.
          </p>
          <p style="margin:0 0 20px;text-align:center">
            <a href="${link}"
               style="display:inline-block;background:#2f6b45;color:#fff;text-decoration:none;
                      font-weight:700;padding:14px 26px;border-radius:8px">
              Verify email
            </a>
          </p>
          <p style="margin:0 0 20px;color:#7c8b81;font-size:13px;word-break:break-all">
            Button not working? Copy this into your browser:<br/>${link}
          </p>
          <p style="margin:0;color:#7c8b81;font-size:13px">
            The link works for 24 hours. If you did not create an AgriFair account, ignore this email.
          </p>
        </div>
      `,
    });
  },

  async verifySignupLink({ token }) {
    let payload;
    try {
      payload = jwt.verify(String(token || ''), getJwtSecret());
    } catch {
      throw new Error('This verification link has expired. Sign in to get a new one.');
    }
    if (payload.purpose !== VERIFY_TOKEN_PURPOSE) {
      throw new Error('This is not a verification link.');
    }

    const user = await authRepository.findByEmail(payload.email);
    if (!user) throw new Error('User not found');

    if (!user.emailVerified) {
      user.emailVerified = true;
      await user.save();
    }

    return {
      message: user.role === 'seller' && user.status === 'pending'
        ? 'Email verified. A Super Admin will review your seller account before you can sign in.'
        : 'Email verified. You can sign in now.',
    };
  },
};
