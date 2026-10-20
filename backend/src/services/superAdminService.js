import * as SuperAdminRepo from '../repositories/superAdminRepository.js';
import bcrypt from 'bcryptjs';
import { toNameKey } from '../models/User.js';
import { authRepository } from '../repositories/authRepository.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { notify, links } from './notify.js';

export const getAllUsers = async () => {
  return await SuperAdminRepo.findAllUsers();
};

// --- SUSPEND USER ---
export const suspendUser = async (idFromUrl, adminId) => {
  const target = await SuperAdminRepo.findUserById(idFromUrl);
  if (!target) throw new Error("User not found");
  if (target.userId === adminId) throw new Error('You cannot suspend your own account.');
  if (target.role === 'superadmin') throw new Error('A Super Admin account cannot be suspended here.');
  const user = await SuperAdminRepo.updateUser(idFromUrl, { status: 'suspended' });

  await SuperAdminRepo.createAuditLog({
    adminId, 
    action: 'SUSPEND_USER',
    targetId: user.userId,
    targetEmail: user.email,
    targetName: user.name || '',
    targetRole: user.role || '',
    details: `User ${user.email} (ID: ${user.userId}) suspended`
  });
  return user;
};

// --- ACTIVATE / UNSUSPEND USER ---
/**
 * Lifts a suspension or a deactivation. Not a way round seller approval: a
 * pending or rejected application goes through approveAdmin.
 */
export const activateUser = async (idFromUrl, adminId) => {
  const target = await SuperAdminRepo.findUserById(idFromUrl);
  if (!target) throw new Error("User not found");
  if (!['suspended', 'deactivated'].includes(target.status)) {
    throw new Error(target.status === 'active'
      ? 'This account is already active.'
      : 'Review the seller application to approve this account.');
  }
  const user = await SuperAdminRepo.updateUser(idFromUrl, { status: 'active', deactivatedAt: null });

  await SuperAdminRepo.createAuditLog({
    adminId,
    action: 'ACTIVATE_USER',
    targetId: user.userId,
    targetEmail: user.email,
    targetName: user.name || '',
    targetRole: user.role || '',
    details: `User ${user.email} (ID: ${user.userId}) activated`
  });
  return user;
};

// --- DEACTIVATE ("DELETE") USER ---
/**
 * Closes an account instead of erasing it. Orders, reviews, chat threads and
 * audit entries refer to people by userId, and a hard delete left them
 * pointing at nobody - or, since ids were reused, at somebody else. The
 * account is signed out, cannot sign in, and a seller's shop disappears from
 * the storefront; a Super Admin can reactivate it.
 */
export const deleteUser = async (idFromUrl, adminId) => {
  const user = await SuperAdminRepo.findUserById(idFromUrl);
  if (!user) throw new Error("User not found");
  if (user.userId === adminId) throw new Error('You cannot deactivate your own account.');
  if (user.role === 'superadmin') {
    const others = await User.countDocuments({ role: 'superadmin', status: 'active', userId: { $ne: user.userId } });
    if (!others) throw new Error('This is the last active Super Admin and cannot be deactivated.');
  }
  if (user.status === 'deactivated') return { message: 'This account is already deactivated.' };

  // Work in flight is not abandoned silently: an order that is on the road
  // still needs someone to finish it.
  if (user.role === 'seller') {
    const open = await Order.countDocuments({ sellerId: user.userId, status: { $in: ['confirmed', 'processing', 'shipped'] } });
    if (open) throw new Error(`This seller has ${open} order line(s) in progress. Suspend them instead, or wait until those are finished.`);
  }
  if (user.role === 'rider') {
    const open = await Order.countDocuments({ 'delivery.riderUserId': user.userId, status: { $in: ['confirmed', 'processing', 'shipped'] } });
    if (open) throw new Error(`This delivery person has ${open} delivery line(s) assigned. Ask the seller to reassign them first.`);
  }

  await SuperAdminRepo.updateUser(idFromUrl, {
    status: 'deactivated',
    deactivatedAt: new Date(),
    // Every token issued before now stops working on the next request.
    passwordChangedAt: new Date(),
  });

  await SuperAdminRepo.createAuditLog({
    adminId,
    action: 'DEACTIVATE_USER',
    targetId: user.userId,
    targetEmail: user.email,
    targetName: user.name || '',
    targetRole: user.role || '',
    details: `User ${user.email} (ID: ${user.userId}) deactivated`
  });
  return { message: 'Account deactivated. Its orders and history are kept.' };
};

// --- CREATE USER ---
export const createUser = async (userData, adminId) => {
  const name = String(userData?.name || '').trim();
  const email = String(userData?.email || '').trim().toLowerCase();
  const password = String(userData?.password || '');

  if (!name || !email) throw new Error('Name and email are required.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');

  // Only the fields the form has. Spreading the body let a request set
  // anything on the account - verification flags, payout status, employer.
  let newUser;
  try {
    // authRepository picks the next userId and retries if a signup took it
    // at the same moment, instead of loading every user to find the highest.
    newUser = await authRepository.createUser({
      name,
      email,
      password,
      role: ['buyer', 'seller', 'rider', 'superadmin'].includes(userData?.role) ? userData.role : 'buyer',
      contact: String(userData?.contact || '').trim(),
      status: 'active',
      // A Super Admin typed this address in for someone they know, so there is
      // no link to click. Sign-in checks this flag for every account.
      emailVerified: true,
    });
  } catch (err) {
    if (err?.code === 11000 && 'email' in (err.keyPattern || {})) {
      throw new Error('Somebody already uses that email.');
    }
    throw err;
  }
  const nextId = newUser.userId;
  newUser = newUser.toObject();
  delete newUser.password;

  await SuperAdminRepo.createAuditLog({
    adminId, 
    action: 'CREATE_USER',
    targetId: newUser.userId,
    targetEmail: newUser.email,
    targetName: newUser.name || '',
    targetRole: newUser.role || '',
    details: `User ${newUser.email} created with ID ${nextId}`
  });

  return newUser;
};

// --- UPDATE USER ---
/** What a Super Admin may change on an account from the edit form. */
const EDITABLE = ['name', 'email', 'role', 'status'];

export const updateUser = async (idFromUrl, updateData, adminId) => {
  const changes = {};
  for (const key of EDITABLE) {
    if (updateData[key] !== undefined) changes[key] = updateData[key];
  }
  if (changes.email !== undefined) changes.email = String(changes.email).trim().toLowerCase();
  if (changes.name !== undefined) {
    changes.name = String(changes.name).trim();
    changes.nameKey = toNameKey(changes.name);
  }

  // findOneAndUpdate skips the model's pre-save hook, so a password set here
  // has to be hashed here. Storing it as typed would both expose it and make
  // it impossible to sign in with.
  if (updateData.password) {
    if (String(updateData.password).length < 6) throw new Error('Password must be at least 6 characters.');
    changes.password = await bcrypt.hash(String(updateData.password), 12);
    changes.passwordChangedAt = new Date();
  }

  const current = await SuperAdminRepo.findUserById(idFromUrl);
  if (!current) throw new Error("User not found");
  // Status has its own buttons, each with its own checks (approval needs a
  // verified permit, deactivation keeps the history). The edit form must not
  // be a way round them.
  if (changes.status !== undefined && changes.status !== current.status) {
    throw new Error('Use Approve, Suspend, Activate or Deactivate to change an account\'s status.');
  }
  delete changes.status;
  if (changes.role !== undefined && changes.role !== current.role) {
    if (current.userId === adminId) throw new Error('You cannot change your own role.');
    if (!['buyer', 'seller', 'rider', 'superadmin'].includes(changes.role)) throw new Error('Unknown role.');
  }

  const user = await SuperAdminRepo.updateUser(idFromUrl, changes);
  if (!user) throw new Error("User not found");

  await SuperAdminRepo.createAuditLog({
    adminId, 
    action: 'UPDATE_USER',
    targetId: user.userId,
    targetEmail: user.email,
    targetName: user.name || '',
    targetRole: user.role || '',
    details: `Updated details for ${user.email}`
  });

  return user;
};

// --- ADMIN APPROVALS ---
/**
 * Approves a seller application: a seller, pending, who submitted it, with at
 * least one permit a Super Admin has verified. GCash payout is not needed to
 * open the shop - without it the shop takes cash and online payment only.
 */
export const approveAdmin = async (idFromUrl, superAdminId) => {
  const existing = await SuperAdminRepo.findUserById(idFromUrl);
  if (!existing) throw new Error("User not found");
  if (existing.role !== 'seller' || existing.status !== 'pending') {
    throw new Error('Only a pending seller application can be approved.');
  }
  if (!existing.application?.submittedAt) {
    throw new Error('This seller has not submitted their application yet.');
  }
  if (!(existing.documents || []).some((d) => d.status === 'verified')) {
    throw new Error('Verify at least one business permit before approving.');
  }

  const now = new Date();
  const user = await SuperAdminRepo.updateUser(idFromUrl, {
    status: 'active',
    statusReason: '',
    'application.decidedAt': now,
    'application.decidedBy': superAdminId,
  });

  await SuperAdminRepo.createAuditLog({
    adminId: superAdminId,
    action: 'APPROVE_SELLER',
    targetId: user.userId,
    targetEmail: user.email,
    targetName: user.name || '',
    targetRole: user.role || '',
    details: `User ${user.email} moved from pending to active`
  });

  await notify({
    userId: user.userId,
    type: 'SYSTEM',
    title: 'Your shop is approved',
    body: 'You can now list rice and take orders.',
    link: links.sellerAccount(),
  });

  return user;
};

/**
 * Turns a seller application down. The account stays, so the decision and
 * its reason are on record and the person is told why when they sign in.
 */
export const rejectSeller = async (idFromUrl, superAdminId, reason) => {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new Error('Give a reason. The seller sees it when they try to sign in.');

  const existing = await SuperAdminRepo.findUserById(idFromUrl);
  if (!existing) throw new Error('User not found');
  if (existing.role !== 'seller' || existing.status !== 'pending') {
    throw new Error('Only a pending seller application can be rejected.');
  }

  if (!existing.application?.submittedAt) {
    throw new Error('This seller has not submitted their application yet.');
  }

  const user = await SuperAdminRepo.updateUser(idFromUrl, {
    status: 'rejected',
    statusReason: cleanReason,
    'application.decidedAt': new Date(),
    'application.decidedBy': superAdminId,
  });

  await SuperAdminRepo.createAuditLog({
    adminId: superAdminId,
    action: 'REJECT_SELLER',
    targetId: user.userId,
    targetEmail: user.email,
    targetName: user.name || '',
    targetRole: user.role || '',
    details: `Seller application rejected: ${cleanReason}`,
  });

  await notify({
    userId: user.userId,
    type: 'SYSTEM',
    title: 'Your seller application needs changes',
    body: `${cleanReason} Update your details and submit it again.`,
    link: links.sellerAccount(),
  });

  return user;
};

export const getPendingApprovals = async () => {
  return await SuperAdminRepo.findPendingApprovals();
};

// --- AUDIT LOGS ---
export const getAuditLogs = async (query) => {
  const { logs, total, page, totalPages } = await SuperAdminRepo.findAuditLogs(query);

  const ids = [...new Set(logs.flatMap((l) => [l.adminId, l.targetId]))];
  const users = await SuperAdminRepo.findUsersByUserIds(ids);
  const userById = new Map(users.map((u) => [u.userId, u]));
  const nameById = new Map(users.map((u) => [u.userId, u.name || u.email]));

  // Logs written before targetEmail existed still carry the address inside the
  // free-text details, so recover it rather than showing a bare "#4".
  const emailFromDetails = (text = '') => {
    const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return match ? match[0] : '';
  };

  const enriched = logs.map((l) => {
    const targetEmail = l.targetEmail || emailFromDetails(l.details);
    const live = userById.get(l.targetId);

    // userIds are recycled after a delete (getNextUserId is max+1), so the account
    // sitting on this id today may be a different person than the one this entry
    // is about. Only trust the live record when its email matches what was logged.
    const isSameAccount = Boolean(live) && (!targetEmail || live.email === targetEmail);

    const targetName = isSameAccount
      ? live.name || live.email
      : l.targetName || targetEmail || `#${l.targetId}`;

    return {
      id: l._id,
      action: l.action,
      details: l.details,
      createdAt: l.createdAt,
      adminId: l.adminId,
      adminName: nameById.get(l.adminId) || `Admin #${l.adminId}`,
      targetId: l.targetId,
      targetName,
      targetEmail,
      targetRole: l.targetRole || '',
      // The account this entry refers to is no longer in the directory.
      targetDeleted: !isSameAccount,
    };
  });

  return { logs: enriched, total, page, totalPages };
};

// --- SELLER CREDENTIAL REVIEW ---
/**
 * Approves or rejects one uploaded document, or the seller's payout details.
 * Reviewing is the only time the image is looked at; afterwards the apps show a
 * badge instead, so the credential is never on screen to be copied.
 */
export const reviewSellerCredential = async (idFromUrl, superAdminId, { kind, docType, approve, reason }) => {
  const user = await SuperAdminRepo.findUserById(idFromUrl);
  if (!user) throw new Error('User not found');

  const decision = approve ? 'verified' : 'rejected';
  if (!approve && !reason?.trim()) {
    throw new Error('Give a reason so the seller knows what to fix.');
  }

  if (kind === 'payout') {
    if (!user.payout?.submittedAt) throw new Error('This seller has not submitted payout details.');
    user.payout.status = decision;
    user.payout.rejectionReason = approve ? '' : reason.trim();
    user.payout.verifiedAt = approve ? new Date() : null;
    user.payout.verifiedBy = approve ? superAdminId : null;
  } else if (kind === 'document') {
    const doc = (user.documents || []).find((d) => d.type === docType);
    if (!doc) throw new Error('That document was not uploaded.');
    doc.status = decision;
    doc.rejectionReason = approve ? '' : reason.trim();
    doc.reviewedAt = new Date();
    doc.reviewedBy = superAdminId;
  } else {
    throw new Error('Unknown credential type');
  }

  await user.save();

  await SuperAdminRepo.createAuditLog({
    adminId: superAdminId,
    action: approve ? 'VERIFY_CREDENTIAL' : 'REJECT_CREDENTIAL',
    targetId: user.userId,
    targetEmail: user.email,
    targetName: user.name || '',
    targetRole: user.role || '',
    details: `${kind === 'payout' ? 'Payout details' : docType} ${decision} for ${user.email}`,
  });

  return user;
};

/**
 * Every seller who has submitted something, whatever was decided about it.
 *
 * Not only the ones still waiting: a decision that vanishes the moment it is
 * made leaves nobody able to check what was approved, or to take an approval
 * back when a QR turns out to be somebody else's. The panel sorts the ones
 * needing a decision to the top.
 */
export const getSellerCredentials = async () => {
  const users = await SuperAdminRepo.findAllUsers();

  return users
    .filter((u) => u.role === 'seller')
    .map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      status: u.status,
      sellerType: u.sellerType || '',
      payout: u.payout?.submittedAt ? {
        status: u.payout.status,
        method: u.payout.method,
        accountName: u.payout.accountName,
        accountNumber: u.payout.accountNumber,
        qrImage: u.payout.qrImage,
        submittedAt: u.payout.submittedAt,
      } : null,
      documents: (u.documents || []).map((d) => ({
        type: d.type,
        file: d.file,
        label: d.label,
        referenceNo: d.referenceNo,
        status: d.status,
        rejectionReason: d.rejectionReason,
        uploadedAt: d.uploadedAt,
      })),
    }))
    .filter((u) => u.payout || u.documents.length)
    .map((u) => ({
      ...u,
      // What the panel sorts on, so the queue stays at the top without the UI
      // having to re-derive it.
      needsReview:
        u.payout?.status === 'pending'
        || u.documents.some((d) => d.status === 'pending'),
    }))
    .sort((a, b) => Number(b.needsReview) - Number(a.needsReview));
};
