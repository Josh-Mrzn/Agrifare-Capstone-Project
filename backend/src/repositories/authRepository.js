import User from '../models/User.js';

async function getNextUserId() {
  const lastUser = await User.findOne({ userId: { $type: 'number' } })
    .sort({ userId: -1 })
    .select('userId')
    .lean();

  return lastUser?.userId ? lastUser.userId + 1 : 1;
}

export const authRepository = {
  async findByEmail(email) {
    return User.findOne({ email }).select('+password');
  },

  /** Optionally skips one user, so editing a profile does not collide with itself. */
  async findByNameKey(nameKey, exceptUserId = null) {
    const query = { nameKey };
    if (exceptUserId != null) query.userId = { $ne: exceptUserId };
    return User.findOne(query).select('name email');
  },

  async findByUserId(userId) {
    return User.findOne({ userId }).select('-password');
  },

  async createUser(userData) {
    if (userData.userId != null) {
      return new User(userData).save();
    }

    // getNextUserId() is a read-then-write, so two concurrent signups can pick the
    // same number. Retry on the resulting duplicate-key error instead of failing.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const userId = await getNextUserId();
        return await new User({ ...userData, userId }).save();
      } catch (err) {
        const isUserIdClash = err?.code === 11000 && 'userId' in (err.keyPattern || {});
        if (!isUserIdClash || attempt === 4) throw err;
      }
    }
  },

  async findById(id) {
    return User.findById(id).select('-password');
  },

  async updateLastLogin(userId) {
    return User.findOneAndUpdate(
      { userId },
      { lastLogin: new Date() },
      { new: true }
    ).select('-password');
  }
};
