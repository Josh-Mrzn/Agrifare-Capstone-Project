import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import {
  resolvePeriod, buckets, manilaMidnight, toLocalDate, bucketStart, autoGranularity,
} from '../src/analytics/period.js';
import {
  summarize, change, timeSeries, buyerAnalysis, productTable, varietyTable, sellerTable,
  statusBreakdown, completionTimes, extremes, seasonality, orderKey,
} from '../src/analytics/metrics.js';
import { inventoryAnalysis } from '../src/analytics/inventory.js';
import { sellerInsights } from '../src/analytics/insights.js';
import { scopeFor, parseFilters } from '../src/analytics/service.js';
import { toCsv, toXlsx, toPdf, safeText } from '../src/analytics/exporters.js';

const DAY = 24 * 60 * 60 * 1000;
// 2026-10-17 10:00 Manila
const NOW = new Date('2026-10-17T02:00:00Z');

let seq = 0;
const row = (o) => ({
  _id: `r${++seq}`,
  sellerId: 1,
  groupId: null,
  productId: 'p1',
  productName: 'Dinorado (25 kg)',
  quantity: 1,
  weightKg: 25,
  subtotal: 1500,
  deliveryFee: 0,
  total: 1500,
  status: 'completed',
  orderDate: new Date('2026-10-10T04:00:00Z'),
  buyerUserId: 10,
  customerName: 'Maria',
  statusHistory: [],
  ...o,
});

describe('periods', () => {
  test('last 30 days ends at the next Manila midnight and starts 29 days before today', () => {
    const p = resolvePeriod({ range: '30d' }, NOW);
    assert.equal(p.end.toISOString(), manilaMidnight(2026, 9, 18).toISOString());
    assert.equal(p.start.toISOString(), manilaMidnight(2026, 8, 18).toISOString());
    assert.equal(p.days, 30);
    assert.equal(p.from, '2026-09-18');
    assert.equal(p.to, '2026-10-17');
  });

  test('previous period has the same length and ends where the current one starts', () => {
    const p = resolvePeriod({ range: '30d' }, NOW);
    assert.equal(p.comparison.end.getTime(), p.start.getTime());
    assert.equal(p.comparison.end - p.comparison.start, p.end - p.start);
  });

  test('year-over-year shifts both ends by twelve months', () => {
    const p = resolvePeriod({ range: '30d', compare: 'yoy' }, NOW);
    assert.equal(p.comparison.from, '2025-09-18');
    assert.equal(p.comparison.to, '2025-10-17');
  });

  test('custom range includes the end date and rejects bad input', () => {
    const p = resolvePeriod({ range: 'custom', from: '2026-10-01', to: '2026-10-01' }, NOW);
    assert.equal(p.days, 1);
    assert.throws(() => resolvePeriod({ range: 'custom', from: '2026-10-05', to: '2026-10-01' }, NOW), /before the start/);
    assert.throws(() => resolvePeriod({ range: 'custom', from: '2026-02-31', to: '2026-03-01' }, NOW), /start and end/);
    assert.throws(() => resolvePeriod({ range: 'custom', from: '2020-01-01', to: '2026-01-01' }, NOW), /three years/);
  });

  test('compare=none has no comparison; unknown values fall back to defaults', () => {
    assert.equal(resolvePeriod({ compare: 'none' }, NOW).comparison, null);
    const p = resolvePeriod({ range: 'nonsense', granularity: 'hour' }, NOW);
    assert.equal(p.range, '30d');
    assert.equal(p.granularity, 'day');
  });

  test('weeks start on Monday in Manila time', () => {
    // Sunday 2026-10-18 23:30 Manila belongs to the week of Monday Oct 12.
    const sunday = new Date('2026-10-18T15:30:00Z');
    assert.equal(toLocalDate(bucketStart(sunday, 'week')), '2026-10-12');
    // Monday 00:10 Manila starts a new week.
    assert.equal(toLocalDate(bucketStart(new Date('2026-10-18T16:10:00Z'), 'week')), '2026-10-19');
  });

  test('buckets cover the range without gaps or overlaps', () => {
    const p = resolvePeriod({ range: '12m' }, NOW);
    const list = buckets(p.start, p.end, 'month');
    for (let i = 1; i < list.length; i += 1) assert.equal(list[i].start.getTime(), list[i - 1].end.getTime());
    assert.ok(list[0].start <= p.start && list.at(-1).end >= p.end);
    assert.equal(autoGranularity(p.start, p.end), 'month');
  });
});

describe('metric definitions', () => {
  test('an empty period has zero sales and no average, not NaN', () => {
    const s = summarize([]);
    assert.equal(s.sales, 0);
    assert.equal(s.completedOrders, 0);
    assert.equal(s.aov, null);
    assert.equal(s.completionRate, null);
    assert.equal(s.cancellationRate, null);
  });

  test('two lines of one checkout are one order; delivery fee counts once', () => {
    const rows = [
      row({ groupId: 'g1', total: 1600, deliveryFee: 100 }),
      row({ groupId: 'g1', productId: 'p2', productName: 'Jasmine (5 kg)', weightKg: 5, subtotal: 400, total: 400 }),
    ];
    const s = summarize(rows);
    assert.equal(s.completedOrders, 1);
    assert.equal(s.sales, 2000);
    assert.equal(s.aov, 2000);
    assert.equal(s.deliveryFees, 100);
    assert.equal(s.riceSales, 1900);
    assert.equal(s.kg, 30);
    assert.deepEqual(s.sacks, { '25 kg': 1, '5 kg': 1 });
  });

  test('only completed orders are sales; rates use order counts', () => {
    const rows = [
      row({ total: 1000 }),
      row({ status: 'cancelled', total: 900 }),
      row({ status: 'delivered', total: 800 }),
      row({ status: 'pending', total: 700 }),
    ];
    const s = summarize(rows);
    assert.equal(s.sales, 1000);
    assert.equal(s.completedOrders, 1);
    assert.equal(s.inProgressOrders, 2);
    assert.equal(s.cancelledOrders, 1);
    assert.equal(s.completionRate, 50); // 1 of (1 completed + 1 cancelled)
    assert.equal(s.cancellationRate, 25); // 1 of 4 placed
    assert.equal(s.orderValue, 2500); // everything but the cancelled one
  });

  test('change has no percentage without a baseline', () => {
    assert.deepEqual(change(500, 0), { abs: 500, pct: null, reason: 'no-baseline' });
    assert.deepEqual(change(0, 0), { abs: 0, pct: null, reason: 'both-zero' });
    assert.equal(change(150, 100).pct, 50);
    assert.equal(change(null, 100).reason, 'no-data');
  });

  test('time series totals reconcile with the period summary', () => {
    const p = resolvePeriod({ range: '30d' }, NOW);
    const rows = [
      row({ orderDate: new Date('2026-09-18T00:00:00Z'), total: 100 }),
      row({ orderDate: new Date('2026-10-01T05:00:00Z'), total: 200 }),
      row({ orderDate: new Date('2026-10-17T01:00:00Z'), total: 300 }),
      row({ orderDate: new Date('2026-10-17T01:00:00Z'), total: 50, status: 'cancelled' }),
    ];
    const series = timeSeries(rows, p.start, p.end, 'day', NOW);
    assert.equal(series.reduce((s, b) => s + b.sales, 0), summarize(rows).sales);
    assert.equal(series.length, 30);
    assert.equal(series.at(-1).partial, true);
    assert.equal(series.at(-1).cancelled, 1);
  });

  test('an order at 23:59 Manila is that day; 00:00 is the next', () => {
    const start = manilaMidnight(2026, 9, 1);
    const end = manilaMidnight(2026, 9, 3);
    const rows = [
      row({ orderDate: new Date(manilaMidnight(2026, 9, 2).getTime() - 60 * 1000), total: 1 }),
      row({ orderDate: manilaMidnight(2026, 9, 2), total: 2 }),
    ];
    const series = timeSeries(rows, start, end, 'day', NOW);
    assert.deepEqual(series.map((b) => b.sales), [1, 2]);
  });

  test('buyers: new, returning, repeat rate, high value and lapsed', () => {
    const start = manilaMidnight(2026, 9, 1);
    const end = manilaMidnight(2026, 9, 31);
    const rows = [
      row({ buyerUserId: 1, total: 100 }),
      row({ buyerUserId: 1, total: 100 }),
      row({ buyerUserId: 2, total: 50 }),
      row({ buyerUserId: null, customerName: '  Walk-in ', total: 30 }),
    ];
    const history = new Map([
      ['u:1', { first: new Date('2026-05-01'), last: new Date('2026-10-10'), spent: 900 }],
      ['u:2', { first: new Date('2026-10-10'), last: new Date('2026-10-10'), spent: 50 }],
      ['n:walk-in', { first: new Date('2026-10-10'), last: new Date('2026-10-10'), spent: 30 }],
      ['u:9', { first: new Date('2026-01-01'), last: new Date('2026-06-01'), spent: 400, name: 'Old' }],
    ]);
    const b = buyerAnalysis(rows, history, { start, end });
    assert.equal(b.unique, 3);
    assert.equal(b.returningBuyers, 1);
    assert.equal(b.newBuyers, 2);
    assert.equal(b.repeatRate, 33.3);
    assert.equal(b.highValueBuyers, 0); // fewer than five buyers
    assert.equal(b.lapsedBuyers, 1);
    assert.equal(b.lapsed[0].key, 'u:9');
  });

  test('products are split by pack size and priced from what was charged', () => {
    const rows = [
      row({ quantity: 2, weightKg: 25, subtotal: 3000, total: 3100, deliveryFee: 100 }),
      row({ quantity: 4, weightKg: 5, subtotal: 1000, total: 1000, productName: 'Dinorado (5 kg)' }),
      row({ status: 'cancelled', total: 9999 }),
    ];
    const table = productTable(rows, () => 'Dinorado');
    assert.equal(table.length, 2);
    assert.equal(table[0].pack, '25 kg');
    assert.equal(table[0].kg, 50);
    assert.equal(table[0].pricePerKg, 60);
    assert.equal(table[1].pricePerKg, 50);
    assert.equal(Math.round(table.reduce((s, p) => s + p.share, 0)), 100);
    assert.equal(varietyTable(rows, () => 'Dinorado')[0].kg, 70);
  });

  test('seller shares add up to the platform total and growth needs a baseline', () => {
    const rows = [row({ sellerId: 1, total: 300 }), row({ sellerId: 2, total: 100 })];
    const prev = [row({ sellerId: 1, total: 150 })];
    const t = sellerTable(rows, prev);
    assert.equal(t[0].sellerId, 1);
    assert.equal(t[0].share + t[1].share, 100);
    assert.equal(t[0].growth.pct, 100);
    assert.equal(t[1].growth.pct, null);
  });

  test('status breakdown counts orders, not lines', () => {
    const rows = [row({ groupId: 'a', status: 'pending' }), row({ groupId: 'a', status: 'pending' }), row({ status: 'shipped' })];
    const s = statusBreakdown(rows);
    assert.equal(s.inProgress, 2);
    assert.equal(s.byStatus.pending, 1);
  });

  test('completion time uses the recorded completion moment only', () => {
    const placed = new Date('2026-10-01T00:00:00Z');
    const rows = [
      row({ orderDate: placed, statusHistory: [{ status: 'completed', changedAt: new Date(placed.getTime() + 2 * DAY) }] }),
      row({ orderDate: placed, statusHistory: [] }),
    ];
    const c = completionTimes(rows);
    assert.equal(c.count, 1);
    assert.equal(c.avgDays, 2);
  });

  test('best and worst periods need two finished buckets', () => {
    assert.equal(extremes([{ sales: 5, partial: false }]), null);
    const e = extremes([{ sales: 5, partial: false }, { sales: 9, partial: false }, { sales: 99, partial: true }]);
    assert.equal(e.best.sales, 9);
    assert.equal(e.worst.sales, 5);
  });

  test('seasonality reports how much history there is', () => {
    const months = [{ sales: 10, partial: false, start: new Date('2026-08-01') }, { sales: 20, partial: false, start: new Date('2026-09-01') }];
    assert.equal(seasonality(months, new Date('2026-08-01'), NOW).coverage, 'short');
    assert.equal(seasonality(months, new Date('2024-01-01'), NOW).coverage, 'two-years');
    assert.equal(seasonality([], null, NOW).strongest, null);
  });

  test('order keys separate sellers in one checkout', () => {
    assert.notEqual(orderKey(row({ groupId: 'g', sellerId: 1 })), orderKey(row({ groupId: 'g', sellerId: 2 })));
  });
});

describe('inventory', () => {
  const start = manilaMidnight(2026, 9, 1);
  const end = manilaMidnight(2026, 9, 18);
  const at = (d) => new Date(`2026-10-${d}T03:00:00Z`);
  const products = [
    { _id: 'a', name: 'Dinorado', stock: 40, lowStockThreshold: 50, status: 'active' },
    { _id: 'b', name: 'Jasmine', stock: 500, lowStockThreshold: 20, status: 'active' },
    { _id: 'c', name: 'New rice', stock: 100, lowStockThreshold: 20, status: 'active' },
  ];
  const movements = [
    { productId: 'a', type: 'RESTOCK', quantity: 100, resultingStock: 140, createdAt: at('02') },
    { productId: 'a', type: 'SALE', quantity: -100, resultingStock: 40, createdAt: at('10') },
    { productId: 'b', type: 'SALE', quantity: -25, resultingStock: 500, createdAt: at('12') },
  ];

  test('movements are summed by kind, and stock at start comes from the log', () => {
    const inv = inventoryAnalysis({
      products,
      movements,
      lastBefore: new Map([['a', { resultingStock: 40 }]]),
      firstSeen: new Map([['a', new Date('2026-08-01')], ['b', new Date('2026-10-12')]]),
      start, end, granularity: 'week', now: NOW,
    });
    const a = inv.products.find((p) => p.productId === 'a');
    assert.equal(a.soldKg, 100);
    assert.equal(a.restockedKg, 100);
    assert.equal(a.stockAtStart, 40);
    assert.equal(a.sellThrough, 71.4); // 100 sold of 140 available
    assert.equal(a.status, 'low');
    assert.ok(a.kgPerDay > 0 && a.daysCover != null);
    // Jasmine has only five days of history: no rate, no days-left figure.
    const b = inv.products.find((p) => p.productId === 'b');
    assert.equal(b.kgPerDay, null);
    assert.equal(b.daysCover, null);
    // Nothing logged for the new product: its history is unknown, not zero.
    const c = inv.products.find((p) => p.productId === 'c');
    assert.equal(c.stockAtStart, null);
    assert.ok(inv.limitations.some((l) => l.includes('no logged stock movements')));
    assert.equal(inv.series.reduce((s, p) => s + p.sold, 0), 125);
    assert.ok(inv.alerts.some((x) => x.productId === 'a'));
  });
});

describe('insights', () => {
  const period = resolvePeriod({ range: '30d' }, NOW);

  test('no baseline means no growth rate, and no NaN or Infinity anywhere', () => {
    const list = sellerInsights({ summary: summarize([row({})]), previous: summarize([]), period, varieties: [], products: [], previousProducts: [] });
    const text = JSON.stringify(list);
    assert.ok(!/NaN|Infinity|undefined/.test(text));
    assert.ok(list.some((i) => i.id === 'sales-no-baseline'));
  });

  test('a rise is reported with both figures, and small samples are flagged', () => {
    const list = sellerInsights({
      summary: summarize([row({ total: 1200 })]),
      previous: summarize([row({ total: 1000 })]),
      period, varieties: [], products: [], previousProducts: [],
    });
    const s = list.find((i) => i.id === 'sales-change');
    assert.match(s.title, /rose 20%/);
    assert.match(s.detail, /₱1,000/);
    assert.match(s.detail, /1 order with 1 order/);
  });

  test('an empty seller gets an honest empty message', () => {
    const list = sellerInsights({ summary: summarize([]), previous: summarize([]), period });
    assert.equal(list[0].id, 'sales-none');
  });
});

describe('access scope', () => {
  test('a seller is always scoped to their own account', () => {
    assert.deepEqual(scopeFor({ role: 'seller', userId: 7 }, { sellerId: 99 }), { sellerId: 7 });
  });
  test('a Super Admin sees the platform or one named seller', () => {
    assert.deepEqual(scopeFor({ role: 'superadmin', userId: 1 }), {});
    assert.deepEqual(scopeFor({ role: 'superadmin', userId: 1 }, { sellerId: '12' }), { sellerId: 12 });
    assert.throws(() => scopeFor({ role: 'superadmin' }, { sellerId: 'abc' }), /Unknown seller/);
  });
  test('buyers and riders get no analytics scope', () => {
    assert.throws(() => scopeFor({ role: 'buyer', userId: 3 }), /Not authorized/);
    assert.throws(() => scopeFor(null), /Not authorized/);
  });
  test('filters drop anything not recognised', () => {
    assert.deepEqual(parseFilters({ variety: '{"$ne":1}', status: 'deleted', productId: 'x' }), {});
    assert.deepEqual(parseFilters({ variety: 'Jasmine', status: 'completed' }), { variety: 'Jasmine', status: 'completed' });
  });
});

describe('exports', () => {
  const report = {
    title: 'Sales report',
    period: { from: '2026-10-01', to: '2026-10-17' },
    generatedAt: NOW,
    summary: [{ label: 'Completed sales', value: '₱1,500' }],
    sections: [{
      title: 'Lines',
      columns: [
        { key: 'buyer', label: 'Buyer', type: 'text' },
        { key: 'total', label: 'Total (PHP)', type: 'money' },
        { key: 'date', label: 'Order date', type: 'date' },
      ],
      rows: [
        { buyer: '=HYPERLINK("http://x")', total: 1500, date: new Date('2026-10-10T04:00:00Z') },
        { buyer: 'Ana, "Reyes"', total: -5, date: null },
      ],
    }],
    notes: ['A note'],
  };

  test('text cells that look like formulas are neutralised', () => {
    assert.equal(safeText('=1+1'), "'=1+1");
    assert.equal(safeText('+639'), "'+639");
    assert.equal(safeText('@SUM'), "'@SUM");
    assert.equal(safeText('Maria'), 'Maria');
  });

  test('CSV has a header, a BOM, quoted text and raw numbers', () => {
    const csv = toCsv(report).toString('utf8');
    assert.ok(csv.startsWith('﻿Buyer,Total (PHP),Order date'));
    assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")",1500.00,2026-10-10 12:00`));
    assert.ok(csv.includes('"Ana, ""Reyes""",-5.00,'));
  });

  test('XLSX has typed cells and a summary sheet', async () => {
    const buf = await toXlsx(report);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Lines']);
    const ws = wb.getWorksheet('Lines');
    assert.equal(ws.getCell('B2').value, 1500);
    assert.equal(typeof ws.getCell('A2').value, 'string');
    assert.ok(String(ws.getCell('A2').value).startsWith("'="));
    assert.ok(ws.getCell('C2').value instanceof Date);
  });

  test('PDF is a real PDF', async () => {
    const buf = await toPdf({ ...report, chart: { title: 'Sales', points: [{ label: 'Oct', value: 10 }] } });
    assert.equal(buf.subarray(0, 4).toString(), '%PDF');
    assert.ok(buf.length > 1000);
  });
});
