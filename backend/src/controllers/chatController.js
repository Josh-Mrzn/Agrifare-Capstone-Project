import { sendMessageByUserId, fetchMessagesByConversationId, fetchUserConversationsByMongoId } from '../services/chatService.js';
import User from '../models/User.js';

const sendChatMessage = async (req, res) => {
  try {
    const { receiverUserId, text, productId, orderRef } = req.body;
    const senderUserId = req.user.userId;
    const mediaUrl = req.file ? `/uploads/media/${req.file.filename}` : undefined;

    if (!receiverUserId || (!text && !mediaUrl && !productId)) {
      return res.status(400).json({ message: 'Receiver numeric userId and either text, media or a product are required.' });
    }

    const message = await sendMessageByUserId(senderUserId, receiverUserId, text, mediaUrl, { productId, orderRef });
    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getConversationMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const messages = await fetchMessagesByConversationId(conversationId, req.user.userId);
    res.status(200).json(messages);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getUserConversationsList = async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const conversations = await fetchUserConversationsByMongoId(user._id);
    res.status(200).json(conversations);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export { sendChatMessage, getConversationMessages, getUserConversationsList };