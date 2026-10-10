import * as adminRepo from '../repositories/adminRepository.js';
import * as orderRepo from '../repositories/orderRepository.js';
import * as inventoryRepo from '../repositories/inventoryRepository.js';
import * as notificationRepo from '../repositories/notificationRepository.js';
import { postOrderSystemMessage } from './chatService.js';
import { stockUnits } from '../models/Order.js';
import { AppError } from '../errors/appError.js';
import { PAYMENT_METHODS, isGcash, normalizeGcashReference, transitionBlocker } from './orderRules.js';

// Valid next-statuses per current status (Orders module status flow).
const STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
};

// Statuses at/after which stock has already been taken out of inventory.
const STOCK_DEDUCTED_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered', 'completed'];

async function maybeNotifyLowStock(sellerId, product) {
  const fresh = await adminRepo.getProductById(product._id, sellerId);
  if (fresh && fresh.stock > 0 && fresh.stock <= fresh.lowStockThreshold) {
    await notificationRepo.createNotification({
      userId: sellerId,
      type: 'STOCK',
      title: `${fresh.name} is running low`,
      body: `Only ${fresh.stock}kg left (threshold: ${fresh.lowStockThreshold}kg).`,
      link: `/client?tab=Inventory`,
    });
  } else if (fresh && fresh.stock <= 0) {
    await notificationRepo.createNotification({
      userId: sellerId,
      type: 'STOCK',
      title: `${fresh.name} is out of stock`,
      body: 'Restock soon to avoid missed sales.',
      link: `/client?tab=Inventory`,
    });
  }
}

function validateProductInput(productData, { partial = false } = {}) {
  const required = ['name', 'variety', 'description', 'price', 'stock'];
  if (!partial) {
    for (const field of required) {
      if (productData[field] === undefined || productData[field] === '') {
        throw new Error(`${field} is required.`);
      }
    }
    if (!productData.images || productData.images.length === 0) {
      throw new Error('At least one product image is required.');
    }
  }
  if (productData.price !== undefined && Number(productData.price) < 1) {
    throw new Error('Price must be at least ₱1.');
  }
  if (productData.stock !== undefined && Number(productData.stock) < 0) {
    throw new Error('Stock cannot be negative.');
  }
}

export const addProduct = async (productData, adminId) => {
  validateProductInput(productData);
  return await adminRepo.addProduct(productData, adminId);
};

export const getMyProducts = async (adminId) => {
  if (!adminId) throw new Error('Admin ID is required.');
  return await adminRepo.getProductsByAdmin(adminId);
};

export const editProduct = async (id, sellerId, productData) => {
  validateProductInput(productData, { partial: true });
  const updated = await adminRepo.updateProduct(id, sellerId, productData);
  if (!updated) {
    throw new Error('Product not found.');
  }
  return updated;
};

export const deleteProduct = async (id, sellerId) => {
  const product = await adminRepo.getProductById(id, sellerId);
  if (!product) {
    throw new Error('Product not found.');
  }

  const hasActiveOrders = await orderRepo.hasActiveOrdersForProduct(id);
  if (hasActiveOrders) {
    throw new Error('This product has active orders and cannot be deleted. Deactivate it instead.');
  }

  await adminRepo.deleteProduct(id, sellerId);
  return { message: 'Product deleted successfully.' };
};

export const duplicateProduct = async (id, sellerId) => {
  const product = await adminRepo.getProductById(id, sellerId);
  if (!product) {
    throw new Error('Product not found.');
  }

  const clone = product.toObject();
  delete clone._id;
  delete clone.createdAt;
  delete clone.updatedAt;
  clone.name = `${clone.name} (Copy)`;

  return await adminRepo.addProduct(clone, sellerId);
};

export const viewOrders = async (sellerId) => {
  return await orderRepo.findOrdersBySeller(sellerId);
};

export const recordSale = async (payload, sellerId) => {
  const { productId, customerName, quantity } = payload;

  if (!productId || !customerName || !quantity) {
    throw new Error('Product, customer name, and quantity are required.');
  }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 1) {
    throw new Error('Quantity must be at least 1.');
  }

  const product = await adminRepo.getProductById(productId, sellerId);
  if (!product) {
    throw new Error('Product not found.');
  }

  const unitPrice = payload.unitPrice != null && payload.unitPrice !== ''
    ? Number(payload.unitPrice)
    : product.price;

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('Unit price is invalid.');
  }

  const status = payload.status || 'pending';
  if (!STATUS_TRANSITIONS[status] && status !== 'pending') {
    throw new Error('Invalid order status.');
  }

  const paymentMethod = payload.paymentMethod || 'Cash/COD';
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error(`Payment method must be ${PAYMENT_METHODS.join(' or ')}.`);
  }

  const deliveryFee = Number(payload.deliveryFee) || 0;
  if (deliveryFee < 0) throw new Error('Delivery fee cannot be negative.');
  const subtotal = unitPrice * qty;
  const total = subtotal + deliveryFee;

  const stockDeducted = STOCK_DEDUCTED_STATUSES.includes(status);
  if (stockDeducted) {
    const updated = await adminRepo.decrementStock(product._id, qty);
    if (!updated) {
      throw new Error('Not enough stock for this sale.');
    }
    await inventoryRepo.logMovement({
      sellerId,
      productId: product._id,
      productName: product.name,
      type: 'SALE',
      quantity: -qty,
      resultingStock: updated.stock,
      note: `Sale to ${customerName}`,
    });
    await maybeNotifyLowStock(sellerId, product);
  }

  const order = await orderRepo.createOrder({
    sellerId,
    productId: product._id,
    productName: product.name,
    unitPrice,
    quantity: qty,
    subtotal,
    deliveryFee,
    total,
    paymentMethod,
    customerName,
    customerContact: payload.customerContact || '',
    deliveryAddress: payload.deliveryAddress || '',
    status,
    statusHistory: [{ status, changedAt: new Date() }],
    stockDeducted,
    orderDate: payload.orderDate ? new Date(payload.orderDate) : new Date(),
    notes: payload.notes || '',
  });

  const orderNumber = `ORD-${order._id.toString().slice(-6).toUpperCase()}`;
  const finalOrder = await orderRepo.setOrderNumber(order._id, orderNumber);

  await notificationRepo.createNotification({
    userId: sellerId,
    type: 'ORDER',
    title: `New order ${orderNumber}`,
    body: `${customerName}: ${qty} kg ${product.name}`,
    link: `/client?tab=Orders&order=${order._id}`,
  });

  return finalOrder;
};

export const getMyOrderAnalytics = async (sellerId) => {
  return await orderRepo.getSellerAnalytics(sellerId);
};

export const getMyOrderBreakdown = async (sellerId) => {
  return await orderRepo.getSellerBreakdown(sellerId);
};

export const getMyCustomers = async (sellerId) => {
  return await orderRepo.getDistinctCustomersForSeller(sellerId);
};

/**
 * What a status change says out loud.
 *
 * Written for the buyer, not the database: "shipped" on its own tells them
 * nothing about what to do next.
 */
const STATUS_SENTENCE = (orderNumber, status, reason) => {
  const sentences = {
    confirmed: `Order ${orderNumber} is confirmed. The seller is preparing it now.`,
    processing: `Order ${orderNumber} is being packed.`,
    shipped: `Order ${orderNumber} is on the way. Please keep your phone reachable for the rider.`,
    delivered: `Order ${orderNumber} was delivered. Tell the seller if anything is wrong with it.`,
    completed: `Order ${orderNumber} is complete. You can leave a review now.`,
    cancelled: `Order ${orderNumber} was cancelled${reason ? ` - ${reason}` : ''}.`,
  };

  return sentences[status] || `Order ${orderNumber} is now ${status}.`;
};

export const updateOrderStatus = async (orderId, sellerId, status, reason) => {
  const order = await orderRepo.findOrderById(orderId);
  if (!order) {
    throw new AppError('Order not found.', 404);
  }
  if (order.sellerId !== sellerId) {
    throw new AppError('Not authorized to update this order.', 403);
  }

  const allowedNext = STATUS_TRANSITIONS[order.status] || [];
  if (!allowedNext.includes(status)) {
    throw new Error(`Cannot move an order from "${order.status}" to "${status}".`);
  }

  if (status === 'cancelled' && !reason) {
    throw new Error('A reason is required to cancel an order.');
  }

  const blocker = transitionBlocker(order, status);
  if (blocker) throw new Error(blocker);

  // Claimed before stock moves, so a double click confirms (and deducts) once.
  const historyEntry = { status, changedAt: new Date(), reason: reason || '' };
  const claimed = await orderRepo.claimStatus(orderId, sellerId, order.status, {
    status,
    statusReason: reason || '',
    historyEntry,
  });
  if (!claimed) {
    throw new Error('This order was just updated somewhere else. Refresh to see where it is now.');
  }

  // Kilograms, not sacks. Stock is kept in kilograms and an order is counted
  // in sacks, so one 25 kg sack used to take a single kilo off the shelf.
  const kilos = stockUnits(order);

  try {
    // Deduct stock the moment an order is confirmed (not while merely pending).
    if (status === 'confirmed' && !order.stockDeducted) {
      const updated = await adminRepo.decrementStock(order.productId, kilos);
      if (!updated) {
        throw new Error('Not enough stock to confirm this order.');
      }
      await orderRepo.setStockDeducted(orderId, true);
      await inventoryRepo.logMovement({
        sellerId,
        productId: order.productId,
        productName: order.productName,
        type: 'SALE',
        quantity: -kilos,
        resultingStock: updated.stock,
        note: `Order ${order.orderNumber} confirmed`,
      });
      // Sacks, deliberately: "8 sold" reads as eight bags, not eight kilos.
      await adminRepo.bumpSoldCount(order.productId, order.quantity);
      await maybeNotifyLowStock(sellerId, { _id: order.productId });
    }
  } catch (err) {
    await orderRepo.revertStatus(orderId, order.status);
    throw err;
  }

  // Restock if cancelling an order that had already taken stock out.
  if (status === 'cancelled' && order.stockDeducted) {
    await orderRepo.setStockDeducted(orderId, false);
    await adminRepo.bumpSoldCount(order.productId, -order.quantity);
    const updated = await adminRepo.incrementStock(order.productId, kilos);
    if (updated) {
      await inventoryRepo.logMovement({
        sellerId,
        productId: order.productId,
        productName: order.productName,
        type: 'RETURN',
        quantity: kilos,
        resultingStock: updated.stock,
        note: `Order ${order.orderNumber} cancelled`,
      });
    }
  }

  await notificationRepo.createNotification({
    userId: sellerId,
    type: 'ORDER',
    title: `Order ${order.orderNumber} ${status}`,
    body: reason || `Status updated to ${status}.`,
    link: `/client?tab=Orders&order=${order._id}`,
  });

  // And in the thread, where the buyer is already asking about it. Only for
  // storefront orders: one typed in by the seller has no buyer account behind
  // it and so nobody to tell.
  if (order.buyerUserId) {
    await postOrderSystemMessage({
      sellerUserId: sellerId,
      buyerUserId: order.buyerUserId,
      text: STATUS_SENTENCE(order.orderNumber, status, reason),
    });
  }

  return await orderRepo.findOrderById(orderId);
};

/** The order, if it is this seller's, or an error that says why not. */
async function ownOrder(orderId, sellerId) {
  const order = await orderRepo.findOrderById(orderId);
  if (!order) throw new AppError('Order not found.', 404);
  if (order.sellerId !== sellerId) throw new AppError('Not your order.', 403);
  return order;
}

/**
 * An outside courier - LBC, J&T, a Lalamove driver - instead of one of the
 * seller's own riders. The tracking number is what makes it a record rather
 * than "I sent it with someone".
 */
export const setCourier = async (orderId, sellerId, { courierName, courierContact, courierReference }) => {
  const order = await ownOrder(orderId, sellerId);
  if (['delivered', 'completed', 'cancelled'].includes(order.status)) {
    throw new Error('This order is already finished.');
  }

  const name = String(courierName || '').trim();
  const ref = String(courierReference || '').trim();
  if (!name) throw new Error('Which courier is carrying it?');
  if (!ref) throw new Error('Add the tracking or booking number from the courier.');

  order.delivery = {
    ...(order.delivery?.toObject?.() || order.delivery || {}),
    // One carrier per order: recording a courier takes it off the rider.
    riderUserId: null,
    assignedAt: new Date(),
    courierName: name,
    courierContact: String(courierContact || '').trim(),
    courierReference: ref,
  };
  await order.save();
  return order;
};

/**
 * The seller's own "delivered", for an order their courier carried. Same rule
 * as the rider's: no photo, no delivered.
 */
export const recordSellerDelivery = async (orderId, sellerId, { proofPath, note }) => {
  const order = await ownOrder(orderId, sellerId);
  if (!proofPath) throw new Error('Upload a photo of the delivery.');
  if (order.status !== 'shipped') {
    throw new Error('Only an order that is out for delivery can be marked delivered.');
  }

  order.delivery = {
    ...(order.delivery?.toObject?.() || order.delivery || {}),
    proofOfDelivery: proofPath,
    deliveredAt: new Date(),
    deliveryNote: String(note || '').trim(),
    isLive: false,
  };
  await order.save();

  return updateOrderStatus(orderId, sellerId, 'delivered');
};

export const restockProduct = async (productId, sellerId, quantity, note) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 1) {
    throw new Error('Restock quantity must be at least 1.');
  }

  const product = await adminRepo.getProductById(productId, sellerId);
  if (!product) {
    throw new Error('Product not found.');
  }

  const updated = await adminRepo.incrementStock(productId, qty);
  await inventoryRepo.logMovement({
    sellerId,
    productId,
    productName: product.name,
    type: 'RESTOCK',
    quantity: qty,
    resultingStock: updated.stock,
    note: note || '',
  });

  return updated;
};

export const adjustStock = async (productId, sellerId, quantity, type, note) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty === 0) {
    throw new Error('Adjustment quantity must be non-zero.');
  }
  if (!['ADJUSTMENT', 'DAMAGE'].includes(type)) {
    throw new Error('Invalid adjustment type.');
  }

  const product = await adminRepo.getProductById(productId, sellerId);
  if (!product) {
    throw new Error('Product not found.');
  }

  const updated = qty > 0
    ? await adminRepo.incrementStock(productId, qty)
    : await adminRepo.decrementStock(productId, Math.abs(qty));

  if (!updated) {
    throw new Error('Not enough stock for this adjustment.');
  }

  await inventoryRepo.logMovement({
    sellerId,
    productId,
    productName: product.name,
    type,
    quantity: qty,
    resultingStock: updated.stock,
    note: note || '',
  });

  if (qty < 0) {
    await maybeNotifyLowStock(sellerId, { _id: productId });
  }

  return updated;
};

export const getInventorySummary = async (sellerId) => {
  return await inventoryRepo.getInventorySummary(sellerId);
};

export const getStockMovements = async (productId, sellerId) => {
  return await inventoryRepo.findMovementsByProduct(productId, sellerId);
};
// --- PAYMENT VERIFICATION (GCash QR flow) ---
/**
 * The seller opens their own GCash app, checks whether the money actually
 * arrived, and records the answer here. AgriFair never holds the funds, so this
 * confirmation - and its history - is the only record of the payment.
 *
 * One transfer pays for all of this seller's lines in a checkout, so the
 * decision and the amount apply to those lines together.
 */
export const reviewOrderPayment = async (orderId, sellerId, { paid, note, reference, amount }) => {
  const order = await ownOrder(orderId, sellerId);
  const rows = await orderRepo.findPaymentGroup(order);
  const expected = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const cleanNote = String(note || '').trim();

  let entry;
  if (paid) {
    const ref = isGcash(order.paymentMethod)
      ? normalizeGcashReference(reference || order.paymentReference)
      : String(reference || order.paymentReference || '').trim();
    if (isGcash(order.paymentMethod) && !ref) {
      throw new Error('Enter the reference number shown on the GCash transfer.');
    }
    if (ref && await orderRepo.referenceUsedElsewhere(ref, rows.map((r) => r._id))) {
      throw new Error('That reference number is already on another order. Check it against your GCash history.');
    }

    const received = amount == null || amount === '' ? expected : Number(amount);
    if (!Number.isFinite(received) || received < 0) {
      throw new Error('Enter the amount you received.');
    }
    if (received < expected && !cleanNote) {
      throw new Error(`That is less than the ₱${expected.toLocaleString('en-PH')} due. Add a note saying why before confirming.`);
    }

    entry = { status: 'paid', amount: received, reference: ref, note: cleanNote };
  } else {
    if (!cleanNote) throw new Error('Tell the buyer what was wrong with the payment.');
    entry = { status: 'rejected', amount: 0, reference: order.paymentReference || '', note: cleanNote };
  }

  const now = new Date();
  for (const row of rows) {
    row.paymentStatus = entry.status;
    row.paymentNote = cleanNote;
    row.paymentReviewedAt = now;
    row.paymentReviewedBy = sellerId;
    if (entry.status === 'paid') {
      // Split in proportion to each line's total, so per-line reports add up
      // to what actually arrived.
      row.amountPaid = expected > 0
        ? Math.round((Number(row.total || 0) / expected) * entry.amount * 100) / 100
        : 0;
      row.paidAt = now;
      row.paymentReference = entry.reference;
    } else {
      row.amountPaid = 0;
      row.paidAt = null;
    }
    row.paymentHistory.push({ ...entry, reviewedBy: sellerId, at: now });
    await row.save();
  }

  return rows.find((row) => String(row._id) === String(order._id));
};
