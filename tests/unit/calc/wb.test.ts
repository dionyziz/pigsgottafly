// Weight and balance: hand-computed loading sheets for the seeded SX-ASV / SX-ASG, envelope checks,
// station/combined/seat limits and the utility category rules.
import { describe, expect, test } from 'vitest';

import {
  insidePolygon,
  performanceMass,
  type WbInput,
  wbLoadsFromManifest,
  wbStatus,
  weightAndBalance,
} from '../../../src/calc';
import { fleetSeed } from '../../../tools/build_seed';

const [ASV, ASG] = fleetSeed();

function input(a = ASV, over: Partial<WbInput> = {}): WbInput {
  return {
    massBalance: a.massBalance,
    loads: [],
    fuelTakeoffL: 100,
    fuelLandingL: 70,
    fuelDensityKgPerL: 0.72,
    unusableFuelL: a.fuel.unusableL,
    unusableIncludedInEmptyMass: a.fuel.unusableIncludedInEmptyMass,
    category: 'normal',
    ...over,
  };
}

describe('loading sheet', () => {
  test('SX-ASV: PIC front-left, PAX rear-right, baggage; take-off and landing points', () => {
    const r = weightAndBalance(
      input(ASV, {
        loads: [
          { stationId: 'front', seatId: 'front-left', label: 'PIC', massKg: 80 },
          { stationId: '', seatId: 'rear-right', label: 'PAX', massKg: 70 },
          { stationId: 'bag1', label: 'Baggage 1', massKg: 10 },
        ],
      }),
    );
    // empty 691.2 / 719.12; 80 × 0.94 = 75.2; 70 × 1.85 = 129.5; 10 × 2.41 = 24.1; fuel 72 × 1.215 = 87.48
    const zfMass = 691.2 + 80 + 70 + 10;
    const zfMom = 719.12 + 75.2 + 129.5 + 24.1;
    expect(r.zeroFuel.massKg).toBeCloseTo(zfMass, 9);
    expect(r.zeroFuel.momentKgM).toBeCloseTo(zfMom, 9);
    expect(r.takeoff.massKg).toBeCloseTo(zfMass + 72, 9);
    expect(r.takeoff.momentKgM).toBeCloseTo(zfMom + 87.48, 9);
    expect(r.takeoff.armM).toBeCloseTo((zfMom + 87.48) / (zfMass + 72), 12);
    expect(r.landing.massKg).toBeCloseTo(zfMass + 50.4, 9);
    expect(r.landing.momentKgM).toBeCloseTo(zfMom + 50.4 * 1.215, 9);
    expect(r.rows.map((x) => x.label)).toEqual(['Empty aircraft', 'PIC', 'PAX', 'Baggage 1', 'Usable fuel (100 L)']);
    expect(r.rows[2].stationId).toBe('rear');
    // MD 4.3 table: every station, in order.
    expect(r.stationRows!.map((x) => [x.stationId, x.massKg])).toEqual([
      [null, 691.2],
      ['front', 80],
      ['rear', 70],
      ['bag1', 10],
      ['bag2', 0],
      ['fuel', 72],
    ]);
    expect(r.normal.takeoff).toMatchObject({
      inEnvelope: true,
      massOk: true,
      inCgPolygon: true,
      inMomentPolygon: true,
    });
    expect(r.normal.landing.inEnvelope).toBe(true);
    expect(r.utility).not.toBeNull();
    expect(r.utility!.takeoff.massOk).toBe(false); // 923.2 > 907
    expect(r.warnings).toEqual([]);
  });

  test('SX-ASG: unusable fuel added (weighed with empty tanks)', () => {
    const r = weightAndBalance(
      input(ASG, {
        loads: [{ stationId: 'front', seatId: 'front-left', label: 'PIC', massKg: 80 }],
        fuelDensityKgPerL: 0.75,
      }),
    );
    const unusable = r.rows.find((x) => x.label.startsWith('Unusable'))!;
    expect(unusable.massKg).toBeCloseTo(15 * 0.75, 9);
    expect(unusable.momentKgM).toBeCloseTo(15 * 0.75 * 1.215, 9);
    expect(r.zeroFuel.massKg).toBeCloseTo(692 + 11.25 + 80, 9);
    expect(r.utility).toBeNull();
  });

  test('empty moment from the weighing report, not mass × rounded arm', () => {
    const r = weightAndBalance(input(ASV, { fuelTakeoffL: 0, fuelLandingL: 0 }));
    expect(r.rows[0].momentKgM).toBe(719.12);
  });
});

describe('limits and warnings', () => {
  test('MTOW, aft CG, station and combined baggage limits', () => {
    const r = weightAndBalance(
      input(ASV, {
        loads: [
          { stationId: 'front', label: 'Front', massKg: 160 },
          { stationId: 'rear', label: 'Rear', massKg: 160 },
          { stationId: 'bag1', label: 'Bag 1', massKg: 40 },
          { stationId: 'bag2', label: 'Bag 2', massKg: 25 },
        ],
        fuelTakeoffL: 144,
        fuelLandingL: 100,
      }),
    );
    const w = r.warnings.join('\n');
    expect(w).toMatch(/Baggage area 2: 25 kg exceeds the 23 kg limit/);
    expect(w).toMatch(/combined 54 kg limit/);
    expect(w).toMatch(/exceeds MTOW 1043 kg/);
    expect(r.normal.takeoff.massOk).toBe(false);
    expect(r.normal.takeoff.inEnvelope).toBe(false);
  });

  test('aft CG inside the mass limit is outside the envelope', () => {
    const r = weightAndBalance(
      input(ASV, {
        loads: [
          { stationId: 'bag1', label: 'Bag 1', massKg: 54 },
          { stationId: 'rear', label: 'Rear', massKg: 170 },
        ],
        fuelTakeoffL: 20,
        fuelLandingL: 10,
      }),
    );
    // 691.2 + 54 + 170 + 14.4 = 929.6 kg; moment 719.12 + 130.14 + 314.5 + 17.496 = 1181.256 → 1.2707 m > 1.20
    expect(r.takeoff.armM).toBeGreaterThan(1.2);
    expect(r.normal.takeoff).toMatchObject({ massOk: true, inEnvelope: false, inCgPolygon: false });
    expect(r.warnings.join(' ')).toMatch(/Take-off CG is outside the normal envelope/);
  });

  test('seats: unknown seat, two people in one seat, more people than seats', () => {
    const r = weightAndBalance(
      input(ASV, {
        loads: [
          { stationId: '', seatId: 'front-left', label: 'A', massKg: 70 },
          { stationId: '', seatId: 'front-left', label: 'B', massKg: 70 },
          { stationId: 'front', label: 'C', massKg: 70 },
          { stationId: '', seatId: 'cockpit-jumpseat', label: 'D', massKg: 70 },
        ],
      }),
    );
    const w = r.warnings.join('\n');
    expect(w).toMatch(/2 people in seat front-left/);
    expect(w).toMatch(/PIC and front passenger: 3 people for 2 seats/);
    expect(w).toMatch(/Seat cockpit-jumpseat does not exist/);
  });

  test('negative landing fuel lands with none and warns', () => {
    const r = weightAndBalance(input(ASV, { fuelTakeoffL: 20, fuelLandingL: -10 }));
    expect(r.landing.massKg).toBeCloseTo(r.zeroFuel.massKg, 9);
    expect(r.warnings.join(' ')).toMatch(/negative/);
  });

  test('utility category: SX-ASV only, no rear passengers, no baggage', () => {
    const ok = weightAndBalance(
      input(ASV, {
        category: 'utility',
        loads: [{ stationId: 'front', label: 'PIC', massKg: 80 }],
        fuelTakeoffL: 100,
        fuelLandingL: 80,
      }),
    );
    // 691.2 + 80 + 72 = 843.2 kg at (719.12 + 75.2 + 87.48) / 843.2 = 1.0458 m: aft of 1.03
    expect(ok.utility!.takeoff.massOk).toBe(true);
    const fwd = weightAndBalance(
      input(ASV, {
        category: 'utility',
        loads: [
          { stationId: 'front', label: 'PIC', massKg: 80, armM: 0.9 },
          { stationId: 'front', label: 'P2', massKg: 80, armM: 0.9 },
        ],
        fuelTakeoffL: 40,
        fuelLandingL: 30,
      }),
    );
    // 691.2 + 160 + 28.8 = 880 kg; (719.12 + 144 + 34.992) / 880 = 1.0206 m: inside utility
    expect(fwd.utility!.takeoff.inEnvelope).toBe(true);
    expect(fwd.warnings).toEqual([]);
    const bad = weightAndBalance(
      input(ASV, {
        category: 'utility',
        loads: [
          { stationId: 'rear', label: 'PAX', massKg: 60 },
          { stationId: 'bag1', label: 'Bag', massKg: 5 },
        ],
      }),
    );
    expect(bad.warnings.join('\n')).toMatch(/no rear passengers/);
    expect(bad.warnings.join('\n')).toMatch(/no baggage/);
    const asg = weightAndBalance(input(ASG, { category: 'utility' }));
    expect(asg.warnings.join(' ')).toMatch(/no utility category/);
  });

  test('limit breaches beyond the envelope fail the status: combined baggage, utility rules, MLW', () => {
    // Review case: PIC 80 kg, bag1 40 kg, bag2 20 kg, 100 L. Each area is within its own maximum
    // (54 / 23 kg) and the point is inside the normal envelope, but 60 kg > the combined 54 kg.
    const comb = weightAndBalance(
      input(ASV, {
        loads: [
          { stationId: '', seatId: 'front-left', label: 'PIC', massKg: 80 },
          { stationId: 'bag1', label: 'Bag 1', massKg: 40 },
          { stationId: 'bag2', label: 'Bag 2', massKg: 20 },
        ],
        fuelTakeoffL: 100,
      }),
    );
    expect(comb.takeoff.massKg).toBeCloseTo(903.2, 9);
    expect(comb.normal.takeoff).toMatchObject({ inEnvelope: true, massOk: true });
    expect(comb.limitBreaches).toEqual([
      { kind: 'combined', text: 'Baggage area 1 + Baggage area 2: 60 kg exceeds the combined 54 kg limit.' },
    ]);
    expect(wbStatus(comb)).toEqual({ takeoff: true, landing: true, loading: false });

    // Utility: inside the utility envelope, but 1 kg of baggage is not allowed.
    const util = weightAndBalance(
      input(ASV, {
        category: 'utility',
        loads: [
          { stationId: 'front', label: 'PIC', massKg: 80, armM: 0.9 },
          { stationId: 'front', label: 'P2', massKg: 80, armM: 0.9 },
          { stationId: 'bag1', label: 'Bag', massKg: 1 },
        ],
        fuelTakeoffL: 40,
        fuelLandingL: 30,
      }),
    );
    expect(util.utility!.takeoff.inEnvelope).toBe(true);
    expect(util.limitBreaches.map((b) => b.kind)).toEqual(['utility']);
    expect(wbStatus(util).loading).toBe(false);

    // MLW below the landing mass: a landing-phase breach only.
    const mlw = weightAndBalance(
      input(ASV, {
        massBalance: { ...ASV.massBalance, mlwKg: 850 },
        loads: [
          { stationId: '', seatId: 'front-left', label: 'PIC', massKg: 80 },
          { stationId: '', seatId: 'front-right', label: 'P2', massKg: 80 },
        ],
        fuelTakeoffL: 100,
        fuelLandingL: 90,
      }),
    );
    expect(mlw.limitBreaches.map((b) => [b.kind, b.phase])).toEqual([['mlw', 'landing']]);
    expect(wbStatus(mlw)).toEqual({ takeoff: true, landing: false, loading: true });

    // Station max, seats, MTOW and envelope all reported as breaches.
    const over = weightAndBalance(
      input(ASV, {
        loads: [
          { stationId: '', seatId: 'front-left', label: 'A', massKg: 120 },
          { stationId: '', seatId: 'front-left', label: 'B', massKg: 120 },
          { stationId: 'rear', label: 'R', massKg: 160 },
          { stationId: 'bag2', label: 'Bag 2', massKg: 25 },
        ],
        fuelTakeoffL: 144,
      }),
    );
    const kinds = new Set(over.limitBreaches.map((b) => b.kind));
    for (const k of ['seats', 'station', 'mtow', 'envelope'] as const) expect(kinds.has(k)).toBe(true);
    expect(wbStatus(over).takeoff).toBe(false);
    // Every breach is also a warning.
    for (const b of over.limitBreaches) expect(over.warnings).toContain(b.text);

    // A clean loading has none.
    const clean = weightAndBalance(
      input(ASV, { loads: [{ stationId: '', seatId: 'front-left', label: 'PIC', massKg: 80 }] }),
    );
    expect(clean.limitBreaches).toEqual([]);
    expect(wbStatus(clean)).toEqual({ takeoff: true, landing: true, loading: true });
    // No utility category: the loading cannot be flown as utility.
    expect(weightAndBalance(input(ASG, { category: 'utility' })).limitBreaches.map((b) => b.kind)).toContain(
      'category',
    );
  });

  test('adjustable seat arm outside the range is warned', () => {
    const r = weightAndBalance(input(ASV, { loads: [{ stationId: 'front', label: 'PIC', massKg: 80, armM: 1.3 }] }));
    expect(r.warnings.join(' ')).toMatch(/outside PIC and front passenger/);
  });
});

test('point in polygon: inside, outside, edges and vertices count as inside', () => {
  const sq: [number, number][] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ];
  expect(insidePolygon(0.5, 0.5, sq)).toBe(true);
  expect(insidePolygon(1.5, 0.5, sq)).toBe(false);
  expect(insidePolygon(1, 0.5, sq)).toBe(true);
  expect(insidePolygon(0, 0, sq)).toBe(true);
  expect(insidePolygon(0.5, 1, sq)).toBe(true);
  expect(insidePolygon(0.5, 1.0001, sq)).toBe(false);
  // The normal envelope's sloped forward limit: (0.89, 885) → (0.98, 1043).
  const poly = ASV.massBalance.envelopes.normal.polygon;
  expect(insidePolygon(0.935, 964, poly)).toBe(true); // on the line
  expect(insidePolygon(0.93, 964, poly)).toBe(false);
});

test('manifest → loads: people by seat, baggage by station, missing weights warned', () => {
  const { loads, warnings, missingWeights } = wbLoadsFromManifest(
    [
      { role: 'PIC', seat: 'front-left', snapshot: { fullName: 'Pilot', weightKg: 80 } },
      { role: 'PAX', seat: 'rear-left', snapshot: { fullName: 'Guest', weightKg: null } },
    ],
    { bag1: 12, bag2: 0, nowhere: 3 },
    ASV.massBalance.stations,
  );
  expect(loads).toEqual([
    { stationId: 'front', seatId: 'front-left', label: 'PIC Pilot', massKg: 80 },
    { stationId: 'rear', seatId: 'rear-left', label: 'PAX Guest', massKg: 0 },
    { stationId: 'bag1', label: 'Baggage area 1', massKg: 12 },
  ]);
  expect(warnings).toEqual(['Weight of Guest is not set.', 'Baggage at unknown station nowhere.']);
  expect(missingWeights).toEqual(['Guest']);
});

test('performance mass: W&B when complete, MTOW when a weight is missing or there is no W&B', () => {
  const wb = { takeoff: { massKg: 900, armM: 1, momentKgM: 900 }, landing: { massKg: 870, armM: 1, momentKgM: 870 } };
  expect(performanceMass(wb, 'takeoff', 1043, 0)).toEqual({ massKg: 900, massSource: 'wb', reason: null });
  expect(performanceMass(wb, 'landing', 1043, 0)).toEqual({ massKg: 870, massSource: 'wb', reason: null });
  expect(performanceMass(wb, 'takeoff', 1043, 1)).toEqual({
    massKg: 1043,
    massSource: 'mtow',
    reason: 'weight-missing',
  });
  expect(performanceMass(null, 'landing', 1043, 0)).toEqual({ massKg: 1043, massSource: 'mtow', reason: 'no-wb' });
  expect(performanceMass(null, 'takeoff', 0, 0)).toEqual({ massKg: null, massSource: null, reason: null });
});
