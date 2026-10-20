import Order from '../models/Order.js';
import Product from '../models/Product.js';

export const createOrder = async (data) => {
  return await Order.create(data);
};

export const setOrderNumber = async (id, orderNumber) => {
  return await Order.findByIdAndUpdate(id, { orderNumber }, { new: true });
};

export const findOrdersBySeller = async (sellerId, { status } = {}) => {
  const filter = { sellerId };
  if (status) filter.status = status;
  return await Order.find(filter).sort({ orderDate: -1 });
};

export const findOrderById = async (id) => {
  return await Order.findById(id);
};

export const hasActiveOrdersForProduct = async (productId) => {
  const count = await Order.countDocuments({
    productId,
    status: { $nin: ['completed', 'cancelled', 'refunded'] },
  });
  return count > 0;
};

export const getDistinctCustomersForSeller = async (sellerId) => {
  return await Order.aggregate([
    { $match: { sellerId, status: 'completed' } },
    {
      $group: {
        _id: '$customerName',
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: '$total' },
        lastOrderDate: { $max: '$orderDate' },
      },
    },
    { $sort: { lastOrderDate: -1 } },
  ]);
};

