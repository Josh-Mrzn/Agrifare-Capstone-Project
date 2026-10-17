/**
 * Analytics against a real MongoDB, through the real HTTP routes.
 *
 * Runs only when MONGO_TEST_URI points at a throwaway database, for example:
 *   MONGO_TEST_URI=mongodb://127.0.0.1:27017/agrifair_test npm test
 * The database is wiped before and after. Never point it at production.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';

const URI = process.env.MONGO_TEST_URI;
const skip = !URI && 'set MONGO_TEST_URI to run the database tests';

let server;
let base;
let models;
const tokens = {};
const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => new Date(Date.now() - d * DAY);

async function get(path, who, raw = false) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${tokens[who]}` } });
  if (raw) return res;
  return { status: res.status, body: await res.json() };
}

describe('analytics API', { skip }, () => {
  before(async () => {
    process.env.JWT_SECRET = 'test-secret';
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();

    const [{ default: User }, { default: Product }, { default: Order }, { default: StockMovement }, { default: routes }, { errorHandler }] = await Promise.all([
      import('../src/models/User.js'),
      import('../src/models/Product.js'),
      import('../src/models/Order.js'),
      import('../src/models/StockMovement.js'),
      import('../src/routes/analyticsRoutes.js'),
      import('../src/middleware/errorMiddleware.js'),
    ]);
    models = { User, Product, Order, StockMovement };

    const mk = (userId, role, name, status = 'active') => ({
      userId, role, name, email: `${name.toLowerCase().replace(/\s/g, '')}@test.ph`, password: 'secret123', status, emailVerified: true,
    });
    await User.create([
      mk(1, 'superadmin', 'Admin'),
      mk(2, 'seller', 'Seller One'),
      mk(3, 'seller', 'Seller Two'),
      mk(4, 'seller', 'Empty Shop'),
      mk(10, 'buyer', 'Buyer A'),
      mk(11, 'buyer', 'Buyer B'),
    ]);
    for (const [who, id, role] of [['admin', 1, 'superadmin'], ['s1', 2, 'seller'], ['s2', 3, 'seller'], ['empty', 4, 'seller'], ['buyer', 10, 'buyer']]) {
      tokens[who] = jwt.sign({ userId: id, role, email: `${who}@test.ph` }, process.env.JWT_SECRET);
    }

    const product = (createdBy, name, variety, stock) => ({
      name, variety, price: 60, description: 'test', stock, lowStockThreshold: 50, weightKg: 25, createdBy, status: 'active',
    });
    const [p1, p2, p3] = await Product.create([
      product(2, 'S1 Jasmine', 'Jasmine', 40),
      product(2, 'S1 Sinandomeng', 'Sinandomeng', 500),
      product(3, 'S2 Jasmine', 'Jasmine', 300),
    ]);

    const order = (o) => ({
      productName: 'x', unitPrice: 1500, quantity: 1, weightKg: 25, subtotal: 1500, deliveryFee: 0, total: 1500,
      customerName: 'Buyer A', buyerUserId: 10, source: 'storefront', ...o,
    });
    await Order.create([
      // Seller One, this period: two-line checkout (one order), another order, a cancellation, one in progress.
      order({ sellerId: 2, productId: p1._id, productName: 'S1 Jasmine (25 kg)', groupId: 'g1', total: 1600, deliveryFee: 100, status: 'completed', orderDate: ago(3), statusHistory: [{ status: 'completed', changedAt: ago(1) }] }),
      order({ sellerId: 2, productId: p2._id, productName: 'S1 Sinandomeng (25 kg)', groupId: 'g1', total: 1400, subtotal: 1400, status: 'completed', orderDate: ago(3) }),
      order({ sellerId: 2, productId: p1._id, productName: 'S1 Jasmine (25 kg)', total: 1500, status: 'completed', orderDate: ago(10), buyerUserId: 11, customerName: 'Buyer B' }),
      order({ sellerId: 2, productId: p1._id, total: 900, status: 'cancelled', orderDate: ago(5) }),
      order({ sellerId: 2, productId: p2._id, total: 700, status: 'pending', orderDate: ago(1) }),
      // Seller One, previous period: Buyer A bought before, so A is returning.
      order({ sellerId: 2, productId: p1._id, total: 1000, status: 'completed', orderDate: ago(40) }),
      // Seller Two.
      order({ sellerId: 3, productId: p3._id, productName: 'S2 Jasmine (25 kg)', total: 5000, status: 'completed', orderDate: ago(2), buyerUserId: 11, customerName: 'Buyer B' }),
    ]);

    await StockMovement.create([
      { sellerId: 2, productId: p1._id, productName: 'S1 Jasmine', type: 'RESTOCK', quantity: 100, resultingStock: 140, createdAt: ago(20) },
      { sellerId: 2, productId: p1._id, productName: 'S1 Jasmine', type: 'SALE', quantity: -100, resultingStock: 40, createdAt: ago(3) },
      { sellerId: 3, productId: p3._id, productName: 'S2 Jasmine', type: 'SALE', quantity: -25, resultingStock: 300, createdAt: ago(2) },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/analytics', routes);
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/analytics`;
  });

  after(async () => {
    server?.close();
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  test('a seller sees only their own sales, and cannot ask for another seller', async () => {
    const { status, body } = await get('/seller/overview?range=30d&sellerId=3', 's1');
    assert.equal(status, 200);
    const k = Object.fromEntries(body.kpis.map((x) => [x.id, x]));
    assert.equal(k.sales.value, 4500); // 1600 + 1400 + 1500, not Seller Two's 5000
    assert.equal(k.orders.value, 2); // the two-line checkout is one order
    assert.equal(k.aov.value, 2250);
    assert.equal(k.sales.previous, 1000);
    assert.equal(k.sales.change.pct, 350);
    assert.equal(body.status.cancelled, 1);
    assert.equal(body.status.inProgress, 1);
    assert.ok(body.insights.length > 0);
    assert.ok(!JSON.stringify(body).includes('S2 Jasmine'));
  });

  test('roles are enforced on every analytics route', async () => {
    assert.equal((await get('/platform/overview', 's1')).status, 403);
    assert.equal((await get('/platform/sellers/2/overview', 's1')).status, 403);
    assert.equal((await get('/seller/overview', 'buyer')).status, 403);
    assert.equal((await get('/seller/overview', 'admin')).status, 403);
    const res = await fetch(`${base}/seller/overview`);
    assert.equal(res.status, 401);
  });

  test('marketplace totals reconcile with the seller table', async () => {
    const { body } = await get('/platform/sellers?range=30d', 'admin');
    const total = body.sellers.reduce((s, x) => s + x.sales, 0);
    assert.equal(total, 9500);
    assert.equal(body.platformSales, 9500);
    assert.equal(Math.round(body.sellers.reduce((s, x) => s + x.share, 0)), 100);
    // The shop with no sales is listed, at zero.
    assert.ok(body.sellers.some((x) => x.sellerId === 4 && x.sales === 0));
    const overview = (await get('/platform/overview?range=30d', 'admin')).body;
    assert.equal(overview.kpis.find((x) => x.id === 'sales').value, 9500);
  });

  test('a Super Admin sees one seller exactly as the seller does', async () => {
    const mine = (await get('/seller/sales?range=30d', 's1')).body;
    const theirs = (await get('/platform/sellers/2/sales?range=30d', 'admin')).body;
    assert.deepEqual(theirs.kpis, mine.kpis);
    assert.equal((await get('/platform/sellers/999/overview', 'admin')).status, 404);
    assert.equal((await get('/platform/sellers/10/overview', 'admin')).status, 404); // a buyer, not a seller
  });

  test('a shop with no orders gets zeros and an honest message', async () => {
    const { body } = await get('/seller/overview?range=30d', 'empty');
    const sales = body.kpis.find((x) => x.id === 'sales');
    assert.equal(sales.value, 0);
    assert.equal(body.kpis.find((x) => x.id === 'aov').value, null);
    assert.equal(sales.change.pct, null);
    assert.equal(body.insights[0].id, 'sales-none');
  });

  test('buyers are split into new and returning from their history', async () => {
    const { body } = await get('/seller/buyers?range=30d', 's1');
    const seg = Object.fromEntries(body.buyers.map((b) => [b.name, b.segment]));
    assert.equal(seg['Buyer A'], 'returning');
    assert.equal(seg['Buyer B'], 'new');
    assert.ok(body.buyers.every((b) => !('customerContact' in b) && !('deliveryAddress' in b)));
  });

  test('the variety filter narrows every figure', async () => {
    const { body } = await get('/seller/products?range=30d&variety=Sinandomeng', 's1');
    assert.equal(body.varieties.length, 1);
    assert.equal(body.products.reduce((s, p) => s + p.sales, 0), 1400);
  });

  test('inventory uses the movement log and flags low stock', async () => {
    const { body } = await get('/seller/inventory?range=30d', 's1');
    const jas = body.products.find((p) => p.name === 'S1 Jasmine');
    assert.equal(jas.soldKg, 100);
    assert.equal(jas.restockedKg, 100);
    assert.equal(jas.status, 'low');
    assert.ok(body.alerts.some((a) => a.productId === jas.productId));
    assert.ok(!body.products.some((p) => p.name === 'S2 Jasmine'));
  });

  test('seasons say how much history there is', async () => {
    const { body } = await get('/seller/seasons', 's1');
    assert.equal(body.season.coverage, 'short');
    assert.equal(body.monthly.length, 25); // 24 whole months + the current one
  });

  test('bad input is a 400, not a crash', async () => {
    assert.equal((await get('/seller/overview?range=custom&from=2026-13-01&to=2026-12-01', 's1')).status, 400);
    assert.equal((await get('/seller/whatever', 's1')).status, 400);
    assert.equal((await get('/seller/export/whatever?format=csv', 's1')).status, 400);
    assert.equal((await get('/seller/export/sales?format=exe', 's1')).status, 400);
  });

  test('a CSV export matches the dashboard for the same filters', async () => {
    const res = await get('/seller/export/sales?range=30d&format=csv', 's1', true);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="agrifair-sales-report-.*\.csv"/);
    const lines = (await res.text()).trim().split('\r\n');
    const header = lines[0].replace('﻿', '').split(',');
    const totalIdx = header.indexOf('Total (PHP)');
    const sum = lines.slice(1).reduce((s, l) => s + Number(l.split(',')[totalIdx]), 0);
    assert.equal(sum, 4500);
    assert.ok(!lines.some((l) => l.includes('S2 Jasmine')));
  });

  test('XLSX and PDF exports open, with the filter applied', async () => {
    const x = await get('/seller/export/products?range=30d&format=xlsx&variety=Jasmine', 's1', true);
    assert.equal(x.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await x.arrayBuffer()));
    const ws = wb.getWorksheet('Products');
    assert.equal(ws.rowCount, 2); // header + S1 Jasmine only
    const p = await get('/seller/export/inventory?range=30d&format=pdf', 's1', true);
    assert.equal(p.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await p.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  });

  test('marketplace exports carry no buyer names', async () => {
    const res = await get('/platform/export/sales?range=30d&format=csv', 'admin', true);
    const text = await res.text();
    assert.ok(!text.includes('Buyer A') && !text.includes('Buyer B'));
    assert.ok(text.includes('Seller One') && text.includes('Seller Two'));
  });

  test('a buyer profile shows spending, not sales', async () => {
    const { body } = await get('/platform/buyers/11', 'admin');
    assert.equal(body.spent, 6500);
    assert.equal(body.sellers, 2);
    assert.equal((await get('/platform/buyers/2', 'admin')).status, 404);
  });

  test('user growth counts accounts created in the period', async () => {
    const { body } = await get('/platform/users?range=30d', 'admin');
    assert.equal(body.totals.newSellers, 3);
    assert.equal(body.allTime.activeSellers, 3);
  });
});
