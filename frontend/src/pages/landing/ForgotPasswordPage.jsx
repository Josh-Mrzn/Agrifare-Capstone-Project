import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import {
  requestPasswordReset,
  verifyResetCode,
  resetPassword,
  getErrorMessage,
} from '../../services/authApi';

const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STEP_TEXT = {
  email: {
    title: 'Reset your password',
    intro: 'Enter the email on your account. We will send you a 6-digit code.',
  },
  code: { title: 'Enter the code', intro: null },
  password: { title: 'Choose a new password', intro: null },
  done: { title: 'Password updated', intro: 'You can sign in with your new password now.' },
};

/**
 * Same flow as the phone: email -> 6-digit code -> new password. The code is
 * traded for a short-lived reset token first, so the code never travels with
 * the new password.
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  /**
   * A request inside the cooldown still lands on the code step: the code sent
   * a moment ago works, so there is nothing for the person to fix.
   */
  const sendCode = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await requestPasswordReset(email.trim());
      setResendIn(RESEND_SECONDS);
      setStep('code');
      setNotice(`If ${email.trim()} has an AgriFair account, a code is on its way. Check Spam too.`);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'RESEND_COOLDOWN') {
        setResendIn(data.retryAfter || RESEND_SECONDS);
        setStep('code');
        setNotice(data.message);
      } else {
        setError(getErrorMessage(err, 'Could not send the reset code.'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email, like name@example.com.');
      return;
    }
    sendCode();
  };

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from the email.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { data } = await verifyResetCode(email.trim(), code.trim());
      setResetToken(data.resetToken);
      setNotice('');
      setStep('password');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not check that code.'));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Use at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await resetPassword(resetToken, password);
      setStep('done');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not reset the password.'));
    } finally {
      setLoading(false);
    }
  };

  const startOver = () => {
    setStep('email');
    setCode('');
    setResetToken('');
    setPassword('');
    setConfirm('');
    setError('');
    setNotice('');
  };

  const text = STEP_TEXT[step];
  const intro = step === 'code'
    ? (notice || <>Enter the 6-digit code we sent to <strong>{email}</strong>.</>)
    : step === 'password'
      ? <>Choose a new password for <strong>{email}</strong>.</>
      : text.intro;

  const errorLine = error && <span id="reset-error" className="field-error">{error}</span>;

  return (
    <AuthLayout
      brand={{
        badge: 'Account recovery',
        headline: <>Back to your<em>shop soon.</em></>,
        text: 'We will email you a 6-digit code. Enter it here, choose a new password, and sign in again.',
      }}
      title={text.title}
      intro={intro}
      footer={step !== 'done' && <>Remembered it? <Link to="/login" className="link">Back to sign in</Link></>}
    >
      {step === 'email' && (
        <form className="auth-form" onSubmit={handleEmailSubmit} noValidate>
          <div className={`field${error ? ' has-error' : ''}`}>
            <label className="field-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              aria-describedby={error ? 'reset-error' : undefined}
            />
            {errorLine}
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading}>
            {loading ? 'Sending…' : 'Send code'}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form className="auth-form" onSubmit={handleCodeSubmit} noValidate>
          <div className={`field${error ? ' has-error' : ''}`}>
            <label className="field-label" htmlFor="code">6-digit code</label>
            <input
              id="code"
              className="input input-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                setError('');
              }}
              aria-describedby={error ? 'reset-error' : undefined}
            />
            {errorLine}
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading}>
            {loading ? 'Checking…' : 'Continue'}
          </button>
          <p className="auth-alt">
            {resendIn > 0
              ? <>You can ask for a new code in {resendIn}s.</>
              : <button type="button" className="link" onClick={sendCode} disabled={loading}>Send a new code</button>}
            {' or '}
            <button type="button" className="link" onClick={startOver}>use a different email</button>.
          </p>
        </form>
      )}

      {step === 'password' && (
        <form className="auth-form" onSubmit={handlePasswordSubmit} noValidate>
          <div className="field">
            <label className="field-label" htmlFor="new-password">New password</label>
            <input
              id="new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
            />
            <span className="field-hint">At least 6 characters.</span>
          </div>
          <div className={`field${error ? ' has-error' : ''}`}>
            <label className="field-label" htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError('');
              }}
              aria-describedby={error ? 'reset-error' : undefined}
            />
            {errorLine}
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading}>
            {loading ? 'Saving…' : 'Update password'}
          </button>
        </form>
      )}

      {step === 'done' && (
        <button type="button" className="btn btn-primary btn-lg btn-block auth-resend" onClick={() => navigate('/login')}>
          Sign in
        </button>
      )}
    </AuthLayout>
  );
}
