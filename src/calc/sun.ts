// Sunset at a place and date: AIP GEN 2.7 tables (nearest listed aerodrome within 120 NM), else NOAA.
import type { LatLon } from '../shared/types.js';
import type { RefSunTable } from '../shared/ref.js';
import { distanceNm, sunsetUtcMinutes } from './nav.js';

/** Index of a date in the 366-entry GEN 2.7 tables (leap-year day index). */
export function sunTableIndex(date: string): number {
  const [, mo, da] = date.split('-').map(Number);
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].slice(0, mo - 1).reduce((a, b) => a + b, 0) + da - 1;
}

/** Sunset, whole minutes after 00:00 UTC (rounded down), or null. */
export function sunsetMinutes(date: string, p: LatLon, tables: Record<string, RefSunTable>): number | null {
  let best: RefSunTable | null = null, bd = Infinity;
  for (const t of Object.values(tables)) {
    const d = distanceNm(p, t);
    if (d < bd) { bd = d; best = t; }
  }
  if (best && bd < 120) {
    const v = best.ss[sunTableIndex(date)];
    if (v !== null && v !== undefined) return v;
  }
  const m = sunsetUtcMinutes(date, p.lat, p.lon);
  return m === null ? null : Math.floor(m);
}
