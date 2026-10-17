import React, { useEffect, useState } from 'react';
import { fetchBuyerProfile } from '../../services/analyticsApi';
import { getErrorMessage } from '../../services/authApi';
import TimeChart from './TimeChart';
import { Panel, KpiRow, ShareBar, ErrorState, Notice } from './parts';
import { PALETTE, STATUS_COLORS, formatDay } from './format';
import './analytics.css';

/**
 * A buyer's own record, for the Super Admin: what they spent, not what anyone
 * sold. Spending counts completed orders only, the same rule as sales.
 */
export default function BuyerProfile({ userId }) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    fetchBuyerProfile(userId)
      .then((res) => setState({ data: res.data, error: '' }))
      .catch((err) => setState({ data: null, error: getErrorMessage(err, 'Could not load this buyer.') }));
  }, [userId]);

  if (state.error) return <ErrorState message={state.error} />;
  const d = state.data;
  if (!d) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <div className="an">
      <KpiRow
        compareLabel="previous 90 days"
        kpis={[
          { id: 'spent', label: 'Spent, all time', value: d.spent, format: 'peso', note: 'Completed orders only' },
          { id: 'orders', label: 'Completed orders', value: d.completedOrders, format: 'number', note: `From ${d.sellers} seller${d.sellers === 1 ? '' : 's'}` },
          { id: 'aov', label: 'Average order', value: d.aov, format: 'peso' },
          { id: 'recent', label: 'Spent, last 90 days', value: d.last90.spent, format: 'peso', change: d.change, note: `${d.last90.orders} orders` },
          { id: 'gap', label: 'Days between orders', value: d.avgDaysBetweenOrders, format: 'decimal', note: 'Average, completed orders' },
        ]}
      />
      <div className="an-grid an-grid-main">
        <Panel title="Spending by month" subtitle="Completed orders over the last twelve months.">
          <TimeChart points={d.monthly} series={[{ key: 'sales', label: 'Spent', color: PALETTE[0] }]} granularity="month" kind="bar" valueType="peso" height={200} label="Monthly spending" />
        </Panel>
        <Panel title="Orders by status" subtitle={`Last order ${formatDay(d.lastOrder)}.`}>
          <ShareBar label="Orders by status" parts={[
            { key: 'c', label: 'Completed', value: d.status.completed, color: STATUS_COLORS.completed },
            { key: 'p', label: 'In progress', value: d.status.inProgress, color: STATUS_COLORS.inProgress },
            { key: 'x', label: 'Cancelled', value: d.status.cancelled, color: STATUS_COLORS.cancelled },
          ]} />
          <Notice>A checkout from two sellers counts as two orders here, one per seller.</Notice>
        </Panel>
      </div>
    </div>
  );
}
