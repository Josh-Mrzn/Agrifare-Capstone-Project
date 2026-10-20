// src/repositories/productRepository.js
import Product, { STOREFRONT_FILTER } from '../models/Product.js';
import { onlyOpenSellers } from '../services/sellerAvailability.js';
import { escapeRegex } from '../utils/escapeRegex.js';

export const productRepository = {

  // Get all products with pagination and filtering
  async getAllProducts(page = 1, limit = 10, filters = {}) {
    const skip = (page - 1) * limit;

    // Sold out and taken-down listings are hidden by default. The seller's own
    // tools ask for them explicitly - they are the ones who need to see what
    // has run out. A suspended seller's listings are hidden either way.
    const query = {
      ...(filters.includeSoldOut ? {} : STOREFRONT_FILTER),
      ...(await onlyOpenSellers()),
    };

    // Apply filters
    // The schema field is `variety`; accepting `category` too keeps the mobile
    // app's own wording working without a second name in the database.
    const variety = filters.variety || filters.category;
    if (variety) {
      query.variety = variety;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.search) {
      query.name = { $regex: escapeRegex(filters.search), $options: 'i' };
    }

    const products = await Product.find(query)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Product.countDocuments(query);

    return {
      products,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  },

  // Get product by ID
  async getProductById(id) {
    return await Product.findById(id);
  },

  // Get products by rice variety
  async getProductsByCategory(variety, { includeSoldOut = false } = {}) {
    return await Product.find({
      variety,
      ...(includeSoldOut ? {} : STOREFRONT_FILTER),
      ...(await onlyOpenSellers()),
    }).sort({ createdAt: -1 });
  },

  // Search products
  async searchProducts(searchTerm, { includeSoldOut = false } = {}) {
    const pattern = escapeRegex(searchTerm);
    return await Product.find({
      ...(includeSoldOut ? {} : STOREFRONT_FILTER),
      ...(await onlyOpenSellers()),
      $or: [
        { name: { $regex: pattern, $options: 'i' } },
        { description: { $regex: pattern, $options: 'i' } }
      ]
    });
  }
};
