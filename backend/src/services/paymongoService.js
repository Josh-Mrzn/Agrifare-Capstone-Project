import crypto from 'crypto';
import Order from '../models/Order.js';
import { notify, links } from './notify.js';
import { postOrderSystemMessage } from './chatService.js';
import { getAppUrl } from './authService.js';

/**
 * PayMongo, in sandbox (test) mode: a payment gateway demo.
 *
 * With test keys (sk_test_...) no real money moves. PayMongo shows its own
 * checkout page, the buyer picks GCash, Maya or a test card and clicks
 * "Authorize", and PayMongo reports the session as paid. This exists to show
 * a gateway integration end to end; the real payment flows of the app are
 * cash on delivery and the buyer paying the seller's own GCash directly.
 *
 * An order is marked paid only by asking PayMongo, never on the client's
 * word: either the app calls verifyPayment after returning from the checkout
 * page, or PayMongo calls the webhook.
 */

const API = 'https://api.paymongo.com/v1';

export const isConfigured = () => Boolean(process.env.PAYMONGO_SECRET_KEY);

const isTestKey = () => String(process.env.PAYMONGO_SECRET_KEY || '').startsWith('sk_test_');

function authHeader() {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error('Online payment (PayMongo) is not set up on the server.');
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: authHeader(),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.errors?.[0]?.detail || `status ${res.status}`;
    console.error('[paymongo]', method, path, detail);
    throw new Error('PayMongo could not process that right now. Try again in a moment.');
  }
  return json.data;
}

/** Pesos to centavos, the unit PayMongo counts in. */
const centavos = (pesos) => Math.round(Number(pesos || 0) * 100);

/** The rows of this buyer's order that are paid through PayMongo. */
async function payableRows(buyerUserId, groupId) {
  const rows = await Order.find({ groupId, buyerUserId, paymentMethod: 'PayMongo' });
  if (!rows.length) throw new Error('Order not found.');
  return rows;
}

/**
 * Opens a PayMongo checkout for an order and returns the page to send the
 * buyer to. A new session each time: an old one may have expired, and the
 * newest id is the one a payment is matched against.
 */
export async function startPayment(buyerUserId, groupId) {
  const rows = await payableRows(buyerUserId, groupId);

  if (rows.some((r) => r.status === 'cancelled')) {
    throw new Error('This order was cancelled.');
  }
  if (rows.some((r) => r.paymentStatus !== 'unpaid')) {
    throw new Error('This order is already paid.');
  }

  // Paid on the last page but not recorded yet (no webhook, app closed):
  // record it rather than open a second page and lose track of the first.
  const previous = rows.find((r) => r.paymongoCheckoutId)?.paymongoCheckoutId;
  if (previous) {
    const earlier = paidPaymentOf(await call('GET', `/checkout_sessions/${previous}`));
    if (earlier) {
      await markPaid(previous, earlier);
      throw new Error('This order is already paid.');
    }
    // Retire the old page, so the buyer cannot pay on it as well as on the
    // new one. Best effort: an already expired session refuses, which is fine.
    await call('POST', `/checkout_sessions/${previous}/expire`).catch(() => {});
  }

  const { orderNumber } = rows[0];
  const appUrl = getAppUrl();

  const session = await call('POST', '/checkout_sessions', {
    data: {
      attributes: {
        // One line per order row, with its delivery fee folded in, so the
        // amounts add up to exactly what the orders say.
        line_items: rows.map((row) => ({
          name: row.deliveryFee > 0
            ? `${row.quantity}x ${row.productName} + delivery`
            : `${row.quantity}x ${row.productName}`,
          amount: centavos(row.total),
          currency: 'PHP',
          quantity: 1,
        })),
        payment_method_types: ['gcash', 'paymaya', 'card'],
        description: `AgriFair order ${orderNumber}${isTestKey() ? ' (sandbox)' : ''}`,
        reference_number: orderNumber,
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        success_url: `${appUrl}/payment/done?order=${encodeURIComponent(orderNumber)}`,
        cancel_url: `${appUrl}/payment/cancelled?order=${encodeURIComponent(orderNumber)}`,
        metadata: { groupId, buyerUserId: String(buyerUserId) },
      },
    },
  });

  await Order.updateMany(
    { _id: { $in: rows.map((r) => r._id) } },
    { $set: { paymongoCheckoutId: session.id } },
  );

  return { checkoutUrl: session.attributes.checkout_url, checkoutId: session.id };
}

/** The successful payment on a checkout session, or null. */
function paidPaymentOf(session) {
  const payments = session?.attributes?.payments || [];
  return payments.find((p) => p?.attributes?.status === 'paid') || null;
}

/**
 * Marks every row of a checkout session paid, once. Conditional on the rows
 * not being paid yet, so the webhook and the app's own check arriving
 * together do not record the payment twice.
 */
export async function markPaid(checkoutId, payment) {
  const rows = await Order.find({ paymongoCheckoutId: checkoutId, paymentStatus: 'unpaid' });
  if (!rows.length) return 0;

  // The amount PayMongo collected has to be the amount the order asks for. A
  // session for a different total is not this order's payment.
  const expected = rows.reduce((sum, r) => sum + centavos(r.total), 0);
  const paidAmount = Number(payment?.attributes?.amount);
  if (Number.isFinite(paidAmount) && paidAmount !== expected) {
    console.error('[paymongo] amount mismatch on', checkoutId, paidAmount, 'expected', expected);
    await notify({
      userId: rows[0].sellerId,
      type: 'PAYMENT',
      title: `Online payment for ${rows[0].orderNumber} needs checking`,
      body: `PayMongo reported ₱${(paidAmount / 100).toFixed(2)} but the order is ₱${(expected / 100).toFixed(2)}. It was not marked paid.`,
      link: links.sellerOrder(rows[0]._id),
    });
    return 0;
  }

  const now = new Date();
  for (const row of rows) {
    // Paid after the order was cancelled (the page was still open): the money
    // is real, so it is recorded, and owed back.
    const settled = row.status === 'cancelled' ? 'refund_due' : 'paid';
    const updated = await Order.findOneAndUpdate(
      { _id: row._id, paymentStatus: 'unpaid' },
      {
        $set: {
          paymentStatus: settled,
          amountPaid: Number(row.total),
          paidAt: now,
          paymentReference: payment.id,
          paymentNote: isTestKey() ? 'PayMongo sandbox payment' : 'PayMongo payment',
        },
        $push: {
          paymentHistory: {
            status: settled,
            kind: 'paymongo',
            amount: Number(row.total),
            reference: payment.id,
            note: settled === 'paid' ? 'Confirmed by PayMongo' : 'Paid through PayMongo after the order was cancelled',
            at: now,
          },
        },
      },
    );
    if (!updated) continue;

    await notify({
      userId: row.sellerId,
      type: 'PAYMENT',
      title: `${row.orderNumber} paid online`,
      body: `PayMongo confirmed ₱${Number(row.total).toFixed(2)}${isTestKey() ? ' (sandbox, no real money)' : ''}. You can confirm the order.`,
      link: links.sellerOrder(row._id),
    });
  }

  for (const sellerUserId of new Set(rows.map((r) => r.sellerId))) {
    await postOrderSystemMessage({
      sellerUserId,
      buyerUserId: rows[0].buyerUserId,
      text: `Payment for order ${rows[0].orderNumber} was confirmed by PayMongo.`,
    }).catch(() => {});
  }

  return rows.length;
}

/**
 * The app's "I've paid" check: asks PayMongo about the latest session for
 * this order and records the payment if there is one.
 */
export async function verifyPayment(buyerUserId, groupId) {
  const rows = await payableRows(buyerUserId, groupId);
  if (rows.every((r) => r.paymentStatus !== 'unpaid')) return { paid: true };

  const checkoutId = rows.find((r) => r.paymongoCheckoutId)?.paymongoCheckoutId;
  if (!checkoutId) return { paid: false };

  const session = await call('GET', `/checkout_sessions/${checkoutId}`);
  const payment = paidPaymentOf(session);
  if (!payment) return { paid: false };

  await markPaid(checkoutId, payment);
  return { paid: true };
}

/**
 * Whether a webhook really came from PayMongo. The header looks like
 * `t=<timestamp>,te=<test signature>,li=<live signature>`, each signature an
 * HMAC-SHA256 of `<timestamp>.<raw body>` with the webhook's secret.
 */
export function verifySignature(rawBody, header, secret = process.env.PAYMONGO_WEBHOOK_SECRET) {
  if (!secret || !header) return false;

  const parts = Object.fromEntries(
    String(header).split(',').map((kv) => kv.split('=').map((s) => s.trim())),
  );
  const signature = isTestKey() ? parts.te : (parts.li || parts.te);
  if (!parts.t || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A verified webhook event. Only "checkout session paid" matters here. */
export async function handleWebhook(event) {
  const type = event?.data?.attributes?.type;
  if (type !== 'checkout_session.payment.paid') return { ignored: type || 'unknown' };

  const session = event.data.attributes.data;
  const payment = paidPaymentOf(session);
  if (!session?.id || !payment) return { ignored: 'no paid payment' };

  const marked = await markPaid(session.id, payment);
  return { marked };
}
