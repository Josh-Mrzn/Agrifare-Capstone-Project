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
export const updateOrderStatus = (id, status, reason) => API.put(`/admin/orders/${id}/status`, { status, reason });

export const fetchInventorySummary = () => API.get('/admin/inventory');
export const restockProduct = (id, quantity, note) =>
  API.put(`/admin/inventory/${id}/restock`, { quantity, note });
export const adjustStock = (id, quantity, type, note) =>
  API.put(`/admin/inventory/${id}/adjust`, { quantity, type, note });
export const fetchStockMovements = (id) => API.get(`/admin/inventory/${id}/movements`);

export const reviewOrderPayment = (id, data) => API.put(`/admin/orders/${id}/payment`, data);
// The same period and filters as the screen, so the emailed PDF matches it.
export const emailReport = (type, params = {}) => API.post(`/admin/reports/${type}/email`, params);
export const fetchMailStatus = () => API.get('/admin/reports/mail-status');

/** An outside courier (LBC, J&T, Lalamove) with its tracking number. */
export const setOrderCourier = (id, data) => API.put(`/admin/orders/${id}/courier`, data);

/** The seller's own photo at the door, for an order their courier carried. */
export const uploadSellerDeliveryProof = (id, file, note, cashCollected) => {
  const fd = new FormData();
  fd.append('proof', file);
  if (note) fd.append('note', note);
  if (cashCollected !== undefined && cashCollected !== '') fd.append('cashCollected', cashCollected);
  return API.post(`/admin/orders/${id}/delivered`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

/** The seller's answer to a buyer's cancellation request. */
export const decideCancellation = (id, approve, note) => API.put(`/admin/orders/${id}/cancellation`, { approve, note });
/** Money given back on a cancelled, paid order. */
export const recordRefund = (id, data) => API.put(`/admin/orders/${id}/refund`, data);
/** Corrects a cash-on-delivery amount that did not match, with the reason. */
export const correctCod = (id, amount, note) => API.put(`/admin/orders/${id}/cod`, { amount, note });
/** Closes a problem the buyer reported. */
export const resolveProblem = (id, note) => API.put(`/admin/orders/${id}/problem`, { note });
