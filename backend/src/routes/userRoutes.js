import express from 'express';
import { submitSellerApplicationService } from '../services/userService.js';
import { protect } from '../middleware/authMiddleware.js';
import { passwordLimiter } from '../middleware/rateLimiter.js';
import { addressService } from '../services/addressService.js';
import upload from '../middleware/multerMiddleware.js';
import {
  getMe,
  updateProfile,
  updatePassword,
  getLoginHistory
} from '../controllers/userController.js';

const router = express.Router();

const profileUpload = upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'farmPhotos', maxCount: 5 },
  { name: 'paymentQr', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

router.get('/me', protect, getMe);
router.put('/edit', protect, profileUpload, updateProfile);
router.put('/reset-password', protect, passwordLimiter, updatePassword);
router.get('/login-history', protect, getLoginHistory);
// A seller sends their application for review (or again, after a rejection).
router.post('/seller-application', protect, async (req, res) => {
  try {
    res.json(await submitSellerApplicationService(req.user.userId));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ---- Saved delivery addresses ----
const addresses = (fn) => async (req, res) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

router.get('/addresses', protect, addresses((req) =>
  addressService.list(req.user.userId)));

router.post('/addresses', protect, addresses((req) =>
  addressService.add(req.user.userId, req.body || {})));

router.put('/addresses/:id', protect, addresses((req) =>
  addressService.update(req.user.userId, req.params.id, req.body || {})));

router.delete('/addresses/:id', protect, addresses((req) =>
  addressService.remove(req.user.userId, req.params.id)));

export default router;