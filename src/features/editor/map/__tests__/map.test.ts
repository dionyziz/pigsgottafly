// Unit tests of the map's pure parts: snapping, leg-label text and placement, route edits, GeoJSON.
// Run: npx vitest run --config src/features/editor/map/__tests__/vitest.config.ts
// (or move to tests/unit/map/ — the root vitest config only includes tests/unit/**).
import { describe, expect, it } from 'vitest';
import type { RoutePoint, Waypoint } from '../../../../shared';
import { legKey } from '../../../../shared';
import { distanceNm } from '../../../../calc';
import { AERODROMES, AIRSPACES, VFR_POINTS, VFR_ROUTES } from '../../../../data/ref';
import {
  aerodromeName, autoWaypointName, buildCandidates, cleanWaypointName, findSnap, pointFromCandidate, routeCandidates,
  type SnapCandidate,
} from '../snap';
import { fmtAltitude, fmtCourse, fmtDistance, labelMode, parseAltitudeInput, placeLabel } from '../labels';
import { insertPoint, mercatorMid, pruneOverrides, removePoint, renamePoint, replacePoint, setAltitudeOverride } from '../routeEdit';
import { airspaceFeatures, circleRing, destination, fmtLimit, fmtRouteAltitude, midpointFeatures, runwayHeading, vfrRouteFeatures } from '../features';

// A flat test projection: 100 px per degree, y down.
const project = (lon: number, lat: number) => ({ x: lon * 100, y: -lat * 100 });
const cand = (name: string, lat: number, lon: number, penaltyPx = 0, kind: SnapCandidate['kind'] = 'vfr'): SnapCandidate => ({
  kind, refId: name, name, lat, lon, detail: '', penaltyPx,
});
const pt = (uid: string, lat = 38, lon = 23, name = uid.toUpperCase()): RoutePoint => ({ uid, kind: 'custom', refId: null, name, lat, lon });

describe('findSnap', () => {
  const cands = [cand('A', 38, 23), cand('B', 38, 23.1)];
  it('snaps to the nearest candidate within the radius', () => {
    const hit = findSnap({ x: 2302, y: -3800 }, cands, project, 12);
    expect(hit?.cand.name).toBe('A');
    expect(hit?.distPx).toBeCloseTo(2, 6);
    expect(findSnap({ x: 2308, y: -3800 }, cands, project, 12)?.cand.name).toBe('B');
  });
  it('returns null outside the radius (exactly at the radius still snaps)', () => {
    expect(findSnap({ x: 2350, y: -3800 }, cands, project, 12)).toBeNull();
    expect(findSnap({ x: 2288, y: -3800 }, cands, project, 12)?.cand.name).toBe('A');
    expect(findSnap({ x: 2287.9, y: -3800 }, cands, project, 12)).toBeNull();
  });
  it('breaks near ties with the penalty (aerodrome over an ofm point)', () => {
    const c = [cand('OFM', 38, 23.01, 3), cand('LGXX', 38, 23.05, 0, 'aerodrome')];
    // ofm 1.5 px + 3 penalty > aerodrome 2.5 px → the aerodrome wins
    expect(findSnap({ x: 2302.5, y: -3800 }, c, project, 12)?.cand.name).toBe('LGXX');
    // on the ofm point: 0 + 3 < 4 → it wins despite the penalty
    expect(findSnap({ x: 2301, y: -3800 }, c, project, 12)?.cand.name).toBe('OFM');
  });
  it('skips candidates outside the geographic box without projecting them', () => {
    let calls = 0;
    const counting = (lon: number, lat: number) => { calls++; return project(lon, lat); };
    findSnap({ x: 2300, y: -3800 }, cands, counting, 12, { west: 22.9, east: 23.05, south: 37.9, north: 38.1 });
    expect(calls).toBe(1);
  });
});

describe('snap candidates from the reference data', () => {
  const wp: Waypoint = { id: 'w1', name: 'ZOFRI', lat: 37.9, lon: 23.5, notes: '', created: 0, updated: 0 };
  const all = buildCandidates(AERODROMES, VFR_POINTS, [wp]);
  it('includes every aerodrome by ICAO, the VFR points and my waypoints', () => {
    const lgtt = all.find((c) => c.kind === 'aerodrome' && c.refId === 'LGTT');
    expect(lgtt?.name).toBe('LGTT');
    expect(all.filter((c) => c.kind === 'aerodrome')).toHaveLength(AERODROMES.length);
    expect(all.find((c) => c.kind === 'waypoint')?.name).toBe('ZOFRI');
    expect(all.some((c) => c.kind === 'vfr' && c.refId === 'LGAV/PIKAD')).toBe(true);
  });
  it('drops open-flightmaps duplicates of a charted point', () => {
    const vfr = all.filter((c) => c.kind === 'vfr');
    for (const c of vfr.filter((c) => c.penaltyPx === 3)) {
      const twin = vfr.find((o) => o.penaltyPx !== 3 && o.name === c.name && distanceNm(o, c) <= 0.5);
      expect(twin).toBeUndefined();
    }
    expect(vfr.length).toBeLessThanOrEqual(VFR_POINTS.length);
  });
  it('names aerodromes without ICAO by the last part of their name', () => {
    expect(aerodromeName({ icao: null, name: 'KALAMATA / TRIODHON' } as never)).toBe('TRIODHON');
  });
  it('a snapped route point carries kind, refId, name and position', () => {
    const lgtt = all.find((c) => c.refId === 'LGTT')!;
    expect(pointFromCandidate(lgtt, 'u1')).toEqual({ uid: 'u1', kind: 'aerodrome', refId: 'LGTT', name: 'LGTT', lat: lgtt.lat, lon: lgtt.lon });
  });
  it('route candidates exclude the dragged point', () => {
    expect(routeCandidates([pt('a'), pt('b')], 'a').map((c) => c.name)).toEqual(['B']);
  });
});

describe('waypoint names', () => {
  it('cleans typed names', () => {
    expect(cleanWaypointName('  zofri ')).toBe('ZOFRI');
    expect(cleanWaypointName('dam  north')).toBe('DAM NORTH');
    expect(cleanWaypointName('')).toBe('');
    expect(cleanWaypointName('<x>')).toBe('');
    expect(cleanWaypointName('A'.repeat(25))).toBe('');
  });
  it('auto names skip used ones', () => {
    expect(autoWaypointName([])).toBe('WP1');
    expect(autoWaypointName([{ name: 'WP1' }, { name: 'WP3' }])).toBe('WP2');
  });
});

describe('leg label text', () => {
  it('magnetic course as three digits with a degree sign', () => {
    expect(fmtCourse(62.4)).toBe('062°');
    expect(fmtCourse(359.6)).toBe('360°');
    expect(fmtCourse(0.2)).toBe('360°');
    expect(fmtCourse(NaN)).toBe('---°');
  });
  it('distance', () => {
    expect(fmtDistance(24.4)).toBe('24 NM');
    expect(fmtDistance(9.94)).toBe('9.9 NM');
    expect(fmtDistance(9.96)).toBe('10 NM');
    expect(fmtDistance(0.04)).toBe('0.0 NM');
  });
  it('altitude in hundreds of feet', () => {
    expect(fmtAltitude(3000)).toBe('A030');
    expect(fmtAltitude(2549)).toBe('A025');
    expect(fmtAltitude(12500)).toBe('A125');
    expect(fmtAltitude(NaN)).toBe('A---');
  });
  it('parses what the pilot types', () => {
    expect(parseAltitudeInput('')).toBeNull();
    expect(parseAltitudeInput('  ')).toBeNull();
    expect(parseAltitudeInput('3500')).toBe(3500);
    expect(parseAltitudeInput('3500 ft')).toBe(3500);
    expect(parseAltitudeInput('35')).toBe(3500);
    expect(parseAltitudeInput('a035')).toBe(3500);
    expect(parseAltitudeInput('FL055')).toBe(5500);
    expect(parseAltitudeInput('fl 75')).toBe(7500);
    expect(parseAltitudeInput('abc')).toBeNaN();
    expect(parseAltitudeInput('25000')).toBeNaN();
  });
  it('label mode by screen length', () => {
    expect(labelMode(200)).toBe('full');
    expect(labelMode(80)).toBe('compact');
    expect(labelMode(20)).toBe('hidden');
  });
});

describe('leg label placement', () => {
  it('east-bound leg: horizontal text above the line', () => {
    const p = placeLabel({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(p.angleDeg).toBeCloseTo(0);
    expect(p.normal.x).toBeCloseTo(0);
    expect(p.normal.y).toBeCloseTo(-1);
    expect(p.mid).toEqual({ x: 50, y: 0 });
    expect(p.lengthPx).toBe(100);
  });
  it('west-bound leg reads left to right too (never upside down)', () => {
    const p = placeLabel({ x: 100, y: 0 }, { x: 0, y: 0 });
    expect(Math.abs(p.angleDeg)).toBeCloseTo(0);
    expect(p.normal.y).toBeCloseTo(-1);
  });
  it('angles stay within (−90, 90] and the label sits above the line', () => {
    for (let a = 0; a < 360; a += 7) {
      const r = (a * Math.PI) / 180;
      const p = placeLabel({ x: 0, y: 0 }, { x: Math.cos(r) * 100, y: Math.sin(r) * 100 });
      expect(p.angleDeg).toBeGreaterThan(-90.0001);
      expect(p.angleDeg).toBeLessThanOrEqual(90.0001);
      expect(p.normal.y).toBeLessThanOrEqual(1e-9); // never below the line on screen
      expect(Math.hypot(p.normal.x, p.normal.y)).toBeCloseTo(1);
      // normal ⟂ leg
      expect(p.normal.x * Math.cos(r) + p.normal.y * Math.sin(r)).toBeCloseTo(0);
    }
  });
  it('south-east leg (down-right on screen) rotates clockwise', () => {
    const p = placeLabel({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(p.angleDeg).toBeCloseTo(45);
    expect(p.normal.x).toBeGreaterThan(0);
    expect(p.normal.y).toBeLessThan(0);
  });
});

describe('route edits', () => {
  const r = [pt('a', 38, 23), pt('b', 38.2, 23.4), pt('c', 38.5, 24)];
  it('insert, replace, remove, rename', () => {
    expect(insertPoint(r, 1, pt('x')).map((p) => p.uid)).toEqual(['a', 'x', 'b', 'c']);
    expect(insertPoint(r, 99, pt('x')).map((p) => p.uid)).toEqual(['a', 'b', 'c', 'x']);
    const moved = replacePoint(r, 'b', { kind: 'vfr', refId: 'LGAV/PIKAD', name: 'PIKAD', lat: 1, lon: 2 });
    expect(moved[1]).toEqual({ uid: 'b', kind: 'vfr', refId: 'LGAV/PIKAD', name: 'PIKAD', lat: 1, lon: 2 });
    expect(removePoint(r, 'b').map((p) => p.uid)).toEqual(['a', 'c']);
    expect(renamePoint(r, 'c', 'ZOFRI')[2].name).toBe('ZOFRI');
  });
  it('prunes overrides of legs that no longer exist, keeps the object when nothing changes', () => {
    const ov = { [legKey(r[0], r[1])]: { altFt: 3000 }, [legKey(r[1], r[2])]: { altFt: 4500, tasKt: 90 } };
    expect(pruneOverrides(ov, r)).toBe(ov);
    const after = pruneOverrides(ov, removePoint(r, 'c'));
    expect(Object.keys(after)).toEqual([legKey(r[0], r[1])]);
  });
  it('sets and clears the altitude override, keeping other fields', () => {
    const k = 'a>b';
    const ov1 = setAltitudeOverride({}, k, 3500);
    expect(ov1).toEqual({ [k]: { altFt: 3500 } });
    expect(setAltitudeOverride(ov1, k, 3500)).toBe(ov1);
    expect(setAltitudeOverride(ov1, k, null)).toEqual({});
    const ov2 = { [k]: { altFt: 3500, windKt: 10 } };
    expect(setAltitudeOverride(ov2, k, null)).toEqual({ [k]: { windKt: 10 } });
    expect(setAltitudeOverride({}, k, null)).toEqual({});
  });
  it('mercator midpoint lies between the endpoints, north of the plain lat average', () => {
    const [lon, lat] = mercatorMid({ lat: 35, lon: 20 }, { lat: 41, lon: 28 });
    expect(lon).toBe(24);
    expect(lat).toBeGreaterThan(38);
    expect(lat).toBeLessThan(38.2);
    expect(mercatorMid({ lat: 38, lon: 23 }, { lat: 38, lon: 24 })[1]).toBeCloseTo(38, 9);
  });
});

describe('map GeoJSON', () => {
  it('runway heading of the first runway pair', () => {
    expect(runwayHeading({ runways: ['03/21'] } as never)).toBe(30);
    expect(runwayHeading({ runways: ['26L/08R'] } as never)).toBe(80);
    expect(runwayHeading({ runways: [] } as never)).toBeNull();
  });
  it('destination and circles agree with the distance function', () => {
    const [lon, lat] = destination(38, 23.7, 90, 10);
    expect(distanceNm({ lat: 38, lon: 23.7 }, { lat, lon })).toBeCloseTo(10, 6);
    const ring = circleRing(38, 23.7, 5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [x, y] of ring) expect(distanceNm({ lat: 38, lon: 23.7 }, { lat: y, lon: x })).toBeCloseTo(5, 6);
  });
  it('airspace polygons are closed rings in [lon, lat] with chart labels', () => {
    const f = airspaceFeatures(AIRSPACES);
    expect(f.features.length).toBe(AIRSPACES.length);
    const ath = f.features.find((x) => x.properties.id === 'ATHINAI-TMA-1')!;
    const ring = ath.geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[0][0]).toBeGreaterThan(19); // lon first
    expect(String(ath.properties.label)).toMatch(/^ATHINAI TMA/);
    expect(fmtLimit('FL 155')).toBe('FL155');
    expect(fmtLimit('1000 FT AGL')).toBe('1000 AGL');
  });
  it('VFR route segments resolve their points; altitudes formatted as charted', () => {
    const f = vfrRouteFeatures(VFR_ROUTES, VFR_POINTS);
    expect(f.features.length).toBeGreaterThan(VFR_ROUTES.length * 0.4);
    const pikad = f.features.find((x) => x.properties.id === 'LGAV:PIKAD>KIATON');
    expect(pikad?.properties.alt).toBe('6000');
    expect(fmtRouteAltitude({ minFt: 2000, maxFt: 3000 })).toBe('2000–3000');
  });
  it('one midpoint handle per leg', () => {
    expect(midpointFeatures([pt('a'), pt('b', 39, 24), pt('c', 40, 25)]).features).toHaveLength(2);
    expect(midpointFeatures([pt('a')]).features).toHaveLength(0);
  });
});
