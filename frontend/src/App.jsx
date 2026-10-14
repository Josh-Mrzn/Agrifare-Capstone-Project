import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import LandingPage from './pages/LandingPage.jsx';
import LoginPage from './pages/landing/LoginPage.jsx';
import RegisterPage from './pages/landing/RegisterPage.jsx';
import ForgotPasswordPage from './pages/landing/ForgotPasswordPage.jsx';

// Signed-in areas load on demand, so the landing page does not carry the
// portals (and the map library) for visitors who never sign in.
const AdminPage = lazy(() => import('./pages/admin/AdminPage.jsx'));
const SuperAdminPage = lazy(() => import('./pages/superadmin/SuperAdminPage.jsx'));
const RiderPage = lazy(() => import('./pages/rider/RiderPage.jsx'));
const ActivatePage = lazy(() => import('./pages/rider/ActivatePage.jsx'));
const PaymentReturnPage = lazy(() => import('./pages/PaymentReturnPage.jsx'));
import { getHomePath, getSessionUser, getToken } from './utils/auth.js';

const getAuth = () => ({ token: getToken(), user: getSessionUser() });

function ProtectedRoute({ children, role }) {
  const { token, user } = getAuth();

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (role && user.role !== role) {
    return <Navigate to={getHomePath(user.role)} replace />;
  }

  return children;
}

function PublicOnlyRoute({ children }) {
  const { token, user } = getAuth();

  if (token && user) {
    return <Navigate to={getHomePath(user.role)} replace />;
  }

  return children;
}

function HomeRedirect() {
  const { token, user } = getAuth();
  if (token && user) {
    const path = getHomePath(user.role);
    if (path === '/') return <LandingPage />;
    return <Navigate to={path} replace />;
  }
  return <LandingPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="page-loading" aria-busy="true" aria-label="Loading" />}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />

        <Route path="/login" element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        } />

        <Route path="/register" element={
          <PublicOnlyRoute>
            <RegisterPage />
          </PublicOnlyRoute>
        } />

        <Route path="/forgot-password" element={
          <PublicOnlyRoute>
            <ForgotPasswordPage />
          </PublicOnlyRoute>
        } />

        {/* A rider creating the password for the account their shop made,
            from the emailed link. Open to everyone: the token is the key, and
            a signed-in session on this browser has nothing to do with it. */}
        <Route path="/activate" element={<ActivatePage />} />

        {/* Where PayMongo's checkout page returns the buyer to. */}
        <Route path="/payment/done" element={<PaymentReturnPage outcome="done" />} />
        <Route path="/payment/cancelled" element={<PaymentReturnPage outcome="cancelled" />} />

        <Route path="/admin" element={<Navigate to="/client" replace />} />

        <Route path="/client" element={
          <ProtectedRoute role="seller">
            <AdminPage />
          </ProtectedRoute>
        } />

        <Route path="/superadmin" element={
          <ProtectedRoute role="superadmin">
            <SuperAdminPage />
          </ProtectedRoute>
        } />

        {/* Where a rider signing in on the web lands. Without it, "/rider"
            fell through to "*", back to "/", and was sent to "/rider" again. */}
        <Route path="/rider" element={
          <ProtectedRoute role="rider">
            <RiderPage />
          </ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
