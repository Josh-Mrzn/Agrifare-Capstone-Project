import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { verifySignature } from '../src/services/paymongoService.js';
import { transitionBlocker } from '../src/services/orderRules.js';

const SECRET = 'whsk_test_secret';
const sign = (t, body, secret = SECRET) =>
  crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

test('a PayMongo webhook is accepted only with a valid test signature', () => {
  process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
  const body = '{"data":{"attributes":{"type":"checkout_session.payment.paid"}}}';
  const t = '1700000000';

  assert.equal(verifySignature(body, `t=${t},te=${sign(t, body)},li=`, SECRET), true);

  // Body changed after signing, wrong secret, missing header or secret.
  assert.equal(verifySignature(`${body} `, `t=${t},te=${sign(t, body)},li=`, SECRET), false);
  assert.equal(verifySignature(body, `t=${t},te=${sign(t, body, 'other')},li=`, SECRET), false);
  assert.equal(verifySignature(body, '', SECRET), false);
  assert.equal(verifySignature(body, `t=${t},te=${sign(t, body)}`, ''), false);
});

test('a PayMongo order cannot be confirmed before PayMongo says it is paid', () => {
  const order = { paymentMethod: 'PayMongo', paymentStatus: 'unpaid', source: 'storefront' };
  assert.match(transitionBlocker(order, 'confirmed'), /paying online/);
  assert.equal(transitionBlocker({ ...order, paymentStatus: 'paid' }, 'confirmed'), null);
});
