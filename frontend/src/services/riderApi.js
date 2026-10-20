import API from './authApi';

/**
 * Delivery people.
 *
 * The seller's half adds them and says who carries what; the rider's half is
 * their own queue. A rider sees only orders assigned to them — working for the
 * seller is not enough on its own to open one.
 */

// ---- The seller's side ----
export const fetchRiders = () => API.get('/riders');

/** name + email is the whole form. The rider picks their own password later. */
export const addRider = (data) => API.post('/riders', data);

export const resendRiderLink = (riderUserId) =>
  API.post(`/riders/${riderUserId}/resend-link`);

/** Toggles between active and suspended — never deletes. Their name is on
 *  delivered orders, and removing the account would orphan those. */
export const toggleRiderSuspension = (riderUserId) =>
  API.put(`/riders/${riderUserId}/suspend`);

/** Pass null to take the rider off the order again. */
export const assignRider = (orderId, riderUserId) =>
  API.put(`/riders/assign/${orderId}`, { riderUserId });

// ---- The rider's side ----
export const fetchMyDeliveries = (scope = 'active') => API.get('/riders/me/deliveries', { params: { scope } });
export const acceptDelivery = (orderId) => API.post(`/riders/me/deliveries/${orderId}/accept`);
export const declineDelivery = (orderId, reason) => API.post(`/riders/me/deliveries/${orderId}/decline`, { reason });
/** Picked up and on the road. */
export const startDelivery = (orderId) => API.post(`/riders/me/deliveries/${orderId}/start`);
/** Safe to send again: a retry after it went through returns the delivered order. */
export const markDelivered = (orderId, { cashCollected, note } = {}) =>
  API.post(`/riders/me/deliveries/${orderId}/delivered`, { cashCollected, note });

export const pushMyLocation = (orderId, { lat, lng, etaMinutes }) =>
  API.put(`/riders/me/deliveries/${orderId}/location`, { lat, lng, etaMinutes });

/** The photo at the door. Kept on the order; "Mark as delivered" is a separate step. */
export const uploadDeliveryProof = (orderId, file, note) => {
  const fd = new FormData();
  fd.append('proof', file);
  if (note) fd.append('note', note);

  return API.post(`/riders/me/deliveries/${orderId}/proof`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

// ---- Finishing an account somebody else created, from the emailed link ----

/** valid | expired | active | suspended | invalid — one screen for each. */
export const fetchActivationStatus = (token) =>
  API.post('/auth/activate/status', { token });

export const activateAccount = ({ token, password }) =>
  API.post('/auth/activate', { token, password });

/**
 * A new link from an expired one. Only the token is sent: the new link goes to
 * the address already on the account, never to one typed here.
 */
export const resendActivationLink = (token) =>
  API.post('/auth/activate/resend', { token });
