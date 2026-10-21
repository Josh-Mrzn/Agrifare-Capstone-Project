import React, { useEffect, useState } from 'react';
import { COLORS, peso, bucketLabel, formatKpi } from './dashboardFormat';
import { Delta, ChartCanvas } from './DashboardParts';
import { fetchSection, fetchOptions } from '../../services/analyticsApi';
import { getErrorMessage } from '../../services/authApi';
import ExportPanel from './ExportPanel';
import { rangeLabel } from './format';
import './analytics.css';
import './dashboard.css';

/**
 * The seller's one-page analytics: Daily, Weekly, Monthly or Yearly, for all
 * rice or one variety. Every number comes from /analytics/.../dashboard,
 * which uses the same definitions as the reports below it (ANALYTICS.md).
 */

const MODES = [
  { id: 'daily', label: 'Daily', trend: 'last 14 days' },
  { id: 'weekly', label: 'Weekly', trend: 'last 12 weeks' },
  { id: 'monthly', label: 'Monthly', trend: 'last 12 months' },
  { id: 'yearly', label: 'Yearly', trend: 'by year' },
];

const REPORTS = [
  { id: 'sales', title: 'Sales report', text: 'Every completed order line with buyer, rice, pack size, fees and total.' },
  { id: 'orders', title: 'Orders and transactions', text: 'Every order line in the period with its order and payment status.' },
  { id: 'products', title: 'Product and variety performance', text: 'Sales, share, quantity and price per kg for each product and variety.' },
  { id: 'buyers', title: 'Buyer analytics', text: 'Buyers with their orders, spend and type, plus past buyers who have gone quiet.' },
];

export default function SellerDashboard({ base = '/analytics/seller', canEmail = false, greeting }) {
  const [mode, setMode] = useState('monthly');
  const [variety, setVariety] = useState('');
  const [varieties, setVarieties] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOptions(base).then((res) => setVarieties(res.data?.varieties || [])).catch(() => {});
  }, [base]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSection(base, 'dashboard', { mode, ...(variety ? { variety } : {}) }, controller.signal)
      .then((res) => { setData(res.data); setError(''); })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(getErrorMessage(err, 'Could not load your analytics.'));
      });
    return () => controller.abort();
  }, [base, mode, variety]);

  const modeInfo = MODES.find((m) => m.id === mode);

  return (
    <div className="ad">
      {greeting && <p className="ad-sub">{greeting}</p>}

      <div className="ad-bar">
        <div className="ad-seg" role="group" aria-label="Period">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {varieties.length > 0 && (
          <div className="ad-seg" role="group" aria-label="Rice variety">
            <button type="button" className={variety === '' ? 'on' : ''} aria-pressed={variety === ''} onClick={() => setVariety('')}>All rice</button>
            {varieties.map((v) => (
              <button key={v} type="button" className={variety === v ? 'on' : ''} aria-pressed={variety === v} onClick={() => setVariety(v)}>{v}</button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="alert alert-danger" role="alert">{error}</p>}
      {!data && !error && <div className="skeleton" style={{ height: 420 }} />}
      {data && <Body data={data} mode={mode} modeInfo={modeInfo} />}

      {data && (
        <div className="ad-reports">
          <ExportPanel
            base={base}
            reports={REPORTS}
            params={{ range: 'custom', from: data.period.from, to: data.period.to, ...(variety ? { variety } : {}) }}
            period={data.period}
            canEmail={canEmail}
          />
        </div>
      )}
    </div>
  );
}

function Body({ data, mode, modeInfo }) {
  const { kpis, series, varieties, products, topBuyers, insights, cancelledOrders } = data;

  const trend = React.useMemo(() => ({
    type: mode === 'yearly' ? 'bar' : 'line',
    data: {
      labels: series.map((b) => `${bucketLabel(b.start, mode)}${b.partial ? ' (so far)' : ''}`),
      datasets: [{
        label: 'Sales',
        data: series.map((b) => b.sales || 0),
        borderColor: '#1f4d2b',
        backgroundColor: mode === 'yearly' ? '#1f4d2b' : 'rgba(31,77,43,0.13)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        borderRadius: 6,
        maxBarThickness: 90,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => peso(c.parsed.y) } } },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => peso(v) } }, x: { grid: { display: false }, offset: mode === 'yearly' } },
    },
  }), [series, mode]);

  const share = React.useMemo(() => ({
    type: 'doughnut',
    data: {
      labels: varieties.map((v) => v.variety),
      datasets: [{ data: varieties.map((v) => v.sales), backgroundColor: COLORS, borderWidth: 0 }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10 } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${peso(c.parsed)}` } },
      },
    },
  }), [varieties]);

  const best = React.useMemo(() => ({
    type: 'bar',
    data: {
      labels: products.map((p) => p.name),
      datasets: [{ data: products.map((p) => p.sales), backgroundColor: products.map((_, i) => COLORS[i % COLORS.length]), borderRadius: 6 }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => peso(c.parsed.x) } } },
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => peso(v) } }, y: { grid: { display: false } } },
    },
  }), [products]);

  const hasSales = series.some((b) => b.sales > 0);

  return (
    <>
      <div className="ad-kpis">
        {kpis.map((k) => (
          <div className="ad-card ad-kpi" key={k.id}>
            <small>{k.label}</small>
            <b>{formatKpi(k)}</b>
            <Delta kpi={k} />
          </div>
        ))}
      </div>

      <div className="ad-grid">
        <section className="ad-card">
          <h2>Sales trend: {modeInfo.trend}</h2>
          <p className="ad-note">Revenue from completed orders, {rangeLabel(data.period.from, data.period.to)}</p>
          <div className="ad-ch">
            {hasSales ? <ChartCanvas config={trend} label="Sales trend" /> : <p className="ad-empty">No completed sales in this period yet.</p>}
          </div>
        </section>
        <section className="ad-card">
          <h2>Share per rice variety</h2>
          <p className="ad-note">Share of revenue</p>
          <div className="ad-ch">
            {varieties.length ? <ChartCanvas config={share} label="Share of revenue per rice variety" /> : <p className="ad-empty">Nothing sold yet.</p>}
          </div>
        </section>
      </div>

      <div className="ad-grid2">
        <section className="ad-card">
          <h2>Best-selling rice</h2>
          <p className="ad-note">By revenue in the selected period</p>
          <div className="ad-ch">
            {products.length ? <ChartCanvas config={best} label="Best-selling rice by revenue" /> : <p className="ad-empty">Nothing sold yet.</p>}
          </div>
        </section>
        <section className="ad-card">
          <h2>Top buyers</h2>
          <p className="ad-note">Your biggest buyers</p>
          <table className="ad-table">
            <thead><tr><th>Buyer</th><th className="n">Orders</th><th className="n">Total</th></tr></thead>
            <tbody>
              {topBuyers.length === 0 ? (
                <tr><td colSpan={3}>No completed orders in this period.</td></tr>
              ) : topBuyers.map((b) => (
                <tr key={b.name}><td>{b.name || 'Walk-in buyer'}</td><td className="n">{b.orders}</td><td className="n">{peso(b.spent)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="ad-card ad-ins">
        <h2>Worth a look</h2>
        {insights.length === 0 && cancelledOrders === 0 ? (
          <p>Nothing stands out in this period.</p>
        ) : (
          <>
            {insights.map((i) => (
              <p key={i.id}><b>{i.title}.</b> {i.detail}</p>
            ))}
          </>
        )}
      </section>
    </>
  );
}
