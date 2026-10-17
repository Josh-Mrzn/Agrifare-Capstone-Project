import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { bucketLabel, bucketTitle, formatValue } from './format';

/**
 * The top of the y axis: four equal, round steps (0, 10k, 20k, 30k, 40k).
 * Counts get whole-number steps, so an axis never reads "3.8 orders".
 */
function niceMax(max, integer) {
  if (max <= 0) return integer ? 4 : 1;
  const raw = max / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  if (integer) step = Math.max(1, Math.ceil(step));
  return step * 4;
}

const compact = (v, type) => {
  if (type === 'percent') return `${Math.round(v)}%`;
  const abs = Math.abs(v);
  const s = abs >= 1e6 ? `${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M` : abs >= 1e3 ? `${(v / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k` : `${Math.round(v * 10) / 10}`;
  return type === 'peso' ? `₱${s}` : s;
};

function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * A time chart: line, area, bars or stacked bars over the period's buckets.
 *
 *   points       [{ start, partial, [series.key]: number }]
 *   series       [{ key, label, color, dashed, compareKey? }]
 *   kind         'line' | 'area' | 'bar' | 'stacked'
 *   kinds        optional list the user may switch between
 *   valueType    how values are formatted (peso, number, percent, kg)
 *   onSelect     called with a point on click or Enter - for drilling into a
 *                bucket; the caller decides what that means, nothing navigates
 *
 * Hover, focus and the arrow keys move a cursor across the buckets; the
 * tooltip shows every series' exact value. The same numbers are available as
 * a table under "View as table" for screen readers and for copying.
 */
export default function TimeChart({
  points = [], series, granularity, kind: initialKind = 'line', kinds, valueType = 'number',
  height = 240, onSelect, label, selectHint,
}) {
  const wrap = useRef(null);
  const width = useWidth(wrap);
  const [kind, setKind] = useState(initialKind);
  const [active, setActive] = useState(null);
  const tableId = useId();

  const pad = { top: 14, right: 12, bottom: 26, left: 50 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const stacked = kind === 'stacked';

  const max = useMemo(() => {
    let m = 0;
    for (const p of points) {
      if (stacked) m = Math.max(m, series.reduce((s, x) => s + (Number(p[x.key]) || 0), 0));
      else for (const x of series) m = Math.max(m, Number(p[x.key]) || 0);
    }
    return niceMax(m, valueType === 'number');
  }, [points, series, stacked, valueType]);

  const band = points.length ? innerW / points.length : innerW;
  const xAt = (i) => pad.left + band * i + band / 2;
  const yAt = (v) => pad.top + innerH - ((Number(v) || 0) / max) * innerH;
  // Short charts get three gridlines so their labels never overlap.
  const ticks = (height < 170 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))));
  const hasData = points.some((p) => series.some((x) => Number(p[x.key]) > 0));

  const pickIndex = (clientX) => {
    const rect = wrap.current.getBoundingClientRect();
    const i = Math.floor((clientX - rect.left - pad.left) / band);
    return Math.max(0, Math.min(points.length - 1, i));
  };

  const onKey = (e) => {
    if (!points.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = active == null ? (e.key === 'ArrowRight' ? 0 : points.length - 1) : active + (e.key === 'ArrowRight' ? 1 : -1);
      setActive(Math.max(0, Math.min(points.length - 1, next)));
    } else if (e.key === 'Enter' && active != null && onSelect) {
      onSelect(points[active]);
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  };

  // A missing value (no orders, so no average; no data a year ago) breaks
  // the line instead of being drawn as zero.
  const isGap = (v) => v == null || Number.isNaN(Number(v));
  const linePath = (key) => {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      if (isGap(p[key])) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p[key]).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const barW = Math.max(2, Math.min(36, band * (stacked ? 0.62 : 0.72 / series.length)));
  const point = active != null ? points[active] : null;
  const tipLeft = active != null ? Math.min(Math.max(xAt(active), 90), width - 90) : 0;

  return (
    <div className="an-chart">
      {kinds && kinds.length > 1 && (
        <div className="an-seg" role="group" aria-label="Chart type">
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {{ line: 'Line', area: 'Area', bar: 'Bars', stacked: 'Stacked' }[k]}
            </button>
          ))}
        </div>
      )}
      <div
        ref={wrap}
        className={`an-chart-plot${onSelect ? ' is-selectable' : ''}`}
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={`${label}. ${hasData ? 'Use the left and right arrow keys to read each value' : 'No data for this period'}${onSelect ? `; press Enter to ${selectHint || 'zoom into that period'}` : ''}. A table of the same data follows.`}
        aria-describedby={tableId}
        onKeyDown={onKey}
        onMouseMove={(e) => points.length && setActive(pickIndex(e.clientX))}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onClick={(e) => onSelect && points.length && onSelect(points[pickIndex(e.clientX)])}
      >
        {width > 0 && (
          <svg width={width} height={height} aria-hidden="true">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={yAt(t)} y2={yAt(t)} className="an-gridline" />
                <text x={pad.left - 8} y={yAt(t) + 4} className="an-axis" textAnchor="end">{compact(t, valueType)}</text>
              </g>
            ))}
            {points.map((p, i) => (i % labelEvery === 0 ? (
              <text key={p.key || i} x={xAt(i)} y={height - 8} className="an-axis" textAnchor="middle">{bucketLabel(p.start, granularity)}</text>
            ) : null))}
            {active != null && <rect x={pad.left + band * active} y={pad.top} width={band} height={innerH} className="an-cursor" />}

            {(kind === 'bar' || kind === 'stacked') && points.map((p, i) => {
              let acc = 0;
              return series.map((s, si) => {
                const v = Number(p[s.key]) || 0;
                const x = stacked ? xAt(i) - barW / 2 : xAt(i) - (barW * series.length) / 2 + si * barW;
                const y0 = stacked ? yAt(acc) : yAt(0);
                const y1 = stacked ? yAt(acc + v) : yAt(v);
                acc += v;
                return (
                  <rect
                    key={`${i}-${s.key}`}
                    x={x}
                    y={y1}
                    width={stacked ? barW : barW - 1}
                    height={Math.max(0, y0 - y1)}
                    fill={s.color}
                    opacity={p.partial ? 0.55 : s.dashed ? 0.45 : 1}
                    rx={stacked ? 0 : 2}
                  />
                );
              });
            })}

            {(kind === 'line' || kind === 'area') && series.map((s) => (
              <g key={s.key}>
                {kind === 'area' && !s.dashed && points.length > 1 && !points.some((p) => isGap(p[s.key])) && (
                  <path d={`${linePath(s.key)}L${xAt(points.length - 1)},${yAt(0)}L${xAt(0)},${yAt(0)}Z`} fill={s.color} opacity="0.12" />
                )}
                <path d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.6 : 2.2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
                {points.length <= 40 && points.map((p, i) => (isGap(p[s.key]) ? null : (
                  <circle key={i} cx={xAt(i)} cy={yAt(p[s.key])} r={active === i ? 4.5 : s.dashed ? 0 : 2.6} fill={p.partial ? '#fff' : s.color} stroke={s.color} strokeWidth="1.5" />
                )))}
              </g>
            ))}
          </svg>
        )}
        {point && (
          <div className="an-tip" style={{ left: tipLeft }} role="presentation">
            <strong>{bucketTitle(point.start, granularity)}{point.partial ? ' · so far' : ''}</strong>
            {series.map((s) => (
              <span key={s.key} className="an-tip-row">
                <i style={{ background: s.color, opacity: s.dashed ? 0.5 : 1 }} />
                {s.label}
                {s.dashed && point.previousStart ? ` (${bucketTitle(point.previousStart, granularity)})` : ''}
                <b>{formatValue(point[s.key], valueType)}</b>
              </span>
            ))}
            {onSelect && <em>Click to {selectHint || 'zoom into this period'}</em>}
          </div>
        )}
        {!hasData && width > 0 && <p className="an-chart-empty">Nothing recorded in this period.</p>}
      </div>
      <div className="an-legend">
        {series.map((s) => (
          <span key={s.key}><i className={s.dashed ? 'is-dashed' : ''} style={{ background: s.dashed ? 'transparent' : s.color, borderColor: s.color }} />{s.label}</span>
        ))}
      </div>
      <details className="an-datatable" id={tableId}>
        <summary>View as table</summary>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Period</th>{series.map((s) => <th key={s.key} className="is-num">{s.label}</th>)}</tr></thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.key || i}>
                  <td>{bucketTitle(p.start, granularity)}{p.partial ? ' (so far)' : ''}</td>
                  {series.map((s) => <td key={s.key} className="is-num">{formatValue(p[s.key], valueType)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
