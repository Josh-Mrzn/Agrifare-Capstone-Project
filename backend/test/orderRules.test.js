import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhMobile,
  normalizeGcashReference,
  deliveryFeesBySeller,
  transitionBlocker,
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
  const order = { source: 'storefront', delivery: {} };
  assert.ok(transitionBlocker(order, 'delivered', now));
  assert.equal(transitionBlocker({ ...order, delivery: { proofOfDelivery: '/p.jpg' } }, 'delivered', now), null);

  const delivered = (iso) => ({ ...order, delivery: { proofOfDelivery: '/p.jpg', deliveredAt: iso } });
  assert.ok(transitionBlocker(delivered('2026-10-09T00:00:00Z'), 'completed', now));
  assert.equal(transitionBlocker(delivered('2026-10-01T00:00:00Z'), 'completed', now), null);
});

test('sales the seller typed in are not held to the delivery rules', () => {
  assert.equal(transitionBlocker({ source: 'manual', delivery: {} }, 'shipped'), null);
  assert.equal(transitionBlocker({ source: 'manual', delivery: {} }, 'completed'), null);
});
