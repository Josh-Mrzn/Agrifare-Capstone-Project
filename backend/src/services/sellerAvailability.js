import User from '../models/User.js';

/**
 * Whose listings a buyer may be offered: sellers whose account is active.
 *
 * Everyone else is closed - suspended by a Super Admin, deactivated, still
 * applying, rejected, or gone from the directory altogether. Their products
 * stay in the database (a reinstated seller comes back as they were) but
 * nothing of theirs may be browsed, found, added to a cart or ordered.
 * Filtering at read time rather than flipping every product's status means
 * reinstating cannot relist something the seller had taken down themselves.
 */
export async function sellingSellerIds() {
  return User.distinct('userId', { role: 'seller', status: 'active' });
}

/** A Mongo condition on `createdBy` that keeps only open sellers. */
export async function onlyOpenSellers() {
  return { createdBy: { $in: await sellingSellerIds() } };
}

export async function isSellerClosed(userId) {
  if (userId == null) return true;
  return !(await User.exists({ userId, role: 'seller', status: 'active' }));
}
