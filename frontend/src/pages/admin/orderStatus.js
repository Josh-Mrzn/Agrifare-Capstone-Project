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
};

/** How each payment method reads to a seller. PayMongo runs in test mode. */
export const METHOD_LABEL = {
  'Cash/COD': 'Cash on delivery',
  GCash: 'GCash',
  PayMongo: 'PayMongo (sandbox)',
};

const PAYMENT_TONE = { unpaid: '', proof_sent: 'warning', paid: 'success', rejected: 'danger' };

export const paymentBadge = (status) => `badge${PAYMENT_TONE[status] ? ` badge-${PAYMENT_TONE[status]}` : ''}`;
