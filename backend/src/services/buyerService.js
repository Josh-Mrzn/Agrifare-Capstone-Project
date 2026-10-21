import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import { findUserByUserId } from '../repositories/userRepository.js';
import * as workflow from './orderWorkflow.js';
import { isGcash } from './orderRules.js';

/** Buyer-facing stages, collapsing the seller's finer statuses. */
export const STAGES = ['pending', 'confirmed', 'preparing', 'delivery', 'delivered'];

const STAGE_OF = {
  pending: 'pending',
  confirmed: 'confirmed',
  processing: 'preparing',
  shipped: 'delivery',
  delivered: 'delivered',
  completed: 'delivered',
};

const MESSAGE = {
  pending: 'Waiting for the seller to confirm your order.',
  confirmed: 'The seller confirmed your order.',
  preparing: 'Your rice is being prepared.',
  delivery: 'Your order is on the way!',
  delivered: 'Your order has been delivered.',
  cancelled: 'This order was cancelled.',
};

/**
 * Orders placed through the cart share a UUID groupId; anything older is keyed
 * by its own _id. Feeding a UUID to an _id query throws a CastError, so the
 * _id clause is only added when the value could actually be one.
 */
function matchGroup(buyerUserId, groupId) {
  const clauses = [{ groupId }];
  if (mongoose.isValidObjectId(groupId)) clauses.push({ _id: groupId });
  return { buyerUserId, $or: clauses };
}

/**
 * A checkout writes one Order row per line item so each seller fulfils its own,
 * but the buyer placed a single order. Rows are folded back together by groupId.
 */
function groupOrders(rows) {
  const groups = new Map();

  for (const row of rows) {
    // Older orders predate groupId; fall back to their own id.
    const key = row.groupId || String(row._id);
    if (!groups.has(key)) {
      groups.set(key, {
        groupId: key,
        orderNumber: row.orderNumber || key.slice(-6).toUpperCase(),
        orderDate: row.orderDate,
        paymentMethod: row.paymentMethod,
        paymentStatus: row.paymentStatus,
        // The receipt the buyer uploaded. Their own proof, and they should be
        // able to look at what they sent rather than take it on trust that it
        // arrived - it is behind the authenticated files route, readable by
        // the two people on the order and nobody else.
        paymentProof: row.paymentProof || '',
        paymentReference: row.paymentReference || '',
        deliveryAddress: row.deliveryAddress,
        customerName: row.customerName,
        customerContact: row.customerContact,
        notes: row.notes,
        items: [],
        paymentStatuses: [],
        paymentNote: '',
        cancellationNote: '',
        complaintNote: '',
        refund: null,
        subtotal: 0,
        deliveryFee: 0,
        total: 0,
        statuses: [],
      });
    }

    const g = groups.get(key);
    g.items.push({
      orderId: String(row._id),
      sellerId: row.sellerId,
      productId: String(row.productId),
      productName: row.productName,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      lineTotal: row.subtotal,
      status: row.status,
      // The product's first photo, for the order cards. Empty when the
      // listing was deleted; the app shows its placeholder then.
      image: row.image || '',
      paymentStatus: row.paymentStatus,
      cancellation: row.cancellation?.status || 'none',
      complaint: row.complaint?.status || 'none',
      riderUserId: row.delivery?.riderUserId ?? null,
      courierName: row.delivery?.courierName || '',
    });
    // The most recent words from the seller about the payment or a request,
    // so the buyer is not left guessing why something was refused.
    if (row.paymentNote) g.paymentNote = row.paymentNote;
    if (row.cancellation?.decisionNote) g.cancellationNote = row.cancellation.decisionNote;
    if (row.complaint?.resolutionNote) g.complaintNote = row.complaint.resolutionNote;
    if (row.refund?.recordedAt) {
      g.refund = {
        amount: Number(g.refund?.amount || 0) + Number(row.refund.amount || 0),
        reference: row.refund.reference || '',
        recordedAt: row.refund.recordedAt,
      };
    }
    // The payment is only as settled as its least settled live line.
    if (row.status !== 'cancelled' || ['refund_due', 'refunded'].includes(row.paymentStatus)) {
      g.paymentStatuses.push(row.paymentStatus);
    }
    g.subtotal += Number(row.subtotal || 0);
    g.deliveryFee += Number(row.deliveryFee || 0);
    g.total += Number(row.total || 0);
    g.statuses.push(row.status);
  }

  return [...groups.values()].map((g) => {
    // The order is only as far along as its slowest line, and any cancelled
    // line makes the whole basket cancelled for the buyer's purposes.
    const cancelled = g.statuses.every((s) => s === 'cancelled');
    const stageIndex = cancelled
      ? -1
      : Math.min(...g.statuses
          .filter((s) => s !== 'cancelled')
          .map((s) => STAGES.indexOf(STAGE_OF[s] || 'pending')));

    const stage = cancelled ? 'cancelled' : STAGES[stageIndex] ?? 'pending';

    const PAY_ORDER = ['rejected', 'refund_due', 'proof_sent', 'unpaid', 'paid', 'refunded'];
    const paymentStatus = PAY_ORDER.find((p) => g.paymentStatuses.includes(p)) || g.paymentStatus;
    const live = g.items.filter((i) => i.status !== 'cancelled');

    return {
      ...g,
      statuses: undefined,
      paymentStatuses: undefined,
      paymentStatus,
      cancellationRequested: live.some((i) => i.cancellation === 'requested'),
      problemOpen: live.some((i) => i.complaint === 'open'),
      // A GCash receipt the seller could not match: the buyer sends a new one.
      canResubmitPayment: isGcash(g.paymentMethod) && live.length > 0 && live.every((i) => i.paymentStatus === 'rejected'),
      // Something wrong with what arrived, before the order closes.
      canReportProblem: live.some((i) => i.status === 'delivered') && !live.some((i) => i.complaint === 'open'),
      stage,
      stageIndex: cancelled ? -1 : stageIndex,
      message: MESSAGE[stage],
      isOngoing: !cancelled && stage !== 'delivered',
      // Set by the callers, which know the per-line statuses.
      canCancel: false,
      // Something arrived and is waiting for the buyer to say so.
      canConfirmReceived: g.items.some((i) => i.status === 'delivered'),
    };
  });
}

/** Puts each row's product photo on it, with one query for all of them. */
async function withImages(rows) {
  const ids = [...new Set(rows.map((r) => String(r.productId)).filter(Boolean))];
  const products = await Product.find({ _id: { $in: ids } }).select('images').lean();
  const imageOf = new Map(products.map((p) => [String(p._id), p.images?.[0] || '']));
  return rows.map((r) => ({ ...r, image: imageOf.get(String(r.productId)) || '' }));
}

export const getMyOrders = async (buyerUserId, { ongoing } = {}) => {
  const rows = await withImages(await Order.find({ buyerUserId }).sort({ orderDate: -1 }).lean());
  const groups = groupOrders(rows);

  for (const g of groups) setCancelFlags(g);

  if (ongoing === true) return groups.filter((g) => g.isOngoing);
  if (ongoing === false) return groups.filter((g) => !g.isOngoing);
  return groups;
};

export const getMyOrder = async (buyerUserId, groupId) => {
  const rows = await withImages(await Order.find(matchGroup(buyerUserId, groupId)).lean());

  if (!rows.length) throw new Error('Order not found');

  const [group] = groupOrders(rows);
  setCancelFlags(group);
  return group;
};

/**
 * Whether the buyer can cancel, and whether doing so cancels on the spot or
 * asks the seller. Nothing committed and nothing paid cancels at once; after
 * that the seller decides, because stock or money has moved.
 */
function setCancelFlags(g) {
  const live = g.items.filter((i) => i.status !== 'cancelled');
  const beforeShipping = live.length > 0 && live.every((i) => ['pending', 'confirmed', 'processing'].includes(i.status));
  g.canCancel = beforeShipping && !g.cancellationRequested;
  g.cancelNeedsApproval = g.canCancel
    && !live.every((i) => i.status === 'pending' && i.paymentStatus === 'unpaid');
}

/** Cancels at once, or asks the seller (see setCancelFlags). */
export const cancelMyOrder = async (buyerUserId, groupId, reason) => {
  const outcome = await workflow.buyerCancel(buyerUserId, groupId, reason);
  const order = await getMyOrder(buyerUserId, groupId);
  return { ...order, cancellationOutcome: outcome };
};

/**
 * The buyer's "I got it". Closes every delivered line of the order that is
 * settled, and is the record that the rice arrived - said by the person who
 * received it, not by the seller who would be paid for it.
 */
export const confirmReceived = async (buyerUserId, groupId) => {
  await workflow.buyerConfirmReceived(buyerUserId, groupId);
  return getMyOrder(buyerUserId, groupId);
};

/** A new GCash receipt after the seller could not find the first payment. */
export const resubmitPayment = async (buyerUserId, groupId, body) => {
  await workflow.resubmitGcash(buyerUserId, groupId, body);
  return getMyOrder(buyerUserId, groupId);
};

/** Something wrong with what arrived; pauses automatic completion. */
export const reportProblem = async (buyerUserId, groupId, body) => {
  await workflow.reportProblem(buyerUserId, groupId, body || {});
  return getMyOrder(buyerUserId, groupId);
};

/** Numbers for the Profile header. */
export const getMyStats = async (buyerUserId) => {
  const rows = await Order.find({ buyerUserId }).lean();
  const groups = groupOrders(rows);
  const paid = groups.filter((g) => g.stage !== 'cancelled');
  const user = await findUserByUserId(buyerUserId);

  return {
    orderCount: paid.length,
    ongoingCount: groups.filter((g) => g.isOngoing).length,
    historyCount: groups.filter((g) => !g.isOngoing).length,
    totalSpent: paid.reduce((sum, g) => sum + Number(g.total || 0), 0),
    memberSince: user?.createdAt ?? null,
  };
};
