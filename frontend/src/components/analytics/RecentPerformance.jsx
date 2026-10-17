import React from 'react';
import useAnalytics from './useAnalytics';
import { KpiRow, ErrorState } from './parts';
import './analytics.css';

const PARAMS = { range: '30d', compare: 'previous' };

/**
 * The last 30 days against the 30 before, for the Super Admin's front page.
 * The all-time figures above it stay as they were; this is the period view.
 */
export default function RecentPerformance({ onOpen }) {
  const res = useAnalytics('/analytics/platform', 'overview', PARAMS);
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data) return <div className="skeleton" style={{ height: 110 }} />;
  const pick = ['sales', 'orders', 'aov', 'sellersWithSales'];
  return (
    <section className="an-recent" aria-label="Last 30 days">
      <div className="an-recent-head">
        <span className="eyebrow">Last 30 days</span>
        {onOpen && <button type="button" className="link" onClick={onOpen}>Full analytics</button>}
      </div>
      <KpiRow kpis={res.data.kpis.filter((k) => pick.includes(k.id))} compareLabel="previous 30 days" />
    </section>
  );
}
