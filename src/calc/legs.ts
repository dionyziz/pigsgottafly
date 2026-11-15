// Route → leg geometry (great-circle course and distance, magnetic course at the leg midpoint).
//
// The course is taken at the leg MIDPOINT, as a VFR chart is read (protractor at mid-leg, against
// the meridian there), and the variation at the same point: on a long leg the great-circle course
// changes along the way (LGTT → LGKR region, 123 NM: initial 290.8°, mid-leg 290.0°), and the
// mid-leg value is the one that best fits the whole leg. The magnetic course on the map label is the
// sheet's TC + VAR written values (round(TC) − round(variation)), so label and navlog never disagree.
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
  /** Great-circle true course at the leg midpoint, degrees (unrounded): the navlog TC. */
  tcTrue: number;
  /** Initial great-circle true course at the departure point, degrees (unrounded). */
  tcInitial: number;
  /** NM (unrounded). */
  distNm: number;
  /** Variation at the midpoint on the flight date, E positive. */
  variation: number;
  /**
   * Magnetic course as written on the sheet, whole degrees in [0, 360): round(TC) − round(variation)
   * (the navlog's TC and VAR columns). The map label "062°" (0 is shown as 360).
   */
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
    // Course along the great circle at the midpoint = initial course from the midpoint to the end.
    const tcTrue = trueCourse(mid, to);
    const variation = magneticVariation(mid.lat, mid.lon, date || new Date().toISOString().slice(0, 10));
    legs.push({
      index: i,
      key: legKey(from, to),
      from,
      to,
      mid,
      tcTrue,
      tcInitial: trueCourse(from, to),
      distNm: distanceNm(from, to),
      variation,
      mcMag: magneticCourse(tcTrue, variation),
    });
  }
  return legs;
}

/** The sheet's magnetic course: round(TC) − round(variation, E positive), in [0, 360). */
export function magneticCourse(tcTrue: number, variationDeg: number): number {
  return norm360(Math.round(tcTrue) - Math.round(variationDeg));
}
