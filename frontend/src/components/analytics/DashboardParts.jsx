import React, { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export function Delta({ kpi }) {
  if (kpi.note && kpi.previous == null) return <span className="ad-d flat">{kpi.note}</span>;
  const pct = kpi.change?.pct;
  if (pct == null) return <span className="ad-d flat">No comparison available</span>;
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return (
    <span className={`ad-d ${dir}`}>
      {pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}{Math.abs(pct).toFixed(1)}% vs {kpi.vs || 'previous period'}
    </span>
  );
}

/** One Chart.js chart on a canvas, rebuilt when its config changes. */
export function ChartCanvas({ config, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const chart = new Chart(ref.current, config);
    return () => chart.destroy();
  }, [config]);
  return <canvas ref={ref} role="img" aria-label={label} />;
}
