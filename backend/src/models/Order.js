import mongoose from 'mongoose';

/**
 * The kilograms one order line takes off the shelf.
 *
 * Stock is kept in kilograms and an order is counted in sacks, so every place
 * that moves stock has to go through here rather than reaching for `quantity`.
 */
export const stockUnits = (order) =>
  Number(order?.quantity || 0) * Number(order?.weightKg || 1);

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
];

const statusHistoryEntrySchema = new mongoose.Schema({
  status: { type: String, required: true },
  changedAt: { type: Date, default: Date.now },
  reason: { type: String, default: '' },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  sellerId: {
    type: Number, // seller's User.userId
    required: true,
    index: true,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  productName: {
    type: String,
    required: true,
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  /**
   * How many sacks - not kilograms.
   *
   * The pair below is the whole unit story: `quantity` counts sacks and
   * `weightKg` says how big one is, so the kilograms that leave the shelf are
   * the two multiplied. Reading `quantity` as kilograms is what made an order
   * for one 25 kg sack take a single kilo out of stock.
   */
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },

  /**
   * The size of one sack on this line: 1, 5, 25, 50 kg.
   *
   * Defaults to 1 so a manually typed order, and every order placed before
   * this field existed, still counts as plain kilograms.
   */
  weightKg: {
    type: Number,
    required: true,
    min: 1,
    default: 1,
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0,
  },
  deliveryFee: {
    type: Number,
    default: 0,
    min: 0,
  },
  total: {
    type: Number,
    required: true,
    min: 0,
  },
  paymentMethod: {
    type: String,
    // 'PayMongo' is the sandbox gateway demo (services/paymongoService.js).
    enum: ['Cash/COD', 'GCash', 'PayMongo'],
    default: 'Cash/COD',
  },
  customerName: {
    type: String,
    required: true,
    trim: true,
  },
  customerContact: {
    type: String,
    trim: true,
    default: '',
  },
  deliveryAddress: {
    type: String,
    trim: true,
    default: '',
  },
  buyerUserId: {
    type: Number,
    default: null,
  },
  /**
   * Payment tracking is separate from fulfilment: an order can be delivered but
   * unpaid, or paid but not yet shipped.
   *   unpaid        - nothing received yet (the COD default)
   *   proof_sent    - buyer uploaded a GCash screenshot, waiting on the seller
   *   paid          - the seller confirmed the money landed in their account
   *   rejected      - the seller checked and the payment was not there
   */
  /**
   * Live delivery tracking, used once the order is `shipped`. The courier's app
   * pushes a position; the buyer and the seller both read it. Coordinates are
   * kept only while the order is in transit and cleared on completion.
   */
  /**
   * The two fixed ends of the journey, taken at checkout.
   *
   * Snapshotted rather than looked up later: a buyer who edits or deletes the
   * address after ordering must not move an order that is already on the road.
   * `delivery` below is the part that moves; this is the part that does not.
   */
  route: {
    pickupLat: { type: Number, default: null },
    pickupLng: { type: Number, default: null },
    pickupAddress: { type: String, trim: true, default: '' },
    dropoffLat: { type: Number, default: null },
    dropoffLng: { type: Number, default: null },
    /** 'exact' when the buyer pinned their door, 'approximate' for a barangay. */
    dropoffPrecision: { type: String, enum: ['', 'exact', 'approximate'], default: '' },
  },

  delivery: {
    /**
     * The rider carrying this line, when the seller has assigned one.
     *
     * Assignment is what grants access: a rider may read and update only the
     * orders their number is on, and nothing else the seller can see.
     */
    riderUserId: { type: Number, default: null },
    assignedAt: { type: Date },

    courierName: { type: String, trim: true, default: '' },
    courierContact: { type: String, trim: true, default: '' },
    /**
     * The tracking or booking number when an outside courier (LBC, J&T, a
     * Lalamove driver) carries the order instead of the seller's own rider.
     * Required before such an order can be marked shipped, so a delivery
     * arranged over the phone still leaves something to look up.
     */
    courierReference: { type: String, trim: true, default: '' },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    updatedAt: { type: Date },
    etaMinutes: { type: Number, default: null },
    isLive: { type: Boolean, default: false },

    /**
     * The photo taken at the door, per order line.
     *
     * Per line and not per basket: two sacks from two sellers arrive on two
     * journeys, and "delivered" has to be provable for each of them
     * separately. Private, like a receipt - the buyer's doorway is on it.
     */
    proofOfDelivery: { type: String, default: '' },
    deliveredAt: { type: Date },
    deliveryNote: { type: String, trim: true, default: '' },
  },

  paymentStatus: {
    type: String,
    enum: ['unpaid', 'proof_sent', 'paid', 'rejected'],
    default: 'unpaid',
  },
  paymentProof: { type: String, default: '' },
  /** The PayMongo checkout session this order is paid through, if any. */
  paymongoCheckoutId: { type: String, default: '' },
  paymentReference: { type: String, trim: true, default: '' },
  paymentNote: { type: String, trim: true, default: '' },
  amountPaid: { type: Number, default: 0, min: 0 },
  paidAt: { type: Date },
  paymentReviewedAt: { type: Date },
  paymentReviewedBy: { type: Number, default: null },

  /**
   * Every time the seller looked at this payment and what they decided. The
   * GCash money never passes through AgriFair, so this trail is the only
   * record of who said it arrived, how much, and against which reference.
   */
  paymentHistory: {
    type: [{
      _id: false,
      status: { type: String, enum: ['paid', 'rejected'], required: true },
      amount: { type: Number, default: 0 },
      reference: { type: String, default: '' },
      note: { type: String, default: '' },
      reviewedBy: { type: Number },
      at: { type: Date, default: Date.now },
    }],
    default: [],
  },

  status: {
    type: String,
    enum: ORDER_STATUSES,
    default: 'pending',
  },
  statusReason: {
    type: String,
    trim: true,
    default: '',
  },
  statusHistory: {
    type: [statusHistoryEntrySchema],
    default: [],
  },
  stockDeducted: {
    type: Boolean,
    default: false,
  },
  source: {
    type: String,
    enum: ['manual', 'storefront'],
    default: 'manual',
  },
  orderNumber: {
    type: String,
  },
  /**
   * A cart checkout produces one Order row per line item, because every seller
   * fulfils and gets paid separately. The rows share a groupId so the buyer
   * still sees a single order with several items on it.
   */
  groupId: {
    type: String,
    index: true,
    default: null,
  },
  orderDate: {
    type: Date,
    default: Date.now,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

orderSchema.index({ sellerId: 1, orderDate: -1 });
orderSchema.index({ status: 1 });
// Marketplace analytics read a date range across all sellers.
orderSchema.index({ orderDate: -1 });
orderSchema.index({ paymentReference: 1 }, { sparse: true });
orderSchema.index({ paymongoCheckoutId: 1 }, { sparse: true });

const Order = mongoose.model('Order', orderSchema);
export default Order;
