// An aerodrome's day: AIP AD 2.3 / AD 1.6 overlaid with the flight's NOTAMs (src/calc/aerodromeStatus.ts),
// and its one-line summaries. Pure, so the native core shares it with the editor's sections and the map.
import { type AdDay, type AdNotamEffect, aerodromeDay } from '../../calc';
// the core's cycle list, not data/ref: that module builds its indexes of all the reference data on import
import { CYCLES } from '../../data/ref/cycles/core';
import { cycleOn, type RefAerodrome } from '../../shared/ref';

export interface AdDayInfo {
  day: string;
  ad: AdDay | null;
  ats: AdDay | null;
  handling: AdDay | null;
  notams: AdNotamEffect[];
}

const DAY_MS = 86400e3;

/** `day` '' = the day of `nowMs` (UTC). */
export function adDayInfo(
  a: RefAerodrome,
  day: string,
  effects: readonly AdNotamEffect[],
  nowMs: number = Date.now(),
): AdDayInfo {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date(nowMs).toISOString().slice(0, 10);
  const start = Date.parse(d + 'T00:00:00Z');
  // GEN 2.7 as amended for that day
  const opts = { effects, sunTables: cycleOn(CYCLES, d).sun };
  const notams = effects.filter((e) => e.icao === a.icao && e.from < start + DAY_MS && (e.to === null || e.to > start));
  if (!a.hours) return { day: d, ad: null, ats: null, handling: null, notams };
  return {
    day: d,
    ad: aerodromeDay(a, 'ad', d, opts),
    ats: a.hours.ats ? aerodromeDay(a, 'ats', d, opts) : null,
    handling: aerodromeDay(a, 'handling', d, opts),
    notams,
  };
}

export const fmtAdDay = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** 'Hours Sat 15 Nov: Open 04:52–15:01Z (HJ) · NOTAM A1234/26' — one line for tooltips. */
export function adHoursLine(info: AdDayInfo): string {
  if (!info.ad) return 'Hours not published';
  return `${fmtAdDay(info.day)}: ${info.ad.text}${info.ad.notams.length ? ` (NOTAM ${info.ad.notams.join(', ')})` : ''}`;
}
export function adHandlingLine(info: AdDayInfo): string {
  if (!info.handling) return '';
  return `Handling: ${info.handling.text}${info.handling.notams.length ? ` (NOTAM ${info.handling.notams.join(', ')})` : ''}`;
}
