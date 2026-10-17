import mongoose from 'mongoose';
import { ORDER_STATUSES } from '../models/Order.js';
import { RICE_VARIETIES } from '../models/Product.js';
import * as data from './data.js';
import {
  resolvePeriod, badRequest, buckets, bucketStart, addMonths, addDays,
} from './period.js';
import {
  summarize, change, timeSeries, alignComparison, extremes, biggestMoves, completionTimes,
  productTable, varietyTable, seriesBy, buyerAnalysis, buyerSeries, seasonality,
  statusBreakdown, sellerTable, isSale, INACTIVE_DAYS,
} from './metrics.js';
import { inventoryAnalysis, stockLevels, VELOCITY_WINDOW_DAYS } from './inventory.js';
import { sellerInsights, platformInsights } from './insights.js';

const DAY = 24 * 60 * 60 * 1000;

export const SELLER_SECTIONS = ['overview', 'sales', 'products', 'buyers', 'seasons', 'inventory'];
export const PLATFORM_SECTIONS = ['overview', 'sales', 'sellers', 'products', 'users', 'seasons'];

/**
 * Who may see what. The seller id never comes from the request for a seller:
 * it is their own account. A Super Admin may look at the whole marketplace or,
 * through the seller-detail routes, at one named seller.
 */
export function scopeFor(user, { sellerId } = {}) {
  if (!user) throw Object.assign(new Error('Not authorized'), { status: 401 });
  if (user.role === 'seller') return { sellerId: user.userId };
  if (user.role === 'superadmin') {
    if (sellerId == null || sellerId === '') return {};
    const id = Number(sellerId);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Unknown seller.');
    return { sellerId: id };
  }
  throw Object.assign(new Error('Not authorized'), { status: 403 });
}

/** Validated filters. Anything unrecognised is dropped, not passed to a query. */
export function parseFilters(query = {}) {
  const filters = {};
  if (query.variety && RICE_VARIETIES.includes(query.variety)) filters.variety = query.variety;
  if (query.productId && mongoose.isValidObjectId(query.productId)) filters.productId = String(query.productId);
  if (query.status && ORDER_STATUSES.includes(query.status)) filters.status = query.status;
  if (query.inactiveDays) {
    const d = Number(query.inactiveDays);
    if (Number.isInteger(d) && d >= 14 && d <= 365) filters.inactiveDays = d;
  }
  return filters;
}

const kpi = (id, label, value, previous, extra = {}) => ({
  id,
  label,
  value,
  previous: previous ?? null,
  change: previous === undefined ? null : change(value, previous),
  ...extra,
});

/** Rows and lookups shared by every section of one request. */
async function load(scope, query) {
  const period = resolvePeriod(query);
  const filters = parseFilters(query);
  const [rows, prevRows, dataUpdatedAt] = await Promise.all([
    data.ordersBetween(scope, period.start, period.end, filters),
    period.comparison ? data.ordersBetween(scope, period.comparison.start, period.comparison.end, filters) : [],
    data.lastOrderDate(scope),
  ]);
  const varietyOf = await data.varietyLookup([...rows, ...prevRows]);
  return { period, filters, rows, prevRows, varietyOf, dataUpdatedAt };
}

const meta = (ctx, extra = {}) => ({
  period: ctx.period,
  filters: ctx.filters,
  generatedAt: new Date(),
  dataUpdatedAt: ctx.dataUpdatedAt,
  ...extra,
});

function salesSeries(ctx) {
  const { period, rows, prevRows } = ctx;
  const cur = timeSeries(rows, period.start, period.end, period.granularity);
  if (!period.comparison) return cur;
  const prev = timeSeries(prevRows, period.comparison.start, period.comparison.end, period.granularity);
  return alignComparison(cur, prev);
}

async function inventoryFor(sellerId, period, query = {}) {
  const now = new Date();
  const velocityStart = new Date(Math.min(period.end, now) - VELOCITY_WINDOW_DAYS * DAY);
  const [products, moves] = await Promise.all([
    data.productsOf({ sellerId }),
    data.movementsFor(sellerId, period.start, period.end, velocityStart),
  ]);
  const result = inventoryAnalysis({
    products, ...moves, start: period.start, end: period.end, granularity: period.granularity, now,
  });
  if (query.productId && mongoose.isValidObjectId(query.productId)) {
    const own = products.find((p) => String(p._id) === String(query.productId));
    if (own) {
      result.levels = {
        productId: String(own._id),
        name: own.name,
        points: stockLevels(await data.productMovements(sellerId, own._id, period.end)),
      };
    }
  }
  return result;
}

/** The full set of seller numbers for one period. */
async function sellerContext(scope, query, { withInventory = true } = {}) {
  const ctx = await load(scope, query);
  const { period, rows, prevRows, varietyOf } = ctx;
  const history = await data.buyerHistory(scope, period.end, ctx.filters);
  const summary = summarize(rows);
  const previous = period.comparison ? summarize(prevRows) : null;
  const series = salesSeries(ctx);
  const buyers = buyerAnalysis(rows, history, { start: period.start, end: period.end, inactiveDays: ctx.filters.inactiveDays || INACTIVE_DAYS });
  const prevBuyers = period.comparison
    ? buyerAnalysis(prevRows, history, { start: period.comparison.start, end: period.comparison.end })
    : null;
  const inventory = withInventory && scope.sellerId != null ? await inventoryFor(scope.sellerId, period) : null;
  return {
    ...ctx,
    history,
    summary,
    previous,
    series,
    buyers,
    prevBuyers,
    inventory,
    completion: completionTimes(rows),
    previousCompletion: period.comparison ? completionTimes(prevRows) : null,
    products: productTable(rows, varietyOf),
    previousProducts: productTable(prevRows, varietyOf),
    varieties: varietyTable(rows, varietyOf),
    extremes: extremes(series),
    moves: biggestMoves(series),
  };
}

function insightsOf(ctx) {
  return sellerInsights(ctx);
}

const pick = (list, categories) => list.filter((i) => categories.includes(i.category));

// ---------------------------------------------------------------- seller

export async function sellerSection(scope, section, query = {}) {
  if (!SELLER_SECTIONS.includes(section)) throw badRequest('Unknown analytics section.');
  if (section === 'seasons') return seasons(scope, query);
  if (section === 'inventory') return inventorySection(scope, query);

  const ctx = await sellerContext(scope, query, { withInventory: section === 'overview' });
  const { summary: s, previous: p } = ctx;
  const insights = insightsOf(ctx);

  if (section === 'overview') {
    return meta(ctx, {
      kpis: [
        kpi('sales', 'Completed sales', s.sales, p?.sales, { format: 'peso', note: 'Rice and delivery fees on completed orders' }),
        kpi('orders', 'Completed orders', s.completedOrders, p?.completedOrders, { format: 'number' }),
        kpi('aov', 'Average order value', s.aov, p?.aov, { format: 'peso', note: 'Completed sales ÷ completed orders' }),
        kpi('kg', 'Rice sold', s.kg, p?.kg, { format: 'kg', note: Object.entries(s.sacks).map(([k, v]) => `${v} × ${k}`).join(', ') || 'No completed sales' }),
        kpi('repeat', 'Repeat buyers', ctx.buyers.repeatRate, ctx.prevBuyers?.repeatRate, { format: 'percent', note: 'Buyers with 2+ completed orders' }),
        kpi('completion', 'Completion rate', s.completionRate, p?.completionRate, { format: 'percent', note: 'Completed ÷ (completed + cancelled)' }),
      ],
      series: ctx.series,
      status: statusBreakdown(ctx.rows),
      cancellationRate: s.cancellationRate,
      inventory: ctx.inventory && { totals: ctx.inventory.totals, alerts: ctx.inventory.alerts.slice(0, 5) },
      varieties: ctx.varieties.slice(0, 5),
      insights: insights.slice(0, 8),
    });
  }

  if (section === 'sales') {
    return meta(ctx, {
      kpis: [
        kpi('sales', 'Completed sales', s.sales, p?.sales, { format: 'peso' }),
        kpi('orders', 'Completed orders', s.completedOrders, p?.completedOrders, { format: 'number' }),
        kpi('aov', 'Average order value', s.aov, p?.aov, { format: 'peso' }),
        kpi('completionDays', 'Order to completed', ctx.completion.avgDays, ctx.previousCompletion?.avgDays, { format: 'days', note: `Median ${ctx.completion.medianDays ?? '—'} days`, lowerIsBetter: true }),
        kpi('completion', 'Completion rate', s.completionRate, p?.completionRate, { format: 'percent' }),
        kpi('cancellation', 'Cancellation rate', s.cancellationRate, p?.cancellationRate, { format: 'percent', lowerIsBetter: true }),
      ],
      summary: s,
      previous: p,
      series: ctx.series,
      extremes: ctx.extremes,
      moves: ctx.moves,
      completion: { current: ctx.completion, previous: ctx.previousCompletion },
      buyerSeries: buyerSeries(ctx.rows, ctx.history, ctx.period.start, ctx.period.end, ctx.period.granularity),
      insights: pick(insights, ['growth', 'highlights', 'unusual', 'attention']),
    });
  }

  if (section === 'products') {
    const prevBy = new Map(ctx.previousProducts.map((x) => [x.key, x]));
    const prevVar = new Map(varietyTable(ctx.prevRows, ctx.varietyOf).map((x) => [x.variety, x]));
    const top = ctx.varieties.slice(0, 6).map((v) => v.variety);
    return meta(ctx, {
      products: ctx.products.map((x) => ({ ...x, previousSales: prevBy.get(x.key)?.sales ?? 0, change: change(x.sales, prevBy.get(x.key)?.sales ?? 0) })),
      varieties: ctx.varieties.map((v) => ({ ...v, previousSales: prevVar.get(v.variety)?.sales ?? 0, change: change(v.sales, prevVar.get(v.variety)?.sales ?? 0) })),
      varietySeries: { keys: top, points: seriesBy(ctx.rows, ctx.period.start, ctx.period.end, ctx.period.granularity, ctx.varietyOf, top) },
      insights: pick(insights, ['products']),
    });
  }

  // buyers
  const b = ctx.buyers;
  const pb = ctx.prevBuyers;
  return meta(ctx, {
    kpis: [
      kpi('unique', 'Buyers', b.unique, pb?.unique, { format: 'number', note: 'With a completed order in the period' }),
      kpi('new', 'New buyers', b.newBuyers, pb?.newBuyers, { format: 'number', note: 'First completed order in this period' }),
      kpi('returning', 'Returning buyers', b.returningBuyers, pb?.returningBuyers, { format: 'number', note: 'Bought before this period, and again in it' }),
      kpi('repeat', 'Repeat purchase rate', b.repeatRate, pb?.repeatRate, { format: 'percent', note: '2+ completed orders in the period' }),
      kpi('frequency', 'Orders per buyer', b.frequency, pb?.frequency, { format: 'decimal' }),
      kpi('aov', 'Average order value', s.aov, p?.aov, { format: 'peso' }),
    ],
    // Names and order figures only: no phone numbers or addresses.
    buyers: b.buyers.slice(0, 500),
    totalBuyers: b.buyers.length,
    lapsed: b.lapsed,
    segments: {
      new: b.newBuyers, returning: b.returningBuyers, highValue: b.highValueBuyers, lapsed: b.lapsedBuyers,
    },
    inactiveDays: b.inactiveDays,
    series: buyerSeries(ctx.rows, ctx.history, ctx.period.start, ctx.period.end, ctx.period.granularity),
    insights: pick(insights, ['buyers']),
  });
}

async function inventorySection(scope, query) {
  if (scope.sellerId == null) throw badRequest('Inventory analytics are per seller.');
  const period = resolvePeriod(query);
  const inventory = await inventoryFor(scope.sellerId, period, query);
  return {
    period,
    filters: parseFilters(query),
    generatedAt: new Date(),
    ...inventory,
  };
}

/** The last 24 whole months plus the current one, whatever range is selected. */
async function seasons(scope, query) {
  const filters = parseFilters(query);
  const now = new Date();
  const end = addMonths(bucketStart(now, 'month'), 1);
  const start = addMonths(end, -25);
  const [rows, firstSale] = await Promise.all([
    data.completedBetween(scope, start, end, filters),
    data.firstSaleDate(scope, filters),
  ]);
  const varietyOf = await data.varietyLookup(rows);
  // Months before the first recorded sale are not "slow months"; they are
  // before there was any history, and are marked so.
  const monthly = timeSeries(rows, start, end, 'month', now)
    .map((m) => ({ ...m, beforeHistory: !firstSale || new Date(m.end) <= new Date(firstSale) }));
  const season = seasonality(monthly.filter((m) => !m.beforeHistory), firstSale, now);
  const top = varietyTable(rows, varietyOf).slice(0, 5).map((v) => v.variety);

  // This year's months beside the same months a year earlier.
  const last12 = monthly.slice(-12).map((m) => {
    const prev = monthly.find((x) => new Date(x.start).getTime() === addMonths(m.start, -12).getTime());
    return { ...m, previousYearSales: prev && new Date(prev.start) >= new Date(firstSale || now) ? prev.sales : null };
  });

  const insights = [];
  const seasonFinding = sellerInsights({ summary: summarize([]), period: { granularity: 'month', days: 0 }, season }).find((i) => i.id === 'season-peak');
  if (seasonFinding) insights.push(seasonFinding);

  return {
    filters,
    generatedAt: now,
    range: { start, end },
    monthly,
    yearOverYear: last12,
    varietySeries: { keys: top, points: seriesBy(rows, start, end, 'month', varietyOf, top) },
    season,
    firstSale,
    insights,
  };
}

// ---------------------------------------------------------------- platform

async function platformContext(query) {
  const ctx = await load({}, query);
  const { period, rows, prevRows, varietyOf } = ctx;
  const [accounts, counts, pending] = await Promise.all([data.sellerAccounts(), data.userCounts(), data.pendingApprovalCount()]);
  const names = new Map(accounts.map((a) => [a.userId, a]));
  const sellers = sellerTable(rows, prevRows, varietyOf).map((x) => ({
    ...x, name: names.get(x.sellerId)?.name || `Seller #${x.sellerId}`, status: names.get(x.sellerId)?.status || 'removed',
  }));
  const series = salesSeries(ctx);
  return {
    ...ctx,
    accounts,
    names,
    counts,
    pending,
    summary: summarize(rows),
    previous: period.comparison ? summarize(prevRows) : null,
    sellers,
    series,
    varieties: varietyTable(rows, varietyOf),
    extremes: extremes(series),
    moves: biggestMoves(series),
  };
}

export async function platformSection(section, query = {}) {
  if (!PLATFORM_SECTIONS.includes(section)) throw badRequest('Unknown analytics section.');
  if (section === 'seasons') return seasons({}, query);
  if (section === 'users') return usersSection(query);

  const ctx = await platformContext(query);
  const { summary: s, previous: p, period } = ctx;

  const [created, prevCreated] = await Promise.all([
    data.usersCreatedBetween(period.start, period.end),
    period.comparison ? data.usersCreatedBetween(period.comparison.start, period.comparison.end) : [],
  ]);
  const insights = platformInsights({
    ...ctx,
    activeSellers: ctx.counts.activeSellers,
    pendingApprovals: ctx.pending,
    newAccounts: { current: created.length, previous: period.comparison ? prevCreated.length : null },
  });

  if (section === 'overview') {
    const sellersWithSales = ctx.sellers.filter((x) => x.sales > 0).length;
    const prevSellersWithSales = period.comparison ? new Set(ctx.prevRows.filter(isSale).map((r) => r.sellerId)).size : undefined;
    return meta(ctx, {
      kpis: [
        kpi('sales', 'Completed sales', s.sales, p?.sales, { format: 'peso', note: 'Rice and delivery fees on completed orders' }),
        kpi('orderValue', 'Order value placed', s.orderValue, p?.orderValue, { format: 'peso', note: 'All orders placed, except cancelled' }),
        kpi('orders', 'Completed orders', s.completedOrders, p?.completedOrders, { format: 'number' }),
        kpi('aov', 'Average completed order', s.aov, p?.aov, { format: 'peso' }),
        kpi('sellersWithSales', 'Sellers with sales', sellersWithSales, prevSellersWithSales, { format: 'number', note: `of ${ctx.counts.activeSellers} active sellers` }),
        kpi('newAccounts', 'New accounts', created.length, period.comparison ? prevCreated.length : undefined, { format: 'number' }),
      ],
      status: statusBreakdown(ctx.rows),
      inProgress: s.inProgressOrders,
      cancelled: s.cancelledOrders,
      // All-time and current counts, labelled as such in the interface.
      allTime: { ...ctx.counts, pendingApprovals: ctx.pending },
      series: ctx.series,
      topSellers: ctx.sellers.slice(0, 5),
      varieties: ctx.varieties.slice(0, 5),
      insights: insights.slice(0, 8),
    });
  }

  if (section === 'sales') {
    const topSellers = ctx.sellers.slice(0, 5).map((x) => String(x.sellerId));
    const sellerKey = (r) => (topSellers.includes(String(r.sellerId)) ? String(r.sellerId) : 'others');
    const keys = [...topSellers, ...(ctx.sellers.length > 5 ? ['others'] : [])];
    const topVarieties = ctx.varieties.slice(0, 6).map((v) => v.variety);
    return meta(ctx, {
      kpis: [
        kpi('sales', 'Completed sales', s.sales, p?.sales, { format: 'peso' }),
        kpi('orders', 'Completed orders', s.completedOrders, p?.completedOrders, { format: 'number' }),
        kpi('aov', 'Average completed order', s.aov, p?.aov, { format: 'peso' }),
        kpi('placed', 'Orders placed', s.placedOrders, p?.placedOrders, { format: 'number' }),
        kpi('cancellation', 'Cancellation rate', s.cancellationRate, p?.cancellationRate, { format: 'percent', lowerIsBetter: true }),
      ],
      series: ctx.series,
      extremes: ctx.extremes,
      moves: ctx.moves,
      sellerSeries: {
        keys,
        labels: Object.fromEntries(keys.map((k) => [k, k === 'others' ? 'Other sellers' : ctx.names.get(Number(k))?.name || `Seller #${k}`])),
        points: seriesBy(ctx.rows, period.start, period.end, period.granularity, sellerKey, keys),
      },
      varietySeries: { keys: topVarieties, points: seriesBy(ctx.rows, period.start, period.end, period.granularity, ctx.varietyOf, topVarieties) },
      insights: pick(insights, ['growth', 'highlights', 'unusual', 'attention']),
    });
  }

  if (section === 'sellers') {
    const listed = new Set(ctx.sellers.map((x) => x.sellerId));
    const idle = ctx.accounts
      .filter((a) => !listed.has(a.userId) && a.status !== 'pending')
      .map((a) => ({
        sellerId: a.userId, name: a.name, status: a.status, sales: 0, share: 0, orders: 0, buyers: 0, aov: null, cancelled: 0, lastSale: null, growth: change(0, 0), topVariety: null,
      }));
    return meta(ctx, {
      sellers: [...ctx.sellers, ...idle],
      platformSales: s.sales,
      insights: pick(insights, ['attention', 'highlights']).filter((i) => i.id.startsWith('seller')),
    });
  }

  // products
  const products = await data.productsOf({});
  const offering = new Map();
  for (const prod of products.filter((x) => x.status !== 'inactive')) {
    if (!offering.has(prod.variety)) offering.set(prod.variety, new Set());
    offering.get(prod.variety).add(prod.createdBy);
  }
  const prevVar = new Map(varietyTable(ctx.prevRows, ctx.varietyOf).map((x) => [x.variety, x]));
  const focus = ctx.filters.variety || ctx.varieties[0]?.variety || null;
  const distribution = focus
    ? sellerTable(ctx.rows.filter((r) => ctx.varietyOf(r) === focus), [], ctx.varietyOf)
      .map((x) => ({ sellerId: x.sellerId, name: ctx.names.get(x.sellerId)?.name || `Seller #${x.sellerId}`, sales: x.sales, share: x.share }))
    : [];
  const top = ctx.varieties.slice(0, 6).map((v) => v.variety);
  return meta(ctx, {
    varieties: ctx.varieties.map((v) => ({
      ...v,
      sellersOffering: offering.get(v.variety)?.size || 0,
      previousSales: prevVar.get(v.variety)?.sales ?? 0,
      change: change(v.sales, prevVar.get(v.variety)?.sales ?? 0),
    })),
    products: productTable(ctx.rows, ctx.varietyOf).slice(0, 100).map((x) => {
      const owner = ctx.rows.find((r) => String(r.productId) === x.productId)?.sellerId;
      return { ...x, sellerName: ctx.names.get(owner)?.name || '' };
    }),
    varietySeries: { keys: top, points: seriesBy(ctx.rows, period.start, period.end, period.granularity, ctx.varietyOf, top) },
    distribution: { variety: focus, sellers: distribution },
    insights: pick(insights, ['products']),
  });
}

async function usersSection(query) {
  const period = resolvePeriod(query);
  const [created, approvals, counts, pending] = await Promise.all([
    data.usersCreatedBetween(period.start, period.end),
    data.approvalsBetween(period.start, period.end),
    data.userCounts(),
    data.pendingApprovalCount(),
  ]);
  const list = buckets(period.start, period.end, period.granularity);
  const points = list.map((b) => {
    const inB = (d) => new Date(d) >= b.start && new Date(d) < b.end;
    const mine = created.filter((u) => inB(u.createdAt));
    return {
      key: b.key,
      start: b.start,
      buyers: mine.filter((u) => u.role === 'buyer').length,
      sellers: mine.filter((u) => u.role === 'seller').length,
      riders: mine.filter((u) => u.role === 'rider').length,
      approvals: approvals.filter((a) => inB(a.approvedAt)).length,
    };
  });
  return {
    period,
    generatedAt: new Date(),
    series: points,
    totals: {
      newBuyers: created.filter((u) => u.role === 'buyer').length,
      newSellers: created.filter((u) => u.role === 'seller').length,
      newRiders: created.filter((u) => u.role === 'rider').length,
      approvals: approvals.length,
    },
    allTime: { ...counts, pendingApprovals: pending },
  };
}

/** A buyer's own record, for the Super Admin's account view. */
export async function buyerProfile(buyerUserId) {
  const user = await data.findUser(buyerUserId);
  if (!user || user.role !== 'buyer') throw Object.assign(new Error('Buyer not found.'), { status: 404 });
  const rows = await data.ordersOfBuyer(buyerUserId);
  const now = new Date();
  const end = addMonths(bucketStart(now, 'month'), 1);
  const start = addMonths(end, -12);
  const recentStart = addDays(now, -90);
  const recent = summarize(rows.filter((r) => new Date(r.orderDate) >= recentStart));
  const before = summarize(rows.filter((r) => new Date(r.orderDate) >= addDays(recentStart, -90) && new Date(r.orderDate) < recentStart));
  const completedDates = [...new Set(rows.filter(isSale).map((r) => `${r.groupId || r._id}`))]
    .map((k) => rows.find((r) => `${r.groupId || r._id}` === k).orderDate)
    .sort((a, b) => new Date(a) - new Date(b));
  const gaps = completedDates.slice(1).map((d, i) => (new Date(d) - new Date(completedDates[i])) / DAY);
  const all = summarize(rows);
  return {
    user,
    // Money a buyer spent: completed orders only, as with seller sales.
    spent: all.sales,
    completedOrders: all.completedOrders,
    aov: all.aov,
    status: statusBreakdown(rows),
    monthly: timeSeries(rows, start, end, 'month', now),
    last90: { spent: recent.sales, orders: recent.completedOrders },
    previous90: { spent: before.sales, orders: before.completedOrders },
    change: change(recent.sales, before.sales),
    avgDaysBetweenOrders: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null,
    lastOrder: rows.length ? rows[rows.length - 1].orderDate : null,
    sellers: new Set(rows.filter(isSale).map((r) => r.sellerId)).size,
  };
}

/** Options for the filter menus. */
export async function filterOptions(scope) {
  const [varieties, products] = await Promise.all([data.varietiesOf(scope), data.productsOf(scope)]);
  return {
    varieties,
    products: products.map((p) => ({ id: String(p._id), name: p.name, variety: p.variety })).sort((a, b) => a.name.localeCompare(b.name)),
    statuses: ORDER_STATUSES,
  };
}

export { sellerContext, platformContext };
