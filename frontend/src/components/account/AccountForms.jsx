import React, { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { updateAccount, changePassword, fetchLoginHistory } from '../../services/userApi';
import { API_ORIGIN, getErrorMessage } from '../../services/authApi';
import { formatDateTime, initialsOf } from '../../utils/format';

/**
 * Account sections every signed-in role has: profile, password, alerts and
 * sign-in history. The seller portal and the Super Admin settings both use
 * these, so a fix to one is a fix to both.
 */

/** A success or error line under a form; announced to screen readers. */
export function FormStatus({ status }) {
  return (
    <div className="live" aria-live="polite">
      {status && (
        <p className={`alert alert-${status.ok ? 'success' : 'danger'}`}>{status.text}</p>
      )}
    </div>
  );
}

export function ProfileForm({ me, onSaved, withPhoto = false }) {
  const [form, setForm] = useState({ name: me.name || '', contact: me.contact || '', bio: me.bio || '' });
  const [avatarFile, setAvatarFile] = useState(null);
  const [preview, setPreview] = useState(me.avatarUrl ? `${API_ORIGIN}${me.avatarUrl}` : '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setStatus(null);
    if (!form.name.trim()) {
      setStatus({ ok: false, text: 'Name cannot be empty.' });
      return;
    }
    setSaving(true);
    try {
      await updateAccount({ ...form, avatarFile });
      setAvatarFile(null);
      setStatus({ ok: true, text: 'Profile saved.' });
      await onSaved?.();
    } catch (err) {
      setStatus({ ok: false, text: getErrorMessage(err, 'Could not save your profile.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {withPhoto && (
        <div className="photo-row">
          <span className="avatar avatar-lg">
            {preview ? <img src={preview} alt="" /> : initialsOf(form.name, me.email)}
          </span>
          <label className="btn btn-secondary btn-sm">
            {preview ? 'Change photo' : 'Add photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setAvatarFile(file);
                setPreview(URL.createObjectURL(file));
              }}
            />
          </label>
        </div>
      )}

      <div className="form-grid-2">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" name="name" autoComplete="name" value={form.name} onChange={set('name')} />
        </label>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" value={me.email || ''} disabled readOnly />
          <span className="field-hint">Your sign-in address. It cannot be changed here.</span>
        </label>
        <label className="field">
          <span className="field-label">Mobile number</span>
          <input
            className="input"
            type="tel"
            name="tel"
            autoComplete="tel"
            inputMode="tel"
            value={form.contact}
            onChange={set('contact')}
            placeholder="0917 123 4567"
          />
        </label>
        <label className="field span-all">
          <span className="field-label">About <span className="optional">(optional)</span></span>
          <textarea className="textarea" rows={3} value={form.bio} onChange={set('bio')} />
        </label>
      </div>

      <FormStatus status={status} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const set = (key) => (e) => setPw((p) => ({ ...p, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setStatus(null);
    if (!pw.current || !pw.next) return setStatus({ ok: false, text: 'Enter your current and new password.' });
    if (pw.next.length < 6) return setStatus({ ok: false, text: 'Use at least 6 characters for the new password.' });
    if (pw.next !== pw.confirm) return setStatus({ ok: false, text: 'The new passwords do not match.' });

    setSaving(true);
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setStatus({ ok: true, text: 'Password changed. You stay signed in.' });
    } catch (err) {
      setStatus({ ok: false, text: getErrorMessage(err, 'Could not change your password.') });
    } finally {
      setSaving(false);
    }
  }

  const type = show ? 'text' : 'password';

  return (
    <form className="form-grid" onSubmit={submit}>
      <div className="form-grid-3">
        <label className="field">
          <span className="field-label">Current password</span>
          <span className="input-group">
            <input className="input" type={type} autoComplete="current-password" value={pw.current} onChange={set('current')} />
            <button
              type="button"
              className="input-group-btn"
              aria-label={show ? 'Hide passwords' : 'Show passwords'}
              onClick={() => setShow((v) => !v)}
            >
              {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </span>
        </label>
        <label className="field">
          <span className="field-label">New password</span>
          <input className="input" type={type} autoComplete="new-password" value={pw.next} onChange={set('next')} />
        </label>
        <label className="field">
          <span className="field-label">Confirm new password</span>
          <input className="input" type={type} autoComplete="new-password" value={pw.confirm} onChange={set('confirm')} />
        </label>
      </div>

      <FormStatus status={status} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}

const ALERTS = [
  { key: 'order', label: 'Orders', desc: 'New orders and status changes.' },
  { key: 'payment', label: 'Payments', desc: 'GCash receipts waiting for you to check.' },
  { key: 'message', label: 'Messages', desc: 'New messages from buyers.' },
  { key: 'stock', label: 'Stock', desc: 'Products running low or sold out.' },
  { key: 'system', label: 'Account notices', desc: 'Approvals, suspensions and platform notices.' },
];

export function NotificationsForm({ me, onSaved }) {
  const [prefs, setPrefs] = useState({
    order: true, payment: true, message: true, stock: true, system: true, ...(me.notificationPrefs || {}),
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await updateAccount({ notificationPrefs: prefs });
      setStatus({ ok: true, text: 'Notification settings saved.' });
      await onSaved?.();
    } catch (err) {
      setStatus({ ok: false, text: getErrorMessage(err, 'Could not save your settings.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <ul className="list toggle-list">
        {ALERTS.map((a) => (
          <li key={a.key}>
            <label className="list-row">
              <span className="list-row-main">
                <strong>{a.label}</strong>
                <span>{a.desc}</span>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={Boolean(prefs[a.key])}
                onChange={(e) => setPrefs((p) => ({ ...p, [a.key]: e.target.checked }))}
              />
            </label>
          </li>
        ))}
      </ul>
      <FormStatus status={status} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

/** Where the browser string is long, show the part a person recognises. */
function deviceOf(userAgent = '') {
  if (!userAgent) return 'Unknown device';
  if (/dart|okhttp|flutter/i.test(userAgent)) return 'AgriFair app';
  const browser = /edg\//i.test(userAgent) ? 'Edge'
    : /chrome\//i.test(userAgent) ? 'Chrome'
      : /firefox\//i.test(userAgent) ? 'Firefox'
        : /safari\//i.test(userAgent) ? 'Safari' : 'Browser';
  const os = /windows/i.test(userAgent) ? 'Windows'
    : /android/i.test(userAgent) ? 'Android'
      : /iphone|ipad/i.test(userAgent) ? 'iOS'
        : /mac os/i.test(userAgent) ? 'macOS'
          : /linux/i.test(userAgent) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SignInHistory() {
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    fetchLoginHistory()
      .then((res) => setSessions(res.data?.sessions || res.data || []))
      .catch(() => setSessions([]));
  }, []);

  if (!sessions) {
    return <div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /></div>;
  }

  if (sessions.length === 0) {
    return <div className="empty"><p>No sign-ins recorded yet.</p></div>;
  }

  return (
    <div className="table-wrap">
      <table className="table table-stack">
        <thead>
          <tr><th>When</th><th>Device</th><th>IP address</th></tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s._id}>
              <td className="is-primary">{formatDateTime(s.loggedInAt)}</td>
              <td data-label="Device" title={s.userAgent}>{deviceOf(s.userAgent)}</td>
              <td data-label="IP address" className="num">{s.ipAddress || 'Unknown'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
