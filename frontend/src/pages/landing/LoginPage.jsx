import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import AuthLayout from './AuthLayout';
import {
  loginUser,
  verifyEmailLink,
  resendVerificationEmail,
  getErrorMessage,
} from '../../services/authApi';
import { getHomePath, saveSession } from '../../utils/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [form, setForm] = useState({ email: '', password: '' });
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(() => (searchParams.get('suspended') === '1'
    ? { type: 'danger', text: 'Your account was suspended, so you were signed out. Contact AgriFair support.' }
    : null));
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [resent, setResent] = useState(false);
  const verifyTried = useRef(false);

  // Arriving from the emailed verification link.
  useEffect(() => {
    const token = searchParams.get('verify');
    if (!token || verifyTried.current) return;
    verifyTried.current = true;
    verifyEmailLink(token)
      .then((res) => setAlert({ type: 'success', text: res.data?.message || 'Email verified. You can sign in now.' }))
      .catch((err) => setAlert({ type: 'danger', text: getErrorMessage(err, 'This verification link did not work.') }))
      .finally(() => setSearchParams({}, { replace: true }));
  }, [searchParams, setSearchParams]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const validate = () => {
    const errs = {};
    if (!form.email) errs.email = 'Enter your email.';
    else if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email, like name@example.com.';
    if (!form.password) errs.password = 'Enter your password.';
    return errs;
  };

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      document.getElementById(errs.email ? 'email' : 'password')?.focus();
      return;
    }

    setLoading(true);
    setAlert(null);
    setUnverifiedEmail('');
    try {
      const res = await loginUser({ email: form.email.trim().toLowerCase(), password: form.password });
      saveSession(res.data, { remember });
      navigate(getHomePath(res.data.user?.role), { replace: true });
    } catch (err) {
      if (err.response?.data?.code === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(err.response.data.email || form.email.trim());
      }
      setAlert({ type: 'danger', text: getErrorMessage(err, 'Sign-in failed. Please try again.') });
      setLoading(false);
    }
  }

  async function resend() {
    try {
      await resendVerificationEmail(unverifiedEmail);
      setResent(true);
    } catch (err) {
      setAlert({ type: 'danger', text: getErrorMessage(err, 'Could not send a new link.') });
    }
  }

  return (
    <AuthLayout
      title="Welcome back."
      intro="Sign in to the seller portal. Buyers and delivery riders use the AgriFair app."
      footer={<>New seller? <Link to="/register" className="link">Register your business</Link></>}
      brand={{
        badge: 'Seller portal',
        headline: <>Your rice.<em>Your price.</em></>,
        text: 'Sell straight to buyers, with clear prices per sack and delivery you can follow.',
        points: [
          { title: 'Orders and payments', text: 'Accept orders and check every GCash transfer yourself.' },
          { title: 'Stock and riders', text: 'Keep count of every sack, and assign your own riders.' },
          { title: 'Sales reports', text: 'See what sells, and get the figures as a PDF by email.' },
        ],
      }}
    >
      <div className="live" aria-live="polite">
        {alert && (
          <div className={`alert alert-${alert.type}`}>
            <span>
              {alert.text}
              {unverifiedEmail && (
                <>
                  {' '}
                  {resent
                    ? 'A new link is on its way.'
                    : <button type="button" className="link" onClick={resend}>Send a new link</button>}
                </>
              )}
            </span>
          </div>
        )}
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className={`field${errors.email ? ' has-error' : ''}`}>
          <label className="field-label" htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            name="email"
            autoComplete="email"
            spellCheck={false}
            value={form.email}
            onChange={set('email')}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
          {errors.email && <span id="email-error" className="field-error">{errors.email}</span>}
        </div>

        <div className={`field${errors.password ? ' has-error' : ''}`}>
          <div className="auth-row">
            <label className="field-label" htmlFor="password">Password</label>
            <Link to="/forgot-password" className="link">Forgot password?</Link>
          </div>
          <span className="input-group">
            <input
              id="password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              value={form.password}
              onChange={set('password')}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'password-error' : undefined}
            />
            <button
              type="button"
              className="input-group-btn"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </span>
          {errors.password && <span id="password-error" className="field-error">{errors.password}</span>}
        </div>

        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in on this device
        </label>

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading}>
          {loading ? <><span className="spinner" aria-hidden="true" /> Signing in…</> : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
