import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import User from '../models/User.js';
import AdminAuditLog from '../models/AdminAuditLog.js';

/**
 * Database reads for analytics. Every read takes a `scope`:
 *
 *   { sellerId: 12 }   one seller's records - always set from the signed-in
 *                      seller, or by a Super Admin route that checked the id
 *   {}                 the whole marketplace (Super Admin only)
 *
 * Only the fields the calculations use are read, and only for the requested
 * range, so a seller's dashboard never loads their whole order history.
 */

const ORDER_FIELDS = 'sellerId groupId orderNumber productId productName unitPrice quantity weightKg subtotal deliveryFee total '
  + 'status orderDate buyerUserId customerName statusHistory paymentStatus paymentMethod source amountPaid refund';

const sellerMatch = (scope) => (scope.sellerId != null ? { sellerId: scope.sellerId } : {});

/** Product ids for a variety, within the scope. Null when no filter applies. */
export async function productIdsFor(scope, { variety, productId } = {}) {
  if (productId) {
    if (!mongoose.isValidObjectId(productId)) return [];
    return [new mongoose.Types.ObjectId(productId)];
  }
  if (!variety) return null;
  const match = { variety };
  if (scope.sellerId != null) match.createdBy = scope.sellerId;
  const products = await Product.find(match).select('_id').lean();
  return products.map((p) => p._id);
}

/** Order rows placed in [start, end), within scope and filters. */
export async function ordersBetween(scope, start, end, filters = {}) {
  const match = { ...sellerMatch(scope), orderDate: { $gte: start, $lt: end } };
  const ids = await productIdsFor(scope, filters);
  if (ids) match.productId = { $in: ids };
  if (filters.statuses?.length) match.status = { $in: filters.statuses };
  return Order.find(match).select(ORDER_FIELDS).sort({ orderDate: 1 }).lean();
}

/** Completed rows only, for long histories (seasons). */
export async function completedBetween(scope, start, end, filters = {}) {
  return ordersBetween(scope, start, end, { ...filters, statuses: ['completed'] });
}

/** The earliest completed sale in scope, or null. */
export async function firstSaleDate(scope, filters = {}) {
  const match = { ...sellerMatch(scope), status: 'completed' };
  const ids = await productIdsFor(scope, filters);
  if (ids) match.productId = { $in: ids };
  const row = await Order.findOne(match).sort({ orderDate: 1 }).select('orderDate').lean();
  return row?.orderDate || null;
}

/** The most recent order of any status in scope: when the data last changed. */
export async function lastOrderDate(scope) {
  const row = await Order.findOne(sellerMatch(scope)).sort({ updatedAt: -1 }).select('updatedAt').lean();
  return row?.updatedAt || null;
}

/** The same buyer key metrics.buyerKey builds, as an aggregation expression. */
const BUYER_KEY = {
  $cond: [
    { $eq: [{ $ifNull: ['$buyerUserId', null] }, null] },
    { $concat: ['n:', { $toLower: { $trim: { input: { $ifNull: ['$customerName', ''] } } } }] },
    { $concat: ['u:', { $toString: '$buyerUserId' }] },
  ],
};

/**
 * Each buyer's first and last completed purchase before `end`, with lifetime
 * spend - grouped in the database, so only one row per buyer comes back.
 */
export async function buyerHistory(scope, end, filters = {}) {
  const match = { ...sellerMatch(scope), status: 'completed', orderDate: { $lt: end } };
  const ids = await productIdsFor(scope, filters);
  if (ids) match.productId = { $in: ids };
  const rows = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: BUYER_KEY,
        first: { $min: '$orderDate' },
        last: { $max: '$orderDate' },
        spent: { $sum: '$total' },
        name: { $last: '$customerName' },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, { first: r.first, last: r.last, spent: r.spent, name: r.name }]));
}

/** productId -> variety, for the products these rows reference. */
export async function varietyLookup(rows) {
  const ids = [...new Set(rows.map((r) => String(r.productId)))].filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return () => 'Other';
  const products = await Product.find({ _id: { $in: ids } }).select('variety').lean();
  const map = new Map(products.map((p) => [String(p._id), p.variety || 'Other']));
  // A product deleted since the sale keeps its sales, under "Other".
  return (row) => map.get(String(row.productId)) || 'Other';
}

export async function productsOf(scope) {
  const match = scope.sellerId != null ? { createdBy: scope.sellerId } : {};
  return Product.find(match).select('name variety stock lowStockThreshold price status createdBy weightTiers').lean();
}

/** Varieties a seller (or the platform) actually lists, for the filter menu. */
export async function varietiesOf(scope) {
  const match = scope.sellerId != null ? { createdBy: scope.sellerId } : {};
  return (await Product.distinct('variety', match)).filter(Boolean).sort();
}

/**
 * Stock movements needed for inventory analytics: everything from the earlier
 * of the period start and the 30-day velocity window, the last movement of
 * each product before the period, and each product's first movement.
 */
export async function movementsFor(sellerId, start, end, velocityStart) {
  const from = new Date(Math.min(start, velocityStart));
  const [movements, lastBeforeRows, firstRows] = await Promise.all([
    StockMovement.find({ sellerId, createdAt: { $gte: from, $lt: end } }).sort({ createdAt: 1 }).lean(),
    StockMovement.aggregate([
      { $match: { sellerId, createdAt: { $lt: start } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$productId', resultingStock: { $first: '$resultingStock' }, createdAt: { $first: '$createdAt' } } },
    ]),
    StockMovement.aggregate([
      { $match: { sellerId } },
      { $group: { _id: '$productId', first: { $min: '$createdAt' } } },
    ]),
  ]);
  return {
    movements,
    lastBefore: new Map(lastBeforeRows.map((r) => [String(r._id), r])),
    firstSeen: new Map(firstRows.map((r) => [String(r._id), r.first])),
  };
}

export async function productMovements(sellerId, productId, end) {
  if (!mongoose.isValidObjectId(productId)) return [];
  return StockMovement.find({ sellerId, productId, createdAt: { $lt: end } })
    .sort({ createdAt: 1 }).select('createdAt resultingStock type quantity').lean();
}

/** Seller accounts: names for tables, and counts by status. */
export async function sellerAccounts() {
  return User.find({ role: 'seller' }).select('userId name status createdAt').lean();
}

export async function userCounts() {
  const rows = await User.aggregate([{ $group: { _id: { role: '$role', status: '$status' }, count: { $sum: 1 } } }]);
  const count = (role, status) => rows
    .filter((r) => r._id.role === role && (!status || r._id.status === status))
    .reduce((s, r) => s + r.count, 0);
  return {
    buyers: count('buyer'),
    sellers: count('seller'),
    activeSellers: count('seller', 'active'),
    pendingSellers: count('seller', 'pending'),
    suspendedSellers: count('seller', 'suspended'),
    riders: count('rider'),
  };
}

/** Accounts created in [start, end), for the registrations chart. */
export async function usersCreatedBetween(start, end) {
  return User.find({ createdAt: { $gte: start, $lt: end } }).select('role createdAt').lean();
}

/**
 * Seller approvals granted in [start, end). Approving a seller writes an
 * APPROVE_SELLER entry to the audit log, which is the record of when it happened.
 */
export async function approvalsBetween(start, end) {
  const rows = await AdminAuditLog.find({ action: 'APPROVE_SELLER', createdAt: { $gte: start, $lt: end } }).select('createdAt').lean();
  return rows.map((r) => ({ approvedAt: r.createdAt }));
}

/** Seller applications waiting: the same rule as the Users page (status pending). */
export async function pendingApprovalCount() {
  return User.countDocuments({ role: 'seller', status: 'pending' });
}

export async function findSeller(sellerId) {
  return User.findOne({ userId: sellerId, role: 'seller' }).select('userId name status').lean();
}

export async function findUser(userId) {
  return User.findOne({ userId }).select('userId name role status createdAt').lean();
}

/** A buyer's own orders, for the Super Admin's account view. */
export async function ordersOfBuyer(buyerUserId) {
  return Order.find({ buyerUserId }).select(ORDER_FIELDS).sort({ orderDate: 1 }).lean();
}

/**
 * Seller applications for the Super Admin dashboard: everyone who applied,
 * with what the reviewer needs (submitted when, permits and how many are
 * verified) and the decision, if any.
 */
export async function sellerApplications() {
  return User.find({ role: 'seller' })
    .select('userId name email status statusReason createdAt application documents sellerProfile.businessName')
    .lean();
}
