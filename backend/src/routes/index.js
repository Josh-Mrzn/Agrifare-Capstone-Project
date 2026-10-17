// backend/src/routes/index.js
import express from "express";
import authRoutes from "./authRoutes.js";
import productRoutes from "./productRoutes.js";
import superAdminRoutes from "./superAdminRoutes.js";
import adminRoutes from "./adminRoutes.js";
import userRoutes from "./userRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import fileRoutes from "./fileRoutes.js";
import reviewRoutes from "./reviewRoutes.js";
import cartRoutes from "./cartRoutes.js";
import buyerRoutes from "./buyerRoutes.js";
import deliveryRoutes from "./deliveryRoutes.js";
import riderRoutes from "./riderRoutes.js";
import sellerRoutes from "./sellerRoutes.js";
import geoRoutes from "./geoRoutes.js";
import analyticsRoutes from "./analyticsRoutes.js";

const router = express.Router();

// API root - helpful for checking if the backend is live
router.get("/", (req, res) => {
  res.json({
    message: "API is running...",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "GET /",
      register: "POST api/auth/register",
      login: "POST api/auth/login",
      logout: "POST api/auth/logout",
      products: "GET api/products",
    },
  });
});

// === Mount Route Modules ===
router.use("/auth", authRoutes);     // → /api/auth/...
router.use("/products", productRoutes); // → /api/products/...
router.use("/superadmin", superAdminRoutes); // → /api/superadmin/...  
router.use("/admin", adminRoutes); // → /api/admin/...
router.use("/user", userRoutes);     // → /api/user/...
router.use("/notifications", notificationRoutes); // → /api/notifications/...
router.use("/files", fileRoutes); // → /api/files/... (authenticated, private uploads)
router.use("/reviews", reviewRoutes); // → /api/reviews/...
router.use("/cart", cartRoutes); // → /api/cart/...
router.use("/buyer", buyerRoutes); // → /api/buyer/...
router.use("/delivery", deliveryRoutes); // → /api/delivery/...
router.use("/riders", riderRoutes); // → /api/riders/... (seller side and rider side)
router.use("/sellers", sellerRoutes); // → /api/sellers/...
router.use("/geo", geoRoutes); // → /api/geo/...
router.use("/analytics", analyticsRoutes); // → /api/analytics/... (seller and Super Admin)

export default router;
