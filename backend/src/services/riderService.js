import crypto from 'crypto';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { authRepository } from '../repositories/authRepository.js';
import { findUserByUserId } from '../repositories/userRepository.js';
import { activationService } from './activationService.js';
import { toNameKey, EMAIL_PATTERN } from '../models/User.js';
import * as workflow from './orderWorkflow.js';
import { notify, links } from './notify.js';
import { isCod } from './orderRules.js';

/**
 * Delivery people, added by the seller they work for.
 *
 * A rider does not sign themselves up. The seller enters a name and an email,
 * and the account is created with a password nobody knows - not even the
 * seller, who should not be able to sign in as their staff. The rider gets a
 * link by email and chooses their own password on the page it opens.
 *
 * They see only the orders assigned to them. A delivery person hired by one
 * shop has no business reading another shop's orders, and assignment - not
 * employment - is what opens a single one.
 */

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeEmail = (email) => clean(email).toLowerCase();

/** What the seller and the buyer are allowed to know about a rider. */
const toPublicRider = (user) => ({
  userId: user.userId,
  name: user.name,
  email: user.email,
  contact: user.contact || '',
  status: user.status,
  emailVerified: Boolean(user.emailVerified),
  // The one thing the seller needs to chase: has this person actually got in?
  activated: Boolean(user.passwordSet && user.emailVerified),
  createdAt: user.createdAt,
});

export const riderService = {
  /** Everyone this seller has taken on. */
  async list(sellerUserId) {
    const riders = await User.find({ role: 'rider', employedBy: sellerUserId })
      .sort({ createdAt: -1 });

    return riders.map(toPublicRider);
  },

  /**
   * Takes on a delivery person: a name and an email, nothing else.
   *
   * The password is random and thrown away. The rider sets their own from the
   * emailed activation link, so nobody but them has ever known it.
   */
  async add(sellerUserId, { name, email, contact }) {
    const cleanName = clean(name);
    const cleanEmail = normalizeEmail(email);

    if (!cleanName) throw new Error('Give the delivery person a name.');
    if (!cleanEmail) throw new Error('An email is needed to send their code.');

    if (await authRepository.findByEmail(cleanEmail)) {
      throw new Error('Somebody already uses that email.');
    }
    if (await authRepository.findByNameKey(toNameKey(cleanName))) {
      throw new Error('That name is already taken. Add a middle initial.');
    }

    if (!EMAIL_PATTERN.test(cleanEmail)) {
      throw new Error('That does not look like a valid email address.');
    }

    // Long, random, and never returned anywhere. The account is unusable until
    // the rider replaces it through the activation flow.
    const placeholder = crypto.randomBytes(24).toString('base64url');

    let rider;
    try {
      rider = await authRepository.createUser({
        name: cleanName,
        email: cleanEmail,
        contact: clean(contact),
        password: placeholder,
        role: 'rider',
        status: 'active',
        employedBy: sellerUserId,
        passwordSet: false,
        emailVerified: false,
      });
    } catch (err) {
      if (err.code === 11000) throw new Error('Somebody already uses that email.');
      throw err;
    }

    // Failure is reported rather than thrown: the account exists, and the
    // seller can resend.
    let linkSent = true;
    try {
      await activationService.issue(rider);
    } catch (err) {
      console.error('[rider] could not send the activation link:', err.message);
      linkSent = false;
    }

    return { ...toPublicRider(rider), linkSent };
  },

  /**
   * Sends a new activation link, for a rider who never got the first or lost
   * it. The rider can do this themselves from an expired link; this is for the
   * one who has no link at all.
   */
  async resendLink(sellerUserId, riderUserId) {
    const rider = await User.findOne({
      userId: Number(riderUserId),
      role: 'rider',
      employedBy: sellerUserId,
    });
    if (!rider) throw new Error('That is not one of your delivery people.');
    if (rider.passwordSet && rider.emailVerified) {
      throw new Error('This account is already active.');
    }
    if (rider.status === 'suspended') {
      throw new Error('Reinstate this delivery person before sending them a link.');
    }

    return activationService.issue(rider);
  },

  /**
   * Stops a rider working for this seller.
   *
   * Suspended rather than deleted: their name is on delivered orders, and
   * removing the account would leave those orders unable to say who carried
   * them.
   */
  async suspend(sellerUserId, riderUserId) {
    const rider = await User.findOne({
      userId: Number(riderUserId),
      role: 'rider',
      employedBy: sellerUserId,
    });
    if (!rider) throw new Error('That is not one of your delivery people.');

    rider.status = rider.status === 'suspended' ? 'active' : 'suspended';
    await rider.save();

    return toPublicRider(rider);
  },

  /**
   * Puts a rider on a seller-order: every line this seller fulfils from one
   * checkout, since they travel together. The rider has to accept before it
   * can go out; until then it shows as waiting on them.
   */
  async assign(sellerUserId, orderId, riderUserId) {
    const order = await workflow.sellersOrder(orderId, sellerUserId);
    if (['shipped', 'delivered', 'completed', 'cancelled'].includes(order.status)) {
      throw new Error('The delivery person can only be changed before the order goes out.');
    }
    const rows = (await workflow.sellerOrderRows(order)).filter((r) => r.status !== 'cancelled');
    const ids = rows.map((r) => r._id);
    const previous = order.delivery?.riderUserId;

    if (riderUserId == null || riderUserId === '') {
      await Order.updateMany({ _id: { $in: ids } }, {
        $set: {
          'delivery.riderUserId': null,
          'delivery.assignmentStatus': '',
          'delivery.assignedAt': null,
          'delivery.courierName': '',
          'delivery.courierContact': '',
        },
      });
      if (previous != null) {
        await notify({
          userId: previous,
          title: `Delivery ${order.orderNumber} unassigned`,
          body: 'The seller took you off this delivery.',
          link: links.riderDelivery(order._id),
        });
      }
      return (await workflow.loadOrder(order._id)).delivery;
    }

    const rider = await User.findOne({
      userId: Number(riderUserId),
      role: 'rider',
      employedBy: sellerUserId,
    });
    if (!rider) throw new Error('That is not one of your delivery people.');
    if (rider.status !== 'active') {
      throw new Error('That delivery person is not active.');
    }
    // Nothing to carry until the seller has accepted it (and, for GCash,
    // checked the payment).
    if (order.status === 'pending') {
      throw new Error('Confirm the order before assigning a delivery person.');
    }

    await Order.updateMany({ _id: { $in: ids } }, {
      $set: {
        'delivery.riderUserId': rider.userId,
        'delivery.assignmentStatus': 'assigned',
        'delivery.assignedAt': new Date(),
        'delivery.acceptedAt': null,
        'delivery.declineReason': '',
        // Copied onto the order so the buyer sees a name without the app
        // having to look up a stranger's account.
        'delivery.courierName': rider.name,
        'delivery.courierContact': rider.contact || '',
        'delivery.courierReference': '',
      },
    });

    if (previous != null && previous !== rider.userId) {
      await notify({
        userId: previous,
        title: `Delivery ${order.orderNumber} reassigned`,
        body: 'The seller gave this delivery to someone else.',
        link: links.riderDelivery(order._id),
      });
    }
    await notify({
      userId: rider.userId,
      title: `New delivery: ${order.orderNumber}`,
      body: `To ${order.deliveryAddress}. Accept or decline it in the app.`,
      link: links.riderDelivery(order._id),
    });

    return (await workflow.loadOrder(order._id)).delivery;
  },

  /** The order a rider is allowed to touch: one assigned to them. */
  async assignedOrder(riderUserId, orderId) {
    let order = null;
    try {
      order = await Order.findOne({ _id: orderId, 'delivery.riderUserId': riderUserId });
    } catch {
      order = null;
    }
    if (!order) throw new Error('That delivery is not assigned to you.');
    return order;
  },

  /** Every line of the seller-order this rider carries, still live. */
  async deliveryRows(order) {
    return (await workflow.sellerOrderRows(order))
      .filter((r) => r.status !== 'cancelled' && r.delivery?.riderUserId === order.delivery?.riderUserId);
  },

  async accept(riderUserId, orderId) {
    const order = await this.assignedOrder(riderUserId, orderId);
    if (order.status === 'cancelled') throw new Error('This order was cancelled.');
    if (order.delivery?.assignmentStatus === 'accepted') return this.delivery(riderUserId, orderId);
    if (order.delivery?.assignmentStatus !== 'assigned') {
      throw new Error('This delivery is not waiting for your answer.');
    }
    const rows = await this.deliveryRows(order);
    await Order.updateMany(
      { _id: { $in: rows.map((r) => r._id) }, 'delivery.riderUserId': riderUserId, 'delivery.assignmentStatus': 'assigned' },
      { $set: { 'delivery.assignmentStatus': 'accepted', 'delivery.acceptedAt': new Date() } },
    );
    const rider = await findUserByUserId(riderUserId);
    await notify({
      userId: order.sellerId,
      title: `${rider?.name || 'Your delivery person'} accepted ${order.orderNumber}`,
      body: 'You can send it out once it is packed.',
      link: links.sellerOrder(order._id),
    });
    return this.delivery(riderUserId, orderId);
  },

  async decline(riderUserId, orderId, reason) {
    const order = await this.assignedOrder(riderUserId, orderId);
    const why = clean(reason);
    if (!why) throw new Error('Tell the seller why you cannot take it.');
    if (['shipped', 'delivered', 'completed'].includes(order.status)) {
      throw new Error('This delivery is already under way. Message the seller instead.');
    }
    const rows = await this.deliveryRows(order);
    const now = new Date();
    await Order.updateMany(
      { _id: { $in: rows.map((r) => r._id) }, 'delivery.riderUserId': riderUserId },
      {
        $set: {
          'delivery.riderUserId': null,
          'delivery.assignmentStatus': 'declined',
          'delivery.declinedAt': now,
          'delivery.declineReason': why,
          'delivery.declinedBy': riderUserId,
          'delivery.courierName': '',
          'delivery.courierContact': '',
        },
      },
    );
    const rider = await findUserByUserId(riderUserId);
    await notify({
      userId: order.sellerId,
      title: `${rider?.name || 'Your delivery person'} declined ${order.orderNumber}`,
      body: `${why}. Assign someone else.`,
      link: links.sellerOrder(order._id),
    });
    return { declined: true };
  },

  /** Picked up and on the road: the order goes out for delivery. */
  async start(riderUserId, orderId) {
    const order = await this.assignedOrder(riderUserId, orderId);
    if (order.status === 'shipped') return this.delivery(riderUserId, orderId);
    if (order.delivery?.assignmentStatus !== 'accepted') {
      throw new Error('Accept the delivery first.');
    }
    if (order.status !== 'processing') {
      throw new Error('The seller has not finished packing this order yet.');
    }
    await workflow.transition(order, 'shipped', { role: 'rider', userId: riderUserId });
    return this.delivery(riderUserId, orderId);
  },

  /**
   * The photo taken at the door. Kept on the order straight away, so a
   * dropped connection on "Mark as delivered" does not lose it; the status
   * moves only when the rider marks it delivered.
   */
  async uploadProof(riderUserId, orderId, { proofPath, note }) {
    const order = await this.assignedOrder(riderUserId, orderId);
    if (!proofPath) throw new Error('Take a photo of the delivery first.');
    if (order.status === 'cancelled') throw new Error('This order was cancelled.');
    // Only from "out for delivery". Earlier would skip the seller's payment
    // check and the stock deduction. An order already delivered may have its
    // photo replaced.
    if (!['shipped', 'delivered'].includes(order.status)) {
      throw new Error('The seller has not sent this order out yet. Wait until it is marked out for delivery.');
    }
    const rows = await this.deliveryRows(order);
    await Order.updateMany({ _id: { $in: rows.map((r) => r._id) } }, {
      $set: {
        'delivery.proofOfDelivery': proofPath,
        'delivery.proofUploadedAt': new Date(),
        ...(note !== undefined ? { 'delivery.deliveryNote': clean(note) } : {}),
      },
    });
    return this.delivery(riderUserId, orderId);
  },

  /**
   * "Mark as delivered". Safe to press again: a retry after the first one
   * went through returns the delivered order rather than an error, so a
   * rider on a weak signal can keep trying without making a mess.
   */
  async markDelivered(riderUserId, orderId, { cashCollected, note } = {}) {
    const order = await this.assignedOrder(riderUserId, orderId);
    if (['delivered', 'completed'].includes(order.status)) return this.delivery(riderUserId, orderId);
    if (order.status === 'cancelled') throw new Error('This order was cancelled.');
    if (order.status !== 'shipped') throw new Error('Start the delivery first.');
    if (!order.delivery?.proofOfDelivery) throw new Error('Upload the photo of the delivery first.');

    const rows = (await this.deliveryRows(order)).filter((r) => r.status === 'shipped');
    if (isCod(order.paymentMethod)) {
      if (cashCollected == null || cashCollected === '') {
        throw new Error('Enter how much cash you collected.');
      }
      await workflow.recordCodCollection(rows, cashCollected, { by: riderUserId, note });
    }

    const now = new Date();
    await Order.updateMany({ _id: { $in: rows.map((r) => r._id) } }, {
      $set: {
        'delivery.deliveredAt': now,
        'delivery.deliveredBy': riderUserId,
        // The journey is over; there is nothing left to broadcast.
        'delivery.isLive': false,
        'delivery.lat': null,
        'delivery.lng': null,
        ...(note !== undefined && clean(note) ? { 'delivery.deliveryNote': clean(note) } : {}),
      },
    });

    try {
      await workflow.transition(await Order.findById(order._id), 'delivered', { role: 'rider', userId: riderUserId });
    } catch (err) {
      // Someone else (a double tap) got there first.
      const fresh = await Order.findById(order._id);
      if (!['delivered', 'completed'].includes(fresh?.status)) throw err;
    }
    return this.delivery(riderUserId, orderId);
  },

  /**
   * The rider's list. `active` is the work in front of them; `history` is
   * what they have delivered, for their own record. One entry per
   * seller-order, the way they carry it.
   */
  async myDeliveries(riderUserId, { scope = 'active' } = {}) {
    const statuses = scope === 'history'
      ? ['delivered', 'completed']
      : ['confirmed', 'processing', 'shipped'];
    const rows = await Order.find({
      'delivery.riderUserId': riderUserId,
      status: { $in: statuses },
    }).sort({ 'delivery.assignedAt': -1 }).limit(scope === 'history' ? 100 : 500);
    return this.describe(rows);
  },

  async delivery(riderUserId, orderId) {
    const order = await this.assignedOrder(riderUserId, orderId);
    const rows = await this.deliveryRows(order);
    const [entry] = await this.describe(rows.length ? rows : [order]);
    return entry;
  },

  async describe(rows) {
    const sellerIds = [...new Set(rows.map((o) => o.sellerId))];
    const sellers = await User.find({ userId: { $in: sellerIds } })
      .select('userId name contact pickupAddress pickupLat pickupLng');
    const bySeller = new Map(sellers.map((s) => [s.userId, s]));

    const groups = new Map();
    for (const order of rows) {
      const key = `${order.groupId || order._id}:${order.sellerId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
    }

    return [...groups.values()].map((lines) => {
      const order = lines[0];
      const seller = bySeller.get(order.sellerId);
      const route = order.route || {};
      const delivery = order.delivery || {};
      const total = lines.reduce((sum, r) => sum + Number(r.total || 0), 0);
      const cod = isCod(order.paymentMethod);

      return {
        orderId: String(order._id),
        groupId: order.groupId || String(order._id),
        orderNumber: order.orderNumber,
        status: order.status,
        assignmentStatus: delivery.assignmentStatus || 'accepted',
        items: lines.map((r) => ({
          orderId: String(r._id),
          productName: r.productName,
          quantity: r.quantity,
          weightKg: r.weightKg || 1,
        })),
        // Kept for older app versions that read one line.
        productName: lines.map((r) => `${r.quantity}x ${r.productName}`).join(', '),
        quantity: lines.reduce((n, r) => n + Number(r.quantity || 0), 0),
        weightKg: order.weightKg || 1,
        total: Math.round(total * 100) / 100,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        isCod: cod,
        // What to collect at the door: the whole amount for cash on
        // delivery, nothing for an order already paid.
        amountToCollect: cod && order.paymentStatus === 'unpaid' && !order.codCollection?.collectedAt
          ? Math.round(total * 100) / 100
          : 0,
        cashCollected: order.codCollection?.collectedAt
          ? lines.reduce((sum, r) => sum + Number(r.codCollection?.amount || 0), 0)
          : null,
        customerName: order.customerName,
        customerContact: order.customerContact,
        buyerUserId: order.buyerUserId ?? null,
        deliveryAddress: order.deliveryAddress,
        notes: order.notes || '',
        shopName: seller?.name || '',
        shopContact: seller?.contact || '',
        sellerUserId: order.sellerId,
        pickup: {
          lat: route.pickupLat ?? seller?.pickupLat ?? null,
          lng: route.pickupLng ?? seller?.pickupLng ?? null,
          address: route.pickupAddress || seller?.pickupAddress || '',
        },
        dropoff: {
          lat: route.dropoffLat ?? null,
          lng: route.dropoffLng ?? null,
          address: order.deliveryAddress || '',
          precision: route.dropoffPrecision || '',
        },
        assignedAt: delivery.assignedAt || null,
        acceptedAt: delivery.acceptedAt || null,
        proofOfDelivery: delivery.proofOfDelivery || '',
        proofUploadedAt: delivery.proofUploadedAt || null,
        deliveredAt: delivery.deliveredAt || null,
        deliveryNote: delivery.deliveryNote || '',
        isLive: Boolean(delivery.isLive),
        lastPositionAt: delivery.updatedAt || null,
        canAccept: delivery.assignmentStatus === 'assigned',
        canStart: delivery.assignmentStatus !== 'assigned' && order.status === 'processing',
        canUploadProof: ['shipped', 'delivered'].includes(order.status),
        canMarkDelivered: order.status === 'shipped' && Boolean(delivery.proofOfDelivery),
      };
    });
  },
};
