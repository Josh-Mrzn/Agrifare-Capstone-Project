import API from './authApi';

function toProfileFormData(data) {
  const fd = new FormData();
  // pickupLat/pickupLng are the point a rider navigates to; pickupAddress is
  // the words a person reads. Both travel on the same form.
  [
    'name', 'contact', 'bio',
    'pickupAddress', 'pickupLat', 'pickupLng',
    'deliveryOrigin', 'deliveryFee',
  ].forEach((key) => {
    if (data[key] !== undefined) fd.append(key, data[key]);
  });
  if (data.payout !== undefined) fd.append('payout', JSON.stringify(data.payout));
  if (data.paymentQrFile) fd.append('paymentQr', data.paymentQrFile);
  if (data.documentFile) fd.append('document', data.documentFile);
  if (data.documentMeta !== undefined) fd.append('documentMeta', JSON.stringify(data.documentMeta));
  if (data.sellerType !== undefined) fd.append('sellerType', data.sellerType);
  if (data.sellerProfile !== undefined) fd.append('sellerProfile', JSON.stringify(data.sellerProfile));
  if (data.notificationPrefs !== undefined) fd.append('notificationPrefs', JSON.stringify(data.notificationPrefs));
  if (data.avatarFile) fd.append('avatar', data.avatarFile);
  (data.farmPhotoFiles || []).forEach((file) => fd.append('farmPhotos', file));
  return fd;
}

export const fetchMe = () => API.get('/user/me');
export const updateAccount = (data) =>
  API.put('/user/edit', toProfileFormData(data), { headers: { 'Content-Type': 'multipart/form-data' } });
export const changePassword = (currentPassword, newPassword) =>
  API.put('/user/reset-password', { currentPassword, newPassword });
export const fetchLoginHistory = () => API.get('/user/login-history');
