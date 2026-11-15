import { expect, test } from 'vitest';
import { buildLegs, defaultAltitudes, windComponents, pressureAltitudeFt, densityAltitudeFt } from '../../../src/calc';
import { REF, aerodrome, vfrPoint } from '../../../src/data/ref';
import type { RoutePoint } from '../../../src/shared';

const ad = (icao: string): RoutePoint => { const a = aerodrome(icao)!; return { uid: icao + Math.random(), kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon }; };
const vfr = (id: string): RoutePoint => { const p = vfrPoint(id)!; return { uid: id, kind: 'vfr', refId: id, name: p.name, lat: p.lat, lon: p.lon }; };
const ctx = { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes };

test('legs carry course, distance and magnetic course', () => {
  const legs = buildLegs([ad('LGTT'), ad('LGMG')], '2026-11-20');
  expect(legs).toHaveLength(1);
  expect(legs[0].distNm).toBeGreaterThan(15);
  expect(legs[0].mcMag).toBe((Math.round(legs[0].tcTrue) - Math.round(legs[0].variation) + 360) % 360);
});

// Independent course: spherical-vector formulation (great-circle normal), not src/calc/nav.ts.
const vec = (p: { lat: number; lon: number }) => {
  const r = Math.PI / 180;
  return [Math.cos(p.lat * r) * Math.cos(p.lon * r), Math.cos(p.lat * r) * Math.sin(p.lon * r), Math.sin(p.lat * r)];
};
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Course of the great circle a→b where it passes the point m (on it), degrees true. */
function courseAt(a: { lat: number; lon: number }, b: { lat: number; lon: number }, m: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const n = cross(vec(a), vec(b)); // normal of the great-circle plane
  const M = vec(m);
  const dir = cross(n, M); // direction of travel at m
  const north = [-Math.sin(m.lat * r) * Math.cos(m.lon * r), -Math.sin(m.lat * r) * Math.sin(m.lon * r), Math.cos(m.lat * r)];
  const east = [-Math.sin(m.lon * r), Math.cos(m.lon * r), 0];
  return ((Math.atan2(dot(dir, east), dot(dir, north)) * 180) / Math.PI + 360) % 360;
}

test('TC is the great-circle course at the leg midpoint (as read off a VFR chart), not the initial course', () => {
  const custom = (name: string, lat: number, lon: number): RoutePoint => ({ uid: name, kind: 'custom', refId: null, name, lat, lon });
  // Review case: (38.9, 22.4) → LGKR, 123 NM: initial 290.80°, mid-leg 290.02° → TC 290 (chart), not 291.
  const [l1] = buildLegs([custom('A', 38.9, 22.4), ad('LGKR')], '2026-11-20');
  expect(l1.tcInitial).toBeCloseTo(290.80, 1);
  expect(l1.tcTrue).toBeCloseTo(290.02, 1);
  expect(l1.tcTrue).toBeCloseTo(courseAt(l1.from, l1.to, l1.mid), 6);
  expect(Math.round(l1.tcTrue)).toBe(290);
  // LGTT → LGMK, 85 NM (AIP ARP coordinates): initial 118.03° (→ 118), mid-leg 118.51° (→ 119).
  const [l2] = buildLegs([ad('LGTT'), ad('LGMK')], '2026-11-20');
  expect(l2.tcInitial).toBeCloseTo(118.03, 1);
  expect(l2.tcTrue).toBeCloseTo(118.51, 1);
  expect(l2.tcTrue).toBeCloseTo(courseAt(l2.from, l2.to, l2.mid), 6);
  // A meridian: the course does not change along the leg.
  const [l3] = buildLegs([custom('S', 37, 23), custom('N', 38, 23)], '2026-11-20');
  expect(l3.tcTrue).toBeCloseTo(0, 9);
});

test('map magnetic course = the sheet TC + VAR (each rounded), so label and navlog agree', () => {
  const custom = (name: string, lat: number, lon: number): RoutePoint => ({ uid: name, kind: 'custom', refId: null, name, lat, lon });
  // Review case: LGTT → (37.65, 24.33): the unrounded TC − VAR gave 131 on the map while the sheet
  // wrote TC 137, VAR −5 → MC 132.
  const route = [ad('LGTT'), custom('P', 37.65, 24.33), custom('Q', 39.5, 20.1), ad('LGKR'), ad('LGTT')];
  const legs = buildLegs(route, '2026-11-20');
  for (const l of legs) {
    const sheetTc = Math.round(l.tcTrue);
    const sheetVar = -Math.round(l.variation);
    expect(l.mcMag).toBe((sheetTc + sheetVar + 360) % 360);
    expect(Number.isInteger(l.mcMag)).toBe(true);
  }
});

test('default altitudes: charted VFR route, then the v2 rules', () => {
  const route = [ad('LGTT'), vfr('LGAV/MEGARA'), vfr('LGAV/KORINTHOS'), ad('LGTT')];
  const d = defaultAltitudes(route, ctx);
  expect(d[1]).toMatchObject({ altFt: 3500, source: 'vfr-route' });
  expect(d[3 - 1].source).toBe('pattern');
  expect(d[0].source).toBe('pattern');
});

test('wind components and pressure/density altitude', () => {
  const w = windComponents(30, 60, 20);
  expect(w.headwindKt).toBeCloseTo(17.32, 2);
  expect(w.crosswindKt).toBeCloseTo(10, 6);
  expect(w.crossFrom).toBe('R');
  expect(windComponents(30, 210, 10).headwindKt).toBeCloseTo(-10, 6);
  // ISA barometric formula (calc-perf); the club's 27 ft/hPa gives 1131, v2's 30 ft/hPa gave 1161.
  expect(pressureAltitudeFt(861, 1003.25)).toBeCloseTo(1135.09, 1);
  expect(densityAltitudeFt(0, 15)).toBeCloseTo(0, 6);
  expect(densityAltitudeFt(0, 25)).toBeCloseTo(1200, 6);
});
