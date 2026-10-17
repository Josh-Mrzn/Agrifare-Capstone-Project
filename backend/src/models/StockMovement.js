import mongoose from 'mongoose';

const stockMovementSchema = new mongoose.Schema({
  sellerId: {
    type: Number,
    required: true,
    index: true,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true,
  },
  productName: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['RESTOCK', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE'],
    required: true,
  },
  quantity: {
    // Signed delta in kg: positive adds to stock, negative removes.
    type: Number,
    required: true,
  },
  resultingStock: {
    type: Number,
    required: true,
  },
  note: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

stockMovementSchema.index({ productId: 1, createdAt: -1 });
// Inventory analytics read one seller's movements over a date range.
stockMovementSchema.index({ sellerId: 1, createdAt: -1 });

const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
export default StockMovement;
