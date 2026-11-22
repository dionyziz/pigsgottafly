// Local flights: take-off and landing at the same aerodrome with nothing in between (training, a
// local hop). The pilot gives the airborne time instead of drawing legs; the flight plan goes as
// route LOCAL with the departure as destination (as AIS accepts a local VFR plan).
//
// A route A → … → A with intermediate points is not local: it is a circular route with a navlog.
import type { FlightOptions, LatLon, RoutePoint } from './types.js';

/** Airborne time a flight gets when it becomes local and the pilot has not set one, minutes. */
export const DEFAULT_LOCAL_DURATION_MIN = 60;
export const MAX_LOCAL_DURATION_MIN = 24 * 60;
/** Radius of the local area drawn on the map and searched for NOTAMs, NM. */
export const LOCAL_AREA_NM = 20;

const samePlace = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;

/** The same aerodrome at both ends of a two-point route. */
export function isLocalFlight(route: readonly Pick<RoutePoint, 'kind' | 'refId' | 'lat' | 'lon'>[]): boolean {
  if (route.length !== 2) return false;
  const [a, b] = route;
  if (a.kind !== 'aerodrome' || b.kind !== 'aerodrome') return false;
  return a.refId && b.refId ? a.refId === b.refId : samePlace(a, b);
}

/** The pilot's airborne time, minutes (the default when not set). */
export function localDurationOf(options: Pick<FlightOptions, 'localDurationMin'> | null | undefined): number {
  const m = options?.localDurationMin;
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : DEFAULT_LOCAL_DURATION_MIN;
}

/** The airborne time of a local flight, else null (the navlog gives it). */
export function localDuration(
  route: readonly Pick<RoutePoint, 'kind' | 'refId' | 'lat' | 'lon'>[],
  options: Pick<FlightOptions, 'localDurationMin'> | null | undefined,
): number | null {
  return isLocalFlight(route) ? localDurationOf(options) : null;
}
