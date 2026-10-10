import crypto from 'crypto';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { authRepository } from '../repositories/authRepository.js';
import { findUserByUserId } from '../repositories/userRepository.js';
import { activationService } from './activationService.js';
import { toNameKey, EMAIL_PATTERN } from '../models/User.js';
import * as notificationRepo from '../repositories/notificationRepository.js';
import { updateOrderStatus } from './adminService.js';

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
   * Puts a rider on one order line.
   *
   * Per line, because a basket split across two sellers is two journeys, and
   * each seller assigns their own person to their own part of it.
   */
  async assign(sellerUserId, orderId, riderUserId) {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found.');
    if (order.sellerId !== sellerUserId) throw new Error('Not your order.');
    if (['delivered', 'completed', 'cancelled'].includes(order.status)) {
      throw new Error('This order is already finished.');
    }

    if (riderUserId == null || riderUserId === '') {
      order.delivery = {
        ...(order.delivery?.toObject?.() || order.delivery || {}),
        riderUserId: null,
        assignedAt: null,
        courierName: '',
        courierContact: '',
      };
      await order.save();
      return order.delivery;
    }

    const rider = await User.findOne({
      userId: Number(riderUserId),
      role: 'rider',
      employedBy: sellerUserId,
    });
    if (!rider) throw new Error('That is not one of your delivery people.');
    if (rider.status === 'suspended') {
      throw new Error('That delivery person is suspended.');
    }
    // Nothing to carry until the seller has accepted it (and, for GCash,
    // checked the payment).
    if (order.status === 'pending') {
      throw new Error('Confirm the order before assigning a delivery person.');
    }

    order.delivery = {
      ...(order.delivery?.toObject?.() || order.delivery || {}),
      riderUserId: rider.userId,
      assignedAt: new Date(),
      // Copied onto the order so the buyer sees a name without the app having
      // to look up a stranger's account.
      courierName: rider.name,
      courierContact: rider.contact || '',
    };
    await order.save();

    await notificationRepo.createNotification({
      userId: rider.userId,
      type: 'ORDER',
      title: `You are delivering ${order.orderNumber}`,
      body: `${order.productName} to ${order.deliveryAddress}`,
      link: `/rider?order=${order._id}`,
    });

    return order.delivery;
  },

  /**
   * The rider's own list: orders assigned to them and still on the road.
   *
   * Completed and cancelled ones drop off - a rider's screen should show the
   * work in front of them, not a history they cannot act on.
   */
  async myDeliveries(riderUserId) {
    const orders = await Order.find({
      'delivery.riderUserId': riderUserId,
      status: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] },
    }).sort({ 'delivery.assignedAt': -1 });

    const sellerIds = [...new Set(orders.map((o) => o.sellerId))];
    const sellers = await User.find({ userId: { $in: sellerIds } })
      .select('userId name pickupAddress pickupLat pickupLng');
    const bySeller = new Map(sellers.map((s) => [s.userId, s]));

    return orders.map((order) => {
      const seller = bySeller.get(order.sellerId);
      const route = order.route || {};
      const delivery = order.delivery || {};

      return {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        status: order.status,
        productName: order.productName,
        quantity: order.quantity,
        weightKg: order.weightKg || 1,
        total: order.total,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        customerName: order.customerName,
        customerContact: order.customerContact,
        deliveryAddress: order.deliveryAddress,
        notes: order.notes || '',
        shopName: seller?.name || '',
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
        proofOfDelivery: delivery.proofOfDelivery || '',
        deliveredAt: delivery.deliveredAt || null,
        deliveryNote: delivery.deliveryNote || '',
        isLive: Boolean(delivery.isLive),
        lastPositionAt: delivery.updatedAt || null,
      };
    });
  },

  /** The order a rider is allowed to touch: one assigned to them. */
  async assignedOrder(riderUserId, orderId) {
    const order = await Order.findOne({
      _id: orderId,
      'delivery.riderUserId': riderUserId,
    });
    if (!order) throw new Error('That delivery is not assigned to you.');
    return order;
  },

  /**
   * The photo taken at the door, and the moment it was taken.
   *
   * Marks the line delivered in the same call: the proof and the status are
   * one event, and letting them drift apart is how an order ends up delivered
   * with nothing to show for it.
   */
  async recordDelivery(riderUserId, orderId, { proofPath, note }) {
    const order = await this.assignedOrder(riderUserId, orderId);

    if (!proofPath) throw new Error('Take a photo of the delivery first.');
    if (order.status === 'cancelled') {
      throw new Error('This order was cancelled.');
    }
    // Delivered only from "out for delivery". Jumping here from pending or
    // confirmed would skip the seller's payment check and the stock deduction.
    // An order already delivered may have its photo replaced.
    if (!['shipped', 'delivered'].includes(order.status)) {
      throw new Error('The seller has not sent this order out yet. Wait until it is marked out for delivery.');
    }

    order.delivery = {
      ...(order.delivery?.toObject?.() || order.delivery || {}),
      proofOfDelivery: proofPath,
      deliveredAt: new Date(),
      deliveryNote: clean(note),
      // The journey is over; there is nothing left to broadcast.
      isLive: false,
      lat: null,
      lng: null,
    };
    await order.save();

    if (order.status === 'shipped') {
      // The same transition the seller's own "delivered" goes through, so the
      // rules, the buyer's message and the notifications stay in one place.
      await updateOrderStatus(order._id, order.sellerId, 'delivered');
    }

    const rider = await findUserByUserId(riderUserId);

    await notificationRepo.createNotification({
      userId: order.sellerId,
      type: 'ORDER',
      title: `${order.orderNumber} delivered`,
      body: `${rider?.name || 'Your rider'} uploaded proof of delivery.`,
      link: `/client?tab=Orders&order=${order._id}`,
    });

    return order.delivery;
  },
};
