import Order from '../models/Order.js';
import Product from '../models/Product.js';

export const createOrder = async (data) => {
  return await Order.create(data);
};

export const setOrderNumber = async (id, orderNumber) => {
  return await Order.findByIdAndUpdate(id, { orderNumber }, { new: true });
};

export const findOrdersBySeller = async (sellerId, { status } = {}) => {
  const filter = { sellerId };
  if (status) filter.status = status;
  return await Order.find(filter).sort({ orderDate: -1 });
};

export const findOrderById = async (id) => {
  return await Order.findById(id);
};

export const hasActiveOrdersForProduct = async (productId) => {
  const count = await Order.countDocuments({
    productId,
    status: { $nin: ['completed', 'cancelled', 'refunded'] },
  });
  return count > 0;
};

/**
 * Moves an order from `from` to the new status only if it is still at `from`.
 *
 * Two clicks on "Confirm" (or two open tabs) both read "pending". Only the
 * first of these conditional updates matches; the second finds nothing and
 * returns null, so whatever follows - taking stock out - happens once.
 */
export const claimStatus = async (id, sellerId, from, { status, statusReason, historyEntry }) => {
  return await Order.findOneAndUpdate(
    { _id: id, sellerId, status: from },
    {
      $set: { status, statusReason },
      $push: { statusHistory: historyEntry },
    },
    { new: true }
  );
};

/** Undoes a claimStatus whose follow-up failed (for example, no stock left). */
export const revertStatus = async (id, status) => {
  return await Order.findByIdAndUpdate(id, {
    $set: { status },
    $pop: { statusHistory: 1 },
  });
};

/**
 * The lines one GCash transfer paid for: this seller's rows from the same
 * checkout. An order typed in by the seller stands alone.
 */
export const findPaymentGroup = async (order) => {
  if (!order.groupId) return [order];
  return await Order.find({ groupId: order.groupId, sellerId: order.sellerId });
};

/** Whether this GCash reference is already recorded on an order outside `ids`. */
export const referenceUsedElsewhere = async (reference, ids) => {
  return Boolean(await Order.exists({ paymentReference: reference, _id: { $nin: ids } }));
};

export const setStockDeducted = async (id, stockDeducted) => {
  return await Order.findByIdAndUpdate(id, { $set: { stockDeducted } });
};

const EIGHT_WEEKS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 7 * 7);
  d.setHours(0, 0, 0, 0);
  return d;
};

const SIX_MONTHS_AGO = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 5);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const getSellerAnalytics = async (sellerId) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    monthlyIncomeRaw,
    totals,
    topProductRaw,
    salesLast30DaysRaw,
    weeklyIncomeRaw,
    clientsRaw,
    recentOrdersRaw,
  ] = await Promise.all([
    Order.aggregate([
      { $match: { sellerId, status: 'completed', orderDate: { $gte: SIX_MONTHS_AGO() } } },
      {
        $group: {
          _id: { year: { $year: '$orderDate' }, month: { $month: '$orderDate' } },
          income: { $sum: '$total' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Order.aggregate([
      { $match: { sellerId, status: 'completed' } },
      { $group: { _id: null, totalSales: { $sum: '$total' }, orderCount: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { sellerId, status: 'completed' } },
      {
        $group: {
          _id: '$productId',
          productName: { $first: '$productName' },
          unitsSold: { $sum: '$quantity' },
        },
      },
      { $sort: { unitsSold: -1 } },
      { $limit: 1 },
    ]),
    Order.aggregate([
      { $match: { sellerId, status: 'completed', orderDate: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    // Weekly income for the trailing 8 weeks
    Order.aggregate([
      { $match: { sellerId, status: 'completed', orderDate: { $gte: EIGHT_WEEKS_AGO() } } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$orderDate', unit: 'week', startOfWeek: 'monday' } },
          income: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Distinct customers, ranked by spend. Buyers without an account are keyed by name.
    Order.aggregate([
      { $match: { sellerId, status: 'completed' } },
      {
        $group: {
          _id: { $ifNull: [{ $toString: '$buyerUserId' }, { $toLower: '$customerName' }] },
          name: { $first: '$customerName' },
          buyerUserId: { $first: '$buyerUserId' },
          spent: { $sum: '$total' },
          orders: { $sum: 1 },
          lastOrder: { $max: '$orderDate' },
        },
      },
      { $sort: { spent: -1 } },
    ]),
    // Recent order history - any status, so the Super Admin sees cancellations too
    Order.find({ sellerId })
      .sort({ orderDate: -1 })
      .limit(12)
      .select('orderNumber productName customerName buyerUserId quantity total status orderDate paymentMethod')
      .lean(),
  ]);

  const totalSales = totals[0]?.totalSales || 0;
  const orderCount = totals[0]?.orderCount || 0;
  const avgOrderValue = orderCount ? totalSales / orderCount : 0;
  const salesLast30Days = salesLast30DaysRaw[0]?.total || 0;

  let topProduct = null;
  if (topProductRaw[0]) {
    const product = await Product.findById(topProductRaw[0]._id).select('stock');
    topProduct = {
      productId: topProductRaw[0]._id,
      name: topProductRaw[0].productName,
      unitsSold: topProductRaw[0].unitsSold,
      stock: product ? product.stock : null,
    };
  }

  const monthlyIncome = monthlyIncomeRaw.map((m) => ({
    year: m._id.year,
    month: m._id.month,
    income: m.income,
  }));

  // --- Weekly series: emit all 8 buckets so the chart never has holes ---
  const weekMap = new Map(
    weeklyIncomeRaw.map((w) => [new Date(w._id).toISOString().slice(0, 10), w])
  );
  const weekStart = (d) => {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const weeklyIncome = [];
  const cursor = weekStart(EIGHT_WEEKS_AGO());
  const thisWeek = weekStart(new Date());
  while (cursor <= thisWeek) {
    const key = cursor.toISOString().slice(0, 10);
    const hit = weekMap.get(key);
    weeklyIncome.push({
      weekStart: key,
      income: hit?.income || 0,
      orders: hit?.orders || 0,
    });
    cursor.setDate(cursor.getDate() + 7);
  }

  // --- Clients ---
  const totalClients = clientsRaw.length;
  const repeatClients = clientsRaw.filter((c) => c.orders > 1).length;
  const newClientsLast30 = clientsRaw.filter(
    (c) => c.lastOrder && new Date(c.lastOrder) >= thirtyDaysAgo
  ).length;
  const topClients = clientsRaw.slice(0, 5).map((c) => ({
    name: c.name || 'Walk-in customer',
    buyerUserId: c.buyerUserId ?? null,
    spent: c.spent,
    orders: c.orders,
    lastOrder: c.lastOrder,
  }));

  const recentOrders = recentOrdersRaw.map((o) => ({
    id: String(o._id),
    orderNumber: o.orderNumber || null,
    productName: o.productName,
    customerName: o.customerName,
    buyerUserId: o.buyerUserId ?? null,
    quantity: o.quantity,
    total: o.total,
    status: o.status,
    paymentMethod: o.paymentMethod,
    orderDate: o.orderDate,
  }));

  const repeatRate = totalClients ? Math.round((repeatClients / totalClients) * 100) : 0;

  // --- Descriptive: what the numbers say about this business right now ---
  const strengths = [];
  const weaknesses = [];

  if (orderCount > 0) {
    strengths.push(`Completed ${orderCount} order${orderCount === 1 ? '' : 's'} worth PHP ${totalSales.toLocaleString()} to date.`);
  }
  if (repeatClients > 0) {
    strengths.push(`${repeatClients} of ${totalClients} customers ordered more than once (${repeatRate}% repeat rate).`);
  }
  if (topProduct) {
    strengths.push(`${topProduct.name} is the strongest performer with ${topProduct.unitsSold} units sold.`);
  }
  if (monthlyIncome.length >= 2) {
    const latest = monthlyIncome[monthlyIncome.length - 1];
    const previous = monthlyIncome[monthlyIncome.length - 2];
    if (latest.income > previous.income) {
      strengths.push(`Month-on-month income is up (PHP ${previous.income.toLocaleString()} to PHP ${latest.income.toLocaleString()}).`);
    }
  }

  if (orderCount === 0) {
    weaknesses.push('No completed orders yet, so there is no sales history to evaluate.');
  }
  if (totalClients > 0 && repeatClients === 0) {
    weaknesses.push('Every customer so far has ordered only once - no repeat business yet.');
  }
  if (salesLast30Days === 0 && orderCount > 0) {
    weaknesses.push('Sales have stalled: nothing completed in the last 30 days.');
  }
  if (topProduct && topProduct.stock != null && topProduct.stock <= 5) {
    weaknesses.push(`Best seller ${topProduct.name} is nearly out of stock (${topProduct.stock} left).`);
  }
  if (avgOrderValue > 0 && avgOrderValue < 200) {
    weaknesses.push(`Average order value is low at PHP ${Math.round(avgOrderValue).toLocaleString()}.`);
  }

  // --- Prescriptive: what to do about it ---
  const suggestions = [];
  if (topProduct && topProduct.stock != null && topProduct.stock <= 5) {
    suggestions.push({
      type: 'LOW_STOCK_BESTSELLER',
      message: `${topProduct.name} is your best seller but only has ${topProduct.stock} left in stock. Restock soon to avoid missed sales.`,
    });
  }
  if (monthlyIncome.length >= 2) {
    const latest = monthlyIncome[monthlyIncome.length - 1];
    const previous = monthlyIncome[monthlyIncome.length - 2];
    if (previous.income > 0 && latest.income < previous.income * 0.8) {
      suggestions.push({
        type: 'MONTHLY_DECLINE',
        message: `Sales dropped compared to last month (₱${previous.income.toLocaleString()} → ₱${latest.income.toLocaleString()}). Consider a promo or checking in with regular customers.`,
      });
    }
  }
  if (salesLast30Days === 0) {
    suggestions.push({
      type: 'NO_RECENT_SALES',
      message: 'No completed sales recorded in the last 30 days. Consider reaching out to past customers or reviewing pricing.',
    });
  }

  if (totalClients > 0 && repeatClients === 0) {
    suggestions.push({
      type: 'NO_REPEAT_CLIENTS',
      message: 'No customer has ordered twice yet. A follow-up message or a returning-customer discount is the cheapest way to lift revenue.',
    });
  }
  if (avgOrderValue > 0 && avgOrderValue < 200) {
    suggestions.push({
      type: 'LOW_ORDER_VALUE',
      message: 'Average order value is low. Try bundle pricing or a free-delivery threshold to raise basket size.',
    });
  }

  return {
    monthlyIncome,
    weeklyIncome,
    totalSales,
    orderCount,
    avgOrderValue,
    topProduct,
    salesLast30Days,
    clients: {
      total: totalClients,
      repeat: repeatClients,
      newLast30: newClientsLast30,
      repeatRate,
    },
    topClients,
    recentOrders,
    strengths,
    weaknesses,
    suggestions,
  };
};

export const getPlatformRevenueTotal = async () => {
  const result = await Order.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$total' } } },
  ]);
  return result[0]?.total || 0;
};

export const getDistinctCustomersForSeller = async (sellerId) => {
  return await Order.aggregate([
    { $match: { sellerId, status: 'completed' } },
    {
      $group: {
        _id: '$customerName',
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: '$total' },
        lastOrderDate: { $max: '$orderDate' },
      },
    },
    { $sort: { lastOrderDate: -1 } },
  ]);
};

const TWELVE_MONTHS_AGO = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const getSellerBreakdown = async (sellerId) => {
  const [varietyRaw, fulfillmentRaw, topBuyers, seasonalRaw, currentStockAgg] = await Promise.all([
    Order.aggregate([
      { $match: { sellerId, status: 'completed' } },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$product.variety', 'Other'] },
          revenue: { $sum: '$total' },
          unitsSold: { $sum: '$quantity' },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
    Order.aggregate([
      { $match: { sellerId, status: { $in: ['completed', 'cancelled'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    getDistinctCustomersForSeller(sellerId),
    Order.aggregate([
      { $match: { sellerId, status: 'completed', orderDate: { $gte: TWELVE_MONTHS_AGO() } } },
      {
        $group: {
          _id: { year: { $year: '$orderDate' }, month: { $month: '$orderDate' } },
          income: { $sum: '$total' },
          units: { $sum: '$quantity' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Product.aggregate([
      { $match: { createdBy: sellerId } },
      { $group: { _id: null, totalStock: { $sum: '$stock' } } },
    ]),
  ]);

  const salesByVariety = varietyRaw.map((v) => ({ variety: v._id, revenue: v.revenue, unitsSold: v.unitsSold }));

  const completedCount = fulfillmentRaw.find((r) => r._id === 'completed')?.count || 0;
  const cancelledCount = fulfillmentRaw.find((r) => r._id === 'cancelled')?.count || 0;
  const fulfillmentRate = completedCount + cancelledCount
    ? Math.round((completedCount / (completedCount + cancelledCount)) * 100)
    : null;

  const repeatBuyers = topBuyers.filter((b) => b.totalOrders > 1).length;
  const repeatBuyerRate = topBuyers.length ? Math.round((repeatBuyers / topBuyers.length) * 100) : null;

  // Average time (days) between an order's "confirmed" and "completed" timestamps.
  const fulfilledOrders = await Order.find({ sellerId, status: 'completed' }).select('statusHistory');
  const durations = fulfilledOrders
    .map((o) => {
      const confirmedAt = o.statusHistory.find((h) => h.status === 'confirmed')?.changedAt;
      const completedAt = o.statusHistory.find((h) => h.status === 'completed')?.changedAt;
      if (!confirmedAt || !completedAt) return null;
      return (new Date(completedAt) - new Date(confirmedAt)) / (1000 * 60 * 60 * 24);
    })
    .filter((d) => d != null && d >= 0);
  const avgFulfillmentDays = durations.length
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
    : null;

  const seasonalTrend = seasonalRaw.map((m) => ({ year: m._id.year, month: m._id.month, income: m.income, units: m.units }));
  let peakMonthObservation = null;
  if (seasonalTrend.length > 0) {
    const maxIncome = Math.max(...seasonalTrend.map((m) => m.income));
    const peakMonths = seasonalTrend.filter((m) => m.income === maxIncome).map((m) => MONTH_NAMES[m.month - 1]);
    peakMonthObservation = `Highest sales volume recorded: ${peakMonths.join(', ')} (₱${maxIncome.toLocaleString()}).`;
  }

  const unitsSoldLast6Months = seasonalTrend.slice(-6).reduce((sum, m) => sum + m.units, 0);
  const currentTotalStock = currentStockAgg[0]?.totalStock || 0;
  const inventoryTurnover = currentTotalStock > 0
    ? Math.round((unitsSoldLast6Months / currentTotalStock) * 100) / 100
    : null;

  return {
    salesByVariety,
    fulfillmentRate,
    topBuyers,
    repeatBuyerRate,
    avgFulfillmentDays,
    seasonalTrend,
    peakMonthObservation,
    inventoryTurnover,
  };
};

/**
 * Platform-wide DESCRIPTIVE analytics: what the businesses on AgriFair have
 * actually done. No forecasting, no recommendations - only observed facts.
 */
export const getPlatformBusinessAnalytics = async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totals, statusMix, perSeller, monthly, topProducts, recentTotals] = await Promise.all([
    Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, gmv: { $sum: '$total' }, orders: { $sum: 1 }, units: { $sum: '$quantity' } } },
    ]),
    Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } },
      { $sort: { count: -1 } },
    ]),
    Order.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$sellerId',
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
          units: { $sum: '$quantity' },
          customers: { $addToSet: { $ifNull: [{ $toString: '$buyerUserId' }, { $toLower: '$customerName' }] } },
          lastSale: { $max: '$orderDate' },
        },
      },
      { $project: { revenue: 1, orders: 1, units: 1, lastSale: 1, customers: { $size: '$customers' } } },
      { $sort: { revenue: -1 } },
    ]),
    Order.aggregate([
      { $match: { status: 'completed', orderDate: { $gte: SIX_MONTHS_AGO() } } },
      {
        $group: {
          _id: { year: { $year: '$orderDate' }, month: { $month: '$orderDate' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Order.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$productId',
          name: { $first: '$productName' },
          units: { $sum: '$quantity' },
          revenue: { $sum: '$total' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([
      { $match: { status: 'completed', orderDate: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, gmv: { $sum: '$total' }, orders: { $sum: 1 } } },
    ]),
  ]);

  const gmv = totals[0]?.gmv || 0;
  const orderCount = totals[0]?.orders || 0;

  return {
    gmv,
    orderCount,
    unitsSold: totals[0]?.units || 0,
    avgOrderValue: orderCount ? gmv / orderCount : 0,
    gmvLast30Days: recentTotals[0]?.gmv || 0,
    ordersLast30Days: recentTotals[0]?.orders || 0,
    statusMix: statusMix.map((s) => ({ status: s._id, count: s.count, value: s.value })),
    // Emit all six buckets, including empty months, so the chart has a real
    // shape instead of collapsing to a single full-width bar.
    monthly: (() => {
      const found = new Map(monthly.map((m) => [`${m._id.year}-${m._id.month}`, m]));
      const out = [];
      const cursor = SIX_MONTHS_AGO();
      const now = new Date();
      while (
        cursor.getFullYear() < now.getFullYear() ||
        (cursor.getFullYear() === now.getFullYear() && cursor.getMonth() <= now.getMonth())
      ) {
        const year = cursor.getFullYear();
        const month = cursor.getMonth() + 1;
        const hit = found.get(`${year}-${month}`);
        out.push({ year, month, revenue: hit?.revenue || 0, orders: hit?.orders || 0 });
        cursor.setMonth(cursor.getMonth() + 1);
      }
      return out;
    })(),
    topProducts: topProducts.map((p) => ({
      productId: String(p._id),
      name: p.name,
      units: p.units,
      revenue: p.revenue,
    })),
    sellers: perSeller.map((s) => ({
      sellerId: s._id,
      revenue: s.revenue,
      orders: s.orders,
      units: s.units,
      customers: s.customers,
      lastSale: s.lastSale,
    })),
  };
};
