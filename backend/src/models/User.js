import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * "Reyca De Alba" and "reyca  de alba" are the same person claiming the same
 * name, so both collapse to one key. Comparing the raw field would let either
 * spelling slip past a check on the other.
 */
export function toNameKey(name) {
  return typeof name === 'string'
    ? name.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

/** What a seller charges to deliver when they have not set their own fee. */
export const DEFAULT_DELIVERY_FEE = 80;

/** A deliberately loose shape check: something@something.tld, no spaces. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  /**
   * Derived from `name` on every save; never set by hand. Kept as its own
   * field so the uniqueness check is an indexed lookup rather than a regex
   * scan over every user.
   */
  nameKey: {
    type: String,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: false,
    minlength: 6,
    select: false
  },
  /**
   * Left over from Firebase Auth, which is no longer used. Only
   * scripts/syncFromFirebase.js reads it; nothing writes it any more.
   */
  firebaseUid: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  /**
   * `rider` is created by a seller, not by signing up.
   *
   * They deliver for that seller and see nothing else: only the orders
   * assigned to them, and only while assigned. `employedBy` below is what ties
   * them to the seller who took them on.
   */
  role: {
    type: String,
    enum: ['superadmin', 'seller', 'buyer', 'rider'],
    default: 'buyer'
  },

  /**
   * For a rider: the seller who added them.
   *
   * Null for everybody else. A rider belongs to one seller - a delivery person
   * hired by one shop has no business seeing another shop's orders.
   */
  employedBy: { type: Number, default: null },

  /**
   * Whether this account has a password its owner chose.
   *
   * A rider's account is created by their seller with a random one they are
   * never told, so it stays false until they activate the account from the
   * emailed link. Sign-in is refused until then - otherwise an account exists
   * that nobody can get into and nobody can tell why.
   */
  passwordSet: { type: Boolean, default: true },

  /**
   * When the password was last replaced by a reset or by a Super Admin.
   * Sign-in tokens issued before this are refused, so whoever was signed in
   * with the old password is signed out by the reset.
   */
  passwordChangedAt: { type: Date, default: null },

  /**
   * The link a rider activates their account from.
   *
   * Only a SHA-256 of the token is kept, so a copy of the database cannot be
   * turned into working links. The hash outlives its expiry on purpose: an
   * expired link still has to say whose it was, so the page can offer to send
   * a fresh one to the address on the account. A new link overwrites it, which
   * is what retires the old one.
   */
  activationTokenHash: { type: String, index: true, sparse: true, select: false },
  activationTokenExpires: { type: Date, default: null },
  activationSentAt: { type: Date, default: null },
  status: {
    type: String,
    // 'rejected': a seller application a Super Admin turned down.
    // 'deactivated': closed by a Super Admin in place of deleting it, so the
    // orders, reviews and audit entries that name this account still can.
    enum: ['active', 'suspended', 'pending', 'rejected', 'deactivated'],
    default: function () {
      return this.role === 'seller' ? 'pending' : 'active';
    }
  },
  /** Why a seller application was rejected, shown to them at sign-in. */
  statusReason: { type: String, trim: true, default: '' },
  /**
   * A seller's application. A new seller signs in to a limited account,
   * fills in their shop and uploads a permit, then submits it; only a
   * submitted application with a verified permit can be approved. Sellers
   * approved before this existed have no submittedAt and stay active.
   */
  application: {
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Number, default: null },
  },
  deactivatedAt: { type: Date, default: null },
  userId: { type: Number, unique: true },
  lastLogin: {
    type: Date
  },
  contact: { type: String, trim: true, default: '' },
  bio: { type: String, trim: true, default: '' },
  avatarUrl: { type: String, default: '' },
  /**
   * Not every rice seller farms. A trader or retailer has a business but no
   * land, so the farm fields below are only meaningful for `farmer`.
   */
  sellerType: {
    type: String,
    enum: ['farmer', 'trader', 'retailer', 'cooperative', ''],
    default: '',
  },
  sellerProfile: {
    businessName: { type: String, trim: true, default: '' },
    businessAddress: { type: String, trim: true, default: '' },
    // Farmer-only
    farmName: { type: String, trim: true, default: '' },
    farmLocation: { type: String, trim: true, default: '' },
    farmSize: { type: String, trim: true, default: '' },
    farmPhotos: { type: [String], default: [] },
  },

  /**
   * Compliance documents. The image itself is never shown after review — the
   * app displays a verified badge instead, so there is nothing on screen to
   * screenshot or steal.
   */
  documents: [{
    type: {
      type: String,
      enum: ['BIR', 'DTI', 'SEC', 'MAYORS_PERMIT', 'BARANGAY', 'ORGANIC_CERT', 'OTHER'],
      required: true,
    },
    file: { type: String, required: true },
    label: { type: String, trim: true, default: '' },
    referenceNo: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String, trim: true, default: '' },
    uploadedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date },
    reviewedBy: { type: Number },
  }],
  /**
   * Where this seller gets paid. The buyer scans the QR in their own GCash app
   * and the seller confirms the money arrived - AgriFair never touches the funds
   * and never stores a payment credential, only a picture of a QR code.
   */
  payout: {
    method: { type: String, enum: ['gcash', 'bank', ''], default: '' },
    accountName: { type: String, trim: true, default: '' },
    accountNumber: { type: String, trim: true, default: '' },
    qrImage: { type: String, default: '' },
    status: {
      type: String,
      enum: ['unset', 'pending', 'verified', 'rejected'],
      default: 'unset',
    },
    rejectionReason: { type: String, trim: true, default: '' },
    submittedAt: { type: Date },
    verifiedAt: { type: Date },
    verifiedBy: { type: Number },
  },
  pickupAddress: { type: String, trim: true, default: '' },

  /**
   * Where the rice is actually collected, as a point on the map.
   *
   * The written pickup address is what a person reads; these are what a rider
   * navigates to. Kept null until the seller sets them, because a guessed
   * coordinate sends somebody to the wrong barangay with more confidence than
   * no coordinate at all.
   */
  pickupLat: { type: Number, default: null },
  pickupLng: { type: Number, default: null },

  /**
   * What this seller charges to deliver one order, in pesos. One flat fee per
   * seller per basket: sellers deliver locally and already quote one price.
   * Null until they set it, which means DEFAULT_DELIVERY_FEE.
   */
  deliveryFee: { type: Number, min: 0, default: null },

  /**
   * Where a buyer wants their rice delivered. A list rather than one field:
   * people order to a home and a workplace, and retyping the whole thing at
   * every checkout is how a wrong address gets entered.
   *
   * Exactly one carries isDefault - the service enforces that, since two
   * defaults means checkout has to guess.
   */
  addresses: [{
    label: { type: String, trim: true, default: 'Home' },
    fullName: { type: String, trim: true, required: true },
    contact: { type: String, trim: true, required: true },
    line: { type: String, trim: true, required: true },
    barangay: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, required: true },
    province: { type: String, trim: true, default: '' },

    /**
     * PSGC codes for the province and city. The names are what a rider reads;
     * these are what lets the picker reopen on the right lists when someone
     * edits a saved address, without matching on a name that may have been
     * typed before the lists existed.
     */
    provinceCode: { type: String, trim: true, default: '' },
    cityCode: { type: String, trim: true, default: '' },
    /**
     * The door itself, when the buyer has pinned it.
     *
     * Null is the normal state for an address that was typed rather than
     * pinned - and it stays null rather than being geocoded from the text,
     * because "white house po bahay namin" geocodes to somewhere confident
     * and wrong.
     */
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },

    /**
     * How good that point is.
     *
     * `exact` is the buyer standing at their own door and pinning it.
     * `approximate` is the barangay, looked up from the province, city and
     * barangay they chose - right part of the right town, not the door. The
     * difference is shown wherever the pin is, so nobody navigates to a
     * barangay centre believing it is a house.
     */
    precision: {
      type: String,
      enum: ['', 'exact', 'approximate'],
      default: '',
    },

    // "Green gate beside the sari-sari store" - what actually gets a rider
    // to the door.
    notes: { type: String, trim: true, default: '' },
    isDefault: { type: Boolean, default: false },
  }],
  deliveryOrigin: { type: String, trim: true, default: '' },
  notificationPrefs: {
    order: { type: Boolean, default: true },
    payment: { type: Boolean, default: true },
    message: { type: Boolean, default: true },
    stock: { type: Boolean, default: true },
    system: { type: Boolean, default: true },
  },
  theme: { type: String, enum: ['light', 'dark'], default: 'light' },
}, {
  timestamps: true
});

userSchema.pre('save', function () {
  if (this.isModified('name') || this.isNew) {
    this.nameKey = toNameKey(this.name);
  }
});

userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;
