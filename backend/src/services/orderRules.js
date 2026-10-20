import { DEFAULT_DELIVERY_FEE } from '../models/User.js';

/**
 * The rules an order has to pass, kept apart from the database so each one
 * can be tested on its own (test/orderRules.test.js).
 */

/**
 * What a buyer can pay with. PayMongo is the payment gateway demo, run in
 * sandbox mode (see services/paymongoService.js).
 */
export const PAYMENT_METHODS = ['Cash/COD', 'GCash', 'PayMongo'];

export const isGcash = (method) => /gcash/i.test(method || '');

export const isPaymongo = (method) => method === 'PayMongo';

export const isCod = (method) => !isGcash(method) && !isPaymongo(method);

/**
 * Where the money stands, kept apart from where the rice is (`status`).
 *
 *   unpaid      nothing received yet (cash on delivery, or PayMongo not paid)
 *   proof_sent  the buyer uploaded a GCash receipt; the seller has to check it
 *   paid        the money arrived
 *   rejected    the seller looked and the GCash money was not there
 *   refund_due  the order was cancelled after money (or a receipt) came in
 *   refunded    the seller recorded giving it back
 */
export const PAYMENT_STATUSES = ['unpaid', 'proof_sent', 'paid', 'rejected', 'refund_due', 'refunded'];

export const PAYMENT_TRANSITIONS = {
  unpaid: ['paid', 'proof_sent'],
  proof_sent: ['paid', 'rejected', 'refund_due'],
  rejected: ['proof_sent'],
  paid: ['refund_due'],
  refund_due: ['refunded'],
  refunded: [],
};

export const canMovePayment = (from, to) =>
  (PAYMENT_TRANSITIONS[from || 'unpaid'] || []).includes(to);

/**
 * The sack sizes a product is sold in: the sizes the seller listed, or a
 * single 1 kg size when they listed none. Anything else - a 7 kg "sack" sent
 * straight to the API - is not something the seller offered to sell.
 */
export function sellableWeights(product) {
  const tiers = (product?.weightTiers || [])
    .map((t) => Number(t.weightKg))
    .filter((kg) => Number.isFinite(kg) && kg > 0);
  return tiers.length ? [...new Set(tiers)].sort((a, b) => a - b) : [1];
}

/** How long after delivery an order closes itself, if nothing is open on it. */
export const AUTO_COMPLETE_DAYS = 7;

/**
 * A Philippine mobile number, in the 09XXXXXXXXX form the riders dial.
 * Accepts the ways people actually type it: spaces, dashes, +63 or 63.
 * Returns null for anything that is not one.
 */
export function normalizePhMobile(raw) {
  const digits = String(raw || '').replace(/[\s()-]/g, '');
  const match = digits.match(/^(?:\+?63|0)(9\d{9})$/);
  return match ? `0${match[1]}` : null;
}

/**
 * The reference number printed on a GCash receipt (13 digits today, often
 * typed with spaces). Some lenience on length, none on content: digits only.
 */
export function normalizeGcashReference(raw) {
  const digits = String(raw || '').replace(/\s/g, '');
  return /^\d{10,16}$/.test(digits) ? digits : null;
}

/**
 * One delivery fee per seller in the basket, never one per line: three sacks
 * from one shop are one trip. A seller whose items cannot be bought right now
 * charges nothing, because nothing of theirs is being bought.
 */
export function deliveryFeesBySeller(items, feeBySeller) {
  const fees = new Map();
  for (const item of items) {
    if (!item.inStock || fees.has(item.sellerId)) continue;
    const own = feeBySeller.get(item.sellerId);
    fees.set(item.sellerId, Number.isFinite(own) ? own : DEFAULT_DELIVERY_FEE);
  }
  return fees;
}

/** How long a delivered order waits for the buyer before the seller may close it. */
export const BUYER_CONFIRM_DAYS = 3;

/**
 * Why a storefront order cannot move to `next` yet, or null when it can.
 *
 * Every delivery leaves a record: who carried it (a rider, or a named courier
 * with a tracking number), a photo at the door, and the buyer's own "received".
 * Sales the seller typed in themselves (`source: 'manual'`) are already the
 * record, so these rules do not apply to them.
 */
export function transitionBlocker(order, next, now = new Date(), { byBuyer = false } = {}) {
  if (next === 'confirmed' && isGcash(order.paymentMethod) && order.paymentStatus !== 'paid') {
    return 'Confirm the GCash payment first. Check your GCash app, then mark it received.';
  }
  if (next === 'confirmed' && isPaymongo(order.paymentMethod) && order.paymentStatus !== 'paid') {
    return 'Waiting for the buyer to finish paying online. PayMongo marks it paid automatically.';
  }

  if (order.source !== 'storefront') return null;

  const delivery = order.delivery || {};

  if (next === 'shipped') {
    const hasRider = delivery.riderUserId != null;
    const hasCourier = Boolean(delivery.courierName && delivery.courierReference);
    if (!hasRider && !hasCourier) {
      return 'Assign one of your delivery people, or record the courier and its tracking number, before shipping.';
    }
    if (hasRider && delivery.assignmentStatus === 'assigned') {
      return 'Wait for the delivery person to accept this delivery.';
    }
  }

  if (next === 'delivered' && !delivery.proofOfDelivery) {
    return 'Upload a photo of the delivery to mark it delivered.';
  }

  if (next === 'delivered' && isCod(order.paymentMethod) && !order.codCollection?.collectedAt) {
    return 'Record how much cash was collected at the door.';
  }

  if (next === 'completed') {
    const blocker = completionBlocker(order);
    if (blocker) return blocker;
  }

  if (next === 'completed' && !byBuyer) {
    const deliveredAt = delivery.deliveredAt ? new Date(delivery.deliveredAt) : null;
    const waited = deliveredAt
      ? (now - deliveredAt) / (24 * 60 * 60 * 1000)
      : 0;
    if (waited < BUYER_CONFIRM_DAYS) {
      return `The buyer confirms receipt in the app. If they have not, you can close it ${BUYER_CONFIRM_DAYS} days after delivery.`;
    }
  }

  return null;
}

/**
 * What still has to be settled before an order can be closed, whoever is
 * closing it: the buyer's "received", the seller after the wait, or the
 * nightly job. Null when nothing is.
 */
export function completionBlocker(order) {
  if (order.paymentStatus !== 'paid') {
    return isCod(order.paymentMethod)
      ? 'The cash collected has not been recorded as the full amount due. Record or correct it first.'
      : 'This order is not marked paid.';
  }
  if (order.cancellation?.status === 'requested') {
    return 'The buyer asked to cancel this order. Decide on that first.';
  }
  if (order.complaint?.status === 'open') {
    return 'The buyer reported a problem with this order. Resolve it first.';
  }
  return null;
}

/**
 * Whether a delivered order may be closed by the nightly job: it has a photo
 * at the door, it is paid, nothing is open on it, and the buyer has had
 * AUTO_COMPLETE_DAYS to say something was wrong.
 */
export function canAutoComplete(order, now = new Date()) {
  if (order.status !== 'delivered') return false;
  const delivery = order.delivery || {};
  if (!delivery.proofOfDelivery || !delivery.deliveredAt) return false;
  const days = (now - new Date(delivery.deliveredAt)) / (24 * 60 * 60 * 1000);
  return days >= AUTO_COMPLETE_DAYS && completionBlocker(order) === null;
}
