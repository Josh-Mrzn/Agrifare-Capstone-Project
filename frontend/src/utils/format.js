/**
 * Every peso amount, date and name initial on the site goes through here, so
 * the same value never reads two ways on two screens.
 */

const pesoFormat = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 2,
});

const wholePesoFormat = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

const numberFormat = new Intl.NumberFormat('en-PH');

const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-PH', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});
const timeFormat = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });
const monthFormat = new Intl.DateTimeFormat('en-PH', { month: 'short' });

/** ₱1,250.50 */
export const peso = (n) => pesoFormat.format(Number(n) || 0);

/** ₱1,251, for totals where centavos are noise. */
export const wholePeso = (n) => wholePesoFormat.format(Number(n) || 0);

/** 1,250 */
export const number = (n) => numberFormat.format(Number(n) || 0);

const asDate = (value) => (value ? new Date(value) : null);
const valid = (d) => d && !Number.isNaN(d.getTime());

/** Oct 5, 2026 */
export const formatDate = (value, fallback = '') => {
  const d = asDate(value);
  return valid(d) ? dateFormat.format(d) : fallback;
};

/** Oct 5, 2026, 3:40 PM */
export const formatDateTime = (value, fallback = '') => {
  const d = asDate(value);
  return valid(d) ? dateTimeFormat.format(d) : fallback;
};

/** 3:40 PM */
export const formatTime = (value, fallback = '') => {
  const d = asDate(value);
  return valid(d) ? timeFormat.format(d) : fallback;
};

/** "Oct" for a 1-based month number. */
export const monthName = (month) => monthFormat.format(new Date(2000, month - 1, 1));

/**
 * "Juan Dela Cruz" -> "JD". Built from the name, falling back to the email,
 * so a person has the same initials everywhere they appear.
 */
export function initialsOf(name, email = '') {
  const source = String(name || email || '?').trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/**
 * How an order line reads. Storefront orders are counted in sacks of a given
 * weight; a sale the seller typed in is counted in kilograms.
 */
export function quantityLabel(order) {
  const sacks = Number(order.quantity) || 0;
  const weight = Number(order.weightKg) || 1;
  if (weight <= 1) return `${number(sacks)} kg`;
  return `${number(sacks)} × ${number(weight)} kg (${number(sacks * weight)} kg)`;
}
