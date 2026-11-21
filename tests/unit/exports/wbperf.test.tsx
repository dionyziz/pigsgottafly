// W&B (MD 4.3) and performance (MD 4.4) exports: the sheet models built from a flight, end to end
// through computeExportCalc (navlog → fuel → W&B → performance with METAR conditions), checked
// against the Aeroclub Mesogeion calculator answers (tests/fixtures/club-wbp-cases.json) and
// rendered to static markup.
//
// The club comparison runs every fixture case through the EXPORT path: a flight whose manifest,
// baggage and fuel on board are the case's inputs, a zero-length route (no trip fuel) with the
// case's block fuel as the taxi allowance (so landing fuel = FOB − BlockFuel, the club's rule),
// synthetic aerodromes with the case's elevation and runway (declared distances 3000 m, the case's
// slope), and a METAR at each end with the case's QNH, temperature and wind. The aircraft is the
// seeded one with the club's conventions (its empty mass, fuel arm 1.21539 m, no unusable fuel
// added), as in tests/unit/calc/club.test.ts, which documents those differences.
// Tolerances: masses and moments to 0.01 (as the calc test); TODR/TORR/LDR/LRR as printed (rounded
// UP to the metre) within 0.75 % or 2 m of the club's, on cases without tailwind (the club credits
// a tailwind as a headwind: a club bug, see the calc test). Cases where the block fuel exceeds the
// fuel on board are skipped for landing figures (the club lands with negative fuel; we use 0 L).
import fs from 'node:fs';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { magneticVariation } from '../../../src/calc';
import { REF, runwaysOf, SUN_TABLES } from '../../../src/data/ref';
import type { MetarTafResult, ParsedMetar } from '../../../src/data/weatherMetar';
import { perfSheetModel } from '../../../src/features/exports/performance/model';
import { PerfSheet } from '../../../src/features/exports/performance/PerformanceExport';
import { perfSpeeds } from '../../../src/features/exports/performance/speeds';
import { computeExportCalc, type ExportCalcInput } from '../../../src/features/exports/wb/exportCalc';
import { cgToMomentOutline, chartDomain, fmtArm, wbSheetModel } from '../../../src/features/exports/wb/model';
import { WbSheet } from '../../../src/features/exports/wb/WbExport';
import { wbPerfContent } from '../../../src/features/exports/wbperf/declaration';
import {
  type Aircraft,
  type AircraftInput,
  emptyFlightDoc,
  type FlightCrew,
  type FlightDoc,
  type PersonDetails,
  type Pilot,
  type RoutePoint,
} from '../../../src/shared';
import type { RefAerodrome, RefRunway } from '../../../src/shared/ref';
import { fleetSeed } from '../../../tools/build_seed';

// ---------------------------------------------------------------------------------------------
// fixtures

const [ASV_IN, ASG_IN] = fleetSeed();
const asAircraft = (a: AircraftInput, id: string): Aircraft => ({ ...structuredClone(a), id, created: 0, updated: 0 });
const ASV = asAircraft(ASV_IN, 'ac_asv');
const ASG = asAircraft(ASG_IN, 'ac_asg');

const person = (fullName: string, weightKg: number | null): PersonDetails => ({
  fullName,
  phone: '',
  dateOfBirth: null,
  weightKg,
  idNumber: '',
  idType: '',
  nationality: '',
  relation: '',
});
const crew = (role: 'PIC' | 'PAX', seat: string, name: string, kg: number | null): FlightCrew => ({
  role,
  passengerId: role === 'PIC' ? null : 'p_' + seat,
  seat,
  snapshot: person(name, kg),
});

const pilot: Pilot = {
  ...person('Pat Pilot', 80),
  id: 'pilot1',
  email: '',
  name: '',
  picture: '',
  licenceNo: '',
  homeAerodrome: 'LGTT',
  defaultAircraftId: null,
  settings: {
    taxiOutMin: 15,
    taxiInMin: 15,
    reserveMin: 60,
    finalReserveMin: 0,
    windModel: 'ecmwf_ifs025',
    enrouteAerodromeRadiusNm: 2,
  },
  created: 0,
  lastLogin: 0,
};

function adPoint(icao: string, uid: string): RoutePoint {
  const a = REF.aerodromes.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: a.icao!, lat: a.lat, lon: a.lon };
}

const baseRef = {
  aerodromes: REF.aerodromes,
  vfrPoints: REF.vfrPoints,
  vfrRoutes: REF.vfrRoutes,
  sunTables: SUN_TABLES,
  runwaysOf,
};

function flight(over: Partial<FlightDoc> = {}): FlightDoc {
  return {
    ...emptyFlightDoc('2026-11-21'),
    blockOff: '09:00',
    taxiOutMin: 15,
    taxiInMin: 15,
    aircraftId: ASV.id,
    route: [adPoint('LGTT', 'a'), adPoint('LGMG', 'b')],
    crew: [crew('PIC', 'front-left', 'Pat Pilot', 80), crew('PAX', 'rear-left', 'Robin Rider', 70)],
    baggageKg: { bag1: 10 },
    fobL: 100,
    ...over,
  };
}

const calcOf = (doc: FlightDoc, aircraft: Aircraft | null, extra: Partial<ExportCalcInput> = {}) =>
  computeExportCalc({
    doc,
    aircraft,
    settings: pilot.settings,
    weather: null,
    metar: null,
    nowMs: Date.parse('2026-11-15T12:00:00Z'),
    ref: baseRef,
    ...extra,
  });

// ---------------------------------------------------------------------------------------------
// W&B sheet

describe('W&B sheet (MD 4.3)', () => {
  test('fuel by type: one type as before, a mix shows each type and weighs Σ litres × density', () => {
    const one = flight();
    const m1 = wbSheetModel({ doc: one, aircraft: ASV, pilot, calc: calcOf(one, ASV), route: '' });
    expect(m1.fuelLabel).toBe('AVGAS 0.72 kg/L');
    expect(m1.lines.find((l) => l.key === 'fuel')!.note).toBe('100 L on board · max 144 L usable');
    const mix = flight({ fobL: 100, options: { ...flight().options, fuelL: { AVGAS: 60, MOGAS: 40 } } });
    const calc = calcOf(mix, ASV);
    const m = wbSheetModel({ doc: mix, aircraft: ASV, pilot, calc, route: '' });
    expect(m.fuelLabel).toBe('AVGAS 0.72 kg/L + MOGAS 0.75 kg/L');
    const fuel = m.lines.find((l) => l.key === 'fuel')!;
    expect(fuel.note).toBe('60 L AVGAS + 40 L MOGAS = 100 L on board · max 144 L usable');
    expect(fuel.massKg).toBeCloseTo(60 * 0.72 + 40 * 0.75, 9);
    // landing: the burn comes from the mix
    const rho = (60 * 0.72 + 40 * 0.75) / 100;
    expect(m.takeoff.massKg! - m.landing.massKg!).toBeCloseTo((calc.fuelTakeoffL - calc.fuelLandingL) * rho, 9);
    expect(renderToStaticMarkup(<WbSheet c={wbPerfContent(m, null)} />)).toContain('60 L AVGAS + 40 L MOGAS');
  });

  test('rows in MD 4.3 order with the people under their seat station; totals from the calculation', () => {
    const doc = flight();
    const calc = calcOf(doc, ASV);
    const m = wbSheetModel({ doc, aircraft: ASV, pilot, calc, route: 'LGTT – LGMG' });
    expect(m.lines.map((l) => l.key)).toEqual(['empty', 'fuel', 'front', 'rear', 'bag1', 'bag2']);
    const by = Object.fromEntries(m.lines.map((l) => [l.key, l]));
    expect(by.empty.massKg).toBeCloseTo(691.2, 9);
    expect(by.empty.momentKgM).toBeCloseTo(719.12, 9);
    expect(by.fuel.massKg).toBeCloseTo(72, 9); // 100 L AVGAS
    expect(by.fuel.armM).toBe(1.215);
    expect(by.front.people).toEqual([{ role: 'PIC', name: 'Pat Pilot', seat: 'Front left', massKg: 80 }]);
    expect(by.rear.people.map((p) => p.name)).toEqual(['Robin Rider']);
    expect(by.rear.momentKgM).toBeCloseTo(70 * 1.85, 9);
    expect(by.bag1.massKg).toBe(10);
    expect(by.bag2.massKg).toBe(0);
    expect(by.bag2.armM).toBe(3.12);
    // take-off = sum of the rows
    const sumM = m.lines.reduce((s, l) => s + (l.massKg ?? 0), 0);
    const sumMom = m.lines.reduce((s, l) => s + (l.momentKgM ?? 0), 0);
    expect(m.takeoff.massKg).toBeCloseTo(sumM, 9);
    expect(m.takeoff.momentKgM).toBeCloseTo(sumMom, 9);
    expect(m.takeoff.massKg).toBeCloseTo(691.2 + 80 + 70 + 10 + 72, 9);
    // landing = take-off − (taxi allowance + trip) at the fuel arm
    const fuel = calc.computed.fuel!;
    expect(calc.fuelBurnL).toBe(fuel.taxiL + fuel.tripL);
    expect(m.burn.massKg).toBeCloseTo(-(fuel.taxiL + fuel.tripL) * 0.72, 9);
    expect(m.landing.massKg! - m.takeoff.massKg!).toBeCloseTo(m.burn.massKg!, 9);
    expect(m.landing.momentKgM! - m.takeoff.momentKgM!).toBeCloseTo(m.burn.massKg! * 1.215, 9);
    expect(m.checks.map((c) => [c.phase, c.ok])).toEqual([
      ['takeoff', true],
      ['landing', true],
    ]);
    expect(m.verdict).toBe('pass');
    expect(m.registration).toBe('SX-ASV');
    expect(m.date).toBe('2026-11-21');
    expect(m.envelopes.map((e) => e.category)).toEqual(['normal', 'utility']);
  });

  test('SX-ASG adds its unusable fuel (weighed with empty tanks)', () => {
    const doc = flight({ aircraftId: ASG.id });
    const m = wbSheetModel({ doc, aircraft: ASG, pilot, calc: calcOf(doc, ASG), route: '' });
    expect(m.lines.map((l) => l.key)).toEqual(['empty', 'unusable', 'fuel', 'front', 'rear', 'bag1', 'bag2']);
    expect(m.lines[1].massKg).toBeCloseTo(15 * 0.72, 9);
  });

  test('fails outside the envelope and over MTOW; flags an overloaded baggage area', () => {
    const doc = flight({
      crew: [
        crew('PIC', 'front-left', 'A', 110),
        crew('PAX', 'front-right', 'B', 110),
        crew('PAX', 'rear-left', 'C', 100),
        crew('PAX', 'rear-right', 'D', 100),
      ],
      baggageKg: { bag2: 30 },
      fobL: 144,
    });
    const m = wbSheetModel({ doc, aircraft: ASV, pilot, calc: calcOf(doc, ASV), route: '' });
    expect(m.verdict).toBe('fail');
    expect(m.takeoff.over).toBe(true);
    expect(m.lines.find((l) => l.key === 'bag2')!.over).toBe(true);
    expect(m.checks.find((c) => c.phase === 'takeoff')!.ok).toBe(false);
    expect(m.warnings.join(' ')).toMatch(/MTOW/);
  });

  test('a combined baggage limit breach fails the sheet although the point is in the envelope', () => {
    const doc = flight({ crew: [crew('PIC', 'front-left', 'A', 80)], baggageKg: { bag1: 40, bag2: 20 }, fobL: 100 });
    const calc = calcOf(doc, ASV);
    const m = wbSheetModel({ doc, aircraft: ASV, pilot, calc, route: '' });
    expect(calc.wb!.normal.takeoff).toMatchObject({ inEnvelope: true, massOk: true });
    expect(m.lines.some((l) => l.over)).toBe(false); // each area within its own maximum
    expect(m.warnings.join(' ')).toMatch(/combined 54 kg limit/);
    expect(m.verdict).toBe('fail');
    expect(m.verdictText).toMatch(/Outside limits/);
  });

  test('utility category is checked against the utility envelope', () => {
    const doc = flight({
      options: { ...flight().options, category: 'utility' },
      crew: [crew('PIC', 'front-left', 'A', 80)],
      baggageKg: {},
      fobL: 80,
    });
    const m = wbSheetModel({ doc, aircraft: ASV, pilot, calc: calcOf(doc, ASV), route: '' });
    expect(m.categoryLabel).toBe('Utility');
    // SX-ASV solo with 80 L: CG 1.043 m, inside normal but aft of the utility limit (1.03 m)
    const to = m.checks.find((c) => c.phase === 'takeoff')!;
    expect(to.point.armM).toBeCloseTo(1.043, 3);
    expect(to.normal.inEnvelope).toBe(true);
    expect(to.utility!.inEnvelope).toBe(false);
    expect(to.ok).toBe(false);
    expect(m.verdict).toBe('fail');
    expect(m.verdictText).toMatch(/utility/);
    const heavy = flight({ options: { ...flight().options, category: 'utility' } }); // rear pax + baggage
    const h = wbSheetModel({ doc: heavy, aircraft: ASV, pilot, calc: calcOf(heavy, ASV), route: '' });
    expect(h.warnings.join(' ')).toMatch(/Utility category: no rear passengers/);
  });

  test('missing weights and missing aircraft are incomplete, never pass', () => {
    const doc = flight({ crew: [crew('PIC', 'front-left', 'A', null)] });
    const m = wbSheetModel({ doc, aircraft: ASV, pilot, calc: calcOf(doc, ASV), route: '' });
    expect(m.verdict).toBe('incomplete');
    expect(m.lines.find((l) => l.key === 'front')!.people[0].massKg).toBeNull();
    const none = wbSheetModel({
      doc,
      aircraft: null,
      pilot,
      calc: calcOf({ ...doc, aircraftId: null }, null),
      route: '',
    });
    expect(none.verdict).toBe('incomplete');
    expect(none.lines).toEqual([]);
  });

  test('chart geometry: CG envelope mapped to moments; domain covers envelopes and points', () => {
    const outline = cgToMomentOutline(
      [
        [0.89, 600],
        [0.89, 885],
        [0.98, 1043],
        [1.2, 1043],
        [1.2, 600],
      ],
      4,
    );
    expect(outline[0]).toEqual([0.89 * 600, 600]);
    // the sloped forward limit is curved in moment space: its midpoint is not the chord's midpoint
    const mid = outline.find(([, m]) => Math.abs(m - (885 + 1043) / 2) < 1e-9)!;
    expect(mid[0]).toBeCloseTo(((0.89 + 0.98) / 2) * ((885 + 1043) / 2), 9);
    expect(mid[0]).not.toBeCloseTo((0.89 * 885 + 0.98 * 1043) / 2, 1);
    const d = chartDomain(
      [
        {
          outline: ASV.massBalance.envelopes.normal.momentPolygon!,
        },
      ],
      [{ massKg: 1100, momentKgM: 1400 }],
    );
    expect(d.x0).toBeLessThanOrEqual(600);
    expect(d.x1).toBeGreaterThanOrEqual(1400);
    expect(d.y1).toBeGreaterThanOrEqual(1100);
    expect(d.xTicks[1] - d.xTicks[0]).toBe(100);
  });

  test('renders the sheet with the table, the chart and the verdict', () => {
    const doc = flight();
    const m = wbSheetModel({ doc, aircraft: ASV, pilot, calc: calcOf(doc, ASV), route: 'LGTT – LGMG' });
    const html = renderToStaticMarkup(<WbSheet c={wbPerfContent(m, null)} />);
    expect(html).toContain('LOADING SHEET');
    expect(html).toContain('Robin Rider');
    expect(html).toContain('<svg');
    expect(html).toContain('NORMAL CATEGORY');
    expect(html).toContain('UTILITY CATEGORY');
    expect(html).toContain('PASS');
    // the aircraft's operator is printed (its name is the pilot's data); no club wording otherwise
    expect(m.operator).toBe(ASV.operator.trim());
    expect(html).toContain(`data-testid="wb-operator">${ASV.operator.trim()}<`);
    expect(html.split(ASV.operator.trim()).join('')).not.toMatch(/MD 4\.\d|club/i);
    expect(fmtArm(0.94)).toBe('0.94');
    expect(fmtArm(1.215)).toBe('1.215');
  });
});

// ---------------------------------------------------------------------------------------------
// Performance sheet

describe('performance sheet (MD 4.4)', () => {
  test('without weather: ISA, calm, QNH 1013 assumed and said so; distances computed', () => {
    const doc = flight();
    const calc = calcOf(doc, ASV);
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc });
    const row = (b: typeof m.departure, k: string) => b.rows.find((r) => r.key === k)!;
    expect(row(m.departure, 'aerodrome').value).toMatch(/^LGTT /);
    expect(row(m.arrival, 'aerodrome').value).toMatch(/^LGMG /);
    expect(row(m.departure, 'qnh').status).toBe('warn');
    expect(row(m.departure, 'wind').value).toBe('Not known');
    expect(row(m.departure, 'mass').value).toBe(`${calc.wb!.takeoff.massKg.toFixed(1)} kg`);
    expect(row(m.arrival, 'mass').value).toBe(`${calc.wb!.landing.massKg.toFixed(1)} kg`);
    expect(row(m.departure, 'todr').value).toMatch(/^\d+ m$/);
    expect(row(m.arrival, 'ldr').value).toMatch(/^\d+ m$/);
    expect(row(m.departure, 'safety').value).toBe('1.33');
    expect(row(m.arrival, 'safety').value).toBe('1.43');
    expect(m.departure.weatherSource).toMatch(/ISA/);
    expect(m.departure.verdict).toBe('pass');
    expect(m.verdict).toBe('pass');
    expect(m.departure.time).toBe('Take-off 09:15Z');
  });

  test('speeds and flaps from the AFM data', () => {
    const s = perfSpeeds(ASV, 1043, 0);
    expect([s.vrKt, s.vxKt, s.vyKt, s.glideKt, s.vappKt]).toEqual([59, 65, 78, 70, 60]);
    expect(perfSpeeds(ASV, 975, 0).vrKt).toBe(57); // 55 + 4 × 75/143
    expect(perfSpeeds(ASV, 900, 5000).vyKt).toBe(73);
    expect([s.flapsTakeoff, s.flapsLanding]).toEqual(['0°', '40°']);
    expect(perfSpeeds({ ...ASV, makeModel: 'Piper PA-28' }, 1000, 0).vxKt).toBeNull();
  });

  test('a person with no weight: performance uses MTOW (not the too-light W&B mass) and says why', () => {
    const doc = flight({
      crew: [crew('PIC', 'front-left', 'Pat Pilot', 80), crew('PAX', 'rear-left', 'Robin Rider', null)],
    });
    const calc = calcOf(doc, ASV);
    expect(calc.missingWeights).toEqual(['Robin Rider']);
    expect(calc.wb).not.toBeNull();
    for (const e of [calc.departure, calc.arrival]) {
      expect(e.massKg).toBe(ASV.massBalance.mtowKg);
      expect(e.massSource).toBe('mtow');
      expect(e.massReason).toBe('weight-missing');
    }
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc });
    const mass = m.departure.rows.find((r) => r.key === 'mass')!;
    expect(mass.status).toBe('warn');
    expect(mass.note).toMatch(/weight missing/);
    // complete manifest: W&B mass again
    const full = calcOf(flight(), ASV);
    expect(full.missingWeights).toEqual([]);
    expect(full.departure.massSource).toBe('wb');
    expect(full.departure.massReason).toBeNull();
  });

  test('a route end that is not an aerodrome is incomplete', () => {
    const doc = flight({
      route: [adPoint('LGTT', 'a'), { uid: 'z', kind: 'custom', refId: null, name: 'ZOFRI', lat: 37.0, lon: 25.0 }],
    });
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc: calcOf(doc, ASV) });
    expect(m.arrival.verdict).toBe('incomplete');
    expect(m.arrival.warnings.join(' ')).toMatch(/not an aerodrome/);
    expect(m.verdict).toBe('incomplete');
  });

  test('renders both blocks', () => {
    const doc = flight();
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc: calcOf(doc, ASV) });
    const html = renderToStaticMarkup(<PerfSheet c={wbPerfContent(null, m)} />);
    for (const t of [
      'PERFORMANCE LOG',
      'T.O.D.A.',
      'T.O.R.R.',
      'L.D.A.',
      'L.R.R.',
      'Vglide',
      'Vapr',
      'Short dry grass',
    ])
      expect(html).toContain(t);
    expect(html).not.toMatch(/MD 4\.\d|club/i);
  });

  test('both sheets carry the PIC e-signature on their SIGN line', () => {
    const doc = flight();
    const calc = calcOf(doc, ASV);
    const s = { name: 'Pat Pilot', signedAt: Date.UTC(2026, 10, 15, 16, 51) };
    const perf = renderToStaticMarkup(
      <PerfSheet c={wbPerfContent(null, perfSheetModel({ doc, aircraft: ASV, pilot, calc }))} signature={s} />,
    );
    const wb = renderToStaticMarkup(
      <WbSheet
        c={wbPerfContent(wbSheetModel({ doc, aircraft: ASV, pilot, calc, route: 'LGTT – LGMG' }), null)}
        signature={s}
      />,
    );
    for (const html of [perf, wb]) {
      expect(html).toMatch(
        /class="xp-sigline" data-field="signature"><span class="xp-pic-signature"><span class="pgf-signature-wrap" data-testid="signature">/,
      );
      expect(html).toContain('>P. Pilot<');
      expect(html).toContain('signed 2026-11-15 16:51Z');
    }
    expect(
      renderToStaticMarkup(<PerfSheet c={wbPerfContent(null, perfSheetModel({ doc, aircraft: ASV, pilot, calc }))} />),
    ).not.toContain('data-testid="signature"');
  });
});

// ---------------------------------------------------------------------------------------------
// End to end against the club calculator

interface ClubInput {
  Registration: 'SXASV' | 'SXASG';
  PIC_FPax: number;
  RPax: number;
  Baggage1: number;
  Baggage2: number;
  AVGAS: number;
  MOGAS: number;
  Elevation: number;
  QNH: number;
  Temperature: number;
  RWY: string;
  Wind_Dir: number;
  Wind_Sp: number;
  RWY_Slope_TO: number;
  RWYCC: number;
  BlockFuel: number;
  Elevation_land: number;
  QNH_land: number;
  Temperature_land: number;
  RWY_land: string;
  Wind_Dir_land: number;
  Wind_Sp_land: number;
  RWY_Slope_LDG: number;
  RWYCC_land: number;
}
interface ClubPhase {
  pressureAltFt: number;
  densityAltFt: number;
  headwindKt: number;
  crosswindKt: number;
  massKg: number;
  conditionFactor: number;
  safetyFactor: number;
  todrM?: number;
  torrM?: number;
  ldrM?: number;
  lrrM?: number;
}
interface ClubCase {
  input: ClubInput;
  club: {
    wbRows: Record<string, [number, number, number]>;
    total: [number, number];
    takeoff: ClubPhase;
    landing: ClubPhase;
  };
}
const CASES = (
  JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/club-wbp-cases.json'), 'utf8')) as {
    cases: ClubCase[];
  }
).cases;

const CLUB_FUEL_ARM = 1.21539;
const CLUB_EMPTY_KG = { SXASV: 691.0, SXASG: 692.0 };
const LAT = 38.1;
const LON = 23.78;
const DATE = '2026-11-15';
const T_MS = Date.parse(`${DATE}T10:00:00Z`);

function clubSetup(c: ClubCase) {
  const i = c.input;
  // fuel on board per type, as the club calculator takes it (both aircraft approve AVGAS and MOGAS)
  const litres = i.AVGAS + i.MOGAS;
  const base = i.Registration === 'SXASV' ? ASV : ASG;
  const ac: Aircraft = structuredClone(base);
  ac.massBalance.emptyMassKg = CLUB_EMPTY_KG[i.Registration];
  ac.massBalance.stations = ac.massBalance.stations.map((s) => (s.kind === 'fuel' ? { ...s, armM: CLUB_FUEL_ARM } : s));
  ac.fuel = { ...ac.fuel, unusableIncludedInEmptyMass: true, usableL: 500, taxiAllowanceL: i.BlockFuel };
  ac.performance = structuredClone(ac.performance);
  ac.performance.factors.runwayCondition = {
    ...ac.performance.factors.runwayCondition,
    'club dep': i.RWYCC,
    'club arr': i.RWYCC_land,
  };

  const ad = (id: string, elev: number, rwy: string): RefAerodrome => ({
    id,
    icao: id,
    name: id,
    lat: LAT,
    lon: LON,
    elevFt: elev,
    runways: [rwy],
    freqs: [],
    zones: [],
    water: false,
    source: '',
    notes: '',
  });
  const rw = (id: string, des: string, slopePct: number): RefRunway => ({
    aerodromeId: id,
    designator: des,
    reciprocal: '',
    headingMagDeg: parseInt(des, 10) * 10,
    headingTrueDeg: null,
    lengthM: 3000,
    widthM: 30,
    surface: 'ASPH',
    toraM: 3000,
    todaM: 3000,
    asdaM: 3000,
    ldaM: 3000,
    slopePct,
    thresholdElevFt: null,
  });
  const dep = ad('LGXA', i.Elevation, i.RWY);
  const arr = ad('LGXB', i.Elevation_land, i.RWY_land);
  const runways: Record<string, RefRunway[]> = {
    LGXA: [rw('LGXA', i.RWY, i.RWY_Slope_TO)],
    LGXB: [rw('LGXB', i.RWY_land, -i.RWY_Slope_LDG)],
  };
  const variation = magneticVariation(LAT, LON, DATE);
  const metar = (station: string, qnh: number, oat: number, dirMag: number, kt: number): ParsedMetar => ({
    raw: `METAR ${station} 151000Z TEST`,
    type: 'METAR',
    station,
    timeMs: T_MS,
    auto: false,
    nil: false,
    wind: {
      dirDeg: kt > 0 ? dirMag + variation : null,
      speedKt: kt,
      gustKt: null,
      varFrom: null,
      varTo: null,
      variable: false,
      calm: !(kt > 0),
    },
    cavok: true,
    visibilityM: 9999,
    clouds: [],
    skyClear: null,
    weather: [],
    tempC: oat,
    dewC: null,
    qnhHpa: qnh,
  });
  const metars: MetarTafResult = {
    status: 'ok',
    message: '',
    source: 'aviationweather.gov',
    fetchedMs: T_MS,
    stations: {
      LGXA: { metar: metar('LGXA', i.QNH, i.Temperature, i.Wind_Dir, i.Wind_Sp), taf: null, observedMs: T_MS },
      LGXB: {
        metar: metar('LGXB', i.QNH_land, i.Temperature_land, i.Wind_Dir_land, i.Wind_Sp_land),
        taf: null,
        observedMs: T_MS,
      },
    },
  };
  const people: FlightCrew[] = [crew('PIC', 'front-left', 'PIC', i.PIC_FPax)];
  if (i.RPax > 0) people.push(crew('PAX', 'rear-left', 'PAX', i.RPax));
  const doc: FlightDoc = {
    ...emptyFlightDoc(DATE),
    blockOff: '09:50',
    taxiOutMin: 10,
    taxiInMin: 10,
    aircraftId: ac.id,
    // zero-length leg: no trip fuel, so landing fuel = FOB − BlockFuel (the taxi allowance here)
    route: [
      { uid: 'd', kind: 'aerodrome', refId: 'LGXA', name: 'LGXA', lat: LAT, lon: LON },
      { uid: 'a', kind: 'aerodrome', refId: 'LGXB', name: 'LGXB', lat: LAT, lon: LON },
    ],
    crew: people,
    baggageKg: { bag1: i.Baggage1, bag2: i.Baggage2 },
    fobL: litres,
    options: {
      ...emptyFlightDoc(DATE).options,
      departureRunway: i.RWY,
      arrivalRunway: i.RWY_land,
      departureSurface: 'club dep',
      arrivalSurface: 'club arr',
      fuelL: { AVGAS: i.AVGAS, MOGAS: i.MOGAS },
    },
  };
  const calc = computeExportCalc({
    doc,
    aircraft: ac,
    settings: pilot.settings,
    weather: null,
    metar: metars,
    nowMs: T_MS + 5 * 60000,
    ref: { ...baseRef, aerodromes: [dep, arr], runwaysOf: (id) => runways[id] ?? [] },
  });
  return { doc, ac, calc, litres, density: (i.AVGAS * 0.72 + i.MOGAS * 0.75) / litres };
}

const CLUB_ROW: Record<string, string> = {
  front: 'PIC and Front Passenger',
  rear: 'Rear Passengers',
  bag1: 'Baggage Area 1',
  bag2: 'Baggage Area 2',
};
const within = (ours: number, club: number) => Math.abs(ours - club) <= Math.max(2, 0.0075 * club);
const compared = { takeoff: 0, landing: 0, maxRel: 0 };
const track = (ours: number, club: number) => {
  compared.maxRel = Math.max(compared.maxRel, Math.abs(ours - club) / club);
};

describe('exports vs the club calculator (90 cases, export path end to end)', () => {
  test('fixture loaded', () => expect(CASES).toHaveLength(90));

  test.each(CASES.map((c, n) => [n, c] as const))('case %i: loading sheet rows and totals', (_n, c) => {
    const { doc, ac, calc, litres } = clubSetup(c);
    expect(calc.computed.navlog.totals.tripFuel).toBe(0);
    const m = wbSheetModel({ doc, aircraft: ac, pilot, calc, route: '' });
    const by = Object.fromEntries(m.lines.map((l) => [l.key, l]));
    const rows = c.club.wbRows;
    expect(by.empty.momentKgM).toBeCloseTo(rows['Corrected / Licenced Empty Weight'][2], 2);
    for (const [k, name] of Object.entries(CLUB_ROW)) {
      expect(by[k].massKg).toBeCloseTo(rows[name][0], 2);
      expect(Math.abs(by[k].momentKgM! - rows[name][2])).toBeLessThanOrEqual(0.0051);
    }
    expect(by.fuel.massKg).toBeCloseTo(rows['Usuable Fuel'][0], 2);
    expect(Math.abs(by.fuel.momentKgM! - rows['Usuable Fuel'][2])).toBeLessThanOrEqual(0.0051);
    expect(m.takeoff.massKg!).toBeCloseTo(c.club.total[0], 2);
    expect(Math.abs(m.takeoff.momentKgM! - c.club.total[1])).toBeLessThanOrEqual(0.015);
    if (litres >= c.input.BlockFuel) expect(m.landing.massKg!).toBeCloseTo(c.club.landing.massKg, 2);
    else expect(m.landing.massKg!).toBeCloseTo(m.zeroFuel!.massKg, 9);
  });

  test.each(CASES.map((c, n) => [n, c] as const))('case %i: performance log figures', (_n, c) => {
    const { doc, ac, calc, litres } = clubSetup(c);
    const m = perfSheetModel({ doc, aircraft: ac, pilot, calc });
    const val = (b: typeof m.departure, k: string) => parseFloat(b.rows.find((r) => r.key === k)!.value);
    for (const [b, ph] of [
      [m.departure, 'takeoff'],
      [m.arrival, 'landing'],
    ] as const) {
      const club = c.club[ph];
      const e = ph === 'takeoff' ? calc.departure : calc.arrival;
      expect(e.conditions?.source).toBe('metar');
      expect(b.rows.find((r) => r.key === 'rwy')!.value).toBe(ph === 'takeoff' ? c.input.RWY : c.input.RWY_land);
      expect(val(b, 'safety')).toBe(club.safetyFactor);
      expect(Math.abs(val(b, 'cond') - club.conditionFactor)).toBeLessThanOrEqual(0.005 + 1e-9);
      // PA/DA: ISA barometric PA vs the club's 27 ft/hPa (calc test DIFFERENCES 3/4)
      expect(Math.abs(val(b, 'pa') - club.pressureAltFt)).toBeLessThanOrEqual(
        0.035 * Math.abs(27 * (1013 - (ph === 'takeoff' ? c.input.QNH : c.input.QNH_land))) + 8,
      );
      const hw = e.perf!.wind.headwindKt;
      expect(Math.abs(Math.abs(hw) - club.headwindKt)).toBeLessThanOrEqual(0.15);
      expect(Math.abs(e.perf!.wind.crosswindKt - club.crosswindKt)).toBeLessThanOrEqual(0.15);
      if (hw < -0.05) continue; // club bug: tailwind credited as headwind
      if (ph === 'landing' && litres < c.input.BlockFuel) continue; // club lands with negative fuel
      compared[ph]++;
      if (ph === 'takeoff') {
        // Take-off: as for landing below, both methods are computed and the longer TODR printed
        // (the AFM one on hot days at PA + 10 %/15 °C, and on cold days, where the club's DA entry
        // falls below PA); the club-method figures must match the club calculator.
        const p = e.perf!;
        const clubD = p.distances!.method === 'da' ? p.distances! : p.alternative!;
        expect(clubD.method).toBe('da');
        const clubTodr = Math.ceil(clubD.requiredTotalM - 1e-9),
          clubTorr = Math.ceil(clubD.requiredGroundM - 1e-9);
        track(clubTodr, club.todrM!);
        expect(within(clubTodr, club.todrM!), `TODR (club method) ${clubTodr} vs ${club.todrM}`).toBe(true);
        expect(within(clubTorr, club.torrM!), `TORR (club method) ${clubTorr} vs ${club.torrM}`).toBe(true);
        const longer = Math.max(p.distances!.requiredTotalM, p.alternative!.requiredTotalM);
        expect(val(b, 'todr')).toBe(Math.ceil(longer - 1e-9));
        expect(val(b, 'todr')).toBeGreaterThanOrEqual(club.todrM! - 1);
        expect(val(b, 'todr-alt')).toBe(Math.ceil(p.alternative!.requiredTotalM - 1e-9));
      } else {
        // Landing: aerodromePerformance computes the club method AND the AFM method (table at PA,
        // +10 %/15 °C) and prints the longer LDR (the AFM one on hot days, by up to ~9 % over this
        // fixture). The club-method figures must still match the club; the printed LDR is the
        // larger of the two and is never shorter than the club's.
        const p = e.perf!;
        const clubD = p.distances!.method === 'da' ? p.distances! : p.alternative!;
        expect(clubD.method).toBe('da');
        const clubLdr = Math.ceil(clubD.requiredTotalM - 1e-9),
          clubLrr = Math.ceil(clubD.requiredGroundM - 1e-9);
        track(clubLdr, club.ldrM!);
        expect(within(clubLdr, club.ldrM!), `LDR (club method) ${clubLdr} vs ${club.ldrM}`).toBe(true);
        expect(within(clubLrr, club.lrrM!), `LRR (club method) ${clubLrr} vs ${club.lrrM}`).toBe(true);
        const longer = Math.max(p.distances!.requiredTotalM, p.alternative!.requiredTotalM);
        expect(val(b, 'ldr')).toBe(Math.ceil(longer - 1e-9));
        expect(val(b, 'ldr')).toBeGreaterThanOrEqual(club.ldrM! - 1);
        if (p.distances!.method === 'afm') expect(val(b, 'ldr-alt')).toBe(clubLdr);
      }
    }
  });

  test('the comparison covered most cases', () => {
    expect(compared.takeoff).toBeGreaterThan(50);
    expect(compared.landing).toBeGreaterThan(50);
    expect(compared.maxRel).toBeLessThan(0.0075);
  });
});
