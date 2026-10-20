import mongoose from 'mongoose';

/**
 * One checkout attempt, keyed by a value the app generates once per press of
 * "Place order". A retry after a dropped connection, or a second tap, sends
 * the same key and gets the first attempt's result back instead of a second
 * set of orders. Kept for a day, long past any retry.
 */
const checkoutKeySchema = new mongoose.Schema({
  buyerUserId: { type: Number, required: true },
  key: { type: String, required: true },
  status: { type: String, enum: ['processing', 'done'], default: 'processing' },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});

checkoutKeySchema.index({ buyerUserId: 1, key: 1 }, { unique: true });

export default mongoose.model('CheckoutKey', checkoutKeySchema);
