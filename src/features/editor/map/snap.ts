// Pure: the caller passes a projection (lon/lat → screen px), so this is unit-tested without a map.
import { distanceNm } from '../../../calc';
import type { LatLon, RoutePoint, RoutePointKind, Waypoint } from '../../../shared';
import { aerodromeName } from '../../../shared/aerodrome';
import type { RefAerodrome, RefVfrPoint } from '../../../shared/ref';

export interface SnapCandidate extends LatLon {
  kind: RoutePointKind;
  refId: string | null;
  /** Route point name (ICAO for aerodromes, the reporting point's name, the waypoint's name). */
  name: string;
  /** Second line of the snap tooltip, e.g. the aerodrome's full name or the VFR chart. */
  detail: string;
  /**
   * Extra pixels added to the screen distance when several candidates are in reach, so the more
   * authoritative one wins a near tie: aerodromes and the pilot's points 0, charted VFR points 1,
   * open-flightmaps points 3.
   */
  penaltyPx: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface SnapHit {
  cand: SnapCandidate;
  /** Without the penalty. */
  distPx: number;
  /**
   * A point the aerodrome was preferred over (it sits within AERODROME_PRIORITY_NM of the aerodrome
   * and too close on screen to tell apart): the tooltip says to zoom in to pick it.
   */
  shadowed?: SnapCandidate;
}

/**
 * A VFR point (or other non-aerodrome candidate) this close to an aerodrome, NM, gives way to the
 * aerodrome while the two are less than the snap radius apart on screen: at route-planning zoom a
 * reporting point 0.6 NM from the runway (SKS at LGSY) is a few px away, and a click meant for the
 * aerodrome must not make it a VFR point. Zoomed in far enough to separate them, plain distance wins.
 */
export const AERODROME_PRIORITY_NM = 1.5;

export const SNAP_RADIUS_PX = 12;

/** Label of an aerodrome as a route point: ICAO, else the last part of the name (as v2). */
export { aerodromeName };

/** Open-flightmaps duplicates of a charted point (same name within 0.5 NM) are dropped so the charted one is used. */
export function buildCandidates(
  aerodromes: RefAerodrome[],
  vfrPoints: RefVfrPoint[],
  waypoints: Waypoint[],
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const a of aerodromes) {
    if (!isFinite(a.lat) || !isFinite(a.lon)) continue;
    const full = a.name.trim();
    out.push({
      kind: 'aerodrome',
      refId: a.id,
      name: aerodromeName(a),
      lat: a.lat,
      lon: a.lon,
      detail: a.icao ? full : a.source,
      penaltyPx: 0,
    });
  }
  const charted = vfrPoints.filter((v) => v.src !== 'ofm');
  for (const v of vfrPoints) {
    if (!isFinite(v.lat) || !isFinite(v.lon)) continue;
    if (v.src === 'ofm' && charted.some((c) => c.name === v.name && distanceNm(c, v) <= 0.5)) continue;
    out.push({
      kind: 'vfr',
      refId: v.id,
      name: v.name,
      lat: v.lat,
      lon: v.lon,
      detail: v.src === 'ofm' ? 'VFR point (open flightmaps)' : `VFR reporting point · ${v.chart} chart`,
      penaltyPx: v.src === 'ofm' ? 3 : 1,
    });
  }
  for (const w of waypoints) {
    if (!isFinite(w.lat) || !isFinite(w.lon)) continue;
    out.push({
      kind: 'waypoint',
      refId: w.id,
      name: w.name,
      lat: w.lat,
      lon: w.lon,
      detail: 'My waypoint',
      penaltyPx: 0,
    });
  }
  return out;
}

/** The route's own points as candidates (e.g. to close a loop back to a custom point). */
export function routeCandidates(route: RoutePoint[], exceptUid?: string): SnapCandidate[] {
  return route
    .filter((p) => p.uid !== exceptUid)
    .map((p) => ({
      kind: p.kind,
      refId: p.refId,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      detail: 'On this route',
      penaltyPx: 0,
    }));
}

/**
 * Nearest candidate within radiusPx of the cursor (ranked by screen distance + penalty), or null.
 * @param box optional geographic prefilter (candidates outside are not projected).
 */
export function findSnap(
  cursor: ScreenPoint,
  cands: SnapCandidate[],
  project: (lon: number, lat: number) => ScreenPoint,
  radiusPx = SNAP_RADIUS_PX,
  box?: { west: number; east: number; south: number; north: number },
): SnapHit | null {
  let best: SnapHit | null = null;
  let bestScore = Infinity;
  let bestPx: ScreenPoint | null = null;
  const aerodromes: { c: SnapCandidate; p: ScreenPoint; d: number }[] = [];
  for (const c of cands) {
    if (box && (c.lon < box.west || c.lon > box.east || c.lat < box.south || c.lat > box.north)) continue;
    const p = project(c.lon, c.lat);
    const d = Math.hypot(p.x - cursor.x, p.y - cursor.y);
    if (d > radiusPx) continue;
    if (c.kind === 'aerodrome') aerodromes.push({ c, p, d });
    const score = d + c.penaltyPx;
    if (score < bestScore) {
      bestScore = score;
      best = { cand: c, distPx: d };
      bestPx = p;
    }
  }
  if (best && bestPx && best.cand.kind !== 'aerodrome') {
    // aerodrome priority: the nearest aerodrome in reach that the winner sits next to
    let ad: { c: SnapCandidate; d: number } | null = null;
    for (const a of aerodromes) {
      if (Math.hypot(a.p.x - bestPx.x, a.p.y - bestPx.y) >= radiusPx) continue;
      if (distanceNm(a.c, best.cand) > AERODROME_PRIORITY_NM) continue;
      if (!ad || a.d < ad.d) ad = a;
    }
    if (ad) return { cand: ad.c, distPx: ad.d, shadowed: best.cand };
  }
  return best;
}

/**
 * The snap of a point where the route's own points (`own`) and the reference points (`ref`) both
 * offer one: the route's point when it is as near (counting the reference's penalty), except that an
 * aerodrome keeps its priority over the route's own copy of the point it shadowed.
 */
export function bestSnap(own: SnapHit | null, ref: SnapHit | null): SnapHit | null {
  const shadowedOwn = !!(
    own &&
    ref?.shadowed &&
    own.cand.lat === ref.shadowed.lat &&
    own.cand.lon === ref.shadowed.lon
  );
  if (own && !shadowedOwn && (!ref || own.distPx <= ref.distPx + ref.cand.penaltyPx)) return own;
  return ref;
}

export function pointFromCandidate(c: SnapCandidate, uid: string): RoutePoint {
  return { uid, kind: c.kind, refId: c.refId, name: c.name, lat: c.lat, lon: c.lon };
}

/** Normalise a typed waypoint name: trimmed, upper case, inner spaces collapsed; '' if invalid. */
export function cleanWaypointName(s: string): string {
  const t = s.trim().toUpperCase().replace(/\s+/g, ' ');
  return /^[A-Z0-9][A-Z0-9 ./_-]{0,23}$/.test(t) ? t : '';
}

/** First free automatic name WP1, WP2, … not used on the route. */
export function autoWaypointName(route: Pick<RoutePoint, 'name'>[]): string {
  const used = new Set(route.map((p) => p.name));
  for (let i = 1; ; i++) if (!used.has(`WP${i}`)) return `WP${i}`;
}
