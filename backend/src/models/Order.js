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
  /** Who moved it: seller, buyer, rider or system (the nightly job). */
  by: { type: String, default: '' },
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
   *   paid          - the money is in: the seller confirmed a GCash transfer,
   *                   PayMongo confirmed an online payment, or the rider
   *                   collected the exact cash due at the door
   *   rejected      - the seller checked and the payment was not there
   *   refund_due    - the order was cancelled after money moved; the seller
   *                   owes it back
   *   refunded      - the seller recorded the refund
   *
   * Which moves are allowed, and who may make them, is PAYMENT_TRANSITIONS in
   * services/orderRules.js. Order status and payment status are two ledgers;
   * that file is where they are made to agree.
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
    proofUploadedAt: { type: Date },
    deliveredAt: { type: Date },
    deliveryNote: { type: String, trim: true, default: '' },
    /** Who recorded the delivery: the rider's or the seller's userId. */
    deliveredBy: { type: Number, default: null },

    /**
     * The rider's answer to an assignment. 'assigned' waits for them;
     * 'declined' hands the order back to the seller to choose someone else.
     * An order can only go out for delivery with an accepted rider (or a
     * named courier).
     */
    assignmentStatus: { type: String, enum: ['', 'assigned', 'accepted', 'declined'], default: '' },
    acceptedAt: { type: Date },
    declinedAt: { type: Date },
    declineReason: { type: String, trim: true, default: '' },
    declinedBy: { type: Number, default: null },
  },

  /**
   * Cash on delivery, as the rider recorded it at the door. The payment is
   * marked paid only when the amount matches what was due; a short or missing
   * collection is kept here and left for the seller to resolve.
   */
  codCollection: {
    amount: { type: Number, default: null },
    collectedAt: { type: Date },
    riderUserId: { type: Number, default: null },
    note: { type: String, trim: true, default: '' },
  },

  /**
   * A buyer asking to call off an order after money moved (or while a
   * receipt is being checked). The seller approves or rejects it; until then
   * the order cannot be confirmed or completed.
   */
  cancellation: {
    status: { type: String, enum: ['none', 'requested', 'approved', 'rejected'], default: 'none' },
    reason: { type: String, trim: true, default: '' },
    requestedAt: { type: Date },
    decidedAt: { type: Date },
    decidedBy: { type: Number, default: null },
    decisionNote: { type: String, trim: true, default: '' },
  },

  /** The refund the seller recorded for a cancelled, paid order. */
  refund: {
    amount: { type: Number, default: null },
    reference: { type: String, trim: true, default: '' },
    recordedAt: { type: Date },
    recordedBy: { type: Number, default: null },
  },

  /**
   * A buyer's "something is wrong" on a delivered order. While open it
   * pauses automatic completion; the seller resolves it.
   */
  complaint: {
    status: { type: String, enum: ['none', 'open', 'resolved'], default: 'none' },
    reason: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    openedAt: { type: Date },
    resolvedAt: { type: Date },
    resolutionNote: { type: String, trim: true, default: '' },
  },

  paymentStatus: {
    type: String,
    enum: ['unpaid', 'proof_sent', 'paid', 'rejected', 'refund_due', 'refunded'],
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
      status: { type: String, enum: ['unpaid', 'proof_sent', 'paid', 'rejected', 'refund_due', 'refunded'], required: true },
      /** What happened: review, resubmit, paymongo, cod, correction, cancellation, refund. */
      kind: { type: String, default: '' },
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
// The rider's own delivery list.
orderSchema.index({ 'delivery.riderUserId': 1, status: 1 });
// The daily automatic-completion check.
orderSchema.index({ status: 1, 'delivery.deliveredAt': 1 });

const Order = mongoose.model('Order', orderSchema);
export default Order;
