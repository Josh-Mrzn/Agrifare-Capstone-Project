import React, { useEffect, useState } from 'react';
import { Banknote, CircleCheck, Repeat, Timer } from 'lucide-react';
import BarList from '../../../components/BarList';
import { fetchMyOrderAnalytics, fetchMyOrderBreakdown, emailReport, fetchMailStatus } from '../../../services/clientApi';
import { getErrorMessage } from '../../../services/authApi';
import { wholePeso, number, formatDate, monthName } from '../../../utils/format';

const SECTIONS = [
  { id: 'sales', label: 'Sales' },
  { id: 'products', label: 'Varieties and buyers' },
  { id: 'seasons', label: 'Seasons' },
];

/** What each suggestion is about, said plainly. */
const SUGGESTION_TITLE = {
  LOW_STOCK_BESTSELLER: 'Restock your best seller',
  MONTHLY_DECLINE: 'Sales dipped this month',
  NO_RECENT_SALES: 'No sales in 30 days',
  NO_REPEAT_CLIENTS: 'No repeat buyers yet',
  LOW_ORDER_VALUE: 'Small average order',
};

const REPORTS = [
  { type: 'sales', title: 'Sales report', text: 'Every completed order with buyer, rice and amount.' },
  { type: 'inventory', title: 'Inventory report', text: 'Stock on hand, warning levels and stock value.' },
  { type: 'transactions', title: 'Transactions', text: 'Every order with its payment status.' },
];

export default function ReportsTab() {
  const [section, setSection] = useState('sales');
  const [analytics, setAnalytics] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [error, setError] = useState('');
  const [mailReady, setMailReady] = useState(null);
  const [mailBusy, setMailBusy] = useState('');
  const [mailMsg, setMailMsg] = useState(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchMyOrderAnalytics(), fetchMyOrderBreakdown()])
      .then(([a, b]) => {
        if (!mounted) return;
        setAnalytics(a.data);
        setBreakdown(b.data);
      })
      .catch((err) => mounted && setError(getErrorMessage(err, 'Could not load your analytics.')));
    fetchMailStatus()
      .then((res) => mounted && setMailReady(Boolean(res.data?.configured)))
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  async function sendReport(type) {
    setMailBusy(type);
    setMailMsg(null);
    try {
      const res = await emailReport(type);
      setMailMsg({ ok: true, text: `Sent to ${res.data?.to || 'your email'}.` });
    } catch (err) {
      setMailMsg({ ok: false, text: getErrorMessage(err, 'Could not send the report.') });
    } finally {
      setMailBusy('');
    }
  }

  if (error) return <p className="alert alert-danger">{error}</p>;

  if (!analytics || !breakdown) {
    return (
      <>
        <div className="skeleton" style={{ height: 96 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </>
    );
  }

  const monthly = analytics.monthlyIncome || [];
  const change = (() => {
    if (monthly.length < 2) return null;
    const [prev, last] = monthly.slice(-2).map((m) => m.income);
    return prev ? Math.round(((last - prev) / prev) * 100) : null;
  })();

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Analytics">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" className="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {section === 'sales' && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-icon"><Banknote size={19} aria-hidden="true" /></span>
              <span className="stat-label">Sales</span>
              <span className="stat-value">{wholePeso(analytics.totalSales)}</span>
              <span className={`stat-note${change > 0 ? ' is-up' : change < 0 ? ' is-down' : ''}`}>
                {change == null ? 'From completed orders' : `${change > 0 ? '+' : ''}${change}% vs last month`}
              </span>
            </div>
            <div className="stat stat--gold">
              <span className="stat-icon"><Timer size={19} aria-hidden="true" /></span>
              <span className="stat-label">Order to completed</span>
              <span className="stat-value">
                {breakdown.avgFulfillmentDays != null ? <>{breakdown.avgFulfillmentDays}<small>days</small></> : 'None yet'}
              </span>
              <span className="stat-note">Average time</span>
            </div>
            <div className="stat">
              <span className="stat-icon"><Repeat size={19} aria-hidden="true" /></span>
              <span className="stat-label">Repeat buyers</span>
              <span className="stat-value">
                {breakdown.repeatBuyerRate != null ? <>{breakdown.repeatBuyerRate}<small>%</small></> : 'None yet'}
              </span>
              <span className="stat-note">Bought from you more than once</span>
            </div>
            <div className="stat stat--gold">
              <span className="stat-icon"><CircleCheck size={19} aria-hidden="true" /></span>
              <span className="stat-label">Completed vs cancelled</span>
              <span className="stat-value">
                {breakdown.fulfillmentRate != null ? <>{breakdown.fulfillmentRate}<small>%</small></> : 'None yet'}
              </span>
              <span className="stat-note">Orders you completed</span>
            </div>
          </div>

          <div className="split-grid split-grid-even">
            <section className="panel">
              <div className="panel-head"><h2>Sales, last 6 months</h2></div>
              <div className="panel-body">
                {monthly.length === 0
                  ? <p className="muted">Completed orders will show here, month by month.</p>
                  : (
                    <BarList
                      label="Sales by month"
                      rows={monthly.map((m) => ({ key: `${m.year}-${m.month}`, label: monthName(m.month), value: m.income }))}
                      format={wholePeso}
                    />
                  )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head"><h2>Worth a look</h2></div>
              {analytics.suggestions?.length ? (
                <ul className="list">
                  {analytics.suggestions.map((sg) => (
                    <li key={sg.type} className="list-row">
                      <span className="list-row-main">
                        <strong>{SUGGESTION_TITLE[sg.type] || 'Note'}</strong>
                        <span>{sg.message}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty"><p>Nothing needs your attention right now.</p></div>
              )}
            </section>
          </div>
        </>
      )}

      {section === 'products' && (
        <div className="split-grid split-grid-even">
          <section className="panel">
            <div className="panel-head"><h2>Sales by variety</h2></div>
            <div className="panel-body">
              {breakdown.salesByVariety.length === 0
                ? <p className="muted">Shows which varieties sell best, once you have completed orders.</p>
                : (
                  <BarList
                    label="Sales by variety"
                    rows={breakdown.salesByVariety.map((v) => ({ key: v.variety, label: v.variety, value: v.revenue }))}
                    format={wholePeso}
                  />
                )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Top buyers</h2></div>
            {breakdown.topBuyers.length === 0 ? (
              <div className="empty"><p>Your best customers appear here once orders are completed.</p></div>
            ) : (
              <div className="table-wrap">
                <table className="table table-stack">
                  <thead><tr><th>Buyer</th><th className="is-num">Orders</th><th className="is-num">Spent</th><th>Last order</th></tr></thead>
                  <tbody>
                    {breakdown.topBuyers.map((b) => (
                      <tr key={b._id}>
                        <td className="is-primary"><strong>{b._id}</strong></td>
                        <td data-label="Orders" className="is-num">{number(b.totalOrders)}</td>
                        <td data-label="Spent" className="is-num">{wholePeso(b.totalSpent)}</td>
                        <td data-label="Last order" className="muted">{formatDate(b.lastOrderDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {section === 'seasons' && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Sales, last 12 months</h2>
              <p>Your busy and slow months. This describes the past; it is not a forecast.</p>
            </div>
          </div>
          <div className="panel-body stack">
            {breakdown.seasonalTrend.length === 0
              ? <p className="muted">After a few months of sales, this shows your busy and slow seasons.</p>
              : (
                <BarList
                  label="Sales over 12 months"
                  rows={breakdown.seasonalTrend.map((m) => ({ key: `${m.year}-${m.month}`, label: `${monthName(m.month)} ${String(m.year).slice(2)}`, value: m.income }))}
                  format={wholePeso}
                />
              )}
            {breakdown.peakMonthObservation && <p className="muted">{breakdown.peakMonthObservation}</p>}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Email a report</h2>
            <p>Sent as a PDF to your own email address, so business figures never sit in a shared computer&rsquo;s downloads.</p>
          </div>
        </div>
        {mailReady === false && (
          <p className="alert alert-warning report-alert">Emailing reports is not available right now. Please try again later.</p>
        )}
        <ul className="list">
          {REPORTS.map((r) => (
            <li key={r.type} className="list-row">
              <span className="list-row-main">
                <strong>{r.title}</strong>
                <span>{r.text}</span>
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={mailBusy === r.type || mailReady === false}
                onClick={() => sendReport(r.type)}
              >
                {mailBusy === r.type ? 'Sending…' : 'Email me'}
              </button>
            </li>
          ))}
        </ul>
        <div className="live" aria-live="polite">
          {mailMsg && <p className={`alert alert-${mailMsg.ok ? 'success' : 'danger'} report-alert`}>{mailMsg.text}</p>}
        </div>
      </section>
    </>
  );
}
