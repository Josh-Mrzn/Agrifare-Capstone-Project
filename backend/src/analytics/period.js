/**
 * Reporting periods.
 *
 * Every analytics request is described by one period: where it starts, where
 * it ends, what it is compared with, and how it is split into buckets. All of
 * it is computed in Philippine time (UTC+8, no daylight saving), so "today"
 * and "October" mean what a seller in Nueva Ecija means by them, whatever the
 * server's own clock is set to.
 *
 * Ranges are half-open: [start, end). A day ends at the next midnight, so an
 * order placed at 23:59 belongs to that day and one at 00:00 to the next, and
 * no order is ever counted in two adjacent periods.
 */

export const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Manila
const DAY = 24 * 60 * 60 * 1000;

export const PRESETS = ['today', '7d', '30d', '90d', '6m', '12m', 'ytd', 'custom'];
export const COMPARES = ['previous', 'yoy', 'none'];
export const GRANULARITIES = ['day', 'week', 'month', 'quarter'];

/** Manila wall-clock fields of an instant. */
export function local(date) {
  const d = new Date(new Date(date).getTime() + TZ_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(), // 0-11
    day: d.getUTCDate(),
    weekday: d.getUTCDay(), // 0 = Sunday
  };
}

/** The instant of Manila midnight on a wall-clock date (month 0-11, may overflow). */
export function manilaMidnight(year, month, day) {
  return new Date(Date.UTC(year, month, day) - TZ_OFFSET_MS);
}

export function startOfDay(date) {
  const l = local(date);
  return manilaMidnight(l.year, l.month, l.day);
}

export function addDays(date, n) {
  const l = local(date);
  return manilaMidnight(l.year, l.month, l.day + n);
}

export function addMonths(date, n) {
  const l = local(date);
  // Clamp the day so 31 March minus one month is 28/29 February, not 3 March.
  const lastDay = new Date(Date.UTC(l.year, l.month + n + 1, 0)).getUTCDate();
  return manilaMidnight(l.year, l.month + n, Math.min(l.day, lastDay));
}

/** Start of the bucket an instant falls in. Weeks start on Monday. */
export function bucketStart(date, granularity) {
  const l = local(date);
  switch (granularity) {
    case 'day':
      return manilaMidnight(l.year, l.month, l.day);
    case 'week': {
      const back = (l.weekday + 6) % 7; // days since Monday
      return manilaMidnight(l.year, l.month, l.day - back);
    }
    case 'month':
      return manilaMidnight(l.year, l.month, 1);
    case 'quarter':
      return manilaMidnight(l.year, Math.floor(l.month / 3) * 3, 1);
    default:
      throw new Error(`Unknown granularity: ${granularity}`);
  }
}

export function nextBucket(start, granularity) {
  switch (granularity) {
    case 'day': return addDays(start, 1);
    case 'week': return addDays(start, 7);
    case 'month': return addMonths(start, 1);
    case 'quarter': return addMonths(start, 3);
    default: throw new Error(`Unknown granularity: ${granularity}`);
  }
}

/** Every bucket that overlaps [start, end), in order. */
export function buckets(start, end, granularity) {
  const out = [];
  let cursor = bucketStart(start, granularity);
  // A hard cap keeps a malformed request from building millions of buckets.
  while (cursor < end && out.length < 1000) {
    const next = nextBucket(cursor, granularity);
    out.push({ key: cursor.toISOString(), start: cursor, end: next });
    cursor = next;
  }
  return out;
}

/** A granularity that gives a readable number of points for the span. */
export function autoGranularity(start, end) {
  const days = (end - start) / DAY;
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  if (days <= 731) return 'month';
  return 'quarter';
}

/** Parses YYYY-MM-DD as a Manila date. Returns null for anything else. */
export function parseLocalDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = manilaMidnight(y, mo, d);
  // Reject 2026-02-31 and the like instead of rolling into March.
  const l = local(date);
  if (l.year !== y || l.month !== mo || l.day !== d) return null;
  return date;
}

/** YYYY-MM-DD of an instant, in Manila. */
export function toLocalDate(date) {
  const l = local(date);
  return `${l.year}-${String(l.month + 1).padStart(2, '0')}-${String(l.day).padStart(2, '0')}`;
}

const MAX_SPAN_DAYS = 3 * 366;

/**
 * Turns query parameters into a period, or throws a 400-worthy error.
 *
 *   range        one of PRESETS (default 30d)
 *   from, to     YYYY-MM-DD, both inclusive, for range=custom
 *   compare      previous | yoy | none (default previous)
 *   granularity  day | week | month | quarter | auto (default auto)
 */
export function resolvePeriod(query = {}, now = new Date()) {
  const range = PRESETS.includes(query.range) ? query.range : '30d';
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  let start;
  let end = tomorrow;

  switch (range) {
    case 'today': start = today; break;
    case '7d': start = addDays(today, -6); break;
    case '30d': start = addDays(today, -29); break;
    case '90d': start = addDays(today, -89); break;
    case '6m': start = addMonths(tomorrow, -6); break;
    case '12m': start = addMonths(tomorrow, -12); break;
    case 'ytd': start = manilaMidnight(local(now).year, 0, 1); break;
    case 'custom': {
      const from = parseLocalDate(query.from);
      const to = parseLocalDate(query.to);
      if (!from || !to) throw badRequest('Choose a start and end date (YYYY-MM-DD).');
      if (to < from) throw badRequest('The end date is before the start date.');
      start = from;
      end = addDays(to, 1); // inclusive end date
      if ((end - start) / DAY > MAX_SPAN_DAYS) throw badRequest('Choose a range of three years or less.');
      break;
    }
    default: break;
  }

  const compare = COMPARES.includes(query.compare) ? query.compare : 'previous';
  let comparison = null;
  if (compare === 'previous') {
    const span = end - start;
    // Same length, immediately before. Built from whole days so a 30-day
    // range is compared with the 30 days before it, not a shifted clock time.
    const days = Math.round(span / DAY);
    comparison = { start: addDays(start, -days), end: start, kind: 'previous' };
  } else if (compare === 'yoy') {
    comparison = { start: addMonths(start, -12), end: addMonths(end, -12), kind: 'yoy' };
  }

  const granularity = GRANULARITIES.includes(query.granularity)
    ? query.granularity
    : autoGranularity(start, end);

  return {
    range,
    start,
    end,
    from: toLocalDate(start),
    to: toLocalDate(addDays(end, -1)),
    days: Math.round((end - start) / DAY),
    compare,
    comparison: comparison && {
      ...comparison,
      from: toLocalDate(comparison.start),
      to: toLocalDate(addDays(comparison.end, -1)),
    },
    granularity,
  };
}

export function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}
