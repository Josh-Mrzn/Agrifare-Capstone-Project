import { peso, wholePeso, number } from '../../utils/format';

/**
 * Formatting for analytics values. Everything is shown in Philippine time,
 * the same zone the server buckets in, so a bar labelled "Oct 6" holds the
 * orders a seller would call Oct 6 wherever the browser happens to be.
 */
const TZ = 'Asia/Manila';
const fmt = (opts) => new Intl.DateTimeFormat('en-PH', { timeZone: TZ, ...opts });
const dayFmt = fmt({ month: 'short', day: 'numeric' });
const dayYearFmt = fmt({ month: 'short', day: 'numeric', year: 'numeric' });
const monthFmt = fmt({ month: 'short', year: '2-digit' });
const monthLongFmt = fmt({ month: 'long', year: 'numeric' });
const stampFmt = fmt({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export const formatValue = (value, type) => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  switch (type) {
    case 'peso': return wholePeso(value);
    case 'pesoExact': return peso(value);
    case 'percent': return `${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 1 })}%`;
    case 'kg': return `${number(Math.round(value))} kg`;
    case 'days': return `${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 1 })} days`;
    case 'decimal': return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 2 });
    default: return number(value);
  }
};

/** Short axis/tick label for a bucket. */
export function bucketLabel(start, granularity) {
  const d = new Date(start);
  switch (granularity) {
    case 'month': return monthFmt.format(d);
    case 'quarter': {
      const m = Number(fmt({ month: 'numeric' }).format(d));
      return `Q${Math.ceil(m / 3)} ’${fmt({ year: '2-digit' }).format(d)}`;
    }
    default: return dayFmt.format(d);
  }
}

/** Full label for a tooltip. */
export function bucketTitle(start, granularity) {
  const d = new Date(start);
  switch (granularity) {
    case 'week': return `Week of ${dayYearFmt.format(d)}`;
    case 'month': return monthLongFmt.format(d);
    case 'quarter': return bucketLabel(start, 'quarter');
    default: return dayYearFmt.format(d);
  }
}

export const formatDay = (value) => (value ? dayYearFmt.format(new Date(value)) : '—');
export const formatStamp = (value) => (value ? stampFmt.format(new Date(value)) : '—');

/** "Sep 18 – Oct 17, 2026" from a period's inclusive from/to (YYYY-MM-DD). */
export function rangeLabel(from, to) {
  if (!from || !to) return '';
  const a = new Date(`${from}T00:00:00+08:00`);
  const b = new Date(`${to}T00:00:00+08:00`);
  return from === to ? dayYearFmt.format(a) : `${dayFmt.format(a)} – ${dayYearFmt.format(b)}`;
}

/**
 * The comparison line under a KPI. Never a percentage against zero: the
 * reason is spelled out instead.
 */
export function deltaText(change, type, compareLabel) {
  if (!change) return null;
  if (change.reason === 'no-data') return null;
  if (change.reason === 'both-zero') return { text: `None in ${compareLabel} either`, dir: 0 };
  if (change.reason === 'no-baseline') return { text: `None in ${compareLabel}, so no % change`, dir: 0 };
  const dir = Math.abs(change.pct) < 0.05 ? 0 : change.pct > 0 ? 1 : -1;
  const pct = `${change.pct > 0 ? '+' : ''}${change.pct.toLocaleString('en-PH', { maximumFractionDigits: 1 })}%`;
  const abs = type === 'percent'
    ? `${change.abs > 0 ? '+' : ''}${change.abs.toLocaleString('en-PH', { maximumFractionDigits: 1 })} pts`
    : `${change.abs > 0 ? '+' : change.abs < 0 ? '−' : ''}${formatValue(Math.abs(change.abs), type)}`;
  return { text: type === 'percent' ? `${abs} vs ${compareLabel}` : `${pct} (${abs}) vs ${compareLabel}`, dir };
}

/** The categorical palette: forest, gold, sage, clay, slate, plum. */
export const PALETTE = ['#2d5a2d', '#c9a84c', '#6fa585', '#b0763c', '#5a7a8c', '#8a5a7a', '#9aa69a'];
export const STATUS_COLORS = {
  completed: '#2d5a2d',
  inProgress: '#c99a2e',
  cancelled: '#b9b4a6',
};
