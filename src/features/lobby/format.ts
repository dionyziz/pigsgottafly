// Pure formatting and filtering helpers for the lobby and the list pages (unit-tested in
// tests/unit/screens/format.test.ts). No DOM, no React.
import type { FlightListItem } from '../../shared';
import { fmtDate } from '../../shared/date';
import { fmtDuration } from '../../shared/format';

// Date helpers live in src/shared/date.ts (Greek local time); re-exported for the old import path.
export { ageOn, daysBetween, fmtDate, localToday, relativeDay, utcToLocal } from '../../shared/date';

/** Minutes → '1h35' ('' for null). */
export function fmtHm(m: number | null | undefined): string {
  return fmtDuration(m);
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
