import Product, { STOREFRONT_FILTER } from '../models/Product.js';
import User from '../models/User.js';
import { findUserByUserIdSafe } from '../repositories/userRepository.js';
import { getRatingSummary, getRatingMapForSellers } from '../repositories/reviewRepository.js';
import { isSellerClosed } from './sellerAvailability.js';

/**
 * A seller's public face, for a buyer deciding whether to trust them.
 *
 * Everything here is deliberately chosen. Compliance documents prove a seller
 * is real, but the files themselves never leave the review desk - a buyer sees
 * that a permit was verified and which kind, never the permit. The same goes
 * for payout: that money can be sent is worth knowing; the account number is
 * not the buyer's business. Email and contact stay private too, since the app
 * already has chat.
 */
function toPublicProfile(user, stats) {
  const documents = user.documents || [];
  const verifiedDocs = documents.filter((doc) => doc.status === 'verified');

  return {
    id: user.userId,
    name: user.name,
    avatarUrl: user.avatarUrl || '',
    bio: user.bio || '',
    sellerType: user.sellerType || '',
    memberSince: user.createdAt,

    businessName: user.sellerProfile?.businessName || '',
    // A trader or retailer has no farm, so these come back empty rather than
    // as blank labels the app has to hide.
    farmName: user.sellerProfile?.farmName || '',
    farmLocation: user.sellerProfile?.farmLocation || '',
    farmSize: user.sellerProfile?.farmSize || '',
    farmPhotos: user.sellerProfile?.farmPhotos || [],

    /**
     * Two things have to be true: a Super Admin approved the account, and at
     * least one compliance document was checked and passed. Either alone is
     * weaker than a badge suggests.
     */
    isVerified: user.status === 'active' && verifiedDocs.length > 0,
    verifiedCredentials: verifiedDocs.map((doc) => doc.type),
    acceptsGcash: user.payout?.status === 'verified',

    averageRating: stats.averageRating,
    reviewCount: stats.reviewCount,
    productCount: stats.productCount,
    totalSold: stats.totalSold,
  };
}

export const sellerService = {
  async getPublicProfile(userId) {
    if (!Number.isFinite(userId)) throw new Error('Invalid seller id');

    const user = await findUserByUserIdSafe(userId);
    // Suspended is shown to buyers as gone: the shop is closed while it lasts.
    if (!user || user.role !== 'seller' || user.status === 'suspended') {
      throw new Error('Seller not found');
    }

    const [rating, products] = await Promise.all([
      getRatingSummary({ sellerId: userId }),
      Product.find({ createdBy: userId, status: 'active' }).select('soldCount stock'),
    ]);

    return toPublicProfile(user, {
      averageRating: rating.average ? Math.round(rating.average * 10) / 10 : 0,
      reviewCount: rating.count || 0,
      // Counts what is actually on the shelf, so the number matches the list
      // the buyer is about to scroll.
      productCount: products.filter((p) => (p.stock || 0) > 0).length,
      // Sales are counted over everything ever listed - selling out is what
      // earns the number, so it must not take it away.
      totalSold: products.reduce((sum, p) => sum + (p.soldCount || 0), 0),
    });
  },

  /**
   * The shop directory. Only sellers with something to sell appear: a buyer
   * browsing shops has no use for an empty one, and an approved account with
   * no listings is not yet a shop.
   */
  async listShops() {
    // One grouped query rather than a lookup per seller - a directory of
    // twenty shops would otherwise be twenty-one round trips.
    const counts = await Product.aggregate([
      { $match: { ...STOREFRONT_FILTER } },
      {
        $group: {
          _id: '$createdBy',
          productCount: { $sum: 1 },
          totalSold: { $sum: { $ifNull: ['$soldCount', 0] } },
          varieties: { $addToSet: '$variety' },
          fromPrice: { $min: '$price' },
        },
      },
      { $sort: { totalSold: -1 } },
    ]);

    if (!counts.length) return [];

    const sellerIds = counts.map((row) => row._id);
    const [sellers, ratings] = await Promise.all([
      User.find({ userId: { $in: sellerIds }, role: 'seller', status: 'active' }),
      getRatingMapForSellers(sellerIds),
    ]);

    const byId = new Map(sellers.map((user) => [user.userId, user]));

    return counts
      .filter((row) => byId.has(row._id))
      .map((row) => {
        const user = byId.get(row._id);
        const documents = user.documents || [];
        const rating = ratings.get(row._id) || { averageRating: 0, reviewCount: 0 };

        return {
          id: user.userId,
          name: user.name,
          businessName: user.sellerProfile?.businessName || '',
          avatarUrl: user.avatarUrl || '',
          sellerType: user.sellerType || '',
          farmLocation: user.sellerProfile?.farmLocation || '',
          isVerified: documents.some((doc) => doc.status === 'verified'),
          productCount: row.productCount,
          totalSold: row.totalSold,
          // What they actually stock, so a shop card can say so without the
          // app fetching every listing to find out.
          varieties: row.varieties.filter(Boolean).sort(),
          fromPrice: row.fromPrice,
          averageRating: rating.averageRating,
          reviewCount: rating.reviewCount,
        };
      });
  },

  /**
   * How to pay this seller, for a buyer at checkout.
   *
   * The public profile deliberately withholds this - an account number is not
   * something to hand every passer-by. But a buyer about to send money needs
   * the number and the QR, so this sits behind a signed-in route instead.
   *
   * Only a payout a Super Admin has verified is returned: an unchecked QR
   * could send someone's money anywhere.
   */
  async getPaymentDetails(userId) {
    if (!Number.isFinite(userId)) throw new Error('Invalid seller id');

    const user = await findUserByUserIdSafe(userId);
    if (!user || user.role !== 'seller' || user.status === 'suspended') {
      throw new Error('Seller not found');
    }

    const payout = user.payout || {};

    if (payout.status !== 'verified') {
      // Which of the three it is matters. "Not set up" told a seller who had
      // submitted their GCash and was waiting on a Super Admin that they had
      // done nothing - and told the buyer the same, so neither knew the
      // account was one approval away from working.
      const reasons = {
        pending:
          "This seller's GCash is waiting for Super Admin approval. "
          + 'Choose Cash on Delivery for now.',
        rejected:
          "This seller's online payment was not approved. "
          + 'Choose Cash on Delivery.',
      };

      return {
        sellerId: userId,
        sellerName: user.sellerProfile?.businessName || user.name,
        available: false,
        payoutStatus: payout.status || 'unset',
        // Said plainly, because the app has to offer cash on delivery instead
        // rather than showing an empty QR box.
        reason:
          reasons[payout.status]
          || 'This seller has not set up online payment yet. Choose Cash on Delivery.',
      };
    }

    return {
      sellerId: userId,
      sellerName: user.sellerProfile?.businessName || user.name,
      available: true,
      method: payout.method || 'gcash',
      accountName: payout.accountName || '',
      accountNumber: payout.accountNumber || '',
      // Served through the authenticated /api/files route, never statically.
      qrImage: payout.qrImage || '',
    };
  },

  /**
   * Only what can be bought - a buyer browsing a shop should meet neither
   * hidden listings nor sold-out ones.
   */
  async getPublicProducts(userId) {
    if (!Number.isFinite(userId)) throw new Error('Invalid seller id');
    if (await isSellerClosed(userId)) return [];

    return Product.find({ createdBy: userId, ...STOREFRONT_FILTER }).sort({
      createdAt: -1,
    });
  },
};
