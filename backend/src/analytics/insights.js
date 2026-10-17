import { MIN_SAMPLE, change } from './metrics.js';
import { local } from './period.js';

/**
 * Plain-language findings, computed from the same numbers the charts show.
 *
 * Every sentence states its figures and the period it compares with, so a
 * reader can check it against the chart above it. The rules only describe
 * what changed; none of them says why. Nothing here is a forecast.
 */

const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
export const peso = (n) => pesoFmt.format(Number(n) || 0);
const pct = (n) => `${Math.abs(Number(n)).toLocaleString('en-PH', { maximumFractionDigits: 1 })}%`;
const plural = (n, word, many = `${word}s`) => `${n.toLocaleString('en-PH')} ${n === 1 ? word : many}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function shortDate(date) {
  const l = local(date);
  return `${MONTHS[l.month]} ${l.day}, ${l.year}`;
}

/** "the week of Oct 6, 2026", "October 2026", "Oct 6, 2026". */
export function bucketName(bucket, granularity) {
  const l = local(bucket.start);
  switch (granularity) {
    case 'week': return `the week of ${shortDate(bucket.start)}`;
    case 'month': return `${FULL_MONTHS[l.month]} ${l.year}`;
    case 'quarter': return `Q${Math.floor(l.month / 3) + 1} ${l.year}`;
    default: return shortDate(bucket.start);
  }
}

/** "the previous 30 days (Sep 1 – Sep 30, 2026)" or "the same period last year (...)". */
export function comparisonName(period) {
  const c = period.comparison;
  if (!c) return null;
  const span = `${shortDate(c.start)} – ${shortDate(new Date(c.end.getTime() - 1))}`;
  return c.kind === 'yoy'
    ? `the same period last year (${span})`
    : `the previous ${plural(period.days, 'day')} (${span})`;
}

const sampleNote = (cur, prev) => (cur < MIN_SAMPLE || prev < MIN_SAMPLE
  ? ` This compares ${plural(cur, 'order')} with ${plural(prev, 'order')}, so a few orders either way move the percentage a lot.`
  : '');

function salesInsight(cur, prev, period, subject = 'Completed sales') {
  const vs = comparisonName(period);
  if (!cur.completedOrders && !(prev?.completedOrders)) {
    return {
      id: 'sales-none',
      category: 'attention',
      tone: 'neutral',
      title: 'No completed sales in this period',
      detail: vs
        ? `Neither this period nor ${vs} has a completed order. Sales appear here once orders are marked completed.`
        : 'Sales appear here once orders are marked completed.',
      link: { tab: 'sales' },
    };
  }
  if (!vs || !prev) {
    return {
      id: 'sales-total', category: 'highlights', tone: 'neutral',
      title: `${peso(cur.sales)} in completed sales`,
      detail: `From ${plural(cur.completedOrders, 'completed order')}. Turn on a comparison to see how this period measures up.`,
      link: { tab: 'sales' },
    };
  }
  const c = change(cur.sales, prev.sales);
  if (c.pct == null) {
    return {
      id: 'sales-no-baseline', category: 'growth', tone: 'neutral',
      title: `${peso(cur.sales)} in completed sales`,
      detail: `${vs[0].toUpperCase()}${vs.slice(1)} had no completed sales, so there is no growth rate to show.`,
      link: { tab: 'sales' },
    };
  }
  const up = c.abs > 0;
  const flat = Math.abs(c.pct) < 1;
  return {
    id: 'sales-change',
    category: 'growth',
    tone: flat ? 'neutral' : up ? 'good' : 'bad',
    title: flat
      ? `${subject} held steady at ${peso(cur.sales)}`
      : `${subject} ${up ? 'rose' : 'fell'} ${pct(c.pct)} to ${peso(cur.sales)}`,
    detail: `Compared with ${peso(prev.sales)} in ${vs}, a change of ${c.abs >= 0 ? '+' : '−'}${peso(Math.abs(c.abs))}.${sampleNote(cur.completedOrders, prev.completedOrders)}`,
    figures: { current: cur.sales, previous: prev.sales, pct: c.pct },
    link: { tab: 'sales' },
  };
}

/** Separates "more orders" from "bigger orders". */
function volumeValueInsight(cur, prev, period) {
  if (!prev || !cur.completedOrders || !prev.completedOrders) return null;
  const vs = comparisonName(period);
  const o = change(cur.completedOrders, prev.completedOrders);
  const a = change(cur.aov, prev.aov);
  if (o.pct == null || a.pct == null) return null;
  const dir = (x) => (Math.abs(x) < 1 ? 'held steady' : x > 0 ? 'rose' : 'fell');
  const opposite = Math.sign(o.pct) !== Math.sign(a.pct) && Math.abs(o.pct) >= 1 && Math.abs(a.pct) >= 1;
  return {
    id: 'volume-value',
    category: 'growth',
    tone: opposite ? 'warning' : 'neutral',
    title: opposite
      ? `Order count ${dir(o.pct)} but average order value ${dir(a.pct)}`
      : `Orders ${dir(o.pct)} ${pct(o.pct)}; average order value ${dir(a.pct)} ${pct(a.pct)}`,
    detail: `${plural(cur.completedOrders, 'completed order')} averaging ${peso(cur.aov)}, against ${plural(prev.completedOrders, 'order')} averaging ${peso(prev.aov)} in ${vs}.${sampleNote(cur.completedOrders, prev.completedOrders)}`,
    link: { tab: 'sales' },
  };
}

function varietyShareInsight(varieties) {
  if (!varieties.length) return null;
  const top = varieties[0];
  if (varieties.length === 1) {
    return {
      id: 'variety-only', category: 'products', tone: 'neutral',
      title: `All completed sales were ${top.variety}`,
      detail: `${peso(top.sales)} across ${plural(top.orders, 'order')}.`,
      link: { tab: 'products', variety: top.variety },
    };
  }
  return {
    id: 'variety-share', category: 'products', tone: 'neutral',
    title: `${top.variety} made up ${pct(top.share)} of completed sales`,
    detail: `${peso(top.sales)} from ${plural(top.orders, 'order')}. Next was ${varieties[1].variety} at ${pct(varieties[1].share)} (${peso(varieties[1].sales)}).`,
    link: { tab: 'products', variety: top.variety },
  };
}

function productMoveInsights(products, previousProducts, period) {
  const vs = comparisonName(period);
  if (!vs) return [];
  const prevBy = new Map(previousProducts.map((p) => [p.key, p]));
  const moves = products.map((p) => ({ p, prev: prevBy.get(p.key)?.sales || 0 }))
    .concat(previousProducts.filter((p) => !products.some((c) => c.key === p.key)).map((p) => ({ p: { ...p, sales: 0 }, prev: p.sales })))
    .map((m) => ({ ...m, delta: m.p.sales - m.prev }));
  const out = [];
  const up = moves.filter((m) => m.delta > 0 && m.prev > 0).sort((a, b) => b.delta - a.delta)[0];
  const down = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  if (up) {
    out.push({
      id: 'product-up', category: 'products', tone: 'good',
      title: `${up.p.name} grew the most`,
      detail: `${peso(up.prev)} → ${peso(up.p.sales)} in completed sales, compared with ${vs}.`,
      link: { tab: 'products' },
    });
  }
  if (down) {
    out.push({
      id: 'product-down', category: 'products', tone: 'bad',
      title: `${down.p.name} fell the most`,
      detail: `${peso(down.prev)} → ${peso(down.p.sales)} in completed sales, compared with ${vs}.`,
      link: { tab: 'products' },
    });
  }
  return out;
}

function peakInsight(ext, moves, granularity) {
  const out = [];
  if (ext && ext.best.sales > 0) {
    out.push({
      id: 'peak', category: 'highlights', tone: 'neutral',
      title: `Strongest: ${bucketName(ext.best, granularity)}`,
      detail: `${peso(ext.best.sales)} from ${plural(ext.best.orders, 'completed order')}. The weakest finished ${granularity} was ${bucketName(ext.worst, granularity)} at ${peso(ext.worst.sales)}.`,
      link: { tab: 'sales' },
    });
  }
  if (moves?.fall && moves.fall.delta < 0) {
    out.push({
      id: 'biggest-fall', category: 'unusual', tone: 'warning',
      title: `Largest drop: into ${bucketName(moves.fall.to, granularity)}`,
      detail: `Sales went from ${peso(moves.fall.from.sales)} in ${bucketName(moves.fall.from, granularity)} to ${peso(moves.fall.to.sales)}.`,
      link: { tab: 'sales' },
    });
  }
  return out;
}

function cancellationInsight(cur, prev, period) {
  if (!cur.cancelledOrders) return null;
  const vs = comparisonName(period);
  const before = prev && prev.cancellationRate != null && vs
    ? `, against ${pct(prev.cancellationRate)} in ${vs}`
    : '';
  return {
    id: 'cancellations', category: 'attention', tone: cur.cancellationRate >= 10 ? 'bad' : 'neutral',
    title: `${plural(cur.cancelledOrders, 'order')} cancelled (${pct(cur.cancellationRate)})`,
    detail: `${cur.cancelledOrders} of ${plural(cur.placedOrders, 'order')} placed in this period were cancelled${before}.`,
    link: { tab: 'sales' },
  };
}

function buyerInsights(b) {
  const out = [];
  if (!b || !b.unique) return out;
  out.push({
    id: 'buyers-mix', category: 'buyers', tone: 'neutral',
    title: `${plural(b.unique, 'buyer')}: ${b.newBuyers} new, ${b.returningBuyers} returning`,
    detail: b.repeatRate != null
      ? `${pct(b.repeatRate)} placed two or more completed orders in this period. A returning buyer had a completed order before the period started.`
      : 'A returning buyer had a completed order before the period started.',
    link: { tab: 'buyers' },
  });
  if (b.lapsedBuyers) {
    out.push({
      id: 'buyers-lapsed', category: 'attention', tone: 'warning',
      title: `${plural(b.lapsedBuyers, 'past buyer')} not seen for ${b.inactiveDays}+ days`,
      detail: `They have completed orders on record but none in the ${b.inactiveDays} days up to the end of this period.`,
      link: { tab: 'buyers', segment: 'lapsed' },
    });
  }
  return out;
}

function completionInsight(cur, prev, period) {
  if (!cur.count || cur.avgDays == null) return null;
  const vs = comparisonName(period);
  const tail = prev?.avgDays != null && vs ? ` In ${vs} it was ${prev.avgDays} days.` : '';
  return {
    id: 'completion-time', category: 'highlights', tone: 'neutral',
    title: `Orders took ${cur.avgDays} days on average to complete`,
    detail: `Measured from order to completion across ${plural(cur.count, 'completed order')} (median ${cur.medianDays} days).${tail}`,
    link: { tab: 'sales' },
  };
}

function inventoryInsights(inv) {
  if (!inv) return [];
  const out = [];
  const { low, out: empty } = inv.totals;
  if (low || empty) {
    out.push({
      id: 'stock-warnings', category: 'inventory', tone: empty ? 'bad' : 'warning',
      title: [empty && `${plural(empty, 'product')} sold out`, low && `${plural(low, 'product')} running low`].filter(Boolean).join(', '),
      detail: 'Low means at or below the warning level set on the product. Sold-out products cannot be bought until restocked.',
      link: { tab: 'inventory' },
    });
  }
  const cover = inv.alerts.filter((a) => a.text.includes('lasts roughly'));
  for (const a of cover.slice(0, 2)) {
    out.push({ id: `cover-${a.productId}`, category: 'inventory', tone: 'warning', title: 'Running out soon', detail: a.text, link: { tab: 'inventory' } });
  }
  return out;
}

function seasonInsight(season) {
  if (!season?.strongest) return null;
  const name = bucketName(season.strongest, 'month');
  const caveat = season.coverage === 'short'
    ? ` There are only ${plural(season.monthsOfHistory, 'month')} of sales history, which is too short to call this a seasonal pattern.`
    : season.coverage === 'one-year'
      ? ' One year of history shows one cycle; it takes more than one to tell a pattern from a one-off.'
      : '';
  return {
    id: 'season-peak', category: 'highlights', tone: 'neutral',
    title: `${name} was the strongest month on record`,
    detail: `${peso(season.strongest.sales)} in completed sales. This describes the past and is not a forecast.${caveat}`,
    link: { tab: 'seasons' },
  };
}

/** Seller findings, most useful first. */
export function sellerInsights(ctx) {
  const list = [
    salesInsight(ctx.summary, ctx.previous, ctx.period),
    volumeValueInsight(ctx.summary, ctx.previous, ctx.period),
    ...inventoryInsights(ctx.inventory),
    varietyShareInsight(ctx.varieties || []),
    ...productMoveInsights(ctx.products || [], ctx.previousProducts || [], ctx.period),
    ...buyerInsights(ctx.buyers),
    cancellationInsight(ctx.summary, ctx.previous, ctx.period),
    completionInsight(ctx.completion || {}, ctx.previousCompletion, ctx.period),
    ...peakInsight(ctx.extremes, ctx.moves, ctx.period.granularity),
    seasonInsight(ctx.season),
  ];
  return dedupe(list);
}

/** Marketplace findings for the Super Admin. */
export function platformInsights(ctx) {
  const list = [salesInsight(ctx.summary, ctx.previous, ctx.period, 'Marketplace sales')];
  list.push(volumeValueInsight(ctx.summary, ctx.previous, ctx.period));

  const sellers = ctx.sellers || [];
  if (sellers.length >= 2 && sellers[0].share >= 50) {
    list.push({
      id: 'seller-concentration', category: 'attention', tone: 'warning',
      title: `One seller made ${pct(sellers[0].share)} of sales`,
      detail: `${sellers[0].name} accounted for ${peso(sellers[0].sales)} of ${peso(ctx.summary.sales)}. Marketplace sales depend heavily on one shop.`,
      link: { tab: 'sellers' },
    });
  }
  if (ctx.activeSellers != null) {
    const selling = sellers.filter((s) => s.sales > 0).length;
    list.push({
      id: 'sellers-selling', category: 'highlights', tone: 'neutral',
      title: `${selling} of ${plural(ctx.activeSellers, 'active seller')} recorded a completed sale`,
      detail: 'Active sellers are approved accounts that are not suspended. A sale counts when an order placed in this period is completed.',
      link: { tab: 'sellers' },
    });
  }
  const declining = sellers.filter((s) => s.growth?.pct != null && s.growth.pct <= -25);
  if (declining.length) {
    const s = declining.sort((a, b) => a.growth.abs - b.growth.abs)[0];
    list.push({
      id: 'seller-decline', category: 'attention', tone: 'bad',
      title: `${s.name}'s completed sales fell ${pct(s.growth.pct)}`,
      detail: `${peso(s.sales - s.growth.abs)} → ${peso(s.sales)}, compared with ${comparisonName(ctx.period)}.${declining.length > 1 ? ` ${declining.length - 1} other seller${declining.length > 2 ? 's' : ''} also fell by a quarter or more.` : ''}`,
      link: { tab: 'sellers', sellerId: s.sellerId, name: s.name },
    });
  }
  list.push(varietyShareInsight(ctx.varieties || []));
  list.push(cancellationInsight(ctx.summary, ctx.previous, ctx.period));
  if (ctx.newAccounts) {
    const c = change(ctx.newAccounts.current, ctx.newAccounts.previous);
    list.push({
      id: 'new-accounts', category: 'growth', tone: 'neutral',
      title: `${plural(ctx.newAccounts.current, 'new account')} this period`,
      detail: c.pct != null
        ? `${c.pct >= 0 ? 'Up' : 'Down'} ${pct(c.pct)} from ${ctx.newAccounts.previous} in ${comparisonName(ctx.period)}.`
        : 'No comparison: the earlier period had no new accounts or comparison is off.',
      link: { tab: 'users' },
    });
  }
  if (ctx.pendingApprovals) {
    list.push({
      id: 'pending-approvals', category: 'attention', tone: 'warning',
      title: `${plural(ctx.pendingApprovals, 'seller application')} waiting`,
      detail: 'These shops cannot sign in or list rice until they are reviewed.',
      link: { section: 'users' },
    });
  }
  list.push(...peakInsight(ctx.extremes, ctx.moves, ctx.period.granularity));
  list.push(seasonInsight(ctx.season));
  return dedupe(list);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((i) => i && !seen.has(i.id) && seen.add(i.id));
}
