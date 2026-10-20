import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhMobile,
  normalizeGcashReference,
  deliveryFeesBySeller,
  transitionBlocker,
  canMovePayment,
  completionBlocker,
  canAutoComplete,
  sellableWeights,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
} from '../src/services/orderRules.js';
import { DEFAULT_DELIVERY_FEE } from '../src/models/User.js';

test('PH mobile numbers in the ways people type them', () => {
  assert.equal(normalizePhMobile('0917 123 4567'), '09171234567');
  assert.equal(normalizePhMobile('+63 917-123-4567'), '09171234567');
  assert.equal(normalizePhMobile('639171234567'), '09171234567');
  assert.equal(normalizePhMobile('0817 123 4567'), null);
  assert.equal(normalizePhMobile('12345'), null);
  assert.equal(normalizePhMobile(''), null);
});

test('GCash reference numbers are digits only', () => {
  assert.equal(normalizeGcashReference('1234 567 890123'), '1234567890123');
  assert.equal(normalizeGcashReference('abc1234567890'), null);
  assert.equal(normalizeGcashReference('123'), null);
});

test('one delivery fee per seller, only for what can be bought', () => {
  const items = [
    { sellerId: 2, inStock: true },
    { sellerId: 2, inStock: true },
    { sellerId: 7, inStock: true },
    { sellerId: 9, inStock: false },
  ];
  const fees = deliveryFeesBySeller(items, new Map([[2, 50]]));
  assert.deepEqual([...fees], [[2, 50], [7, DEFAULT_DELIVERY_FEE]]);
});

test('a GCash order is confirmed only after the payment is', () => {
  const order = { paymentMethod: 'GCash', paymentStatus: 'proof_sent', source: 'storefront' };
  assert.match(transitionBlocker(order, 'confirmed'), /GCash payment/);
  assert.equal(transitionBlocker({ ...order, paymentStatus: 'paid' }, 'confirmed'), null);
  assert.equal(transitionBlocker({ ...order, paymentMethod: 'Cash/COD' }, 'confirmed'), null);
});

test('shipping needs a rider or a named courier with a tracking number', () => {
  const order = { paymentMethod: 'Cash/COD', source: 'storefront', delivery: {} };
  assert.ok(transitionBlocker(order, 'shipped'));
  assert.ok(transitionBlocker({ ...order, delivery: { courierName: 'LBC' } }, 'shipped'));
  assert.equal(transitionBlocker({ ...order, delivery: { riderUserId: 5 } }, 'shipped'), null);
  assert.equal(
    transitionBlocker({ ...order, delivery: { courierName: 'LBC', courierReference: '123' } }, 'shipped'),
    null,
  );
});

test('delivered needs a photo; completed waits for the buyer', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  // Paid online, so no cash to record at the door.
  const order = { source: 'storefront', paymentMethod: 'PayMongo', paymentStatus: 'paid', delivery: {} };
  assert.ok(transitionBlocker(order, 'delivered', now));
  assert.equal(transitionBlocker({ ...order, delivery: { proofOfDelivery: '/p.jpg' } }, 'delivered', now), null);

  const delivered = (iso) => ({ ...order, delivery: { proofOfDelivery: '/p.jpg', deliveredAt: iso } });
  assert.ok(transitionBlocker(delivered('2026-10-09T00:00:00Z'), 'completed', now));
  assert.equal(transitionBlocker(delivered('2026-10-01T00:00:00Z'), 'completed', now), null);
  // The buyer's own "received" does not wait.
  assert.equal(transitionBlocker(delivered('2026-10-09T00:00:00Z'), 'completed', now, { byBuyer: true }), null);
});

test('cash on delivery is delivered only with the cash recorded', () => {
  const order = { source: 'storefront', paymentMethod: 'Cash/COD', delivery: { proofOfDelivery: '/p.jpg' } };
  assert.match(transitionBlocker(order, 'delivered'), /cash/);
  assert.equal(transitionBlocker({ ...order, codCollection: { collectedAt: new Date() } }, 'delivered'), null);
});

test('a rider who has not accepted cannot be sent out', () => {
  const order = { paymentMethod: 'Cash/COD', source: 'storefront' };
  assert.match(transitionBlocker({ ...order, delivery: { riderUserId: 5, assignmentStatus: 'assigned' } }, 'shipped'), /accept/);
  assert.equal(transitionBlocker({ ...order, delivery: { riderUserId: 5, assignmentStatus: 'accepted' } }, 'shipped'), null);
});

test('payment moves only along the allowed transitions', () => {
  assert.equal(canMovePayment('unpaid', 'paid'), true);
  assert.equal(canMovePayment('proof_sent', 'rejected'), true);
  assert.equal(canMovePayment('rejected', 'proof_sent'), true);
  assert.equal(canMovePayment('paid', 'refund_due'), true);
  assert.equal(canMovePayment('refund_due', 'refunded'), true);
  // Never backwards, never skipping the refund.
  assert.equal(canMovePayment('paid', 'unpaid'), false);
  assert.equal(canMovePayment('paid', 'rejected'), false);
  assert.equal(canMovePayment('paid', 'refunded'), false);
  assert.equal(canMovePayment('refunded', 'paid'), false);
  assert.equal(canMovePayment('rejected', 'paid'), false);
  for (const from of PAYMENT_STATUSES) {
    for (const to of PAYMENT_TRANSITIONS[from]) assert.ok(PAYMENT_STATUSES.includes(to));
  }
});

test('only the sack sizes a seller lists can be bought', () => {
  assert.deepEqual(sellableWeights({ weightTiers: [] }), [1]);
  assert.deepEqual(sellableWeights({ weightTiers: [{ weightKg: 25 }, { weightKg: 5 }, { weightKg: 25 }] }), [5, 25]);
});

test('an order completes only when paid and nothing is open on it', () => {
  const base = { paymentMethod: 'GCash', paymentStatus: 'paid', cancellation: { status: 'none' }, complaint: { status: 'none' } };
  assert.equal(completionBlocker(base), null);
  assert.match(completionBlocker({ ...base, paymentStatus: 'proof_sent' }), /not marked paid/);
  assert.match(completionBlocker({ ...base, paymentMethod: 'Cash/COD', paymentStatus: 'unpaid' }), /cash/);
  assert.match(completionBlocker({ ...base, cancellation: { status: 'requested' } }), /cancel/);
  assert.match(completionBlocker({ ...base, complaint: { status: 'open' } }), /problem/);
});

test('automatic completion waits 7 days and needs proof, payment and nothing open', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const order = {
    status: 'delivered',
    paymentMethod: 'Cash/COD',
    paymentStatus: 'paid',
    delivery: { proofOfDelivery: '/p.jpg', deliveredAt: new Date('2026-10-12T00:00:00Z') },
  };
  assert.equal(canAutoComplete(order, now), true);
  assert.equal(canAutoComplete({ ...order, delivery: { ...order.delivery, deliveredAt: new Date('2026-10-14T00:00:00Z') } }, now), false);
  assert.equal(canAutoComplete({ ...order, delivery: { deliveredAt: order.delivery.deliveredAt } }, now), false);
  assert.equal(canAutoComplete({ ...order, paymentStatus: 'unpaid' }, now), false);
  assert.equal(canAutoComplete({ ...order, complaint: { status: 'open' } }, now), false);
  assert.equal(canAutoComplete({ ...order, status: 'completed' }, now), false);
});

test('sales the seller typed in are not held to the delivery rules', () => {
  assert.equal(transitionBlocker({ source: 'manual', delivery: {} }, 'shipped'), null);
  assert.equal(transitionBlocker({ source: 'manual', delivery: {} }, 'completed'), null);
});
