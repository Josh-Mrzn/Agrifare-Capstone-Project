import jwt from 'jsonwebtoken';
import User from '../models/User.js';

function attachUser(req, payload, role) {
  req.user = {
    id: payload.userId,
    userId: payload.userId,
    email: payload.email,
    // From the account, not the token: a demotion takes effect on the next
    // request instead of when a day-old token finally expires.
    role,
  };
}

/**
 * The same answer for a session whose account was suspended after sign-in.
 *
 * 401 rather than 403: the session is over, not merely short of permission,
 * and 401 is what already sends the app back to sign-in and the web to its
 * login page. The code lets either say why.
 */
function refuseSuspended(res) {
  return res.status(401).json({
    success: false,
    code: 'ACCOUNT_SUSPENDED',
    message: 'Your account has been suspended. Contact AgriFair support.',
  });
}

function extractBearer(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

export const protect = async (req, res, next) => {
  const token = extractBearer(req) || req.cookies?.accessToken;

  if (!token) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }

  // The token says who, not whether they are still allowed in. A day-long
  // token issued before a suspension would otherwise keep working until it
  // expired, so the account is read on every request.
  let account;
  try {
    account = await User.findOne({ userId: decoded.userId })
      .select('status role passwordChangedAt')
      .lean();
  } catch (err) {
    return next(err);
  }

  if (!account) {
    return res.status(401).json({ message: 'User not found' });
  }
  if (account.status === 'suspended') {
    return refuseSuspended(res);
  }
  // A token from before a password reset belongs to the old password.
  if (account.passwordChangedAt
    && decoded.iat < Math.floor(new Date(account.passwordChangedAt).getTime() / 1000)) {
    return res.status(401).json({ message: 'Your password was changed. Sign in again.' });
  }

  attachUser(req, decoded, account.role);
  return next();
};

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `User role ${req.user?.role} is not authorized to access this route`
      });
    }
    next();
  };
};
