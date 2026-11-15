// Hangar screen helpers (src/features/hangar/model.ts): aircraft validation, FPL item 10 codes,
// compass card status, envelope geometry and performance-table reshaping.
import { describe, expect, test } from 'vitest';
import { fleetSeed } from '../../../tools/build_seed';
import { blankAircraft } from '../../../src/shared/templates';
import { buildFromTemplate } from '../../../src/features/hangar/templates';
import {
  addHeadwind, addLandingAltitude, addTakeoffAltitude, addTakeoffMassRow, badPbn, cardStatus, deviationOf, insidePolygon,
  join10a, join10b, missingEssentials, momentPolygonFromCg, newSeatId, newStationId, polygonArea, removeHeadwind,
  removeLandingAltitude, removeTakeoffAltitude, sameTypeCopy, selfIntersects, split10a, split10b, validateAircraft,
} from '../../../src/features/hangar/model';

const TODAY = '2026-11-15';
const errors = (a: Parameters<typeof validateAircraft>[0], today = TODAY) => validateAircraft(a, today).filter((i) => i.level === 'error');

describe('validateAircraft', () => {
  test('the seeded SX-ASV and SX-ASG have no errors', () => {
    for (const a of fleetSeed()) expect(errors(a).map((i) => i.message)).toEqual([]);
  });
  test('a template aircraft has no errors, only "not set" warnings', () => {
    const a = { ...buildFromTemplate('reims-f172m'), registration: 'SX-ABC' };
    expect(errors(a)).toEqual([]);
    const w = validateAircraft(a, TODAY).map((i) => i.path);
    expect(w).toContain('cruiseTasKt');
    expect(w).toContain('fuel.burnLph');
    expect(w).toContain('massBalance.emptyMassKg');
    expect(w).toContain('compassCards');
  });
  test('a blank aircraft needs a registration', () => {
    expect(errors(blankAircraft()).map((i) => i.path)).toContain('registration');
  });
  test('inconsistent values are errors', () => {
    const a = structuredClone(fleetSeed()[0]);
    a.fuel.usableL = a.fuel.totalL + 10;
    a.massBalance.envelopes.normal.polygon = [[0.89, 600], [1.2, 1043], [0.98, 1043], [1.2, 600]]; // bow-tie
    a.massBalance.stations[1].seats = [{ id: 'front-left', label: 'Dup' }];
    a.compassCards[0].expires = '2020-01-01';
    a.equipment.item10a = 'SQ';
    a.equipment.pbn = 'B9';
    const paths = errors(a).map((i) => i.path);
    expect(paths).toContain('fuel.usableL');
    expect(paths).toContain('massBalance.envelopes.normal.polygon');
    expect(paths).toContain('massBalance.stations.1.seats');
    expect(paths).toContain('compassCards.0.expires');
    expect(paths).toContain('equipment.item10a');
    expect(paths).toContain('equipment.pbn');
  });
  test('an expired card is a warning, not an error', () => {
    const a = fleetSeed().find((x) => x.registration === 'SX-ASG')!;
    const later = validateAircraft(a, '2027-03-01');
    expect(later.filter((i) => i.level === 'error')).toEqual([]);
    expect(later.some((i) => i.path === 'compassCards.0.expires' && /expired/.test(i.message))).toBe(true);
  });
  test('empty moment that does not match mass × arm is flagged', () => {
    const a = structuredClone(fleetSeed()[0]);
    a.massBalance.emptyMomentKgM = a.massBalance.emptyMassKg * a.massBalance.emptyArmM + 20;
    expect(validateAircraft(a, TODAY).some((i) => i.path === 'massBalance.emptyMomentKgM')).toBe(true);
  });
});

describe('FPL item 10', () => {
  test('10a split and join', () => {
    expect(split10a('SDFGY')).toEqual(['S', 'D', 'F', 'G', 'Y']);
    expect(split10a('SE1J1')).toEqual(['S', 'E1', 'J1']);
    expect(join10a(['Y', 'G', 'S', 'D'])).toBe('SDGY');
    expect(join10a(['N'])).toBe('N');
    expect(join10a([])).toBe('');
  });
  test('10b split and join', () => {
    expect(split10b('SB2')).toEqual({ ssr: 'S', ads: ['B2'] });
    expect(split10b('C')).toEqual({ ssr: 'C', ads: [] });
    expect(join10b('S', ['B1', 'U2'])).toBe('SB1U2');
    expect(join10b('N', [])).toBe('N');
  });
  test('PBN designators', () => {
    expect(badPbn('')).toEqual([]);
    expect(badPbn('B2D2S1')).toEqual([]);
    expect(badPbn('B9X1')).toEqual(['B9', 'X1']);
  });
});

describe('compass cards', () => {
  test('status', () => {
    expect(cardStatus({ expires: '2028-02-05' }, TODAY, 90)).toEqual({ state: 'valid', days: 447 });
    expect(cardStatus({ expires: '2027-01-10' }, TODAY, 90).state).toBe('expiring');
    expect(cardStatus({ expires: '2026-11-14' }, TODAY, 90)).toEqual({ state: 'expired', days: -1 });
    expect(cardStatus({ expires: '' }, TODAY, 90).state).toBe('unknown');
  });
  test('deviation wraps around north', () => {
    expect(deviationOf(0, 2)).toBe(2);
    expect(deviationOf(0, 358)).toBe(-2);
    expect(deviationOf(359, 1)).toBe(2);
  });
});

describe('geometry', () => {
  const normal: [number, number][] = [[0.89, 600], [0.89, 885], [0.98, 1043], [1.2, 1043], [1.2, 600]];
  test('self-intersection and area', () => {
    expect(selfIntersects(normal)).toBe(false);
    expect(selfIntersects([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(true);
    expect(Math.abs(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]]))).toBe(1);
  });
  test('point in polygon', () => {
    expect(insidePolygon([1.0, 900], normal)).toBe(true);
    expect(insidePolygon([0.9, 1040], normal)).toBe(false);
    expect(insidePolygon([1.2, 800], normal)).toBe(true); // on the edge
  });
  test('moment envelope from CG envelope: every vertex maps to arm × mass, sloped edges are split', () => {
    const m = momentPolygonFromCg(normal, 4);
    // 5 vertices + 3 intermediate points on the one sloped edge (0.89,885)→(0.98,1043)
    expect(m.length).toBe(8);
    expect(m[0]).toEqual([534, 600]);
    expect(m[1]).toEqual([787.7, 885]);
    expect(m[5]).toEqual([1022.1, 1043]);
    // an intermediate point lies on the CG limit line
    const [mom, mass] = m[3];
    const arm = 0.89 + (0.98 - 0.89) * (mass - 885) / (1043 - 885);
    expect(mom / mass).toBeCloseTo(arm, 3);
    // at 1030 kg the forward limit is 0.9726 m → 1001.8 kg·m
    expect(insidePolygon([1005, 1030], m)).toBe(true);
    expect(insidePolygon([998, 1030], m)).toBe(false);
  });
});

describe('stations', () => {
  test('new ids are unique', () => {
    const st = fleetSeed()[0].massBalance.stations;
    expect(newStationId(st, 'bag')).toBe('bag');
    expect(newStationId(st, 'bag1')).toBe('bag12');
    expect(newSeatId(st, 'front')).toBe('front-1');
    expect(newSeatId([{ id: 'x', name: 'X', kind: 'seat', armM: 1, seats: [{ id: 'x-1', label: 'A' }] }], 'x')).toBe('x-2');
  });
});

describe('performance tables', () => {
  const t0 = buildFromTemplate('reims-f172m').performance.takeoff;
  test('adding and removing an altitude column keeps the shape', () => {
    const t = addTakeoffAltitude(t0);
    expect(t.altitudesFt).toEqual([0, 2500, 5000, 7500, 10000]);
    expect(t.standardTempC[4]).toBe(-5);
    for (const r of t.rows) for (const hw of r.distances) expect(hw.length).toBe(5);
    const back = removeTakeoffAltitude(t, 4);
    expect(back.rows.map((r) => r.distances)).toEqual(t0.rows.map((r) => r.distances));
    expect(t0.rows[0].distances[0].length).toBe(4); // input untouched
  });
  test('mass rows and headwinds', () => {
    let t = addTakeoffMassRow(t0);
    expect(t.rows.length).toBe(4);
    expect(t.rows[3].massKg).toBe(1143);
    t = addHeadwind(t, 0);
    expect(t.rows[0].headwindKt).toEqual([0, 10, 20, 30]);
    expect(t.rows[0].distances.length).toBe(4);
    t = removeHeadwind(t, 0, 3);
    expect(t.rows[0]).toEqual(t0.rows[0]);
  });
  test('landing columns', () => {
    const l0 = buildFromTemplate('reims-f172m').performance.landing;
    const l = addLandingAltitude(l0);
    expect(l.distances.length).toBe(5);
    expect(removeLandingAltitude(l, 4)).toEqual(l0);
  });
});

describe('copies', () => {
  test('same-type copy drops the airframe data', () => {
    const src = fleetSeed()[0];
    const c = sameTypeCopy(src, 'SX-NEW');
    expect(c.registration).toBe('SX-NEW');
    expect(c.serial).toBe('');
    expect(c.compassCards).toEqual([]);
    expect(c.massBalance.emptyMassKg).toBe(0);
    expect(c.massBalance.envelopes).toEqual(src.massBalance.envelopes);
    expect(c.cruiseTasKt).toBe(src.cruiseTasKt);
    expect(src.serial).not.toBe('');
  });
  test('missing essentials', () => {
    expect(missingEssentials(buildFromTemplate('reims-f172m'))).toEqual(expect.arrayContaining(['cruise TAS', 'fuel burn', 'empty mass']));
    expect(missingEssentials(buildFromTemplate('reims-f172m'))).not.toContain('MTOW');
  });
});
