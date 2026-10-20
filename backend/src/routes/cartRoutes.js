import express from 'express';
import { protect, authorizeRoles } from '../middleware/authMiddleware.js';
import upload from '../middleware/multerMiddleware.js';
import * as cartService from '../services/cartService.js';

const router = express.Router();
// A cart belongs to a buyer; sellers, riders and admins do not shop.
router.use(protect, authorizeRoles('buyer'));

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

router.get('/', handle((req) => cartService.getCart(req.user.userId)));
router.post('/items', handle((req) => cartService.addItem(req.user.userId, req.body || {})));
// The weight rides in the query string rather than the path: a line is
// identified by product and sack size together, and two weights of the same
// rice are two different lines.
router.put('/items/:productId', handle((req) => cartService.setQuantity(
  req.user.userId,
  req.params.productId,
  req.body?.quantity,
  req.body?.weightKg ?? req.query.weightKg,
)));

router.delete('/items/:productId', handle((req) => cartService.removeItem(
  req.user.userId,
  req.params.productId,
  req.query.weightKg,
)));
router.delete('/', handle((req) => cartService.clearCart(req.user.userId)));
// Multipart, because a GCash order carries the receipt with it. The file is
// optional - cash on delivery sends none - and lands in the private uploads
// folder, reachable only through the authenticated /api/files route.
router.post(
  '/checkout',
  upload.single('paymentProof'),
  handle((req) => cartService.checkout(req.user.userId, {
    ...(req.body || {}),
    checkoutKey: req.body?.checkoutKey || req.get('Idempotency-Key') || '',
    paymentProof: req.file ? `/api/files/${req.file.filename}` : '',
  })),
);

export default router;
