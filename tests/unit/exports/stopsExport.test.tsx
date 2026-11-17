// An intermediate full stop in the W&B (MD 4.3) and performance (MD 4.4) exports: LGTT → LGSY
// (stop 10 min) → LGTT. The landing at Skyros and the take-off from Skyros get their own
// performance blocks (Skyros weather, runways and the sector masses) on a page of their own, and
// the loading sheet checks the mass and CG at the stop. Masses are checked against a sum by hand
// (zero-fuel mass + fuel left at the stop × 0.72 kg/L), not against the code under test.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { magneticVariation, pressureAltitudeFt } from '../../../src/calc';
import { REF, runwaysOf, SUN_TABLES } from '../../../src/data/ref';
import type { MetarTafResult, ParsedMetar } from '../../../src/data/weatherMetar';
import { perfSheetModel } from '../../../src/features/exports/performance/model';
import { PerfSheet } from '../../../src/features/exports/performance/PerformanceExport';
import { computeExportCalc } from '../../../src/features/exports/wb/exportCalc';
import { wbSheetModel } from '../../../src/features/exports/wb/model';
import { WbSheet } from '../../../src/features/exports/wb/WbExport';
import {
  type Aircraft,
  CIRCUIT_MIN,
  emptyFlightDoc,
  type FlightCrew,
  type FlightDoc,
  type PersonDetails,
  type Pilot,
  type RoutePoint,
} from '../../../src/shared';
import { fleetSeed } from '../../../tools/build_seed';

const [ASV_IN] = fleetSeed();
const ASV: Aircraft = { ...structuredClone(ASV_IN), id: 'ac_asv', created: 0, updated: 0 };
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
const crew = (role: 'PIC' | 'PAX', seat: string, name: string, kg: number): FlightCrew => ({
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
const ad = (icao: string, uid: string): RoutePoint => {
  const a = REF.aerodromes.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: a.icao!, lat: a.lat, lon: a.lon };
};
const ref = {
  aerodromes: REF.aerodromes,
  vfrPoints: REF.vfrPoints,
  vfrRoutes: REF.vfrRoutes,
  sunTables: SUN_TABLES,
  runwaysOf,
};

const DATE = '2026-11-21';
const T_MS = Date.parse(`${DATE}T10:00:00Z`);
const metar = (station: string, qnh: number, oat: number, dirTrue: number, kt: number): ParsedMetar => ({
  raw: `METAR ${station} 211000Z TEST`,
  type: 'METAR',
  station,
  timeMs: T_MS,
  auto: false,
  nil: false,
  wind: { dirDeg: dirTrue, speedKt: kt, gustKt: null, varFrom: null, varTo: null, variable: false, calm: false },
  cavok: true,
  visibilityM: 9999,
  clouds: [],
  skyClear: null,
  weather: [],
  tempC: oat,
  dewC: null,
  qnhHpa: qnh,
});
const METARS: MetarTafResult = {
  status: 'ok',
  message: '',
  source: 'aviationweather.gov',
  fetchedMs: T_MS,
  stations: {
    LGTT: { metar: metar('LGTT', 1015, 15, 30, 8), taf: null, observedMs: T_MS },
    // Skyros: northerly, warm, low QNH: runway 35 into the wind
    LGSY: { metar: metar('LGSY', 1003, 24, 355, 12), taf: null, observedMs: T_MS },
  },
};

function flight(over: Partial<FlightDoc> = {}): FlightDoc {
  const route = [ad('LGTT', 'a'), ad('LGSY', 'sky'), ad('LGTT', 'b')];
  const base = emptyFlightDoc(DATE);
  return {
    ...base,
    blockOff: '09:00',
    taxiOutMin: 15,
    taxiInMin: 15,
    aircraftId: ASV.id,
    route,
    crew: [
      crew('PIC', 'front-left', 'Pat Pilot', 80),
      crew('PAX', 'front-right', 'Robin Rider', 75),
      crew('PAX', 'rear-left', 'Sam Sitter', 70),
    ],
    baggageKg: { bag1: 10 },
    fobL: 120,
    options: { ...base.options, aerodromeRequests: [{ pointUid: 'sky', kind: 'stop', stopMin: 10 }] },
    ...over,
  };
}
const calcOf = (doc: FlightDoc) =>
  computeExportCalc({
    doc,
    aircraft: ASV,
    settings: pilot.settings,
    weather: null,
    metar: METARS,
    nowMs: T_MS + 5 * 60000,
    ref,
  });

describe('intermediate stop at LGSY', () => {
  test('the export calculation has the landing at and the take-off from Skyros, with the sector masses and Skyros weather', () => {
    const doc = flight();
    const c = calcOf(doc);
    const legs = c.computed.navlog.legs;
    expect(legs).toHaveLength(2);
    expect(c.sectors).toHaveLength(2);
    expect(c.stops).toHaveLength(1);
    const st = c.stops[0];
    expect(st.pointIndex).toBe(1);
    expect(st.landing.aerodrome?.icao).toBe('LGSY');
    expect(st.takeoff.aerodrome?.icao).toBe('LGSY');
    // times: landing at the end of leg 1, take-off 10 min later
    expect(st.landing.timeMin).toBeCloseTo(legs[0].endMin, 9);
    expect(st.takeoff.timeMin).toBeCloseTo(legs[0].endMin + 10, 9);
    // Skyros METAR, not the departure's
    expect(st.landing.conditions?.source).toBe('metar');
    expect(st.landing.qnhHpa).toBe(1003);
    expect(st.landing.oatC).toBe(24);
    expect(st.landing.perf!.pressureAltFt).toBeCloseTo(
      pressureAltitudeFt(REF.aerodromes.find((a) => a.icao === 'LGSY')!.elevFt!, 1003),
      6,
    );
    expect(st.landing.variationDeg).toBeCloseTo(
      magneticVariation(st.landing.aerodrome!.lat, st.landing.aerodrome!.lon, DATE),
      9,
    );
    // runway into the northerly wind
    expect(st.landing.perf!.runway!.designator).toBe('35');
    expect(st.takeoff.perf!.runway!.designator).toBe('35');
    expect(st.landing.perf!.distances!.requiredTotalM).toBeGreaterThan(0);
    // masses by hand: empty + people + baggage + fuel left at the stop
    const empty = ASV.massBalance.emptyMassKg;
    const zfw = empty + 80 + 75 + 70 + 10;
    const fuelAtStop = 120 - 4 - (legs[0].fuel ?? 0);
    expect(st.before.fuelLandingL).toBe(fuelAtStop);
    expect(st.landing.massKg).toBeCloseTo(zfw + fuelAtStop * 0.72, 6);
    expect(st.takeoff.massKg).toBeCloseTo(zfw + fuelAtStop * 0.72, 6);
    expect(st.landing.massSource).toBe('wb');
    // the final landing still uses FOB − 2 allowances − trip
    expect(c.fuelLandingL).toBe(120 - 8 - (legs[0].fuel ?? 0) - (legs[1].fuel ?? 0));
    expect(c.arrival.massKg).toBeCloseTo(zfw + c.fuelLandingL * 0.72, 6);
  });

  test('runway and surface chosen for the stop are used there only', () => {
    const base = flight();
    const doc = flight({
      options: {
        ...base.options,
        aerodromeRequests: [
          { pointUid: 'sky', kind: 'stop', stopMin: 10, takeoffRunway: '17', surface: 'short dry grass' },
        ],
      },
    });
    const st = calcOf(doc).stops[0];
    expect(st.landing.perf!.runway!.designator).toBe('35');
    expect(st.takeoff.perf!.runway!.designator).toBe('17');
    expect(st.takeoff.perf!.wind.headwindKt).toBeLessThan(0); // tailwind on 17
    expect(st.landing.surface).toBe('short dry grass');
    expect(st.landing.perf!.distances!.factors.surface).toBeGreaterThan(1);
    expect(calcOf(doc).departure.surface).toBeNull();
  });

  test('a touch-and-go then a stop at Skyros: each with its runway, the circuit between them; a page per sector', () => {
    const base = flight();
    const doc = flight({
      options: {
        ...base.options,
        aerodromeRequests: [
          { pointUid: 'sky', kind: 'touch-and-go', landingRunway: '17' },
          { pointUid: 'sky', kind: 'stop', stopMin: 10, takeoffRunway: '17' },
        ],
      },
    });
    const c = calcOf(doc);
    const legs = c.computed.navlog.legs;
    const circuit = c.computed.navlog.circuits[0];
    expect(circuit).toMatchObject({ afterLeg: 0, startMin: legs[0].endMin, endMin: legs[0].endMin + CIRCUIT_MIN });
    expect(c.sectors.map((x) => x.ends)).toEqual(['touch-and-go', 'stop', 'destination']);
    expect(c.stops.map((x) => [x.pointIndex, x.kind])).toEqual([
      [1, 'touch-and-go'],
      [1, 'stop'],
    ]);
    const [tg, st] = c.stops;
    expect(tg.landing.timeMin).toBeCloseTo(legs[0].endMin, 9);
    expect(tg.takeoff.timeMin).toBeCloseTo(legs[0].endMin, 9);
    expect(st.landing.timeMin).toBeCloseTo(legs[0].endMin + CIRCUIT_MIN, 9);
    expect(st.takeoff.timeMin).toBeCloseTo(legs[0].endMin + CIRCUIT_MIN + 10, 9);
    // each request's runway choice applies to its own landing / take-off
    expect(tg.landing.perf!.runway!.designator).toBe('17');
    expect(tg.takeoff.perf!.runway!.designator).toBe('35');
    expect(st.landing.perf!.runway!.designator).toBe('35');
    expect(st.takeoff.perf!.runway!.designator).toBe('17');
    // fuel: an allowance at the departure and one after the stop, plus the circuit
    expect(st.before.fuelLandingL).toBe(120 - 4 - (legs[0].fuel ?? 0) - circuit.fuel);
    expect(c.fuelLandingL).toBe(120 - 8 - (legs[0].fuel ?? 0) - (legs[1].fuel ?? 0) - circuit.fuel);
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc: c });
    expect(m.pages.map((p) => p.label)).toEqual(['LGTT → LGSY', 'LGSY → LGSY', 'LGSY → LGTT']);
  });

  test('a stop at the departure and at the destination: circuit sectors at both ends, each end with its performance and W&B', () => {
    const base = flight();
    const doc = flight({
      route: [ad('LGTT', 'a'), ad('LGSY', 'sky')],
      options: {
        ...base.options,
        aerodromeRequests: [
          { pointUid: 'a', kind: 'stop', stopMin: 10 },
          { pointUid: 'sky', kind: 'stop', stopMin: 20 },
        ],
      },
    });
    const c = calcOf(doc);
    const nav = c.computed.navlog;
    const leg = nav.legs[0];
    expect(nav.times.takeoffMin).toBe(9 * 60 + 15);
    expect(leg.startMin).toBeCloseTo(9 * 60 + 15 + CIRCUIT_MIN + 10, 9);
    expect(nav.times.landingMin).toBeCloseTo(leg.endMin + 20 + CIRCUIT_MIN, 9);
    expect(c.sectors.map((x) => [x.fromPoint, x.toPoint, x.ends])).toEqual([
      [0, 0, 'stop'],
      [0, 1, 'stop'],
      [1, 1, 'destination'],
    ]);
    expect(c.stops.map((x) => [x.pointIndex, x.kind])).toEqual([
      [0, 'stop'],
      [1, 'stop'],
    ]);
    const [dep, dest] = c.stops;
    expect(dep.landing.timeMin).toBeCloseTo(9 * 60 + 15 + CIRCUIT_MIN, 9);
    expect(dep.takeoff.timeMin).toBeCloseTo(leg.startMin, 9);
    expect(dest.landing.timeMin).toBeCloseTo(leg.endMin, 9);
    expect(dest.takeoff.timeMin).toBeCloseTo(leg.endMin + 20, 9);
    expect(dep.landing.aerodrome!.icao).toBe('LGTT');
    expect(dest.takeoff.aerodrome!.icao).toBe('LGSY');
    expect(dest.takeoff.perf!.runway!.designator).toBe('35');
    // three take-offs: three allowances, plus both circuits
    const circuitsL = nav.circuits.reduce((s, x) => s + x.fuel, 0);
    expect(nav.circuits).toHaveLength(2);
    expect(c.fuelLandingL).toBe(120 - 3 * 4 - (leg.fuel ?? 0) - circuitsL);
    expect(c.sectors[2].fuelLandingL).toBe(c.fuelLandingL);
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc: c });
    expect(m.pages.map((p) => p.label)).toEqual(['LGTT → LGTT', 'LGTT → LGSY', 'LGSY → LGSY']);
    const wb = wbSheetModel({ doc, aircraft: ASV, pilot, calc: c, route: 'LGTT – LGSY' });
    expect(wb.checks.map((x) => [x.phase, x.label])).toEqual([
      ['takeoff', 'Take-off'],
      ['stop', 'Stop LGTT'],
      ['stop', 'Stop LGSY'],
      ['landing', 'Landing'],
    ]);
  });

  test('performance export: one page per sector, the Skyros landing and take-off in their own blocks', () => {
    const doc = flight();
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc: calcOf(doc) });
    expect(m.stops).toHaveLength(1);
    expect(m.pages).toHaveLength(2);
    expect(m.pages[0].takeoff).toBe(m.departure);
    expect(m.pages[0].landing).toBe(m.stops[0].landing);
    expect(m.pages[1].takeoff).toBe(m.stops[0].takeoff);
    expect(m.pages[1].landing).toBe(m.arrival);
    expect(m.pages.map((p) => p.label)).toEqual(['LGTT → LGSY', 'LGSY → LGTT']);
    const row = (b: (typeof m.pages)[number]['takeoff'], k: string) => b.rows.find((r) => r.key === k)!;
    expect(row(m.stops[0].landing, 'aerodrome').value).toMatch(/^LGSY /);
    expect(row(m.stops[0].landing, 'lda').value).toMatch(/^\d+ m$/);
    expect(row(m.stops[0].takeoff, 'toda').value).toMatch(/^\d+ m$/);
    expect(row(m.stops[0].landing, 'qnh').value).toBe('1003 hPa');
    expect(m.stops[0].landing.title).toBe('Landing at stop');
    expect(m.stops[0].takeoff.title).toBe('Take-off from stop');
    expect(m.verdict).toBe('pass');
    expect(m.verdictText).toMatch(/All 4 take-offs and landings/);
    const html = m.pages.map((pg, i) => renderToStaticMarkup(<PerfSheet m={m} page={pg} pageNo={i + 1} />)).join('');
    expect(html).toContain('Sector 1 of 2');
    expect(html).toContain('Landing at stop');
    expect(html).toContain('Take-off from stop');
  });

  test('a stop failure fails the performance log (crosswind at Skyros above the limit)', () => {
    const doc = flight();
    const windy: MetarTafResult = {
      ...METARS,
      stations: { ...METARS.stations, LGSY: { metar: metar('LGSY', 1003, 24, 265, 30), taf: null, observedMs: T_MS } },
    };
    const c = computeExportCalc({
      doc,
      aircraft: ASV,
      settings: pilot.settings,
      weather: null,
      metar: windy,
      nowMs: T_MS + 5 * 60000,
      ref,
    });
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc: c });
    expect(m.departure.verdict).toBe('pass');
    expect(m.arrival.verdict).toBe('pass');
    expect(m.stops[0].landing.verdict).toBe('fail');
    expect(m.verdict).toBe('fail');
    expect(m.verdictText).toMatch(/^Landing at stop LGSY: crosswind/);
  });

  test('W&B export: a check and a total at the stop, the fuel used per sector, the stop on the chart', () => {
    const doc = flight();
    const c = calcOf(doc);
    const m = wbSheetModel({ doc, aircraft: ASV, pilot, calc: c, route: 'LGTT – LGSY – LGTT' });
    expect(m.checks.map((x) => [x.phase, x.label])).toEqual([
      ['takeoff', 'Take-off'],
      ['stop', 'Stop LGSY'],
      ['landing', 'Landing'],
    ]);
    expect(m.totals.map((l) => l.key)).toEqual(['to', 'burn0', 'stop0', 'burnLast', 'ldg']);
    const by = Object.fromEntries(m.totals.map((l) => [l.key, l]));
    const fuelAtStop = c.stops[0].before.fuelLandingL;
    expect(by.stop0.massKg).toBeCloseTo(c.wb!.zeroFuel.massKg + fuelAtStop * 0.72, 6);
    // each sector's fuel used adds up from the take-off total to the landing total
    expect(by.to.massKg! + by.burn0.massKg! - by.stop0.massKg!).toBeCloseTo(0, 9);
    expect(by.stop0.massKg! + by.burnLast.massKg! - by.ldg.massKg!).toBeCloseTo(0, 9);
    expect(by.burn0.note).toBe(`${120 - fuelAtStop} L`);
    expect(m.verdict).toBe('pass');
    const html = renderToStaticMarkup(<WbSheet m={m} />);
    expect(html).toContain('Total at LGSY (stop)');
    expect(html).toContain('wb-pt-stop0');
  });

  test('a stop above the maximum landing mass fails the loading sheet', () => {
    const doc = flight();
    const ac: Aircraft = structuredClone(ASV);
    const c0 = calcOf(doc);
    // an MLW between the stop mass and the final landing mass: only the stop is above it
    ac.massBalance.mlwKg = Math.floor((c0.stops[0].landing.massKg! + c0.arrival.massKg!) / 2);
    const c = computeExportCalc({
      doc,
      aircraft: ac,
      settings: pilot.settings,
      weather: null,
      metar: METARS,
      nowMs: T_MS + 5 * 60000,
      ref,
    });
    const m = wbSheetModel({ doc, aircraft: ac, pilot, calc: c, route: '' });
    expect(m.checks.find((x) => x.phase === 'landing')!.ok).toBe(true);
    expect(m.checks.find((x) => x.phase === 'stop')!.ok).toBe(false);
    expect(m.totals.find((l) => l.key === 'stop0')!.over).toBe(true);
    expect(m.warnings.join(' ')).toMatch(/At LGSY \(stop\): Landing mass .* exceeds the maximum landing mass/);
    expect(m.verdict).toBe('fail');
    const p = perfSheetModel({ doc, aircraft: ac, pilot, calc: c });
    expect(p.stops[0].landing.verdict).toBe('fail');
    expect(p.stops[0].landing.verdictText).toMatch(/above MLW/);
  });

  test('without a stop nothing changes: one page, three totals', () => {
    const base = flight();
    const doc = flight({ options: { ...base.options, aerodromeRequests: [] } });
    const c = calcOf(doc);
    expect(c.stops).toEqual([]);
    expect(c.sectors).toHaveLength(1);
    const m = perfSheetModel({ doc, aircraft: ASV, pilot, calc: c });
    expect(m.pages).toHaveLength(1);
    expect(m.pages[0].label).toBe('');
    const w = wbSheetModel({ doc, aircraft: ASV, pilot, calc: c, route: '' });
    expect(w.totals.map((l) => l.key)).toEqual(['to', 'burn', 'ldg']);
    expect(w.checks.map((x) => x.phase)).toEqual(['takeoff', 'landing']);
  });
});
