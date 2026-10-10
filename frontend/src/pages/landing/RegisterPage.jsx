import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { registerUser, resendVerificationEmail, getErrorMessage } from '../../services/authApi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BRAND = {
  badge: 'For sellers',
  headline: <>Start selling<em>direct to buyers.</em></>,
  text: 'No middleman setting the price. You list the rice, buyers order from you, and the money goes to you.',
  points: [
    { title: 'Register and verify', text: 'Create your account and confirm your email.' },
    { title: 'Get reviewed', text: 'The AgriFair team checks your shop before it opens.' },
    { title: 'List and sell', text: 'Add your rice, set your price, and take orders.' },
  ],
};

const FIELDS = [
  { name: 'firstName', label: 'First name', type: 'text', autoComplete: 'given-name' },
  { name: 'lastName', label: 'Last name', type: 'text', autoComplete: 'family-name' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email', wide: true },
  { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password', hint: 'At least 6 characters.' },
  { name: 'confirmPassword', label: 'Confirm password', type: 'password', autoComplete: 'new-password' },
];

export default function RegisterPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [alert, setAlert] = useState(null);
  const [sentTo, setSentTo] = useState('');
  // One email a minute, same as the server enforces. Starts full, because
  // creating the account has just sent the first one.
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const validate = () => {
    const errs = {};
    if (!form.firstName.trim()) errs.firstName = 'Enter your first name.';
    if (!form.lastName.trim()) errs.lastName = 'Enter your last name.';
    if (!form.email) errs.email = 'Enter your email.';
    else if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email, like name@example.com.';
    if (form.password.length < 6) errs.password = 'Use at least 6 characters.';
    if (form.confirmPassword !== form.password) errs.confirmPassword = 'The passwords do not match.';
    return errs;
  };

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      document.getElementById(Object.keys(errs)[0])?.focus();
      return;
    }

    setLoading(true);
    setAlert(null);
    try {
      const email = form.email.trim().toLowerCase();
      const res = await registerUser({
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        email,
        password: form.password,
        // The web sign-up is for sellers only. Buyers sign up in the app,
        // riders are added by their seller, Super Admins by another one.
        role: 'seller',
      });
      setSentTo(email);
      if (res.data?.user?.verificationEmailSent === false) {
        setAlert({ type: 'warning', text: 'Your account was created, but the email did not go out. Send it again below.' });
      } else {
        setCooldown(60);
      }
    } catch (err) {
      setAlert({ type: 'danger', text: getErrorMessage(err, 'Registration failed. Please try again.') });
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    try {
      await resendVerificationEmail(sentTo);
      setCooldown(60);
      setAlert({ type: 'success', text: 'A new verification email is on its way.' });
    } catch (err) {
      if (err.response?.data?.code === 'RESEND_COOLDOWN') setCooldown(err.response.data.retryAfter || 60);
      setAlert({ type: 'danger', text: getErrorMessage(err, 'Could not send the email.') });
    } finally {
      setResending(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email."
        intro={<>We sent a verification link to <strong>{sentTo}</strong>. Open it to confirm your address.</>}
        footer={<>Already verified? <Link to="/login" className="link">Sign in</Link></>}
        brand={BRAND}
        flip
      >
        <ol className="auth-next">
          <li>Open the link in the email (check Spam too).</li>
          <li>The AgriFair team reviews your seller account.</li>
          <li>Once approved, sign in here and add your rice.</li>
        </ol>
        <div className="live" aria-live="polite">
          {alert && <p className={`alert alert-${alert.type}`}>{alert.text}</p>}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-block auth-resend"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
        >
          {resending ? 'Sending…' : cooldown > 0 ? `Send again in ${cooldown}s` : 'Send the email again'}
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account."
      intro="Register your rice business to list your rice and take orders. The AgriFair team reviews every new seller."
      footer={<>Already have an account? <Link to="/login" className="link">Sign in</Link></>}
      brand={BRAND}
      flip
    >
      <div className="live" aria-live="polite">
        {alert && <p className={`alert alert-${alert.type}`}>{alert.text}</p>}
      </div>

      <form className="auth-form form-grid-2" onSubmit={handleSubmit} noValidate>
        {FIELDS.map((f) => (
          <div key={f.name} className={`field${f.wide ? ' span-all' : ''}${errors[f.name] ? ' has-error' : ''}`}>
            <label className="field-label" htmlFor={f.name}>{f.label}</label>
            <input
              id={f.name}
              className="input"
              name={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              spellCheck={f.type === 'email' ? false : undefined}
              value={form[f.name]}
              onChange={set(f.name)}
              aria-invalid={Boolean(errors[f.name])}
              aria-describedby={errors[f.name] ? `${f.name}-error` : undefined}
            />
            {errors[f.name]
              ? <span id={`${f.name}-error`} className="field-error">{errors[f.name]}</span>
              : f.hint && <span className="field-hint">{f.hint}</span>}
          </div>
        ))}

        <button type="submit" className="btn btn-primary btn-lg btn-block span-all" disabled={loading}>
          {loading ? <><span className="spinner" aria-hidden="true" /> Creating account…</> : 'Create seller account'}
        </button>
      </form>
    </AuthLayout>
  );
}
