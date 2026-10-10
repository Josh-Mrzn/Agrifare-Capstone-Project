import bcrypt from 'bcryptjs';
import {
  findUserByUserId,
  findUserByUserIdSafe,
  updateUserByUserId,
  updatePasswordByUserId
} from '../repositories/userRepository.js';
import LoginSession from '../models/LoginSession.js';
import { authRepository } from '../repositories/authRepository.js';
import { toNameKey } from '../models/User.js';

// ====================== GET CURRENT USER ======================
export const getMeService = async (userId) => {
  return await findUserByUserIdSafe(userId);
};

// ====================== UPDATE PROFILE ======================
const FLAT_FIELDS = ['name', 'contact', 'bio', 'pickupAddress', 'deliveryOrigin', 'theme', 'sellerType'];

// Numbers, not text - the pickup point a rider navigates to. Handled apart
// from FLAT_FIELDS because an empty string is a valid name and a nonsense
// coordinate.
const COORDINATE_FIELDS = { pickupLat: 90, pickupLng: 180 };

export const updateProfileService = async (userId, updateData, uploadedFiles = {}) => {
  const filteredData = {};
  for (const key of FLAT_FIELDS) {
    if (updateData[key] !== undefined) {
      filteredData[key] = updateData[key];
    }
  }

  for (const [key, limit] of Object.entries(COORDINATE_FIELDS)) {
    if (updateData[key] === undefined) continue;

    const n = Number(updateData[key]);
    if (!Number.isFinite(n) || n < -limit || n > limit) {
      throw new Error(`${key} is not a valid coordinate.`);
    }
    filteredData[key] = n;
  }

  if (updateData.deliveryFee !== undefined) {
    const fee = Number(updateData.deliveryFee);
    if (!Number.isFinite(fee) || fee < 0 || fee > 5000) {
      throw new Error('Delivery fee must be between ₱0 and ₱5,000.');
    }
    filteredData.deliveryFee = Math.round(fee);
  }

  // The email is not editable here: it is the verified address every reset
  // code goes to, and changing it would skip that verification.
  //
  // Names are unique across users. The write below goes through
  // findOneAndUpdate, which skips the pre-save hook, so nameKey is derived
  // here instead of being left stale.
  if (filteredData.name !== undefined) {
    const cleanName = String(filteredData.name).trim();
    if (!cleanName) throw new Error('Name cannot be empty');

    const nameKey = toNameKey(cleanName);
    if (await authRepository.findByNameKey(nameKey, userId)) {
      throw new Error('That name is already taken. Please choose another one.');
    }

    filteredData.name = cleanName;
    filteredData.nameKey = nameKey;
  }

  if (updateData.sellerProfile) {
    let incoming = updateData.sellerProfile;
    if (typeof incoming === 'string') {
      try { incoming = JSON.parse(incoming); } catch { incoming = {}; }
    }
    const current = await findUserByUserId(userId);
    filteredData.sellerProfile = { ...(current?.sellerProfile?.toObject?.() || current?.sellerProfile || {}), ...incoming };
    if (uploadedFiles.farmPhotos?.length) {
      const newPhotos = uploadedFiles.farmPhotos.map((f) => `/uploads/media/${f.filename}`);
      const existing = filteredData.sellerProfile.farmPhotos || [];
      filteredData.sellerProfile.farmPhotos = [...existing, ...newPhotos].slice(0, 5);
    }
  }

  if (updateData.notificationPrefs) {
    let incoming = updateData.notificationPrefs;
    if (typeof incoming === 'string') {
      try { incoming = JSON.parse(incoming); } catch { incoming = {}; }
    }
    const current = await findUserByUserId(userId);
    filteredData.notificationPrefs = { ...(current?.notificationPrefs?.toObject?.() || current?.notificationPrefs || {}), ...incoming };
  }

  if (uploadedFiles.avatar?.[0]) {
    filteredData.avatarUrl = `/uploads/media/${uploadedFiles.avatar[0].filename}`;
  }

  // --- Payout (GCash QR) ---
  // Any edit resets the record to `pending`: a verified QR that silently changes
  // would send buyers' money somewhere a Super Admin never checked.
  if (updateData.payout || uploadedFiles.paymentQr?.[0]) {
    let incoming = updateData.payout || {};
    if (typeof incoming === 'string') {
      try { incoming = JSON.parse(incoming); } catch { incoming = {}; }
    }

    const current = await findUserByUserId(userId);
    const existing = current?.payout?.toObject?.() || current?.payout || {};

    const next = {
      ...existing,
      ...incoming,
      status: 'pending',
      rejectionReason: '',
      submittedAt: new Date(),
      verifiedAt: null,
      verifiedBy: null,
    };

    if (uploadedFiles.paymentQr?.[0]) {
      next.qrImage = `/api/files/${uploadedFiles.paymentQr[0].filename}`;
    }

    if (!next.qrImage && !next.accountNumber) {
      throw new Error('Add a GCash number or upload a QR code before saving payout details.');
    }
    if (!next.accountName) {
      throw new Error('Account name is required so buyers can confirm they are paying the right person.');
    }

    filteredData.payout = next;
  }

  // --- Compliance documents ---
  if (uploadedFiles.document?.[0]) {
    const meta = typeof updateData.documentMeta === 'string'
      ? JSON.parse(updateData.documentMeta || '{}')
      : (updateData.documentMeta || {});

    if (!meta.type) throw new Error('Choose which document you are uploading.');

    const current = await findUserByUserId(userId);
    const existing = (current?.documents || []).map((d) => d.toObject?.() || d);

    filteredData.documents = [
      // One live document per type: a re-upload replaces the old one.
      ...existing.filter((d) => d.type !== meta.type),
      {
        type: meta.type,
        file: `/api/files/${uploadedFiles.document[0].filename}`,
        label: meta.label || '',
        referenceNo: meta.referenceNo || '',
        status: 'pending',
        rejectionReason: '',
        uploadedAt: new Date(),
      },
    ];
  }

  if (Object.keys(filteredData).length === 0) {
    throw new Error('No valid fields to update');
  }

  const user = await updateUserByUserId(userId, filteredData);

  if (!user) throw new Error('User not found');

  return user;
};

// ====================== UPDATE PASSWORD ======================
export const updatePasswordService = async (
  userId,
  currentPassword,
  newPassword
) => {
  if (!currentPassword || !newPassword) {
    throw new Error('Both passwords are required');
  }

  if (newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const user = await findUserByUserId(userId);

  if (!user) throw new Error('User not found');
  if (!user.password) {
    throw new Error('This account has no password to change here.');
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password);

  if (!isMatch) {
    throw new Error('Current password is incorrect');
  }

  if (currentPassword === newPassword) {
    throw new Error('New password must be different');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await updatePasswordByUserId(userId, hashedPassword);

  return { message: 'Password updated successfully' };
};

// ====================== LOGIN HISTORY ======================
export const getLoginHistoryService = async (userId) => {
  const user = await findUserByUserId(userId);
  if (!user) throw new Error('User not found');

  return await LoginSession.find({ userId: user._id }).sort({ loggedInAt: -1 }).limit(20);
};