import express from 'express';
import { protect, authorizeRoles } from '../middleware/authMiddleware.js';
import {
  scopeFor, sellerSection, platformSection, buyerProfile, filterOptions,
} from '../analytics/service.js';
import { sellerReport, platformReport, reportFileName } from '../analytics/reports.js';
import { FORMATS } from '../analytics/exporters.js';
import { findSeller } from '../analytics/data.js';

/**
 * /api/analytics
 *
 *   /seller/...                    the signed-in seller's own numbers
 *   /platform/...                  the marketplace (Super Admin)
 *   /platform/sellers/:id/...      one seller, seen by a Super Admin
 *
 * The seller id for a seller is always their own account (scopeFor), never a
 * value from the request; the platform routes require the superadmin role.
 */
const router = express.Router();
router.use(protect);

const run = (fn) => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await fn(req));
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
};

async function sendReport(res, report, format) {
  const out = FORMATS[format];
  if (!out) return res.status(400).json({ error: 'Choose csv, xlsx or pdf.' });
  const body = await out.write(report);
  res.set({
    'Content-Type': out.type,
    'Content-Disposition': `attachment; filename="${reportFileName(report, format)}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(body);
}

const exportRoute = (build) => async (req, res, next) => {
  try {
    const report = await build(req);
    await sendReport(res, report, String(req.query.format || 'csv'));
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
};

// ---- Seller: their own records only ----
const seller = authorizeRoles('seller');
router.get('/seller/options', seller, run((req) => filterOptions(scopeFor(req.user))));
router.get('/seller/export/:report', seller, exportRoute((req) => sellerReport(scopeFor(req.user), req.params.report, req.query)));
router.get('/seller/:section', seller, run((req) => sellerSection(scopeFor(req.user), req.params.section, req.query)));

// ---- Super Admin: the marketplace, and any one seller ----
const admin = authorizeRoles('superadmin');

/** A seller id from the URL, checked to be a real seller account. */
async function sellerScope(req) {
  const scope = scopeFor(req.user, { sellerId: req.params.sellerId });
  if (!(await findSeller(scope.sellerId))) throw Object.assign(new Error('Seller not found.'), { status: 404 });
  return scope;
}

router.get('/platform/options', admin, run(() => filterOptions({})));
router.get('/platform/export/:report', admin, exportRoute((req) => platformReport(req.params.report, req.query)));
router.get('/platform/buyers/:buyerUserId', admin, run((req) => buyerProfile(Number(req.params.buyerUserId))));
router.get('/platform/sellers/:sellerId/options', admin, run(async (req) => filterOptions(await sellerScope(req))));
router.get('/platform/sellers/:sellerId/export/:report', admin, exportRoute(async (req) => sellerReport(await sellerScope(req), req.params.report, req.query)));
router.get('/platform/sellers/:sellerId/:section', admin, run(async (req) => sellerSection(await sellerScope(req), req.params.section, req.query)));
router.get('/platform/:section', admin, run((req) => platformSection(req.params.section, req.query)));

export default router;
