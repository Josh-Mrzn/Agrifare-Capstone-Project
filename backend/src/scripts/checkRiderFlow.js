import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { riderService } from '../services/riderService.js';
import { activationService, hashActivationToken } from '../services/activationService.js';
import { authService } from '../services/authService.js';
import * as deliveryService from '../services/deliveryService.js';

/**
 * Walks the whole delivery-person flow against the real database.
 *
 * Run:  node src/scripts/checkRiderFlow.js
 *
 * Creates (and re-creates) a rider on rider@agrifair.invalid working for
 * seller 6, activates them, assigns them an order, and delivers it. Safe to
 * run again - it clears the previous test rider first - but it does move one
 * real order along, so it is a development tool, not something to point at
 * live data.
 *
 * The activation link is planted rather than emailed: only the hash is stored,
 * so a script cannot read the real one.
 */

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

const SELLER = 6;
const EMAIL = 'rider@agrifair.invalid';
const PASSWORD = 'riderpass123';

// Start clean so the run repeats.
const old = await User.findOne({ email: EMAIL });
if (old) {
  await User.deleteOne({ _id: old._id });
  await Order.updateMany(
    { 'delivery.riderUserId': old.userId },
    { $set: { 'delivery.riderUserId': null } },
  );
}

console.log('1. seller adds a delivery person (name + email only)');
const rider = await riderService.add(SELLER, { name: 'Mang Tonyo Rider', email: EMAIL });
console.log('   ->', JSON.stringify({ userId: rider.userId, activated: rider.activated, linkSent: rider.linkSent }));

console.log('2. the account cannot be signed into yet');
try {
  await authService.login({ email: EMAIL, password: PASSWORD });
  console.log('   -> PROBLEM: it let us in');
} catch (err) {
  console.log('   ->', err.code || '-', '|', err.message);
}

console.log('3. rider opens the emailed link and picks a password');
// Only the hash is stored, so a test plants a token it knows - the same shape
// the real flow writes.
const TOKEN = 'check-rider-flow-token';
await User.updateOne({ email: EMAIL }, {
  activationTokenHash: hashActivationToken(TOKEN),
  activationTokenExpires: new Date(Date.now() - 1000),
  activationSentAt: new Date(Date.now() - 5 * 60 * 1000),
});
console.log('   expired link ->', JSON.stringify(await activationService.status(TOKEN)));
await User.updateOne({ email: EMAIL }, {
  activationTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
});
console.log('   valid link   ->', JSON.stringify(await activationService.status(TOKEN)));
console.log('   ->', (await activationService.activate({ token: TOKEN, password: PASSWORD })).message);
console.log('   opened again ->', JSON.stringify(await activationService.status(TOKEN)));
console.log('   wrong link   ->', JSON.stringify(await activationService.status('not-a-real-token')));

console.log('4. now the rider can sign in');
const session = await authService.login({ email: EMAIL, password: PASSWORD });
console.log('   ->', JSON.stringify({ role: session.user.role, userId: session.user.userId, token: Boolean(session.token) }));

console.log('5. seller assigns them to an order');
let order = await Order.findOne({ sellerId: SELLER, status: { $in: ['confirmed', 'processing', 'shipped'] } }).sort({ createdAt: -1 });
if (!order) {
  // Move one along, the way the seller would from their dashboard.
  order = await Order.findOne({ sellerId: SELLER, status: 'pending' }).sort({ createdAt: -1 });
  if (!order) {
    console.log('   -> no order at all; stopping here');
    await mongoose.disconnect();
    process.exit(0);
  }
  order.status = 'confirmed';
  await order.save();
  console.log('   (moved', order.orderNumber, 'to confirmed first)');
}
const assigned = await riderService.assign(SELLER, order._id, rider.userId);
console.log('   ->', order.orderNumber, 'to', assigned.courierName);

console.log('6. the rider sees it, and only it');
const mine = await riderService.myDeliveries(rider.userId);
console.log('   -> deliveries:', mine.length, '|', mine[0]?.orderNumber, '| pickup:', mine[0]?.pickup.lat, '| dropoff:', mine[0]?.dropoff.lat);

console.log('7. somebody else’s order is refused');
const other = await Order.findOne({ 'delivery.riderUserId': { $ne: rider.userId } });
try {
  await riderService.assignedOrder(rider.userId, other._id);
  console.log('   -> PROBLEM: it let them in');
} catch (err) {
  console.log('   ->', err.message);
}

console.log('8. the rider pushes a live position');
await Order.updateOne({ _id: order._id }, { status: 'shipped' });
const pos = await deliveryService.updateLocation(order._id, rider.userId, { lat: 15.42, lng: 120.75, etaMinutes: 25 });
console.log('   -> live:', pos.isLive, '|', pos.lat, pos.lng, '| eta', pos.etaMinutes);

console.log('9. and uploads proof at the door');
const done = await riderService.recordDelivery(rider.userId, order._id, {
  proofPath: '/api/files/test-proof.jpg',
  note: 'Inabot kay ate sa gate.',
});
console.log('   -> proof:', done.proofOfDelivery, '| live now:', done.isLive);

const after = await Order.findById(order._id);
console.log('   -> order status:', after.status);

console.log('10. buyer sees the rider and the proof');
const tracking = await deliveryService.getTracking(order._id, { userId: after.buyerUserId, role: 'buyer' });
console.log('   ->', JSON.stringify({
  courier: tracking.courierName,
  riderUserId: tracking.riderUserId,
  proof: tracking.proofOfDelivery,
  note: tracking.deliveryNote,
}));

await mongoose.disconnect();
