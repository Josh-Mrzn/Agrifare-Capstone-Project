import { buckets } from './period.js';

/**
 * Inventory analytics, from the stock movement log only.
 *
 * Every restock, sale, return and adjustment writes a StockMovement with the
 * signed change in kilograms and the stock level right after it. That log is
 * the only history there is: a product's stock before its first logged
 * movement (for example the amount typed in when it was listed) was never
 * recorded, so nothing here guesses at it.
 */

const DAY = 24 * 60 * 60 * 1000;
const num = (v) => Number(v) || 0;
const round = (v, p = 1) => Math.round(v * 10 ** p) / 10 ** p;

/** Days of sales needed before "days of stock left" is shown. */
export const MIN_VELOCITY_DAYS = 14;
/** The window the sales rate is measured over. */
export const VELOCITY_WINDOW_DAYS = 30;
/** Fewer days of cover than this raises a restock alert. */
export const COVER_ALERT_DAYS = 7;

const KIND = {
  RESTOCK: 'restocked',
  SALE: 'sold',
  RETURN: 'returned',
  ADJUSTMENT: 'adjusted',
  DAMAGE: 'adjusted',
};

/**
 * products:  current Product documents of the scope
 * movements: StockMovement rows from (velocity window start or period start,
 *            whichever is earlier) to the period end, plus `lastBefore`
 * lastBefore: Map productId -> the last movement before the period start
 * firstSeen:  Map productId -> the date of its first-ever movement
 */
export function inventoryAnalysis({ products, movements, lastBefore = new Map(), firstSeen = new Map(), start, end, granularity, now = new Date() }) {
  const inPeriod = movements.filter((m) => new Date(m.createdAt) >= start && new Date(m.createdAt) < end);
  const velocityStart = new Date(Math.min(end, now) - VELOCITY_WINDOW_DAYS * DAY);
  const endIsNow = end >= now;

  const rows = products.map((p) => {
    const id = String(p._id);
    const mine = inPeriod.filter((m) => String(m.productId) === id);
    const sum = (type) => mine.filter((m) => KIND[m.type] === type).reduce((s, m) => s + num(m.quantity), 0);

    const soldKg = -sum('sold');
    const restockedKg = sum('restocked');
    const returnedKg = sum('returned');
    const adjustedKg = sum('adjusted');

    // Stock at the start: the level left by the last movement before it.
    const before = lastBefore.get(id);
    const stockAtStart = before ? num(before.resultingStock) : null;

    // Stock at the end: today's figure when the period runs to now, else the
    // level after the last movement inside the period, else the start level.
    const lastIn = [...mine].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const stockAtEnd = endIsNow ? num(p.stock) : lastIn ? num(lastIn.resultingStock) : stockAtStart;

    // Sell-through: what share of the stock available was sold.
    const sellThrough = stockAtEnd != null && soldKg + stockAtEnd > 0
      ? round((soldKg / (soldKg + stockAtEnd)) * 100)
      : null;

    // Sales rate over the last 30 days, only once the product has at least
    // two weeks of logged history - otherwise one early sale would predict
    // the shelf empty in a day.
    const first = firstSeen.get(id);
    const historyDays = first ? (Math.min(end, now) - new Date(first)) / DAY : 0;
    const recentSold = -movements
      .filter((m) => String(m.productId) === id && m.type === 'SALE'
        && new Date(m.createdAt) >= velocityStart && new Date(m.createdAt) < Math.min(end, now))
      .reduce((s, m) => s + num(m.quantity), 0);
    const windowDays = Math.min(VELOCITY_WINDOW_DAYS, historyDays);
    const velocity = historyDays >= MIN_VELOCITY_DAYS && recentSold > 0 ? recentSold / windowDays : null;
    const daysCover = velocity && endIsNow ? round(num(p.stock) / velocity) : null;

    const stock = num(p.stock);
    const threshold = num(p.lowStockThreshold ?? 20);
    const status = stock <= 0 ? 'out' : stock <= threshold ? 'low' : 'ok';

    return {
      productId: id,
      name: p.name,
      variety: p.variety || 'Other',
      active: p.status !== 'inactive',
      stock,
      threshold,
      status,
      soldKg: round(soldKg),
      restockedKg: round(restockedKg),
      returnedKg: round(returnedKg),
      adjustedKg: round(adjustedKg),
      stockAtStart,
      stockAtEnd,
      sellThrough,
      kgPerDay: velocity ? round(velocity, 2) : null,
      daysCover,
      hasHistory: Boolean(first),
    };
  });

  const series = buckets(start, end, granularity).map((b) => {
    const point = { key: b.key, start: b.start, restocked: 0, sold: 0, returned: 0, adjusted: 0 };
    for (const m of inPeriod) {
      const t = new Date(m.createdAt);
      if (t < b.start || t >= b.end) continue;
      const kind = KIND[m.type];
      if (!kind) continue;
      // Sold is shown as a positive amount leaving the shelf.
      point[kind] = round(point[kind] + (kind === 'sold' ? -num(m.quantity) : num(m.quantity)));
    }
    return point;
  });

  const active = rows.filter((r) => r.active);
  const moving = [...active].filter((r) => r.soldKg > 0).sort((a, b) => b.soldKg - a.soldKg);
  const slow = active.filter((r) => r.stock > 0)
    .sort((a, b) => a.soldKg - b.soldKg || b.stock - a.stock)
    .slice(0, 5)
    .filter((r) => !moving.slice(0, 5).includes(r));

  const alerts = [];
  for (const r of active) {
    if (r.status === 'out') {
      alerts.push({ productId: r.productId, level: 'danger', text: `${r.name} is out of stock and cannot be bought.` });
    } else if (r.status === 'low') {
      alerts.push({ productId: r.productId, level: 'warning', text: `${r.name} has ${r.stock} kg left, at or below its warning level of ${r.threshold} kg.` });
    } else if (r.daysCover != null && r.daysCover < COVER_ALERT_DAYS) {
      alerts.push({
        productId: r.productId,
        level: 'warning',
        text: `${r.name} sells about ${r.kgPerDay} kg a day over the last ${VELOCITY_WINDOW_DAYS} days; the ${r.stock} kg left lasts roughly ${r.daysCover} days.`,
      });
    }
  }

  const limitations = [];
  const noHistory = rows.filter((r) => !r.hasHistory).length;
  if (noHistory) {
    limitations.push(`${noHistory} product${noHistory > 1 ? 's have' : ' has'} no logged stock movements yet, so only current stock is shown for ${noHistory > 1 ? 'them' : 'it'}.`);
  }
  limitations.push('Stock entered when a product is first listed is not logged as a movement, so stock before the first logged restock or sale is unknown.');

  return {
    products: rows.sort((a, b) => b.soldKg - a.soldKg || a.name.localeCompare(b.name)),
    totals: {
      stockKg: round(active.reduce((s, r) => s + r.stock, 0)),
      soldKg: round(rows.reduce((s, r) => s + r.soldKg, 0)),
      restockedKg: round(rows.reduce((s, r) => s + r.restockedKg, 0)),
      returnedKg: round(rows.reduce((s, r) => s + r.returnedKg, 0)),
      adjustedKg: round(rows.reduce((s, r) => s + r.adjustedKg, 0)),
      low: active.filter((r) => r.status === 'low').length,
      out: active.filter((r) => r.status === 'out').length,
      activeProducts: active.length,
    },
    series,
    fastMovers: moving.slice(0, 5),
    slowMovers: slow,
    alerts,
    limitations,
  };
}

/** Recorded stock level after each movement of one product, oldest first. */
export function stockLevels(movements) {
  return [...movements]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((m) => ({ at: m.createdAt, stock: num(m.resultingStock), type: m.type, change: num(m.quantity) }));
}
