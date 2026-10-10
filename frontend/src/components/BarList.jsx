import React from 'react';

/**
 * A ranked or time series as horizontal bars.
 * `rows`: [{ key, label, value }]; `format` renders the value.
 */
export default function BarList({ rows, format = String, label }) {
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);

  return (
    <ul className="bars" aria-label={label}>
      {rows.map((row) => (
        <li className="bar-row" key={row.key}>
          <span className="bar-label" title={row.label}>{row.label}</span>
          <span className="bar" style={{ width: `${Math.max(1, (Number(row.value) / max) * 100)}%` }} />
          <span className="bar-value">{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}
