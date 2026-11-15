// Take-off/landing distances and the MD 4.4 aerodrome block, against hand calculations from the
// AFM tables in data/aircraft/reims-f172m.json (values copied here as literals, so a change to the
// data or a wrong interpolation both show up).
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { aircraftFromTypeJson } from '../../../src/shared/templates';
import { takeoffDistances, landingDistances, aerodromePerformance, densityAltitudeFt, type PerfConditions } from '../../../src/calc';
import type { RefRunway } from '../../../src/shared';

const type = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/aircraft/reims-f172m.json'), 'utf8'));
const T = aircraftFromTypeJson(type).performance;
const base: PerfConditions = { massKg: 1043, pressureAltFt: 0, oatC: 15, headwindKt: 0, surface: null, slopePct: 0 };

describe('take-off, AFM method', () => {
  const afm = (c: Partial<PerfConditions>) => takeoffDistances(T, { ...base, method: 'afm', ...c });

  test('table points × safety 1.33', () => {
    const d = afm({});
    expect(d.groundM).toBeCloseTo(263, 9);
    expect(d.totalM).toBeCloseTo(465, 9);
    expect(d.requiredGroundM).toBeCloseTo(263 * 1.33, 9);
    expect(d.requiredTotalM).toBeCloseTo(465 * 1.33, 9);
    expect(d.extrapolated).toBe(false);
    // 900 kg, 5000 ft (std 5 °C), 10 kt headwind: [192, 372]
    const e = afm({ massKg: 900, pressureAltFt: 5000, oatC: 5, headwindKt: 10 });
    expect(e.groundM).toBeCloseTo(192, 9);
    expect(e.totalM).toBeCloseTo(372, 9);
  });

  test('bilinear in mass and altitude, linear in headwind', () => {
    // 975 kg = midway 900–1043? no: (975−900)/143. 1250 ft = midway 0–2500. 5 kt = midway 0–10.
    const fm = 75 / 143;
    const at = (hw: number, alt: number) => {
      const rows = type.takeoff.rows;
      const g = (r: number) => rows[r].distances[hw][alt];
      return [0, 1].map((k) => g(1)[k] + fm * (g(2)[k] - g(1)[k]));
    };
    const mid = (a: number[], b: number[]) => a.map((x, k) => (x + b[k]) / 2);
    const hw0 = mid(at(0, 0), at(0, 1));
    const hw10 = mid(at(1, 0), at(1, 1));
    const want = mid(hw0, hw10);
    // 1250 ft standard temperature: 12.5 °C (table) → no temperature correction.
    const d = afm({ massKg: 975, pressureAltFt: 1250, oatC: 12.5, headwindKt: 5 });
    expect(d.groundM).toBeCloseTo(want[0], 9);
    expect(d.totalM).toBeCloseTo(want[1], 9);
  });

  test('temperature: +10 % per 15 °C above standard (proportional), none below', () => {
    expect(afm({ oatC: 30 }).totalM).toBeCloseTo(465 * 1.1, 9);
    expect(afm({ oatC: 22.5 }).totalM).toBeCloseTo(465 * 1.05, 9);
    expect(afm({ oatC: -10 }).totalM).toBeCloseTo(465, 9);
    expect(afm({ oatC: 30 }).factors.temperature).toBeCloseTo(1.1, 9);
  });

  test('headwind beyond 20 kt gets no extra credit; tailwind +10 % per 2 kt', () => {
    expect(afm({ headwindKt: 30 }).totalM).toBeCloseTo(259, 9);
    expect(afm({ headwindKt: -4 }).totalM).toBeCloseTo(465 * 1.2, 9);
    expect(afm({ headwindKt: -4 }).factors.wind).toBeCloseTo(1.2, 9);
    const t = afm({ headwindKt: -12 });
    expect(t.extrapolated).toBe(true);
    expect(t.notes!.join(' ')).toMatch(/Tailwind 12\.0 kt/);
  });

  test('club factors: surface, upslope 1.1 per 2 % (linear), downhill no credit', () => {
    expect(afm({ surface: 'short dry grass' }).requiredTotalM).toBeCloseTo(465 * 1.2 * 1.33, 9);
    expect(afm({ slopePct: 2 }).requiredTotalM).toBeCloseTo(465 * 1.1 * 1.33, 9);
    expect(afm({ slopePct: 3 }).factors.slope).toBeCloseTo(1.15, 9);
    expect(afm({ slopePct: -2 }).requiredTotalM).toBeCloseTo(465 * 1.33, 9);
    const u = afm({ surface: 'paved RWYCC 5', slopePct: 1 });
    expect(u.factors.condition).toBeCloseTo(1.15 * 1.05, 9);
    expect(afm({ surface: 'mud' }).notes!.join(' ')).toMatch(/Unknown runway condition/);
  });

  test('mass: lightest row below 750 kg, extrapolated above 1043 kg', () => {
    expect(afm({ massKg: 700 }).totalM).toBeCloseTo(224, 9);
    const heavy = afm({ massKg: 1100 });
    expect(heavy.totalM).toBeCloseTo(465 + (57 * (465 - 328)) / 143, 9);
    expect(heavy.extrapolated).toBe(true);
    // Below 0 ft: the 0 ft column.
    expect(afm({ pressureAltFt: -500, oatC: 16 }).totalM).toBeCloseTo(465, 9);
  });
});

describe('take-off and landing, club method (default)', () => {
  test('enters the table at density altitude, zero-wind column, −10 %/5 kt headwind', () => {
    // PA 0, 30 °C → DA 1800 ft. 1043 kg zero wind: 0 ft [263, 465], 2500 ft [317, 582].
    const da = densityAltitudeFt(0, 30);
    expect(da).toBeCloseTo(1800, 9);
    const f = da / 2500;
    const d = takeoffDistances(T, { ...base, oatC: 30, headwindKt: 10 });
    expect(d.method).toBe('club');
    expect(d.factors.temperature).toBe(1);
    expect(d.groundM).toBeCloseTo((263 + f * (317 - 263)) * 0.8, 9);
    expect(d.totalM).toBeCloseTo((465 + f * (582 - 465)) * 0.8, 9);
    expect(d.requiredTotalM).toBeCloseTo(d.totalM * 1.33, 9);
  });

  test('headwind credit capped at 50 %; tailwind +10 %/2 kt', () => {
    expect(takeoffDistances(T, { ...base, headwindKt: 40 }).totalM).toBeCloseTo(465 * 0.5, 9);
    expect(takeoffDistances(T, { ...base, headwindKt: -6 }).totalM).toBeCloseTo(465 * 1.3, 9);
  });

  test('landing: table at 1043 kg, −10 %/5 kt, downslope adverse, safety 1.43', () => {
    // DA 2500 ft: [170, 400].
    const pa = 2500;
    const oat = 15 - 1.98 * 2.5; // ISA → DA = PA
    const d = landingDistances(T, { ...base, pressureAltFt: pa, oatC: oat, headwindKt: 5, slopePct: -2 });
    expect(d.groundM).toBeCloseTo(170 * 0.9, 9);
    expect(d.totalM).toBeCloseTo(400 * 0.9, 9);
    expect(d.factors.slope).toBeCloseTo(1.1, 9);
    expect(d.requiredTotalM).toBeCloseTo(400 * 0.9 * 1.1 * 1.43, 9);
    // Uphill landing: no credit.
    expect(landingDistances(T, { ...base, slopePct: 2 }).requiredTotalM).toBeCloseTo(381 * 1.43, 9);
  });

  test('landing, AFM method: PA + temperature correction', () => {
    const d = landingDistances(T, { ...base, oatC: 30, method: 'afm' });
    expect(d.totalM).toBeCloseTo(381 * 1.1, 9);
    expect(d.factors.temperature).toBeCloseTo(1.1, 9);
  });
});

describe('aerodromePerformance (one MD 4.4 block)', () => {
  const rwy = (designator: string, extra: Partial<RefRunway> = {}): RefRunway => ({
    aerodromeId: 'LGXX', designator, reciprocal: '', headingMagDeg: parseInt(designator, 10) * 10, headingTrueDeg: null,
    lengthM: 1100, widthM: 30, surface: 'ASPH', toraM: 1000, todaM: 1100, asdaM: 1000, ldaM: 900, slopePct: 0, thresholdElevFt: null, ...extra,
  });
  const input = {
    phase: 'takeoff' as const, aerodromeElevFt: 0, runways: [rwy('03'), rwy('21', { slopePct: 2 })], wind: { dirTrueDeg: 215, speedKt: 10 },
    qnhHpa: 1013.25, oatC: 15, variationDeg: 5, massKg: 1043, tables: T, runway: null, surface: null,
  };

  test('picks the runway from the wind, applies its slope, compares with TODA/TORA', () => {
    const p = aerodromePerformance(input);
    expect(p.runway!.designator).toBe('21');
    expect(p.wind.headwindKt).toBeCloseTo(10, 9);
    expect(p.pressureAltFt).toBeCloseTo(0, 9);
    expect(p.densityAltFt).toBeCloseTo(0, 9);
    const d = p.distances!;
    expect(d.requiredTotalM).toBeCloseTo(465 * 0.8 * 1.1 * 1.33, 9);
    expect(d.requiredGroundM).toBeCloseTo(263 * 0.8 * 1.1 * 1.33, 9);
    expect(p.availableTotalM).toBe(1100);
    expect(p.availableGroundM).toBe(1000);
    expect(p.marginM).toBeCloseTo(Math.min(1100 - d.requiredTotalM, 1000 - d.requiredGroundM), 9);
    expect(p.crosswindOk).toBe(true);
    expect(p.tailwind).toBe(false);
  });

  test('forced runway with tailwind and crosswind over the limit', () => {
    const p = aerodromePerformance({ ...input, runway: '03', wind: { dirTrueDeg: 155, speedKt: 30 }, phase: 'landing' });
    // 150 magnetic on RWY 03: 120° off → head −15, cross 26.
    expect(p.runway!.designator).toBe('03');
    expect(p.wind.headwindKt).toBeCloseTo(-15, 9);
    expect(p.tailwind).toBe(true);
    expect(p.crosswindOk).toBe(false);
    expect(p.availableTotalM).toBe(900);
    expect(p.warnings.join(' ')).toMatch(/Crosswind 26\.0 kt exceeds the landing limit of 15 kt/);
    expect(p.warnings.join(' ')).toMatch(/Tailwind 15\.0 kt/);
  });

  test('does not fit → negative margin and a warning; unknown declared distances → length', () => {
    const p = aerodromePerformance({ ...input, runways: [rwy('21', { toraM: 300, todaM: 300 })] });
    expect(p.marginM!).toBeLessThan(0);
    expect(p.warnings.join(' ')).toMatch(/does not fit/);
    const q = aerodromePerformance({ ...input, runways: [rwy('21', { toraM: null, todaM: null, ldaM: null, slopePct: null })] });
    expect(q.availableTotalM).toBe(1100);
    expect(q.warnings.join(' ')).toMatch(/runway length 1100 m used/);
    expect(q.warnings.join(' ')).toMatch(/Slope of runway 21 unknown/);
  });

  test('grass runway without a chosen condition assumes short dry grass and says so', () => {
    const p = aerodromePerformance({ ...input, runways: [rwy('21', { surface: 'GRASS', slopePct: 0 })] });
    expect(p.distances!.factors.surface).toBe(1.2);
    expect(p.warnings.join(' ')).toMatch(/short dry grass/);
  });

  test('no runway data: still computes PA/DA and distances, warns', () => {
    const p = aerodromePerformance({ ...input, runways: [], aerodromeElevFt: 1000, oatC: 30 });
    expect(p.runway).toBeNull();
    expect(p.marginM).toBeNull();
    expect(p.distances).not.toBeNull();
    expect(p.isaDevC).toBeCloseTo(30 - (15 - 1.98), 9);
    expect(p.warnings.join(' ')).toMatch(/No runway data/);
  });
});
