import { buckets } from './period.js';

/**
 * The metric definitions, in code. ANALYTICS.md at the repository root says
 * the same thing in words; keep the two in step.
 *
 * Input is order rows as stored: one row per product line, per seller. Every
 * function here is pure - no database, no clock - so each definition can be
 * tested on its own (test/analytics.metrics.test.js).
 */

/** Sales are completed orders only. Delivered-but-unconfirmed is not yet a sale. */
export const SALES_STATUS = 'completed';
export const IN_PROGRESS_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
export const STATUS_GROUPS = {
  completed: ['completed'],
  inProgress: IN_PROGRESS_STATUSES,
  cancelled: ['cancelled'],
};

/** Buyers who have not bought for this many days count as "lapsed". */
export const INACTIVE_DAYS = 60;
/** Below this many orders in a period, a comparison is flagged as a small sample. */
export const MIN_SAMPLE = 5;

const DAY = 24 * 60 * 60 * 1000;
const num = (v) => Number(v) || 0;
const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places;

/**
 * One checkout is one order per seller. A cart with two sacks from the same
 * shop is stored as two rows sharing a groupId, and counting rows would call
 * it two orders and halve its average value.
 */
export const orderKey = (row) => `${row.sellerId}:${row.groupId || row._id}`;

/** A buyer account, or - for sales the seller typed in - the name on the order. */
export const buyerKey = (row) => (row.buyerUserId != null
  ? `u:${row.buyerUserId}`
  : `n:${String(row.customerName || '').trim().toLowerCase()}`);

export const kilograms = (row) => num(row.quantity) * (num(row.weightKg) || 1);
export const packLabel = (weightKg) => `${num(weightKg) || 1} kg`;

export const isSale = (row) => row.status === SALES_STATUS;

/** Where a status sits: completed, inProgress or cancelled. */
export function statusGroup(status) {
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  return 'inProgress';
}

/** Distinct order keys among rows matching a predicate. */
const countOrders = (rows, pred = () => true) => new Set(rows.filter(pred).map(orderKey)).size;

/**
 * The headline numbers for a set of rows placed in one period.
 *
 * sales            sum of `total` on completed rows (rice + delivery fee)
 * riceSales        the same without the delivery fee
 * completedOrders  distinct orders with a completed line
 * aov              sales / completedOrders, null when there are none
 * completionRate   completed / (completed + cancelled) orders, null when neither
 * cancellationRate cancelled / all orders placed, null when none were placed
 * refunded         money recorded as returned to buyers on orders placed in
 *                  the period (cancelled after payment)
 * refundDue        money received on cancelled orders and not yet returned
 */
export function summarize(rows) {
  const sales = rows.filter(isSale);
  const salesValue = sales.reduce((s, r) => s + num(r.total), 0);
  const deliveryFees = sales.reduce((s, r) => s + num(r.deliveryFee), 0);
  const completedOrders = countOrders(sales);
  const cancelledOrders = countOrders(rows, (r) => r.status === 'cancelled');
  const inProgressOrders = countOrders(rows, (r) => IN_PROGRESS_STATUSES.includes(r.status));
  const placedOrders = countOrders(rows);

  const sacks = {};
  for (const r of sales) {
    const label = packLabel(r.weightKg);
    sacks[label] = (sacks[label] || 0) + num(r.quantity);
  }

  const closed = completedOrders + cancelledOrders;
  return {
    sales: round(salesValue),
    riceSales: round(salesValue - deliveryFees),
    deliveryFees: round(deliveryFees),
    completedOrders,
    inProgressOrders,
    cancelledOrders,
    placedOrders,
    // Value of everything ordered and not cancelled, whatever its stage.
    orderValue: round(rows.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + num(r.total), 0)),
    aov: completedOrders ? round(salesValue / completedOrders) : null,
    kg: round(sales.reduce((s, r) => s + kilograms(r), 0)),
    sacks,
    buyers: new Set(sales.map(buyerKey)).size,
    completionRate: closed ? round((completedOrders / closed) * 100, 1) : null,
    cancellationRate: placedOrders ? round((cancelledOrders / placedOrders) * 100, 1) : null,
    refunded: round(rows.filter((r) => r.paymentStatus === 'refunded').reduce((s, r) => s + num(r.refund?.amount), 0)),
    refundDue: round(rows.filter((r) => r.paymentStatus === 'refund_due').reduce((s, r) => s + num(r.amountPaid), 0)),
    refundOrders: countOrders(rows, (r) => ['refund_due', 'refunded'].includes(r.paymentStatus)),
  };
}

/**
 * The change from `previous` to `current`.
 *
 * A percentage only exists when the baseline is above zero; otherwise `pct`
 * is null and `reason` says why, so the interface never prints "+Infinity%"
 * or a growth figure measured against nothing.
 */
export function change(current, previous) {
  const cur = current == null ? null : num(current);
  const prev = previous == null ? null : num(previous);
  if (cur == null || prev == null) return { abs: null, pct: null, reason: 'no-data' };
  const abs = round(cur - prev);
  if (prev === 0) {
    return { abs, pct: null, reason: cur === 0 ? 'both-zero' : 'no-baseline' };
  }
  return { abs, pct: round(((cur - prev) / prev) * 100, 1), reason: null };
}

/** Rows grouped into the period's buckets by orderDate. */
export function bucketRows(rows, start, end, granularity) {
  const list = buckets(start, end, granularity);
  const groups = list.map(() => []);
  let i = 0;
  const sorted = [...rows].sort((a, b) => new Date(a.orderDate) - new Date(b.orderDate));
  for (const row of sorted) {
    const t = new Date(row.orderDate);
    if (t < start || t >= end) continue;
    while (i < list.length && t >= list[i].end) i += 1;
    if (i < list.length) groups[i].push(row);
  }
  return list.map((b, idx) => ({ ...b, rows: groups[idx] }));
}

/** Per-bucket sales, orders, average value and status counts. */
export function timeSeries(rows, start, end, granularity, now = new Date()) {
  return bucketRows(rows, start, end, granularity).map((b) => {
    const s = summarize(b.rows);
    return {
      key: b.key,
      start: b.start,
      end: b.end,
      // The bucket still running: its numbers will grow, so it is not
      // compared as if it were finished.
      partial: b.end > now,
      sales: s.sales,
      orders: s.completedOrders,
      placed: s.placedOrders,
      aov: s.aov,
      kg: s.kg,
      completed: s.completedOrders,
      inProgress: s.inProgressOrders,
      cancelled: s.cancelledOrders,
    };
  });
}

/** Lines the comparison series up with the current one, bucket by bucket. */
export function alignComparison(current, previous) {
  return current.map((b, i) => ({
    ...b,
    previousSales: previous[i]?.sales ?? null,
    previousOrders: previous[i]?.orders ?? null,
    previousStart: previous[i]?.start ?? null,
  }));
}

/** The best and worst finished buckets with sales data, or null with too few. */
export function extremes(series, field = 'sales') {
  const done = series.filter((b) => !b.partial);
  if (done.length < 2) return null;
  const withData = done.filter((b) => num(b[field]) > 0);
  if (!withData.length) return null;
  const best = done.reduce((a, b) => (num(b[field]) > num(a[field]) ? b : a));
  const worst = done.reduce((a, b) => (num(b[field]) < num(a[field]) ? b : a));
  return { best, worst };
}

/** The largest bucket-to-bucket rise and fall among finished buckets. */
export function biggestMoves(series, field = 'sales') {
  const done = series.filter((b) => !b.partial);
  let rise = null;
  let fall = null;
  for (let i = 1; i < done.length; i += 1) {
    const delta = num(done[i][field]) - num(done[i - 1][field]);
    if (delta > 0 && (!rise || delta > rise.delta)) rise = { from: done[i - 1], to: done[i], delta: round(delta) };
    if (delta < 0 && (!fall || delta < fall.delta)) fall = { from: done[i - 1], to: done[i], delta: round(delta) };
  }
  return { rise, fall };
}

/**
 * Time from placing an order to its completion, in days, for completed rows
 * that recorded the moment they were completed. Rows completed before the
 * status history existed are left out, not guessed.
 */
export function completionTimes(rows) {
  const seen = new Set();
  const days = [];
  for (const r of rows.filter(isSale)) {
    const key = orderKey(r);
    if (seen.has(key)) continue;
    const doneAt = (r.statusHistory || []).find((h) => h.status === 'completed')?.changedAt;
    if (!doneAt) continue;
    seen.add(key);
    const d = (new Date(doneAt) - new Date(r.orderDate)) / DAY;
    if (d >= 0) days.push(d);
  }
  if (!days.length) return { count: 0, avgDays: null, medianDays: null };
  const sorted = [...days].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    count: days.length,
    avgDays: round(days.reduce((s, d) => s + d, 0) / days.length, 1),
    medianDays: round(median, 1),
  };
}

/** Completed sales by product and pack size, with share and price per kg. */
export function productTable(rows, varietyOf = () => 'Other') {
  const sales = rows.filter(isSale);
  const total = sales.reduce((s, r) => s + num(r.total), 0);
  const map = new Map();
  for (const r of sales) {
    const pid = String(r.productId);
    const key = `${pid}:${num(r.weightKg) || 1}`;
    const entry = map.get(key) || {
      key,
      productId: pid,
      // The name as it was sold, which already carries the pack size.
      name: r.productName,
      variety: varietyOf(r),
      pack: packLabel(r.weightKg),
      sales: 0,
      riceSales: 0,
      sacks: 0,
      kg: 0,
      orders: new Set(),
    };
    entry.sales += num(r.total);
    entry.riceSales += num(r.subtotal);
    entry.sacks += num(r.quantity);
    entry.kg += kilograms(r);
    entry.orders.add(orderKey(r));
    map.set(key, entry);
  }
  return [...map.values()]
    .map((e) => ({
      ...e,
      sales: round(e.sales),
      riceSales: round(e.riceSales),
      kg: round(e.kg),
      orders: e.orders.size,
      // From the prices actually charged, not today's list price.
      pricePerKg: e.kg ? round(e.riceSales / e.kg) : null,
      share: total ? round((e.sales / total) * 100, 1) : 0,
    }))
    .sort((a, b) => b.sales - a.sales);
}

/** Completed sales by rice variety. */
export function varietyTable(rows, varietyOf = () => 'Other') {
  const sales = rows.filter(isSale);
  const total = sales.reduce((s, r) => s + num(r.total), 0);
  const map = new Map();
  for (const r of sales) {
    const variety = varietyOf(r);
    const e = map.get(variety) || { variety, sales: 0, riceSales: 0, kg: 0, orders: new Set(), sellers: new Set() };
    e.sales += num(r.total);
    e.riceSales += num(r.subtotal);
    e.kg += kilograms(r);
    e.orders.add(orderKey(r));
    e.sellers.add(r.sellerId);
    map.set(variety, e);
  }
  return [...map.values()]
    .map((e) => ({
      variety: e.variety,
      sales: round(e.sales),
      kg: round(e.kg),
      orders: e.orders.size,
      sellersWithSales: e.sellers.size,
      pricePerKg: e.kg ? round(e.riceSales / e.kg) : null,
      share: total ? round((e.sales / total) * 100, 1) : 0,
    }))
    .sort((a, b) => b.sales - a.sales);
}

/** Sales per bucket for each of the given keys (varieties, sellers...). */
export function seriesBy(rows, start, end, granularity, keyOf, keys) {
  return bucketRows(rows.filter(isSale), start, end, granularity).map((b) => {
    const point = { key: b.key, start: b.start };
    for (const k of keys) point[k] = 0;
    for (const r of b.rows) {
      const k = keyOf(r);
      if (k in point) point[k] = round(point[k] + num(r.total));
    }
    return point;
  });
}

/**
 * Buyers in the period, each classified.
 *
 * history: Map buyerKey -> { first, last } completed-purchase dates across
 * all of this seller's (or the platform's) records up to the period end.
 *
 *   new        first completed purchase falls inside the period
 *   returning  bought before the period, and again inside it
 *   highValue  in the top fifth by spend this period (needs >= 5 buyers)
 *
 * And, from history alone:
 *   lapsed     bought before, but nothing in the INACTIVE_DAYS before the end
 */
export function buyerAnalysis(rows, history, { start, end, inactiveDays = INACTIVE_DAYS } = {}) {
  const sales = rows.filter(isSale);
  const map = new Map();
  for (const r of sales) {
    const key = buyerKey(r);
    const e = map.get(key) || { key, name: r.customerName, buyerUserId: r.buyerUserId ?? null, spent: 0, orders: new Set(), last: null };
    e.spent += num(r.total);
    e.orders.add(orderKey(r));
    const t = new Date(r.orderDate);
    if (!e.last || t > e.last) e.last = t;
    map.set(key, e);
  }

  const list = [...map.values()].map((e) => {
    const h = history.get(e.key);
    const first = h?.first ? new Date(h.first) : null;
    const isNew = !first || first >= start;
    return {
      key: e.key,
      name: e.name,
      buyerUserId: e.buyerUserId,
      orders: e.orders.size,
      spent: round(e.spent),
      aov: round(e.spent / e.orders.size),
      lastOrder: e.last,
      firstOrder: first,
      daysSinceLast: Math.floor((end - e.last) / DAY),
      segment: isNew ? 'new' : 'returning',
      highValue: false,
    };
  }).sort((a, b) => b.spent - a.spent);

  if (list.length >= 5) {
    const cut = Math.max(1, Math.floor(list.length / 5));
    list.slice(0, cut).forEach((b) => { b.highValue = true; });
  }

  const cutoff = new Date(end.getTime() - inactiveDays * DAY);
  const lapsed = [...history.entries()]
    .filter(([, h]) => h.last && new Date(h.last) < cutoff && new Date(h.first) < start)
    .map(([key, h]) => ({ key, name: h.name || '', lastOrder: new Date(h.last), lifetimeSpent: round(num(h.spent)) }))
    .sort((a, b) => b.lifetimeSpent - a.lifetimeSpent);

  const buyers = list.length;
  const repeaters = list.filter((b) => b.orders >= 2).length;
  return {
    buyers: list,
    unique: buyers,
    newBuyers: list.filter((b) => b.segment === 'new').length,
    returningBuyers: list.filter((b) => b.segment === 'returning').length,
    highValueBuyers: list.filter((b) => b.highValue).length,
    lapsedBuyers: lapsed.length,
    lapsed: lapsed.slice(0, 50),
    // Buyers with two or more completed orders in the period, of all buyers in it.
    repeatRate: buyers ? round((repeaters / buyers) * 100, 1) : null,
    // Average completed orders per buyer in the period.
    frequency: buyers ? round(list.reduce((s, b) => s + b.orders, 0) / buyers, 2) : null,
    inactiveDays,
  };
}

/** Distinct new and returning buyers per bucket. */
export function buyerSeries(rows, history, start, end, granularity) {
  return bucketRows(rows.filter(isSale), start, end, granularity).map((b) => {
    const seen = new Map();
    for (const r of b.rows) {
      const key = buyerKey(r);
      if (seen.has(key)) continue;
      const first = history.get(key)?.first;
      seen.set(key, first && new Date(first) < b.start ? 'returning' : 'new');
    }
    const values = [...seen.values()];
    return {
      key: b.key,
      start: b.start,
      newBuyers: values.filter((v) => v === 'new').length,
      returningBuyers: values.filter((v) => v === 'returning').length,
    };
  });
}

/**
 * Monthly totals across a long history, for seasonal reading.
 * `months` should cover whole months; `firstSale` is the earliest completed
 * sale on record, which says how much history there really is.
 */
export function seasonality(monthly, firstSale, end) {
  const months = firstSale
    ? Math.max(0, Math.round((end - new Date(firstSale)) / (30.44 * DAY)))
    : 0;
  const withSales = monthly.filter((m) => !m.partial && m.sales > 0);
  const done = monthly.filter((m) => !m.partial);
  const strongest = withSales.length ? withSales.reduce((a, b) => (b.sales > a.sales ? b : a)) : null;
  const weakest = done.length >= 2 ? done.reduce((a, b) => (b.sales < a.sales ? b : a)) : null;
  return {
    monthsOfHistory: months,
    // Twelve months shows one cycle; two cycles are needed before a pattern
    // can be called seasonal rather than a one-off.
    coverage: months >= 24 ? 'two-years' : months >= 12 ? 'one-year' : 'short',
    strongest,
    weakest,
  };
}

/** Status counts by group and by status, counted as orders. */
export function statusBreakdown(rows) {
  const byStatus = {};
  for (const r of rows) {
    (byStatus[r.status] ||= new Set()).add(orderKey(r));
  }
  const counts = Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, v.size]));
  return {
    byStatus: counts,
    completed: counts.completed || 0,
    inProgress: IN_PROGRESS_STATUSES.reduce((s, k) => s + (counts[k] || 0), 0),
    cancelled: counts.cancelled || 0,
  };
}

/** Per-seller totals for the platform table. */
export function sellerTable(rows, previousRows, varietyOf = () => 'Other') {
  const bySeller = (list) => {
    const m = new Map();
    for (const r of list) {
      if (!m.has(r.sellerId)) m.set(r.sellerId, []);
      m.get(r.sellerId).push(r);
    }
    return m;
  };
  const cur = bySeller(rows);
  const prev = bySeller(previousRows);
  const platformSales = rows.filter(isSale).reduce((s, r) => s + num(r.total), 0);

  return [...cur.entries()].map(([sellerId, list]) => {
    const s = summarize(list);
    const p = summarize(prev.get(sellerId) || []);
    const varieties = varietyTable(list, varietyOf);
    const lastSale = list.filter(isSale).reduce((a, r) => (!a || new Date(r.orderDate) > a ? new Date(r.orderDate) : a), null);
    return {
      sellerId,
      sales: s.sales,
      share: platformSales ? round((s.sales / platformSales) * 100, 1) : 0,
      orders: s.completedOrders,
      buyers: s.buyers,
      aov: s.aov,
      cancelled: s.cancelledOrders,
      lastSale,
      growth: change(s.sales, p.sales),
      topVariety: varieties[0] ? { variety: varieties[0].variety, share: varieties[0].share } : null,
    };
  }).sort((a, b) => b.sales - a.sales);
}
