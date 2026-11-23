// Default leg altitudes: charted VFR routes (direction-specific, one-way), the v2 pattern/previous
// rules, and the closest-charted-leg rule for custom points, checked against a brute-force reference.
import fs from 'node:fs';

import { expect, test } from 'vitest';

import {
  chartedSegments,
  CLOSEST_ROUTE_MAX_NM,
  closestVfrRoute,
  defaultAltitudes,
  patternAltitudeFt,
  TERRAIN_CLEARANCE_FT,
  terrainMaxFt,
  vfrRouteBetween,
} from '../../../src/calc';
import { aerodrome, REF, vfrPoint } from '../../../src/data/ref';
import type { LatLon, RoutePoint } from '../../../src/shared';
import { course, haversineNm, n360 } from './navlog.oracle';

const ctx = { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes };
let k = 0;
const ad = (icao: string): RoutePoint => {
  const a = aerodrome(icao)!;
  return { uid: 'u' + k++, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const vfr = (id: string): RoutePoint => {
  const p = vfrPoint(id)!;
  return { uid: 'u' + k++, kind: 'vfr', refId: id, name: p.name, lat: p.lat, lon: p.lon };
};
const custom = (lat: number, lon: number, name = 'ZOFRI', kind: 'custom' | 'waypoint' = 'custom'): RoutePoint => ({
  uid: 'u' + k++,
  kind,
  refId: null,
  name,
  lat,
  lon,
});
const lerp = (a: LatLon, b: LatLon, t: number): LatLon => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lon: a.lon + (b.lon - a.lon) * t,
});

/** Brute force: distance from p to a charted leg with an altitude by sampling 2000 points along it (haversine). */
function bruteClosest(p: LatLon) {
  let best = { id: '', d: Infinity };
  for (const s of chartedSegments(ctx)) {
    if (s.route.maxFt === null) continue;
    for (let i = 0; i <= 2000; i++) {
      const d = haversineNm(p, lerp(s.a, s.b, i / 2000));
      if (d < best.d) best = { id: s.route.id, d };
    }
  }
  return best;
}

test('v2 rules: charted route, pattern at destination and departure, previous leg', () => {
  const route = [ad('LGTT'), vfr('LGAV/MEGARA'), vfr('LGAV/KORINTHOS'), ad('LGTT')];
  const d = defaultAltitudes(route, ctx);
  // LGTT elev 861 → 1861 → 1900
  expect(d.map((x) => [x.altFt, x.source])).toEqual([
    [1900, 'pattern'],
    [3500, 'vfr-route'],
    [1900, 'pattern'],
  ]);
  const e = defaultAltitudes(
    [ad('LGTT'), vfr('LGAV/MEGARA'), vfr('LGAV/KORINTHOS'), vfr('LGAV/DAPORI'), ad('LGEL')],
    ctx,
    [4500],
  );
  expect(e[0]).toMatchObject({ altFt: 1900, source: 'pattern' });
  expect(e[1]).toMatchObject({ altFt: 3500, source: 'vfr-route' });
  expect(e[3]).toMatchObject({ altFt: 1100, source: 'pattern' }); // LGEL 144 ft
  // a leg not on a charted route keeps the previous leg's EFFECTIVE altitude
  const f = defaultAltitudes([ad('LGTT'), ad('LGAV'), ad('LGEL'), ad('LGMG')], ctx, [undefined, 5500]);
  expect(f.map((x) => [x.altFt, x.source])).toEqual([
    [1900, 'pattern'],
    [1900, 'previous'],
    [1000, 'pattern'],
  ]);
  expect(defaultAltitudes([ad('LGTT'), ad('LGAV'), ad('LGEL'), ad('LGMG')], ctx, [undefined, 5500])[1].altFt).toBe(
    1900,
  );
  const g = defaultAltitudes([ad('LGTT'), ad('LGAV'), ad('LGEL'), ad('LGMG')], ctx, [2500, 5500]);
  expect(g[1]).toMatchObject({ altFt: 2500, source: 'previous' });
  expect(g[2]).toMatchObject({ altFt: 1000, source: 'pattern' });
  expect(patternAltitudeFt({ lat: 35, lon: 20 }, ctx)).toBeNaN();
  expect(defaultAltitudes([ad('LGTT')], ctx)).toEqual([]);
});

test('direction-specific charted altitudes and one-way routes', () => {
  const egn = vfrPoint('LGAV/EGN')!,
    dap = vfrPoint('LGAV/DAPORI')!;
  expect(vfrRouteBetween(egn, dap, ctx)).toMatchObject({ id: 'LGAV:EGN>DAPORI', maxFt: 2500 });
  expect(vfrRouteBetween(dap, egn, ctx)).toMatchObject({ id: 'LGAV:DAPORI>EGN', maxFt: 2000 });
  // every one-way route without a reverse partner never matches backwards
  const ids = new Set(REF.vfrRoutes.map((r) => `${r.chart}:${r.a}>${r.b}`));
  const lone = REF.vfrRoutes.filter((r) => r.oneway && !ids.has(`${r.chart}:${r.b}>${r.a}`));
  for (const r of lone.slice(0, 10)) {
    const s = chartedSegments(ctx).find((x) => x.route.id === r.id)!;
    expect(vfrRouteBetween(s.a, s.b, ctx)?.id).toBe(r.id);
    const back = vfrRouteBetween(s.b, s.a, ctx);
    expect(back === null || back.id !== r.id).toBe(true);
  }
});

test('charted points located from open flightmaps match their routes (LGBL ANL ↔ STEFANO)', () => {
  const anl = vfrPoint('LGBL/ANL')!,
    stef = vfrPoint('LGBL/STEFANO')!;
  expect(stef.src).toBe('ofm');
  expect(vfrRouteBetween(anl, stef, ctx)).toMatchObject({ id: 'LGBL:ANL>STEFANO', maxFt: 4500 });
  expect(vfrRouteBetween(stef, anl, ctx)).toMatchObject({ id: 'LGBL:STEFANO>ANL', maxFt: 3500 });
  // every charted route has geometry
  expect(chartedSegments(ctx)).toHaveLength(REF.vfrRoutes.length);
});

test('custom point: closest charted leg (brute-force check), direction-specific', () => {
  const anl = vfrPoint('LGBL/ANL')!,
    stef = vfrPoint('LGBL/STEFANO')!;
  // two custom points along ANL → STEFANO, slightly off the line
  const a = custom(lerp(anl, stef, 0.35).lat, lerp(anl, stef, 0.35).lon + 0.01, 'ZOFRI');
  const b = custom(lerp(anl, stef, 0.65).lat, lerp(anl, stef, 0.65).lon + 0.01, 'XENIA', 'waypoint');
  const brute = bruteClosest(lerp(a, b, 0.5));
  expect(['LGBL:ANL>STEFANO', 'LGBL:STEFANO>ANL']).toContain(brute.id);
  const fwd = defaultAltitudes([a, b], ctx);
  expect(fwd[0]).toMatchObject({ altFt: 4500, source: 'closest-route' });
  expect(fwd[0].route!.id).toBe('LGBL:ANL>STEFANO');
  const back = defaultAltitudes([b, a], ctx);
  expect(back[0]).toMatchObject({ altFt: 3500, source: 'closest-route' });
  expect(back[0].route!.id).toBe('LGBL:STEFANO>ANL');
});

test('custom point between charted points: each leg measured from the custom point', () => {
  // a point 1 NM off MEGARA–KORINTHOS (3500 ft), joined from LGTT and continuing to LGMG
  const m = vfrPoint('LGAV/MEGARA')!,
    kor = vfrPoint('LGAV/KORINTHOS')!;
  const p = lerp(m, kor, 0.5);
  const z = custom(p.lat + 1 / 60, p.lon);
  const brute = bruteClosest(z);
  const got = closestVfrRoute(z, ctx, n360(course(ad('LGTT'), z)));
  expect(got!.distNm).toBeCloseTo(brute.d, 1);
  const segBrute = REF.vfrRoutes.find((r) => r.id === brute.id)!;
  expect(got!.route.maxFt).toBe(segBrute.maxFt);
  const d = defaultAltitudes([ad('LGTT'), z, vfr('LGAV/KORINTHOS'), ad('LGTT')], ctx);
  expect(d[0]).toMatchObject({ source: 'closest-route', altFt: segBrute.maxFt });
  expect(d[1]).toMatchObject({ source: 'closest-route', altFt: segBrute.maxFt });
  expect(d[2]).toMatchObject({ source: 'pattern', altFt: 1900 }); // into LGTT
});

test('closest-route sampled against brute force at many places', () => {
  // grid over Attica / Evia / Peloponnese; the rule uses a local flat projection, so allow 1 %
  // of the distance (the choice of leg only matters within CLOSEST_ROUTE_MAX_NM)
  for (let lat = 37.2; lat <= 39.4; lat += 0.55)
    for (let lon = 21.6; lon <= 24.6; lon += 0.75) {
      const p = { lat, lon };
      const got = closestVfrRoute(p, ctx, NaN, 1e9)!;
      const b = bruteClosest(p);
      expect(Math.abs(got.distNm - b.d), `${lat},${lon}: ${b.d}`).toBeLessThan(Math.max(0.05, 0.01 * b.d));
      if (b.d < CLOSEST_ROUTE_MAX_NM)
        expect(
          REF.vfrRoutes.find((r) => r.id === b.id)!.maxFt === got.route.maxFt || Math.abs(got.distNm - b.d) < 0.05,
        ).toBe(true);
    }
});

test('custom point far from any charted leg: v2 rules apply', () => {
  const sea = custom(34.6, 26.5); // south of Crete
  expect(bruteClosest(sea).d).toBeGreaterThan(CLOSEST_ROUTE_MAX_NM);
  expect(closestVfrRoute(sea, ctx)).toBeNull();
  const d = defaultAltitudes([ad('LGTT'), sea, custom(34.7, 26.6)], ctx, [5500]);
  expect(d[0]).toMatchObject({ source: 'pattern', altFt: 1900 });
  expect(d[1]).toMatchObject({ source: 'previous', altFt: 5500 });
});

test('a custom last leg into an aerodrome flies the pattern altitude', () => {
  const m = vfrPoint('LGAV/MEGARA')!,
    kor = vfrPoint('LGAV/KORINTHOS')!;
  const z = custom(lerp(m, kor, 0.5).lat, lerp(m, kor, 0.5).lon);
  const d = defaultAltitudes([ad('LGMG'), z, ad('LGTT')], ctx);
  expect(d[0].source).toBe('closest-route');
  expect(d[1]).toMatchObject({ source: 'pattern', altFt: 1900 });
});

test('an uncharted leg touching no aerodrome: 1000 ft above the highest ground along it, rounded up to 500 ft', () => {
  const grid = new Uint8Array(fs.readFileSync('public/terrain/greece.bin'));
  const id = (name: string) => REF.vfrPoints.find((p) => p.name === name && p.chart === 'LGAV')!.id;
  // Tatoi – Holargos – Hellinikon – Kastella – Tatoi: Hellinikon–Kastella is charted at 1500 ft
  const route = [ad('LGTT'), vfr(id('HOLARGOS')), vfr(id('HELLINIKON')), vfr(id('KASTELLA')), ad('LGTT')];
  const d = defaultAltitudes(route, { ...ctx, terrain: grid });
  expect(d.map((x) => [x.altFt, x.source])).toEqual([
    [1900, 'pattern'],
    [2500, 'terrain'], // the west slope of Hymettus, up to ~1460 ft
    [1500, 'vfr-route'],
    [1900, 'pattern'],
  ]);
  expect(terrainMaxFt(grid, route[1], route[2]) + TERRAIN_CLEARANCE_FT).toBeLessThanOrEqual(2500);
  // without the grid: the previous leg's altitude, as before
  expect(defaultAltitudes(route, ctx)[1]).toMatchObject({ altFt: 1900, source: 'previous' });
});
