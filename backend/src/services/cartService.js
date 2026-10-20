import crypto from 'crypto';
import * as cartRepo from '../repositories/cartRepository.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import { findUserByUserId } from '../repositories/userRepository.js';
import { postOrderSystemMessage } from './chatService.js';
import * as paymongo from './paymongoService.js';
import { isSellerClosed, sellingSellerIds } from './sellerAvailability.js';
import CheckoutKey from '../models/CheckoutKey.js';
import { notify, links } from './notify.js';
import User from '../models/User.js';
import {
  PAYMENT_METHODS,
  isGcash,
  normalizePhMobile,
  normalizeGcashReference,
  deliveryFeesBySeller,
  sellableWeights,
} from './orderRules.js';

/** Refuses a sack size the seller does not sell. */
function assertSellableWeight(product, weightKg) {
  const sizes = sellableWeights(product);
  if (!sizes.includes(Number(weightKg))) {
    throw new Error(`${product.name} comes in ${sizes.map((kg) => `${kg} kg`).join(', ')} only.`);
  }
}

/** Two lines are the same line only if the rice and the sack size both match. */
const sameLine = (item, productId, weightKg) =>
  String(item.productId) === String(productId) &&
  Number(item.weightKg || 1) === Number(weightKg);

/** Price of one sack at this weight, applying its tier discount if one is set. */
function priceForWeight(product, weightKg) {
  const base = Number(product.price || 0) * Number(weightKg);
  const tier = (product.weightTiers || []).find((t) => Number(t.weightKg) === Number(weightKg));
  if (!tier?.discountPercent) return base;
  return Math.round(base * (1 - Number(tier.discountPercent) / 100) * 100) / 100;
}

/**
 * Rebuilds the cart against live products so the buyer sees the truth: a price
 * that moved, or an item that sold out while it sat in the cart.
 */
async function decorate(cart) {
  const ids = cart.items.map((i) => i.productId);
  const sellerIds = [...new Set(cart.items.map((i) => i.sellerId))];
  const [products, selling, sellers] = await Promise.all([
    Product.find({ _id: { $in: ids } }).lean(),
    sellingSellerIds(),
    User.find({ userId: { $in: sellerIds } }).select('userId deliveryFee').lean(),
  ]);
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const open = new Set(selling);

  const items = [];
  let subtotal = 0;

  for (const item of cart.items) {
    const product = byId.get(String(item.productId));
    if (!product) continue; // listing was deleted

    const weightKg = Number(item.weightKg || 1);
    const sacks = Number(item.quantity);

    // Priced per sack and multiplied, not priced as one big weight: three
    // 50 kg sacks earn the 50 kg discount three times, where 150 kg matches
    // no tier at all and would quietly lose it.
    const perSack = priceForWeight(product, weightKg);
    const lineTotal = Math.round(perSack * sacks * 100) / 100;

    const needed = weightKg * sacks;
    // A closed seller's sack stays in the cart, so the buyer sees why it
    // cannot be bought, but it counts as having nothing left to sell. So does
    // a listing the seller took down, and a size they no longer sell.
    const sellerSuspended = !open.has(product.createdBy);
    const sizeGone = !sellableWeights(product).includes(weightKg);
    const available = sellerSuspended || product.status === 'inactive' || sizeGone ? 0 : Number(product.stock || 0);

    items.push({
      productId: String(product._id),
      sellerId: product.createdBy,
      name: product.name,
      variety: product.variety || '',
      image: product.images?.[0] || null,
      weightKg,
      quantity: sacks,
      // What the buyer's sacks come to in stock terms, so the seller's page
      // and the buyer's are talking about the same number.
      totalKg: needed,
      unitPrice: perSack,
      unitPriceAtAdd: item.unitPriceAtAdd,
      priceChanged: Number(item.unitPriceAtAdd) !== perSack,
      lineTotal,
      inStock: available >= needed,
      availableStock: available,
      sellerSuspended,
      sizeUnavailable: sizeGone,
    });

    if (available >= needed) subtotal += lineTotal;
  }

  const blocked = items.filter((i) => !i.inStock);

  // Worked out here, never taken from the phone: a fee the client sends is a
  // fee the client can set to anything.
  const fees = deliveryFeesBySeller(
    items,
    new Map(sellers.map((s) => [s.userId, s.deliveryFee])),
  );
  const deliveryFee = [...fees.values()].reduce((sum, fee) => sum + fee, 0);
  const roundedSubtotal = Math.round(subtotal * 100) / 100;

  return {
    items,
    subtotal: roundedSubtotal,
    deliveryFee,
    deliveryFees: [...fees].map(([sellerId, fee]) => ({ sellerId, fee })),
    total: Math.round((roundedSubtotal + deliveryFee) * 100) / 100,
    itemCount: items.reduce((n, i) => n + 1, 0),
    hasUnavailable: blocked.length > 0,
    unavailable: blocked.map((i) => i.name),
  };
}

export const getCart = async (buyerUserId) => decorate(await cartRepo.getOrCreate(buyerUserId));

export const addItem = async (buyerUserId, { productId, weightKg, quantity }) => {
  const sacks = Number(quantity);
  const weight = Number(weightKg || 1);

  if (!productId) throw new Error('Which product?');
  if (!Number.isFinite(weight) || weight <= 0) throw new Error('Choose a weight.');
  if (!Number.isInteger(sacks) || sacks <= 0) throw new Error('Choose a whole number of sacks.');

  const product = await Product.findById(productId);
  if (!product) throw new Error('Product not found');
  if (product.status === 'inactive' || await isSellerClosed(product.createdBy)) {
    throw new Error('That product is not for sale right now.');
  }
  assertSellableWeight(product, weight);

  const cart = await cartRepo.getOrCreate(buyerUserId);
  const existing = cart.items.find((i) => sameLine(i, productId, weight));

  // Checked against what the cart would hold in total, not just what is being
  // added, or three separate taps could add past the stock one at a time.
  const wanted = weight * (sacks + Number(existing?.quantity || 0));
  if (Number(product.stock) < wanted) {
    throw new Error(`Only ${product.stock} kg left.`);
  }

  if (existing) {
    existing.quantity = Number(existing.quantity) + sacks;
  } else {
    cart.items.push({
      productId: product._id,
      sellerId: product.createdBy,
      weightKg: weight,
      quantity: sacks,
      unitPriceAtAdd: priceForWeight(product, weight),
    });
  }

  await cartRepo.save(cart);
  return decorate(cart);
};

export const setQuantity = async (buyerUserId, productId, quantity, weightKg = 1) => {
  const sacks = Number(quantity);
  const weight = Number(weightKg || 1);

  const cart = await cartRepo.getOrCreate(buyerUserId);
  const item = cart.items.find((i) => sameLine(i, productId, weight));
  if (!item) throw new Error('That item is not in your cart.');

  if (!Number.isInteger(sacks)) throw new Error('Choose a whole number of sacks.');

  if (sacks <= 0) {
    cart.items = cart.items.filter((i) => !sameLine(i, productId, weight));
  } else {
    const product = await Product.findById(productId);
    if (product) assertSellableWeight(product, weight);
    if (product && Number(product.stock) < weight * sacks) {
      throw new Error(`Only ${product.stock} kg left.`);
    }
    item.quantity = sacks;
  }

  await cartRepo.save(cart);
  return decorate(cart);
};

export const removeItem = async (buyerUserId, productId, weightKg = 1) =>
  setQuantity(buyerUserId, productId, 0, weightKg);

export const clearCart = async (buyerUserId) => decorate(await cartRepo.clear(buyerUserId));

/**
 * Turns the cart into orders. One Order row per line item — sellers fulfil and
 * get paid separately — but all rows share a groupId and order number so the
 * buyer sees one receipt.
 */
export const checkout = async (buyerUserId, body = {}) => {
  const key = String(body.checkoutKey || '').trim().slice(0, 100);
  if (!key) return placeOrder(buyerUserId, body);

  // Claim the key before anything is written. A second request with the same
  // key either gets the first one's result or is told it is still going.
  try {
    await CheckoutKey.create({ buyerUserId, key });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const previous = await CheckoutKey.findOne({ buyerUserId, key }).lean();
    if (previous?.status === 'done') return { ...previous.result, duplicate: true };
    throw new Error('This order is already being placed. Check your orders in a moment.');
  }

  try {
    const result = await placeOrder(buyerUserId, body);
    await CheckoutKey.updateOne({ buyerUserId, key }, { $set: { status: 'done', result } });
    return result;
  } catch (err) {
    // Nothing was placed, so the same key may try again.
    await CheckoutKey.deleteOne({ buyerUserId, key, status: 'processing' });
    throw err;
  }
};

async function placeOrder(buyerUserId, {
  customerName,
  customerContact,
  deliveryAddress,
  paymentMethod,
  notes,
  paymentProof = '',
  paymentReference = '',
  addressId = '',
}) {
  const method = paymentMethod || 'Cash/COD';
  if (!PAYMENT_METHODS.includes(method)) {
    throw new Error(`Choose a payment method: ${PAYMENT_METHODS.join(', ')}.`);
  }
  if (method === 'PayMongo' && !paymongo.isConfigured()) {
    throw new Error('Online payment is not available right now. Choose cash on delivery or GCash.');
  }

  const cart = await cartRepo.getOrCreate(buyerUserId);
  if (!cart.items.length) throw new Error('Your cart is empty.');

  const view = await decorate(cart);
  if (view.hasUnavailable) {
    const blocked = view.items.filter((i) => !i.inStock);
    const closedShop = blocked.filter((i) => i.sellerSuspended).map((i) => i.name);
    const wrongSize = blocked.filter((i) => !i.sellerSuspended && i.sizeUnavailable).map((i) => `${i.name} (${i.weightKg} kg)`);
    const soldOut = blocked.filter((i) => !i.sellerSuspended && !i.sizeUnavailable).map((i) => i.name);

    throw new Error([
      closedShop.length && `No longer sold: ${closedShop.join(', ')}.`,
      wrongSize.length && `No longer sold in that size: ${wrongSize.join(', ')}.`,
      soldOut.length && `Out of stock: ${soldOut.join(', ')}.`,
      'Remove them to continue.',
    ].filter(Boolean).join(' '));
  }
  if (!deliveryAddress?.trim()) throw new Error('Add a delivery address.');
  if (!customerName?.trim()) throw new Error('Add the name for this delivery.');

  const buyer = await findUserByUserId(buyerUserId);

  // One of the buyer's saved addresses, not free text: the saved one carries
  // the pin the rider navigates to, and coordinates sent in the request could
  // be any pair of numbers.
  const chosen = (buyer?.addresses || []).find((a) => String(a._id) === String(addressId));
  if (!chosen) throw new Error('Choose one of your saved delivery addresses.');

  const contact = normalizePhMobile(customerContact || chosen.contact || buyer?.contact);
  if (!contact) {
    throw new Error('Add a mobile number the rider can call, like 0917 123 4567.');
  }

  // GCash means the money has already moved, so the proof and its reference
  // number come with the order. Enforced here and not only on the checkout
  // screen: anything can post to this endpoint, and a seller left chasing an
  // unprovable GCash order is the person who pays for that.
  let reference = '';
  if (isGcash(method)) {
    if (!paymentProof) throw new Error('Upload your GCash receipt before placing this order.');

    reference = normalizeGcashReference(paymentReference);
    if (!reference) {
      throw new Error('Enter the reference number from your GCash receipt (digits only).');
    }
    if (await Order.exists({ paymentReference: reference })) {
      throw new Error('That GCash reference number is already on another order. Check your receipt.');
    }

    // One transfer pays one seller. Each shop has its own GCash account, so a
    // single receipt cannot cover a basket from two of them.
    if (new Set(view.items.map((line) => line.sellerId)).size > 1) {
      throw new Error('GCash pays one shop at a time. Check out each shop separately, or use cash on delivery.');
    }

    // Only to a GCash account a Super Admin has checked. Money sent to an
    // unverified number cannot be traced back to the shop it was meant for.
    const seller = await findUserByUserId(view.items[0].sellerId);
    if (seller?.payout?.status !== 'verified' || seller?.payout?.method !== 'gcash') {
      throw new Error('This shop does not accept GCash yet. Use cash on delivery or online payment.');
    }
  }

  // One lookup per seller, not per line: a basket of four sacks from one shop
  // is one pickup point.
  const sellerIds = [...new Set(view.items.map((line) => line.sellerId))];
  const pickups = new Map();
  for (const sellerUserId of sellerIds) {
    const seller = await findUserByUserId(sellerUserId);
    pickups.set(sellerUserId, {
      pickupLat: seller?.pickupLat ?? null,
      pickupLng: seller?.pickupLng ?? null,
      pickupAddress: seller?.pickupAddress || '',
    });
  }

  const groupId = crypto.randomUUID();
  const orderNumber = `AGF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  // Each seller's fee lands on that seller's first row only, so it is
  // charged once per shop, not once per sack.
  const feeFor = new Map(view.deliveryFees.map(({ sellerId, fee }) => [sellerId, fee]));
  const orders = [];
  for (const line of view.items) {
    const fee = feeFor.get(line.sellerId) ?? 0;
    feeFor.delete(line.sellerId);
    orders.push(await Order.create({
      sellerId: line.sellerId,
      productId: line.productId,
      // The name carries the sack size, since an order row for "3 × Jasmine"
      // does not say whether that is 3 kg or 150.
      productName: line.weightKg > 1
        ? `${line.name} (${line.weightKg} kg)`
        : line.name,
      unitPrice: line.unitPrice,
      // Sacks, and how big one is. The two together are the kilograms.
      quantity: line.quantity,
      weightKg: line.weightKg || 1,
      subtotal: line.lineTotal,
      deliveryFee: fee,
      total: line.lineTotal + fee,
      paymentMethod: method,

      // A receipt attached at checkout means the buyer has already sent the
      // money and is waiting on the seller to confirm it. Without one the
      // order is simply unpaid - cash on delivery, or GCash still to be sent.
      paymentStatus: paymentProof ? 'proof_sent' : 'unpaid',
      paymentProof,
      paymentReference: reference,
      customerName: customerName.trim(),
      customerContact: contact,
      deliveryAddress: deliveryAddress.trim(),
      buyerUserId,
      status: 'pending',
      source: 'storefront',
      orderNumber,
      groupId,
      notes: notes?.trim() || '',

      // Fixed now, so editing the address later cannot redirect an order that
      // is already on the road.
      route: {
        ...pickups.get(line.sellerId),
        dropoffLat: chosen?.lat ?? null,
        dropoffLng: chosen?.lng ?? null,
        dropoffPrecision: chosen?.precision || '',
      },
    }));
  }

  await cartRepo.clear(buyerUserId);

  // Tell each seller in their own thread. A basket can span several sellers,
  // and each of them only ever sees their own rows - so the message is built
  // per seller rather than one summary of the whole basket.
  const bySeller = new Map();
  for (const row of orders) {
    const lines = bySeller.get(row.sellerId) || [];
    lines.push(row);
    bySeller.set(row.sellerId, lines);
  }

  for (const [sellerUserId, lines] of bySeller) {
    const items = lines
      .map((row) => `${row.quantity}x ${row.productName}`)
      .join(', ');
    const total = lines.reduce((sum, row) => sum + Number(row.total), 0);

    await postOrderSystemMessage({
      sellerUserId,
      buyerUserId,
      text:
        `Order ${orderNumber} placed - ${items}. Total P${total.toFixed(2)}, ` +
        `paid by ${method}. Waiting for the seller to confirm.`,
    });
    await notify({
      userId: sellerUserId,
      title: `New order ${orderNumber}`,
      body: `${items} - ₱${total.toFixed(2)} by ${method}.${isGcash(method) ? ' Check the GCash receipt.' : ''}`,
      link: links.sellerOrder(lines[0]._id),
    });
  }

  // The orders exist either way. If PayMongo is down, the buyer can open the
  // order and press "Pay now" again instead of losing the basket.
  let checkoutUrl = null;
  if (method === 'PayMongo') {
    try {
      ({ checkoutUrl } = await paymongo.startPayment(buyerUserId, groupId));
    } catch (err) {
      console.error('[checkout] PayMongo session failed:', err.message);
    }
  }

  return {
    orderNumber,
    groupId,
    checkoutUrl,
    itemCount: orders.length,
    total: orders.reduce((sum, o) => sum + Number(o.total), 0),
    paymentMethod: method,
    deliveryAddress: deliveryAddress.trim(),
  };
}
