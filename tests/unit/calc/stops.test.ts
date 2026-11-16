// Touch-and-go / intermediate-stop requests in the calculations: pattern TAS on the legs into and
// out of the aerodrome, ground time on the timeline, one more start-up/taxi/take-off allowance per
// full stop in the navlog total and the fuel plan. Expected values by hand (no winds).
import { expect, test } from 'vitest';

import { computeNavlog, type LegGeometry, planFuel } from '../../../src/calc';
import type { RoutePoint } from '../../../src/shared';
import { requestTiming } from '../../../src/shared/requests';

const AC = { cruiseTasKt: 92, patternTasKt: 80, burnLph: 30, taxiAllowanceL: 4, card: null };
const pt = (uid: string, kind: RoutePoint['kind'], lat: number): RoutePoint => ({
  uid,
  kind,
  refId: kind === 'aerodrome' ? uid : null,
  name: uid,
  lat,
  lon: 23,
});
// A (aerodrome) → P (VFR) → B (aerodrome) → Q (VFR) → A: 4 northbound/southbound legs of 46 NM each
// (TC 000/180 so wind-free GS = TAS), lengths chosen so the minutes are whole: 46 NM at 92 kt = 30 min,
// at 80 kt = 34.5 min.
const route = [
  pt('A', 'aerodrome', 37),
  pt('P', 'vfr', 37 + 46 / 60),
  pt('B', 'aerodrome', 37 + 92 / 60),
  pt('Q', 'vfr', 37 + 46 / 60),
  pt('A2', 'aerodrome', 37),
];
const legs: LegGeometry[] = route.slice(1).map((to, i) => {
  const from = route[i];
  const north = to.lat > from.lat;
  return {
    index: i,
    key: `${from.uid}>${to.uid}`,
    from,
    to,
    mid: { lat: (from.lat + to.lat) / 2, lon: 23 },
    tcTrue: north ? 0 : 180,
    tcInitial: north ? 0 : 180,
    distNm: 46,
    variation: 0,
    mcMag: north ? 0 : 180,
  };
});
const base = {
  date: '2026-11-20',
  blockOff: '09:00',
  taxiOutMin: 15,
  taxiInMin: 15,
  legs,
  altitudesFt: [2500, 2500, 2500, 2500],
  overrides: [],
  aircraft: AC,
  winds: null,
};

test('no request: B is flown over at cruise TAS, one allowance', () => {
  const r = computeNavlog(base);
  expect(r.legs.map((l) => l.tasKt)).toEqual([80, 92, 92, 80]);
  expect(r.times.takeoffMin).toBe(555);
  expect(r.times.landingMin).toBeCloseTo(555 + 34.5 + 30 + 30 + 34.5, 9);
  expect(r.totals.fuel).toBe(r.totals.tripFuel + 4);
});

test('touch-and-go at B: pattern TAS into and out of B, no ground time, no extra allowance', () => {
  const t = requestTiming(route, { aerodromeRequests: [{ pointUid: 'B', kind: 'touch-and-go' }] });
  expect(t.patternLegs).toEqual([false, true, true, false]);
  expect(t.groundAfterLegMin).toEqual([0, 0, 0, 0]);
  const r = computeNavlog({ ...base, patternLegs: t.patternLegs, groundAfterLegMin: t.groundAfterLegMin });
  expect(r.legs.map((l) => l.tasKt)).toEqual([80, 80, 80, 80]);
  expect(r.times.landingMin).toBeCloseTo(555 + 4 * 34.5, 9);
  // 34.5 min at 30 L/h = 17.25 → 18 L per leg
  expect(r.totals.tripFuel).toBe(72);
  expect(r.totals.fuel).toBe(76);
});

test('stop of 20 min at B: ground time on the timeline, a second allowance in the totals and the fuel plan', () => {
  const t = requestTiming(route, { aerodromeRequests: [{ pointUid: 'B', kind: 'stop', stopMin: 20 }] });
  expect(t.groundAfterLegMin).toEqual([0, 20, 0, 0]);
  const r = computeNavlog({ ...base, patternLegs: t.patternLegs, groundAfterLegMin: t.groundAfterLegMin });
  expect(r.legs[1].endMin).toBeCloseTo(555 + 69, 9); // lands at B
  expect(r.legs[2].startMin).toBeCloseTo(555 + 69 + 20, 9); // takes off again 20 min later
  expect(r.times.landingMin).toBeCloseTo(555 + 4 * 34.5 + 20, 9);
  expect(r.flightMin).toBeCloseTo(4 * 34.5 + 20, 9);
  expect(r.totals.fuel).toBe(72 + 2 * 4);
  const f = planFuel({
    tripFuelL: r.totals.tripFuel,
    taxiAllowanceL: 4,
    burnLph: 30,
    finalReserveMin: 0,
    reserveMin: 60,
    fobL: null,
    usableL: 144,
    tripMin: r.flightMin,
    stops: 1,
  });
  expect(f.taxiL).toBe(8);
  expect(f.requiredL).toBe(80);
  expect(f.defaultFobL).toBe(110);
  expect(f.landingFuelL).toBe(30);
  // without the stop the allowance is counted once
  expect(
    planFuel({
      tripFuelL: 72,
      taxiAllowanceL: 4,
      burnLph: 30,
      finalReserveMin: 0,
      reserveMin: 60,
      fobL: null,
      usableL: 144,
      tripMin: 138,
    }).taxiL,
  ).toBe(4);
});
