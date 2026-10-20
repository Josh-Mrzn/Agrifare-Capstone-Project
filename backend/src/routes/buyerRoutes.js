import express from 'express';
import { protect, authorizeRoles } from '../middleware/authMiddleware.js';
import upload from '../middleware/multerMiddleware.js';
import * as buyerService from '../services/buyerService.js';
import * as paymongo from '../services/paymongoService.js';

const router = express.Router();
// Orders here are the signed-in buyer's own; other roles have their own pages.
router.use(protect, authorizeRoles('buyer'));

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

router.get('/orders', handle((req) => {
  const { ongoing } = req.query;
  return buyerService.getMyOrders(req.user.userId, {
    ongoing: ongoing === undefined ? undefined : ongoing === 'true',
  });
}));

router.get('/orders/:groupId', handle((req) => buyerService.getMyOrder(req.user.userId, req.params.groupId)));
router.post('/orders/:groupId/cancel', handle((req) => buyerService.cancelMyOrder(req.user.userId, req.params.groupId, req.body?.reason)));
// A new GCash receipt after the seller could not find the payment.
router.post(
  '/orders/:groupId/payment-proof',
  upload.single('paymentProof'),
  handle((req) => buyerService.resubmitPayment(req.user.userId, req.params.groupId, {
    paymentProof: req.file ? `/api/files/${req.file.filename}` : '',
    paymentReference: req.body?.paymentReference,
  })),
);
router.post('/orders/:groupId/problem', handle((req) => buyerService.reportProblem(req.user.userId, req.params.groupId, req.body)));
router.post('/orders/:groupId/received', handle((req) => buyerService.confirmReceived(req.user.userId, req.params.groupId)));
// PayMongo (sandbox): open a checkout page, and ask PayMongo whether it was paid.
router.post('/orders/:groupId/paymongo', handle((req) => paymongo.startPayment(req.user.userId, req.params.groupId)));
router.post('/orders/:groupId/paymongo/verify', handle((req) => paymongo.verifyPayment(req.user.userId, req.params.groupId)));
router.get('/stats', handle((req) => buyerService.getMyStats(req.user.userId)));

export default router;
