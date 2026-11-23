// When an ENR 5 / AIP SUP area is in force and active: its validity days and dated windows (RefArea
// validFrom / validUntil / windows, all UTC). Pure; used by the maps (which areas to draw on the flight's
// day), the flight's area warnings (src/calc/areas.ts) and the native core. Unit-tested in
// tests/unit/shared/areaTime.test.ts.
import type { AreaWindow, RefArea } from './ref.js';

const DAY_MS = 86400000;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

type Timed = Pick<RefArea, 'validFrom' | 'validUntil' | 'windows'>;

const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** In force on this UTC day ('YYYY-MM-DD'); an area without validity days always is. */
export function areaInForce(a: Timed, day: string): boolean {
  return (!a.validFrom || day >= a.validFrom) && (!a.validUntil || day <= a.validUntil);
}

/** The areas in force on this UTC day (the maps draw these). */
export const areasInForce = <T extends Timed>(areas: readonly T[], day: string): T[] =>
  areas.filter((a) => areaInForce(a, day));

/**
 * Whether the area is active at some moment of [fromMs, toMs] (a leg flown then): null if not; else the
 * windows that overlap it, [] for an area without windows (active whenever in force). A window holds
 * from its start up to, not including, its end, so a leg starting as a window ends is clear of it,
 * and one ending as it starts is not.
 */
export function activeWindows(a: Timed, fromMs: number, toMs: number): AreaWindow[] | null {
  if (!(fromMs <= toMs)) return null;
  const start = a.validFrom ? dayStart(a.validFrom) : -Infinity;
  const end = a.validUntil ? dayStart(a.validUntil) + DAY_MS : Infinity;
  if (!(start <= toMs && fromMs < end)) return null;
  if (!a.windows) return [];
  const hit = a.windows.filter((w) => Date.parse(w.from) <= toMs && fromMs < Date.parse(w.to));
  return hit.length ? hit : null;
}

/** '2026-11-27' → '27 NOV 2026' (as the AIP writes dates). */
export function fmtAipDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d} ${MONTHS[+m - 1] ?? m} ${y}`;
}

const hhmm = (iso: string) => iso.slice(11, 13) + iso.slice(14, 16);
const shortDay = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;

/** One window within its first day's line: '1130–1330', '2200–2400', or '2200 – 28 NOV 0200' past midnight. */
export function fmtWindow(w: AreaWindow): string {
  const end = Date.parse(w.to) - dayStart(w.from.slice(0, 10));
  if (end <= DAY_MS) return `${hhmm(w.from)}–${end === DAY_MS ? '2400' : hhmm(w.to)}`;
  return `${hhmm(w.from)} – ${shortDay(w.to)} ${hhmm(w.to)}`;
}

/** A window with its day: '23 NOV 1130–1330'. */
export const fmtDatedWindow = (w: AreaWindow): string => `${shortDay(w.from)} ${fmtWindow(w)}`;

/**
 * The windows from `day` on, a line per day as the SUP prints them: '23 NOV 1130–1330 & 1600–1800'.
 * At most `max` days; the rest is counted.
 */
export function fmtWindows(windows: readonly AreaWindow[], day: string, max = 8): string[] {
  const from = dayStart(day);
  const byDay = new Map<string, string[]>();
  for (const w of windows) {
    if (Date.parse(w.to) <= from) continue;
    const d = w.from.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), fmtWindow(w)]);
  }
  const lines = [...byDay].map(([d, ws]) => `${shortDay(d)} ${ws.join(' & ')}`);
  return lines.length > max ? [...lines.slice(0, max), `+${lines.length - max} more days`] : lines;
}

/** The details rows of a time-limited area on `day`: until when it is in force, and its windows. */
export function areaTimeRows(a: Timed, day: string): { label: string; text: string }[] {
  const rows: { label: string; text: string }[] = [];
  if (a.validUntil) rows.push({ label: 'Valid', text: `until ${fmtAipDay(a.validUntil)}` });
  if (a.windows) {
    const lines = fmtWindows(a.windows, day);
    rows.push({ label: 'Windows (UTC)', text: lines.length ? lines.join('\n') : 'None left' });
  }
  return rows;
}
