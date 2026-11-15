// Approved fuels and fuel on board by type (src/shared/fuel.ts).
import { describe, expect, test } from 'vitest';
import { fuelByType, fuelLoad, fuelTypesLabel, normalizeFuelSpec, primaryFuel } from '../../../src/shared/fuel';
import { fleetSeed } from '../../../tools/build_seed';

const [ASV] = fleetSeed();

describe('fuel specs', () => {
  test('the old one-type shape becomes one approved fuel', () => {
    const old = { type: 'MOGAS', densityKgPerL: 0.75, totalL: 159, usableL: 144, unusableL: 15, unusableIncludedInEmptyMass: true, tanks: 'standard', burnLph: 30, taxiAllowanceL: 4 };
    const f = normalizeFuelSpec(old);
    expect(f.types).toEqual([{ type: 'MOGAS', densityKgPerL: 0.75 }]);
    expect(f).not.toHaveProperty('type');
    expect(f).not.toHaveProperty('densityKgPerL');
    expect(f.usableL).toBe(144);
    expect(normalizeFuelSpec(ASV.fuel)).toBe(ASV.fuel);
  });
  test('primary fuel and label', () => {
    expect(primaryFuel(ASV.fuel)).toEqual({ type: 'AVGAS', densityKgPerL: 0.72 });
    expect(fuelTypesLabel(ASV.fuel)).toBe('AVGAS or MOGAS');
    expect(fuelTypesLabel({ types: [{ type: 'AVGAS', densityKgPerL: 0.72 }] })).toBe('AVGAS');
  });
});

describe('fuel on board by type', () => {
  test('a plain total is the first fuel', () => {
    const l = fuelLoad(ASV.fuel, 100, null);
    expect(l).toMatchObject({ totalL: 100, kg: 72, densityKgPerL: 0.72, mixed: false, unapproved: [] });
    expect(l.parts).toEqual([{ type: 'AVGAS', litres: 100, densityKgPerL: 0.72, kg: 72 }]);
  });
  test('mixed tanks: Σ litres × density, the mix density for the burn', () => {
    const l = fuelLoad(ASV.fuel, 100, { MOGAS: 40, AVGAS: 60 });
    expect(l.parts.map((p) => [p.type, p.litres])).toEqual([['AVGAS', 60], ['MOGAS', 40]]);
    expect(l.kg).toBeCloseTo(60 * 0.72 + 40 * 0.75, 9);
    expect(l.densityKgPerL).toBeCloseTo((60 * 0.72 + 40 * 0.75) / 100, 9);
    expect(l.mixed).toBe(true);
  });
  test('MOGAS only', () => {
    expect(fuelLoad(ASV.fuel, 50, { MOGAS: 50 })).toMatchObject({ kg: 37.5, densityKgPerL: 0.75, mixed: false });
  });
  test('a split that does not add up to the total is scaled to it', () => {
    const l = fuelLoad(ASV.fuel, 50, { AVGAS: 50, MOGAS: 50 });
    expect(l.parts.map((p) => p.litres)).toEqual([25, 25]);
  });
  test('a type the aircraft does not approve is flagged and weighed at its default density', () => {
    const l = fuelLoad({ types: [{ type: 'AVGAS', densityKgPerL: 0.72 }] }, 10, { 'JET A-1': 10 });
    expect(l.unapproved).toEqual(['JET A-1']);
    expect(l.kg).toBeCloseTo(8, 9);
  });
  test('empty and zero splits mean no split', () => {
    expect(fuelByType(null)).toBeNull();
    expect(fuelByType({ AVGAS: 0, MOGAS: 0 })).toBeNull();
    expect(fuelLoad(ASV.fuel, 0, null)).toMatchObject({ parts: [], kg: 0, densityKgPerL: 0.72 });
  });
});
