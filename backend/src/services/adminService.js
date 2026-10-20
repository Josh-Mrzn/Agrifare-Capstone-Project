import * as adminRepo from '../repositories/adminRepository.js';
import * as orderRepo from '../repositories/orderRepository.js';
import * as inventoryRepo from '../repositories/inventoryRepository.js';
import Order from '../models/Order.js';
import { PAYMENT_METHODS, isCod } from './orderRules.js';
import * as workflow from './orderWorkflow.js';
import { STATUS_TRANSITIONS, STOCK_DEDUCTED_STATUSES } from './orderWorkflow.js';
import { notify, links } from './notify.js';

async function maybeNotifyLowStock(sellerId, product) {
  const fresh = await adminRepo.getProductById(product._id, sellerId);
  if (fresh && fresh.stock > 0 && fresh.stock <= fresh.lowStockThreshold) {
    await notify({
      userId: sellerId,
      type: 'STOCK',
      title: `${fresh.name} is running low`,
      body: `Only ${fresh.stock}kg left (threshold: ${fresh.lowStockThreshold}kg).`,
      link: links.sellerInventory(),
    });
  } else if (fresh && fresh.stock <= 0) {
    await notify({
      userId: sellerId,
      type: 'STOCK',
      title: `${fresh.name} is out of stock`,
      body: 'Restock soon to avoid missed sales.',
      link: links.sellerInventory(),
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
    // A sale typed in after the fact as completed was paid at the counter;
    // anything earlier is settled the way a storefront order is.
    paymentStatus: status === 'completed' ? 'paid' : 'unpaid',
    amountPaid: status === 'completed' ? total : 0,
    paidAt: status === 'completed' ? new Date() : undefined,
    customerName,
    customerContact: payload.customerContact || '',
    deliveryAddress: payload.deliveryAddress || '',
    status,
    statusHistory: [{ status, changedAt: new Date(), by: 'seller' }],
    stockDeducted,
    orderDate: payload.orderDate ? new Date(payload.orderDate) : new Date(),
    notes: payload.notes || '',
  });

  const orderNumber = `ORD-${order._id.toString().slice(-6).toUpperCase()}`;
  const finalOrder = await orderRepo.setOrderNumber(order._id, orderNumber);

  return finalOrder;
};

export const getMyCustomers = async (sellerId) => {
  return await orderRepo.getDistinctCustomersForSeller(sellerId);
};

export const updateOrderStatus = async (orderId, sellerId, status, reason) => {
  const order = await workflow.sellersOrder(orderId, sellerId);
  return workflow.transition(order, status, { role: 'seller', userId: sellerId }, { reason });
};

/**
 * An outside courier - LBC, J&T, a Lalamove driver - instead of one of the
 * seller's own riders. The tracking number is what makes it a record rather
 * than "I sent it with someone". Applies to the whole seller-order.
 */
export const setCourier = async (orderId, sellerId, { courierName, courierContact, courierReference }) => {
  const order = await workflow.sellersOrder(orderId, sellerId);
  if (['shipped', 'delivered', 'completed', 'cancelled'].includes(order.status)) {
    throw new Error('The carrier can only be changed before the order goes out.');
  }

  const name = String(courierName || '').trim();
  const ref = String(courierReference || '').trim();
  if (!name) throw new Error('Which courier is carrying it?');
  if (!ref) throw new Error('Add the tracking or booking number from the courier.');

  const rows = await workflow.sellerOrderRows(order);
  const previousRider = order.delivery?.riderUserId;
  await Order.updateMany(
    { _id: { $in: rows.map((r) => r._id) }, status: { $nin: ['cancelled'] } },
    {
      $set: {
        // One carrier per order: recording a courier takes it off the rider.
        'delivery.riderUserId': null,
        'delivery.assignmentStatus': '',
        'delivery.assignedAt': new Date(),
        'delivery.courierName': name,
        'delivery.courierContact': String(courierContact || '').trim(),
        'delivery.courierReference': ref,
      },
    },
  );
  if (previousRider != null) {
    await notify({
      userId: previousRider,
      title: `Delivery ${order.orderNumber} reassigned`,
      body: 'The seller sent this order with a courier instead.',
      link: links.riderDelivery(order._id),
    });
  }
  return workflow.loadOrder(order._id);
};

/**
 * The seller's own "delivered", for an order their courier carried. Same rule
 * as the rider's: no photo, no delivered; and for cash on delivery, the
 * amount the courier collected.
 */
export const recordSellerDelivery = async (orderId, sellerId, { proofPath, note, cashCollected }) => {
  const order = await workflow.sellersOrder(orderId, sellerId);
  if (!proofPath) throw new Error('Upload a photo of the delivery.');
  if (order.status !== 'shipped') {
    throw new Error('Only an order that is out for delivery can be marked delivered.');
  }
  if (order.delivery?.riderUserId != null) {
    throw new Error('Your delivery person marks this one delivered from their app.');
  }

  const rows = (await workflow.sellerOrderRows(order)).filter((r) => r.status === 'shipped');
  if (isCod(order.paymentMethod)) {
    if (cashCollected == null || cashCollected === '') throw new Error('Enter the cash the courier collected.');
    await workflow.recordCodCollection(rows, cashCollected, { by: sellerId, note });
  }

  const now = new Date();
  await Order.updateMany(
    { _id: { $in: rows.map((r) => r._id) } },
    {
      $set: {
        'delivery.proofOfDelivery': proofPath,
        'delivery.proofUploadedAt': now,
        'delivery.deliveredAt': now,
        'delivery.deliveredBy': sellerId,
        'delivery.deliveryNote': String(note || '').trim(),
        'delivery.isLive': false,
      },
    },
  );

  return workflow.transition(await workflow.loadOrder(order._id), 'delivered', { role: 'seller', userId: sellerId });
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
// --- PAYMENT ---
/**
 * The seller opens their own GCash app, checks whether the money actually
 * arrived, and records the answer here. AgriFair never holds the funds, so this
 * confirmation - and its history - is the only record of the payment.
 */
export const reviewOrderPayment = (orderId, sellerId, body) => workflow.reviewGcash(orderId, sellerId, body);

export const correctCodPayment = (orderId, sellerId, body) => workflow.correctCod(orderId, sellerId, body);

export const recordRefund = (orderId, sellerId, body) => workflow.recordRefund(orderId, sellerId, body);

export const decideCancellation = (orderId, sellerId, body) =>
  workflow.decideCancellation(orderId, sellerId, { approve: Boolean(body?.approve), note: body?.note });

export const resolveProblem = (orderId, sellerId, body) => workflow.resolveProblem(orderId, sellerId, body || {});
