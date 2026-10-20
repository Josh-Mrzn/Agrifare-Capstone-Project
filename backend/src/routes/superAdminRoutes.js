import express from 'express';

import {
  getUsers,
  suspendUser,
  deleteUser,
  createUser,
  getPendingApprovals,
  approveAdmin,
  rejectSeller,
  updateUser,
  activateUser,
  getAuditLogs,
  reviewSellerCredentialHandler,
  getPendingCredentialsHandler,
} from '../controllers/superAdminController.js';
import { protect, authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();

// Middleware stays the same
router.use(protect, authorizeRoles('superadmin'));

router.get('/users', getUsers);
router.put('/users/:id/suspend', suspendUser);
router.delete('/users/:id', deleteUser);
router.post('/users', createUser);
router.get('/approvals/pending', getPendingApprovals);
router.put('/approvals/:id/approve', approveAdmin);
router.put('/approvals/:id/reject', rejectSeller);
router.put('/users/:id', updateUser);
router.put('/users/:id/activate', activateUser);
router.get('/audit-logs', getAuditLogs);
// Everything submitted, decided or not - an approval that disappears cannot
// be checked later, or taken back.
router.get('/credentials', getPendingCredentialsHandler);
router.put('/users/:id/credentials', reviewSellerCredentialHandler);

export default router;