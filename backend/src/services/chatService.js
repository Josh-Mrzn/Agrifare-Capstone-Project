import { findConversation, createConversation, updateLastMessage, getUserConversations, findConversationById } from '../repositories/conversationRepository.js';
import { createMessage, getMessagesByConversationId, PRODUCT_CARD_FIELDS } from '../repositories/messageRepository.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import { Message } from '../models/Chat.js';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import { notify, links } from './notify.js';

/** Order statuses during which a rider and the buyer may talk. */
const DELIVERY_OPEN = ['confirmed', 'processing', 'shipped', 'delivered'];

/**
 * Who may message whom.
 *
 *   buyer  <-> seller        about anything (a shop and its customers)
 *   seller <-> their rider   only riders the seller employs
 *   rider  <-> buyer         only about a delivery assigned to that rider,
 *                            in a thread tied to that order
 *   Super Admin <-> anyone   support
 *
 * Everything else - buyer to buyer, shop to shop, a rider to another shop -
 * is refused, so the chat cannot be used to reach people with no business
 * together. Returns the order the thread is about, when there is one.
 */
export async function chatPermission(sender, receiver, { orderRef = '' } = {}) {
  if (sender.userId === receiver.userId) throw new Error('You cannot message yourself.');
  if (receiver.status !== 'active' && receiver.role !== 'superadmin') {
    throw new Error('This account is not available for messages.');
  }
  if (sender.role === 'seller' && sender.status !== 'active' && receiver.role !== 'superadmin') {
    throw new Error('Your shop can message customers once it is approved.');
  }

  const roles = [sender.role, receiver.role].sort().join('+');
  if (sender.role === 'superadmin' || receiver.role === 'superadmin') return null;
  if (roles === 'buyer+seller') return null;

  if (roles === 'rider+seller') {
    const rider = sender.role === 'rider' ? sender : receiver;
    const seller = sender.role === 'seller' ? sender : receiver;
    if (rider.employedBy !== seller.userId) throw new Error('You can only message delivery people who work for you.');
    return null;
  }

  if (roles === 'buyer+rider') {
    const rider = sender.role === 'rider' ? sender : receiver;
    const buyer = sender.role === 'buyer' ? sender : receiver;
    if (!orderRef) throw new Error('Messages with a delivery person are sent from the order.');
    const order = await Order.findOne({
      $or: [{ groupId: orderRef }, ...(mongoose.isValidObjectId(orderRef) ? [{ _id: orderRef }] : [])],
      buyerUserId: buyer.userId,
      'delivery.riderUserId': rider.userId,
      status: { $in: DELIVERY_OPEN },
    }).select('orderNumber groupId');
    if (!order) throw new Error('This delivery is finished or is not assigned to this delivery person.');
    return order;
  }

  throw new Error('Messages are only for buyers and shops, shops and their delivery people, and a delivery in progress.');
}

const validateParticipantsByUserId = async (senderUserId, receiverUserId, options = {}) => {
  const sender = await User.findOne({ userId: Number(senderUserId) });
  const receiver = await User.findOne({ userId: Number(receiverUserId) });

  if (!sender || !receiver) {
    throw new Error('That person could not be found.');
  }
  const order = await chatPermission(sender, receiver, options);
  return { sender, receiver, order };
};

const getOrCreateConversationByUserId = async (senderUserId, receiverUserId, options = {}) => {
  const { sender, receiver, order } = await validateParticipantsByUserId(senderUserId, receiverUserId, options);

  // Use MongoDB _ids for the conversation relationships
  const participantIds = [sender._id, receiver._id].sort();
  const orderRef = order ? (order.groupId || String(order._id)) : '';
  let conversation = await findConversation(participantIds, orderRef);

  if (!conversation) {
    conversation = await createConversation(participantIds, { orderRef, orderNumber: order?.orderNumber || '' });
  }
  return { conversation, sender, receiver };
};

/** What a notification says a message was, when the message is not words. */
const summarise = (text, kind, productName) => {
  if (text) return text.slice(0, 120);
  if (kind === 'product') return `Shared ${productName || 'a product'}`;
  return 'Sent an image';
};

// 3. Main Export for Sockets
export const sendMessageByUserId = async (senderUserId, receiverUserId, text, mediaUrl, options = {}) => {
  const { conversation, sender, receiver } = await getOrCreateConversationByUserId(
    senderUserId,
    receiverUserId,
    { orderRef: options.orderRef || '' },
  );

  // A product message points at a real listing or it is not one. Checking here
  // rather than trusting the id keeps a broken card out of the thread, where
  // it would sit forever with nothing behind it.
  let product = null;
  if (options.productId) {
    product = await Product.findById(options.productId).select('name');
    if (!product) throw new Error('That product no longer exists.');
  }

  const kind = product ? 'product' : 'text';

  // Save using MongoDB _ids
  const message = await createMessage(
    conversation._id,
    sender._id,
    receiver._id,
    text,
    mediaUrl,
    { kind, ...(product ? { product: product._id } : {}) },
  );
  await updateLastMessage(conversation._id, message._id);

  await notify({
    userId: receiver.userId,
    type: 'MESSAGE',
    title: `New message from ${sender.name}`,
    body: summarise(text, kind, product?.name),
    link: links.messages(receiver.role, conversation._id),
  });

  return await message.populate([
    { path: 'sender', select: 'name email role userId' },
    { path: 'receiver', select: 'name email role userId' },
    { path: 'product', select: PRODUCT_CARD_FIELDS },
  ]);
};

/**
 * Writes an order's own words into the buyer and seller's thread.
 *
 * Placed, confirmed, shipped - the buyer already asks the seller about these
 * in chat, so the answer belongs there rather than only in a notification that
 * scrolls away. It is deliberately quiet: no notification of its own (the
 * order flow raises those already) and never unread, because nobody is being
 * asked anything.
 *
 * Failure never propagates. An order must not fail to be placed because a
 * courtesy message could not be written.
 */
export const postOrderSystemMessage = async ({ sellerUserId, buyerUserId, text }) => {
  try {
    const { conversation, sender, receiver } = await getOrCreateConversationByUserId(
      sellerUserId,
      buyerUserId,
    );

    const message = await createMessage(
      conversation._id,
      sender._id,
      receiver._id,
      text,
      undefined,
      { kind: 'system', isRead: true },
    );
    await updateLastMessage(conversation._id, message._id);
    return message;
  } catch (err) {
    console.error('[chat] could not post the order update:', err.message);
    return null;
  }
};

export const fetchMessagesByConversationId = async (conversationId, requesterUserId) => {
  const conversation = await findConversationById(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found.');
  }

  const requester = await User.findOne({ userId: requesterUserId });
  const isParticipant = requester && conversation.participants.some((p) => p.equals(requester._id));
  if (!isParticipant) {
    throw new Error('Not authorized to view this conversation.');
  }

  const messages = await getMessagesByConversationId(conversationId);

  // Opening a conversation is reading it. Without this the unread badge never
  // clears and stops meaning anything.
  await Message.updateMany(
    { conversationId, receiver: requester._id, isRead: false, kind: { $ne: 'system' } },
    { isRead: true },
  );

  return messages;
};

export const fetchUserConversationsByMongoId = async (mongoUserId) => {
  const conversations = await getUserConversations(mongoUserId);

  // One grouped query for the whole list rather than a count per row - a
  // twenty-conversation inbox would otherwise be twenty-one round trips.
  const unreadRows = await Message.aggregate([
    // System messages are excluded: an order moving to "shipped" is news, not
    // a question, and must not put a red badge on anybody's inbox.
    { $match: { receiver: mongoUserId, isRead: false, kind: { $ne: 'system' } } },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);

  const unreadByConversation = new Map(
    unreadRows.map((row) => [String(row._id), row.count]),
  );

  return conversations.map((conversation) => ({
    ...conversation.toObject(),
    unreadCount: unreadByConversation.get(String(conversation._id)) || 0,
  }));
};

// Exporting all together
export { 
  validateParticipantsByUserId, 
  getOrCreateConversationByUserId 
};