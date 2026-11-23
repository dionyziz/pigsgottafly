import { describe, expect, it } from 'vitest';

import { distanceNm } from '../../../../calc';
import { AD_AIRSPACES, AERODROMES, AIRSPACES, FIR, NAVAIDS, VFR_POINTS, VFR_ROUTES } from '../../../../data/ref';
import type { RoutePoint, Waypoint } from '../../../../shared';
import { legKey } from '../../../../shared';
import type { RefArea } from '../../../../shared/ref';
import {
  airspaceInfos,
  airspaceLabel,
  airspacesAt,
  contains,
  firRing,
  fmtVertical,
  fmtVLimit,
  fromArea,
  limitFt,
  pointInRing,
  shortClass,
} from '../airspace';
import {
  airspaceFeatures,
  areaFeatures,
  circleRing,
  destination,
  fmtLimit,
  fmtRouteAltitude,
  midpointFeatures,
  navaidFeatures,
  navaidFreq,
  runwayHeading,
  vfrRouteFeatures,
  zoneFeatures,
} from '../features';
import { hazardsByLeg, type MapHazard, mapHazards } from '../hazardLayer';
import { fmtAltitude, fmtCourse, fmtDistance, labelMode, parseAltitudeInput, placeLabel } from '../labels';
import {
  addDrawnPoint,
  drawIndex,
  insertPoint,
  isBareRoundTrip,
  isRoundTrip,
  mercatorMid,
  movePoint,
  pruneOverrides,
  removeDrawnPoint,
  removePoint,
  renamePoint,
  replacePoint,
  setAltitudeOverride,
} from '../routeEdit';
import {
  aerodromeName,
  autoWaypointName,
  buildCandidates,
  cleanWaypointName,
  findSnap,
  pointFromCandidate,
  routeCandidates,
  type SnapCandidate,
} from '../snap';

// A flat test projection: 100 px per degree, y down.
const project = (lon: number, lat: number) => ({ x: lon * 100, y: -lat * 100 });
const cand = (
  name: string,
  lat: number,
  lon: number,
  penaltyPx = 0,
  kind: SnapCandidate['kind'] = 'vfr',
): SnapCandidate => ({
  kind,
  refId: name,
  name,
  lat,
  lon,
  detail: '',
  penaltyPx,
});
const pt = (uid: string, lat = 38, lon = 23, name = uid.toUpperCase()): RoutePoint => ({
  uid,
  kind: 'custom',
  refId: null,
  name,
  lat,
  lon,
});

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
  it('prefers an aerodrome over a VFR point next to it while the two are not apart on screen (LGSY / SKS)', () => {
    const all = buildCandidates(AERODROMES, VFR_POINTS, []);
    const lgsy = all.find((c) => c.kind === 'aerodrome' && c.refId === 'LGSY')!;
    const sks = all.find((c) => c.kind === 'vfr' && c.name === 'SKS' && distanceNm(c, lgsy) < 1)!;
    expect(sks).toBeTruthy();
    // the reviewer's view (whole route on screen): SKS, 0.6 NM north of LGSY, is 4.4 px away
    const pxPerDeg = 434;
    const proj = (lon: number, lat: number) => ({
      x: lon * pxPerDeg * Math.cos((38.97 * Math.PI) / 180),
      y: -lat * pxPerDeg,
    });
    const a = proj(lgsy.lon, lgsy.lat),
      v = proj(sks.lon, sks.lat);
    expect(Math.hypot(a.x - v.x, a.y - v.y)).toBeLessThan(6);
    // the reviewer's click: 5 px north-east of the aerodrome symbol, nearer to SKS
    const hit = findSnap({ x: a.x + 4, y: a.y - 3 }, all, proj, 12)!;
    expect(hit.cand.refId).toBe('LGSY');
    expect(hit.shadowed?.name).toBe('SKS');
    // zoomed in (8× more px per degree) the two are far apart: a click on SKS picks SKS
    const proj8 = (lon: number, lat: number) => {
      const p = proj(lon, lat);
      return { x: p.x * 8, y: p.y * 8 };
    };
    const v8 = proj8(sks.lon, sks.lat);
    const hit8 = findSnap({ x: v8.x + 1, y: v8.y }, all, proj8, 12)!;
    expect(hit8.cand.name).toBe('SKS');
    expect(hit8.shadowed).toBeUndefined();
  });
  it('an aerodrome does not take over a VFR point more than 1.5 NM away', () => {
    // 2 NM apart, 4.5 px apart on a coarse screen
    const coarse = (lon: number, lat: number) => ({ x: lon * 100, y: -lat * 100 });
    const far = [cand('FAR', 38, 23.045), cand('LGXX', 38, 23.0, 0, 'aerodrome')];
    expect(distanceNm(far[0], far[1])).toBeGreaterThan(1.5);
    expect(findSnap({ x: 2304.5, y: -3800 }, far, coarse, 12)?.cand.name).toBe('FAR');
  });
  it('skips candidates outside the geographic box without projecting them', () => {
    let calls = 0;
    const counting = (lon: number, lat: number) => {
      calls++;
      return project(lon, lat);
    };
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
    expect(aerodromeName({ icao: null, name: 'KALAMATA / TRIODHON' })).toBe('TRIODHON');
  });
  it('a snapped route point carries kind, refId, name and position', () => {
    const lgtt = all.find((c) => c.refId === 'LGTT')!;
    expect(pointFromCandidate(lgtt, 'u1')).toEqual({
      uid: 'u1',
      kind: 'aerodrome',
      refId: 'LGTT',
      name: 'LGTT',
      lat: lgtt.lat,
      lon: lgtt.lon,
    });
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
  it('altitude in feet, flight levels from the transition altitude', () => {
    expect(fmtAltitude(3000)).toBe('3000');
    expect(fmtAltitude(2549)).toBe('2549');
    expect(fmtAltitude(6000)).toBe('6000');
    expect(fmtAltitude(6500)).toBe('FL065');
    expect(fmtAltitude(9500)).toBe('FL095');
    expect(fmtAltitude(12500)).toBe('FL125');
    expect(fmtAltitude(NaN)).toBe('---');
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
    // a 13 NM leg at the zoom that fits a 140 NM route (~3.6 px/NM) still gets course and distance
    expect(labelMode(47)).toBe('compact');
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
  it('the label sits left of the track: an out-and-back gets one label on each side', () => {
    const out = placeLabel({ x: 0, y: 0 }, { x: 100, y: -40 });
    const back = placeLabel({ x: 100, y: -40 }, { x: 0, y: 0 });
    expect(out.angleDeg).toBeCloseTo(back.angleDeg);
    expect(out.side).toBe(1);
    expect(back.side).toBe(-1);
    // left of travel = the screen side reached by rotating the track direction 90° counter-clockwise
    for (let a = 0; a < 360; a += 7) {
      const r = (a * Math.PI) / 180,
        dir = { x: Math.cos(r), y: Math.sin(r) };
      const p = placeLabel({ x: 0, y: 0 }, { x: dir.x * 100, y: dir.y * 100 });
      const off = { x: p.normal.x * p.side, y: p.normal.y * p.side };
      // east-bound (1, 0) → label up (0, −1), i.e. north, left of the track: off.x·dir.y − off.y·dir.x = +1
      expect(off.x * dir.y - off.y * dir.x).toBeCloseTo(1);
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
  it('a dragged point keeps its uid while it stays the same point, and becomes a new point when it snaps to another', () => {
    const ad: RoutePoint = { uid: 'b', kind: 'aerodrome', refId: 'LGMG', name: 'LGMG', lat: 37.98, lon: 23.36 };
    const rr = [r[0], ad, r[2]];
    const fresh = () => 'n1';
    // snapped onto a VFR point: it is that point now, with a new uid (new legs: their overrides go)
    const v = movePoint(rr, 'b', { kind: 'vfr', refId: 'LGAV/PIKAD', name: 'PIKAD', lat: 1, lon: 2 }, fresh);
    expect(v[1]).toEqual({ uid: 'n1', kind: 'vfr', refId: 'LGAV/PIKAD', name: 'PIKAD', lat: 1, lon: 2 });
    const ov = { [legKey(rr[0], rr[1])]: { altFt: 3000 }, [legKey(rr[1], rr[2])]: { altFt: 4500 } };
    expect(pruneOverrides(ov, v)).toEqual({});
    // dropped back on the same aerodrome, or a custom point moved: same uid
    expect(movePoint(rr, 'b', { ...ad }, fresh)[1].uid).toBe('b');
    const c = movePoint(r, 'b', { kind: 'custom', refId: null, name: 'B', lat: 5, lon: 6 }, fresh);
    expect(c[1]).toEqual({ uid: 'b', kind: 'custom', refId: null, name: 'B', lat: 5, lon: 6 });
    // a known point dropped as a custom point is a new point too
    expect(movePoint(rr, 'b', { kind: 'custom', refId: null, name: 'WP1', lat: 5, lon: 6 }, fresh)[1].uid).toBe('n1');
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
    const f = airspaceFeatures(airspaceInfos(AIRSPACES));
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
  it('radio navaids: ICAO symbol per type, ident label, frequency as charted', () => {
    const f = navaidFeatures(NAVAIDS);
    expect(f.features).toHaveLength(NAVAIDS.length);
    const at = (id: string) => f.features.find((x) => x.properties.id === id)!;
    const atv = at('ATV VOR/DME');
    expect(atv.geometry.coordinates).toEqual([23.804497, 37.888678]); // lon first
    expect(atv.properties).toMatchObject({ label: 'ATV', freq: '114.40', icon: 'pgf-nav-vordme', rank: 1 });
    expect(at('AXE VOR').properties).toMatchObject({ icon: 'pgf-nav-vor', freq: '110.60' });
    // an en-route NDB is drawn from the FIR view, an aerodrome locator once zoomed in
    expect(at('KOR NDB').properties).toMatchObject({ icon: 'pgf-nav-ndb', freq: '392', rank: 1 });
    expect(at('HER L').properties).toMatchObject({ icon: 'pgf-nav-l', freq: '431', rank: 2 });
    // one ident for a locator and a VOR/DME: two features
    expect(f.features.filter((x) => x.properties.label === 'SUD').map((x) => x.properties.icon)).toEqual([
      'pgf-nav-l',
      'pgf-nav-vordme',
    ]);
    const vortac = { id: 'X', ident: 'X', type: 'VORTAC', lat: 38, lon: 23 } as const;
    expect(
      navaidFeatures([{ ...vortac, unit: 'MHz', freq: 113.1, channel: '78X', sources: [] } as never]).features[0]
        .properties.icon,
    ).toBe('pgf-nav-vortac');
    expect(navaidFreq({ freq: null, unit: 'MHz', channel: '48X' })).toBe('CH 48X');
    expect(navaidFreq({ freq: 109.85, unit: 'MHz', channel: '35Y' })).toBe('109.85');
  });
  it('every navaid type has its symbol', async () => {
    const { SYMBOLS } = await import('../symbols');
    for (const t of ['VOR', 'VOR/DME', 'VORTAC', 'TACAN', 'DME', 'NDB', 'NDB/DME', 'L']) {
      const icon = navaidFeatures([
        { id: t, ident: 'X', type: t, freq: 1, unit: 'MHz', channel: null, lat: 38, lon: 23, sources: [] } as never,
      ]).features[0].properties.icon as string;
      expect(SYMBOLS[icon], t).toBeDefined();
    }
  });
  it('one midpoint handle per leg', () => {
    expect(midpointFeatures([pt('a'), pt('b', 39, 24), pt('c', 40, 25)]).features).toHaveLength(2);
    expect(midpointFeatures([pt('a')]).features).toHaveLength(0);
  });
});

describe('airspace on the map', () => {
  const infos = airspaceInfos(AIRSPACES, AD_AIRSPACES);
  it('vertical limits as on charts', () => {
    expect(fmtVLimit('SFC')).toBe('SFC');
    expect(fmtVLimit('5000 FT')).toBe('5000 ft');
    expect(fmtVLimit('1000 FT AGL')).toBe('1000 ft AGL');
    expect(fmtVLimit('FL 95')).toBe('FL095');
    expect(fmtVLimit('FL 155')).toBe('FL155');
    expect(fmtVertical('SFC', '5000 FT')).toBe('SFC – 5000 ft');
    expect(limitFt('FL 155')).toEqual({ ft: 15500, agl: false });
    expect(limitFt('1000 FT AGL')).toEqual({ ft: 1000, agl: true });
    expect(limitFt('UNL').ft).toBe(Infinity);
    expect(shortClass('E (C above FL 195)')).toBe('E');
  });
  it('labels carry name, class and vertical limits', () => {
    expect(airspaceLabel({ name: 'DEKELIA TATOI MIL ATZ', cls: 'D', lower: 'SFC', upper: '5000 FT' })).toBe(
      'DEKELIA TATOI MIL ATZ · D · SFC – 5000 ft',
    );
    const tma = airspaceFeatures(airspaceInfos(AIRSPACES)).features.find((f) => f.properties.id === 'ATHINAI-TMA-1')!;
    expect(tma.properties.label).toMatch(/^ATHINAI TMA · [A-G] · \d+ ft AGL – FL\d{3}$/);
  });
  it('the FIR is a simple closed ring around the outlying aerodromes, on the OSM border over land', () => {
    const fir = firRing(FIR)!;
    expect(FIR.boundary[0]).toEqual(FIR.boundary[FIR.boundary.length - 1]);
    const side = (p: number[], q: number[], r: number[]) =>
      Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const n = fir.length - 1;
    let crossings = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n - (i === 0 ? 1 : 0); j++) {
        const [a, b, c, d] = [fir[i], fir[i + 1], fir[j], fir[j + 1]];
        if (Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.min(c[0], d[0]) > Math.max(a[0], b[0])) continue;
        if (side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0) crossings++;
      }
    expect(crossings).toBe(0);
    for (const id of ['LGTT', 'LGKR', 'LGAL', 'LGSM', 'LGRP', 'LGKO']) {
      const a = AERODROMES.find((x) => x.id === id)!;
      expect(pointInRing(a.lon, a.lat, fir), id).toBe(true);
    }
    // Greek side of the Albanian border near Konitsa and of the Evros; Albania and Türkiye outside
    expect(pointInRing(20.75, 40.05, fir)).toBe(true);
    expect(pointInRing(20.55, 40.15, fir)).toBe(false);
    expect(pointInRing(26.25, 41.0, fir)).toBe(true);
    expect(pointInRing(26.4, 41.0, fir)).toBe(false);
  });
  it('airspace the AIP limits by the FIR boundary stops at it (Samos, Alexandroupolis); the rest is untouched', () => {
    const fir = firRing(FIR)!;
    const clipped = airspaceInfos(AIRSPACES, AD_AIRSPACES, [], FIR);
    const byId = (id: string) => clipped.find((a) => a.id === id)!;
    for (const id of [
      'SAMOS-TMA-1',
      'LGSM-CTR',
      'LGSM-ATZ',
      'ALEXANDROUPOLIS-TMA-1',
      'LGAL-CTR',
      'LGKO-CTR',
      'LGHI-CTR',
    ]) {
      const a = byId(id);
      // every vertex inside the FIR or on its boundary
      const toEdge = (x: number, y: number) =>
        Math.min(
          ...fir.slice(1).map(([bx, by], k) => {
            const [ax, ay] = fir[k];
            const t = Math.max(
              0,
              Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)),
            );
            return Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y);
          }),
        );
      for (const [x, y] of a.ring) if (!pointInRing(x, y, fir)) expect(toEdge(x, y)).toBeLessThan(1e-6);
    }
    // Kuşadası and Didim (Türkiye) are not in the Samos TMA; the aerodromes still are in their zones
    expect(contains(byId('SAMOS-TMA-1'), 27.26, 37.86)).toBe(false);
    expect(contains(byId('SAMOS-TMA-1'), 27.26, 37.38)).toBe(false);
    expect(contains(byId('LGSM-ATZ'), 26.9122, 37.6892)).toBe(true);
    expect(contains(byId('LGAL-CTR'), 25.9561, 40.8558)).toBe(true);
    expect(contains(byId('ALEXANDROUPOLIS-TMA-1'), 26.3, 40.85)).toBe(false); // east of the Evros
    expect(contains(byId('ALEXANDROUPOLIS-TMA-1'), 26.1, 40.85)).toBe(true); // west of it
    // not FIR-limited: same shape with or without the FIR
    expect(byId('LGLR-CTR').ring).toEqual(infos.find((a) => a.id === 'LGLR-CTR')!.ring);
  });
  it('zones are drawn as published: CTR and ATZ apart, with class (LGLR is a CTR of 10 NM and an ATZ of 7 NM)', () => {
    const f = zoneFeatures(infos).features;
    expect(f.length).toBe(AD_AIRSPACES.length);
    const lglr = f.filter((x) => String(x.properties.id).startsWith('LGLR-'));
    expect(lglr.map((x) => [x.properties.kind, x.properties.label])).toEqual([
      ['CTR', 'LARISSA MIL CTR · D · SFC – 5000 ft'],
      ['ATZ', 'LARISSA MIL ATZ · D · SFC – 2000 ft'],
    ]);
    const lgav = f.find((x) => x.properties.id === 'LGAV-CTR')!;
    expect(lgav.geometry.coordinates[0]).toHaveLength(5); // the published quadrilateral, closed
    expect(f.find((x) => x.properties.id === 'LGNX-ATZ')!.properties.cls).toBe('G');
  });
  it('what lies under a point, smallest first: Tatoi ATZ inside the Athinai TMA', () => {
    const at = airspacesAt(infos, 23.7833, 38.1086);
    expect(at[0].id).toBe('LGTT-ATZ');
    expect(at.some((a) => a.type === 'TMA' && a.name === 'ATHINAI TMA')).toBe(true);
    expect(airspacesAt(infos, 20.0, 34.0)).toEqual([]);
  });
  it('point in ring', () => {
    const sq: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    expect(pointInRing(0.5, 0.5, sq)).toBe(true);
    expect(pointInRing(1.5, 0.5, sq)).toBe(false);
  });
  it('ENR 5 areas: circles and polygons with a short lateral description, the activity kept', () => {
    const base = {
      kind: 'P' as const,
      name: 'ACROPOLIS',
      lower: 'GND',
      upper: '5000 FT ALT',
      lateral: 'A circle, 700 M radius centered on 375820N 0234333E.',
      activity: 'H24',
      remarks: 'Prohibited to all flights.',
      source: 'ENR 5.1',
    };
    const p1 = fromArea({ ...base, id: 'LGP1', circle: { lat: 37.97222, lon: 23.72583, radiusNm: 700 / 1852 } })!;
    expect([p1.type, p1.name, p1.lateral, p1.activity, p1.ring.length]).toEqual([
      'P',
      'LGP1 ACROPOLIS',
      'Circle, 0.38 NM radius',
      'H24',
      65,
    ]);
    expect(airspacesAt([p1, ...infos], 23.72583, 37.97222)[0].id).toBe('LGP1');
    const sq = fromArea({
      ...base,
      id: 'LGR9',
      kind: 'R',
      polygon: [
        [37, 23],
        [37, 24],
        [38, 24],
        [37, 23],
      ],
    })!;
    expect(sq.lateral).toBe('Polygon, 3 points');
    expect(fromArea({ ...base, id: 'X' })).toBeNull();
  });
  it('time-limited areas: drawn only on the days in force, labelled with their designator, windows in the details', () => {
    const sq: [number, number][] = [
      [37, 20],
      [37, 21],
      [38, 21],
      [37, 20],
    ];
    const area = (o: Partial<RefArea>): RefArea => ({
      id: 'X',
      kind: 'D',
      name: 'JOINT FLYING COURSE (JFC) 2026',
      lower: 'SFC',
      upper: 'FL 280',
      lateral: '',
      polygon: sq,
      activity: 'AMC Manageable areas (AMA)',
      remarks: '',
      source: 'AIP SUP 39/26',
      ...o,
    });
    const areas = [
      area({ id: 'LGD12S', upper: 'FL 240', validFrom: '2026-10-15', validUntil: '2026-10-30' }),
      area({
        id: 'LGD12S-NOV',
        designator: 'LGD12S',
        validFrom: '2026-11-02',
        validUntil: '2026-11-27',
        windows: [
          { from: '2026-11-23T11:30Z', to: '2026-11-23T13:30Z' },
          { from: '2026-11-27T08:00Z', to: '2026-11-27T10:00Z' },
        ],
      }),
      area({ id: 'LGD102A', validFrom: '2026-06-11', validUntil: '2027-06-09', upper: 'UNL', lower: 'FL 295' }),
      area({ id: 'LGD76', source: 'ENR 5.1' }),
    ];
    const on = (day: string) => airspaceInfos([], [], areas, undefined, day).map((a) => a.id);
    expect(on('2026-10-30')).toEqual(['LGD12S', 'LGD102A', 'LGD76']);
    expect(on('2026-11-23')).toEqual(['LGD12S-NOV', 'LGD102A', 'LGD76']);
    // expired: gone without a data change
    expect(on('2026-11-28')).toEqual(['LGD102A', 'LGD76']);
    expect(on('2027-06-10')).toEqual(['LGD76']);
    // no day: all (the reference data as is)
    expect(airspaceInfos([], [], areas)).toHaveLength(4);
    const nov = airspaceInfos([], [], areas, undefined, '2026-11-24').find((a) => a.id === 'LGD12S-NOV')!;
    expect([nov.code, nov.name]).toEqual(['LGD12S', 'LGD12S JOINT FLYING COURSE (JFC) 2026']);
    expect(nov.timeRows).toEqual([
      { label: 'Valid', text: 'until 27 NOV 2026' },
      { label: 'Windows (UTC)', text: '27 NOV 0800–1000' },
    ]);
    // an area without dates has no such rows
    expect(
      airspaceInfos([], [], areas, undefined, '2026-11-24').find((a) => a.id === 'LGD76')!.timeRows,
    ).toBeUndefined();
    // the chart label uses the designator
    const f = areaFeatures([nov]).features[0];
    expect(f.properties.id).toBe('LGD12S-NOV');
    expect(f.properties.label).toBe('LGD12S · SFC – FL280');
  });
});

describe('map style', () => {
  it('is a valid MapLibre style (expressions included)', async () => {
    // the style-spec validator ships with maplibre-gl
    const { validateStyleMin } = await import('@maplibre/maplibre-gl-style-spec');
    const { buildStyle } = await import('../style');
    const { style } = buildStyle('light', false, null);
    const errors = validateStyleMin(style).map((e: { message: string }) => e.message);
    expect(errors).toEqual([]);
  });
});

describe('drawing on a round trip (home → home)', () => {
  const ad = (uid: string, icao: string, lat = 37.92, lon = 23.73): RoutePoint => ({
    uid,
    kind: 'aerodrome',
    refId: icao,
    name: icao,
    lat,
    lon,
  });
  const names = (r: RoutePoint[]) => r.map((p) => p.name).join(' > ');
  it('recognises a route that returns to its start', () => {
    expect(isRoundTrip([ad('a', 'LGTT'), ad('b', 'LGTT')])).toBe(true);
    expect(isBareRoundTrip([ad('a', 'LGTT'), ad('b', 'LGTT')])).toBe(true);
    expect(isRoundTrip([ad('a', 'LGTT'), pt('x', 38.1, 23.5), ad('b', 'LGTT')])).toBe(true);
    expect(isBareRoundTrip([ad('a', 'LGTT'), pt('x', 38.1, 23.5), ad('b', 'LGTT')])).toBe(false);
    expect(isRoundTrip([pt('a', 38, 23), pt('b', 38, 23)])).toBe(true);
    expect(isRoundTrip([ad('a', 'LGTT'), ad('b', 'LGMG', 37.98, 23.37)])).toBe(false);
    expect(isRoundTrip([ad('a', 'LGTT')])).toBe(false);
    expect(isRoundTrip([])).toBe(false);
  });
  it('adds drawn points before the closing aerodrome (LGTT > ABLONAS > LGTT, not LGTT > LGTT > ABLONAS)', () => {
    let r = [ad('a', 'LGTT'), ad('b', 'LGTT')];
    expect(drawIndex(r)).toBe(1);
    r = addDrawnPoint(r, pt('ablonas', 38.03, 23.62, 'ABLONAS'));
    expect(names(r)).toBe('LGTT > ABLONAS > LGTT');
    r = addDrawnPoint(r, pt('zofri', 38.3, 23.9, 'ZOFRI'));
    expect(names(r)).toBe('LGTT > ABLONAS > ZOFRI > LGTT');
    expect(r[0].uid).toBe('a');
    expect(r[3].uid).toBe('b');
  });
  it('appends at the end of a one-way route, and on a round trip when continuing from its last point', () => {
    const oneWay = [ad('a', 'LGTT'), ad('b', 'LGMG', 37.98, 23.37)];
    expect(names(addDrawnPoint(oneWay, pt('x', 38, 23, 'X')))).toBe('LGTT > LGMG > X');
    expect(names(addDrawnPoint([], ad('a', 'LGTT')))).toBe('LGTT');
    expect(names(addDrawnPoint([ad('a', 'LGTT')], pt('x', 38, 23, 'X')))).toBe('LGTT > X');
    const loop = [ad('a', 'LGTT'), pt('x', 38, 23, 'X'), ad('b', 'LGTT')];
    expect(names(addDrawnPoint(loop, pt('y', 38.5, 22, 'Y'), true))).toBe('LGTT > X > LGTT > Y');
  });
  it('Backspace removes the point drawn last, keeping the return home', () => {
    const loop = [ad('a', 'LGTT'), pt('x', 38, 23, 'X'), pt('y', 38.2, 23.2, 'Y'), ad('b', 'LGTT')];
    expect(names(removeDrawnPoint(loop))).toBe('LGTT > X > LGTT');
    expect(names(removeDrawnPoint(removeDrawnPoint(loop)))).toBe('LGTT > LGTT');
    // a bare home → home keeps its departure
    expect(names(removeDrawnPoint([ad('a', 'LGTT'), ad('b', 'LGTT')]))).toBe('LGTT');
    expect(names(removeDrawnPoint(loop, true))).toBe('LGTT > X > Y');
    expect(names(removeDrawnPoint([ad('a', 'LGTT'), pt('x', 38, 23, 'X')]))).toBe('LGTT');
  });
});

describe('weather hazards on the map', () => {
  const legs = [
    { from: { lat: 38, lon: 23 }, to: { lat: 38.5, lon: 23.5 } },
    { from: { lat: 38.5, lon: 23.5 }, to: { lat: 39, lon: 24 } },
  ];
  const hz = (scope: unknown, level: 'danger' | 'warn', text: string) =>
    ({ scope, level, text, fromFrac: 0.2, toFrac: 0.6 }) as unknown as Parameters<typeof mapHazards>[0][number];
  it('keeps the leg of each mark (aerodrome hazards: first / last leg) and drops the time range', () => {
    const marks = mapHazards(
      [
        hz({ type: 'leg', legIndex: 1 }, 'warn', 'BKN 1400 ft · planned 1900 ft, 09:00–10:00Z'),
        hz({ type: 'departure' }, 'danger', 'TS at LGTT'),
        hz({ type: 'destination' }, 'warn', 'Visibility 4 km'),
        hz({ type: 'leg', legIndex: 5 }, 'warn', 'nowhere'),
      ],
      legs,
    );
    expect(marks.map((m) => [m.legIndex, m.label])).toEqual([
      [1, 'BKN 1400 ft · planned 1900 ft'],
      [0, 'TS at LGTT'],
      [1, 'Visibility 4 km'],
    ]);
    expect(marks[0].coords).toHaveLength(2);
    expect(marks[1].coords).toHaveLength(1);
  });
  it('summarises the hazards per leg for the label badges: worst level, danger first, no repeats', () => {
    const m = (legIndex: number | null, level: 'danger' | 'warn', label: string): MapHazard => ({
      level,
      label,
      legIndex,
      coords: [[0, 0]],
    });
    const by = hazardsByLeg([
      m(1, 'warn', 'BKN 1400 ft'),
      m(1, 'danger', 'TS'),
      m(1, 'warn', 'BKN 1400 ft'),
      m(0, 'warn', 'VIS'),
      m(null, 'danger', 'x'),
    ]);
    expect([...by.keys()].sort()).toEqual([0, 1]);
    expect(by.get(1)).toEqual({ level: 'danger', labels: ['TS', 'BKN 1400 ft'] });
    expect(by.get(0)).toEqual({ level: 'warn', labels: ['VIS'] });
  });
});
