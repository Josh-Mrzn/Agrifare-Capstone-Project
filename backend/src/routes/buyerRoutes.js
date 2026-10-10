import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import * as buyerService from '../services/buyerService.js';

const router = express.Router();
router.use(protect);

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
router.post('/orders/:groupId/received', handle((req) => buyerService.confirmReceived(req.user.userId, req.params.groupId)));
router.get('/stats', handle((req) => buyerService.getMyStats(req.user.userId)));

export default router;
