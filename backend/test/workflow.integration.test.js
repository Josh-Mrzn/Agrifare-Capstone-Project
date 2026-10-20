/**
 * The order, payment, delivery, seller-application and account workflows,
 * end to end through the real HTTP routes against a real MongoDB.
 *
 * Runs only when MONGO_TEST_URI points at a throwaway database:
 *   MONGO_TEST_URI=mongodb://127.0.0.1:27017/agrifair_test npm test
 * It uses its own database next to it (<name>_workflow), wiped before and
 * after, so it can run beside the analytics tests. Never point it at
 * production. No network: PayMongo is exercised through markPaid with
 * payment objects shaped like PayMongo's, never through PayMongo itself.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const URI = process.env.MONGO_TEST_URI
  ? process.env.MONGO_TEST_URI.replace(/\/([^/?]+)(\?|$)/, '/$1_workflow$2')
  : '';
const skip = !URI && 'set MONGO_TEST_URI to run the database tests';

// A 1x1 PNG, for the receipt, permit and doorstep photo uploads.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let server;
let base;
let M; // models
const tokens = {};
const ADDRESS = { _id: new mongoose.Types.ObjectId(), label: 'Home', fullName: 'Buyer One', contact: '09171234567', line: '1 Rizal St', city: 'Science City of Muñoz', province: 'Nueva Ecija', lat: 15.71, lng: 120.9, precision: 'exact', isDefault: true };

const CLIENT_OF = { buyer: 'mobile', rider: 'mobile', seller: 'web', superadmin: 'web' };
function sign(userId, role, client = CLIENT_OF[role]) {
  return jwt.sign({ userId, role, email: `${userId}@test.ph`, cl: client }, process.env.JWT_SECRET);
}

async function api(method, path, who, body, { form, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (who) init.headers.authorization = `Bearer ${tokens[who] || who}`;
  if (form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) {
      if (v instanceof Blob) fd.append(k, v, `${k}.png`);
      else fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    init.body = fd;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const png = () => new Blob([PNG], { type: 'image/png' });
const msg = (r) => r.body?.error || r.body?.message || '';
const productStock = async (id) => (await M.Product.findById(id)).stock;
const rowsOf = (groupId) => M.Order.find({ groupId }).sort({ _id: 1 });

async function cartCheckout(who, items, body = {}) {
  await api('DELETE', '/api/cart', who);
  for (const it of items) {
    const r = await api('POST', '/api/cart/items', who, it);
    assert.equal(r.status, 200, msg(r));
  }
  const form = {
    customerName: 'Buyer One',
    customerContact: '09171234567',
    deliveryAddress: '1 Rizal St, Muñoz',
    addressId: String(ADDRESS._id),
    paymentMethod: 'Cash/COD',
    ...body,
  };
  return api('POST', '/api/cart/checkout', who, undefined, { form });
}

describe('order and account workflows', { skip }, () => {
  const ids = {};

  before(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.CRON_SECRET = 'cron-test-secret';
    delete process.env.PAYMONGO_SECRET_KEY;
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();

    const [{ default: User }, { default: Product }, { default: Order }, { default: Notification }, chat, { default: CheckoutKey }, { default: app }] = await Promise.all([
      import('../src/models/User.js'),
      import('../src/models/Product.js'),
      import('../src/models/Order.js'),
      import('../src/models/Notification.js'),
      import('../src/models/Chat.js'),
      import('../src/models/CheckoutKey.js'),
      import('../src/app.js'),
    ]);
    M = { User, Product, Order, Notification, Conversation: chat.Conversation, CheckoutKey };
    await Promise.all(Object.values(M).map((m) => m.init()));

    const person = (userId, role, name, extra = {}) => ({
      userId, role, name, email: `${name.toLowerCase().replace(/\s/g, '')}@test.ph`,
      password: 'secret123', status: 'active', emailVerified: true, ...extra,
    });
    const verifiedDoc = { type: 'DTI', file: '/api/files/dti.png', status: 'verified' };
    await User.create([
      person(1, 'superadmin', 'Admin'),
      person(2, 'seller', 'Verified Shop', {
        payout: { method: 'gcash', accountName: 'V', accountNumber: '09170000000', status: 'verified', submittedAt: new Date() },
        documents: [verifiedDoc], sellerType: 'farmer', deliveryFee: 50,
      }),
      person(3, 'seller', 'Unverified Shop', { payout: { method: 'gcash', status: 'pending', submittedAt: new Date() }, documents: [verifiedDoc] }),
      person(4, 'seller', 'Applicant Shop', { status: 'pending' }),
      person(5, 'seller', 'Second Applicant', { status: 'pending' }),
      person(10, 'buyer', 'Buyer One', { addresses: [ADDRESS] }),
      person(11, 'buyer', 'Buyer Two', { addresses: [ADDRESS] }),
      person(20, 'rider', 'Rider One', { employedBy: 2, contact: '09180000000' }),
      person(21, 'rider', 'Rider Two', { employedBy: 3 }),
    ]);
    for (const [who, id, role] of [
      ['admin', 1, 'superadmin'], ['seller', 2, 'seller'], ['seller2', 3, 'seller'], ['applicant', 4, 'seller'],
      ['applicant2', 5, 'seller'], ['buyer', 10, 'buyer'], ['buyer2', 11, 'buyer'], ['rider', 20, 'rider'], ['rider2', 21, 'rider'],
    ]) tokens[who] = sign(id, role);

    const [rice, plain] = await Product.create([
      { name: 'Dinorado', variety: 'Other', price: 50, description: 'd', stock: 1000, createdBy: 2, images: ['/x.png'], weightTiers: [{ weightKg: 5, discountPercent: 0 }, { weightKg: 25, discountPercent: 0 }] },
      { name: 'Sinandomeng', variety: 'Sinandomeng', price: 40, description: 'd', stock: 100, createdBy: 3, images: ['/x.png'] },
    ]);
    ids.rice = rice._id;
    ids.plain = plain._id;

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  // ------------------------------------------------------------ catalogue and checkout

  test('only the pack sizes a seller lists can go in the cart', async () => {
    const odd = await api('POST', '/api/cart/items', 'buyer', { productId: ids.rice, weightKg: 7, quantity: 1 });
    assert.equal(odd.status, 400);
    assert.match(msg(odd), /5 kg, 25 kg only/);
    const ok = await api('POST', '/api/cart/items', 'buyer', { productId: ids.rice, weightKg: 25, quantity: 1 });
    assert.equal(ok.status, 200, msg(ok));
    // No tiers listed: 1 kg only.
    const none = await api('POST', '/api/cart/items', 'buyer', { productId: ids.plain, weightKg: 25, quantity: 1 });
    assert.equal(none.status, 400);
  });

  test('GCash is refused for a shop whose GCash is not verified', async () => {
    const r = await cartCheckout('buyer', [{ productId: ids.plain, weightKg: 1, quantity: 2 }], {
      paymentMethod: 'GCash', paymentReference: '1234567890123', paymentProof: png(),
    });
    assert.equal(r.status, 400);
    assert.match(msg(r), /does not accept GCash/);
    assert.equal(await M.Order.countDocuments({}), 0);
  });

  test('a repeated checkout with the same key places one order', async () => {
    const items = [{ productId: ids.rice, weightKg: 5, quantity: 1 }];
    const first = await cartCheckout('buyer', items, { checkoutKey: 'key-1' });
    assert.equal(first.status, 200, msg(first));
    // Same key again, as a retry after a dropped connection would send it.
    await api('POST', '/api/cart/items', 'buyer', items[0]);
    const again = await api('POST', '/api/cart/checkout', 'buyer', undefined, {
      form: { customerName: 'Buyer One', deliveryAddress: 'x', addressId: String(ADDRESS._id), paymentMethod: 'Cash/COD', checkoutKey: 'key-1' },
    });
    assert.equal(again.status, 200, msg(again));
    assert.equal(again.body.orderNumber, first.body.orderNumber);
    assert.equal(again.body.duplicate, true);
    assert.equal(await M.Order.countDocuments({ groupId: first.body.groupId }), 1);
    assert.equal(await M.Order.countDocuments({}), 1);
    ids.codGroup = first.body.groupId;
  });

  test('the seller is notified of a new order, with a link to it', async () => {
    const [row] = await rowsOf(ids.codGroup);
    const n = await M.Notification.findOne({ userId: 2, title: /New order/ });
    assert.ok(n);
    assert.equal(n.link, `/client?tab=orders&order=${row._id}`);
  });

  test('a pending unpaid order is cancelled by the buyer at once', async () => {
    const r = await api('POST', `/api/buyer/orders/${ids.codGroup}/cancel`, 'buyer', { reason: 'Changed my mind' });
    assert.equal(r.status, 200, msg(r));
    assert.equal(r.body.cancellationOutcome, 'cancelled');
    const [row] = await rowsOf(ids.codGroup);
    assert.equal(row.status, 'cancelled');
    assert.equal(row.paymentStatus, 'unpaid');
    // Nothing was deducted, so nothing comes back.
    assert.equal(await productStock(ids.rice), 1000);
    assert.ok(await M.Notification.findOne({ userId: 2, title: /cancelled/ }));
  });

  // ------------------------------------------------------------ GCash, cancellation request, rider, completion

  test('GCash: receipt, cancellation request, rejection, resubmission, approval', async () => {
    const r = await cartCheckout('buyer', [
      { productId: ids.rice, weightKg: 25, quantity: 2 },
      { productId: ids.rice, weightKg: 5, quantity: 1 },
    ], { paymentMethod: 'GCash', paymentReference: '1111 2222 33333', paymentProof: png() });
    assert.equal(r.status, 200, msg(r));
    ids.gcash = r.body.groupId;
    let rows = await rowsOf(ids.gcash);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => x.paymentStatus === 'proof_sent'));
    // One delivery fee for the seller-order, not one per line.
    assert.equal(rows.reduce((s, x) => s + x.deliveryFee, 0), 50);
    ids.gcashRow = String(rows[0]._id);

    // With a receipt sent, the buyer's cancel becomes a request.
    const cancel = await api('POST', `/api/buyer/orders/${ids.gcash}/cancel`, 'buyer', { reason: 'Wrong address' });
    assert.equal(cancel.status, 200, msg(cancel));
    assert.equal(cancel.body.cancellationOutcome, 'requested');
    rows = await rowsOf(ids.gcash);
    assert.ok(rows.every((x) => x.status === 'pending' && x.cancellation.status === 'requested'));

    // The seller decides: no, with a reason.
    const keep = await api('PUT', `/api/admin/orders/${ids.gcashRow}/cancellation`, 'seller', { approve: false, note: 'Already packed for you' });
    assert.equal(keep.status, 200, msg(keep));
    assert.equal((await rowsOf(ids.gcash))[0].cancellation.status, 'rejected');

    // Payment not found: rejected, buyer told, buyer sends a new receipt.
    const reject = await api('PUT', `/api/admin/orders/${ids.gcashRow}/payment`, 'seller', { paid: false, note: 'Not in my GCash' });
    assert.equal(reject.status, 200, msg(reject));
    rows = await rowsOf(ids.gcash);
    assert.ok(rows.every((x) => x.paymentStatus === 'rejected'));
    assert.ok(await M.Notification.findOne({ userId: 10, title: /not found/, link: `/orders/${ids.gcash}` }));

    const stale = await api('POST', `/api/buyer/orders/${ids.gcash}/payment-proof`, 'buyer', undefined, {
      form: { paymentReference: '1111222233333', paymentProof: png() },
    });
    assert.equal(stale.status, 200, msg(stale));
    rows = await rowsOf(ids.gcash);
    assert.ok(rows.every((x) => x.paymentStatus === 'proof_sent'));
    assert.ok(rows[0].paymentHistory.some((h) => h.kind === 'resubmit'));

    // Confirming before the money is checked is refused.
    const early = await api('PUT', `/api/admin/orders/${ids.gcashRow}/status`, 'seller', { status: 'confirmed' });
    assert.equal(early.status, 400);

    const approve = await api('PUT', `/api/admin/orders/${ids.gcashRow}/payment`, 'seller', { paid: true, reference: '1111222233333' });
    assert.equal(approve.status, 200, msg(approve));
    rows = await rowsOf(ids.gcash);
    assert.ok(rows.every((x) => x.paymentStatus === 'paid'));
    const due = rows.reduce((s, x) => s + x.total, 0);
    assert.equal(Math.round(rows.reduce((s, x) => s + x.amountPaid, 0) * 100) / 100, due);

    // Reviewing again: nothing is waiting, and paid never goes back.
    const twice = await api('PUT', `/api/admin/orders/${ids.gcashRow}/payment`, 'seller', { paid: false, note: 'oops' });
    assert.equal(twice.status, 400);
    assert.equal((await rowsOf(ids.gcash))[0].paymentStatus, 'paid');
  });

  test('confirming deducts stock for every line of the seller-order', async () => {
    const r = await api('PUT', `/api/admin/orders/${ids.gcashRow}/status`, 'seller', { status: 'confirmed' });
    assert.equal(r.status, 200, msg(r));
    const rows = await rowsOf(ids.gcash);
    assert.ok(rows.every((x) => x.status === 'confirmed' && x.stockDeducted));
    assert.equal(await productStock(ids.rice), 1000 - 50 - 5);
    // A double click confirms (and deducts) once.
    const again = await api('PUT', `/api/admin/orders/${ids.gcashRow}/status`, 'seller', { status: 'confirmed' });
    assert.equal(again.status, 400);
    assert.equal(await productStock(ids.rice), 945);
    assert.ok(await M.Notification.findOne({ userId: 10, title: /confirmed/ }));
  });

  test('a rider is assigned, must accept, and only then can take it out', async () => {
    await api('PUT', `/api/admin/orders/${ids.gcashRow}/status`, 'seller', { status: 'processing' });
    const other = await api('PUT', `/api/riders/assign/${ids.gcashRow}`, 'seller', { riderUserId: 21 });
    assert.equal(other.status, 400, 'another shop\'s rider');

    const assign = await api('PUT', `/api/riders/assign/${ids.gcashRow}`, 'seller', { riderUserId: 20 });
    assert.equal(assign.status, 200, msg(assign));
    const rows = await rowsOf(ids.gcash);
    assert.ok(rows.every((x) => x.delivery.riderUserId === 20 && x.delivery.assignmentStatus === 'assigned'));
    assert.ok(await M.Notification.findOne({ userId: 20, link: `/rider?order=${ids.gcashRow}` }));

    const ship = await api('PUT', `/api/admin/orders/${ids.gcashRow}/status`, 'seller', { status: 'shipped' });
    assert.equal(ship.status, 400);
    assert.match(msg(ship), /accept/);

    // Another rider cannot see or act on it.
    assert.equal((await api('GET', `/api/riders/me/deliveries/${ids.gcashRow}`, 'rider2')).status, 400);
    assert.equal((await api('POST', `/api/riders/me/deliveries/${ids.gcashRow}/accept`, 'rider2')).status, 400);

    const list = await api('GET', '/api/riders/me/deliveries', 'rider');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1, 'one entry per seller-order');
    assert.equal(list.body[0].items.length, 2);
    assert.equal(list.body[0].canAccept, true);
    assert.equal(list.body[0].amountToCollect, 0, 'already paid by GCash');

    const accept = await api('POST', `/api/riders/me/deliveries/${ids.gcashRow}/accept`, 'rider');
    assert.equal(accept.status, 200, msg(accept));
    assert.equal(accept.body.assignmentStatus, 'accepted');
    assert.ok(await M.Notification.findOne({ userId: 2, title: /accepted/ }));
  });

  test('the rider starts the trip, uploads proof, then marks it delivered (retries are safe)', async () => {
    const start = await api('POST', `/api/riders/me/deliveries/${ids.gcashRow}/start`, 'rider');
    assert.equal(start.status, 200, msg(start));
    assert.equal(start.body.status, 'shipped');

    const noProof = await api('POST', `/api/riders/me/deliveries/${ids.gcashRow}/delivered`, 'rider', {});
    assert.equal(noProof.status, 400);
    assert.match(msg(noProof), /photo/);

    const proof = await api('POST', `/api/riders/me/deliveries/${ids.gcashRow}/proof`, 'rider', undefined, { form: { proof: png() } });
    assert.equal(proof.status, 200, msg(proof));
    assert.equal(proof.body.status, 'shipped', 'proof alone does not deliver');
    assert.ok(proof.body.proofOfDelivery.startsWith('/api/files/'));

    const done = await api('POST', `/api/riders/me/deliveries/${ids.gcashRow}/delivered`, 'rider', {});
    assert.equal(done.status, 200, msg(done));
    assert.equal(done.body.status, 'delivered');
    const retry = await api('POST', `/api/riders/me/deliveries/${ids.gcashRow}/delivered`, 'rider', {});
    assert.equal(retry.status, 200, msg(retry));
    const rows = await rowsOf(ids.gcash);
    assert.ok(rows.every((x) => x.status === 'delivered' && x.delivery.deliveredBy === 20));
    assert.equal(rows[0].statusHistory.filter((h) => h.status === 'delivered').length, 1);
    assert.ok(await M.Notification.findOne({ userId: 10, title: /delivered/ }));
  });

  test('rider and buyer can message about the delivery, and only about it', async () => {
    const noRef = await api('POST', '/api/chat/send', 'rider', { receiverUserId: 10, text: 'Nasa labas na po' });
    assert.equal(noRef.status, 400);
    const ok = await api('POST', '/api/chat/send', 'rider', { receiverUserId: 10, text: 'Nasa labas na po', orderRef: ids.gcash });
    assert.equal(ok.status, 201, msg(ok));
    const convo = await M.Conversation.findById(ok.body.conversationId);
    assert.equal(convo.orderRef, ids.gcash);
    const reply = await api('POST', '/api/chat/send', 'buyer', { receiverUserId: 20, text: 'Salamat po', orderRef: ids.gcash });
    assert.equal(reply.status, 201, msg(reply));
    assert.equal(String(reply.body.conversationId), String(ok.body.conversationId));
    // Not a delivery of theirs.
    const stranger = await api('POST', '/api/chat/send', 'rider', { receiverUserId: 11, text: 'hi', orderRef: ids.gcash });
    assert.equal(stranger.status, 400);
  });

  test('a reported problem holds completion until the seller resolves it', async () => {
    const report = await api('POST', `/api/buyer/orders/${ids.gcash}/problem`, 'buyer', { reason: 'One sack torn' });
    assert.equal(report.status, 200, msg(report));
    assert.equal(report.body.problemOpen, true);

    const confirm = await api('POST', `/api/buyer/orders/${ids.gcash}/received`, 'buyer');
    assert.equal(confirm.status, 400);
    assert.match(msg(confirm), /problem/);

    const resolve = await api('PUT', `/api/admin/orders/${ids.gcashRow}/problem`, 'seller', { note: 'Replaced the sack' });
    assert.equal(resolve.status, 200, msg(resolve));

    const ok = await api('POST', `/api/buyer/orders/${ids.gcash}/received`, 'buyer');
    assert.equal(ok.status, 200, msg(ok));
    assert.ok((await rowsOf(ids.gcash)).every((x) => x.status === 'completed'));
  });

  test('the rider thread closes once the delivery is finished', async () => {
    const late = await api('POST', '/api/chat/send', 'rider', { receiverUserId: 10, text: 'hello again', orderRef: ids.gcash });
    assert.equal(late.status, 400);
  });

  // ------------------------------------------------------------ paid then cancelled: refund

  test('a paid order cancelled by the seller is owed back, restocked exactly once, then refunded', async () => {
    const r = await cartCheckout('buyer', [{ productId: ids.rice, weightKg: 25, quantity: 1 }], {
      paymentMethod: 'GCash', paymentReference: '9999888877776', paymentProof: png(),
    });
    assert.equal(r.status, 200, msg(r));
    const [row] = await rowsOf(r.body.groupId);
    const id = String(row._id);
    await api('PUT', `/api/admin/orders/${id}/payment`, 'seller', { paid: true });
    assert.equal((await api('PUT', `/api/admin/orders/${id}/status`, 'seller', { status: 'confirmed' })).status, 200);
    const before = await productStock(ids.rice);

    const noReason = await api('PUT', `/api/admin/orders/${id}/status`, 'seller', { status: 'cancelled' });
    assert.equal(noReason.status, 400);
    const cancel = await api('PUT', `/api/admin/orders/${id}/status`, 'seller', { status: 'cancelled', reason: 'Flooded warehouse' });
    assert.equal(cancel.status, 200, msg(cancel));
    assert.equal(await productStock(ids.rice), before + 25);
    const again = await api('PUT', `/api/admin/orders/${id}/status`, 'seller', { status: 'cancelled', reason: 'again' });
    assert.equal(again.status, 400);
    assert.equal(await productStock(ids.rice), before + 25, 'restocked once');

    let fresh = await M.Order.findById(id);
    assert.equal(fresh.paymentStatus, 'refund_due');

    const short = await api('PUT', `/api/admin/orders/${id}/refund`, 'seller', { amount: 10, reference: '123' });
    assert.equal(short.status, 400, 'less than received needs a note');
    const refund = await api('PUT', `/api/admin/orders/${id}/refund`, 'seller', { reference: '5555444433332' });
    assert.equal(refund.status, 200, msg(refund));
    fresh = await M.Order.findById(id);
    assert.equal(fresh.paymentStatus, 'refunded');
    assert.equal(fresh.refund.amount, fresh.amountPaid);
    assert.ok(await M.Notification.findOne({ userId: 10, title: /Refund recorded/ }));
    ids.refundedAmount = fresh.refund.amount;
  });

  test('refunds show in the seller analytics', async () => {
    const r = await api('GET', '/api/analytics/seller/sales?preset=30d', 'seller');
    assert.equal(r.status, 200, msg(r));
    const k = r.body.kpis.find((x) => x.id === 'refunded');
    assert.equal(k.value, ids.refundedAmount);
  });

  // ------------------------------------------------------------ cash on delivery and auto-complete

  test('COD: a short collection is not paid until the seller corrects it; auto-complete then closes it', async () => {
    const r = await cartCheckout('buyer2', [{ productId: ids.rice, weightKg: 5, quantity: 2 }]);
    assert.equal(r.status, 200, msg(r));
    const [row] = await rowsOf(r.body.groupId);
    const id = String(row._id);
    for (const status of ['confirmed', 'processing']) {
      assert.equal((await api('PUT', `/api/admin/orders/${id}/status`, 'seller', { status })).status, 200);
    }
    await api('PUT', `/api/riders/assign/${id}`, 'seller', { riderUserId: 20 });
    await api('POST', `/api/riders/me/deliveries/${id}/accept`, 'rider');
    await api('POST', `/api/riders/me/deliveries/${id}/start`, 'rider');
    await api('POST', `/api/riders/me/deliveries/${id}/proof`, 'rider', undefined, { form: { proof: png() } });

    const view = await api('GET', `/api/riders/me/deliveries/${id}`, 'rider');
    assert.equal(view.body.amountToCollect, row.total);

    const noCash = await api('POST', `/api/riders/me/deliveries/${id}/delivered`, 'rider', {});
    assert.equal(noCash.status, 400);
    const short = await api('POST', `/api/riders/me/deliveries/${id}/delivered`, 'rider', { cashCollected: row.total - 100 });
    assert.equal(short.status, 200, msg(short));
    let fresh = await M.Order.findById(id);
    assert.equal(fresh.status, 'delivered');
    assert.equal(fresh.paymentStatus, 'unpaid');
    assert.ok(await M.Notification.findOne({ userId: 2, title: /does not match/ }));

    // Eight days later, still unpaid: the job leaves it alone.
    await M.Order.updateOne({ _id: id }, { $set: { 'delivery.deliveredAt': new Date(Date.now() - 8 * 86400000) } });
    const noSecret = await api('POST', '/api/jobs/auto-complete', null);
    assert.equal(noSecret.status, 401);
    let job = await api('POST', '/api/jobs/auto-complete', null, undefined, { headers: { 'x-cron-secret': 'cron-test-secret' } });
    assert.equal(job.status, 200, msg(job));
    assert.equal((await M.Order.findById(id)).status, 'delivered');

    const noNote = await api('PUT', `/api/admin/orders/${id}/cod`, 'seller', { amount: row.total });
    assert.equal(noNote.status, 400);
    const fix = await api('PUT', `/api/admin/orders/${id}/cod`, 'seller', { amount: row.total, note: 'Rider handed over the rest' });
    assert.equal(fix.status, 200, msg(fix));
    fresh = await M.Order.findById(id);
    assert.equal(fresh.paymentStatus, 'paid');
    assert.deepEqual(fresh.paymentHistory.map((h) => h.kind), ['cod', 'correction']);

    job = await api('POST', '/api/jobs/auto-complete', null, undefined, { headers: { 'x-cron-secret': 'cron-test-secret' } });
    assert.equal(job.body.completed, 1);
    fresh = await M.Order.findById(id);
    assert.equal(fresh.status, 'completed');
    assert.equal(fresh.statusHistory.at(-1).by, 'system');
  });

  test('a rider may decline, which hands the order back to the seller', async () => {
    const r = await cartCheckout('buyer2', [{ productId: ids.rice, weightKg: 5, quantity: 1 }]);
    const [row] = await rowsOf(r.body.groupId);
    const id = String(row._id);
    await api('PUT', `/api/admin/orders/${id}/status`, 'seller', { status: 'confirmed' });
    await api('PUT', `/api/riders/assign/${id}`, 'seller', { riderUserId: 20 });
    const noReason = await api('POST', `/api/riders/me/deliveries/${id}/decline`, 'rider', {});
    assert.equal(noReason.status, 400);
    const decline = await api('POST', `/api/riders/me/deliveries/${id}/decline`, 'rider', { reason: 'Motor is broken' });
    assert.equal(decline.status, 200, msg(decline));
    const fresh = await M.Order.findById(id);
    assert.equal(fresh.delivery.riderUserId, null);
    assert.equal(fresh.delivery.assignmentStatus, 'declined');
    assert.ok(await M.Notification.findOne({ userId: 2, title: /declined/ }));
    assert.equal((await api('GET', `/api/riders/me/deliveries/${id}`, 'rider')).status, 400);
  });

  // ------------------------------------------------------------ PayMongo

  test('PayMongo is never confirmed by hand, and only for the right amount', async () => {
    const { markPaid } = await import('../src/services/paymongoService.js');
    const row = await M.Order.create({
      sellerId: 2, productId: ids.rice, productName: 'Dinorado (5 kg)', unitPrice: 250, quantity: 1, weightKg: 5,
      subtotal: 250, deliveryFee: 50, total: 300, paymentMethod: 'PayMongo', buyerUserId: 10, status: 'pending',
      source: 'storefront', orderNumber: 'AGF-PM0001', groupId: 'pm-group-1', paymongoCheckoutId: 'cs_test_1',
      customerName: 'Buyer One', deliveryAddress: 'x',
    });
    const manual = await api('PUT', `/api/admin/orders/${row._id}/payment`, 'seller', { paid: true });
    assert.equal(manual.status, 400);
    assert.match(msg(manual), /PayMongo/);
    const confirm = await api('PUT', `/api/admin/orders/${row._id}/status`, 'seller', { status: 'confirmed' });
    assert.equal(confirm.status, 400);

    assert.equal(await markPaid('cs_test_1', { id: 'pay_x', attributes: { status: 'paid', amount: 100 } }), 0);
    assert.equal((await M.Order.findById(row._id)).paymentStatus, 'unpaid');
    assert.equal(await markPaid('cs_test_1', { id: 'pay_1', attributes: { status: 'paid', amount: 30000 } }), 1);
    // The webhook and the app's own check arriving together record it once.
    assert.equal(await markPaid('cs_test_1', { id: 'pay_1', attributes: { status: 'paid', amount: 30000 } }), 0);
    const paid = await M.Order.findById(row._id);
    assert.equal(paid.paymentStatus, 'paid');
    assert.equal(paid.paymentHistory.length, 1);
    assert.equal(paid.paymentHistory[0].kind, 'paymongo');

    // Paid on a page left open after the order was cancelled: owed back.
    const late = await M.Order.create({
      sellerId: 2, productId: ids.rice, productName: 'Dinorado (5 kg)', unitPrice: 250, quantity: 1, weightKg: 5,
      subtotal: 250, deliveryFee: 50, total: 300, paymentMethod: 'PayMongo', buyerUserId: 10, status: 'cancelled',
      source: 'storefront', orderNumber: 'AGF-PM0002', groupId: 'pm-group-2', paymongoCheckoutId: 'cs_test_2',
      customerName: 'Buyer One', deliveryAddress: 'x',
    });
    await markPaid('cs_test_2', { id: 'pay_2', attributes: { status: 'paid', amount: 30000 } });
    assert.equal((await M.Order.findById(late._id)).paymentStatus, 'refund_due');
  });

  // ------------------------------------------------------------ roles, apps and chat

  test('each role signs in to its own app only', async () => {
    const login = (email, client) => api('POST', '/api/auth/login', null, { email, password: 'secret123' }, { headers: { 'x-client': client } });
    assert.equal((await login('buyerone@test.ph', 'mobile')).status, 200);
    const wrong = await login('buyerone@test.ph', 'web');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, 'WRONG_APP');
    assert.equal((await login('verifiedshop@test.ph', 'web')).status, 200);
    assert.equal((await login('verifiedshop@test.ph', 'mobile')).status, 401);
    assert.equal((await login('admin@test.ph', 'mobile')).status, 401);
    assert.equal((await login('riderone@test.ph', 'mobile')).status, 200);
    assert.equal((await login('riderone@test.ph', 'web')).status, 200);
    // A token minted for the wrong app is refused by the API itself.
    const r = await api('GET', '/api/buyer/orders', sign(10, 'buyer', 'web'));
    assert.equal(r.status, 403);
  });

  test('buyer pages and the cart are for buyers only', async () => {
    assert.equal((await api('GET', '/api/buyer/orders', 'seller')).status, 403);
    assert.equal((await api('POST', '/api/cart/items', 'rider', { productId: ids.rice, weightKg: 5, quantity: 1 })).status, 403);
    assert.equal((await api('GET', '/api/admin/orders', 'buyer')).status, 403);
  });

  test('chat is limited to people with business together', async () => {
    assert.equal((await api('POST', '/api/chat/send', 'buyer', { receiverUserId: 11, text: 'hi' })).status, 400, 'buyer to buyer');
    assert.equal((await api('POST', '/api/chat/send', 'seller', { receiverUserId: 3, text: 'hi' })).status, 400, 'shop to shop');
    assert.equal((await api('POST', '/api/chat/send', 'rider', { receiverUserId: 3, text: 'hi' })).status, 400, 'rider to another shop');
    assert.equal((await api('POST', '/api/chat/send', 'buyer', { receiverUserId: 2, text: 'May stock pa po?' })).status, 201);
    assert.equal((await api('POST', '/api/chat/send', 'rider', { receiverUserId: 2, text: 'Paalis na po' })).status, 201);
    assert.equal((await api('POST', '/api/chat/send', 'admin', { receiverUserId: 20, text: 'Support here' })).status, 201);
    const n = await M.Notification.findOne({ userId: 10, type: 'MESSAGE' }).sort({ createdAt: -1 });
    assert.match(n.link, /^\/messages\//);
  });

  test('signing up needs an explicit role', async () => {
    const r = await api('POST', '/api/auth/register', null, { name: 'No Role', email: 'norole@test.ph', password: 'secret123' });
    assert.equal(r.status, 400);
    assert.equal(await M.User.countDocuments({ email: 'norole@test.ph' }), 0);
  });

  // ------------------------------------------------------------ seller application

  test('a pending seller has a limited account until approved', async () => {
    const login = await api('POST', '/api/auth/login', null, { email: 'applicantshop@test.ph', password: 'secret123' }, { headers: { 'x-client': 'web' } });
    assert.equal(login.status, 200, msg(login));
    assert.equal(login.body.user.status, 'pending');
    const tools = await api('GET', '/api/admin/products', 'applicant');
    assert.equal(tools.status, 403);
    assert.equal(tools.body.code, 'SELLER_NOT_APPROVED');
    assert.equal((await api('GET', '/api/analytics/seller/overview', 'applicant')).status, 403);
    assert.equal((await api('POST', '/api/chat/send', 'applicant', { receiverUserId: 10, text: 'hi' })).status, 400);
  });

  test('a seller is approved only after submitting with a verified permit', async () => {
    const early = await api('PUT', '/api/superadmin/approvals/4/approve', 'admin');
    assert.equal(early.status, 400);
    assert.match(msg(early), /not submitted/);

    const incomplete = await api('POST', '/api/user/seller-application', 'applicant');
    assert.equal(incomplete.status, 400);

    const profile = await api('PUT', '/api/user/edit', 'applicant', undefined, {
      form: { sellerType: 'trader', sellerProfile: { businessName: 'Applicant Rice Trading' }, documentMeta: { type: 'DTI', referenceNo: 'DTI-1' }, document: png() },
    });
    assert.equal(profile.status, 200, msg(profile));
    const submit = await api('POST', '/api/user/seller-application', 'applicant');
    assert.equal(submit.status, 200, msg(submit));
    assert.ok(await M.Notification.findOne({ userId: 1, link: '/superadmin?tab=users' }));
    const queue = await api('GET', '/api/superadmin/approvals/pending', 'admin');
    assert.deepEqual(queue.body.map((u) => u.userId), [4]);

    const unverified = await api('PUT', '/api/superadmin/approvals/4/approve', 'admin');
    assert.equal(unverified.status, 400);
    assert.match(msg(unverified), /permit/);

    const verify = await api('PUT', '/api/superadmin/users/4/credentials', 'admin', { kind: 'document', docType: 'DTI', approve: true });
    assert.equal(verify.status, 200, msg(verify));
    const approve = await api('PUT', '/api/superadmin/approvals/4/approve', 'admin');
    assert.equal(approve.status, 200, msg(approve));
    assert.equal((await M.User.findOne({ userId: 4 })).status, 'active');
    assert.ok(await M.Notification.findOne({ userId: 4, title: /approved/ }));
    assert.equal((await api('GET', '/api/admin/products', 'applicant')).status, 200);
  });

  test('a rejected seller can fix the application and submit it again', async () => {
    await api('PUT', '/api/user/edit', 'applicant2', undefined, {
      form: { sellerType: 'farmer', sellerProfile: { businessName: 'Second Farm' }, documentMeta: { type: 'BIR' }, document: png() },
    });
    assert.equal((await api('POST', '/api/user/seller-application', 'applicant2')).status, 200);
    const reject = await api('PUT', '/api/superadmin/approvals/5/reject', 'admin', { reason: 'Permit is blurry.' });
    assert.equal(reject.status, 200, msg(reject));
    const login = await api('POST', '/api/auth/login', null, { email: 'secondapplicant@test.ph', password: 'secret123' }, { headers: { 'x-client': 'web' } });
    assert.equal(login.status, 200, msg(login));
    assert.equal(login.body.user.status, 'rejected');
    assert.equal(login.body.user.statusReason, 'Permit is blurry.');
    const again = await api('POST', '/api/user/seller-application', 'applicant2');
    assert.equal(again.status, 200, msg(again));
    assert.equal((await M.User.findOne({ userId: 5 })).status, 'pending');
  });

  test('status cannot be changed around the approval and deactivation rules', async () => {
    assert.equal((await api('PUT', '/api/superadmin/users/5', 'admin', { status: 'active' })).status, 400);
    assert.equal((await api('PUT', '/api/superadmin/users/5/activate', 'admin')).status, 400);
    assert.equal((await M.User.findOne({ userId: 5 })).status, 'pending');
  });

  // ------------------------------------------------------------ closed sellers and deactivation

  test('a suspended seller\'s products cannot be found or bought', async () => {
    assert.equal((await api('PUT', '/api/superadmin/users/3/suspend', 'admin')).status, 200);
    const list = await api('GET', '/api/products', null);
    const names = list.body.data.map((p) => p.name);
    assert.ok(!names.includes('Sinandomeng'));
    assert.equal((await api('POST', '/api/cart/items', 'buyer', { productId: ids.plain, weightKg: 1, quantity: 1 })).status, 400);
  });

  test('deleting an account deactivates it and keeps its history', async () => {
    assert.equal((await api('DELETE', '/api/superadmin/users/1', 'admin')).status, 400, 'not yourself');
    const ordersBefore = await M.Order.countDocuments({ buyerUserId: 11 });
    const r = await api('DELETE', '/api/superadmin/users/11', 'admin');
    assert.equal(r.status, 200, msg(r));
    const user = await M.User.findOne({ userId: 11 });
    assert.equal(user.status, 'deactivated');
    assert.equal(await M.Order.countDocuments({ buyerUserId: 11 }), ordersBefore);
    assert.equal((await api('GET', '/api/buyer/orders', 'buyer2')).status, 401);
    const login = await api('POST', '/api/auth/login', null, { email: 'buyertwo@test.ph', password: 'secret123' }, { headers: { 'x-client': 'mobile' } });
    assert.equal(login.status, 401);
    assert.equal(login.body.code, 'ACCOUNT_DEACTIVATED');
    // And it can be brought back.
    assert.equal((await api('PUT', '/api/superadmin/users/11/activate', 'admin')).status, 200);
  });

  test('a rider can change their own name and password, not shop settings', async () => {
    const r = await api('PUT', '/api/user/edit', 'rider', { name: 'Rider Juan', deliveryFee: 1 });
    assert.equal(r.status, 200, msg(r));
    const rider = await M.User.findOne({ userId: 20 });
    assert.equal(rider.name, 'Rider Juan');
    assert.equal(rider.deliveryFee, null);
    const pw = await api('PUT', '/api/user/reset-password', 'rider', { currentPassword: 'secret123', newPassword: 'newsecret456' });
    assert.equal(pw.status, 200, msg(pw));
  });
});
