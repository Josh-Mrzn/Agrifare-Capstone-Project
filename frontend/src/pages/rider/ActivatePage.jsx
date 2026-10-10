import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Check, Mail, Smartphone } from 'lucide-react';
import {
  fetchActivationStatus,
  activateAccount,
  resendActivationLink,
} from '../../services/riderApi';
import { APP_DOWNLOAD_URL, openAppHref, tryOpenApp } from '../../utils/appLinks';
import logoImg from '../../assets/logo.png';
import './ActivatePage.css';

/**
 * Creating the password for an account somebody else created, from the
 * emailed link.
 *
 * A delivery person's account is made by their seller with a random password
 * nobody is told, not even the seller, who should not be able to sign in as
 * their own staff. The link proves the address is theirs, so the only thing
 * left to ask is the password.
 *
 * It is opened on a phone, from an email, by somebody who will then use the
 * AgriFair app — so it looks like the app's own sign-in screen, not the web
 * portal.
 *
 * Opening this page changes nothing. Mail scanners follow links, and a page
 * that activated on load would be used up before the rider saw it.
 *
 * Every link lands on one of these:
 *   valid     create a password
 *   expired   send a new link, to the address already on the account
 *   active    already set up — go sign in
 *   suspended nothing to do here; ask the shop
 *   invalid   replaced by a newer link, or never was one
 */

/** Server codes that mean the link's state changed under the page. */
const STATE_FOR_CODE = {
  ACTIVATION_EXPIRED: 'expired',
  ACTIVATION_INVALID: 'invalid',
  ALREADY_ACTIVE: 'active',
  ACCOUNT_SUSPENDED: 'suspended',
};

const MIN_LENGTH = 6;

/** Only phones have the app, so only phones get sent to it unasked. */
const isPhone = () =>
  typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

function message(err, fallback) {
  return err.response?.data?.message || err.response?.data?.error || fallback;
}

export default function ActivatePage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [state, setState] = useState(token ? 'loading' : 'invalid');
  const [who, setWho] = useState({ name: '', email: '' });
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [show, setShow] = useState({ password: false, confirm: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [cooldown, setCooldown] = useState(0);
  // idle: offer "Open AgriFair App" · opening: trying right now
  const [launch, setLaunch] = useState('idle');
  const triedApp = useRef(false);

  // Once the account is ready, go straight to the app.
  //
  // This works right after "Create Password", while the tap still counts.
  // Chrome refuses to open an app from a page nobody has touched, so simply
  // re-opening an old link lands on the button instead. A page cannot tell
  // "refused" from "not installed", so it never claims the app is missing:
  // the button opens the app when it is there and the download when it is not.
  useEffect(() => {
    if (state !== 'done' && state !== 'active') return;
    if (triedApp.current || !isPhone()) return;
    triedApp.current = true;

    setLaunch('opening');
    tryOpenApp().then(() => setLaunch('idle'));
  }, [state]);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;

    fetchActivationStatus(token)
      .then((res) => {
        if (cancelled) return;
        setWho({ name: res.data?.name || '', email: res.data?.email || '' });
        setState(res.data?.state || 'invalid');
      })
      .catch((err) => {
        if (cancelled) return;
        setState('error');
        setError(message(err, 'Could not check this link. Check your connection and reload.'));
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Counts the resend button down after the server says "not yet".
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const longEnough = form.password.length >= MIN_LENGTH;
  const matches = form.confirm.length > 0 && form.password === form.confirm;

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setError('');
  };

  const toggle = (key) => setShow((s) => ({ ...s, [key]: !s[key] }));

  /** A failure that is really the link changing state moves the page with it. */
  function handleFailure(err, fallback) {
    const next = STATE_FOR_CODE[err.response?.data?.code];
    if (next) {
      setState(next);
      setError('');
      return;
    }
    setError(message(err, fallback));
  }

  async function submit(e) {
    e.preventDefault();

    if (!longEnough) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (!matches) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await activateAccount({ token, password: form.password });
      setForm({ password: '', confirm: '' });
      setState('done');
    } catch (err) {
      handleFailure(err, 'Could not create your password. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError('');
    try {
      const res = await resendActivationLink(token);
      // This link was just replaced, so the button has nothing left to do.
      setSentTo(res.data?.sentTo || who.email);
    } catch (err) {
      if (err.response?.data?.code === 'RESEND_COOLDOWN') {
        setCooldown(err.response.data.retryAfter || 60);
      } else {
        handleFailure(err, 'Could not send a new link. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (key, label, autoFocus) => (
    <div className="field">
      <label className="field-label" htmlFor={`act-${key}`}>{label}</label>
      <span className="input-group">
        <input
          id={`act-${key}`}
          className="input"
          type={show[key] ? 'text' : 'password'}
          autoComplete="new-password"
          // The one field on a page opened to do exactly this.
          autoFocus={autoFocus}
          value={form[key]}
          onChange={set(key)}
          disabled={busy}
        />
        <button
          type="button"
          className="input-group-btn"
          onClick={() => toggle(key)}
          aria-label={show[key] ? 'Hide password' : 'Show password'}
        >
          {show[key] ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </span>
    </div>
  );

  return (
    <div className="act">
      <main className="act-body">
        <div className="act-brand">
          <img src={logoImg} alt="" width="36" height="36" />
          <span translate="no">AgriFair</span>
        </div>

        {state === 'loading' && (
          <div className="stack" aria-busy="true" aria-label="Checking your link">
            <div className="skeleton" style={{ height: 28, width: '70%' }} />
            <div className="skeleton" style={{ height: 40 }} />
            <div className="skeleton" style={{ height: 40 }} />
          </div>
        )}

        {state === 'valid' && (
          <form className="stack" onSubmit={submit} noValidate>
            <div>
              <h1>Set your password</h1>
              <p className="act-text">
                {who.name ? `Hi ${who.name.split(' ')[0]}. ` : ''}
                Choose a password for <strong>{who.email}</strong>. You will use it to sign in on the AgriFair app.
              </p>
            </div>

            {field('password', 'New password', true)}
            {field('confirm', 'Type it again', false)}

            <ul className="act-checks">
              <li className={longEnough ? 'is-ok' : ''}>
                <Check size={14} aria-hidden="true" /> At least {MIN_LENGTH} characters
              </li>
              <li className={matches ? 'is-ok' : ''}>
                <Check size={14} aria-hidden="true" /> Both passwords match
              </li>
            </ul>

            {error && <p className="alert alert-danger" role="alert">{error}</p>}

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? <><span className="spinner" aria-hidden="true" /> Saving…</> : 'Set password'}
            </button>
            <p className="field-hint">Only you will know this password. Your shop cannot see it.</p>
          </form>
        )}

        {state === 'expired' && (
          <div className="stack">
            {sentTo ? (
              <>
                <h1>Check your email</h1>
                <p className="act-text">We sent a new link to <strong>{sentTo}</strong>. Open the newest email; this link no longer works.</p>
              </>
            ) : (
              <>
                <h1>This link has expired</h1>
                <p className="act-text">Links work for 48 hours. We can send a new one to <strong>{who.email}</strong>.</p>
                {error && <p className="alert alert-danger" role="alert">{error}</p>}
                <button type="button" className="btn btn-primary btn-lg btn-block" onClick={resend} disabled={busy || cooldown > 0}>
                  <Mail size={18} aria-hidden="true" />
                  {busy ? 'Sending…' : cooldown > 0 ? `Send again in ${cooldown}s` : 'Send a new link'}
                </button>
              </>
            )}
          </div>
        )}

        {(state === 'active' || state === 'done') && (
          <div className="stack">
            <h1>{state === 'done' ? 'You are all set' : 'Already set up'}</h1>
            <p className="act-text">
              Your delivery account is ready. Sign in on the AgriFair app with{' '}
              {who.email ? <strong>{who.email}</strong> : 'your email'} and your password.
            </p>
            {launch === 'opening' ? (
              <p className="act-opening" role="status"><span className="spinner" aria-hidden="true" /> Opening the AgriFair app…</p>
            ) : (
              <>
                <a className="btn btn-primary btn-lg btn-block" href={openAppHref()}>
                  <Smartphone size={18} aria-hidden="true" /> Open the AgriFair app
                </a>
                <p className="field-hint">
                  No app yet? <a className="link" href={APP_DOWNLOAD_URL}>Download AgriFair</a>
                </p>
              </>
            )}
          </div>
        )}

        {state === 'suspended' && (
          <div className="stack">
            <h1>Account suspended</h1>
            <p className="act-text">Ask the shop you deliver for about it.</p>
          </div>
        )}

        {state === 'invalid' && (
          <div className="stack">
            <h1>This link no longer works</h1>
            <p className="act-text">A newer link may have been sent. Open the newest AgriFair email, or ask your shop to send a new one.</p>
          </div>
        )}

        {state === 'error' && <p className="alert alert-danger" role="alert">{error}</p>}
      </main>
    </div>
  );
}
