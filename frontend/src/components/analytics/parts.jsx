import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Info, Minus, Search, TrendingDown, TrendingUp,
} from 'lucide-react';
import { deltaText, formatValue } from './format';

/** A panel with a title, optional subtitle and actions on the right. */
export function Panel({ title, subtitle, actions, children, className = '', id }) {
  return (
    <section className={`panel an-panel ${className}`} id={id}>
      {(title || actions) && (
        <div className="an-panel-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="an-panel-actions">{actions}</div>}
        </div>
      )}
      <div className="an-panel-body">{children}</div>
    </section>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="an-empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Loading({ rows = 2 }) {
  return (
    <div className="an-loading" aria-busy="true" aria-label="Loading analytics">
      <div className="skeleton" style={{ height: 92 }} />
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 260 }} />)}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="alert alert-danger an-error" role="alert">
      <span>{message}</span>
      {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** A tiny trend line for a KPI. Decorative: the number beside it is the data. */
export function Sparkline({ values, color = 'var(--g700)' }) {
  const clean = values.map((v) => Number(v) || 0);
  if (clean.length < 2 || clean.every((v) => v === 0)) return null;
  const max = Math.max(...clean);
  const min = Math.min(...clean);
  const w = 96;
  const h = 26;
  const d = clean.map((v, i) => `${i ? 'L' : 'M'}${((i / (clean.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join('');
  return (
    <svg className="an-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A metric with its comparison. The change is spelled out ("+12% (+₱3,400)
 * vs the previous 30 days"), and when there is no baseline it says so rather
 * than printing a percentage of zero.
 */
export function KpiCard({ kpi, compareLabel, trend, onClick }) {
  const d = compareLabel ? deltaText(kpi.change, kpi.format, compareLabel) : null;
  const good = d && d.dir !== 0 ? (kpi.lowerIsBetter ? d.dir < 0 : d.dir > 0) : null;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`an-kpi${onClick ? ' is-link' : ''}`} onClick={onClick}>
      <span className="an-kpi-label">{kpi.label}</span>
      <span className="an-kpi-value">{formatValue(kpi.value, kpi.format)}</span>
      {d ? (
        <span className={`an-kpi-delta ${good == null ? '' : good ? 'is-good' : 'is-bad'}`}>
          {d.dir > 0 ? <ArrowUpRight size={14} aria-hidden="true" /> : d.dir < 0 ? <ArrowDownRight size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
          {d.text}
        </span>
      ) : kpi.change !== undefined ? (
        <span className="an-kpi-delta">{kpi.value == null ? 'No completed orders yet' : 'No comparison selected'}</span>
      ) : null}
      {kpi.note && <span className="an-kpi-note">{kpi.note}</span>}
      {trend && <Sparkline values={trend} />}
    </Tag>
  );
}

export function KpiRow({ kpis, compareLabel, trends = {}, onOpen }) {
  return (
    <div className="an-kpis">
      {kpis.map((k) => (
        <KpiCard key={k.id} kpi={k} compareLabel={compareLabel} trend={trends[k.id]} onClick={onOpen?.[k.id]} />
      ))}
    </div>
  );
}

/**
 * Horizontal bars for rankings. Each row can be a button that applies a
 * filter (click a variety to see only that variety); `selected` marks it.
 */
export function RankBars({ rows, valueType = 'peso', onPick, selected, extra, label }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value) || 0));
  if (!rows.length) return <Empty title="Nothing to rank yet">Completed sales in this period appear here.</Empty>;
  return (
    <ul className="an-rank" aria-label={label}>
      {rows.map((r, i) => {
        const inner = (
          <>
            <span className="an-rank-label" title={r.label}>{r.label}</span>
            <span className="an-rank-track"><span className="an-rank-bar" style={{ width: `${Math.max(1, ((Number(r.value) || 0) / max) * 100)}%`, background: r.color || (i === 0 ? 'var(--g700)' : 'var(--g500)') }} /></span>
            <span className="an-rank-value">{formatValue(r.value, valueType)}{extra && <small>{extra(r)}</small>}</span>
          </>
        );
        return (
          <li key={r.key}>
            {onPick ? (
              <button type="button" className={`an-rank-row${selected === r.key ? ' is-selected' : ''}`} aria-pressed={selected === r.key} onClick={() => onPick(r)}>
                {inner}
              </button>
            ) : <div className="an-rank-row">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** One 100% bar split by parts, with a legend that carries the numbers. */
export function ShareBar({ parts, label, unit = 'orders' }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <Empty title={`No ${unit} in this period`} />;
  return (
    <div className="an-share">
      <div className="an-share-bar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <ul className="an-share-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            <strong>{p.value.toLocaleString('en-PH')}</strong>
            <small>{Math.round((p.value / total) * 1000) / 10}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A sortable, searchable, paged table. Rows scroll sideways on a phone rather
 * than squeezing every column into a third of the screen.
 */
export function DataTable({ columns, rows, rowKey = (r, i) => i, searchKeys = [], pageSize = 10, empty = 'Nothing to show.', initialSort, caption }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort || null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q ? rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q))) : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const get = col?.sortValue || ((r) => r[sort.key]);
      list = [...list].sort((a, b) => {
        const x = get(a);
        const y = get(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [rows, query, sort, columns, searchKeys]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize);

  const toggle = (key) => {
    setPage(0);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  return (
    <div className="an-table">
      {searchKeys.length > 0 && (
        <label className="an-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search</span>
          <input className="input" type="search" placeholder="Search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
        </label>
      )}
      <div className="table-wrap an-scroll">
        <table className="table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.align === 'right' ? 'is-num' : ''} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable === false ? c.label : (
                    <button type="button" className="an-sort" onClick={() => toggle(c.key)}>
                      {c.label}
                      {sort?.key === c.key && (sort.dir === 'asc' ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />)}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length ? visible.map((r, i) => (
              <tr key={rowKey(r, i)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'is-num' : c.primary ? 'is-primary' : ''}>
                    {c.render ? c.render(r) : formatValue(r[c.key], c.type) }
                  </td>
                ))}
              </tr>
            )) : (
              <tr><td colSpan={columns.length} className="an-table-empty">{query ? 'No rows match that search.' : empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > pageSize && (
        <div className="an-pager">
          <span>{current * pageSize + 1}–{Math.min(filtered.length, (current + 1) * pageSize)} of {filtered.length}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

const TONE_ICON = {
  good: TrendingUp, bad: TrendingDown, warning: AlertTriangle, neutral: Info,
};
const CATEGORY = {
  highlights: 'Highlight', growth: 'Growth and decline', products: 'Products', buyers: 'Buyers',
  inventory: 'Inventory', unusual: 'Unusual change', attention: 'Needs attention',
};

/**
 * Findings computed on the server from the same numbers as the charts. Each
 * names its figures and comparison period; "Show me" opens the view with the
 * evidence, keeping the current filters.
 */
export function InsightList({ insights, onOpen, empty = 'No findings for this period yet.' }) {
  if (!insights?.length) return <Empty title={empty} />;
  return (
    <ul className="an-insights">
      {insights.map((i) => {
        const Icon = TONE_ICON[i.tone] || Info;
        return (
          <li key={i.id} className={`an-insight is-${i.tone}`}>
            <Icon size={17} aria-hidden="true" />
            <div>
              <span className="an-insight-cat">{CATEGORY[i.category] || 'Finding'}</span>
              <strong>{i.title}</strong>
              <p>{i.detail}</p>
              {onOpen && i.link && <button type="button" className="link an-insight-link" onClick={() => onOpen(i.link)}>Show me</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Notice({ children }) {
  return <p className="an-notice"><Info size={14} aria-hidden="true" />{children}</p>;
}
