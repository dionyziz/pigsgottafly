// Sectors of a flight with intermediate full stops (src/calc/sectors.ts): times, fuel through the
// sectors and the W&B of each one. Expected values by hand (no winds), on the geometry of
// stops.test.ts: A → P → B → Q → A2, four legs of 46 NM, a 20 min stop at B.
import { expect, test } from 'vitest';

import {
  computeNavlog,
  flightSectors,
  type LegGeometry,
  planFuel,
  sectorBalances,
  stopLegs,
  stopsOf,
  weightAndBalance,
} from '../../../src/calc';
import {
  DEFAULT_CIRCUIT_MIN,
  landingPointIndices,
  navlogTiming,
  removeRequest,
  requestOf,
  requestRemarks,
  requestTiming,
  type RoutePoint,
  setRequest,
  setStopChoice,
  stopPointIndices,
} from '../../../src/shared';
import { fleetSeed } from '../../../tools/build_seed';

const AC = { cruiseTasKt: 92, patternTasKt: 80, burnLph: 30, taxiAllowanceL: 4, card: null };
const pt = (uid: string, kind: RoutePoint['kind'], lat: number): RoutePoint => ({
  uid,
  kind,
  refId: kind === 'aerodrome' ? uid : null,
  name: uid,
  lat,
  lon: 23,
});
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
const STOP = { aerodromeRequests: [{ pointUid: 'B', kind: 'stop' as const, stopMin: 20 }] };

test('a stop splits the flight into two sectors: times and fuel (no refuelling, one allowance per take-off)', () => {
  const t = requestTiming(route, STOP);
  expect(stopPointIndices(route, STOP)).toEqual([2]);
  expect(stopLegs(t.groundAfterLegMin, 4)).toEqual([1]);
  const nav = computeNavlog({ ...base, patternLegs: t.patternLegs, groundAfterLegMin: t.groundAfterLegMin });
  // every leg at pattern TAS: 34.5 min → 17.25 → 18 L
  expect(nav.legs.map((l) => l.fuel)).toEqual([18, 18, 18, 18]);
  const fuel = planFuel({
    tripFuelL: nav.totals.tripFuel,
    taxiAllowanceL: 4,
    burnLph: 30,
    finalReserveMin: 0,
    reserveMin: 60,
    fobL: null,
    usableL: 144,
    tripMin: nav.flightMin,
    stops: 1,
  });
  expect(fuel.fobL).toBe(110);
  const s = flightSectors({
    legs: nav.legs,
    groundAfterLegMin: t.groundAfterLegMin,
    taxiAllowanceL: 4,
    fobL: fuel.fobL,
  });
  expect(s).toHaveLength(2);
  expect(s[0]).toMatchObject({
    fromPoint: 0,
    toPoint: 2,
    firstLeg: 0,
    lastLeg: 1,
    tripFuelL: 36,
    allowanceL: 4,
    fuelTakeoffL: 110,
    fuelLandingL: 70,
  });
  expect(s[1]).toMatchObject({
    fromPoint: 2,
    toPoint: 4,
    firstLeg: 2,
    lastLeg: 3,
    tripFuelL: 36,
    fuelTakeoffL: 70,
    fuelLandingL: 30,
  });
  // take-off 09:15 (555), lands at B after 69 min, off again 20 min later, lands at 713
  expect(s[0].takeoffMin).toBe(555);
  expect(s[0].landingMin).toBeCloseTo(624, 9);
  expect(s[1].takeoffMin).toBeCloseTo(644, 9);
  expect(s[1].landingMin).toBeCloseTo(nav.times.landingMin, 9);
  // the last sector lands with the fuel plan's landing fuel
  expect(s[1].fuelLandingL).toBe(fuel.landingFuelL);
  expect(stopsOf(s)).toEqual([{ pointIndex: 2, kind: 'stop', before: s[0], after: s[1] }]);
});

test('no stop: one sector equal to the plain take-off / landing', () => {
  const tg = requestTiming(route, { aerodromeRequests: [{ pointUid: 'B', kind: 'touch-and-go' }] });
  const nav = computeNavlog({ ...base, patternLegs: tg.patternLegs, groundAfterLegMin: tg.groundAfterLegMin });
  const s = flightSectors({ legs: nav.legs, groundAfterLegMin: tg.groundAfterLegMin, taxiAllowanceL: 4, fobL: 100 });
  expect(s).toHaveLength(1);
  expect(s[0]).toMatchObject({ fromPoint: 0, toPoint: 4, tripFuelL: 72, fuelTakeoffL: 100, fuelLandingL: 24 });
  expect(stopsOf(s)).toEqual([]);
  expect(flightSectors({ legs: [], taxiAllowanceL: 4, fobL: 100 })).toEqual([]);
});

test('a touch-and-go at an intermediate aerodrome ends a sector without a new allowance (no stop, no taxi)', () => {
  const TG = { aerodromeRequests: [{ pointUid: 'B', kind: 'touch-and-go' as const }] };
  const tg = requestTiming(route, TG);
  expect(tg.touchAfterLeg).toEqual([false, true, false, false]);
  expect(landingPointIndices(route, TG)).toEqual([2]);
  expect(stopPointIndices(route, TG)).toEqual([]);
  const nav = computeNavlog({ ...base, patternLegs: tg.patternLegs, groundAfterLegMin: tg.groundAfterLegMin });
  const s = flightSectors({
    legs: nav.legs,
    groundAfterLegMin: tg.groundAfterLegMin,
    touchAfterLeg: tg.touchAfterLeg,
    taxiAllowanceL: 4,
    fobL: 100,
  });
  expect(s).toHaveLength(2);
  expect(s[0]).toMatchObject({ toPoint: 2, allowanceL: 4, fuelTakeoffL: 100, fuelLandingL: 60, ends: 'touch-and-go' });
  // the touch-and-go take-off at the landing time, with the fuel left; the flight lands as without it
  expect(s[1]).toMatchObject({ fromPoint: 2, allowanceL: 0, fuelTakeoffL: 60, fuelLandingL: 24, ends: 'destination' });
  expect(s[1].takeoffMin).toBeCloseTo(s[0].landingMin, 9);
  expect(stopsOf(s)).toEqual([{ pointIndex: 2, kind: 'touch-and-go', before: s[0], after: s[1] }]);
  // touch-and-go at the departure or the destination: no extra sector
  const ends = {
    aerodromeRequests: [
      { pointUid: 'A', kind: 'touch-and-go' as const },
      { pointUid: 'A2', kind: 'touch-and-go' as const },
    ],
  };
  expect(landingPointIndices(route, ends)).toEqual([]);
});

test('not enough fuel for the first sector: the next one starts with empty tanks, not negative fuel', () => {
  const t = requestTiming(route, STOP);
  const nav = computeNavlog({ ...base, patternLegs: t.patternLegs, groundAfterLegMin: t.groundAfterLegMin });
  const s = flightSectors({ legs: nav.legs, groundAfterLegMin: t.groundAfterLegMin, taxiAllowanceL: 4, fobL: 30 });
  expect(s[0].fuelLandingL).toBe(-10);
  expect(s[1].fuelTakeoffL).toBe(0);
});

test('W&B per sector: the stop point is the zero-fuel point plus the fuel left there; the ends match the plain W&B', () => {
  const [asv] = fleetSeed();
  const mb = asv.massBalance;
  const loads = [
    { stationId: 'front', seatId: 'front-left', label: 'PIC', massKg: 80 },
    { stationId: 'rear', seatId: 'rear-left', label: 'PAX', massKg: 70 },
  ];
  const wbBase = {
    massBalance: mb,
    loads,
    fuelDensityKgPerL: 0.72,
    unusableFuelL: asv.fuel.unusableL,
    unusableIncludedInEmptyMass: asv.fuel.unusableIncludedInEmptyMass,
    category: 'normal' as const,
  };
  const t = requestTiming(route, STOP);
  const nav = computeNavlog({ ...base, patternLegs: t.patternLegs, groundAfterLegMin: t.groundAfterLegMin });
  const s = flightSectors({ legs: nav.legs, groundAfterLegMin: t.groundAfterLegMin, taxiAllowanceL: 4, fobL: 110 });
  const [w0, w1] = sectorBalances(wbBase, s);
  const whole = weightAndBalance({ ...wbBase, fuelTakeoffL: 110, fuelLandingL: 30 });
  expect(w0.takeoff).toEqual(whole.takeoff);
  expect(w1.landing).toEqual(whole.landing);
  // at the stop: 70 L at 0.72 kg/L on the fuel arm, landing and take-off alike
  const fuelArm = mb.stations.find((x) => x.kind === 'fuel')!.armM;
  expect(w0.landing.massKg).toBeCloseTo(whole.zeroFuel.massKg + 70 * 0.72, 9);
  expect(w0.landing.momentKgM).toBeCloseTo(whole.zeroFuel.momentKgM + 70 * 0.72 * fuelArm, 9);
  expect(w1.takeoff).toEqual(w0.landing);
});

test('a stop keeps its runway and surface choices when its minutes change; removing it drops them', () => {
  let list = setRequest([], 'B', 'stop', 10);
  list = setStopChoice(list, 'B', 'stop', 'landingRunway', '35');
  list = setStopChoice(list, 'B', 'stop', 'surface', 'short dry grass');
  list = setRequest(list, 'B', 'stop', 25);
  expect(list).toEqual([{ pointUid: 'B', kind: 'stop', stopMin: 25, landingRunway: '35', surface: 'short dry grass' }]);
  list = setStopChoice(list, 'B', 'stop', 'landingRunway', null);
  expect(list).toEqual([{ pointUid: 'B', kind: 'stop', stopMin: 25, surface: 'short dry grass' }]);
  // a touch-and-go at the same point is added beside the stop, with its own choices
  let both = setRequest(list, 'B', 'touch-and-go');
  both = setStopChoice(both, 'B', 'touch-and-go', 'takeoffRunway', '17');
  expect(both).toEqual([
    { pointUid: 'B', kind: 'stop', stopMin: 25, surface: 'short dry grass' },
    { pointUid: 'B', kind: 'touch-and-go', takeoffRunway: '17' },
  ]);
  expect(requestOf(both, 'B', 'stop')?.surface).toBe('short dry grass');
  expect(requestOf(both, 'B', 'touch-and-go')?.takeoffRunway).toBe('17');
  expect(removeRequest(both, 'B', 'stop')).toEqual([{ pointUid: 'B', kind: 'touch-and-go', takeoffRunway: '17' }]);
  expect(removeRequest(both, 'B')).toEqual([]);
});

test('a touch-and-go then a stop at B: the circuit between them, then the ground time; three sectors', () => {
  const BOTH = {
    aerodromeRequests: [
      { pointUid: 'B', kind: 'stop' as const, stopMin: 20 },
      { pointUid: 'B', kind: 'touch-and-go' as const },
    ],
  };
  const t = requestTiming(route, BOTH);
  expect(t.touchAfterLeg).toEqual([false, true, false, false]);
  expect(t.groundAfterLegMin).toEqual([0, 20, 0, 0]);
  expect(t.circuitAfterLegMin).toEqual([0, DEFAULT_CIRCUIT_MIN, 0, 0]);
  expect(stopPointIndices(route, BOTH)).toEqual([2]);
  expect(landingPointIndices(route, BOTH)).toEqual([2]);
  const nav = computeNavlog({
    ...base,
    patternLegs: t.patternLegs,
    groundAfterLegMin: t.groundAfterLegMin,
    circuitAfterLegMin: t.circuitAfterLegMin,
  });
  // 6 min at 30 L/h = 3 L, on top of the legs' 4 × 18 L
  const circuitL = Math.ceil((30 * DEFAULT_CIRCUIT_MIN) / 60);
  expect(nav.circuits).toEqual([
    {
      afterLeg: 1,
      ends: 'stop',
      startMin: nav.legs[1].endMin,
      endMin: nav.legs[1].endMin + DEFAULT_CIRCUIT_MIN,
      fuel: circuitL,
    },
  ]);
  expect(nav.totals.tripFuel).toBe(72 + circuitL);
  expect(nav.legs[2].startMin).toBeCloseTo(nav.legs[1].endMin + DEFAULT_CIRCUIT_MIN + 20, 9);
  expect(nav.times.landingMin).toBeCloseTo(555 + 4 * 34.5 + DEFAULT_CIRCUIT_MIN + 20, 9);
  const fuel = planFuel({
    tripFuelL: nav.totals.tripFuel,
    taxiAllowanceL: 4,
    burnLph: 30,
    finalReserveMin: 0,
    reserveMin: 60,
    fobL: 110,
    usableL: 144,
    tripMin: nav.flightMin,
    stops: 1,
  });
  const s = flightSectors({
    legs: nav.legs,
    groundAfterLegMin: t.groundAfterLegMin,
    touchAfterLeg: t.touchAfterLeg,
    circuits: nav.circuits,
    taxiAllowanceL: 4,
    fobL: 110,
  });
  expect(s.map((x) => x.ends)).toEqual(['touch-and-go', 'stop', 'destination']);
  expect(s[0]).toMatchObject({ fromPoint: 0, toPoint: 2, allowanceL: 4, fuelTakeoffL: 110, fuelLandingL: 70 });
  // the circuit: from B to B, no legs, its own fuel, no start-up
  expect(s[1]).toMatchObject({
    fromPoint: 2,
    toPoint: 2,
    firstLeg: 2,
    lastLeg: 1,
    tripFuelL: circuitL,
    allowanceL: 0,
    fuelTakeoffL: 70,
    fuelLandingL: 70 - circuitL,
  });
  expect(s[1].takeoffMin).toBeCloseTo(s[0].landingMin, 9);
  expect(s[1].landingMin).toBeCloseTo(s[0].landingMin + DEFAULT_CIRCUIT_MIN, 9);
  expect(s[2]).toMatchObject({ fromPoint: 2, toPoint: 4, allowanceL: 4, fuelTakeoffL: 70 - circuitL });
  expect(s[2].takeoffMin).toBeCloseTo(s[1].landingMin + 20, 9);
  expect(s[2].fuelLandingL).toBe(fuel.landingFuelL);
  expect(stopsOf(s).map((x) => [x.pointIndex, x.kind])).toEqual([
    [2, 'touch-and-go'],
    [2, 'stop'],
  ]);
});

test("the API keeps a stop's runway and surface choices and validates them", async () => {
  const { checkOptions } = await import('../../../api/_lib/flightDoc');
  const o = checkOptions({
    aerodromeRequests: [
      {
        pointUid: 'B',
        kind: 'stop',
        stopMin: 10,
        landingRunway: '35',
        takeoffRunway: '',
        surface: 'short dry grass',
        junk: 1,
      },
    ],
  });
  expect(o.aerodromeRequests).toEqual([
    { pointUid: 'B', kind: 'stop', stopMin: 10, landingRunway: '35', surface: 'short dry grass' },
  ]);
  expect(() =>
    checkOptions({ aerodromeRequests: [{ pointUid: 'B', kind: 'stop', landingRunway: 'X'.repeat(11) }] }),
  ).toThrow(/landingRunway/);
  // a touch-and-go keeps its runway choice too (its landing and take-off performance)
  expect(
    checkOptions({ aerodromeRequests: [{ pointUid: 'B', kind: 'touch-and-go', landingRunway: '35' }] })
      .aerodromeRequests,
  ).toEqual([{ pointUid: 'B', kind: 'touch-and-go', landingRunway: '35' }]);
  // a touch-and-go and a stop on one point
  expect(
    checkOptions({
      aerodromeRequests: [
        { pointUid: 'B', kind: 'touch-and-go' },
        { pointUid: 'B', kind: 'stop', stopMin: 15 },
      ],
    }).aerodromeRequests,
  ).toEqual([
    { pointUid: 'B', kind: 'touch-and-go' },
    { pointUid: 'B', kind: 'stop', stopMin: 15 },
  ]);
});

// A → P → B → Q → A2 without requests at B: legs 0 and 3 at pattern TAS (34.5 min, 18 L), legs 1
// and 2 at cruise (30 min, 15 L): 66 L; take-off at 09:15 = 555.
const legsL = 18 + 15 + 15 + 18;
const routeMin = 2 * 34.5 + 2 * 30;
const circuitL = Math.ceil((30 * DEFAULT_CIRCUIT_MIN) / 60);
const fly = (opts: Parameters<typeof requestTiming>[1]) => {
  const t = requestTiming(route, opts);
  const nav = computeNavlog({ ...base, ...navlogTiming(t) });
  const s = flightSectors({
    legs: nav.legs,
    groundAfterLegMin: t.groundAfterLegMin,
    touchAfterLeg: t.touchAfterLeg,
    circuits: nav.circuits,
    taxiAllowanceL: 4,
    fobL: 100,
  });
  const fuel = planFuel({
    tripFuelL: nav.totals.tripFuel,
    taxiAllowanceL: 4,
    burnLph: 30,
    finalReserveMin: 0,
    reserveMin: 60,
    fobL: 100,
    usableL: 144,
    tripMin: nav.flightMin,
    stops: t.stops,
  });
  return { t, nav, s, fuel };
};

test('a stop at the departure: a circuit, the full stop, the ground time, then the route; two sectors', () => {
  const DEP = { aerodromeRequests: [{ pointUid: 'A', kind: 'stop' as const, stopMin: 10 }] };
  const { t, nav, s, fuel } = fly(DEP);
  expect(t).toMatchObject({
    departureCircuitsMin: [DEFAULT_CIRCUIT_MIN],
    departureGroundMin: 10,
    finalCircuitMin: 0,
    stops: 1,
  });
  expect(t.groundAfterLegMin).toEqual([0, 0, 0, 0]);
  expect(t.patternLegs).toEqual([false, false, false, false]);
  expect(nav.times.takeoffMin).toBe(555);
  expect(nav.circuits).toEqual([
    { afterLeg: -1, ends: 'stop', startMin: 555, endMin: 555 + DEFAULT_CIRCUIT_MIN, fuel: circuitL },
  ]);
  expect(nav.legs[0].startMin).toBeCloseTo(555 + DEFAULT_CIRCUIT_MIN + 10, 9);
  expect(nav.times.landingMin).toBeCloseTo(555 + DEFAULT_CIRCUIT_MIN + 10 + routeMin, 9);
  // the circuit's fuel and one more taxi allowance (a second take-off)
  expect(nav.totals.tripFuel).toBe(legsL + circuitL);
  expect(nav.totals.fuel).toBe(legsL + circuitL + 2 * 4);
  expect(s.map((x) => x.ends)).toEqual(['stop', 'destination']);
  expect(s[0]).toMatchObject({
    fromPoint: 0,
    toPoint: 0,
    firstLeg: 0,
    lastLeg: -1,
    takeoffMin: 555,
    landingMin: 555 + DEFAULT_CIRCUIT_MIN,
    tripFuelL: circuitL,
    allowanceL: 4,
    fuelTakeoffL: 100,
    fuelLandingL: 100 - 4 - circuitL,
  });
  expect(s[1]).toMatchObject({ fromPoint: 0, toPoint: 4, firstLeg: 0, lastLeg: 3, allowanceL: 4, tripFuelL: legsL });
  expect(s[1].takeoffMin).toBeCloseTo(555 + DEFAULT_CIRCUIT_MIN + 10, 9);
  expect(s[1].fuelLandingL).toBe(fuel.landingFuelL);
  expect(stopsOf(s).map((x) => [x.pointIndex, x.kind])).toEqual([[0, 'stop']]);
  expect(requestRemarks(route, DEP, () => null)).toEqual(['INITIALLY REQUEST FULL STOP AT A FOR 10 MIN']);
});

test('touch-and-go first and a stop at the departure: two circuits (touch-and-go, then full stop)', () => {
  const DEP = {
    aerodromeRequests: [
      { pointUid: 'A', kind: 'touch-and-go' as const },
      { pointUid: 'A', kind: 'stop' as const, stopMin: 10 },
    ],
  };
  const { t, nav, s, fuel } = fly(DEP);
  expect(t.departureCircuitsMin).toEqual([DEFAULT_CIRCUIT_MIN, DEFAULT_CIRCUIT_MIN]);
  expect(nav.circuits.map((c) => [c.afterLeg, c.ends, c.startMin, c.endMin])).toEqual([
    [-1, 'touch-and-go', 555, 555 + DEFAULT_CIRCUIT_MIN],
    [-1, 'stop', 555 + DEFAULT_CIRCUIT_MIN, 555 + 2 * DEFAULT_CIRCUIT_MIN],
  ]);
  expect(nav.legs[0].startMin).toBeCloseTo(555 + 2 * DEFAULT_CIRCUIT_MIN + 10, 9);
  expect(nav.totals.tripFuel).toBe(legsL + 2 * circuitL);
  expect(s.map((x) => [x.ends, x.allowanceL])).toEqual([
    ['touch-and-go', 4],
    ['stop', 0],
    ['destination', 4],
  ]);
  expect(s[2].fuelLandingL).toBe(fuel.landingFuelL);
  expect(stopsOf(s).map((x) => [x.pointIndex, x.kind])).toEqual([
    [0, 'touch-and-go'],
    [0, 'stop'],
  ]);
  expect(requestRemarks(route, DEP, () => null)).toEqual([
    'INITIALLY REQUEST TOUCH N GO AT A',
    'INITIALLY REQUEST FULL STOP AT A FOR 10 MIN',
  ]);
});

test('a stop at the destination: the landing, the ground time, a new take-off, a circuit and the final landing', () => {
  const DEST = { aerodromeRequests: [{ pointUid: 'A2', kind: 'stop' as const, stopMin: 10 }] };
  const { t, nav, s, fuel } = fly(DEST);
  expect(t).toMatchObject({
    departureCircuitsMin: [],
    departureGroundMin: 0,
    finalCircuitMin: DEFAULT_CIRCUIT_MIN,
    stops: 1,
  });
  expect(t.groundAfterLegMin).toEqual([0, 0, 0, 10]);
  // the weather's landing points are intermediate only (the destination has its own)
  expect(landingPointIndices(route, DEST)).toEqual([]);
  const arrive = 555 + routeMin;
  expect(nav.legs[3].endMin).toBeCloseTo(arrive, 9);
  expect(nav.circuits).toHaveLength(1);
  expect(nav.circuits[0]).toMatchObject({ afterLeg: 3, ends: 'destination', fuel: circuitL });
  expect(nav.circuits[0].startMin).toBeCloseTo(arrive + 10, 9);
  expect(nav.times.landingMin).toBeCloseTo(arrive + 10 + DEFAULT_CIRCUIT_MIN, 9);
  expect(nav.times.blockOnMin).toBeCloseTo(arrive + 10 + DEFAULT_CIRCUIT_MIN + 15, 9);
  expect(nav.totals.fuel).toBe(legsL + circuitL + 2 * 4);
  expect(s.map((x) => x.ends)).toEqual(['stop', 'destination']);
  expect(s[0]).toMatchObject({ fromPoint: 0, toPoint: 4, allowanceL: 4, fuelLandingL: 100 - 4 - legsL });
  expect(s[1]).toMatchObject({ fromPoint: 4, toPoint: 4, firstLeg: 4, lastLeg: 3, allowanceL: 4, tripFuelL: circuitL });
  expect(s[1].fuelLandingL).toBe(fuel.landingFuelL);
  expect(stopsOf(s).map((x) => [x.pointIndex, x.kind])).toEqual([[4, 'stop']]);
  expect(requestRemarks(route, DEST, () => null)).toEqual(['REQUEST FULL STOP AT A2 FOR 10 MIN THEN CIRCUIT']);
});

test('a touch-and-go and a stop at the destination: touch-and-go, circuit, full stop, circuit, landing', () => {
  const DEST = {
    aerodromeRequests: [
      { pointUid: 'A2', kind: 'stop' as const, stopMin: 10 },
      { pointUid: 'A2', kind: 'touch-and-go' as const },
    ],
  };
  const { t, nav, s, fuel } = fly(DEST);
  expect(t.touchAfterLeg).toEqual([false, false, false, true]);
  expect(t.circuitAfterLegMin).toEqual([0, 0, 0, DEFAULT_CIRCUIT_MIN]);
  const arrive = 555 + routeMin;
  expect(nav.circuits.map((c) => [c.afterLeg, c.ends])).toEqual([
    [3, 'stop'],
    [3, 'destination'],
  ]);
  expect(nav.circuits[1].startMin).toBeCloseTo(arrive + DEFAULT_CIRCUIT_MIN + 10, 9);
  expect(nav.times.landingMin).toBeCloseTo(arrive + 2 * DEFAULT_CIRCUIT_MIN + 10, 9);
  expect(s.map((x) => [x.ends, x.allowanceL])).toEqual([
    ['touch-and-go', 4],
    ['stop', 0],
    ['destination', 4],
  ]);
  expect(s[2].fuelLandingL).toBe(fuel.landingFuelL);
  expect(stopsOf(s).map((x) => [x.pointIndex, x.kind])).toEqual([
    [4, 'touch-and-go'],
    [4, 'stop'],
  ]);
  expect(requestRemarks(route, DEST, () => null)).toEqual([
    'REQUEST TOUCH N GO AT A2',
    'REQUEST FULL STOP AT A2 FOR 10 MIN THEN CIRCUIT',
  ]);
  // a touch-and-go alone at either end adds no time
  const tg = fly({
    aerodromeRequests: [
      { pointUid: 'A', kind: 'touch-and-go' as const },
      { pointUid: 'A2', kind: 'touch-and-go' as const },
    ],
  });
  expect(tg.nav.circuits).toEqual([]);
  expect(tg.nav.times.landingMin).toBeCloseTo(arrive, 9);
  expect(tg.t.stops).toBe(0);
  expect(tg.s).toHaveLength(1);
});
