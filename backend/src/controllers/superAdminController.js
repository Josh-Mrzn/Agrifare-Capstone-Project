import * as SuperAdminService from '../services/superAdminService.js';

/**
 * A refused action (wrong state, missing permit) is the caller's to fix: 400.
 * A missing account is 404. Only something unexpected is a 500.
 */
const statusOf = (error) => error.statusCode
  || (/not found/i.test(error.message) ? 404 : error.name === 'MongoServerError' || error.name === 'MongoNetworkError' ? 500 : 400);


export const getUsers = async (req, res) => {
  try {
    const users = await SuperAdminService.getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(statusOf(error)).json({ error: error.message });
  }
};

export const suspendUser = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const targetId = req.params.id;

    if (!adminId) {
      return res.status(401).json({ error: "Admin identity not found in token" });
    }

    const user = await SuperAdminService.suspendUser(targetId, adminId);
    res.json(user);
  } catch (error) {
    res.status(statusOf(error)).json({ error: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    // Corrected to use req.user.userId for consistency
    const result = await SuperAdminService.deleteUser(req.params.id, req.user.userId);
    res.json(result);
  } catch (error) {
    res.status(statusOf(error)).json({ error: error.message });
  }
};

export const getPendingApprovals = async (req, res) => {
  try {
    const approvals = await SuperAdminService.getPendingApprovals();
    res.json(approvals);
  } catch (error) {
    res.status(statusOf(error)).json({ error: error.message });
  }
};

export const approveAdmin = async (req, res) => {
  try {
    const user = await SuperAdminService.approveAdmin(
      req.params.id,
      req.user.userId
    );

    res.json({
      message: 'User activated successfully',
      user
    });
  } catch (error) {
    res.status(statusOf(error)).json({ error: error.message });
  }
};

export const rejectSeller = async (req, res) => {
  try {
    const user = await SuperAdminService.rejectSeller(req.params.id, req.user.userId, req.body?.reason);
    res.json({ message: 'Seller application rejected', user });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const createUser = async (req, res) => {
  try {
    const user = await SuperAdminService.createUser(req.body, req.user.userId);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const user = await SuperAdminService.updateUser(req.params.id, req.body, req.user.userId);
    res.json(user);
  } catch (error) {
    res.status(statusOf(error)).json({ error: error.message });
  }
};

export const activateUser = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const targetId = req.params.id;

    const user = await SuperAdminService.activateUser(targetId, adminId);
    res.json({
      message: "User activated successfully",
      user
    });
  } catch (error) {
    res.status(statusOf(error)).json({ error: error.message });
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const { page, limit, action, adminId, from, to } = req.query;
    const result = await SuperAdminService.getAuditLogs({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      action,
      adminId,
      from,
      to,
    });
    res.json(result);
  } catch (error) {
    res.status(statusOf(error)).json({ error: error.message });
  }
};

export const reviewSellerCredentialHandler = async (req, res) => {
  try {
    const user = await SuperAdminService.reviewSellerCredential(
      req.params.id, req.user.userId, req.body || {}
    );
    res.json({ userId: user.userId, payout: user.payout, documents: user.documents });
  } catch (error) {
    console.error('[superadmin] credential review failed:', error.message);
    res.status(400).json({ error: error.message });
  }
};

export const getPendingCredentialsHandler = async (req, res) => {
  try {
    res.json(await SuperAdminService.getSellerCredentials());
  } catch (error) {
    res.status(statusOf(error)).json({ error: error.message });
  }
};
