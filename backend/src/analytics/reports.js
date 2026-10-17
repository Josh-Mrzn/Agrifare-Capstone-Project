import * as data from './data.js';
import { resolvePeriod, badRequest, toLocalDate, addDays } from './period.js';
import {
  summarize, kilograms, packLabel, isSale, buyerAnalysis, productTable, varietyTable, change, INACTIVE_DAYS,
} from './metrics.js';
import { inventoryAnalysis, VELOCITY_WINDOW_DAYS } from './inventory.js';
import { parseFilters, platformContext } from './service.js';
import { peso } from './insights.js';

/**
 * Report definitions: what each export contains, built from the same
 * calculations as the dashboard and the same filters, so a downloaded file
 * and the screen it came from always agree.
 *
 * A report is { title, sections: [{ title, columns, rows }], summary, notes }.
 * Column types (text, money, number, kg, percent, date) tell each writer how
 * to format a value; the values themselves stay raw numbers and dates.
 */

export const SELLER_REPORTS = ['sales', 'orders', 'products', 'buyers', 'inventory'];
export const PLATFORM_REPORTS = ['sales', 'orders', 'sellers', 'products'];

const DAY = 24 * 60 * 60 * 1000;

const STATUS_LABEL = {
  pending: 'Pending', confirmed: 'Confirmed', processing: 'Preparing', shipped: 'Out for delivery',
  delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled',
};

function periodLine(period) {
  return `${period.from} to ${period.to} (Philippine time)`;
}

const lineColumns = (withBuyer) => [
  { key: 'order', label: 'Order no.', type: 'text', width: 80 },
  { key: 'date', label: 'Order date', type: 'date', width: 80 },
  ...(withBuyer ? [{ key: 'buyer', label: 'Buyer', type: 'text', width: 100 }] : [{ key: 'seller', label: 'Seller', type: 'text', width: 100 }]),
  { key: 'product', label: 'Product', type: 'text', width: 120 },
  { key: 'variety', label: 'Variety', type: 'text', width: 70 },
  { key: 'pack', label: 'Pack size', type: 'text', width: 50 },
  { key: 'sacks', label: 'Sacks', type: 'number', width: 40 },
  { key: 'kg', label: 'Kilograms', type: 'kg', width: 55 },
  { key: 'rice', label: 'Rice amount (PHP)', type: 'money', width: 70 },
  { key: 'fee', label: 'Delivery fee (PHP)', type: 'money', width: 60 },
  { key: 'total', label: 'Total (PHP)', type: 'money', width: 70 },
];

const lineRow = (r, varietyOf, names) => ({
  order: r.orderNumber || String(r._id),
  date: new Date(r.orderDate),
  buyer: r.customerName || '',
  seller: names?.get(r.sellerId)?.name || `Seller #${r.sellerId}`,
  product: r.productName,
  variety: varietyOf(r),
  pack: packLabel(r.weightKg),
  sacks: Number(r.quantity) || 0,
  kg: kilograms(r),
  rice: Number(r.subtotal) || 0,
  fee: Number(r.deliveryFee) || 0,
  total: Number(r.total) || 0,
  status: STATUS_LABEL[r.status] || r.status,
  payment: r.paymentStatus || '',
  method: r.paymentMethod || '',
});

function salesSummary(s) {
  return [
    { label: 'Completed sales', value: peso(s.sales) },
    { label: 'Completed orders', value: String(s.completedOrders) },
    { label: 'Average order value', value: s.aov == null ? '—' : peso(s.aov) },
    { label: 'Rice sold', value: `${s.kg.toLocaleString('en-PH')} kg` },
  ];
}

export async function sellerReport(scope, type, query = {}) {
  if (!SELLER_REPORTS.includes(type)) throw badRequest('Unknown report.');
  const period = resolvePeriod({ ...query, compare: type === 'products' ? query.compare : 'none' });
  const filters = parseFilters(query);
  const base = { period, filters, generatedAt: new Date(), scopeLabel: query.scopeLabel || '' };

  if (type === 'inventory') {
    if (scope.sellerId == null) throw badRequest('Inventory reports are per seller.');
    const now = new Date();
    const velocityStart = new Date(Math.min(period.end, now) - VELOCITY_WINDOW_DAYS * DAY);
    const [products, moves] = await Promise.all([
      data.productsOf(scope),
      data.movementsFor(scope.sellerId, period.start, period.end, velocityStart),
    ]);
    const inv = inventoryAnalysis({ products, ...moves, start: period.start, end: period.end, granularity: period.granularity, now });
    const inPeriod = moves.movements.filter((m) => new Date(m.createdAt) >= period.start && new Date(m.createdAt) < period.end);
    return {
      ...base,
      title: 'Inventory and stock movement report',
      summary: [
        { label: 'Stock on hand', value: `${inv.totals.stockKg.toLocaleString('en-PH')} kg` },
        { label: 'Sold in period', value: `${inv.totals.soldKg.toLocaleString('en-PH')} kg` },
        { label: 'Restocked', value: `${inv.totals.restockedKg.toLocaleString('en-PH')} kg` },
        { label: 'Low / sold out', value: `${inv.totals.low} / ${inv.totals.out}` },
      ],
      chart: { title: 'Stock movement (kg)', points: inv.series.map((p) => ({ label: toLocalDate(p.start), value: p.sold })), unit: 'kg sold' },
      sections: [
        {
          title: 'Products',
          columns: [
            { key: 'name', label: 'Product', type: 'text', width: 120 },
            { key: 'variety', label: 'Variety', type: 'text', width: 70 },
            { key: 'stock', label: 'Stock now (kg)', type: 'kg', width: 60 },
            { key: 'threshold', label: 'Warning level (kg)', type: 'kg', width: 60 },
            { key: 'statusLabel', label: 'Status', type: 'text', width: 60 },
            { key: 'soldKg', label: 'Sold (kg)', type: 'kg', width: 55 },
            { key: 'restockedKg', label: 'Restocked (kg)', type: 'kg', width: 60 },
            { key: 'returnedKg', label: 'Returned (kg)', type: 'kg', width: 55 },
            { key: 'adjustedKg', label: 'Adjusted (kg)', type: 'kg', width: 55 },
            { key: 'sellThrough', label: 'Sell-through', type: 'percent', width: 55 },
            { key: 'daysCover', label: 'Days of stock left', type: 'number', width: 55 },
          ],
          rows: inv.products.map((p) => ({ ...p, statusLabel: { out: 'Sold out', low: 'Low', ok: 'In stock' }[p.status] })),
        },
        {
          title: 'Stock movements',
          columns: [
            { key: 'date', label: 'Date', type: 'date', width: 90 },
            { key: 'product', label: 'Product', type: 'text', width: 140 },
            { key: 'type', label: 'Movement', type: 'text', width: 70 },
            { key: 'change', label: 'Change (kg)', type: 'kg', width: 60 },
            { key: 'after', label: 'Stock after (kg)', type: 'kg', width: 70 },
            { key: 'note', label: 'Note', type: 'text', width: 140 },
          ],
          rows: inPeriod.map((m) => ({
            date: new Date(m.createdAt), product: m.productName, type: m.type, change: m.quantity, after: m.resultingStock, note: m.note || '',
          })),
        },
      ],
      notes: inv.limitations,
    };
  }

  const statuses = type === 'sales' ? ['completed'] : filters.status ? [filters.status] : undefined;
  const rows = await data.ordersBetween(scope, period.start, period.end, { ...filters, statuses });
  const varietyOf = await data.varietyLookup(rows);

  if (type === 'sales') {
    const s = summarize(rows);
    return {
      ...base,
      title: 'Sales report',
      summary: salesSummary(s),
      chart: chartOf(rows, period),
      sections: [{ title: 'Completed order lines', columns: [...lineColumns(true), { key: 'method', label: 'Payment method', type: 'text', width: 60 }], rows: rows.map((r) => lineRow(r, varietyOf)) }],
      notes: ['Sales are completed orders only, dated by when the order was placed. Totals include delivery fees.'],
    };
  }

  if (type === 'orders') {
    const s = summarize(rows);
    return {
      ...base,
      title: 'Orders and transactions report',
      summary: [
        { label: 'Orders placed', value: String(s.placedOrders) },
        { label: 'Completed', value: String(s.completedOrders) },
        { label: 'In progress', value: String(s.inProgressOrders) },
        { label: 'Cancelled', value: String(s.cancelledOrders) },
      ],
      sections: [{
        title: 'Order lines',
        columns: [
          ...lineColumns(true).filter((c) => !['variety', 'rice', 'fee'].includes(c.key)),
          { key: 'status', label: 'Order status', type: 'text', width: 60 },
          { key: 'payment', label: 'Payment status', type: 'text', width: 60 },
          { key: 'method', label: 'Payment method', type: 'text', width: 60 },
        ],
        rows: rows.map((r) => lineRow(r, varietyOf)),
      }],
      notes: filters.status ? [`Filtered to status: ${STATUS_LABEL[filters.status]}.`] : [],
    };
  }

  if (type === 'products') {
    const prevRows = period.comparison
      ? await data.ordersBetween(scope, period.comparison.start, period.comparison.end, { ...filters, statuses: ['completed'] })
      : [];
    const prevVariety = await data.varietyLookup(prevRows);
    const prevBy = new Map(productTable(prevRows, prevVariety).map((p) => [p.key, p.sales]));
    const products = productTable(rows, varietyOf);
    return {
      ...base,
      title: 'Product and rice variety performance',
      summary: salesSummary(summarize(rows)),
      chart: { title: 'Completed sales by variety (PHP)', points: varietyTable(rows, varietyOf).map((v) => ({ label: v.variety, value: v.sales })), horizontal: true },
      sections: [
        {
          title: 'Products',
          columns: [
            { key: 'name', label: 'Product', type: 'text', width: 130 },
            { key: 'variety', label: 'Variety', type: 'text', width: 70 },
            { key: 'pack', label: 'Pack size', type: 'text', width: 50 },
            { key: 'sales', label: 'Sales (PHP)', type: 'money', width: 70 },
            { key: 'share', label: 'Share', type: 'percent', width: 45 },
            { key: 'orders', label: 'Orders', type: 'number', width: 45 },
            { key: 'sacks', label: 'Sacks', type: 'number', width: 45 },
            { key: 'kg', label: 'Kilograms', type: 'kg', width: 55 },
            { key: 'pricePerKg', label: 'Avg price per kg (PHP)', type: 'money', width: 65 },
            ...(period.comparison ? [
              { key: 'previousSales', label: 'Previous period (PHP)', type: 'money', width: 70 },
              { key: 'changePct', label: 'Change', type: 'percent', width: 50 },
            ] : []),
          ],
          rows: products.map((p) => {
            const prev = prevBy.get(p.key) || 0;
            return { ...p, previousSales: prev, changePct: change(p.sales, prev).pct };
          }),
        },
        {
          title: 'Rice varieties',
          columns: [
            { key: 'variety', label: 'Variety', type: 'text', width: 100 },
            { key: 'sales', label: 'Sales (PHP)', type: 'money', width: 80 },
            { key: 'share', label: 'Share', type: 'percent', width: 50 },
            { key: 'orders', label: 'Orders', type: 'number', width: 50 },
            { key: 'kg', label: 'Kilograms', type: 'kg', width: 60 },
            { key: 'pricePerKg', label: 'Avg price per kg (PHP)', type: 'money', width: 70 },
          ],
          rows: varietyTable(rows, varietyOf),
        },
      ],
      notes: ['Average price per kg uses the rice amount actually charged on each order, without delivery fees.'],
    };
  }

  // buyers
  const history = await data.buyerHistory(scope, period.end, filters);
  const b = buyerAnalysis(rows, history, { start: period.start, end: period.end, inactiveDays: filters.inactiveDays || INACTIVE_DAYS });
  return {
    ...base,
    title: 'Buyer analytics report',
    summary: [
      { label: 'Buyers', value: String(b.unique) },
      { label: 'New / returning', value: `${b.newBuyers} / ${b.returningBuyers}` },
      { label: 'Repeat purchase rate', value: b.repeatRate == null ? '—' : `${b.repeatRate}%` },
      { label: `Lapsed (${b.inactiveDays}+ days)`, value: String(b.lapsedBuyers) },
    ],
    sections: [
      {
        title: 'Buyers in this period',
        columns: [
          { key: 'name', label: 'Buyer', type: 'text', width: 120 },
          { key: 'segmentLabel', label: 'Type', type: 'text', width: 60 },
          { key: 'orders', label: 'Completed orders', type: 'number', width: 60 },
          { key: 'spent', label: 'Spent (PHP)', type: 'money', width: 70 },
          { key: 'aov', label: 'Average order (PHP)', type: 'money', width: 70 },
          { key: 'lastOrder', label: 'Last order', type: 'date', width: 80 },
          { key: 'daysSinceLast', label: 'Days since last order', type: 'number', width: 60 },
        ],
        rows: b.buyers.map((x) => ({ ...x, segmentLabel: `${x.segment === 'new' ? 'New' : 'Returning'}${x.highValue ? ', high value' : ''}` })),
      },
      {
        title: `Past buyers with no order in ${b.inactiveDays}+ days`,
        columns: [
          { key: 'name', label: 'Buyer', type: 'text', width: 140 },
          { key: 'lastOrder', label: 'Last completed order', type: 'date', width: 90 },
          { key: 'lifetimeSpent', label: 'Lifetime spend (PHP)', type: 'money', width: 90 },
        ],
        rows: b.lapsed,
      },
    ],
    notes: [
      'New: first completed order falls in this period. Returning: completed an order before this period and again in it.',
      'High value: top fifth of buyers by completed spend in this period (shown only with 5 or more buyers).',
      'Contact details are left out of this report on purpose.',
    ],
  };
}

function chartOf(rows, period) {
  // Sales per bucket, from the same rows as the table.
  const points = [];
  const series = new Map();
  for (const r of rows.filter(isSale)) {
    const label = toLocalDate(r.orderDate).slice(0, period.granularity === 'day' ? 10 : 7);
    series.set(label, (series.get(label) || 0) + Number(r.total || 0));
  }
  for (const [label, value] of [...series.entries()].sort()) points.push({ label, value });
  return { title: `Completed sales by ${period.granularity === 'day' ? 'day' : 'month'} (PHP)`, points };
}

export async function platformReport(type, query = {}) {
  if (!PLATFORM_REPORTS.includes(type)) throw badRequest('Unknown report.');
  const period = resolvePeriod(query);
  const filters = parseFilters(query);
  const base = { period, filters, generatedAt: new Date() };

  if (type === 'sellers' || type === 'products') {
    const ctx = await platformContext(query);
    if (type === 'sellers') {
      return {
        ...base,
        title: 'Seller performance report',
        summary: salesSummary(ctx.summary),
        chart: { title: 'Completed sales by seller (PHP)', points: ctx.sellers.slice(0, 10).map((x) => ({ label: x.name, value: x.sales })), horizontal: true },
        sections: [{
          title: 'Sellers',
          columns: [
            { key: 'name', label: 'Seller', type: 'text', width: 130 },
            { key: 'sales', label: 'Completed sales (PHP)', type: 'money', width: 80 },
            { key: 'share', label: 'Share of platform', type: 'percent', width: 55 },
            { key: 'orders', label: 'Completed orders', type: 'number', width: 55 },
            { key: 'buyers', label: 'Buyers', type: 'number', width: 45 },
            { key: 'aov', label: 'Average order (PHP)', type: 'money', width: 70 },
            { key: 'lastSale', label: 'Last completed sale', type: 'date', width: 75 },
            { key: 'growthPct', label: 'Change vs comparison', type: 'percent', width: 60 },
            { key: 'topVarietyLabel', label: 'Top variety', type: 'text', width: 80 },
          ],
          rows: ctx.sellers.map((x) => ({ ...x, growthPct: x.growth?.pct ?? null, topVarietyLabel: x.topVariety ? `${x.topVariety.variety} (${x.topVariety.share}%)` : '' })),
        }],
        notes: ['Sales include delivery fees and exclude cancelled and unfinished orders. Seller shares add up to the platform total.'],
      };
    }
    return {
      ...base,
      title: 'Marketplace product and variety report',
      summary: salesSummary(ctx.summary),
      chart: { title: 'Completed sales by variety (PHP)', points: ctx.varieties.map((v) => ({ label: v.variety, value: v.sales })), horizontal: true },
      sections: [{
        title: 'Rice varieties',
        columns: [
          { key: 'variety', label: 'Variety', type: 'text', width: 100 },
          { key: 'sales', label: 'Completed sales (PHP)', type: 'money', width: 80 },
          { key: 'share', label: 'Share', type: 'percent', width: 50 },
          { key: 'orders', label: 'Orders', type: 'number', width: 50 },
          { key: 'kg', label: 'Kilograms', type: 'kg', width: 60 },
          { key: 'sellersWithSales', label: 'Sellers with sales', type: 'number', width: 60 },
          { key: 'pricePerKg', label: 'Avg price per kg (PHP)', type: 'money', width: 70 },
        ],
        rows: ctx.varieties,
      }],
      notes: [],
    };
  }

  const statuses = type === 'sales' ? ['completed'] : filters.status ? [filters.status] : undefined;
  const scope = query.sellerId ? { sellerId: Number(query.sellerId) } : {};
  const [rows, accounts] = await Promise.all([data.ordersBetween(scope, period.start, period.end, { ...filters, statuses }), data.sellerAccounts()]);
  const names = new Map(accounts.map((a) => [a.userId, a]));
  const varietyOf = await data.varietyLookup(rows);
  const s = summarize(rows);
  // Marketplace exports carry no buyer names: the Super Admin needs the
  // trade, not who bought.
  const cols = lineColumns(false);
  return {
    ...base,
    title: type === 'sales' ? 'Marketplace sales report' : 'Marketplace orders report',
    summary: type === 'sales' ? salesSummary(s) : [
      { label: 'Orders placed', value: String(s.placedOrders) },
      { label: 'Completed', value: String(s.completedOrders) },
      { label: 'In progress', value: String(s.inProgressOrders) },
      { label: 'Cancelled', value: String(s.cancelledOrders) },
    ],
    chart: type === 'sales' ? chartOf(rows, period) : undefined,
    sections: [{
      title: type === 'sales' ? 'Completed order lines' : 'Order lines',
      columns: type === 'sales' ? cols : [...cols.filter((c) => !['rice', 'fee'].includes(c.key)), { key: 'status', label: 'Order status', type: 'text', width: 60 }, { key: 'payment', label: 'Payment status', type: 'text', width: 60 }],
      rows: rows.map((r) => lineRow(r, varietyOf, names)),
    }],
    notes: [],
  };
}

export const reportFileName = (report, ext) => `agrifair-${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${report.period.from}-to-${report.period.to}.${ext}`;

export { periodLine, addDays };
