// Default leg altitudes.
//   1. A leg joining two VFR reporting points along a charted VFR route: the charted altitude (the
//      highest permitted, `maxFt`), respecting one-way routes and direction-specific altitudes.
//   2. Otherwise (the rule of the v2 app, js/app.js calc()): the last leg flies the destination's
//      pattern altitude (elevation + 1000 ft, rounded to 100 ft); the first leg the departure's;
//      other legs keep the previous leg's altitude.
//   3. TODO(calc agent): a leg touching a custom/saved waypoint takes the altitude of the closest
//      charted VFR route leg (PLAN-v3). Not implemented yet: such legs currently follow rule 2.
// Every default can be overridden per leg (LegOverride.altFt).
import type { LatLon, RoutePoint } from '../shared/types.js';
import type { RefAerodrome, RefVfrPoint, RefVfrRoute } from '../shared/ref.js';
import { distanceNm } from './nav.js';

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
 * chart), respecting one-way routes; null if none. Points from open flightmaps (src 'ofm') are not
 * on the charts and never match.
 */
export function vfrRouteBetween(a: LatLon, b: LatLon, ctx: AltitudeContext): RefVfrRoute | null {
  const near = (p: LatLon) => ctx.vfrPoints.filter((v) => v.src !== 'ofm' && distanceNm(p, v) <= 1.5);
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
    let d: AltitudeDefault;
    if (r) d = { altFt: r.maxFt, source: 'vfr-route', route: r };
    else if (i === n - 1 && isFinite(patternAltitudeFt(b, ctx))) d = { altFt: patternAltitudeFt(b, ctx), source: 'pattern', route: null };
    else if (i > 0) d = { altFt: effective[i - 1], source: isFinite(effective[i - 1]) ? 'previous' : 'none', route: null };
    else {
      const p = patternAltitudeFt(a, ctx);
      d = { altFt: p, source: isFinite(p) ? 'pattern' : 'none', route: null };
    }
    out.push(d);
    const o = overrides[i];
    effective.push(o !== undefined && isFinite(o) ? o : d.altFt);
  }
  return out;
}
