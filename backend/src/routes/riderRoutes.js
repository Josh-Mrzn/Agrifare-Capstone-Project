import express from 'express';
import { protect, authorizeRoles, requireActiveSeller } from '../middleware/authMiddleware.js';
import upload from '../middleware/multerMiddleware.js';
import { riderService } from '../services/riderService.js';
import * as deliveryService from '../services/deliveryService.js';

const router = express.Router();
router.use(protect);

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ---- The seller's side: who works for them, and who carries what ----
const sellerOnly = [authorizeRoles('seller'), requireActiveSeller];

router.get('/', sellerOnly, handle((req) => riderService.list(req.user.userId)));
router.post('/', sellerOnly, handle((req) => riderService.add(req.user.userId, req.body || {})));
router.post('/:riderUserId/resend-link', sellerOnly, handle((req) =>
  riderService.resendLink(req.user.userId, req.params.riderUserId)));
router.put('/:riderUserId/suspend', sellerOnly, handle((req) =>
  riderService.suspend(req.user.userId, req.params.riderUserId)));

// Assigning is the seller's call, and it is what gives the rider access to
// this one order - nothing about employment alone opens an order.
router.put('/assign/:orderId', sellerOnly, handle((req) =>
  riderService.assign(req.user.userId, req.params.orderId, req.body?.riderUserId)));

// ---- The rider's own side ----
const riderOnly = authorizeRoles('rider');

router.get('/me/deliveries', riderOnly, handle((req) =>
  riderService.myDeliveries(req.user.userId, { scope: req.query.scope === 'history' ? 'history' : 'active' })));
router.get('/me/deliveries/:orderId', riderOnly, handle((req) =>
  riderService.delivery(req.user.userId, req.params.orderId)));
router.post('/me/deliveries/:orderId/accept', riderOnly, handle((req) =>
  riderService.accept(req.user.userId, req.params.orderId)));
router.post('/me/deliveries/:orderId/decline', riderOnly, handle((req) =>
  riderService.decline(req.user.userId, req.params.orderId, req.body?.reason)));
router.post('/me/deliveries/:orderId/start', riderOnly, handle((req) =>
  riderService.start(req.user.userId, req.params.orderId)));
router.post('/me/deliveries/:orderId/delivered', riderOnly, handle((req) =>
  riderService.markDelivered(req.user.userId, req.params.orderId, req.body || {})));

/**
 * The position, pushed while driving.
 *
 * Goes through the same service the seller's "share my location" uses, so
 * there is one place that decides when a position may be written and what a
 * valid coordinate is.
 */
router.put('/me/deliveries/:orderId/location', riderOnly, handle((req) =>
  deliveryService.updateLocation(req.params.orderId, req.user.userId, req.body || {})));

/**
 * The photo at the door.
 *
 * Private, like a receipt: somebody's doorway and their gate are in it, and
 * that is not something to leave behind a guessable URL.
 */
router.post(
  '/me/deliveries/:orderId/proof',
  riderOnly,
  upload.single('proof'),
  handle((req) => riderService.uploadProof(req.user.userId, req.params.orderId, {
    proofPath: req.file ? `/api/files/${req.file.filename}` : '',
    note: req.body?.note,
  })),
);

export default router;
