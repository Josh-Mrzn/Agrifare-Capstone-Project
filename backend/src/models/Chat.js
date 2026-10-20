import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  /**
   * The order a thread is about, when it is about one. A rider and a buyer
   * only ever talk about a delivery, so their thread is tied to it (the
   * order's groupId) and closes to new messages once that delivery is done.
   * Empty for the ordinary buyer-seller thread.
   */
  orderRef: { type: String, default: '' },
  orderNumber: { type: String, default: '' },
}, { timestamps: true });

// Ensure a conversation is unique between two users
conversationSchema.index({ participants: 1 });

/**
 * The three things a message can be.
 *
 * `text` is somebody typing. `system` is the order itself speaking - placed,
 * confirmed, shipped - written into the same thread so the conversation and
 * the order stop being two separate stories the buyer has to reconcile.
 * `product` is a listing passed across, so "meron pa po ba nito?" points at
 * something both sides can see.
 */
export const MESSAGE_KINDS = ['text', 'system', 'product'];

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String },
  mediaUrl: { type: String },
  kind: { type: String, enum: MESSAGE_KINDS, default: 'text' },
  /** Set only on a `product` message: the listing being pointed at. */
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  /**
   * A system message is nobody's turn to reply, so it never counts as unread -
   * an order moving to "shipped" must not put a red badge on the seller's
   * inbox as though they had been asked something.
   */
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

export const Conversation = mongoose.model('Conversation', conversationSchema);
export const Message = mongoose.model('Message', messageSchema);
