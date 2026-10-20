import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LayoutGrid, Users, BadgeCheck, ScrollText, BarChart3, Settings, Download, Plus,
  ArrowRight, Store, ShoppingCart, Clock,
} from 'lucide-react';
import PortalShell from '../../components/PortalShell';
import Modal, { ConfirmDialog } from '../../components/Modal';
import ActionsMenu from '../../components/ActionsMenu';
import {
  fetchAllUsers,
  suspendUser,
  activateUser,
  approveSeller,
  rejectSeller,
  fetchPendingApprovals,
  deleteUserAccount,
  createUserAccount,
  updateUserAccount,
} from '../../services/superAdminApi';
import { fetchSection } from '../../services/analyticsApi';
import { getErrorMessage } from '../../services/authApi';
import AuditLogPanel from './AuditLogPanel';
import CredentialsPanel from './CredentialsPanel';
import BusinessAnalytics from './BusinessAnalytics';
import RecentPerformance from '../../components/analytics/RecentPerformance';
import SettingsPanel from './SettingsPanel';
import UserDetailView from './UserDetailView';
import { clearSession, getSessionUser } from '../../utils/auth';
import { exportToCsv } from '../../utils/csv';
import { number, formatDate } from '../../utils/format';
import './SuperAdminPage.css';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'credentials', label: 'Credentials', icon: BadgeCheck },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const ROLE_FILTERS = [
  { id: 'all', label: 'Everyone' },
  { id: 'seller', label: 'Sellers' },
  { id: 'buyer', label: 'Buyers' },
  { id: 'rider', label: 'Riders' },
  { id: 'superadmin', label: 'Admins' },
];

const ROLE_LABEL = { seller: 'Seller', buyer: 'Buyer', rider: 'Rider', superadmin: 'Super Admin' };

const STATUS_TONE = { active: 'success', pending: 'warning', suspended: 'danger', rejected: '', deactivated: '' };

const statusBadgeOf = (status = 'active') => (
  <span className={`badge${STATUS_TONE[status] ? ` badge-${STATUS_TONE[status]}` : ''}`}>
    {status[0].toUpperCase() + status.slice(1)}
  </span>
);

const idOf = (u) => u.userId ?? u._id;

export default function SuperAdminPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const me = getSessionUser() || {};
  const active = SECTIONS.some((s) => s.id === params.get('tab')) ? params.get('tab') : 'overview';
  const go = (id) => setParams(id === 'overview' ? {} : { tab: id });

  const [accounts, setAccounts] = useState(null);
  const [pending, setPending] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAccounts = useCallback(async () => {
    try {
      const [usersRes, pendingRes] = await Promise.all([
        fetchAllUsers(),
        fetchPendingApprovals().catch(() => ({ data: [] })),
      ]);
      const list = usersRes.data?.users || usersRes.data || [];
      setAccounts(Array.isArray(list) ? list : []);
      const waiting = pendingRes.data?.users || pendingRes.data || [];
      setPending(Array.isArray(waiting) ? waiting.filter((u) => u.role === 'seller') : []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load the accounts.'));
      setAccounts((prev) => prev || []);
    }
  }, []);

  useEffect(() => {
    // loadAccounts() sets state only after its await, which this rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAccounts();
    // The same figure as Analytics shows for the last 12 months, from the
    // same module, so the two pages cannot disagree.
    fetchSection('/analytics/platform', 'overview', { preset: '12m', compare: 'none' })
      .then((res) => setRevenue(res.data?.kpis?.find((k) => k.id === 'sales')?.value || 0))
      .catch(() => setRevenue(0));
  }, [loadAccounts]);

  async function run(fn, done, fallback) {
    setError('');
    setNotice('');
    try {
      await fn();
      if (done) setNotice(done);
      await loadAccounts();
      return true;
    } catch (err) {
      setError(getErrorMessage(err, fallback));
      return false;
    }
  }

  const signOut = () => {
    clearSession();
    navigate('/login');
  };

  const sections = SECTIONS.map((s) => (s.id === 'users' ? { ...s, count: pending.length } : s));

  const content = {
    overview: <Overview accounts={accounts} pending={pending} revenue={revenue} run={run} go={go} />,
    users: <UsersSection accounts={accounts} pending={pending} run={run} me={me} />,
    credentials: <CredentialsPanel />,
    analytics: <BusinessAnalytics />,
    audit: <AuditLogPanel />,
    settings: <SettingsPanel />,
  }[active];

  return (
    <PortalShell
      portalName="Super Admin"
      roleLabel="Super Admin"
      workspaceLabel="Platform control"
      sections={sections}
      active={active}
      onSelect={go}
      user={me}
      onSignOut={signOut}
    >
      <div className="live" aria-live="polite">
        {error && <p className="alert alert-danger">{error}</p>}
        {notice && <p className="alert alert-success">{notice}</p>}
      </div>
      {content}
    </PortalShell>
  );
}

/* ------------------------------------------------------------- Overview */

function Overview({ accounts, pending, revenue, run, go }) {
  const [rejecting, setRejecting] = useState(null);

  if (!accounts) return <div className="skeleton" style={{ height: 96 }} />;

  const count = (role, status) => accounts.filter((u) => u.role === role && (!status || u.status === status)).length;
  const newest = [...accounts]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 6);

  return (
    <>
      <section className="sa-hero">
        <div className="sa-hero-top">
          <span className="eyebrow">Sales on AgriFair</span>
          <span className="sa-hero-period">Last 12 months</span>
        </div>
        <p className="sa-hero-value num">
          <span>₱</span>{revenue == null ? '…' : number(Math.round(revenue))}
        </p>
        <p className="sa-hero-note">Completed orders placed in the last 12 months, including delivery fees.</p>
        <div className="sa-hero-chips">
          <span><small>Accounts</small>{number(accounts.length)}</span>
          <span><small>Sellers active</small>{count('seller') ? Math.round((count('seller', 'active') / count('seller')) * 100) : 0}%</span>
          <span><small>Delivery riders</small>{number(count('rider'))}</span>
        </div>
        <button type="button" className="sa-hero-link" onClick={() => go('analytics')}>
          See the breakdown <ArrowRight size={15} aria-hidden="true" />
        </button>
      </section>

      <RecentPerformance onOpen={() => go('analytics')} />

      <div className="stats" style={{ '--cols': 3 }}>
        <button type="button" className="stat" onClick={() => go('users')}>
          <span className="stat-icon"><Store size={19} aria-hidden="true" /></span>
          <span className="stat-label">Active sellers</span>
          <span className="stat-value">{number(count('seller', 'active'))}</span>
          <span className="stat-note">{number(count('seller'))} registered, {number(count('seller', 'suspended'))} suspended</span>
        </button>
        <button type="button" className="stat stat--gold" onClick={() => go('users')}>
          <span className="stat-icon"><ShoppingCart size={19} aria-hidden="true" /></span>
          <span className="stat-label">Buyers</span>
          <span className="stat-value">{number(count('buyer'))}</span>
          <span className="stat-note">Shopping through the app</span>
        </button>
        <button type="button" className="stat" onClick={() => go('users')}>
          <span className="stat-icon"><Clock size={19} aria-hidden="true" /></span>
          <span className="stat-label">Waiting for approval</span>
          <span className="stat-value">{number(pending.length)}</span>
          <span className={`stat-note${pending.length ? ' is-warn' : ''}`}>{pending.length ? 'Seller applications to review' : 'Nothing waiting'}</span>
        </button>
      </div>

      <div className="split-grid split-grid-even">
        <PendingSellers pending={pending} run={run} onReject={setRejecting} />

        <section className="panel">
          <div className="panel-head">
            <h2>Newest accounts</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('users')}>All users</button>
          </div>
          <ul className="list">
            {newest.map((u) => (
              <li key={idOf(u)} className="list-row">
                <span className="list-row-main">
                  <strong>{u.name || u.email}</strong>
                  <span>{ROLE_LABEL[u.role] || u.role}, joined {formatDate(u.createdAt, 'recently')}</span>
                </span>
                {statusBadgeOf(u.status)}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {rejecting && <RejectDialog seller={rejecting} run={run} onClose={() => setRejecting(null)} />}
    </>
  );
}

function PendingSellers({ pending, run, onReject }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Seller applications</h2>
          <p>Submitted applications. Verify at least one permit under Credentials, then approve; the shop opens at once.</p>
        </div>
      </div>
      {pending.length === 0 ? (
        <div className="empty"><p>No applications waiting.</p></div>
      ) : (
        <ul className="list">
          {pending.map((u) => {
            const docs = u.documents || [];
            const verified = docs.filter((d) => d.status === 'verified').length;
            return (
              <li key={idOf(u)} className="list-row">
                <span className="list-row-main">
                  <strong>{u.sellerProfile?.businessName || u.name}</strong>
                  <span>
                    {u.email}, submitted {formatDate(u.application?.submittedAt || u.createdAt, 'recently')}
                    {`, ${docs.length} permit${docs.length === 1 ? '' : 's'} (${verified} verified)`}
                    {u.emailVerified ? '' : ', email not verified yet'}
                  </span>
                </span>
                <span className="list-row-side">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onReject(u)}>Reject</button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!verified}
                    title={verified ? undefined : 'Verify a permit under Credentials first'}
                    onClick={() => run(() => approveSeller(idOf(u)), `${u.name} is approved and can now list rice.`, 'Could not approve this seller.')}
                  >
                    Approve
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RejectDialog({ seller, run, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    const ok = await run(
      () => rejectSeller(idOf(seller), reason.trim()),
      `${seller.name}'s application was rejected.`,
      'Could not reject this application.',
    );
    if (ok) onClose();
    else setBusy(false);
  }

  return (
    <Modal title={`Reject ${seller.name}?`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p>They see your reason when they try to sign in. The decision is kept in the audit log.</p>
          <label className="field">
            <span className="field-label">Reason</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="No business permit uploaded…" autoComplete="off" />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={busy || !reason.trim()}>Reject application</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Users */

function UsersSection({ accounts, pending, run, me }) {
  const [role, setRole] = useState('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [deleting, setDeleting] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [viewing, setViewing] = useState(null);

  const shown = useMemo(() => (accounts || []).filter((u) => {
    if (role !== 'all' && u.role !== role) return false;
    const q = search.trim().toLowerCase();
    return !q || `${u.name} ${u.email} ${u.userId}`.toLowerCase().includes(q);
  }), [accounts, role, search]);

  if (!accounts) return <div className="panel"><div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /></div></div>;

  function toggle(u) {
    const suspended = u.status === 'suspended' || u.status === 'deactivated';
    return run(
      () => (suspended ? activateUser(idOf(u)) : suspendUser(idOf(u))),
      suspended ? `${u.name} can sign in again.` : `${u.name} is suspended and signed out.`,
      'Could not change this account.',
    );
  }

  const dialogs = (
    <>
      {editing && (
        <AccountForm user={editing === 'new' ? null : editing} run={run} onClose={() => setEditing(null)} />
      )}
      {rejecting && <RejectDialog seller={rejecting} run={run} onClose={() => setRejecting(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Deactivate ${deleting.name || deleting.email}?`}
          confirmLabel="Deactivate account"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await run(() => deleteUserAccount(idOf(deleting)), `${deleting.name || deleting.email} was deactivated.`, 'Could not deactivate this account.');
            setDeleting(null);
            setViewing(null);
          }}
        >
          <p>They are signed out and cannot sign in again; a seller&rsquo;s shop disappears from the app. Their orders, reviews and messages are kept, and you can reactivate the account later. Accounts with deliveries in progress cannot be deactivated until those are finished.</p>
        </ConfirmDialog>
      )}
    </>
  );

  if (viewing) {
    const current = accounts.find((u) => idOf(u) === idOf(viewing)) || viewing;
    return (
      <>
        <UserDetailView
          user={current}
          onBack={() => setViewing(null)}
          onEdit={() => setEditing(current)}
          onToggleStatus={() => toggle(current)}
        />
        {dialogs}
      </>
    );
  }

  function exportCsv() {
    exportToCsv(
      'agrifair-accounts.csv',
      shown.map((u) => ({
        userId: u.userId ?? '',
        name: u.name || '',
        email: u.email || '',
        role: ROLE_LABEL[u.role] || u.role || '',
        status: u.status || '',
        joined: formatDate(u.createdAt),
      })),
      [
        { key: 'userId', label: 'User ID' },
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role' },
        { key: 'status', label: 'Status' },
        { key: 'joined', label: 'Joined' },
      ],
    );
  }

  return (
    <>
      {pending.length > 0 && <PendingSellers pending={pending} run={run} onReject={setRejecting} />}

      <div className="page-actions">
        <div className="chips" role="group" aria-label="Show">
          {ROLE_FILTERS.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={role === f.id} onClick={() => setRole(f.id)}>
              {f.label} <span className="chip-count">{f.id === 'all' ? accounts.length : accounts.filter((u) => u.role === f.id).length}</span>
            </button>
          ))}
        </div>
        <span className="toolbar">
          <button type="button" className="btn btn-secondary" onClick={exportCsv}>
            <Download size={16} aria-hidden="true" /> Export CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" /> New account
          </button>
        </span>
      </div>

      <section className="panel">
        <div className="panel-head">
          <label className="sr-only" htmlFor="user-search">Search accounts</label>
          <input
            id="user-search"
            className="input search-input"
            type="search"
            placeholder="Search name, email or ID…"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {shown.length === 0 ? (
          <div className="empty"><p>No accounts match.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th className="is-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={idOf(u)}>
                    <td className="is-primary">
                      <span className="cell-main">
                        <button type="button" className="row-link" onClick={() => setViewing(u)}>{u.name || 'Unnamed'}</button>
                        <span>{u.email}, ID {u.userId ?? 'none'}</span>
                      </span>
                    </td>
                    <td data-label="Role">{ROLE_LABEL[u.role] || u.role}</td>
                    <td data-label="Status">{statusBadgeOf(u.status)}</td>
                    <td data-label="Joined" className="muted">{formatDate(u.createdAt)}</td>
                    <td className="is-actions">
                      <ActionsMenu
                        label={`Actions for ${u.name || u.email}`}
                        items={[
                          { label: 'View details', onClick: () => setViewing(u) },
                          { label: 'Edit account', onClick: () => setEditing(u) },
                          {
                            label: u.status === 'suspended' ? 'Reinstate' : u.status === 'deactivated' ? 'Reactivate' : 'Suspend',
                            hidden: u.role === 'superadmin' || u.status === 'pending' || u.status === 'rejected',
                            separatorBefore: true,
                            onClick: () => toggle(u),
                          },
                          {
                            label: 'Deactivate',
                            danger: true,
                            hidden: idOf(u) === idOf(me) || u.status === 'deactivated',
                            separatorBefore: u.role === 'superadmin',
                            onClick: () => setDeleting(u),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialogs}
    </>
  );
}

function AccountForm({ user, run, onClose }) {
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    role: user?.role || 'seller',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setError('Enter a name and an email.');
      return;
    }
    if ((!user || form.password) && form.password.length < 6) {
      setError('Use a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    // Status has its own actions (approve, suspend, deactivate), each with its
    // own checks, so the form never sets it. New accounts start active.
    const payload = { name: form.name.trim(), email: form.email.trim(), role: form.role };
    if (form.password) payload.password = form.password;
    const ok = await run(
      () => (user ? updateUserAccount(idOf(user), payload) : createUserAccount(payload)),
      user ? 'Account saved.' : `Account for ${payload.email} created.`,
      'Could not save this account.',
    );
    if (ok) onClose();
    else setBusy(false);
  }

  return (
    <Modal title={user ? `Edit ${user.name || user.email}` : 'New account'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          <div className="form-grid-2">
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" value={form.name} onChange={set('name')} autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input className="input" type="email" spellCheck={false} value={form.email} onChange={set('email')} autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">Role</span>
              <select className="select" value={form.role} onChange={set('role')}>
                <option value="seller">Seller</option>
                <option value="buyer">Buyer</option>
                <option value="superadmin">Super Admin</option>
                {form.role === 'rider' && <option value="rider">Rider</option>}
              </select>
            </label>
            <label className="field span-all">
              <span className="field-label">{user ? 'New password' : 'Password'} {user && <span className="optional">(leave empty to keep it)</span>}</span>
              <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
            </label>
          </div>
          {!user && <p className="field-hint">Accounts you create here are treated as verified. Riders are added by their seller.</p>}
          {error && <p className="alert alert-danger" role="alert">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : user ? 'Save' : 'Create account'}</button>
        </div>
      </form>
    </Modal>
  );
}
