import * as adminService from '../services/adminService.js';
import * as reportService from '../services/reportService.js';

function buildProductPayload(req) {
  const body = req.body || {};
  const payload = {};

  if (body.name !== undefined) payload.name = body.name;
  if (body.variety !== undefined) payload.variety = body.variety;
  if (body.description !== undefined) payload.description = body.description;
  if (body.price !== undefined) payload.price = Number(body.price);
  if (body.stock !== undefined) payload.stock = Number(body.stock);
  if (body.lowStockThreshold !== undefined) payload.lowStockThreshold = Number(body.lowStockThreshold);
  if (body.status !== undefined) payload.status = body.status;

  if (body.weightTiers !== undefined) {
    try {
      payload.weightTiers = JSON.parse(body.weightTiers);
    } catch {
      payload.weightTiers = [];
    }
  }

  const uploadedImages = (req.files || []).map((f) => `/uploads/media/${f.filename}`);
  let existingImages = [];
  if (body.existingImages !== undefined) {
    try {
      existingImages = JSON.parse(body.existingImages);
    } catch {
      existingImages = [];
    }
  }
  if (uploadedImages.length > 0 || body.existingImages !== undefined) {
    payload.images = [...existingImages, ...uploadedImages].slice(0, 5);
  }

  return payload;
}

export const addProduct = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const product = await adminService.addProduct(buildProductPayload(req), adminId);
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const getMyProducts = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const products = await adminService.getMyProducts(adminId);
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const editProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await adminService.editProduct(id, req.user.userId, buildProductPayload(req));
    res.status(200).json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await adminService.deleteProduct(id, req.user.userId);
    res.status(200).json(result);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

export const duplicateProduct = async (req, res) => {
  try {
    const product = await adminService.duplicateProduct(req.params.id, req.user.userId);
    res.status(201).json(product);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

export const viewOrders = async (req, res) => {
  try {
    const orders = await adminService.viewOrders(req.user.userId);
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const recordSale = async (req, res) => {
  try {
    const order = await adminService.recordSale(req.body, req.user.userId);
    res.status(201).json(order);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const getMyOrderAnalytics = async (req, res) => {
  try {
    const analytics = await adminService.getMyOrderAnalytics(req.user.userId);
    res.status(200).json(analytics);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMyOrderBreakdown = async (req, res) => {
  try {
    const breakdown = await adminService.getMyOrderBreakdown(req.user.userId);
    res.status(200).json(breakdown);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMyCustomers = async (req, res) => {
  try {
    const customers = await adminService.getMyCustomers(req.user.userId);
    res.status(200).json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateOrderStatusHandler = async (req, res) => {
  try {
    const order = await adminService.updateOrderStatus(
      req.params.id,
      req.user.userId,
      req.body.status,
      req.body.reason
    );
    res.status(200).json(order);
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message });
  }
};

export const setCourierHandler = async (req, res) => {
  try {
    res.json(await adminService.setCourier(req.params.id, req.user.userId, req.body || {}));
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message });
  }
};

export const recordDeliveryHandler = async (req, res) => {
  try {
    res.json(await adminService.recordSellerDelivery(req.params.id, req.user.userId, {
      proofPath: req.file ? `/api/files/${req.file.filename}` : '',
      note: req.body?.note,
    }));
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message });
  }
};

export const getInventorySummary = async (req, res) => {
  try {
    const summary = await adminService.getInventorySummary(req.user.userId);
    res.status(200).json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const restockProduct = async (req, res) => {
  try {
    const product = await adminService.restockProduct(req.params.id, req.user.userId, req.body.quantity, req.body.note);
    res.status(200).json(product);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const adjustStock = async (req, res) => {
  try {
    const product = await adminService.adjustStock(
      req.params.id,
      req.user.userId,
      req.body.quantity,
      req.body.type,
      req.body.note
    );
    res.status(200).json(product);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const getStockMovements = async (req, res) => {
  try {
    const movements = await adminService.getStockMovements(req.params.id, req.user.userId);
    res.status(200).json(movements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// ====================== REVIEW ORDER PAYMENT ======================
export const reviewOrderPaymentHandler = async (req, res) => {
  try {
    const order = await adminService.reviewOrderPayment(
      req.params.id,
      req.user.userId,
      req.body || {}
    );
    res.json(order);
  } catch (error) {
    console.error('[seller] payment review failed:', error.message);
    res.status(error.statusCode || 400).json({ message: error.message });
  }
};

// ====================== EMAIL A REPORT ======================
export const emailReportHandler = async (req, res) => {
  try {
    const result = await reportService.emailReport(req.user.userId, req.params.type);
    res.json(result);
  } catch (error) {
    console.error('[reports] email failed:', error.message);
    res.status(400).json({ error: error.message });
  }
};

export const mailStatusHandler = (req, res) => {
  res.json(reportService.mailStatus());
};
