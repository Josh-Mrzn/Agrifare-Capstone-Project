import mongoose from 'mongoose';
import Order, { stockUnits } from '../models/Order.js';
import * as adminRepo from '../repositories/adminRepository.js';
import * as inventoryRepo from '../repositories/inventoryRepository.js';
import { postOrderSystemMessage } from './chatService.js';
import { notify, links } from './notify.js';
import { AppError } from '../errors/appError.js';
import {
  canMovePayment,
  canAutoComplete,
  isCod,
  isGcash,
  normalizeGcashReference,
  transitionBlocker,
} from './orderRules.js';

/**
 * The order workflow, in one place for every role.
 *
 * A checkout writes one row per product line. The rows one seller fulfils
 * from one checkout (same groupId, same sellerId) are one order to that
 * seller and to the buyer: they are confirmed, shipped, delivered, paid and
 * cancelled together. Everything here works on that seller-order, so a seller
 * cannot ship one sack of a basket while the other sits forgotten, and one
 * GCash transfer or one cash payment settles all of it.
 *
 * Two things move independently:
 *   status         where the rice is   (STATUS_TRANSITIONS)
 *   paymentStatus  where the money is  (PAYMENT_TRANSITIONS in orderRules)
 * Each change is a conditional update on the value it expects to replace, so
 * two people acting at once cannot both win.
 */

export const STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
};

/** Statuses at/after which stock has been taken out of inventory. */
export const STOCK_DEDUCTED_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered', 'completed'];

const STATUS_SENTENCE = (orderNumber, status, reason) => ({
  confirmed: `Order ${orderNumber} is confirmed. The seller is preparing it now.`,
  processing: `Order ${orderNumber} is being packed.`,
  shipped: `Order ${orderNumber} is on the way. Please keep your phone reachable for the rider.`,
  delivered: `Order ${orderNumber} was delivered. Confirm you received it, or report a problem.`,
  completed: `Order ${orderNumber} is complete. You can leave a review now.`,
  cancelled: `Order ${orderNumber} was cancelled${reason ? ` - ${reason}` : ''}.`,
}[status] || `Order ${orderNumber} is now ${status}.`);

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** The rows that make up this seller's part of the checkout. */
export async function sellerOrderRows(order) {
  if (!order.groupId) return [order];
  return Order.find({ groupId: order.groupId, sellerId: order.sellerId }).sort({ _id: 1 });
}

/**
 * A buyer's order by its groupId. Orders from before groupId existed are
 * keyed by their own _id, and a UUID is never a valid _id, so that clause is
 * only added when it could match.
 */
export function buyerGroupQuery(buyerUserId, groupId, extra = {}) {
  const clauses = [{ groupId }];
  if (mongoose.isValidObjectId(groupId)) clauses.push({ _id: groupId });
  return { buyerUserId, $or: clauses, ...extra };
}

/** Rows that are still live (not cancelled), the ones a change applies to. */
const liveRows = (rows) => rows.filter((r) => r.status !== 'cancelled');

export const amountDue = (rows) => round2(liveRows(rows).reduce((sum, r) => sum + Number(r.total || 0), 0));

/** Splits an amount across rows in proportion to their totals. */
function shares(rows, amount) {
  const due = rows.reduce((sum, r) => sum + Number(r.total || 0), 0);
  let left = round2(amount);
  return rows.map((row, i) => {
    if (i === rows.length - 1) return round2(left);
    const part = due > 0 ? round2((Number(row.total || 0) / due) * amount) : 0;
    left -= part;
    return part;
  });
}

export async function loadOrder(orderId) {
  let order = null;
  try {
    order = await Order.findById(orderId);
  } catch {
    order = null;
  }
  if (!order) throw new AppError('Order not found.', 404);
  return order;
}

export async function sellersOrder(orderId, sellerId) {
  const order = await loadOrder(orderId);
  if (order.sellerId !== sellerId) throw new AppError('Not your order.', 403);
  return order;
}

// ---------------------------------------------------------------- stock

/** Takes the row's kilograms off the shelf, once. Returns false if short. */
async function deductStock(row, actorNote) {
  const claimed = await Order.findOneAndUpdate(
    { _id: row._id, stockDeducted: { $ne: true } },
    { $set: { stockDeducted: true } },
  );
  if (!claimed) return true; // already deducted

  const kilos = stockUnits(row);
  const updated = await adminRepo.decrementStock(row.productId, kilos);
  if (!updated) {
    await Order.updateOne({ _id: row._id }, { $set: { stockDeducted: false } });
    return false;
  }
  await inventoryRepo.logMovement({
    sellerId: row.sellerId,
    productId: row.productId,
    productName: row.productName,
    type: 'SALE',
    quantity: -kilos,
    resultingStock: updated.stock,
    note: actorNote,
  });
  await adminRepo.bumpSoldCount(row.productId, row.quantity);
  return true;
}

/**
 * Puts the row's kilograms back, exactly once: the flag is cleared in the
 * same conditional update that decides whether this call is the one that
 * restocks, so a double cancel or a retry cannot return stock twice.
 */
async function restock(row, note) {
  const claimed = await Order.findOneAndUpdate(
    { _id: row._id, stockDeducted: true },
    { $set: { stockDeducted: false } },
  );
  if (!claimed) return;

  const kilos = stockUnits(row);
  await adminRepo.bumpSoldCount(row.productId, -row.quantity);
  const updated = await adminRepo.incrementStock(row.productId, kilos);
  if (updated) {
    await inventoryRepo.logMovement({
      sellerId: row.sellerId,
      productId: row.productId,
      productName: row.productName,
      type: 'RETURN',
      quantity: kilos,
      resultingStock: updated.stock,
      note,
    });
  }
}

async function maybeNotifyLowStock(sellerId, productIds) {
  for (const id of new Set(productIds.map(String))) {
    const fresh = await adminRepo.getProductById(id, sellerId);
    if (!fresh) continue;
    if (fresh.stock <= 0) {
      await notify({
        userId: sellerId,
        type: 'STOCK',
        title: `${fresh.name} is out of stock`,
        body: 'Restock soon to avoid missed sales.',
        link: links.sellerInventory(),
      });
    } else if (fresh.stock <= fresh.lowStockThreshold) {
      await notify({
        userId: sellerId,
        type: 'STOCK',
        title: `${fresh.name} is running low`,
        body: `Only ${fresh.stock}kg left (threshold: ${fresh.lowStockThreshold}kg).`,
        link: links.sellerInventory(),
      });
    }
  }
}

// ---------------------------------------------------------------- payment

/**
 * Moves the payment of every given row from `from` to `to`, recording why.
 * Conditional on each row still being at `from`. Returns the rows it moved.
 */
async function movePayment(rows, from, to, { set = {}, entry, perRow } = {}) {
  if (!canMovePayment(from, to)) {
    throw new Error(`A payment cannot go from "${from}" to "${to}".`);
  }
  const now = new Date();
  const moved = [];
  for (const [i, row] of rows.entries()) {
    const extra = perRow ? perRow(row, i) : {};
    const updated = await Order.findOneAndUpdate(
      { _id: row._id, paymentStatus: from },
      {
        $set: { paymentStatus: to, ...set, ...(extra.set || {}) },
        $push: { paymentHistory: { status: to, at: now, ...entry, ...(extra.entry || {}) } },
      },
      { new: true },
    );
    if (updated) moved.push(updated);
  }
  return moved;
}

/** What a cancelled order owes the buyer, and the payment state that says so. */
async function settleCancelledPayment(rows, actorId, reason) {
  for (const from of ['paid', 'proof_sent']) {
    const affected = rows.filter((r) => r.paymentStatus === from);
    if (!affected.length) continue;
    await movePayment(affected, from, 'refund_due', {
      entry: { kind: 'cancellation', note: reason || 'Order cancelled', reviewedBy: actorId ?? undefined },
    });
  }
}

// ---------------------------------------------------------------- status

/**
 * Moves this seller-order to `next`.
 *
 *   actor    { role: 'seller' | 'buyer' | 'rider' | 'system', userId }
 *   reason   required for a cancellation
 *
 * Only the rows sitting at the anchor row's status move; a line cancelled
 * earlier stays cancelled.
 */
export async function transition(anchor, next, actor, { reason = '', byBuyer = false } = {}) {
  const from = anchor.status;
  const allowed = STATUS_TRANSITIONS[from] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Cannot move an order from "${from}" to "${next}".`);
  }
  if (next === 'cancelled' && !String(reason).trim()) {
    throw new Error('A reason is required to cancel an order.');
  }

  const rows = (await sellerOrderRows(anchor)).filter((r) => r.status === from);
  if (!rows.length) {
    throw new Error('This order was just updated somewhere else. Refresh to see where it is now.');
  }

  if (next === 'confirmed' && rows.some((r) => r.cancellation?.status === 'requested')) {
    throw new Error('The buyer asked to cancel this order. Decide on that first.');
  }
  for (const row of rows) {
    const blocker = transitionBlocker(row, next, new Date(), { byBuyer });
    if (blocker) throw new Error(blocker);
  }

  const historyEntry = { status: next, changedAt: new Date(), reason: String(reason || '').trim(), by: actor.role };
  const claimed = [];
  for (const row of rows) {
    const done = await Order.findOneAndUpdate(
      { _id: row._id, status: from },
      { $set: { status: next, statusReason: historyEntry.reason }, $push: { statusHistory: historyEntry } },
      { new: true },
    );
    if (done) claimed.push(done);
  }

  const undo = async () => {
    for (const row of claimed) {
      await Order.updateOne({ _id: row._id, status: next }, { $set: { status: from }, $pop: { statusHistory: 1 } });
    }
  };

  if (claimed.length !== rows.length) {
    await undo();
    throw new Error('This order was just updated somewhere else. Refresh to see where it is now.');
  }

  if (next === 'confirmed') {
    const deducted = [];
    for (const row of claimed) {
      const ok = await deductStock(row, `Order ${row.orderNumber} confirmed`);
      if (!ok) {
        for (const done of deducted) await restock(done, `Order ${done.orderNumber} could not be confirmed`);
        await undo();
        throw new Error(`Not enough stock of ${row.productName} to confirm this order. Restock it or cancel the order.`);
      }
      deducted.push(row);
    }
    await maybeNotifyLowStock(anchor.sellerId, claimed.map((r) => r.productId));
  }

  if (next === 'cancelled') {
    for (const row of claimed) await restock(row, `Order ${row.orderNumber} cancelled`);
    await settleCancelledPayment(claimed, actor.userId, historyEntry.reason);
    await Order.updateMany(
      { _id: { $in: claimed.map((r) => r._id) }, 'cancellation.status': 'requested' },
      {
        $set: {
          'cancellation.status': 'approved',
          'cancellation.decidedAt': new Date(),
          'cancellation.decidedBy': actor.userId ?? null,
        },
      },
    );
  }

  await announce(anchor, next, actor, historyEntry.reason);
  return loadOrder(anchor._id);
}

/** Tells everyone on the order what just happened to it. */
async function announce(order, status, actor, reason) {
  const number = order.orderNumber;

  if (order.buyerUserId && actor.role !== 'buyer') {
    await notify({
      userId: order.buyerUserId,
      title: `Order ${number} ${status === 'shipped' ? 'is on the way' : status}`,
      body: STATUS_SENTENCE(number, status, reason),
      link: links.buyerOrder(order.groupId || String(order._id)),
    });
    await postOrderSystemMessage({
      sellerUserId: order.sellerId,
      buyerUserId: order.buyerUserId,
      text: STATUS_SENTENCE(number, status, reason),
    });
  }

  if (actor.role !== 'seller') {
    const who = { buyer: 'The buyer', rider: 'Your delivery person', system: 'AgriFair' }[actor.role] || 'Someone';
    await notify({
      userId: order.sellerId,
      title: `Order ${number} ${status}`,
      body: status === 'completed' && actor.role === 'system'
        ? 'Closed automatically 7 days after delivery, with nothing open on it.'
        : `${who} marked it ${status}${reason ? `: ${reason}` : '.'}`,
      link: links.sellerOrder(order._id),
    });
  }

  const riderId = order.delivery?.riderUserId;
  if (riderId != null && status === 'cancelled' && actor.role !== 'rider') {
    await notify({
      userId: riderId,
      title: `Delivery ${number} cancelled`,
      body: 'This order was cancelled. Do not deliver it.',
      link: links.riderDelivery(order._id),
    });
  }
}

// ---------------------------------------------------------------- GCash

/**
 * The seller checked their GCash app: the money is there, or it is not.
 * Only for a GCash receipt waiting on review. PayMongo is confirmed by
 * PayMongo and cash by the rider, never by a seller's word.
 */
export async function reviewGcash(orderId, sellerId, { paid, note, reference, amount }) {
  const order = await sellersOrder(orderId, sellerId);
  if (!isGcash(order.paymentMethod)) {
    throw new Error(order.paymentMethod === 'PayMongo'
      ? 'PayMongo payments are confirmed by PayMongo, not by hand.'
      : 'Cash payments are recorded by the delivery person when they collect it.');
  }
  if (order.status === 'cancelled') throw new Error('This order was cancelled.');

  const rows = liveRows(await sellerOrderRows(order));
  if (!rows.every((r) => r.paymentStatus === 'proof_sent')) {
    throw new Error('There is no receipt waiting for review on this order.');
  }

  const expected = amountDue(rows);
  const cleanNote = String(note || '').trim();

  if (!paid) {
    if (!cleanNote) throw new Error('Tell the buyer what was wrong with the payment.');
    await movePayment(rows, 'proof_sent', 'rejected', {
      set: { paymentNote: cleanNote, paymentReviewedAt: new Date(), paymentReviewedBy: sellerId, amountPaid: 0, paidAt: null },
      entry: { kind: 'review', amount: 0, reference: order.paymentReference || '', note: cleanNote, reviewedBy: sellerId },
    });
    await notify({
      userId: order.buyerUserId,
      type: 'PAYMENT',
      title: `GCash payment for ${order.orderNumber} not found`,
      body: `${cleanNote} Upload a new receipt from the order screen.`,
      link: links.buyerOrder(order.groupId || String(order._id)),
    });
    return loadOrder(order._id);
  }

  const ref = normalizeGcashReference(reference || order.paymentReference);
  if (!ref) throw new Error('Enter the reference number shown on the GCash transfer.');
  if (await Order.exists({ paymentReference: ref, _id: { $nin: rows.map((r) => r._id) } })) {
    throw new Error('That reference number is already on another order. Check it against your GCash history.');
  }

  const received = amount == null || amount === '' ? expected : Number(amount);
  if (!Number.isFinite(received) || received < 0) throw new Error('Enter the amount you received.');
  if (received < expected && !cleanNote) {
    throw new Error(`That is less than the ₱${expected.toLocaleString('en-PH')} due. Add a note saying why before confirming.`);
  }

  const now = new Date();
  const split = shares(rows, received);
  await movePayment(rows, 'proof_sent', 'paid', {
    set: { paymentNote: cleanNote, paymentReviewedAt: now, paymentReviewedBy: sellerId, paidAt: now, paymentReference: ref },
    entry: { kind: 'review', reference: ref, note: cleanNote, reviewedBy: sellerId },
    perRow: (row, i) => ({ set: { amountPaid: split[i] }, entry: { amount: split[i] } }),
  });
  await notify({
    userId: order.buyerUserId,
    type: 'PAYMENT',
    title: `GCash payment for ${order.orderNumber} received`,
    body: 'The seller confirmed your payment.',
    link: links.buyerOrder(order.groupId || String(order._id)),
  });
  return loadOrder(order._id);
}

/** The buyer's new receipt after the seller could not find the first one. */
export async function resubmitGcash(buyerUserId, groupId, { paymentProof, paymentReference }) {
  const rows = liveRows(await Order.find(buyerGroupQuery(buyerUserId, groupId)));
  if (!rows.length) throw new Error('Order not found');
  if (!isGcash(rows[0].paymentMethod)) throw new Error('This order is not paid by GCash.');
  if (!rows.every((r) => r.paymentStatus === 'rejected')) {
    throw new Error('A new receipt can only be sent after the seller could not find the payment.');
  }
  if (!paymentProof) throw new Error('Upload the new GCash receipt.');
  const ref = normalizeGcashReference(paymentReference);
  if (!ref) throw new Error('Enter the reference number from your GCash receipt (digits only).');
  if (await Order.exists({ paymentReference: ref, _id: { $nin: rows.map((r) => r._id) } })) {
    throw new Error('That GCash reference number is already on another order. Check your receipt.');
  }

  await movePayment(rows, 'rejected', 'proof_sent', {
    set: { paymentProof, paymentReference: ref, paymentNote: '' },
    entry: { kind: 'resubmit', reference: ref, note: 'New receipt from the buyer' },
  });
  await notify({
    userId: rows[0].sellerId,
    type: 'PAYMENT',
    title: `New GCash receipt for ${rows[0].orderNumber}`,
    body: 'The buyer sent a new receipt. Check your GCash app and review it.',
    link: links.sellerOrder(rows[0]._id),
  });
  return rows.length;
}

// ---------------------------------------------------------------- cash on delivery

/**
 * What the rider (or the seller, for a courier) collected at the door. Paid
 * when it matches what was due to the centavo; otherwise the payment stays
 * unpaid with the shortfall on record for the seller to resolve.
 */
export async function recordCodCollection(rows, amount, { by, note = '' }) {
  const collected = Number(amount);
  if (!Number.isFinite(collected) || collected < 0) {
    throw new Error('Enter the cash you collected, in pesos.');
  }
  const live = liveRows(rows);
  if (!live.length) return;
  if (!isCod(live[0].paymentMethod)) return;
  if (live.every((r) => r.codCollection?.collectedAt)) return; // already recorded

  const due = amountDue(live);
  const now = new Date();
  const split = shares(live, collected);
  for (const [i, row] of live.entries()) {
    await Order.updateOne(
      { _id: row._id, 'codCollection.collectedAt': { $exists: false } },
      { $set: { codCollection: { amount: split[i], collectedAt: now, riderUserId: by, note: String(note).trim() } } },
    );
  }

  if (Math.abs(collected - due) < 0.005) {
    await movePayment(live, 'unpaid', 'paid', {
      set: { paidAt: now, paymentNote: 'Cash collected on delivery' },
      entry: { kind: 'cod', note: 'Cash collected on delivery', reviewedBy: by },
      perRow: (row, i) => ({ set: { amountPaid: split[i] }, entry: { amount: split[i] } }),
    });
  } else {
    await Order.updateMany(
      { _id: { $in: live.map((r) => r._id) } },
      {
        $set: { paymentNote: `Collected ₱${collected.toFixed(2)} of ₱${due.toFixed(2)} due` },
        $push: { paymentHistory: { status: 'unpaid', kind: 'cod', amount: collected, note: `Collected ₱${collected.toFixed(2)} of ₱${due.toFixed(2)} due`, reviewedBy: by, at: now } },
      },
    );
    await notify({
      userId: live[0].sellerId,
      type: 'PAYMENT',
      title: `Cash for ${live[0].orderNumber} does not match`,
      body: `Collected ₱${collected.toFixed(2)} of ₱${due.toFixed(2)} due. Check with your delivery person and correct it.`,
      link: links.sellerOrder(live[0]._id),
    });
  }
}

/**
 * The seller's correction of a cash collection that did not match. Audited:
 * the original figure stays in the history beside the correction and why.
 */
export async function correctCod(orderId, sellerId, { amount, note }) {
  const order = await sellersOrder(orderId, sellerId);
  if (!isCod(order.paymentMethod)) throw new Error('Only a cash on delivery payment can be corrected here.');
  const rows = liveRows(await sellerOrderRows(order));
  if (!rows.every((r) => r.codCollection?.collectedAt)) {
    throw new Error('No cash collection has been recorded on this order yet.');
  }
  if (!rows.every((r) => r.paymentStatus === 'unpaid')) {
    throw new Error('This payment is already settled.');
  }
  const cleanNote = String(note || '').trim();
  if (!cleanNote) throw new Error('Say why the amount is being corrected.');
  const collected = Number(amount);
  if (!Number.isFinite(collected) || collected < 0) throw new Error('Enter the cash actually received.');

  const due = amountDue(rows);
  const now = new Date();
  const split = shares(rows, collected);
  for (const [i, row] of rows.entries()) {
    await Order.updateOne({ _id: row._id }, { $set: { 'codCollection.amount': split[i] } });
  }

  if (Math.abs(collected - due) < 0.005) {
    await movePayment(rows, 'unpaid', 'paid', {
      set: { paidAt: now, paymentNote: cleanNote, paymentReviewedAt: now, paymentReviewedBy: sellerId },
      entry: { kind: 'correction', note: cleanNote, reviewedBy: sellerId },
      perRow: (row, i) => ({ set: { amountPaid: split[i] }, entry: { amount: split[i] } }),
    });
  } else {
    await Order.updateMany(
      { _id: { $in: rows.map((r) => r._id) } },
      {
        $set: { paymentNote: cleanNote },
        $push: { paymentHistory: { status: 'unpaid', kind: 'correction', amount: collected, note: cleanNote, reviewedBy: sellerId, at: now } },
      },
    );
  }
  return loadOrder(order._id);
}

// ---------------------------------------------------------------- cancellation

/**
 * The buyer's cancel button.
 *
 * Still pending and nothing paid: cancelled on the spot, nothing was
 * committed. Otherwise money or a receipt is involved, or the seller has
 * started, so it becomes a request the seller decides on. Out for delivery
 * or later cannot be cancelled; that is what "report a problem" is for.
 */
export async function buyerCancel(buyerUserId, groupId, reason) {
  const why = String(reason || '').trim();
  if (!why) throw new Error('Tell the seller why you are cancelling.');

  const rows = await Order.find(buyerGroupQuery(buyerUserId, groupId));
  if (!rows.length) throw new Error('Order not found');
  const live = liveRows(rows);
  if (!live.length) throw new Error('This order is already cancelled.');
  if (live.some((r) => ['shipped', 'delivered', 'completed'].includes(r.status))) {
    throw new Error('This order is already on its way. Once it arrives you can report a problem instead.');
  }

  const results = [];
  for (const sellerId of new Set(live.map((r) => r.sellerId))) {
    const mine = live.filter((r) => r.sellerId === sellerId);
    const direct = mine.every((r) => r.status === 'pending' && r.paymentStatus === 'unpaid');
    if (direct) {
      await transition(mine[0], 'cancelled', { role: 'buyer', userId: buyerUserId }, { reason: why });
      await postOrderSystemMessage({
        sellerUserId: sellerId,
        buyerUserId,
        text: `The buyer cancelled order ${mine[0].orderNumber} - ${why}.`,
      });
      results.push('cancelled');
      continue;
    }

    if (mine.some((r) => r.cancellation?.status === 'requested')) {
      results.push('requested');
      continue;
    }
    await Order.updateMany(
      { _id: { $in: mine.map((r) => r._id) }, status: { $in: ['pending', 'confirmed', 'processing'] } },
      { $set: { cancellation: { status: 'requested', reason: why, requestedAt: new Date() } } },
    );
    await notify({
      userId: sellerId,
      title: `Cancellation requested for ${mine[0].orderNumber}`,
      body: `${why}. Approve it (and refund any payment) or explain why not.`,
      link: links.sellerOrder(mine[0]._id),
    });
    await postOrderSystemMessage({
      sellerUserId: sellerId,
      buyerUserId,
      text: `The buyer asked to cancel order ${mine[0].orderNumber} - ${why}.`,
    });
    results.push('requested');
  }
  return results.includes('requested') ? 'requested' : 'cancelled';
}

/** The seller's answer to a cancellation request. */
export async function decideCancellation(orderId, sellerId, { approve, note }) {
  const order = await sellersOrder(orderId, sellerId);
  const rows = liveRows(await sellerOrderRows(order));
  if (!rows.some((r) => r.cancellation?.status === 'requested')) {
    throw new Error('There is no cancellation request on this order.');
  }
  const cleanNote = String(note || '').trim();

  if (approve) {
    if (!['pending', 'confirmed', 'processing'].includes(order.status)) {
      throw new Error('This order is already on its way and cannot be cancelled.');
    }
    const reason = `Cancelled at the buyer's request${order.cancellation?.reason ? `: ${order.cancellation.reason}` : ''}`;
    await transition(order, 'cancelled', { role: 'seller', userId: sellerId }, { reason });
    await Order.updateMany(
      { _id: { $in: rows.map((r) => r._id) } },
      { $set: { 'cancellation.decisionNote': cleanNote } },
    );
    return loadOrder(order._id);
  }

  if (!cleanNote) throw new Error('Tell the buyer why the order cannot be cancelled.');
  await Order.updateMany(
    { _id: { $in: rows.map((r) => r._id) }, 'cancellation.status': 'requested' },
    {
      $set: {
        'cancellation.status': 'rejected',
        'cancellation.decidedAt': new Date(),
        'cancellation.decidedBy': sellerId,
        'cancellation.decisionNote': cleanNote,
      },
    },
  );
  await notify({
    userId: order.buyerUserId,
    title: `Cancellation of ${order.orderNumber} declined`,
    body: cleanNote,
    link: links.buyerOrder(order.groupId || String(order._id)),
  });
  return loadOrder(order._id);
}

/** The seller recording that the money went back to the buyer. */
export async function recordRefund(orderId, sellerId, { amount, reference, note }) {
  const order = await sellersOrder(orderId, sellerId);
  const rows = (await sellerOrderRows(order)).filter((r) => r.paymentStatus === 'refund_due');
  if (!rows.length) throw new Error('Nothing on this order is waiting for a refund.');

  const owed = round2(rows.reduce((sum, r) => sum + Number(r.amountPaid || 0), 0));
  const refunded = amount == null || amount === '' ? owed : Number(amount);
  if (!Number.isFinite(refunded) || refunded < 0) throw new Error('Enter the amount refunded.');
  const cleanNote = String(note || '').trim();
  const ref = String(reference || '').trim();
  if (refunded < owed && !cleanNote) {
    throw new Error(`That is less than the ₱${owed.toFixed(2)} received. Add a note saying why.`);
  }
  if (refunded > 0 && !ref && !cleanNote) {
    throw new Error('Add the GCash reference of the refund, or a note on how it was returned.');
  }

  const now = new Date();
  const split = shares(rows, refunded);
  await movePayment(rows, 'refund_due', 'refunded', {
    set: { paymentNote: cleanNote },
    entry: { kind: 'refund', reference: ref, note: cleanNote, reviewedBy: sellerId },
    perRow: (row, i) => ({
      set: { refund: { amount: split[i], reference: ref, recordedAt: now, recordedBy: sellerId } },
      entry: { amount: split[i] },
    }),
  });
  await notify({
    userId: order.buyerUserId,
    type: 'PAYMENT',
    title: `Refund recorded for ${order.orderNumber}`,
    body: `₱${refunded.toFixed(2)}${ref ? `, reference ${ref}` : ''}.`,
    link: links.buyerOrder(order.groupId || String(order._id)),
  });
  return loadOrder(order._id);
}

// ---------------------------------------------------------------- completion

/** The buyer's "I got it": closes their delivered seller-orders that can close. */
export async function buyerConfirmReceived(buyerUserId, groupId) {
  const rows = await Order.find(buyerGroupQuery(buyerUserId, groupId, { status: 'delivered' }));
  if (!rows.length) throw new Error('Nothing on this order has been delivered yet.');

  const problems = [];
  for (const sellerId of new Set(rows.map((r) => r.sellerId))) {
    const anchor = rows.find((r) => r.sellerId === sellerId);
    try {
      await transition(anchor, 'completed', { role: 'buyer', userId: buyerUserId }, { reason: 'Buyer confirmed receipt', byBuyer: true });
    } catch (err) {
      problems.push(err.message);
    }
  }
  if (problems.length === new Set(rows.map((r) => r.sellerId)).size) {
    throw new Error(problems[0]);
  }
}

/** The buyer's "something is wrong" on a delivered order. */
export async function reportProblem(buyerUserId, groupId, { reason, note }) {
  const why = String(reason || '').trim();
  if (!why) throw new Error('Say what is wrong with the order.');
  const rows = await Order.find(buyerGroupQuery(buyerUserId, groupId, { status: 'delivered' }));
  if (!rows.length) throw new Error('A problem can be reported once the order is delivered and before it is completed.');
  if (rows.some((r) => r.complaint?.status === 'open')) throw new Error('A problem is already open on this order.');

  await Order.updateMany(
    { _id: { $in: rows.map((r) => r._id) } },
    { $set: { complaint: { status: 'open', reason: why, note: String(note || '').trim(), openedAt: new Date() } } },
  );
  for (const sellerId of new Set(rows.map((r) => r.sellerId))) {
    const row = rows.find((r) => r.sellerId === sellerId);
    await notify({
      userId: sellerId,
      title: `Problem reported on ${row.orderNumber}`,
      body: why,
      link: links.sellerOrder(row._id),
    });
  }
}

export async function resolveProblem(orderId, sellerId, { note }) {
  const order = await sellersOrder(orderId, sellerId);
  const cleanNote = String(note || '').trim();
  if (!cleanNote) throw new Error('Say how the problem was resolved.');
  const rows = await sellerOrderRows(order);
  const result = await Order.updateMany(
    { _id: { $in: rows.map((r) => r._id) }, 'complaint.status': 'open' },
    { $set: { 'complaint.status': 'resolved', 'complaint.resolvedAt': new Date(), 'complaint.resolutionNote': cleanNote } },
  );
  if (!result.modifiedCount) throw new Error('There is no open problem on this order.');
  await notify({
    userId: order.buyerUserId,
    title: `Problem on ${order.orderNumber} resolved`,
    body: cleanNote,
    link: links.buyerOrder(order.groupId || String(order._id)),
  });
  return loadOrder(order._id);
}

/**
 * Closes delivered orders nobody closed: proof uploaded, paid, nothing open,
 * and AUTO_COMPLETE_DAYS since delivery. Safe to run any number of times and
 * from several places at once: each order moves through the same conditional
 * update as a person's click.
 */
export async function autoCompleteDue(now = new Date()) {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const candidates = await Order.find({
    status: 'delivered',
    source: 'storefront',
    'delivery.deliveredAt': { $lte: cutoff },
  }).limit(500);

  let completed = 0;
  const seen = new Set();
  for (const row of candidates) {
    const key = `${row.groupId || row._id}:${row.sellerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = (await sellerOrderRows(row)).filter((r) => r.status === 'delivered');
    if (!group.every((r) => canAutoComplete(r, now))) continue;
    try {
      await transition(group[0], 'completed', { role: 'system', userId: null }, { reason: 'Completed automatically 7 days after delivery', byBuyer: true });
      completed += group.length;
    } catch (err) {
      console.error('[auto-complete]', row.orderNumber, err.message);
    }
  }
  return { checked: seen.size, completed };
}
