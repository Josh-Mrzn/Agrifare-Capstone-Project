import API from './authApi';

export const fetchAllUsers = () => API.get('/superadmin/users');
export const suspendUser = (id) => API.put(`/superadmin/users/${id}/suspend`);
export const activateUser = (id) => API.put(`/superadmin/users/${id}/activate`);
export const deleteUserAccount = (id) => API.delete(`/superadmin/users/${id}`);
export const fetchPendingApprovals = () => API.get('/superadmin/approvals/pending');
export const approveSeller = (id) => API.put(`/superadmin/approvals/${id}/approve`);
/** A seller application turned down, with the reason they will be shown. */
export const rejectSeller = (id, reason) => API.put(`/superadmin/approvals/${id}/reject`, { reason });
export const createUserAccount = (data) => API.post('/superadmin/users', data);
export const updateUserAccount = (id, data) => API.put(`/superadmin/users/${id}`, data);
export const fetchAuditLogs = (params) => API.get('/superadmin/audit-logs', { params });

// --- Seller credential review ---
// Every seller who has submitted a payout account or a document, decided or
// not. An approval that disappears cannot be checked later, or taken back.
export const fetchSellerCredentials = () => API.get('/superadmin/credentials');

/**
 * Approves or rejects one credential.
 *
 * `body` is { kind: 'payout' | 'document', docType?, approve, reason? }. A
 * rejection needs a reason - the seller has to know what to fix.
 */
export const reviewCredential = (id, body) =>
  API.put(`/superadmin/users/${id}/credentials`, body);
