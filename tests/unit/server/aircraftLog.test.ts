// The diff behind the aircraft edit log (api/_lib/aircraftLog.ts): short values old → new, lists and
// tables summarized, long text only "changed", key order of stored (jsonb) records irrelevant.
import { describe, expect, test } from 'vitest';

import { diffAircraft, sameJson } from '../../../api/_lib/aircraftLog';
import { blankAircraft } from '../../../src/shared/templates';
import type { AircraftInput } from '../../../src/shared/types';

const base = (): AircraftInput => {
  const a = blankAircraft();
  a.registration = 'SX-ABC';
  a.massBalance.stations = [
    { id: 'front', name: 'Front', kind: 'seat', armM: 0.94, seats: [{ id: 'fl', label: 'Front left' }] },
    { id: 'rear', name: 'Rear', kind: 'seat', armM: 1.85, seats: [{ id: 'rl', label: 'Rear left' }] },
  ];
  return a;
};
const changed = (fn: (a: AircraftInput) => void) => {
  const a = base();
  const b = structuredClone(a);
  fn(b);
  return diffAircraft(a, b);
};

describe('sameJson', () => {
  test('ignores key order and undefined keys', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1, e: undefined })).toBe(true);
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameJson({ a: null }, {})).toBe(false);
  });
});

describe('diffAircraft', () => {
  test('nothing changed', () => {
    expect(diffAircraft(base(), base())).toEqual([]);
  });

  test('short values old → new, nested paths, booleans and nulls', () => {
    expect(
      changed((a) => {
        a.homeBase = 'LGAV';
        a.fuel.burnLph = 32;
        a.equipment.emergencyRadio.elt = true;
        a.climbTasKt = 70;
        a.massBalance.mlwKg = 1000;
      }),
    ).toEqual([
      { path: 'homeBase', from: '', to: 'LGAV' },
      { path: 'climbTasKt', from: null, to: 70 },
      { path: 'fuel.burnLph', from: 0, to: 32 },
      { path: 'massBalance.mlwKg', from: null, to: 1000 },
      { path: 'equipment.emergencyRadio.elt', from: false, to: true },
    ]);
  });

  test('the operator id is left out (its name says the same)', () => {
    expect(
      changed((a) => {
        a.operatorId = 'op_1';
        a.operator = 'Aeroclub';
      }),
    ).toEqual([{ path: 'operator', from: '', to: 'Aeroclub' }]);
  });

  test('fuels as text', () => {
    expect(changed((a) => a.fuel.types.push({ type: 'MOGAS', densityKgPerL: 0.75 }))).toEqual([
      { path: 'fuel.types', from: 'AVGAS', to: 'AVGAS, MOGAS' },
    ]);
  });

  test('long text: only that it changed', () => {
    expect(changed((a) => (a.notes = 'n'.repeat(81)))).toEqual([{ path: 'notes' }]);
    expect(changed((a) => (a.notes = 'two\nlines'))).toEqual([{ path: 'notes' }]);
  });

  test('stations counted by id: changed, added, removed, reordered', () => {
    expect(
      changed((a) => {
        a.massBalance.stations[0].armM = 1;
        a.massBalance.stations[1].name = 'Back';
      }),
    ).toEqual([{ path: 'massBalance.stations', summary: '2 stations changed' }]);
    expect(
      changed((a) => {
        a.massBalance.stations.splice(1, 1);
        a.massBalance.stations.push({ id: 'bag', name: 'Baggage', kind: 'baggage', armM: 2.4, maxKg: 54 });
        a.massBalance.stations.push({ id: 'bag2', name: 'Baggage 2', kind: 'baggage', armM: 3, maxKg: 20 });
      }),
    ).toEqual([{ path: 'massBalance.stations', summary: '2 stations added, 1 station removed' }]);
    expect(changed((a) => a.massBalance.stations.reverse())).toEqual([
      { path: 'massBalance.stations', summary: 'stations reordered' },
    ]);
  });

  test('envelopes, utility category, performance tables, stall speeds, compass cards', () => {
    expect(
      changed((a) => {
        a.massBalance.envelopes.normal.polygon = [
          [0.9, 600],
          [1.2, 1000],
        ];
        a.massBalance.envelopes.normal.maxKg = 1043;
        a.massBalance.envelopes.utility = { category: 'utility', maxKg: 907, polygon: [] };
        a.performance.takeoff.rows = [{ massKg: 1043, liftoffIasKt: 51, headwindKt: [0], distances: [[]] }];
        a.performance.takeoff.altitudesFt = [];
        a.performance.takeoff.flaps = '10°';
        a.performance.landing.distances = [[1, 2]];
        a.performance.factors.runwayCondition = { grass: 1.2 };
        a.performance.stallIasKt = { flapsUp: [44], flaps10: [], flaps40: [] };
        a.compassCards = [{ name: 'Compass', swung: '2026-01-01', expires: '2027-01-01', source: '', points: [] }];
      }),
    ).toEqual([
      { path: 'massBalance.envelopes.normal.maxKg', from: 0, to: 1043 },
      { path: 'massBalance.envelopes.normal.polygon', summary: 'normal CG envelope changed' },
      { path: 'massBalance.envelopes.utility', summary: 'utility envelope added' },
      { path: 'performance.takeoff.flaps', from: '', to: '10°' },
      { path: 'performance.takeoff.table', summary: 'take-off table changed' },
      { path: 'performance.landing.table', summary: 'landing table changed' },
      { path: 'performance.factors.runwayCondition', summary: 'runway condition factors changed' },
      { path: 'performance.stallIasKt', summary: 'stall speeds changed' },
      { path: 'compassCards', summary: '1 compass card added' },
    ]);
  });

  test('dinghies: added, then field by field', () => {
    expect(
      changed((a) => (a.equipment.dinghies = { number: 1, capacity: 4, covered: false, colour: 'ORANGE' })),
    ).toEqual([{ path: 'equipment.dinghies', summary: 'dinghies added' }]);
    const a = base();
    a.equipment.dinghies = { number: 1, capacity: 4, covered: false, colour: 'ORANGE' };
    const b = structuredClone(a);
    b.equipment.dinghies!.capacity = 6;
    expect(diffAircraft(a, b)).toEqual([{ path: 'equipment.dinghies.capacity', from: 4, to: 6 }]);
  });

  test('records read back from jsonb (keys reordered) list changes in the hangar’s order', () => {
    const a = base();
    const b = structuredClone(a);
    b.registration = 'SX-ABD';
    b.fuel.usableL = 140;
    const reversed = Object.fromEntries(Object.entries(a).reverse()) as unknown as AircraftInput;
    expect(diffAircraft(reversed, b).map((c) => c.path)).toEqual(['registration', 'fuel.usableL']);
  });
});
