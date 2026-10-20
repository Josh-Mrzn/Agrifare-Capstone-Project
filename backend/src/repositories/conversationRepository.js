import { Conversation } from '../models/Chat.js';

const findConversation = async (participantIds, orderRef = '') => {
  // Use $all to ensure both specific MongoDB _ids are present. Threads from
  // before orderRef existed have no such field and count as general ones.
  return await Conversation.findOne({
    participants: { $all: participantIds, $size: participantIds.length },
    orderRef: orderRef ? orderRef : { $in: ['', null] },
  }).populate('participants', 'name email role userId avatarUrl');
};

const createConversation = async (participantIds, { orderRef = '', orderNumber = '' } = {}) => {
  const newConversation = new Conversation({ participants: participantIds, orderRef, orderNumber });
  return await newConversation.save();
};

const updateLastMessage = async (conversationId, messageId) => {
  return await Conversation.findByIdAndUpdate(
    conversationId, 
    { lastMessage: messageId }, 
    { new: true }
  );
};

const findConversationById = async (conversationId) => {
  return await Conversation.findById(conversationId);
};

const getUserConversations = async (mongoUserId) => {
  // Use the MongoDB _id here, as the Conversation schema stores ObjectIds
  return await Conversation.find({ participants: mongoUserId })
    // avatarUrl so the inbox can draw faces instead of initials.
    .populate('participants', 'name email role userId avatarUrl')
    // The last message's sender too: an inbox row reads "You: ..." when the
    // ball is in the other person's court, and that needs more than an id.
    .populate({
      path: 'lastMessage',
      populate: [
        { path: 'sender', select: 'userId' },
        // So a shared listing reads as its name rather than as an empty line.
        { path: 'product', select: 'name' },
      ],
    })
    .sort({ updatedAt: -1 });
};

export { findConversation, createConversation, updateLastMessage, getUserConversations, findConversationById };