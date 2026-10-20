/**
 * How order and payment states read and look, in one place, so the dashboard,
 * the order list and the order detail never disagree.
 */

export const STATUS_LABEL = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Preparing',
  shipped: 'Out for delivery',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_TONE = {
  pending: 'warning',
  confirmed: 'info',
  processing: 'info',
  shipped: 'info',
  delivered: 'success',
  completed: 'success',
  cancelled: '',
};

export const statusBadge = (status) => `badge${STATUS_TONE[status] ? ` badge-${STATUS_TONE[status]}` : ''}`;

export const PAYMENT_LABEL = {
  unpaid: 'Unpaid',
  proof_sent: 'Receipt to check',
  paid: 'Paid',
  rejected: 'Not received',
  refund_due: 'Refund owed',
  refunded: 'Refunded',
};

/** How each payment method reads to a seller. PayMongo runs in test mode. */
export const METHOD_LABEL = {
  'Cash/COD': 'Cash on delivery',
  GCash: 'GCash',
  PayMongo: 'PayMongo (sandbox)',
};

const PAYMENT_TONE = { unpaid: '', proof_sent: 'warning', paid: 'success', rejected: 'danger', refund_due: 'danger', refunded: '' };

/**
 * One checkout stores a row per product line; the lines one seller fulfils
 * from one checkout move together (the server confirms, ships, pays and
 * cancels them as one). Folded back into one order here.
 */
export function groupSellerOrders(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.groupId || row._id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((lines) => {
    const live = lines.filter((l) => l.status !== 'cancelled');
    const anchor = live[0] || lines[0];
    const sum = (key) => Math.round(lines.reduce((s, l) => s + Number(l[key] || 0), 0) * 100) / 100;
    const liveSum = (key) => Math.round((live.length ? live : lines).reduce((s, l) => s + Number(l[key] || 0), 0) * 100) / 100;
    return {
      ...anchor,
      lines,
      ids: lines.map((l) => l._id),
      productName: lines.length > 1 ? `${lines.length} items` : anchor.productName,
      subtotal: liveSum('subtotal'),
      deliveryFee: liveSum('deliveryFee'),
      total: liveSum('total'),
      amountPaid: sum('amountPaid'),
      refundAmount: lines.reduce((s, l) => s + Number(l.refund?.amount || 0), 0),
      cashCollected: anchor.codCollection?.collectedAt
        ? Math.round(live.reduce((s, l) => s + Number(l.codCollection?.amount || 0), 0) * 100) / 100
        : null,
    };
  });
}

export const paymentBadge = (status) => `badge${PAYMENT_TONE[status] ? ` badge-${PAYMENT_TONE[status]}` : ''}`;
