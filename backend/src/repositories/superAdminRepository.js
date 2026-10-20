import User from '../models/User.js';
import AdminApproval from '../models/AdminApproval.js';
import AdminAuditLog from '../models/AdminAuditLog.js';

// Internal helper function (not exported unless needed elsewhere)
const getQuery = (id) => {
  // If id is a number, use the custom integer userId field
  if (!isNaN(id) && !id.toString().match(/^[0-9a-fA-F]{24}$/)) {
    return { userId: parseInt(id) };
  }
  // Otherwise, assume it's a standard MongoDB ObjectId
  return { _id: id };
};

export const findAllUsers = async () => {
  return await User.find().select('-password');
};

export const findUserById = async (id) => {
  const query = getQuery(id);
  return await User.findOne(query).select('-password');
};

export const updateUser = async (id, data) => {
  const query = getQuery(id);
  return await User.findOneAndUpdate(query, data, { new: true }).select('-password');
};

export const findPendingApprovals = async () => {
  // Sellers who submitted their application, oldest first. One still
  // filling it in is not waiting on anybody yet.
  return await User.find({ role: 'seller', status: 'pending', 'application.submittedAt': { $ne: null } })
    .select('-password')
    .sort({ 'application.submittedAt': 1 });
};

export const updateApproval = async (id, data) => {
  return await AdminApproval.findByIdAndUpdate(id, data, { new: true });
};

export const createAuditLog = async (data) => {
  return await AdminAuditLog.create(data);
};

export const createUser = async (userData) => {
  const newUser = await User.create(userData);
  const obj = newUser.toObject();
  delete obj.password;
  return obj;
};

export const findUsersByUserIds = async (ids) => {
  return await User.find({ userId: { $in: ids } }).select('userId name email');
};

export const findAuditLogs = async ({ page = 1, limit = 20, action, adminId, from, to } = {}) => {
  const filter = {};
  if (action) filter.action = action;
  if (adminId) filter.adminId = Number(adminId);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const skip = (page - 1) * limit;
  const [logs, total] = await Promise.all([
    AdminAuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AdminAuditLog.countDocuments(filter),
  ]);

  return { logs, total, page, totalPages: Math.ceil(total / limit) || 1 };
};