import express from 'express';
// ✅ Import specific functions instead of the whole class
import {
  addProduct,
  editProduct,
  deleteProduct,
  duplicateProduct,
  viewOrders,
  getMyProducts,
  recordSale,
  getMyCustomers,
  updateOrderStatusHandler,
  reviewOrderPaymentHandler,
  setCourierHandler,
  recordDeliveryHandler,
  emailReportHandler,
  mailStatusHandler,
  getInventorySummary,
  restockProduct,
  adjustStock,
  getStockMovements,
  correctCodHandler,
  recordRefundHandler,
  decideCancellationHandler,
  resolveProblemHandler,
} from '../controllers/adminController.js';
import { protect, authorizeRoles, requireActiveSeller } from '../middleware/authMiddleware.js';
import upload from '../middleware/multerMiddleware.js';

const router = express.Router();


router.use(protect, authorizeRoles('seller'), requireActiveSeller);

router.post('/products', upload.array('images', 5), addProduct);
router.put('/products/:id', upload.array('images', 5), editProduct);
router.delete('/products/:id', deleteProduct);
router.post('/products/:id/duplicate', duplicateProduct);
router.get('/products', getMyProducts);

router.post('/orders', recordSale);
router.get('/orders/customers', getMyCustomers);
router.get('/orders', viewOrders);
router.put('/orders/:id/status', updateOrderStatusHandler);
router.put('/orders/:id/payment', reviewOrderPaymentHandler);
router.put('/orders/:id/courier', setCourierHandler);
router.put('/orders/:id/cod', correctCodHandler);
router.put('/orders/:id/refund', recordRefundHandler);
router.put('/orders/:id/cancellation', decideCancellationHandler);
router.put('/orders/:id/problem', resolveProblemHandler);
// The photo at the door, when the seller's courier delivered rather than one
// of their riders. Private like the rider's proof.
router.post('/orders/:id/delivered', upload.single('proof'), recordDeliveryHandler);
router.get('/reports/mail-status', mailStatusHandler);
router.post('/reports/:type/email', emailReportHandler);

router.get('/inventory', getInventorySummary);
router.put('/inventory/:id/restock', restockProduct);
router.put('/inventory/:id/adjust', adjustStock);
router.get('/inventory/:id/movements', getStockMovements);

export default router;