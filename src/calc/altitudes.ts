// Default leg altitudes (ported from the v2 app, js/app.js calc(), plus the PLAN-v3 custom-point rule).
//   1. A leg joining two VFR reporting points along a charted VFR route: the charted altitude (the
//      highest permitted, `maxFt`). One-way routes match only in their direction; direction-specific
//      altitudes are charted as two one-way routes (e.g. LGBL ANL>STEFANO 4500, STEFANO>ANL 3500).
//   2. The last leg flies the destination's pattern altitude (elevation + 1000 ft, rounded to 100 ft)
//      when the destination is an aerodrome (within 2 NM).
//   3. A leg touching a custom point (kind 'custom', or the pilot's saved 'waypoint') takes the
//      altitude of the closest charted VFR route leg, within CLOSEST_ROUTE_MAX_NM of the custom point
//      (of the leg midpoint when both ends are custom). Among charted legs at the same place (a
//      direction-specific pair), the one flown in the leg's direction wins.
//   4. Otherwise (v2): the first leg flies the departure's pattern altitude; other legs keep the
//      previous leg's effective (possibly overridden) altitude.
// Every default can be overridden per leg (LegOverride.altFt).
import type { LatLon, RoutePoint } from '../shared/types.js';
import type { RefAerodrome, RefVfrPoint, RefVfrRoute } from '../shared/ref.js';
import { distanceNm, midpoint, norm180, pointSegDistNm, trueCourse } from './nav.js';

export interface AltitudeContext {
  aerodromes: RefAerodrome[];
  vfrPoints: RefVfrPoint[];
  vfrRoutes: RefVfrRoute[];
}

export interface AltitudeDefault {
  /** Default altitude, ft; NaN when no rule gives one. */
  altFt: number;
  /** Which rule produced it. */
  source: 'vfr-route' | 'pattern' | 'previous' | 'closest-route' | 'none';
  /** The charted route used (source 'vfr-route' / 'closest-route'). */
  route: RefVfrRoute | null;
}

/** A custom point further than this from every charted VFR route leg gets no 'closest-route' default. */
export const CLOSEST_ROUTE_MAX_NM = 10;

/** Nearest aerodrome within maxNm, or null. */
export function nearestAerodrome(p: LatLon, aerodromes: RefAerodrome[], maxNm: number): RefAerodrome | null {
  let best: RefAerodrome | null = null, bd = Infinity;
  for (const a of aerodromes) {
    if (!isFinite(a.lat) || !isFinite(a.lon)) continue;
    const d = distanceNm(p, a);
    if (d < bd) { bd = d; best = a; }
  }
  return bd <= maxNm ? best : null;
}

/**
 * Charted VFR route between two points (each within 1.5 NM of a reporting point printed on the same
 * chart), respecting one-way routes; null if none.
 * Points with src 'ofm' DO match: tools/build_vfr.py gives src 'ofm' to charted reporting points
 * whose position was taken from open flightmaps (152 route end points, e.g. LGBL STEFANO), so the v2
 * filter `src !== 'ofm'` made those charted routes unreachable. An extra open-flightmaps point only
 * matches when it carries the name of a route end point on that chart.
 */
export function vfrRouteBetween(a: LatLon, b: LatLon, ctx: AltitudeContext): RefVfrRoute | null {
  const near = (p: LatLon) => ctx.vfrPoints.filter((v) => distanceNm(p, v) <= 1.5);
  const A = near(a), B = near(b);
  for (const va of A) for (const vb of B) {
    if (va.name === vb.name) continue;
    const r = ctx.vfrRoutes.find(
      (r) => r.chart === va.chart && r.chart === vb.chart &&
        ((r.a === va.name && r.b === vb.name) || (!r.oneway && r.a === vb.name && r.b === va.name)),
    );
    if (r) return r;
  }
  return null;
}

/** Traffic pattern altitude near p: aerodrome elevation + 1000 ft rounded to 100 ft; NaN if none. */
export function patternAltitudeFt(p: LatLon, ctx: AltitudeContext): number {
  const ad = nearestAerodrome(p, ctx.aerodromes, 2);
  return ad && ad.elevFt !== null && isFinite(ad.elevFt) ? Math.round((ad.elevFt + 1000) / 100) * 100 : NaN;
}

/** A charted VFR route leg with the positions of its end points. */
export interface ChartedSegment {
  route: RefVfrRoute;
  a: LatLon;
  b: LatLon;
}

const segCache = new WeakMap<RefVfrRoute[], { points: RefVfrPoint[]; segs: ChartedSegment[] }>();

/**
 * Geometry of every charted VFR route leg (end points looked up by chart and name; when a name is
 * printed twice on one chart, e.g. 'SKYROPOULA#2', the pair giving the shortest leg is used).
 * Cached per context.
 */
export function chartedSegments(ctx: AltitudeContext): ChartedSegment[] {
  const hit = segCache.get(ctx.vfrRoutes);
  if (hit && hit.points === ctx.vfrPoints) return hit.segs;
  const byKey = new Map<string, RefVfrPoint[]>();
  for (const p of ctx.vfrPoints) {
    const k = p.chart + '/' + p.name;
    const l = byKey.get(k);
    if (l) l.push(p); else byKey.set(k, [p]);
  }
  const segs: ChartedSegment[] = [];
  for (const r of ctx.vfrRoutes) {
    const A = byKey.get(r.chart + '/' + r.a), B = byKey.get(r.chart + '/' + r.b);
    if (!A || !B) continue;
    let best: ChartedSegment | null = null, bl = Infinity;
    for (const a of A) for (const b of B) {
      const l = distanceNm(a, b);
      if (l < bl) { bl = l; best = { route: r, a: { lat: a.lat, lon: a.lon }, b: { lat: b.lat, lon: b.lon } }; }
    }
    if (best) segs.push(best);
  }
  segCache.set(ctx.vfrRoutes, { points: ctx.vfrPoints, segs });
  return segs;
}

/**
 * The charted VFR route leg closest to p (within maxNm), or null. When several charted legs are
 * equally close (within 0.05 NM, e.g. a direction-specific pair drawn on the same line), the one
 * whose direction is allowed for a flight on courseDeg wins: non-one-way legs always, one-way legs
 * when their a → b course is within 90° of courseDeg.
 */
export function closestVfrRoute(
  p: LatLon,
  ctx: AltitudeContext,
  courseDeg: number = NaN,
  maxNm: number = CLOSEST_ROUTE_MAX_NM,
): { route: RefVfrRoute; distNm: number } | null {
  const scored = chartedSegments(ctx).map((s) => ({ s, d: pointSegDistNm(p, s.a, s.b).dist }));
  let best = Infinity;
  for (const x of scored) if (x.d < best) best = x.d;
  if (!(best <= maxNm)) return null;
  const tied = scored.filter((x) => x.d <= best + 0.05);
  const allowed = (s: ChartedSegment) =>
    !s.route.oneway || !isFinite(courseDeg) || Math.abs(norm180(trueCourse(s.a, s.b) - courseDeg)) < 90;
  tied.sort((x, y) => Number(allowed(y.s)) - Number(allowed(x.s)) || x.d - y.d);
  return { route: tied[0].s.route, distNm: tied[0].d };
}

const isCustom = (p: RoutePoint) => p.kind === 'custom' || p.kind === 'waypoint';

/**
 * Default altitude of every leg of the route (index i = leg route[i] → route[i+1]).
 * @param overrides altitude typed for each leg (NaN/undefined = none); "previous leg" uses the
 *                  effective (possibly overridden) altitude of the previous leg.
 */
export function defaultAltitudes(route: RoutePoint[], ctx: AltitudeContext, overrides: (number | undefined)[] = []): AltitudeDefault[] {
  const n = Math.max(0, route.length - 1);
  const out: AltitudeDefault[] = [];
  const effective: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = route[i], b = route[i + 1];
    const r = vfrRouteBetween(a, b, ctx);
    let d: AltitudeDefault | null = null;
    if (r) d = { altFt: r.maxFt, source: 'vfr-route', route: r };
    else if (i === n - 1 && isFinite(patternAltitudeFt(b, ctx))) d = { altFt: patternAltitudeFt(b, ctx), source: 'pattern', route: null };
    else if (isCustom(a) || isCustom(b)) {
      const ref = isCustom(a) && isCustom(b) ? midpoint(a, b) : isCustom(a) ? a : b;
      const c = closestVfrRoute(ref, ctx, trueCourse(a, b));
      if (c) d = { altFt: c.route.maxFt, source: 'closest-route', route: c.route };
    }
    if (!d) {
      if (i > 0) d = { altFt: effective[i - 1], source: isFinite(effective[i - 1]) ? 'previous' : 'none', route: null };
      else {
        const p = patternAltitudeFt(a, ctx);
        d = { altFt: p, source: isFinite(p) ? 'pattern' : 'none', route: null };
      }
    }
    out.push(d);
    const o = overrides[i];
    effective.push(o !== undefined && isFinite(o) ? o : d.altFt);
  }
  return out;
}
