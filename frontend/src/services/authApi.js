import axios from 'axios';
import { clearSession } from '../utils/auth';

// Without VITE_API_URL, talk to port 8080 on whatever host served the page:
// localhost on the laptop, the laptop's LAN IP when opened from a phone (for
// example an activation link). A fixed "localhost" there is the phone itself.
const BASE_URL = import.meta.env.VITE_API_URL
  || `http://${window.location.hostname || 'localhost'}:8080/api`;
export const API_ORIGIN = BASE_URL.replace(/\/api\/?$/, '');

const API = axios.create({
  baseURL: BASE_URL,
  withCredentials: true
});

API.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * A Super Admin can suspend an account while its owner is signed in. The next
 * request after that is refused, and wherever it came from, the portal ends the
 * session and says why on the login page - rather than leaving a dashboard up
 * that fails one panel at a time.
 */
API.interceptors.response.use(
  (response) => response,
  (err) => {
    const suspended = err?.response?.data?.code === 'ACCOUNT_SUSPENDED';
    if (suspended && sessionStorage.getItem('token')) {
      clearSession();
      window.location.replace('/login?suspended=1');
    }
    return Promise.reject(err);
  },
);

/**
 * Axios only fills `err.response` when the server actually answered. Without this,
 * a stopped backend or a CORS rejection collapsed into a bare "Login failed".
 */
export function getErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  const serverMessage = err?.response?.data?.message;
  if (serverMessage) return serverMessage;

  if (err?.response) {
    return `${fallback} (server responded ${err.response.status} ${err.response.statusText || ''})`.trim();
  }

  if (err?.code === 'ECONNABORTED') {
    return 'The server took too long to respond. Please try again.';
  }

  if (err?.request) {
    return `Cannot reach the AgriFair server at ${API_ORIGIN}. Make sure the backend is running (cd backend && npm run dev).`;
  }

  return err?.message || fallback;
}

export const registerUser = (data) => API.post('/auth/register', data);
export const loginUser = (data) => API.post('/auth/login', data);
export const logoutUser = () => API.post('/auth/logout');
export const resendVerificationEmail = (email) =>
  API.post('/auth/resend-verification', { email });

// Password reset: email a 6-digit code, trade the code for a short-lived
// reset token, then set the new password with that token.
export const requestPasswordReset = (email) =>
  API.post('/auth/forgot-password', { email });
export const verifyResetCode = (email, code) =>
  API.post('/auth/verify-reset-otp', { email, code });
export const resetPassword = (resetToken, newPassword) =>
  API.post('/auth/reset-password', { resetToken, newPassword });

export default API;
