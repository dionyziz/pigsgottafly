import type { FlightListItem, FlightSummary } from '../../shared';
import { fmtDate } from '../../shared/date';
import { fmtDurationField } from '../../shared/typedInput';

/** A local flight as the lobby row knows it: one aerodrome at both ends, nothing between. */
export const isLocalSummary = (s: Pick<FlightSummary, 'from' | 'to' | 'route'>): boolean =>
  !!s.from &&
  s.from === s.to &&
  s.route.length === 2 &&
  s.route[0][0] === s.route[1][0] &&
  s.route[0][1] === s.route[1][1];

/** The row's route: 'LGTT → LGMG', 'LGTT local · 1:00'; '' without both ends. */
export function routeLine(s: Pick<FlightSummary, 'from' | 'to' | 'route' | 'eteMin'>): string {
  if (!s.from || !s.to) return '';
  if (isLocalSummary(s)) return `${s.from} local` + (s.eteMin != null ? ` · ${fmtDurationField(s.eteMin)}` : '');
  return `${s.from} → ${s.to}`;
}

/** Lower-cased text a flight row is searched by: title, every route point (aerodromes, VFR points,
 *  custom points), passengers, aircraft, date in several forms. */
export function flightSearchText(r: FlightListItem): string {
  const s = r.summary;
  const date = r.date || s.date;
  return [
    s.title,
    s.from,
    s.to,
    ...(r.points ?? []),
    ...(r.passengers ?? []),
    s.aircraft,
    s.aircraft.replace('-', ''),
    date,
    fmtDate(date),
    s.blockOff,
  ]
    .join(' ')
    .toLowerCase();
}

export const passengerNames = (r: FlightListItem): string => (r.passengers ?? []).join(', ');

/** Every whitespace-separated term of `q` must occur in the row's text. */
export function matchesQuery(text: string, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((t) => text.includes(t));
}

/**
 * Splits rows into upcoming (date ≥ today, soonest first, then by block start) and past (most
 * recent first). Rows without a date count as upcoming drafts and go last.
 */
export function splitFlights(
  rows: FlightListItem[],
  today: string,
): { upcoming: FlightListItem[]; past: FlightListItem[] } {
  const key = (r: FlightListItem) => `${r.date || '9999-99-99'} ${r.summary.blockOff || '99:99'}`;
  // newest first in both sections (reverse chronological)
  const upcoming = rows
    .filter((r) => !r.date || r.date >= today)
    .sort((a, b) => key(b).localeCompare(key(a)) || b.updated - a.updated);
  const past = rows
    .filter((r) => r.date && r.date < today)
    .sort((a, b) => key(b).localeCompare(key(a)) || b.updated - a.updated);
  return { upcoming, past };
}
