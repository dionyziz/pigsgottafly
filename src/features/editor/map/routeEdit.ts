// Pure route edits used by the map (unit-tested). The map calls these and hands the result to
// onRouteChange / onAltitudeChange; the editor turns that into one update() (one undo step).
import type { LegOverride, RoutePoint } from '../../../shared';
import { legKey } from '../../../shared';

/**
 * True when the route comes back to where it started (A … A), as a new flight home → home does.
 * Points are the same when they reference the same aerodrome / VFR point / waypoint, or sit at the
 * same position.
 */
export function isRoundTrip(route: RoutePoint[]): boolean {
  if (route.length < 2) return false;
  const a = route[0],
    b = route[route.length - 1];
  if (a.kind !== 'custom' && a.refId && a.kind === b.kind && a.refId === b.refId) return true;
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
}

/** A route that only goes from a point back to itself (the home → home of a new flight). */
export function isBareRoundTrip(route: RoutePoint[]): boolean {
  return route.length === 2 && isRoundTrip(route);
}

/**
 * Where drawing adds its next point. On a round trip it goes before the closing point, so drawing
 * from LGTT → LGTT gives LGTT → A → B → LGTT (the flight still returns home); otherwise, or when the
 * pilot explicitly continues from the last point (`toEnd`), at the end.
 */
export function drawIndex(route: RoutePoint[], toEnd = false): number {
  return !toEnd && isRoundTrip(route) ? route.length - 1 : route.length;
}

/** Add a drawn point where drawing adds points (drawIndex). */
export function addDrawnPoint(route: RoutePoint[], p: RoutePoint, toEnd = false): RoutePoint[] {
  return insertPoint(route, drawIndex(route, toEnd), p);
}

/**
 * Backspace while drawing: remove the point drawn last (the one just before the closing point of a
 * round trip). The departure of a bare round trip is never removed this way: then the closing point goes.
 */
export function removeDrawnPoint(route: RoutePoint[], toEnd = false): RoutePoint[] {
  const i = drawIndex(route, toEnd) - 1;
  if (i >= 1 && i < route.length - 1) return [...route.slice(0, i), ...route.slice(i + 1)];
  return route.slice(0, -1);
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

/** True when two route points refer to the same thing (the same aerodrome / VFR point / waypoint, or both custom). */
export function sameIdentity(a: Pick<RoutePoint, 'kind' | 'refId'>, b: Pick<RoutePoint, 'kind' | 'refId'>): boolean {
  return a.kind === b.kind && (a.kind === 'custom' || a.refId === b.refId);
}

/**
 * A route point dragged and dropped as `p` (snapped to a known point, or a custom point). Moving a
 * point keeps its uid (and the overrides of its legs); when it becomes another point (snapped to a
 * different aerodrome / VFR point / waypoint, or a known point dropped as a custom one) it gets a new
 * uid, so its legs are new legs: their overrides and the old point's requests are dropped.
 */
export function movePoint(
  route: RoutePoint[],
  uid: string,
  p: Omit<RoutePoint, 'uid'>,
  newUid: () => string,
): RoutePoint[] {
  const old = route.find((q) => q.uid === uid);
  const id = old && !sameIdentity(old, p) ? newUid() : uid;
  return route.map((q) => (q.uid === uid ? { ...p, uid: id } : q));
}

export function removePoint(route: RoutePoint[], uid: string): RoutePoint[] {
  return route.filter((q) => q.uid !== uid);
}

export function renamePoint(route: RoutePoint[], uid: string, name: string): RoutePoint[] {
  return route.map((q) => (q.uid === uid ? { ...q, name } : q));
}

/** Leg overrides restricted to the legs of this route (drops legs that no longer exist). */
export function pruneOverrides(
  overrides: Record<string, LegOverride>,
  route: RoutePoint[],
): Record<string, LegOverride> {
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
export function setAltitudeOverride(
  overrides: Record<string, LegOverride>,
  key: string,
  altFt: number | null,
): Record<string, LegOverride> {
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
