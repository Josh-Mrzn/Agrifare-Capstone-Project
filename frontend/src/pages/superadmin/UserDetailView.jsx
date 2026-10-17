import React, { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, CalendarRange, Users } from 'lucide-react';
import { fetchUserAnalytics } from '../../services/superAdminApi';
import { API_ORIGIN } from '../../services/authApi';
import { wholePeso, number, formatDate, initialsOf } from '../../utils/format';
import BuyerProfile from '../../components/analytics/BuyerProfile';
import SellerAnalytics from '../../components/analytics/SellerAnalytics';

const ROLE_LABEL = { seller: 'Seller', buyer: 'Buyer', rider: 'Rider', superadmin: 'Super Admin' };

/** Change between the two most recent periods, as "+12%" or null. */
function trend(series) {
  if (!series || series.length < 2) return null;
  const [prev, last] = series.slice(-2).map((p) => p.income);
  if (!prev) return null;
  const pct = Math.round(((last - prev) / prev) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

export default function UserDetailView({ user, onBack, onEdit, onToggleStatus }) {
  const isSeller = user.role === 'seller';
  const [analytics, setAnalytics] = useState(null);
  const [fullAnalytics, setFullAnalytics] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (!isSeller) return;
    fetchUserAnalytics(user.userId ?? user._id)
      .then((res) => setAnalytics(res.data))
      .catch(() => setAnalytics({ applicable: false }));
  }, [isSeller, user.userId, user._id]);

  const monthly = analytics?.monthlyIncome || [];
  const weekly = analytics?.weeklyIncome || [];
  const orders = analytics?.recentOrders || [];
  const clients = analytics?.clients || { total: 0 };

  return (
    <div className="detail">
      <div className="detail-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Users
        </button>
        <div className="user-title">
          <span className="avatar avatar-lg">
            {user.avatarUrl ? <img src={`${API_ORIGIN}${user.avatarUrl}`} alt="" /> : initialsOf(user.name, user.email)}
          </span>
          <div className="cell-main">
            <h2>{user.name || 'Unnamed account'}</h2>
            <span>{user.email}</span>
          </div>
          <span className="toolbar user-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
            {user.role !== 'superadmin' && !['pending', 'rejected'].includes(user.status) && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onToggleStatus}>
                {user.status === 'suspended' ? 'Reinstate' : 'Suspend'}
              </button>
            )}
          </span>
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          {user.role === 'buyer' && user.userId != null ? (
            <BuyerProfile userId={user.userId} />
          ) : !isSeller ? (
            <section className="panel">
              <div className="empty"><p>Sales figures are kept for sellers only. This is a {ROLE_LABEL[user.role]?.toLowerCase() || user.role} account.</p></div>
            </section>
          ) : !analytics ? (
            <div className="skeleton" style={{ height: 240 }} />
          ) : (
            <>
              <div className="stats" style={{ '--cols': 3 }}>
                <div className="stat">
                  <span className="stat-icon"><CalendarRange size={19} aria-hidden="true" /></span>
                  <span className="stat-label">This month</span>
                  <span className="stat-value">{wholePeso(monthly.at(-1)?.income)}</span>
                  <span className="stat-note">{trend(monthly) ? `${trend(monthly)} vs last month` : 'No earlier month'}</span>
                </div>
                <div className="stat stat--gold">
                  <span className="stat-icon"><CalendarDays size={19} aria-hidden="true" /></span>
                  <span className="stat-label">This week</span>
                  <span className="stat-value">{wholePeso(weekly.at(-1)?.income)}</span>
                  <span className="stat-note">{trend(weekly) ? `${trend(weekly)} vs last week` : 'No earlier week'}</span>
                </div>
                <div className="stat">
                  <span className="stat-icon"><Users size={19} aria-hidden="true" /></span>
                  <span className="stat-label">Buyers</span>
                  <span className="stat-value">{number(clients.total)}</span>
                  <span className="stat-note">{number(clients.repeat || 0)} came back</span>
                </div>
              </div>

              <section className="panel">
                <div className="panel-head"><h3>Recent orders</h3></div>
                {orders.length === 0 ? (
                  <div className="empty"><p>No orders yet.</p></div>
                ) : (
                  <div className="table-wrap">
                    <table className="table table-stack">
                      <thead>
                        <tr><th>Buyer</th><th>Rice</th><th className="is-num">Total</th><th>Status</th><th>Date</th></tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id}>
                            <td className="is-primary"><strong>{o.customerName || 'Walk-in'}</strong></td>
                            <td data-label="Rice">{o.productName}</td>
                            <td data-label="Total" className="is-num">{wholePeso(o.total)}</td>
                            <td data-label="Status">{o.status}</td>
                            <td data-label="Date" className="muted">{formatDate(o.orderDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {(analytics.strengths?.length > 0 || analytics.weaknesses?.length > 0 || analytics.suggestions?.length > 0) && (
                <section className="panel">
                  <div className="panel-head"><h3>What the numbers say</h3></div>
                  <ul className="list">
                    {(analytics.strengths || []).map((t) => (
                      <li key={t} className="list-row"><span className="badge badge-success">Strength</span><span>{t}</span></li>
                    ))}
                    {(analytics.weaknesses || []).map((t) => (
                      <li key={t} className="list-row"><span className="badge badge-warning">Weak point</span><span>{t}</span></li>
                    ))}
                    {(analytics.suggestions || []).map((s) => (
                      <li key={s.type} className="list-row"><span className="badge badge-info">Suggestion</span><span>{s.message}</span></li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="stack">
          <section className="panel">
            <div className="panel-head"><h3>Account</h3></div>
            <div className="panel-body">
              <dl className="dl">
                <div><dt>User ID</dt><dd className="num">{user.userId ?? 'None'}</dd></div>
                <div><dt>Role</dt><dd>{ROLE_LABEL[user.role] || user.role}</dd></div>
                <div><dt>Status</dt><dd>{user.status}{user.statusReason ? `: ${user.statusReason}` : ''}</dd></div>
                <div><dt>Email verified</dt><dd>{user.emailVerified ? 'Yes' : 'No'}</dd></div>
                <div><dt>Joined</dt><dd>{formatDate(user.createdAt, 'Unknown')}</dd></div>
                <div><dt>Last sign-in</dt><dd>{formatDate(user.lastLogin, 'Never')}</dd></div>
                {user.contact && <div><dt>Mobile</dt><dd>{user.contact}</dd></div>}
              </dl>
            </div>
          </section>
        </aside>
      </div>

      {isSeller && user.userId != null && (
        fullAnalytics ? (
          <SellerAnalytics base={`/analytics/platform/sellers/${user.userId}`} heading={<h3 className="an-seller-title">Full analytics for {user.name}</h3>} />
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setFullAnalytics(true)}>
            Open full seller analytics
          </button>
        )
      )}
    </div>
  );
}
