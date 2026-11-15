// External cross-check: every case of tests/fixtures/club-wbp-cases.json (answers of the Aeroclub
// Mesogeion W&B/performance calculator, https://www.mesogeion-aeroclub.gr/wbp.php, for SX-ASV and
// SX-ASG) runs through our W&B and performance functions with the SEEDED aircraft
// (tools/build_seed.ts → migration 003), and must agree within the tolerances below.
//
// What the club calculator does (reverse-engineered from the 90 answers; all reproduced here):
//   W&B
//   - rows: empty, PIC + front pax at 0.94 m, rear pax 1.85, baggage 2.41 / 3.12, usable fuel;
//     masses and moments printed to 0.01.
//   - SX-ASV empty: the club uses 691.0 kg with moment 719.12 kg·m; the 2024 weighing report
//     (fleet.json, our seed) says 691.2 kg and 719.12 kg·m. So our SX-ASV masses are 0.2 kg
//     higher (moment equal). DIFFERENCE 0 (the club's empty mass is not the current report's).
//   - fuel: AVGAS 0.72 kg/L, MOGAS 0.75 kg/L, arm printed "1.22" but computed with 1.21539 m
//     (= 47.85 in): 72 kg → 87.51 kg·m, 103.68 kg → 126.01 kg·m. Our seed uses the AFM's 1.215 m,
//     so our fuel moment is lower by fuel kg × 0.00039 (≤ 0.06 kg·m at full tanks). DIFFERENCE 1.
//   - take-off mass = empty + people + baggage + fuel on board (no taxi burn); landing mass =
//     take-off mass − BlockFuel (taxi + trip) × density. We do the same (fuelTakeoffL = FOB,
//     fuelLandingL = FOB − block fuel), except that when the block fuel exceeds the fuel on board
//     the club lands with NEGATIVE fuel; we land with 0 L and warn (heavier, conservative).
//   - SX-ASG was weighed with EMPTY tanks (fleet.json), so its 15 L unusable fuel must be added;
//     the club does not add it (692 kg). We do: our SX-ASG masses are 15 L × density higher
//     (10.8 kg AVGAS, 11.25 kg MOGAS) and moments 15 × density × 1.215 higher. DIFFERENCE 2
//     (a club simplification that understates SX-ASG's mass).
//   Performance (MD 4.4)
//   - PA = elevation + 27 ft × (1013 − QNH). We use the ISA barometric formula (≈27.3 ft/hPa at
//     sea level, reference 1013.25 hPa): within 3.5 % of the QNH correction + 7 ft. DIFFERENCE 3.
//   - DA = PA + 120 × (OAT − (15 − 2 × PA/1000)). We use the 1.98 °C/1000 ft ISA lapse rate:
//     DA differs by the PA difference × 1.24 plus ≤ 0.0024 × PA. DIFFERENCE 4 (tiny).
//   - wind: head = |wind × cos(angle)|, cross = |wind × sin(angle)|, runway heading = designator
//     × 10, printed to 0.1 kt. Its last digit is not consistently rounded (20 kt at 30° prints
//     crosswind 10.1 for 20 × sin 30° = 10.0; 25 kt at 170° prints 4.4 for 4.34; 10 kt at 40°
//     prints headwind 7.6 for 7.66; no single runway heading or rounding mode fits all 90 cases),
//     so components are compared within 0.1 kt. The club takes the ABSOLUTE value, so a TAILWIND is shown and used as a HEADWIND
//     (e.g. RWY 21 with 030/10: "HeadWind 10"). DIFFERENCE 5: a club bug. We keep the sign and
//     apply +10 % per 2 kt of tailwind, so on tailwind cases our distances are LONGER.
//   - condition factor = RWYCC/grass factor × (1 + 0.05 × slope %), printed to 0.01, computed
//     unrounded; safety 1.33 / 1.43.
//   - distances: the AFM table at the DENSITY altitude (0 ft column below 0), linear in mass
//     (extrapolated above 1043 kg), zero-wind column, −10 % per 5 kt headwind for take-off AND
//     landing, × condition × safety, rounded to the metre. Our 'da' method is this model; our
//     results agree within 0.75 % or 1 m (observed max ≈ 0.6 %, from DIFFERENCES 3 and 4).
//   - The AFM method ('afm': table at PA + 10 %/15 °C, take-off headwind columns) is NOT the
//     club's: with headwind the AFM columns give up to ~28 % shorter take-offs, in heat the
//     +10 %/15 °C rule gives up to ~15 % shorter take-offs but up to ~10 % longer landings than
//     entering the table at DA. That is why 'da' is the default method. Checked below.
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fleetSeed } from '../../../tools/build_seed';
import {
  weightAndBalance,
  pressureAltitudeFt,
  densityAltitudeFt,
  windComponents,
  takeoffDistances,
  landingDistances,
  type PerfMethod,
} from '../../../src/calc';
import type { AircraftInput, PerformanceTables } from '../../../src/shared';

interface ClubInput {
  Registration: 'SXASV' | 'SXASG';
  PIC_FPax: number; RPax: number; Baggage1: number; Baggage2: number;
  AVGAS: number; MOGAS: number;
  Elevation: number; QNH: number; Temperature: number; RWY: string; Wind_Dir: number; Wind_Sp: number; RWY_Slope_TO: number; RWYCC: number;
  BlockFuel: number;
  Elevation_land: number; QNH_land: number; Temperature_land: number; RWY_land: string; Wind_Dir_land: number; Wind_Sp_land: number; RWY_Slope_LDG: number; RWYCC_land: number;
}
interface ClubPhase { pressureAltFt: number; densityAltFt: number; headwindKt: number; crosswindKt: number; massKg: number; conditionFactor: number; safetyFactor: number; todrM?: number; torrM?: number; ldrM?: number; lrrM?: number }
interface ClubCase { input: ClubInput; club: { wbRows: Record<string, [number, number, number]>; total: [number, number]; takeoff: ClubPhase; landing: ClubPhase } }

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/club-wbp-cases.json'), 'utf8')) as { cases: ClubCase[] };
const CASES = fixture.cases;
const [ASV, ASG] = fleetSeed();
const aircraftOf = (reg: string): AircraftInput => (reg === 'SXASV' ? ASV : ASG);

const CLUB_FUEL_ARM = 1.21539; // 47.85 in
const CLUB_EMPTY_KG: Record<string, number> = { SXASV: 691.0, SXASG: 692.0 };
const UNUSABLE_L = 15;

function fuelOf(i: ClubInput): { litres: number; density: number } {
  // No case mixes the two; a mix would be computed per type by the club.
  if (i.AVGAS > 0 && i.MOGAS > 0) throw new Error('mixed fuel case');
  return i.MOGAS > 0 ? { litres: i.MOGAS, density: 0.75 } : { litres: i.AVGAS, density: 0.72 };
}

/** Our W&B for a club case. clubConventions: fuel arm 1.21539 and no unusable fuel added. */
function wbFor(c: ClubCase, clubConventions: boolean) {
  const a = aircraftOf(c.input.Registration);
  const i = c.input;
  const { litres, density } = fuelOf(i);
  const mb = structuredClone(a.massBalance);
  if (clubConventions) {
    mb.stations = mb.stations.map((s) => (s.kind === 'fuel' ? { ...s, armM: CLUB_FUEL_ARM } : s));
    mb.emptyMassKg = CLUB_EMPTY_KG[i.Registration];
  }
  return weightAndBalance({
    massBalance: mb,
    loads: [
      { stationId: 'front', label: 'PIC and front passenger', massKg: i.PIC_FPax },
      { stationId: 'rear', label: 'Rear passengers', massKg: i.RPax },
      { stationId: 'bag1', label: 'Baggage area 1', massKg: i.Baggage1 },
      { stationId: 'bag2', label: 'Baggage area 2', massKg: i.Baggage2 },
    ],
    fuelTakeoffL: litres,
    fuelLandingL: litres - i.BlockFuel,
    fuelDensityKgPerL: density,
    unusableFuelL: a.fuel.unusableL,
    unusableIncludedInEmptyMass: clubConventions ? true : a.fuel.unusableIncludedInEmptyMass,
    category: 'normal',
  });
}

const CLUB_ROW: Record<string, string> = {
  front: 'PIC and Front Passenger',
  rear: 'Rear Passengers',
  bag1: 'Baggage Area 1',
  bag2: 'Baggage Area 2',
};

describe('club W&B (mesogeion-aeroclub.gr/wbp.php)', () => {
  test('fixture has the 90 cases for both aircraft', () => {
    expect(CASES).toHaveLength(90);
    expect(new Set(CASES.map((c) => c.input.Registration))).toEqual(new Set(['SXASV', 'SXASG']));
  });

  test.each(CASES.map((c, n) => [n, c] as const))('case %i: rows, totals, take-off and landing mass (club conventions: exact to 0.01)', (_n, c) => {
    const r = wbFor(c, true);
    const rows = c.club.wbRows;
    // Empty aircraft: printed mass rounded to the kg, moment exact.
    const empty = rows['Corrected / Licenced Empty Weight'];
    expect(r.stationRows![0].massKg).toBeCloseTo(empty[0], 2);
    expect(r.stationRows![0].momentKgM).toBeCloseTo(empty[2], 2);
    for (const sr of r.stationRows!) {
      const name = sr.stationId ? CLUB_ROW[sr.stationId] : undefined;
      if (!name) continue;
      const [m, arm, mom] = rows[name];
      expect(sr.massKg).toBeCloseTo(m, 2);
      expect(sr.armM).toBeCloseTo(arm, 2);
      expect(Math.abs(sr.momentKgM - mom)).toBeLessThanOrEqual(0.0051);
    }
    const fuel = r.stationRows![r.stationRows!.length - 1];
    const [fm, , fmom] = rows['Usuable Fuel'];
    expect(fuel.massKg).toBeCloseTo(fm, 2);
    expect(Math.abs(fuel.momentKgM - fmom)).toBeLessThanOrEqual(0.0051);
    // Totals: the club sums the rounded row moments.
    expect(r.takeoff.massKg).toBeCloseTo(c.club.total[0], 2);
    expect(Math.abs(r.takeoff.momentKgM - c.club.total[1])).toBeLessThanOrEqual(0.015);
    expect(r.takeoff.massKg).toBeCloseTo(c.club.takeoff.massKg, 2);
    const { litres, density } = fuelOf(c.input);
    if (litres >= c.input.BlockFuel) {
      expect(r.landing.massKg).toBeCloseTo(c.club.landing.massKg, 2);
    } else {
      // The club lands with negative fuel; we land with none and warn.
      expect(c.club.landing.massKg).toBeCloseTo(c.club.takeoff.massKg - c.input.BlockFuel * density, 2);
      expect(r.landing.massKg).toBeCloseTo(r.zeroFuel.massKg, 9);
      expect(r.warnings.join(' ')).toMatch(/negative/);
    }
  });

  test.each(CASES.map((c, n) => [n, c] as const))('case %i: our seeded aircraft differs only by the fuel arm and SX-ASG unusable fuel', (_n, c) => {
    const ours = wbFor(c, false);
    const club = wbFor(c, true);
    const { litres, density } = fuelOf(c.input);
    const asg = c.input.Registration === 'SXASG';
    const unusableKg = asg ? UNUSABLE_L * density : 0;
    // DIFFERENCE 0: SX-ASV empty mass 691.2 (report) vs 691.0 (club); same moment.
    const emptyKg = asg ? 0 : 0.2;
    // DIFFERENCE 2: SX-ASG's unusable fuel (weighed with empty tanks).
    expect(ours.takeoff.massKg - club.takeoff.massKg).toBeCloseTo(unusableKg + emptyKg, 9);
    expect(ours.landing.massKg - club.landing.massKg).toBeCloseTo(unusableKg + emptyKg, 9);
    expect(ours.takeoff.massKg - c.club.total[0]).toBeCloseTo(unusableKg + emptyKg, 2);
    expect(ours.rows.some((row) => row.label.startsWith('Unusable fuel'))).toBe(asg);
    // DIFFERENCE 1: fuel arm 1.215 (AFM) vs 1.21539 (club).
    const fuelKg = litres * density;
    const expected = unusableKg * 1.215 - fuelKg * (CLUB_FUEL_ARM - 1.215);
    expect(ours.takeoff.momentKgM - club.takeoff.momentKgM).toBeCloseTo(expected, 9);
    expect(Math.abs(fuelKg * (CLUB_FUEL_ARM - 1.215))).toBeLessThan(0.06);
  });
});

/** Inputs of one phase. Landing slope: the club's input is the DOWNslope (positive). */
function phaseInput(i: ClubInput, phase: 'takeoff' | 'landing') {
  const s = phase === 'takeoff' ? '' : '_land';
  const g = (k: string) => (i as unknown as Record<string, number | string>)[k + s];
  return {
    elev: g('Elevation') as number,
    qnh: g('QNH') as number,
    oat: g('Temperature') as number,
    rwyHdg: parseInt(g('RWY') as string, 10) * 10,
    windDir: g('Wind_Dir') as number,
    windKt: g('Wind_Sp') as number,
    slopePct: phase === 'takeoff' ? i.RWY_Slope_TO : -i.RWY_Slope_LDG,
    rwycc: g('RWYCC') as number,
  };
}

/** The club's surface factor (RWYCC 6 = 1.0, RWYCC 5 = 1.15, grass 1.2/1.3/1.4) as a condition key. */
const withCondition = (t: PerformanceTables, f: number): PerformanceTables => ({ ...t, factors: { ...t.factors, runwayCondition: { ...t.factors.runwayCondition, club: f } } });

function distances(c: ClubCase, phase: 'takeoff' | 'landing', opts: { method: PerfMethod; clubWindBug: boolean }) {
  const p = phaseInput(c.input, phase);
  const a = aircraftOf(c.input.Registration);
  const w = windComponents(p.rwyHdg, p.windDir, p.windKt);
  const fn = phase === 'takeoff' ? takeoffDistances : landingDistances;
  return fn(withCondition(a.performance, p.rwycc), {
    // The club's masses (without SX-ASG's unusable fuel), to compare like with like.
    massKg: c.club[phase].massKg,
    pressureAltFt: pressureAltitudeFt(p.elev, p.qnh),
    oatC: p.oat,
    headwindKt: opts.clubWindBug ? Math.abs(w.headwindKt) : w.headwindKt,
    surface: 'club',
    slopePct: p.slopePct,
    method: opts.method,
  });
}

const PHASES = ['takeoff', 'landing'] as const;
const PERF_CASES = CASES.flatMap((c, n) => PHASES.map((ph) => [n, ph, c] as const));
const req = (c: ClubCase, ph: 'takeoff' | 'landing') => (ph === 'takeoff' ? { total: c.club.takeoff.todrM!, ground: c.club.takeoff.torrM! } : { total: c.club.landing.ldrM!, ground: c.club.landing.lrrM! });
const within = (ours: number, club: number, rel: number, abs: number) => Math.abs(ours - club) <= Math.max(abs, rel * club);

describe('club performance (MD 4.4)', () => {
  test.each(PERF_CASES)('case %i %s: PA, DA, wind components, condition factor', (_n, ph, c) => {
    const p = phaseInput(c.input, ph);
    const club = c.club[ph];
    // The club's own formulas, reproduced exactly (documents what it does).
    expect(p.elev + 27 * (1013 - p.qnh)).toBeCloseTo(club.pressureAltFt, 6);
    const clubDa = club.pressureAltFt + 120 * (p.oat - (15 - (2 * club.pressureAltFt) / 1000));
    expect(Math.abs(clubDa - club.densityAltFt)).toBeLessThanOrEqual(0.5 + 1e-9);
    // Ours (DIFFERENCES 3 and 4).
    const pa = pressureAltitudeFt(p.elev, p.qnh);
    const dPa = pa - club.pressureAltFt;
    expect(Math.abs(dPa)).toBeLessThanOrEqual(0.035 * Math.abs(27 * (1013 - p.qnh)) + 7);
    const da = densityAltitudeFt(pa, p.oat);
    expect(Math.abs(da - club.densityAltFt)).toBeLessThanOrEqual(1.24 * Math.abs(dPa) + 0.0024 * Math.abs(pa) + 1);
    // Wind: the club prints |components| to 0.1 kt (DIFFERENCE 5: the sign of the headwind).
    const w = windComponents(p.rwyHdg, p.windDir, p.windKt);
    expect(Math.abs(Math.abs(w.headwindKt) - club.headwindKt)).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(Math.abs(w.crosswindKt - club.crosswindKt)).toBeLessThanOrEqual(0.1 + 1e-9);
    // Condition and safety factors.
    const d = distances(c, ph, { method: 'da', clubWindBug: true });
    expect(Math.abs(d.factors.condition! - club.conditionFactor)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(d.factors.safety).toBe(club.safetyFactor);
  });

  test.each(PERF_CASES)('case %i %s: TODR/TORR or LDR/LRR, club method with the club wind (≤ 0.75 % or 1 m)', (_n, ph, c) => {
    const d = distances(c, ph, { method: 'da', clubWindBug: true });
    const club = req(c, ph);
    expect(within(d.requiredTotalM, club.total, 0.0075, 1), `total ${d.requiredTotalM.toFixed(1)} vs ${club.total}`).toBe(true);
    expect(within(d.requiredGroundM, club.ground, 0.0075, 1), `ground ${d.requiredGroundM.toFixed(1)} vs ${club.ground}`).toBe(true);
  });

  test('our real wind handling: same as the club with headwind or calm, longer with tailwind (club bug)', () => {
    let tail = 0;
    let headOrCalm = 0;
    for (const c of CASES) {
      for (const ph of PHASES) {
        const p = phaseInput(c.input, ph);
        const w = windComponents(p.rwyHdg, p.windDir, p.windKt);
        const ours = distances(c, ph, { method: 'da', clubWindBug: false });
        const asClub = distances(c, ph, { method: 'da', clubWindBug: true });
        const club = req(c, ph);
        if (w.headwindKt < -0.05) {
          tail++;
          // Club: tailwind credited as headwind. Ours: +10 % per 2 kt. Always longer.
          expect(ours.requiredTotalM).toBeGreaterThan(club.total);
          expect(ours.requiredGroundM).toBeGreaterThan(club.ground);
          expect(ours.requiredTotalM / asClub.requiredTotalM).toBeCloseTo((1 - 0.05 * w.headwindKt) / Math.max(0.5, 1 + (0.1 * w.headwindKt) / 5), 9);
        } else {
          headOrCalm++;
          expect(ours.requiredTotalM).toBeCloseTo(asClub.requiredTotalM, 9);
        }
      }
    }
    // The fixture exercises both.
    expect(tail).toBeGreaterThan(20);
    expect(headOrCalm).toBeGreaterThan(100);
  });

  // AFM method / club method, TODR or LDR, over the fixture (no tailwind):
  //   take-off, calm:      0.85–1.10  (heat: DA entry > PA + 10 %/15 °C; cold: club clamps DA at 0
  //                                    while the AFM gives no credit below standard)
  //   take-off, headwind:  0.72–1.10  (AFM 10/20 kt columns credit more than −10 %/5 kt)
  //   landing:             1.00–1.10  (same wind rule; PA + 10 %/15 °C ≥ DA entry in heat)
  // These bounds hold over the fixture (low aerodromes, mild temperatures). Outside it the AFM can be
  // much longer: at an elevated aerodrome on a cold day the club's DA falls well below PA (LGKZ,
  // 2165 ft, −10 °C: TODR AFM/club = 1.22). aerodromePerformance therefore computes both methods
  // for take-off as for landing and uses the longer (perfWindMethod.test.ts).
  test('AFM method vs the club: differs as explained (temperature model; take-off headwind columns)', () => {
    for (const c of CASES) {
      for (const ph of PHASES) {
        const p = phaseInput(c.input, ph);
        const w = windComponents(p.rwyHdg, p.windDir, p.windKt);
        if (w.headwindKt < -0.05) continue; // tailwind: see above
        const afm = distances(c, ph, { method: 'afm', clubWindBug: false });
        const clubM = distances(c, ph, { method: 'da', clubWindBug: false });
        const r = afm.requiredTotalM / clubM.requiredTotalM;
        if (ph === 'landing') {
          expect(r).toBeGreaterThanOrEqual(1 - 1e-9);
          expect(r).toBeLessThan(1.11);
        } else if (w.headwindKt < 0.05) {
          expect(r).toBeGreaterThan(0.84);
          expect(r).toBeLessThan(1.11);
        } else {
          expect(r).toBeGreaterThan(0.7);
          expect(r).toBeLessThan(1.1);
        }
      }
    }
  });
});
