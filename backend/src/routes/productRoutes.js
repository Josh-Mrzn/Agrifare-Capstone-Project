// src/routes/productRoutes.js
import express from 'express';
import {
  getAllProducts,
  getProductById,
  getProductsByCategory,
  searchProducts
} from '../controllers/productController.js';

const router = express.Router();

// Read-only and public, so the buyer app can browse before sign-in. Sellers
// change their own listings through /api/admin/products, which checks that
// the listing is theirs.
router.get('/', getAllProducts);                           // GET /api/products
router.get('/search', searchProducts);                     // GET /api/products/search?q=term
router.get('/category/:category', getProductsByCategory); // GET /api/products/category/:category
router.get('/:id', getProductById);                        // GET /api/products/:id

export default router;
