// Route → leg geometry (great-circle course and distance, magnetic course at the leg midpoint).
import type { IsoDate, LatLon, RoutePoint } from '../shared/types.js';
import { legKey } from '../shared/constants.js';
import { distanceNm, midpoint, norm360, trueCourse } from './nav.js';
import { magneticVariation } from './wmm.js';

export interface LegGeometry {
  index: number;
  /** legKey(from, to): the key of FlightDoc.legOverrides. */
  key: string;
  from: RoutePoint;
  to: RoutePoint;
  mid: LatLon;
  /** Initial great-circle true course, degrees (unrounded). */
  tcTrue: number;
  /** NM (unrounded). */
  distNm: number;
  /** Variation at the midpoint on the flight date, E positive. */
  variation: number;
  /** Magnetic course = TC − variation, degrees (unrounded): the map label "062°". */
  mcMag: number;
}

/**
 * Legs between consecutive route points.
 * @param date flight date for the magnetic variation
 */
export function buildLegs(route: RoutePoint[], date: IsoDate): LegGeometry[] {
  const legs: LegGeometry[] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const from = route[i], to = route[i + 1];
    const mid = midpoint(from, to);
    const tcTrue = trueCourse(from, to);
    const variation = magneticVariation(mid.lat, mid.lon, date || new Date().toISOString().slice(0, 10));
    legs.push({
      index: i,
      key: legKey(from, to),
      from,
      to,
      mid,
      tcTrue,
      distNm: distanceNm(from, to),
      variation,
      mcMag: norm360(tcTrue - variation),
    });
  }
  return legs;
}
