import { DEFAULT_DELIVERY_FEE } from '../models/User.js';

/**
 * The rules an order has to pass, kept apart from the database so each one
 * can be tested on its own (test/orderRules.test.js).
 */

/** What a buyer can pay with. PayMongo was listed once but never built. */
export const PAYMENT_METHODS = ['Cash/COD', 'GCash'];

export const isGcash = (method) => /gcash/i.test(method || '');

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
export function transitionBlocker(order, next, now = new Date()) {
  if (next === 'confirmed' && isGcash(order.paymentMethod) && order.paymentStatus !== 'paid') {
    return 'Confirm the GCash payment first. Check your GCash app, then mark it received.';
  }

  if (order.source !== 'storefront') return null;

  const delivery = order.delivery || {};

  if (next === 'shipped') {
    const hasRider = delivery.riderUserId != null;
    const hasCourier = Boolean(delivery.courierName && delivery.courierReference);
    if (!hasRider && !hasCourier) {
      return 'Assign one of your delivery people, or record the courier and its tracking number, before shipping.';
    }
  }

  if (next === 'delivered' && !delivery.proofOfDelivery) {
    return 'Upload a photo of the delivery to mark it delivered.';
  }

  if (next === 'completed') {
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
