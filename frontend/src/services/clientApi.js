import API from './authApi';

function toProductFormData(data) {
  const fd = new FormData();
  ['name', 'variety', 'description', 'price', 'stock', 'lowStockThreshold', 'status'].forEach((key) => {
    if (data[key] !== undefined) fd.append(key, data[key]);
  });
  if (data.weightTiers !== undefined) fd.append('weightTiers', JSON.stringify(data.weightTiers));
  if (data.existingImages !== undefined) fd.append('existingImages', JSON.stringify(data.existingImages));
  (data.newImageFiles || []).forEach((file) => fd.append('images', file));
  return fd;
}

export const fetchMyProducts = () => API.get('/admin/products');
export const createProduct = (data) =>
  API.post('/admin/products', toProductFormData(data), { headers: { 'Content-Type': 'multipart/form-data' } });
export const updateProduct = (id, data) =>
  API.put(`/admin/products/${id}`, toProductFormData(data), { headers: { 'Content-Type': 'multipart/form-data' } });
export const removeProduct = (id) => API.delete(`/admin/products/${id}`);
export const duplicateProduct = (id) => API.post(`/admin/products/${id}/duplicate`);
export const fetchMyOrders = () => API.get('/admin/orders');
export const recordSale = (data) => API.post('/admin/orders', data);
export const fetchMyOrderAnalytics = () => API.get('/admin/orders/analytics');
export const fetchMyOrderBreakdown = () => API.get('/admin/orders/breakdown');
export const updateOrderStatus = (id, status, reason) => API.put(`/admin/orders/${id}/status`, { status, reason });

export const fetchInventorySummary = () => API.get('/admin/inventory');
export const restockProduct = (id, quantity, note) =>
  API.put(`/admin/inventory/${id}/restock`, { quantity, note });
export const adjustStock = (id, quantity, type, note) =>
  API.put(`/admin/inventory/${id}/adjust`, { quantity, type, note });
export const fetchStockMovements = (id) => API.get(`/admin/inventory/${id}/movements`);

export const reviewOrderPayment = (id, data) => API.put(`/admin/orders/${id}/payment`, data);
export const emailReport = (type) => API.post(`/admin/reports/${type}/email`);
export const fetchMailStatus = () => API.get('/admin/reports/mail-status');

/** An outside courier (LBC, J&T, Lalamove) with its tracking number. */
export const setOrderCourier = (id, data) => API.put(`/admin/orders/${id}/courier`, data);

/** The seller's own photo at the door, for an order their courier carried. */
export const uploadSellerDeliveryProof = (id, file, note) => {
  const fd = new FormData();
  fd.append('proof', file);
  if (note) fd.append('note', note);
  return API.post(`/admin/orders/${id}/delivered`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
