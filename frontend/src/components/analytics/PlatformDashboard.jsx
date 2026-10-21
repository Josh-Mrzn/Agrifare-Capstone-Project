import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchSection } from '../../services/analyticsApi';
import { approveSeller, rejectSeller } from '../../services/superAdminApi';
import { getErrorMessage } from '../../services/authApi';
import Modal from '../Modal';
import { COLORS, peso, bucketLabel, formatKpi } from './dashboardFormat';
import { Delta, ChartCanvas } from './DashboardParts';
import { rangeLabel, formatDay } from './format';
import './analytics.css';
import './dashboard.css';

/**
 * The Super Admin's one-page marketplace analytics: Daily, Weekly, Monthly
 * or Yearly. Sales come from /analytics/platform/dashboard, which uses the
 * same definitions as every report; accounts and applications come from the
 * accounts themselves. Pending applications can be approved or rejected
 * here, with the same checks as the Users page.
 */

const MODES = [
  { id: 'daily', label: 'Daily', trend: 'last 14 days' },
  { id: 'weekly', label: 'Weekly', trend: 'last 12 weeks' },
  { id: 'monthly', label: 'Monthly', trend: 'last 12 months' },
  { id: 'yearly', label: 'Yearly', trend: 'by year' },
];

const GREEN = '#1f4d2b';
const GOLD = '#c9a24a';
const RED = '#a4452c';

export default function PlatformDashboard({ greeting, onChanged }) {
  const [mode, setMode] = useState('monthly');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchSection('/analytics/platform', 'dashboard', { mode }, controller.signal)
      .then((res) => { setData(res.data); setError(''); })
      .catch((err) => {
        if (!controller.signal.aborted) setError(getErrorMessage(err, 'Could not load the marketplace analytics.'));
      });
    return () => controller.abort();
  }, [mode, version]);

  const decide = useCallback(async (fn, done, fallback) => {
    setNotice(null);
    try {
      await fn();
      setNotice({ ok: true, text: done });
      setVersion((v) => v + 1);
      onChanged?.();
      return true;
    } catch (err) {
      setNotice({ ok: false, text: getErrorMessage(err, fallback) });
      return false;
    }
  }, [onChanged]);

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
        {data && <span className="ad-note">{rangeLabel(data.period.from, data.period.to)}</span>}
      </div>

      {error && <p className="alert alert-danger" role="alert">{error}</p>}
      {notice && <p className={`alert ${notice.ok ? 'alert-success' : 'alert-danger'}`} role="status">{notice.text}</p>}
      {!data && !error && <div className="skeleton" style={{ height: 420 }} />}
      {data && (
        <Body
          data={data}
          mode={mode}
          selected={selected}
          onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
          onApprove={(a) => decide(() => approveSeller(a.userId), `${a.name} is approved and can now list rice.`, 'Could not approve this seller.')}
          onReject={setRejecting}
        />
      )}

      {rejecting && (
        <RejectDialog
          seller={rejecting}
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            if (await decide(() => rejectSeller(rejecting.userId, reason), `${rejecting.name}'s application was rejected.`, 'Could not reject this application.')) {
              setRejecting(null);
            }
          }}
        />
      )}
    </div>
  );
}

function Body({ data, mode, selected, onSelect, onApprove, onReject }) {
  const { kpis, series, applications, accountSeries, topSellers, varieties, varietiesBySeller, pendingApplications, banner } = data;
  const modeInfo = MODES.find((m) => m.id === mode);
  const selectedSeller = topSellers.find((s) => s.sellerId === selected);
  const shownVarieties = useMemo(
    () => (selected != null ? (varietiesBySeller[selected] || []) : varieties),
    [selected, varietiesBySeller, varieties],
  );
  const maxSales = Math.max(1, ...topSellers.map((s) => s.sales));
  const trend = useMemo(() => ({
    type: mode === 'yearly' ? 'bar' : 'line',
    data: {
      labels: series.map((b) => `${bucketLabel(b.start, mode)}${b.partial ? ' (so far)' : ''}`),
      datasets: [{
        data: series.map((b) => b.sales || 0),
        borderColor: GREEN,
        backgroundColor: mode === 'yearly' ? GREEN : 'rgba(31,77,43,0.13)',
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

  const apps = useMemo(() => ({
    type: 'doughnut',
    data: {
      labels: ['Approved', 'Pending', 'Rejected'],
      datasets: [{ data: [applications.approved, applications.pending, applications.rejected], backgroundColor: [GREEN, GOLD, RED], borderWidth: 0 }],
    },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } },
  }), [applications]);

  const accounts = useMemo(() => ({
    type: 'bar',
    data: {
      labels: accountSeries.map((b) => bucketLabel(b.start, mode)),
      datasets: [
        { label: 'Buyers', data: accountSeries.map((b) => b.buyers), backgroundColor: GREEN, borderRadius: 4, maxBarThickness: 60 },
        { label: 'Sellers', data: accountSeries.map((b) => b.sellers), backgroundColor: GOLD, borderRadius: 4, maxBarThickness: 60 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
    },
  }), [accountSeries, mode]);

  const best = useMemo(() => ({
    type: 'bar',
    data: {
      labels: shownVarieties.map((v) => v.variety),
      datasets: [{ data: shownVarieties.map((v) => v.sales), backgroundColor: shownVarieties.map((_, i) => COLORS[i % COLORS.length]), borderRadius: 6 }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => peso(c.parsed.x) } } },
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => peso(v) } }, y: { grid: { display: false } } },
    },
  }), [shownVarieties]);

  const hasSales = series.some((b) => b.sales > 0);
  const hasAccounts = accountSeries.some((b) => b.buyers + b.sellers > 0);

  return (
    <>
      <div className="ad-ban">
        {banner.topSeller
          ? <><b>{banner.topSeller.name}</b> made {banner.topSeller.share}% of marketplace sales in this period. </>
          : 'No completed sales in this period. '}
        {banner.pending
          ? <><b>{banner.pending}</b> seller application{banner.pending > 1 ? 's are' : ' is'} waiting for review.</>
          : 'No seller applications are waiting.'}
      </div>

      <div className="ad-kpis ad-kpis-6">
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
          <h2>Marketplace sales: {modeInfo.trend}</h2>
          <p className="ad-note">Completed orders from all sellers</p>
          <div className="ad-ch">
            {hasSales ? <ChartCanvas config={trend} label="Marketplace sales" /> : <p className="ad-empty">No completed sales in this period yet.</p>}
          </div>
        </section>
        <section className="ad-card">
          <h2>Seller applications</h2>
          <p className="ad-note">All time, by status</p>
          <div className="ad-ch">
            {applications.approved + applications.pending + applications.rejected > 0
              ? <ChartCanvas config={apps} label="Seller applications by status" />
              : <p className="ad-empty">No seller applications yet.</p>}
          </div>
        </section>
      </div>

      <div className="ad-grid2">
        <section className="ad-card">
          <h2>New accounts</h2>
          <p className="ad-note">Buyers and sellers who signed up</p>
          <div className="ad-ch">
            {hasAccounts ? <ChartCanvas config={accounts} label="New buyer and seller accounts" /> : <p className="ad-empty">Nobody signed up in this period.</p>}
          </div>
        </section>
        <section className="ad-card">
          <h2>Top sellers</h2>
          <p className="ad-note">By completed sales. Click a seller to see their best-selling rice.</p>
          <div className="ad-sellers">
            {topSellers.length === 0 && <p className="ad-note">No approved sellers yet.</p>}
            {topSellers.map((s) => (
              <button
                key={s.sellerId}
                type="button"
                className={`ad-srow${selected === s.sellerId ? ' on' : ''}`}
                aria-pressed={selected === s.sellerId}
                onClick={() => onSelect(s.sellerId)}
              >
                <span className="ad-srow-name">{s.name}</span>
                <span className="ad-srow-track"><i style={{ width: `${(s.sales / maxSales) * 100}%` }} /></span>
                <span className="ad-srow-value">{peso(s.sales)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="ad-grid2">
        <section className="ad-card">
          <h2>Best-selling rice: {selectedSeller ? selectedSeller.name : 'all sellers'}</h2>
          <p className="ad-note">By sales in the selected period</p>
          <div className="ad-ch">
            {shownVarieties.length ? <ChartCanvas config={best} label="Best-selling rice by sales" /> : <p className="ad-empty">Nothing sold in this period.</p>}
          </div>
        </section>
        <section className="ad-card">
          <h2>Pending seller applications</h2>
          <p className="ad-note">Review and approve or reject new sellers</p>
          <div className="ad-apps">
            {pendingApplications.length === 0 && <p className="ad-note">No applications are waiting.</p>}
            {pendingApplications.map((a) => (
              <div className="ad-app" key={a.userId}>
                <div>
                  <b>{a.name}</b>
                  <p className="ad-note">
                    Applied {formatDay(a.submittedAt)}, {a.permits} permit{a.permits === 1 ? '' : 's'} ({a.verifiedPermits} verified)
                  </p>
                </div>
                <div className="ad-app-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!a.verifiedPermits}
                    title={a.verifiedPermits ? undefined : 'Verify a permit under Credentials first'}
                    onClick={() => onApprove(a)}
                  >
                    Approve
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onReject(a)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function RejectDialog({ seller, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Reject ${seller.name}?`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          setBusy(true);
          await onConfirm(reason.trim());
          setBusy(false);
        }}
      >
        <div className="modal-body">
          <p>They see your reason, can fix their application and submit it again.</p>
          <label className="field">
            <span className="field-label">Reason</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The permit photo is unreadable…" autoComplete="off" />
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
