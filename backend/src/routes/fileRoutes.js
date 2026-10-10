import express from 'express';
import path from 'path';
import { protect } from '../middleware/authMiddleware.js';
import { findStored, sendStored } from '../middleware/multerMiddleware.js';
import { findUserByUserId } from '../repositories/userRepository.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { escapeRegex } from '../utils/escapeRegex.js';

const router = express.Router();

/** Every private file this user owns outright. */
function ownedFiles(user) {
  const files = [];
  if (user?.payout?.qrImage) files.push(user.payout.qrImage);
  for (const doc of user?.documents || []) {
    if (doc.file) files.push(doc.file);
  }
  return files.map((f) => path.basename(f));
}

/** Matches a stored path like `/api/files/<name>` by its last segment. */
const endsWith = (filename) =>
  new RegExp(`${escapeRegex(filename)}$`);

/**
 * Whether this file is a seller's payment QR that a Super Admin has approved.
 *
 * An approved QR is meant to be looked at - it is how a buyer pays. Before
 * approval it is a credential and nobody but its owner and a reviewer sees it,
 * which is the same rule the payment endpoint follows.
 */
async function isApprovedPaymentQr(filename) {
  const seller = await User.findOne({
    'payout.qrImage': endsWith(filename),
    'payout.status': 'verified',
  }).select('_id');

  return Boolean(seller);
}

/**
 * Whether this file is a receipt on an order the requester is part of.
 *
 * Two people have a stake in a payment proof and nobody else does: the buyer
 * who sent the money and the seller who has to check it arrived. Leaving it
 * readable only by a Super Admin - which is what the owner-only rule did -
 * meant neither of them could see the thing the whole GCash flow turns on.
 */
async function isPartyToPaymentProof(userId, filename) {
  const order = await Order.findOne({
    paymentProof: endsWith(filename),
    $or: [{ buyerUserId: userId }, { sellerId: userId }],
  }).select('_id');

  return Boolean(order);
}

/**
 * Whether this file is the photo taken at the door of an order this person is
 * part of.
 *
 * Three people have a stake in it and nobody else does: the buyer whose
 * doorway is in the picture, the seller who is accountable for the delivery,
 * and the rider who took it.
 */
async function isPartyToDeliveryProof(userId, filename) {
  const order = await Order.findOne({
    'delivery.proofOfDelivery': endsWith(filename),
    $or: [
      { buyerUserId: userId },
      { sellerId: userId },
      { 'delivery.riderUserId': userId },
    ],
  }).select('_id');

  return Boolean(order);
}

/**
 * Credentials are readable only by the person they belong to, the two sides of
 * the order they concern, or a Super Admin reviewing them. They are
 * deliberately not served by express.static — a file behind a guessable URL is
 * a file anyone can take.
 */
router.get('/:filename', protect, async (req, res) => {
  // basename() strips any ../ so a crafted name cannot escape the folder.
  const filename = path.basename(req.params.filename);
  const file = await findStored('private', filename);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (req.user.role !== 'superadmin') {
    const user = await findUserByUserId(req.user.userId);

    const allowed =
      ownedFiles(user).includes(filename)
      || (await isApprovedPaymentQr(filename))
      || (await isPartyToPaymentProof(req.user.userId, filename))
      || (await isPartyToDeliveryProof(req.user.userId, filename));

    if (!allowed) {
      return res.status(403).json({ error: 'Not your file' });
    }
  }

  // Credentials must never be cached by a shared proxy.
  sendStored('private', file, res, 'private, no-store');
});

export default router;
