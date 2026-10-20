import React, { useEffect, useState } from 'react';
import { Boxes, ChevronRight, Package, ShoppingCart, Wallet } from 'lucide-react';
import BarList from '../../../components/BarList';
import {
  fetchMyProducts, fetchInventorySummary, fetchMyOrders,
} from '../../../services/clientApi';
import { fetchSection } from '../../../services/analyticsApi';
import { wholePeso, number, formatDate } from '../../../utils/format';
import { STATUS_LABEL, statusBadge } from '../orderStatus';

const asList = (data, key) => (Array.isArray(data) ? data : data?.[key] || []);

export default function DashboardTab({ onNavigate }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchMyProducts().catch(() => ({ data: [] })),
      fetchInventorySummary().catch(() => ({ data: null })),
      fetchMyOrders().catch(() => ({ data: [] })),
      // Six months, by month, from the analytics module: the same definition
      // of "sales" as the Analytics page and the reports.
      fetchSection('/analytics/seller', 'overview', { preset: '6m', granularity: 'month', compare: 'previous' }).catch(() => ({ data: null })),
    ]).then(([prod, inv, ord, ana]) => {
      if (!mounted) return;
      setData({
        products: asList(prod.data, 'products'),
        inventory: inv.data,
        orders: asList(ord.data, 'orders'),
        analytics: ana.data,
      });
    });
    return () => { mounted = false; };
  }, []);

  if (!data) {
    return (
      <>
        <div className="skeleton" style={{ height: 96 }} />
        <div className="skeleton" style={{ height: 280 }} />
      </>
    );
  }

  const { products, inventory, orders, analytics } = data;
  const pending = orders.filter((o) => o.status === 'pending');
  const receipts = orders.filter((o) => o.paymentStatus === 'proof_sent' && o.status !== 'cancelled');
  const toShip = orders.filter((o) => o.status === 'processing');
  const lowStock = products.filter(
    (p) => p.status !== 'inactive' && p.stock > 0 && p.stock <= (p.lowStockThreshold ?? 20),
  );
  const soldOut = products.filter((p) => p.status !== 'inactive' && p.stock <= 0);
  const activeProducts = products.filter((p) => p.status !== 'inactive');

  const monthly = analytics?.series || [];
  const salesKpi = analytics?.kpis?.find((k) => k.id === 'sales');
  const change = salesKpi?.change?.pct == null ? null : Math.round(salesKpi.change.pct);
  const monthLabel = (iso) => new Date(iso).toLocaleDateString('en-PH', { month: 'long', timeZone: 'Asia/Manila' });
  const refundsDue = orders.filter((o) => o.paymentStatus === 'refund_due');
  const cancelRequests = orders.filter((o) => o.cancellation?.status === 'requested');
  const problems = orders.filter((o) => o.complaint?.status === 'open');

  const todo = [
    pending.length && { id: 'pending', to: 'orders', text: `${pending.length} new order${pending.length > 1 ? 's' : ''} to accept` },
    receipts.length && { id: 'receipts', to: 'orders', text: `${receipts.length} GCash receipt${receipts.length > 1 ? 's' : ''} to check` },
    cancelRequests.length && { id: 'cancel', to: 'orders', text: `${cancelRequests.length} cancellation request${cancelRequests.length > 1 ? 's' : ''} to answer` },
    refundsDue.length && { id: 'refund', to: 'orders', text: `${refundsDue.length} order line${refundsDue.length > 1 ? 's' : ''} waiting for a refund` },
    problems.length && { id: 'problem', to: 'orders', text: `${problems.length} reported problem${problems.length > 1 ? 's' : ''} to resolve` },
    toShip.length && { id: 'ship', to: 'orders', text: `${toShip.length} order${toShip.length > 1 ? 's' : ''} ready to send out` },
    lowStock.length && { id: 'low', to: 'inventory', text: `${lowStock.length} product${lowStock.length > 1 ? 's' : ''} running low` },
    soldOut.length && { id: 'out', to: 'inventory', text: `${soldOut.length} product${soldOut.length > 1 ? 's' : ''} sold out` },
  ].filter(Boolean);

  const recent = [...orders].sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate)).slice(0, 6);

  return (
    <>
      <div className="stats">
        <button type="button" className="stat" onClick={() => onNavigate('analytics')}>
          <span className="stat-icon"><Wallet size={19} aria-hidden="true" /></span>
          <span className="stat-label">Sales, last 6 months</span>
          <span className="stat-value">{wholePeso(salesKpi?.value)}</span>
          <span className={`stat-note${change > 0 ? ' is-up' : change < 0 ? ' is-down' : ''}`}>
            {change == null ? 'From completed orders' : `${change > 0 ? '+' : ''}${change}% vs the 6 months before`}
          </span>
        </button>
        <button type="button" className="stat stat--gold" onClick={() => onNavigate('orders')}>
          <span className="stat-icon"><ShoppingCart size={19} aria-hidden="true" /></span>
          <span className="stat-label">New orders</span>
          <span className="stat-value">{number(pending.length)}</span>
          <span className="stat-note">Waiting for you to accept</span>
        </button>
        <button type="button" className="stat" onClick={() => onNavigate('products')}>
          <span className="stat-icon"><Package size={19} aria-hidden="true" /></span>
          <span className="stat-label">Products for sale</span>
          <span className="stat-value">{number(activeProducts.length)}</span>
          <span className="stat-note">
            {products.length - activeProducts.length > 0
              ? `${products.length - activeProducts.length} hidden from buyers`
              : 'All listings are visible'}
          </span>
        </button>
        <button type="button" className="stat stat--gold" onClick={() => onNavigate('inventory')}>
          <span className="stat-icon"><Boxes size={19} aria-hidden="true" /></span>
          <span className="stat-label">Rice in stock</span>
          <span className="stat-value">{number(inventory?.totalStock)}<small>kg</small></span>
          <span className={`stat-note${lowStock.length ? ' is-warn' : ''}`}>
            {lowStock.length ? `${lowStock.length} running low` : 'Stock levels are fine'}
          </span>
        </button>
      </div>

      <div className="dash-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head"><div><span className="eyebrow">Needs you</span><h2>To do</h2></div></div>
            {todo.length === 0 ? (
              <div className="empty"><p>You are all caught up.</p></div>
            ) : (
              <ul className="list">
                {todo.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="list-row" onClick={() => onNavigate(item.to)}>
                      <span className="list-row-main"><strong>{item.text}</strong></span>
                      <ChevronRight size={16} className="muted" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><div><span className="eyebrow">Revenue</span><h2>Sales by month</h2></div></div>
            <div className="panel-body">
              {!monthly.some((m) => m.sales > 0) ? (
                <p className="muted">Completed orders will show here, month by month.</p>
              ) : (
                <BarList
                  label="Sales by month"
                  rows={monthly.map((m) => ({ key: m.start, label: `${monthLabel(m.start)}${m.partial ? ' (so far)' : ''}`, value: m.sales }))}
                  format={wholePeso}
                />
              )}
            </div>
          </section>
        </div>

        <section className="panel">
          <div className="panel-head">
            <div><span className="eyebrow">Latest</span><h2>Recent orders</h2></div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => onNavigate('orders')}>
              All orders
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="empty">
              <strong>No orders yet</strong>
              <p>Orders from the app appear here as soon as a buyer checks out.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr><th>Order</th><th>Status</th><th className="is-num">Total</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {recent.map((o) => (
                    <tr key={o._id}>
                      <td className="is-primary">
                        <span className="cell-main"><strong>{o.orderNumber}</strong><span>{o.customerName}</span></span>
                      </td>
                      <td data-label="Status"><span className={statusBadge(o.status)}>{STATUS_LABEL[o.status] || o.status}</span></td>
                      <td data-label="Total" className="is-num">{wholePeso(o.total)}</td>
                      <td data-label="Date" className="muted">{formatDate(o.orderDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
