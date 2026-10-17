import React from 'react';
import { CalendarRange, RotateCcw, X } from 'lucide-react';
import { formatStamp, rangeLabel } from './format';
import { RANGE_OPTIONS, DEFAULT_FILTERS, STATUS_LABEL } from './filters';

/**
 * The global filters. `show` says which ones affect the current view, so a
 * filter that would do nothing is not offered. Everything active is listed
 * as a removable chip, with the exact dates it resolved to.
 */
export default function FilterBar({ filters, onChange, options = {}, show = {}, period, updatedAt }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const custom = filters.range === 'custom';
  const productName = options.products?.find((p) => p.id === filters.productId)?.name;

  const chips = [
    filters.variety && { key: 'variety', label: `Variety: ${filters.variety}`, clear: { variety: '' } },
    filters.productId && { key: 'productId', label: `Product: ${productName || 'selected'}`, clear: { productId: '' } },
    filters.status && show.status && { key: 'status', label: `Status: ${STATUS_LABEL[filters.status]}`, clear: { status: '' } },
  ].filter(Boolean);

  const isDefault = JSON.stringify({ ...filters }) === JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="an-filters" role="search" aria-label="Analytics filters">
      <div className="an-filter-row">
        {show.range !== false && (
        <label className="an-field">
          <span>Date range</span>
          <select className="select" value={filters.range} onChange={(e) => set({ range: e.target.value, ...(e.target.value === 'custom' && !filters.from && period ? { from: period.from, to: period.to } : {}) })}>
            {RANGE_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        )}
        {custom && show.range !== false && (
          <>
            <label className="an-field">
              <span>From</span>
              <input className="input" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label className="an-field">
              <span>To</span>
              <input className="input" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
            </label>
          </>
        )}
        {show.compare !== false && (
          <label className="an-field">
            <span>Compare with</span>
            <select className="select" value={filters.compare} onChange={(e) => set({ compare: e.target.value })}>
              <option value="previous">Previous period</option>
              <option value="yoy">Same period last year</option>
              <option value="none">No comparison</option>
            </select>
          </label>
        )}
        {show.granularity !== false && (
          <label className="an-field">
            <span>Group by</span>
            <select className="select" value={filters.granularity} onChange={(e) => set({ granularity: e.target.value })}>
              <option value="auto">Automatic</option>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
            </select>
          </label>
        )}
        {show.variety && (
          <label className="an-field">
            <span>Variety</span>
            <select className="select" value={filters.variety} onChange={(e) => set({ variety: e.target.value, productId: '' })}>
              <option value="">All varieties</option>
              {(options.varieties || []).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        )}
        {show.product && options.products?.length > 0 && (
          <label className="an-field">
            <span>Product</span>
            <select className="select" value={filters.productId} onChange={(e) => set({ productId: e.target.value })}>
              <option value="">All products</option>
              {options.products.filter((p) => !filters.variety || p.variety === filters.variety).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {show.status && (
          <label className="an-field">
            <span>Order status</span>
            <select className="select" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        {!isDefault && (
          <button type="button" className="btn btn-ghost btn-sm an-reset" onClick={() => onChange(DEFAULT_FILTERS)}>
            <RotateCcw size={14} aria-hidden="true" /> Reset
          </button>
        )}
      </div>
      <div className="an-filter-summary" aria-live="polite">
        {period && show.range !== false && (
          <span className="an-active-range">
            <CalendarRange size={14} aria-hidden="true" />
            <strong>{rangeLabel(period.from, period.to)}</strong>
            {period.comparison && <span>vs {rangeLabel(period.comparison.from, period.comparison.to)}</span>}
          </span>
        )}
        {chips.map((c) => (
          <button key={c.key} type="button" className="an-chip" onClick={() => set(c.clear)} aria-label={`Remove ${c.label}`}>
            {c.label} <X size={12} aria-hidden="true" />
          </button>
        ))}
        {updatedAt && <span className="an-updated">Latest order activity {formatStamp(updatedAt)}</span>}
      </div>
    </div>
  );
}
