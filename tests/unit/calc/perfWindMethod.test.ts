// aerodromePerformance: variable and gusty surface wind against the crosswind limits, and the
// landing distance computed by both methods (club and AFM), the longer one used.
// References are hand calculations from the AFM tables (data/aircraft/reims-f172m.json).
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { aircraftFromTypeJson } from '../../../src/shared/templates';
import { aerodromePerformance, landingDistances, pressureAltitudeFt } from '../../../src/calc';
import type { RefRunway } from '../../../src/shared';

const type = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../data/aircraft/reims-f172m.json'), 'utf8'));
const T = aircraftFromTypeJson(type).performance;

const rwy = (designator: string, extra: Partial<RefRunway> = {}): RefRunway => ({
  aerodromeId: 'LGXX', designator, reciprocal: '', headingMagDeg: parseInt(designator, 10) * 10, headingTrueDeg: null,
  lengthM: 1100, widthM: 30, surface: 'ASPH', toraM: 1000, todaM: 1100, asdaM: 1000, ldaM: 900, slopePct: 0, thresholdElevFt: null, ...extra,
});
const base = {
  phase: 'takeoff' as const, aerodromeElevFt: 0, runways: [rwy('03'), rwy('21')],
  qnhHpa: 1013.25, oatC: 15, variationDeg: 0, massKg: 1043, tables: T, runway: null, surface: null,
};

describe('variable and gusty surface wind', () => {
  test('VRB15G25KT: no runway choice from it, no headwind, full speed (and gust) as crosswind', () => {
    const p = aerodromePerformance({ ...base, wind: { dirTrueDeg: null, speedKt: 15, gustKt: 25 } });
    expect(p.variableWind).toBe(true);
    expect(p.runway!.designator).toBe('03'); // first runway, as calm
    expect(p.wind.headwindKt).toBe(0);
    expect(p.wind.crosswindKt).toBe(15);
    expect(p.crosswindGustKt).toBe(25);
    expect(p.crosswindOk).toBe(false); // 25 > 20 kt take-off limit
    expect(p.warnings.join(' ')).toMatch(/Variable wind 15 kt gusting 25 kt/);
    expect(p.warnings.join(' ')).toMatch(/Crosswind 15\.0 kt, 25\.0 kt in gusts, exceeds the take-off limit of 20 kt/);
    expect(p.warnings.join(' ')).not.toMatch(/No surface wind/);
  });

  test('VRB05KT is within limits but still gets no headwind credit', () => {
    const p = aerodromePerformance({ ...base, phase: 'landing', wind: { dirTrueDeg: null, speedKt: 5, gustKt: null } });
    expect(p.crosswindOk).toBe(true);
    expect(p.wind).toEqual({ headwindKt: 0, crosswindKt: 5, crossFrom: '' });
    expect(p.distances!.factors.wind).toBe(1);
  });

  test('27015G28KT across RWY 03/21: mean crosswind within 20 kt, the gust is not', () => {
    // RWY 21 is picked (270 is 60° off 210: head 7.5, cross 13.0); gust cross 28 sin 60° = 24.2
    const p = aerodromePerformance({ ...base, wind: { dirTrueDeg: 270, speedKt: 15, gustKt: 28 } });
    expect(p.runway!.designator).toBe('21');
    expect(p.wind.crosswindKt).toBeCloseTo(15 * Math.sin(Math.PI / 3), 9);
    expect(p.crosswindGustKt!).toBeCloseTo(28 * Math.sin(Math.PI / 3), 9);
    expect(p.crosswindOk).toBe(false);
    // distances use the mean wind: headwind 7.5 kt → ×(1 − 0.1 × 7.5/5) = 0.85
    expect(p.distances!.factors.wind).toBeCloseTo(0.85, 9);
    // the same wind without the gust is within limits
    expect(aerodromePerformance({ ...base, wind: { dirTrueDeg: 270, speedKt: 15, gustKt: null } }).crosswindOk).toBe(true);
  });

  test('gust not above the mean is ignored; calm (0 kt) is not "no wind"', () => {
    expect(aerodromePerformance({ ...base, wind: { dirTrueDeg: 210, speedKt: 10, gustKt: 10 } }).crosswindGustKt).toBeNull();
    const calm = aerodromePerformance({ ...base, wind: { dirTrueDeg: null, speedKt: 0, gustKt: null } });
    expect(calm.variableWind).toBe(false);
    expect(calm.wind.crosswindKt).toBe(0);
    expect(calm.warnings.join(' ')).not.toMatch(/No surface wind/);
    expect(aerodromePerformance({ ...base, wind: null }).warnings.join(' ')).toMatch(/No surface wind: calm assumed/);
  });
});

describe('landing: both methods, the longer LDR used', () => {
  // Review case (club calculator case #9): LGTT elevation 861 ft, QNH 1013, 36 °C, calm, paved.
  // AFM method by hand at PA 868 ft: 381 + 19·0.347 = 387.6 m, × (1 + 0.1·(36 − 13.26)/15) = ×1.1516,
  // × 1.43 = 638 m. Club method (table at DA ≈ 3600 ft, no temperature factor): 586 m.
  const hot = { ...base, phase: 'landing' as const, aerodromeElevFt: 861, qnhHpa: 1013, oatC: 36, wind: null, runways: [rwy('03', { ldaM: 1000 })] };

  test('hot day: the AFM figure (longer) is used, the club one is kept as the alternative', () => {
    const p = aerodromePerformance(hot);
    expect(p.distances!.method).toBe('afm');
    expect(p.alternative!.method).toBe('club');
    expect(p.distances!.requiredTotalM).toBeCloseTo(638.3, 0);
    expect(Math.round(p.alternative!.requiredTotalM)).toBe(586);
    expect(p.marginM).toBeCloseTo(1000 - p.distances!.requiredTotalM, 9);
    expect(p.warnings.join(' ')).toMatch(/AFM method \(PA 868 ft, \+10 %\/15 °C\) LDR 639 m used: longer than the club method's 586 m/);
    // matches landingDistances by method
    const pa = pressureAltitudeFt(861, 1013);
    const c = { massKg: 1043, pressureAltFt: pa, oatC: 36, headwindKt: 0, surface: null, slopePct: 0 };
    expect(p.distances!.requiredTotalM).toBeCloseTo(landingDistances(T, { ...c, method: 'afm' }).requiredTotalM, 9);
    expect(p.alternative!.requiredTotalM).toBeCloseTo(landingDistances(T, { ...c, method: 'club' }).requiredTotalM, 9);
  });

  test('cold or ISA day: the methods agree within ~2 %; never shorter than the club figure', () => {
    // Below ISA the club's DA is below PA, so its figure is the shorter one; at ISA they differ
    // only by the DA/PA column interpolation.
    for (const oatC of [-10, 0, 10, 15]) {
      const p = aerodromePerformance({ ...hot, oatC });
      const club = p.distances!.method === 'club' ? p.distances! : p.alternative!;
      expect(p.distances!.requiredTotalM).toBeGreaterThanOrEqual(club.requiredTotalM);
      expect(p.distances!.requiredTotalM / club.requiredTotalM).toBeLessThan(1.02);
    }
  });

  test('an explicit method computes that method only; take-off stays on the club method', () => {
    const p = aerodromePerformance({ ...hot, method: 'club' });
    expect(p.distances!.method).toBe('club');
    expect(p.alternative).toBeNull();
    const to = aerodromePerformance({ ...hot, phase: 'takeoff' });
    expect(to.distances!.method).toBe('club');
    expect(to.alternative).toBeNull();
  });
});
