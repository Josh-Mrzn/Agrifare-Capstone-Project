// src/controllers/productController.js
import { productService } from '../services/productService.js';

export const getAllProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const filters = {
      // `variety` is the schema's own word; `category` stays accepted so the
      // mobile app's wording keeps working.
      variety: req.query.variety || req.query.category,
      status: req.query.status,
      search: req.query.search,
      // Opt-in, for the seller's own screens. A buyer never asks for this.
      includeSoldOut: req.query.includeSoldOut === 'true',
    };

    const result = await productService.getAllProducts(page, limit, filters);

    res.json({
      success: true,
      message: 'Products retrieved successfully',
      data: result.products,
      pagination: result.pagination
    });
  } catch (err) {
    next(err);
  }
};

export const getProductById = async (req, res, next) => {
  try {
    const product = await productService.getProductById(req.params.id);

    res.json({
      success: true,
      message: 'Product retrieved successfully',
      data: product
    });
  } catch (err) {
    next(err);
  }
};

export const getProductsByCategory = async (req, res, next) => {
  try {
    const { category } = req.params;
    const products = await productService.getProductsByCategory(category, {
      includeSoldOut: req.query.includeSoldOut === 'true',
    });

    res.json({
      success: true,
      message: `Products in ${category} retrieved successfully`,
      data: products
    });
  } catch (err) {
    next(err);
  }
};

export const searchProducts = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const products = await productService.searchProducts(q, {
      includeSoldOut: req.query.includeSoldOut === 'true',
    });

    res.json({
      success: true,
      message: 'Products found',
      data: products
    });
  } catch (err) {
    next(err);
  }
};
