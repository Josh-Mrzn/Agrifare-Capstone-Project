import * as notificationRepo from '../repositories/notificationRepository.js';

/**
 * Every notification goes through here, so the link it carries matches the
 * app its recipient actually uses.
 *
 * Sellers and Super Admins work on the web, so theirs are web routes. Buyers
 * use the phone app, which reads `/orders/<groupId>` and `/messages/<id>`.
 * Riders use the app or the web rider page; both read `/rider?order=<id>`.
 */
export const links = {
  sellerOrder: (orderId) => `/client?tab=orders&order=${orderId}`,
  sellerInventory: () => '/client?tab=inventory',
  sellerAccount: () => '/client?tab=account',
  buyerOrder: (groupId) => `/orders/${groupId}`,
  riderDelivery: (orderId) => `/rider?order=${orderId}`,
  approvals: () => '/superadmin?tab=approvals',
  messages: (role, conversationId) => {
    if (role === 'buyer') return `/messages/${conversationId}`;
    if (role === 'rider') return `/rider?conversation=${conversationId}`;
    if (role === 'superadmin') return `/superadmin?tab=messages&conversation=${conversationId}`;
    return `/client?tab=messages&conversation=${conversationId}`;
  },
};

/**
 * Sends one notification. Never throws: a notification that could not be
 * written must not undo the order change it was announcing.
 */
export async function notify({ userId, type = 'ORDER', title, body = '', link = '' }) {
  if (userId == null) return null;
  try {
    return await notificationRepo.createNotification({ userId, type, title, body, link });
  } catch (err) {
    console.error('[notify] could not write a notification:', err.message);
    return null;
  }
}
