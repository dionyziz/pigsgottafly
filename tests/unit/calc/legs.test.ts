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
  expect(legs[0].mcMag).toBeCloseTo((legs[0].tcTrue - legs[0].variation + 360) % 360, 9);
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
  expect(pressureAltitudeFt(861, 1003.25)).toBeCloseTo(1161, 6);
  expect(densityAltitudeFt(0, 15)).toBeCloseTo(0, 6);
  expect(densityAltitudeFt(0, 25)).toBeCloseTo(1200, 6);
});
