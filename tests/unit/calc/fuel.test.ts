// planFuel: hand-computed references.
import { expect, test } from 'vitest';
import { litresFor, minutesFor, planFuel, type FuelPlanInput } from '../../../src/calc';

const base: FuelPlanInput = { tripFuelL: 13, taxiAllowanceL: 4, burnLph: 30, finalReserveMin: 0, reserveMin: 60, fobL: null, usableL: 144, tripMin: 24 };

test('required = allowance + trip (+ final reserve); default FOB = required + reserve', () => {
  // 4 + 13 = 17 required; reserve 60 min × 30 L/h = 30 L; default FOB 47 L
  const p = planFuel(base);
  expect(p).toMatchObject({ taxiL: 4, tripL: 13, finalReserveL: 0, requiredL: 17, reserveL: 30, defaultFobL: 47, fobL: 47, fobIsDefault: true });
  // landing fuel 47 − 4 − 13 = 30 L → 60 min; endurance 47 L / 30 L/h = 94 min (FPL E/0134)
  expect(p).toMatchObject({ landingFuelL: 30, landingEnduranceMin: 60, enduranceMin: 94 });
  expect(p).toMatchObject({ overCapacity: false, defaultOverCapacity: false, belowRequired: false, reserveUnset: false });
  expect(p.warnings).toEqual([]);
});

test('final reserve inside required; reserve litres rounded up', () => {
  // at 31 L/h: final reserve 30 min = 15.5 → 16 L, required 4 + 13 + 16 = 33; reserve 45 min = 23.25 → 24 L
  const p = planFuel({ ...base, finalReserveMin: 30, reserveMin: 45, burnLph: 31 });
  expect(p).toMatchObject({ finalReserveL: 16, requiredL: 33, reserveL: 24, defaultFobL: 57 });
  // at 30 L/h: final reserve 30 min = 15 L, required 32, default FOB 32 + 30 = 62
  expect(planFuel({ ...base, finalReserveMin: 30 })).toMatchObject({ finalReserveL: 15, requiredL: 32, defaultFobL: 62 });
});

test('FOB entered: capacity and required checks', () => {
  const over = planFuel({ ...base, fobL: 150 });
  expect(over).toMatchObject({ fobL: 150, fobIsDefault: false, overCapacity: true, belowRequired: false, landingFuelL: 133, enduranceMin: 300 });
  expect(over.warnings).toEqual(['Fuel on board 150 L exceeds usable capacity 144 L.']);
  const low = planFuel({ ...base, fobL: 10 });
  expect(low).toMatchObject({ belowRequired: true, landingFuelL: -7, enduranceMin: 20 });
  expect(low.warnings).toEqual(['Fuel on board 10 L is below required 17 L.']);
  expect(planFuel({ ...base, fobL: 144 }).overCapacity).toBe(false);
  expect(planFuel({ ...base, fobL: 17 }).belowRequired).toBe(false);
});

test('default FOB above capacity is flagged, not capped', () => {
  const p = planFuel({ ...base, tripFuelL: 120 });
  expect(p).toMatchObject({ requiredL: 124, defaultFobL: 154, fobL: 154, overCapacity: true, defaultOverCapacity: true });
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
  expect(p.warnings).toEqual(expect.arrayContaining(['Aircraft burn rate not set.', 'Aircraft usable fuel capacity not set.']));
});

test('helpers', () => {
  expect([litresFor(60, 30), litresFor(1, 30), litresFor(0, 30), litresFor(10, 0)]).toEqual([30, 1, 0, 0]);
  expect([minutesFor(47, 30), minutesFor(30, 30), minutesFor(1, 0)]).toEqual([94, 60, NaN]);
});
