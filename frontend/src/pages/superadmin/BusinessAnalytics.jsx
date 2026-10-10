import React, { useEffect, useState } from 'react';
import { Receipt, ShoppingBag, Store, Wallet } from 'lucide-react';
import { fetchBusinessAnalytics } from '../../services/superAdminApi';
import { getErrorMessage } from '../../services/authApi';
import { wholePeso, number, formatDate } from '../../utils/format';

/*
 * Order states, grouped the way the platform reads them. "Completed" means
 * the buyer confirmed (or the seller closed it), which is also what the
 * Completed orders figure above counts, so the two always agree.
 */
const STATUS_GROUPS = [
  { key: 'completed', label: 'Completed', statuses: ['completed'], color: 'var(--accent)' },
  { key: 'delivered', label: 'Delivered, awaiting buyer', statuses: ['delivered'], color: '#6fa585' },
  { key: 'active', label: 'In progress', statuses: ['pending', 'confirmed', 'processing', 'shipped'], color: '#c99a2e' },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'], color: 'var(--border-strong)' },
];

export default function BusinessAnalytics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchBusinessAnalytics()
      .then((res) => setData(res.data))
      .catch((err) => setError(getErrorMessage(err, 'Could not load the analytics.')));
  }, []);

  if (error) return <p className="alert alert-danger">{error}</p>;
  if (!data) {
    return (
      <>
        <div className="skeleton" style={{ height: 96 }} />
        <div className="skeleton" style={{ height: 300 }} />
      </>
    );
  }

  const sellers = data.sellers || [];
  const statusMix = data.statusMix || [];
  const groups = STATUS_GROUPS.map((g) => ({
    ...g,
    value: statusMix.filter((s) => g.statuses.includes(s.status)).reduce((sum, s) => sum + s.count, 0),
  }));
  const totalOrders = groups.reduce((sum, g) => sum + g.value, 0);

  return (
    <>
      <div className="stats">
        <div className="stat">
          <span className="stat-icon"><Wallet size={19} aria-hidden="true" /></span>
          <span className="stat-label">Sales on AgriFair</span>
          <span className="stat-value">{wholePeso(data.gmv)}</span>
          <span className="stat-note">{wholePeso(data.gmvLast30Days)} in the last 30 days</span>
        </div>
        <div className="stat stat--gold">
          <span className="stat-icon"><ShoppingBag size={19} aria-hidden="true" /></span>
          <span className="stat-label">Completed orders</span>
          <span className="stat-value">{number(data.orderCount)}</span>
          <span className="stat-note">{number(data.unitsSold)} sacks sold in total</span>
        </div>
        <div className="stat">
          <span className="stat-icon"><Receipt size={19} aria-hidden="true" /></span>
          <span className="stat-label">Average order</span>
          <span className="stat-value">{wholePeso(data.avgOrderValue)}</span>
          <span className="stat-note">Across completed orders</span>
        </div>
        <div className="stat stat--gold">
          <span className="stat-icon"><Store size={19} aria-hidden="true" /></span>
          <span className="stat-label">Sellers with sales</span>
          <span className="stat-value">{number(data.activeSellers)}<small>of {number(data.totalSellers)}</small></span>
          <span className="stat-note">{data.participationRate}% have made a sale</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>All orders by status</h2>
            <p>{number(totalOrders)} orders placed so far.</p>
          </div>
        </div>
        <div className="panel-body stack">
          {totalOrders === 0 ? (
            <p className="muted">No orders yet.</p>
          ) : (
            <>
              <div className="status-bar" role="img" aria-label={groups.map((g) => `${g.label}: ${g.value}`).join(', ')}>
                {groups.filter((g) => g.value > 0).map((g) => (
                  <span key={g.key} style={{ flexGrow: g.value, background: g.color }} />
                ))}
              </div>
              <ul className="status-legend">
                {groups.map((g) => (
                  <li key={g.key}>
                    <i style={{ background: g.color }} aria-hidden="true" />
                    {g.label}
                    <strong className="num">{number(g.value)}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <div className="split-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Sellers</h2>
              <p>Ranked by sales from completed orders.</p>
            </div>
          </div>
          {sellers.length === 0 ? (
            <div className="empty"><p>No seller accounts yet.</p></div>
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>Seller</th>
                    <th className="is-num">Sales</th>
                    <th className="is-num">Share</th>
                    <th className="is-num">Orders</th>
                    <th className="is-num">Buyers</th>
                    <th>Last sale</th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((s) => (
                    <tr key={s.sellerId}>
                      <td className="is-primary">
                        <span className="cell-main">
                          <strong>{s.name}</strong>
                          {(!s.exists || s.status !== 'active') && (
                            <span>{!s.exists ? 'Account removed' : s.status === 'pending' ? 'Waiting for approval' : s.status}</span>
                          )}
                        </span>
                      </td>
                      <td data-label="Sales" className="is-num">{wholePeso(s.revenue)}</td>
                      <td data-label="Share" className="is-num">{s.share ? `${s.share}%` : 'None'}</td>
                      <td data-label="Orders" className="is-num">{number(s.orders)}</td>
                      <td data-label="Buyers" className="is-num">{number(s.customers)}</td>
                      <td data-label="Last sale" className="muted">{formatDate(s.lastSale, 'No sales yet')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Best-selling rice</h2></div>
          {(data.topProducts || []).length === 0 ? (
            <div className="empty"><p>Nothing has sold yet.</p></div>
          ) : (
            <ol className="list">
              {data.topProducts.map((p) => (
                <li key={p.productId} className="list-row">
                  <span className="list-row-main">
                    <strong>{p.name}</strong>
                    <span>{number(p.units)} sold</span>
                  </span>
                  <span className="num">{wholePeso(p.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
