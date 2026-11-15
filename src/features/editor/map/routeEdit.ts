// Pure route edits used by the map (unit-tested). The map calls these and hands the result to
// onRouteChange / onAltitudeChange; the editor turns that into one update() (one undo step).
import type { LegOverride, RoutePoint } from '../../../shared';
import { legKey } from '../../../shared';

export function appendPoint(route: RoutePoint[], p: RoutePoint): RoutePoint[] {
  return [...route, p];
}

/** Insert p before index i (i = leg index + 1 when splitting leg i). */
export function insertPoint(route: RoutePoint[], i: number, p: RoutePoint): RoutePoint[] {
  const k = Math.max(0, Math.min(route.length, i));
  return [...route.slice(0, k), p, ...route.slice(k)];
}

/** Replace the point with this uid (keeps its uid, so overrides of its legs survive a move). */
export function replacePoint(route: RoutePoint[], uid: string, p: Omit<RoutePoint, 'uid'>): RoutePoint[] {
  return route.map((q) => (q.uid === uid ? { ...p, uid } : q));
}

export function removePoint(route: RoutePoint[], uid: string): RoutePoint[] {
  return route.filter((q) => q.uid !== uid);
}

export function renamePoint(route: RoutePoint[], uid: string, name: string): RoutePoint[] {
  return route.map((q) => (q.uid === uid ? { ...q, name } : q));
}

/** Leg overrides restricted to the legs of this route (drops legs that no longer exist). */
export function pruneOverrides(overrides: Record<string, LegOverride>, route: RoutePoint[]): Record<string, LegOverride> {
  const keep = new Set<string>();
  for (let i = 0; i + 1 < route.length; i++) keep.add(legKey(route[i], route[i + 1]));
  const out: Record<string, LegOverride> = {};
  let changed = false;
  for (const [k, v] of Object.entries(overrides)) {
    if (keep.has(k)) out[k] = v;
    else changed = true;
  }
  return changed ? out : overrides;
}

/** Set (or with null, remove) the altitude override of one leg; empty overrides are dropped. */
export function setAltitudeOverride(overrides: Record<string, LegOverride>, key: string, altFt: number | null): Record<string, LegOverride> {
  const cur = overrides[key] ?? {};
  if (altFt === null) {
    if (cur.altFt === undefined) return overrides;
    const { altFt: _drop, ...rest } = cur;
    const out = { ...overrides };
    if (Object.keys(rest).length) out[key] = rest;
    else delete out[key];
    return out;
  }
  if (cur.altFt === altFt) return overrides;
  return { ...overrides, [key]: { ...cur, altFt } };
}

/** Midpoint of a → b on a Web Mercator map (where the straight leg line is drawn), [lon, lat]. */
export function mercatorMid(a: { lat: number; lon: number }, b: { lat: number; lon: number }): [number, number] {
  const y = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const ym = (y(a.lat) + y(b.lat)) / 2;
  const lat = (Math.atan(Math.sinh(ym)) * 180) / Math.PI;
  return [(a.lon + b.lon) / 2, lat];
}
