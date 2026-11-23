// The areas a flight's legs enter (src/calc/areas.ts): lateral, vertical and time.
import { describe, expect, test } from 'vitest';

import { type AreaLeg, areaLimitFt, legAreaConflicts } from '../../../src/calc';
import type { RefArea } from '../../../src/shared/ref';

const T = (s: string) => Date.parse(s);

const area = (o: Partial<RefArea>): RefArea => ({
  id: 'X',
  kind: 'D',
  name: '',
  lower: 'SFC',
  upper: 'FL 100',
  lateral: '',
  // a square 37.9–38.1 N, 23.9–24.1 E
  polygon: [
    [37.9, 23.9],
    [38.1, 23.9],
    [38.1, 24.1],
    [37.9, 24.1],
    [37.9, 23.9],
  ],
  activity: '',
  remarks: '',
  source: 'AIP SUP 39/26',
  ...o,
});

/** West to east through the square at 38 N, flown 11:00–11:30Z on 23 NOV 2026 at 3000 ft. */
const leg = (o: Partial<AreaLeg> = {}): AreaLeg => ({
  from: { lat: 38, lon: 23.5 },
  to: { lat: 38, lon: 24.5 },
  altFt: 3000,
  startMs: T('2026-11-23T11:00Z'),
  endMs: T('2026-11-23T11:30Z'),
  ...o,
});

const ids = (legs: AreaLeg[], areas: RefArea[]) => legAreaConflicts(legs, areas).map((c) => c.area.id);

describe('limits', () => {
  test('as printed', () => {
    expect(areaLimitFt('GND/MSL')).toBe(0);
    expect(areaLimitFt('MSL')).toBe(0);
    expect(areaLimitFt('SFC')).toBe(0);
    expect(areaLimitFt('FL 295')).toBe(29500);
    expect(areaLimitFt('3000 FT ALT')).toBe(3000);
    expect(areaLimitFt('10000 FT AMSL')).toBe(10000);
    expect(areaLimitFt('UNL')).toBe(Infinity);
    expect(areaLimitFt('?')).toBeNaN();
  });
});

describe('legAreaConflicts', () => {
  test('a leg crossing, starting in or passing by the area', () => {
    expect(ids([leg()], [area({})])).toEqual(['X']);
    expect(ids([leg({ from: { lat: 38, lon: 24 } })], [area({})])).toEqual(['X']);
    expect(ids([leg({ from: { lat: 38.3, lon: 23.5 }, to: { lat: 38.3, lon: 24.5 } })], [area({})])).toEqual([]);
  });
  test('a circle: within its radius of the leg', () => {
    const c = area({ polygon: undefined, circle: { lat: 38.05, lon: 24, radiusNm: 4 } });
    expect(ids([leg()], [c])).toEqual(['X']);
    expect(ids([leg()], [{ ...c, circle: { lat: 38.1, lon: 24, radiusNm: 4 } }])).toEqual([]);
  });
  test('at the planned altitude only, limits included; unknown altitude counts', () => {
    expect(ids([leg({ altFt: 3000 })], [area({ lower: 'FL 295', upper: 'UNL' })])).toEqual([]);
    expect(ids([leg({ altFt: 10000 })], [area({})])).toEqual(['X']);
    expect(ids([leg({ altFt: 10500 })], [area({})])).toEqual([]);
    expect(ids([leg({ altFt: 4500 })], [area({ lower: 'FL 150', upper: 'FL 660' })])).toEqual([]);
    expect(ids([leg({ altFt: null })], [area({ lower: 'FL 295', upper: 'UNL' })])).toEqual(['X']);
  });
  test('flight-plan buffer zones are not airspace for a VFR flight', () => {
    expect(
      ids(
        [leg()],
        [area({ remarks: 'Flight planning buffer zone (FBZ) of X.\nFor IFR flight planning purposes only.' })],
      ),
    ).toEqual([]);
  });
  test('a time-limited area only while the leg is flown in one of its windows', () => {
    const jfc = area({
      validFrom: '2026-10-15',
      validUntil: '2026-11-27',
      windows: [
        { from: '2026-11-23T11:30Z', to: '2026-11-23T13:30Z' },
        { from: '2026-11-24T08:30Z', to: '2026-11-24T10:30Z' },
      ],
    });
    // 11:00–11:30 reaches the 11:30 window; 10:00–11:00 is before it; 13:30– after it
    expect(legAreaConflicts([leg()], [jfc])[0].windows).toEqual([jfc.windows![0]]);
    expect(ids([leg({ startMs: T('2026-11-23T10:00Z'), endMs: T('2026-11-23T11:00Z') })], [jfc])).toEqual([]);
    expect(ids([leg({ startMs: T('2026-11-23T13:30Z'), endMs: T('2026-11-23T14:00Z') })], [jfc])).toEqual([]);
    // the whole flight day (no block times): active
    expect(ids([leg({ startMs: T('2026-11-24T00:00Z'), endMs: T('2026-11-25T00:00Z') - 1 })], [jfc])).toEqual(['X']);
    // after the SUP's last day the area is gone, whatever the windows
    expect(
      ids([leg({ startMs: T('2026-11-28T11:00Z'), endMs: T('2026-11-28T12:00Z') })], [{ ...jfc, windows: undefined }]),
    ).toEqual([]);
  });
  test('an area without windows: whenever in force', () => {
    const d102 = area({ validFrom: '2026-06-11', validUntil: '2027-06-09', lower: 'SFC' });
    expect(legAreaConflicts([leg()], [d102])).toEqual([{ legIndex: 0, area: d102, windows: [] }]);
    const late = leg({ startMs: T('2027-06-10T09:00Z'), endMs: T('2027-06-10T10:00Z') });
    expect(ids([late], [d102])).toEqual([]);
  });
  test('per leg, in leg order', () => {
    const away = leg({ from: { lat: 39, lon: 23.5 }, to: { lat: 39, lon: 24.5 } });
    const c = legAreaConflicts([away, leg(), leg()], [area({ id: 'A' }), area({ id: 'B', upper: '2000 FT ALT' })]);
    expect(c.map((x) => `${x.legIndex}:${x.area.id}`)).toEqual(['1:A', '2:A']);
  });
});
