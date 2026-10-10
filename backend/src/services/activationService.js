import crypto from 'crypto';

import User from '../models/User.js';
import { sendMailWithin, isMailConfigured, SEND_TIMEOUT_MS } from '../config/mailer.js';
import { getAppUrl } from './authService.js';
import { SEND_COOLDOWN_SECONDS, cooldownError, secondsLeft } from './sendCooldown.js';
import { escapeHtml } from '../utils/escapeHtml.js';

/**
 * Activating an account somebody else created - a rider's, made by their seller.
 *
 * The seller's "add" sends a link. The rider opens it, chooses a password, and
 * the account is live; then they sign in on the app like anyone else. Opening
 * the link from the email is what proves the address is theirs, so there is no
 * code to type as well.
 *
 * Opening the page never activates anything. Mail scanners follow links to
 * check them, and a GET that changed the account would be spent by the scanner
 * before the rider ever saw it. Only submitting a password does.
 */

export const ACTIVATION_TTL_HOURS = 48;
export const RESEND_COOLDOWN_SECONDS = SEND_COOLDOWN_SECONDS;

/**
 * The link is the credential, so only its hash is stored. SHA-256 rather than
 * bcrypt: the token is 256 random bits, not something a person chose, and it
 * has to be looked up by its hash.
 */
export function hashActivationToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** "juan@gmail.com" -> "j***@gmail.com": enough to know which inbox to open. */
export function maskEmail(email = '') {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '';
  return `${local[0]}***@${domain}`;
}

function codedError(message, code, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function isActive(user) {
  return Boolean(user.passwordSet && user.emailVerified);
}

function isExpired(user) {
  return !user.activationTokenExpires || user.activationTokenExpires.getTime() <= Date.now();
}

async function findByToken(token) {
  const clean = typeof token === 'string' ? token.trim() : '';
  if (!clean) return null;

  return User.findOne({
    role: 'rider',
    activationTokenHash: hashActivationToken(clean),
  }).select('+password +activationTokenHash');
}

function activationEmail({ name, link }) {
  return {
    subject: 'Activate your AgriFair delivery account',
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;color:#16211b">
        <h2 style="color:#3f6b4c;margin:0 0 8px">Activate your delivery account</h2>
        <p style="margin:0 0 20px;color:#4c5b51">
          Hi ${name || 'there'}, your shop added you as a delivery person on
          AgriFair. Choose your password to finish setting up.
        </p>
        <p style="margin:0 0 20px;text-align:center">
          <a href="${link}"
             style="display:inline-block;background:#2f6b45;color:#fff;text-decoration:none;
                    font-weight:700;padding:14px 26px;border-radius:8px">
            Activate my account
          </a>
        </p>
        <p style="margin:0 0 6px;color:#4c5b51">
          The link works for ${ACTIVATION_TTL_HOURS} hours. If it has expired,
          open it anyway - the page can send you a new one.
        </p>
        <p style="margin:0 0 20px;color:#7c8b81;font-size:13px;word-break:break-all">
          Button not working? Copy this into your browser:<br/>${link}
        </p>
        <p style="margin:0;color:#7c8b81;font-size:13px">
          After that, sign in on the AgriFair app with this email and your new
          password. If you do not deliver for an AgriFair shop, ignore this email.
        </p>
      </div>
    `,
  };
}

export const activationService = {
  /**
   * Issues a fresh link and emails it.
   *
   * Overwriting the stored hash is what retires any earlier link, so only the
   * newest email ever works. The cooldown is checked here rather than per
   * caller: the seller's resend and the rider's own both cost an email.
   */
  async issue(user) {
    if (!isMailConfigured()) {
      throw new Error(
        'Email is not set up. Add BREVO_API_KEY (or the GMAIL_* or SMTP_* settings) to backend/.env, then restart the server.'
      );
    }

    const wait = secondsLeft(user.activationSentAt);
    if (wait > 0) {
      throw cooldownError(
        wait,
        `A link was just sent. Use that one, or wait ${wait} seconds to get a new one.`
      );
    }

    const previousSentAt = user.activationSentAt;
    const token = crypto.randomBytes(32).toString('base64url');

    user.activationTokenHash = hashActivationToken(token);
    user.activationTokenExpires = new Date(Date.now() + ACTIVATION_TTL_HOURS * 60 * 60 * 1000);
    user.activationSentAt = new Date();
    await user.save();

    const link = `${getAppUrl()}/activate?token=${token}`;
    const { subject, html } = activationEmail({ name: escapeHtml(user.name), link });

    // Saved before sending, so a second tap during the send already sees the
    // cooldown. Delivery is awaited like the codes: a failed send is reported,
    // and the cooldown is handed back so "Resend" works right away.
    try {
      await sendMailWithin(SEND_TIMEOUT_MS, { to: user.email, subject, html });
    } catch (err) {
      console.error(`[activation] could not deliver the link to ${user.email}:`, err.message);
      user.activationSentAt = previousSentAt;
      await user.save();
      throw new Error('We could not send the activation email right now. Please try again in a moment.');
    }

    return {
      sent: true,
      sentTo: maskEmail(user.email),
      retryAfter: RESEND_COOLDOWN_SECONDS,
    };
  },

  /**
   * What the page should show for this link. Never throws for a bad link -
   * every outcome is a state the page has a screen for.
   */
  async status(token) {
    const user = await findByToken(token);

    if (!user) return { state: 'invalid' };

    const who = { name: user.name, email: maskEmail(user.email) };

    if (isActive(user)) return { state: 'active', ...who };
    if (user.status === 'suspended') return { state: 'suspended', ...who };
    if (isExpired(user)) return { state: 'expired', ...who };

    return { state: 'valid', ...who };
  },

  /**
   * Sets the password the rider chose and opens the account.
   */
  async activate({ token, password }) {
    if (!password || password.length < 6) {
      throw new Error('Choose a password of at least 6 characters.');
    }

    const user = await findByToken(token);

    if (!user) {
      throw codedError(
        'This link is no longer valid. Use the newest email we sent, or ask your shop for a new link.',
        'ACTIVATION_INVALID'
      );
    }
    if (isActive(user)) {
      throw codedError('This account is already set up. Sign in on the AgriFair app.', 'ALREADY_ACTIVE');
    }
    if (user.status === 'suspended') {
      throw codedError('This account is suspended. Ask your shop about it.', 'ACCOUNT_SUSPENDED');
    }
    if (isExpired(user)) {
      throw codedError('This link has expired. Send yourself a new one.', 'ACTIVATION_EXPIRED');
    }

    // Plain text on purpose: the model's pre-save hook hashes it. Hashing here
    // as well stores a hash of a hash, and sign-in never matches.
    user.password = password;
    user.emailVerified = true;
    user.passwordSet = true;
    // The hash stays, so opening the same link again says "already set up"
    // rather than "not valid". It can no longer do anything: activation above
    // refuses an active account.
    user.activationTokenExpires = null;
    await user.save();

    return { message: 'Account ready. Sign in on the AgriFair app with your email and new password.' };
  },

  /**
   * The rider's own resend, from an expired link.
   *
   * Keyed on the token, not an email typed into the page, so the new link can
   * only ever go to the address already on the account - nobody holding an old
   * link can point it somewhere else.
   */
  async resendFromLink({ token }) {
    const user = await findByToken(token);

    if (!user) {
      throw codedError(
        'This link is no longer valid. Use the newest email we sent, or ask your shop for a new link.',
        'ACTIVATION_INVALID'
      );
    }
    if (isActive(user)) {
      throw codedError('This account is already set up. Sign in on the AgriFair app.', 'ALREADY_ACTIVE');
    }
    if (user.status === 'suspended') {
      throw codedError('This account is suspended. Ask your shop about it.', 'ACCOUNT_SUSPENDED');
    }

    return this.issue(user);
  },
};
