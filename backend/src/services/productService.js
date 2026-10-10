// src/services/productService.js
import { productRepository } from '../repositories/productRepository.js';
import { getRatingMapForProducts } from '../repositories/reviewRepository.js';
import { sellerService } from './sellerService.js';
import { isSellerSuspended } from './sellerAvailability.js';
import { AppError } from '../errors/appError.js';

const NO_RATING = { averageRating: 0, reviewCount: 0 };

/**
 * Ratings live in the Review collection, but every client wants them on the
 * product itself. Merging here means the mobile app and the web read the same
 * shape and neither has to make a second call per product.
 */
async function withRatings(products) {
  const list = Array.isArray(products) ? products : [products];
  const ratings = await getRatingMapForProducts(list.map((p) => p._id));

  const merged = list.map((product) => ({
    ...(product.toObject ? product.toObject() : product),
    ...(ratings.get(String(product._id)) || NO_RATING),
  }));

  return Array.isArray(products) ? merged : merged[0];
}

export const productService = {

  // Get all products
  async getAllProducts(page = 1, limit = 10, filters = {}) {
    if (page < 1 || limit < 1) {
      throw new AppError('Page and limit must be positive numbers', 400);
    }

    const result = await productRepository.getAllProducts(page, limit, filters);
    return { ...result, products: await withRatings(result.products) };
  },

  // Get product by ID
  async getProductById(id) {
    const product = await productRepository.getProductById(id);
    // A suspended seller's listing answers exactly like a missing one, so an
    // old link or a saved screen cannot open a product nobody may buy.
    if (!product || await isSellerSuspended(product.createdBy)) {
      throw new AppError('Product not found', 404);
    }

    const withRating = await withRatings(product);

    // The detail screen shows a seller card straight away, so a small summary
    // rides along rather than costing a second round trip. Tapping it fetches
    // the full profile from /sellers/:id.
    try {
      const seller = await sellerService.getPublicProfile(product.createdBy);
      withRating.seller = {
        id: seller.id,
        name: seller.name,
        avatarUrl: seller.avatarUrl,
        businessName: seller.businessName,
        isVerified: seller.isVerified,
        averageRating: seller.averageRating,
        productCount: seller.productCount,
      };
    } catch {
      // A product whose seller was removed is still a product worth showing.
      withRating.seller = null;
    }

    return withRating;
  },

  // Get products by category
  async getProductsByCategory(category, options = {}) {
    if (!category) {
      throw new AppError('Category is required', 400);
    }

    return await withRatings(
      await productRepository.getProductsByCategory(category, options),
    );
  },

  // Search products
  async searchProducts(searchTerm, options = {}) {
    if (!searchTerm || searchTerm.trim() === '') {
      throw new AppError('Search term is required', 400);
    }

    return await withRatings(
      await productRepository.searchProducts(searchTerm, options),
    );
  }
};
