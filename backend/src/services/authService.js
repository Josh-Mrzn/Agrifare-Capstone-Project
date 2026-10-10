import jwt from 'jsonwebtoken';
import { authRepository } from '../repositories/authRepository.js';
import { toNameKey, EMAIL_PATTERN } from '../models/User.js';
import LoginSession from '../models/LoginSession.js';
import { emailVerificationService } from './passwordResetService.js';
import { claimSendSlot } from './sendCooldown.js';

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');

  return jwt.sign(
    {
      userId: user.userId,
      email: user.email,
      role: user.role
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
}

function toUserResponse(user, extras = {}) {
  return {
    id: user.userId,

    // The same number under the name the rest of the API uses for it.
    //
    // `/user/me` returns the raw document, which calls it `userId`, so a client
    // that reads `user.userId` works after fetching the profile and silently
    // gets undefined after logging in. That undefined is how a seller ended up
    // being shown as their own chat partner: "the participant who is not me"
    // matched nobody, so the first one - themselves - was picked.
    userId: user.userId,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerified),
    ...extras
  };
}

export function getAppUrl() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

/** Emails are stored lower-cased and trimmed - normalise before every lookup. */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export const authService = {
  async register({ name, email, password, role: requestedRole }, requestMeta = {}) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = normalizeEmail(email);

    if (!cleanName || !cleanEmail || !password) {
      throw new Error('Name, email and password are required');
    }

    if (!EMAIL_PATTERN.test(cleanEmail)) {
      throw new Error('Please enter a valid email address');
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }

    // Buyers sign themselves up from the mobile app and start shopping right
    // away. Only sellers wait for Super Admin approval — a buyer has nothing to
    // approve, and leaving 'buyer' off this list silently turned every mobile
    // signup into a pending seller account.
    //
    // Super Admin is never self-service. It used to be on this list, so anyone
    // who posted { role: 'superadmin' } here got the whole platform - hiding the
    // option on the sign-up form would not have stopped that. Riders are added
    // by their seller. Both are refused outright rather than quietly turned into
    // a seller, so nobody believes they signed up as something they did not.
    if (requestedRole === 'superadmin' || requestedRole === 'rider') {
      throw new Error('That account type cannot be created by signing up.');
    }
    const allowedSelfRoles = ['buyer', 'seller'];
    const role = allowedSelfRoles.includes(requestedRole) ? requestedRole : 'seller';
    const status = role === 'seller' ? 'pending' : 'active';

    const existingUser = await authRepository.findByEmail(cleanEmail);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    const takenName = await authRepository.findByNameKey(toNameKey(cleanName));
    if (takenName) {
      throw new Error('That name is already taken. Please choose another one.');
    }

    let newUser;
    try {
      newUser = await authRepository.createUser({
        name: cleanName,
        email: cleanEmail,
        password,
        role,
        status,
        emailVerified: false,
      });
    } catch (err) {
      if (err.code === 11000) {
        throw new Error('User with this email already exists');
      }
      console.error('Mongo createUser failed:', err.message);
      throw new Error(err.message || 'Could not save your account. Please try again.');
    }

    // The mobile app collects six digits; the web opens a link. Send whichever
    // the caller can actually complete — a link is a dead end on a phone, and a
    // code is a dead end on a web page with no box to type it into.
    const wantsOtp = requestMeta.client === 'mobile';

    try {
      if (wantsOtp) {
        await emailVerificationService.sendSignupOtp(newUser);
      } else {
        await emailVerificationService.sendSignupLink(newUser);
      }
    } catch (err) {
      console.error('Verification email failed:', err.message);
      // Account exists — ask user to resend from the UI
      return {
        ...toUserResponse(newUser),
        verificationMethod: wantsOtp ? 'otp' : 'link',
        verificationEmailSent: false,
        verificationError: err.message
      };
    }

    return {
      ...toUserResponse(newUser),
      verificationMethod: wantsOtp ? 'otp' : 'link',
      verificationEmailSent: true
    };
  },

  async resendVerification({ email }, requestMeta = {}) {
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) throw new Error('Email is required');

    const user = await authRepository.findByEmail(cleanEmail);
    // A rider who has not activated gets a link, not a code - a code here would
    // land in their inbox with nowhere to type it.
    if (!user || user.passwordSet === false) {
      // Do not leak whether the email exists - including through the resend
      // cooldown, which a real account would hit on its second request.
      claimSendSlot(`signup:${cleanEmail}`);
      return { sent: true };
    }

    if (user.emailVerified) {
      throw new Error('This email is already verified. You can sign in.');
    }

    if (requestMeta.client === 'mobile') {
      // The minute between codes is enforced where the code is issued.
      await emailVerificationService.sendSignupOtp(user);
      return { sent: true, verificationMethod: 'otp' };
    }

    // The link keeps no record here to time it against, so the minute is held
    // in memory like the codes for unknown addresses.
    claimSendSlot(`verify-link:${cleanEmail}`);
    await emailVerificationService.sendSignupLink(user);
    return { sent: true, verificationMethod: 'link' };
  },

  async login({ email, password }, requestMeta = {}) {
    const client = requestMeta.client === 'mobile' ? 'mobile' : 'web';
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail || !password) {
      throw new Error('Email and password are required');
    }

    const user = await authRepository.findByEmail(cleanEmail);

    // An account somebody else created and its owner has not finished. The
    // stored password is random and nobody knows it, so any attempt would come
    // back "Invalid credentials" - true, and useless. Say what to do instead.
    if (user && user.passwordSet === false) {
      const err = new Error(
        'This account has not been set up yet. Open the activation link emailed '
        + 'to you to choose a password.'
      );
      err.code = 'ACCOUNT_NOT_ACTIVATED';
      err.status = 403;
      throw err;
    }

    // The same answer for a missing account and a wrong password, so this
    // cannot be used to find out which emails are registered.
    if (!user || !(await user.comparePassword(password))) {
      throw new Error('Invalid credentials');
    }

    // Nobody signs in on an unconfirmed address - buyers included. An account
    // whose email was never proven can be someone else's address typed by
    // mistake, and it is the address every reset code is later sent to.
    if (!user.emailVerified) {
      const err = new Error(
        client === 'mobile'
          ? 'Please verify your email first. Enter the 6-digit code we sent you.'
          : 'Please verify your email before signing in. Open the AgriFair verification link we emailed you.'
      );
      // A flag the client can act on. Matching the sentence above would break
      // the moment the wording changes.
      err.code = 'EMAIL_NOT_VERIFIED';
      err.email = user.email;
      throw err;
    }

    if (user.status === 'suspended') {
      const err = new Error('Your account has been suspended. Contact AgriFair support.');
      err.code = 'ACCOUNT_SUSPENDED';
      throw err;
    }

    if (user.status === 'rejected') {
      throw new Error(
        `Your seller application was not approved${user.statusReason ? `: ${user.statusReason}` : '.'}`
      );
    }

    if (user.role === 'seller' && user.status === 'pending') {
      throw new Error('Your seller account is pending Super Admin approval.');
    }

    // Buyers belong in the mobile app; the web portal is for sellers and super
    // admins. This used to reject buyers everywhere, which left them unable to
    // sign in at all once the app existed.
    if (user.role === 'buyer' && client !== 'mobile') {
      throw new Error('Buyer accounts use the AgriFair mobile app. Web access is for sellers and super admins.');
    }

    // Audit bookkeeping must never block a valid sign-in.
    try {
      await authRepository.updateLastLogin(user.userId);
      await LoginSession.create({
        userId: user._id,
        ipAddress: requestMeta.ipAddress || '',
        userAgent: requestMeta.userAgent || '',
      });
    } catch (err) {
      console.error('Could not record login session:', err.message);
    }

    const token = signToken(user);

    return {
      token,
      user: toUserResponse(user)
    };
  },

  getAuthCookieOptions(maxAgeMs = 24 * 60 * 60 * 1000) {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: maxAgeMs,
      path: '/'
    };
  },

  getLogoutCookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/'
    };
  }
};
