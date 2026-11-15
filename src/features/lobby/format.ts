// Pure formatting and filtering helpers for the lobby and the list pages (unit-tested in
// tests/unit/screens/format.test.ts). No DOM, no React.
import type { FlightListItem } from '../../shared';
import { fmtDuration } from '../../calc';


/** Today's calendar date in the browser's zone, 'YYYY-MM-DD'. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseIso(d: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(dt.getTime()) ? null : dt;
}

/** 'YYYY-MM-DD' ('' for an invalid date). `currentYear` is accepted for compatibility and ignored. */
export function fmtDate(d: string, _currentYear?: number): string {
  const dt = parseIso(d);
  return dt ? dt.toISOString().slice(0, 10) : '';
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'); null if either is invalid. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseIso(from), b = parseIso(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** 'Today', 'Tomorrow', 'In 5 days', 'Yesterday', '3 days ago', or '' beyond two weeks. */
export function relativeDay(d: string, today: string): string {
  const n = daysBetween(today, d);
  if (n === null) return '';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n <= 14) return `In ${n} days`;
  if (n < -1 && n >= -14) return `${-n} days ago`;
  return '';
}

/** Minutes → '1h35' ('' for null). */
export function fmtHm(m: number | null | undefined): string {
  return fmtDuration(m);
}

/**
 * Local clock time of a UTC 'HH:MM' on a date, in `timeZone` (default: the browser's).
 * '' when either is missing.
 */
export function utcToLocal(date: string, hhmm: string, timeZone?: string): string {
  const d = parseIso(date);
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!d || !m) return '';
  const t = new Date(d.getTime() + (+m[1] * 60 + +m[2]) * 60000);
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(t);
}

/** Lower-cased text a flight row is searched by: title, every route point (aerodromes, VFR points,
 *  custom points), aircraft, date in several forms. */
export function flightSearchText(r: FlightListItem): string {
  const s = r.summary;
  const date = r.date || s.date;
  return [s.title, s.from, s.to, ...(r.points ?? []), s.aircraft, s.aircraft.replace('-', ''), date, fmtDate(date), s.blockOff].join(' ').toLowerCase();
}

/** Every whitespace-separated term of `q` must occur in the row's text. */
export function matchesQuery(text: string, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((t) => text.includes(t));
}

/**
 * Splits rows into upcoming (date ≥ today, soonest first, then by block-off) and past (most
 * recent first). Rows without a date count as upcoming drafts and go last.
 */
export function splitFlights(rows: FlightListItem[], today: string): { upcoming: FlightListItem[]; past: FlightListItem[] } {
  const key = (r: FlightListItem) => `${r.date || '9999-99-99'} ${r.summary.blockOff || '99:99'}`;
  const upcoming = rows.filter((r) => !r.date || r.date >= today).sort((a, b) => key(a).localeCompare(key(b)) || b.updated - a.updated);
  const past = rows.filter((r) => r.date && r.date < today).sort((a, b) => key(b).localeCompare(key(a)) || b.updated - a.updated);
  return { upcoming, past };
}

/** Age in whole years on `on` for a date of birth; null if unknown. */
export function ageOn(dob: string | null, on: string): number | null {
  const b = parseIso(dob || ''), d = parseIso(on);
  if (!b || !d) return null;
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
