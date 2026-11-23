// The ENR 5 / AIP SUP areas a flight's legs enter (prohibited, restricted, danger, military and local flying
// areas). Pure; the editor and the native core turn them into the flight's warnings (flightCalc.ts).
//
// - Lateral: the leg's straight line starts, ends or crosses the area's ring, or passes within a circle's radius.
// - Vertical: the leg's planned altitude is within the area's limits, both included. 'GND', 'SFC' and 'MSL' are
//   0; '1000 FT AGL' is taken as 1000 ft MSL (conservative, as the ATC list does); an unknown altitude or limit
//   counts as inside.
// - Time: the area is active at some moment the leg is flown (src/shared/areaTime.ts): its validity days and,
//   for a SUP that prints them, its dated windows. Without block times the whole flight day is taken.
// - Flight-plan buffer zones ('For IFR flight planning purposes only') are left out: they only make IFPS
//   reject IFR flight plans, and do not restrict a VFR flight.
import { activeWindows } from '../shared/areaTime.js';
import type { AreaWindow, RefArea } from '../shared/ref.js';
import type { LatLon } from '../shared/types.js';
import { pointSegDistNm, segmentEntersPolygon } from './nav.js';

export interface AreaLeg {
  from: LatLon;
  to: LatLon;
  /** Planned altitude, ft; null or NaN when unknown. */
  altFt: number | null;
  /** When the leg is flown, epoch ms. */
  startMs: number;
  endMs: number;
}

export interface AreaConflict {
  legIndex: number;
  area: RefArea;
  /** The area's dated windows the leg is flown in; [] for an area without windows. */
  windows: AreaWindow[];
}

/** A vertical limit in ft: 'FL 295' 29500, '3000 FT ALT' 3000, 'GND/MSL' 0, 'UNL' Infinity; NaN if unknown. */
export function areaLimitFt(s: string): number {
  const t = s.trim().toUpperCase();
  if (/^(SFC|GND|MSL)\b/.test(t)) return 0;
  if (t.startsWith('UNL')) return Infinity;
  const fl = /^FL ?(\d{2,3})/.exec(t);
  if (fl) return +fl[1] * 100;
  const ft = /^(\d+) ?FT/.exec(t);
  return ft ? +ft[1] : NaN;
}

const isFbz = (a: RefArea) => /For IFR flight planning purposes only/i.test(a.remarks);

function entersLaterally(a: RefArea, from: LatLon, to: LatLon): boolean {
  if (a.circle) return pointSegDistNm({ lat: a.circle.lat, lon: a.circle.lon }, from, to).dist <= a.circle.radiusNm;
  return !!a.polygon && a.polygon.length >= 3 && segmentEntersPolygon(from, to, a.polygon);
}

function withinLimits(a: RefArea, altFt: number | null): boolean {
  if (altFt === null || !Number.isFinite(altFt)) return true;
  const lo = areaLimitFt(a.lower),
    hi = areaLimitFt(a.upper);
  return !(altFt < lo) && !(altFt > hi);
}

/** Every area a leg enters at its altitude while the area is active, in leg order, then in the areas' order. */
export function legAreaConflicts(legs: readonly AreaLeg[], areas: readonly RefArea[]): AreaConflict[] {
  const out: AreaConflict[] = [];
  legs.forEach((l, legIndex) => {
    for (const area of areas) {
      if (isFbz(area) || !withinLimits(area, l.altFt) || !entersLaterally(area, l.from, l.to)) continue;
      const windows = activeWindows(area, l.startMs, l.endMs);
      if (windows) out.push({ legIndex, area, windows });
    }
  });
  return out;
}
