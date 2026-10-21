import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { API_ORIGIN } from '../../services/authApi';
import { formatDate, initialsOf } from '../../utils/format';
import BuyerProfile from '../../components/analytics/BuyerProfile';
import SellerDashboard from '../../components/analytics/SellerDashboard';

const ROLE_LABEL = { seller: 'Seller', buyer: 'Buyer', rider: 'Rider', superadmin: 'Super Admin' };

export default function UserDetailView({ user, onBack, onEdit, onToggleStatus }) {
  const isSeller = user.role === 'seller';

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [user.userId]);

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
            {user.role !== 'superadmin' && ['active', 'suspended'].includes(user.status) && (
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
          ) : (
            <section className="panel">
              <div className="panel-body">
                <p className="muted">This seller's sales, products and buyers are below, worked out exactly as the seller sees them.</p>
              </div>
            </section>
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
        <>
          <h3 className="an-seller-title">Analytics for {user.name}</h3>
          <SellerDashboard base={`/analytics/platform/sellers/${user.userId}`} />
        </>
      )}
    </div>
  );
}
