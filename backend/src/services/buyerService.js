import mongoose from 'mongoose';
import Order from '../models/Order.js';
import { findUserByUserId } from '../repositories/userRepository.js';
import { postOrderSystemMessage } from './chatService.js';

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
    });
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

    return {
      ...g,
      statuses: undefined,
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

export const getMyOrders = async (buyerUserId, { ongoing } = {}) => {
  const rows = await Order.find({ buyerUserId }).sort({ orderDate: -1 }).lean();
  const groups = groupOrders(rows);

  // Cancelling is only offered while nothing has been committed yet.
  for (const g of groups) {
    g.canCancel = g.items.every((i) => i.status === 'pending');
  }

  if (ongoing === true) return groups.filter((g) => g.isOngoing);
  if (ongoing === false) return groups.filter((g) => !g.isOngoing);
  return groups;
};

export const getMyOrder = async (buyerUserId, groupId) => {
  const rows = await Order.find(matchGroup(buyerUserId, groupId)).lean();

  if (!rows.length) throw new Error('Order not found');

  const [group] = groupOrders(rows);
  group.canCancel = group.items.every((i) => i.status === 'pending');
  return group;
};

/**
 * A buyer may call off an order only while every line is still pending — once a
 * seller confirms, stock is committed and it becomes their decision.
 */
export const cancelMyOrder = async (buyerUserId, groupId, reason) => {
  if (!reason?.trim()) throw new Error('Tell the seller why you are cancelling.');

  const rows = await Order.find(matchGroup(buyerUserId, groupId));
  if (!rows.length) throw new Error('Order not found');

  const blocked = rows.filter((r) => r.status !== 'pending');
  if (blocked.length) {
    throw new Error('The seller already started on this order. Message them to cancel.');
  }

  // Conditional on each line still being pending, in the database rather
  // than in memory: the seller may be confirming at this same moment, and a
  // plain save would overwrite their "confirmed" after stock was taken out.
  const result = await Order.updateMany(
    { _id: { $in: rows.map((r) => r._id) }, status: 'pending' },
    {
      $set: { status: 'cancelled', statusReason: reason.trim() },
      $push: { statusHistory: { status: 'cancelled', changedAt: new Date(), reason: reason.trim() } },
    },
  );
  if (result.modifiedCount === 0) {
    throw new Error('The seller already started on this order. Message them to cancel.');
  }

  // One message per seller, not per row: a basket cancelled across three of
  // their listings is one piece of news to each seller, not three.
  for (const sellerUserId of new Set(rows.map((r) => r.sellerId))) {
    await postOrderSystemMessage({
      sellerUserId,
      buyerUserId,
      text: `The buyer cancelled order ${rows[0].orderNumber} - ${reason.trim()}.`,
    });
  }

  return getMyOrder(buyerUserId, groupId);
};

/**
 * The buyer's "I got it". Closes every delivered line of the order, and is
 * the record that the rice arrived - said by the person who received it, not
 * by the seller who would be paid for it.
 */
export const confirmReceived = async (buyerUserId, groupId) => {
  const rows = await Order.find(matchGroup(buyerUserId, groupId));
  if (!rows.length) throw new Error('Order not found');

  const delivered = rows.filter((r) => r.status === 'delivered');
  if (!delivered.length) {
    throw new Error('Nothing on this order has been delivered yet.');
  }

  const now = new Date();
  await Order.updateMany(
    { _id: { $in: delivered.map((r) => r._id) }, status: 'delivered' },
    {
      $set: { status: 'completed' },
      $push: { statusHistory: { status: 'completed', changedAt: now, reason: 'Buyer confirmed receipt' } },
    },
  );

  for (const sellerUserId of new Set(delivered.map((r) => r.sellerId))) {
    await postOrderSystemMessage({
      sellerUserId,
      buyerUserId,
      text: `The buyer confirmed they received order ${rows[0].orderNumber}.`,
    });
  }

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
