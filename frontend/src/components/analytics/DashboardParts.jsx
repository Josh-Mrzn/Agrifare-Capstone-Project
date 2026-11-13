import React, { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { useTheme } from '../../theme/theme';

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

// The series colours too dark to read on the dark theme's surface, and what
// stands in for them there.
const ON_DARK = {
  '#1f4d2b': '#6fb36f',
  'rgba(31,77,43,0.13)': 'rgba(111,179,111,0.16)',
  '#6a9a5b': '#9cc98c',
  '#8a5a2b': '#c08a52',
  '#3b3b3b': '#aab3a6',
};
const onDark = (color) => (Array.isArray(color) ? color.map(onDark) : ON_DARK[color] || color);

function forDark(config) {
  const datasets = config.data.datasets.map((set) => ({
    ...set,
    ...(set.borderColor && { borderColor: onDark(set.borderColor) }),
    ...(set.backgroundColor && { backgroundColor: onDark(set.backgroundColor) }),
  }));
  return { ...config, data: { ...config.data, datasets } };
}

/** One Chart.js chart on a canvas, rebuilt when its config or the theme changes. */
export function ChartCanvas({ config, label }) {
  const ref = useRef(null);
  const dark = useTheme() === 'dark';
  useEffect(() => {
    if (!ref.current) return undefined;
    // Axis text and grid lines: Chart.js's own defaults in light.
    Chart.defaults.color = dark ? '#a3ab9d' : '#666';
    Chart.defaults.borderColor = dark ? 'rgba(233,240,225,0.12)' : 'rgba(0,0,0,0.1)';
    const chart = new Chart(ref.current, dark ? forDark(config) : config);
    return () => chart.destroy();
  }, [config, dark]);
  return <canvas ref={ref} role="img" aria-label={label} />;
}
