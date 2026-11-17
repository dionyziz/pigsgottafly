// planFuel: hand-computed references.
import { describe, expect, test } from 'vitest';

import { type FuelPlanInput, isLocalFlight, litresFor, minutesFor, planFuel } from '../../../src/calc';
import { taxiAllowanceOf } from '../../../src/shared';

const base: FuelPlanInput = {
  tripFuelL: 13,
  taxiAllowanceL: 4,
  burnLph: 30,
  finalReserveMin: 0,
  reserveMin: 60,
  fobL: null,
  usableL: 144,
  tripMin: 24,
};

test('required = allowance + trip (+ final reserve); default FOB = required + reserve', () => {
  // 4 + 13 = 17 required; reserve 60 min × 30 L/h = 30 L; default FOB 47 L
  const p = planFuel(base);
  expect(p).toMatchObject({
    taxiL: 4,
    tripL: 13,
    finalReserveL: 0,
    requiredL: 17,
    reserveL: 30,
    defaultFobL: 47,
    fobL: 47,
    fobIsDefault: true,
  });
  // landing fuel 47 − 4 − 13 = 30 L → 60 min; endurance 47 L / 30 L/h = 94 min (FPL E/0134)
  expect(p).toMatchObject({ landingFuelL: 30, landingEnduranceMin: 60, enduranceMin: 94 });
  expect(p).toMatchObject({
    overCapacity: false,
    defaultOverCapacity: false,
    belowRequired: false,
    reserveUnset: false,
  });
  expect(p.warnings).toEqual([]);
});

test('the taxi allowance is per take-off: the flight override replaces the aircraft value', () => {
  expect(planFuel(base)).toMatchObject({ taxiL: 4, takeoffs: 1 });
  expect(planFuel({ ...base, stops: 2 })).toMatchObject({ taxiL: 12, takeoffs: 3, requiredL: 25 });
  const spec = { taxiAllowanceL: 4 };
  expect(taxiAllowanceOf(spec, {})).toBe(4);
  expect(taxiAllowanceOf(spec, { taxiAllowanceL: null })).toBe(4);
  expect(taxiAllowanceOf(spec, null)).toBe(4);
  expect(taxiAllowanceOf(spec, { taxiAllowanceL: 0 })).toBe(0);
  const p = planFuel({ ...base, taxiAllowanceL: taxiAllowanceOf(spec, { taxiAllowanceL: 7 }), stops: 1 });
  expect(p).toMatchObject({ taxiL: 14, requiredL: 27, defaultFobL: 57, landingFuelL: 30 });
});

test('final reserve inside required; reserve litres rounded up', () => {
  // at 31 L/h: final reserve 30 min = 15.5 → 16 L, required 4 + 13 + 16 = 33; reserve 45 min = 23.25 → 24 L
  const p = planFuel({ ...base, finalReserveMin: 30, reserveMin: 45, burnLph: 31 });
  expect(p).toMatchObject({ finalReserveL: 16, requiredL: 33, reserveL: 24, defaultFobL: 57 });
  // at 30 L/h: final reserve 30 min = 15 L, required 32, default FOB 32 + 30 = 62
  expect(planFuel({ ...base, finalReserveMin: 30 })).toMatchObject({
    finalReserveL: 15,
    requiredL: 32,
    defaultFobL: 62,
  });
});

test('FOB entered: capacity and required checks', () => {
  const over = planFuel({ ...base, fobL: 150 });
  expect(over).toMatchObject({
    fobL: 150,
    fobIsDefault: false,
    overCapacity: true,
    belowRequired: false,
    landingFuelL: 133,
    enduranceMin: 300,
  });
  expect(over.warnings).toEqual(['Fuel on board 150 L exceeds usable capacity 144 L.']);
  const low = planFuel({ ...base, fobL: 10 });
  expect(low).toMatchObject({ belowRequired: true, landingFuelL: -7, enduranceMin: 20 });
  expect(low.warnings).toEqual(['Fuel on board 10 L is below required 17 L.']);
  expect(planFuel({ ...base, fobL: 144 }).overCapacity).toBe(false);
  expect(planFuel({ ...base, fobL: 17 }).belowRequired).toBe(false);
});

test('default FOB above capacity is flagged, not capped', () => {
  const p = planFuel({ ...base, tripFuelL: 120 });
  expect(p).toMatchObject({
    requiredL: 124,
    defaultFobL: 154,
    fobL: 154,
    overCapacity: true,
    defaultOverCapacity: true,
  });
});

test('reserve not set in the profile: 0 used, flagged', () => {
  const p = planFuel({ ...base, reserveMin: null });
  expect(p).toMatchObject({ reserveL: 0, defaultFobL: 17, reserveUnset: true });
  expect(p.warnings[0]).toMatch(/reserve not set/);
});

test('no burn / no capacity', () => {
  const p = planFuel({ ...base, burnLph: 0, usableL: 0 });
  expect(p.reserveL).toBe(0);
  expect(p.enduranceMin).toBeNaN();
  expect(p.overCapacity).toBe(false);
  expect(p.warnings).toEqual(
    expect.arrayContaining(['Aircraft burn rate not set.', 'Aircraft usable fuel capacity not set.']),
  );
});

test('helpers', () => {
  expect([litresFor(60, 30), litresFor(1, 30), litresFor(0, 30), litresFor(10, 0)]).toEqual([30, 1, 0, 0]);
  expect([minutesFor(47, 30), minutesFor(30, 30), minutesFor(1, 0)]).toEqual([94, 60, NaN]);
});

describe('legal final reserve at landing (NCO.OP.125 day VFR: 30 min, 10 min local)', () => {
  // Review case: LGTT → (37.80,24.10) → (37.55,24.60) → LGSO, SX-ASV: trip 22 L, taxi 4 L.
  const trip = { ...base, tripFuelL: 22, finalReserveMin: 0, fobL: 30 };

  test('FOB covering taxi + trip but landing with 4 L (8 min) is a danger', () => {
    const p = planFuel(trip);
    expect(p).toMatchObject({
      requiredL: 26,
      belowRequired: false,
      landingFuelL: 4,
      landingEnduranceMin: 8,
      minLandingReserveMin: 30,
      landingReserveShort: true,
    });
    expect(p.issues).toEqual([
      {
        level: 'danger',
        text: 'Fuel at landing 4 L lasts 0h08: below the 30 min legal final reserve for day VFR (NCO.OP.125).',
      },
    ]);
    expect(p.warnings).toEqual(p.issues.map((i) => i.text));
  });

  test('exactly 30 min (15 L at 30 L/h) passes; 14 L does not', () => {
    expect(planFuel({ ...trip, fobL: 41 })).toMatchObject({ landingFuelL: 15, landingReserveShort: false, issues: [] });
    expect(planFuel({ ...trip, fobL: 40 }).landingReserveShort).toBe(true);
  });

  test('local flight: 10 min floor (danger below), warning between 10 and 30 min', () => {
    const p = planFuel({ ...trip, fobL: 30, localFlight: true });
    expect(p).toMatchObject({ minLandingReserveMin: 10, landingReserveShort: true });
    // 8 min < 10 min → danger
    expect(p.issues[0].text).toMatch(/below the 10 min legal final reserve for a local VFR flight/);
    expect(p.issues[0].level).toBe('danger');
    // 6 L = 12 min: legal for a local flight in sight, warned
    const q = planFuel({ ...trip, fobL: 32, localFlight: true });
    expect(q).toMatchObject({ landingFuelL: 6, landingReserveShort: false });
    expect(q.issues).toEqual([{ level: 'warn', text: expect.stringMatching(/within sight of the aerodrome/) }]);
  });

  test("the pilot's own final reserve above the legal floor is the minimum", () => {
    // final reserve 45 min = 23 L → required 49; FOB 49 lands with 23 L = 46 min: OK
    expect(planFuel({ ...trip, finalReserveMin: 45, fobL: 49 })).toMatchObject({
      minLandingReserveMin: 45,
      landingReserveShort: false,
      issues: [],
    });
    // FOB 45 is below required (danger) and lands with 19 L = 38 min: still above the legal 30
    const p = planFuel({ ...trip, finalReserveMin: 45, fobL: 45 });
    expect(p.landingReserveShort).toBe(true);
    expect(p.issues.map((i) => i.level)).toEqual(['danger']);
    expect(p.issues[0].text).toMatch(/below required/);
  });

  test('default FOB with no reserve set lands with 0 L: flagged', () => {
    const p = planFuel({ ...trip, fobL: null, reserveMin: null });
    expect(p.landingFuelL).toBe(0);
    expect(p.issues.some((i) => i.level === 'danger' && /legal final reserve/.test(i.text))).toBe(true);
  });

  test('isLocalFlight', () => {
    const a = { lat: 38.1089, lon: 23.7836 },
      b = { lat: 37.9364, lon: 23.9445 };
    expect(isLocalFlight([a, b])).toBe(false);
    expect(isLocalFlight([a, b, { lat: 38.11, lon: 23.784 }])).toBe(true);
    expect(isLocalFlight([a])).toBe(false);
  });
});
