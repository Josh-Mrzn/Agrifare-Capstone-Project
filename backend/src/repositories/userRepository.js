import User from '../models/User.js';

export const findUserByUserId = async (userId) => {
  return User.findOne({ userId }).select('+password');
};

export const findUserByUserIdSafe = async (userId) => {
  return User.findOne({ userId });
};

export const updateUserByUserId = async (userId, data) => {
  return User.findOneAndUpdate(
    { userId },
    data,
    { new: true }
  ).select('-password');
};

export const updatePasswordByUserId = async (userId, hashedPassword, { endSessions = false } = {}) => {
  const changes = { password: hashedPassword };
  if (endSessions) changes.passwordChangedAt = new Date();
  return User.findOneAndUpdate(
    { userId },
    changes,
    { new: true }
  );
};