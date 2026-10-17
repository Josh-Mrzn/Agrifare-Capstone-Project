/** Filter state shared by every analytics view, and how it becomes API parameters. */

export const RANGE_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: '6m', label: 'Last 6 months' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'custom', label: 'Custom range' },
];

export const DEFAULT_FILTERS = {
  range: '30d', from: '', to: '', compare: 'previous', granularity: 'auto', variety: '', productId: '', status: '',
};

export const STATUS_LABEL = {
  pending: 'Pending', confirmed: 'Confirmed', processing: 'Preparing', shipped: 'Out for delivery',
  delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled',
};

/** Query parameters for the API: only what is set. */
export function toParams(f) {
  const p = { range: f.range, compare: f.compare };
  if (f.range === 'custom') { p.from = f.from; p.to = f.to; }
  if (f.granularity && f.granularity !== 'auto') p.granularity = f.granularity;
  if (f.variety) p.variety = f.variety;
  if (f.productId) p.productId = f.productId;
  if (f.status) p.status = f.status;
  return p;
}

/** "the previous 30 days" / "the same period last year" for KPI captions. */
export function compareLabel(period) {
  if (!period?.comparison) return null;
  return period.comparison.kind === 'yoy' ? 'same period last year' : `previous ${period.days === 1 ? 'day' : `${period.days} days`}`;
}
