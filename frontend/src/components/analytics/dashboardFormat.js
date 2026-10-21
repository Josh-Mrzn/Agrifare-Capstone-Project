// Shared by the seller and Super Admin analytics pages.

export const COLORS = ['#1f4d2b', '#c9a24a', '#6a9a5b', '#8a5a2b', '#b9c28a', '#3b3b3b', '#5a7a8c'];

export const peso = (n) => `₱${Math.round(Number(n) || 0).toLocaleString('en-PH')}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A bucket's label in Manila time: "Oct 14", "Oct 25", "2026". */
export function bucketLabel(iso, mode) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const m = MON[d.getUTCMonth()];
  if (mode === 'yearly') return String(d.getUTCFullYear());
  if (mode === 'monthly') return `${m} ${String(d.getUTCFullYear()).slice(2)}`;
  return `${m} ${d.getUTCDate()}`;
}

export function formatKpi(k) {
  if (k.value == null) return '—';
  if (k.format === 'peso') return peso(k.value);
  if (k.format === 'kg') return `${Math.round(k.value).toLocaleString('en-PH')} kg`;
  if (k.of != null) return `${k.value} of ${k.of}`;
  return Number(k.value).toLocaleString('en-PH');
}
