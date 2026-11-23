// The editor's take-off & landing cards and the MD 4.4 export share one verdict (calc/perfVerdict):
// an overweight or extrapolated take-off must never read 'Fits' in the editor while the export says FAIL.
import { describe, expect, test } from 'vitest';

import { perfVerdict } from '../../../src/calc/perfVerdict';
import { aerodrome, REF, runwaysOf, SUN_TABLES } from '../../../src/data/ref';
import type { EndpointCalc } from '../../../src/features/editor/panels/calc';
import { endpointVerdict } from '../../../src/features/editor/panels/performance';
import { perfSheetModel } from '../../../src/features/exports/performance/model';
import { computeExportCalc } from '../../../src/features/exports/wb/exportCalc';
import {
  type Aircraft,
  emptyFlightDoc,
  type FlightCrew,
  type FlightDoc,
  type PersonDetails,
  type Pilot,
  type RoutePoint,
} from '../../../src/shared';
import { fleetSeed } from '../../../tools/build_seed';

const fleet = fleetSeed();
const asAircraft = (i: number, id: string): Aircraft => ({
  ...structuredClone(fleet[i]),
  id,
  created: 0,
  updated: 0,
});
const ASV = asAircraft(0, 'ac_asv');
const ASG = asAircraft(1, 'ac_asg');
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
let n = 0;
const adPoint = (icao: string): RoutePoint => {
  const a = aerodrome(icao)!;
  return { uid: `u${n++}`, kind: 'aerodrome', refId: a.id, name: a.icao!, lat: a.lat, lon: a.lon };
};
const baseRef = {
  aerodromes: REF.aerodromes,
  vfrPoints: REF.vfrPoints,
  vfrRoutes: REF.vfrRoutes,
  sunTables: SUN_TABLES,
  runwaysOf,
};
const four = [
  crew('PIC', 'front-left', 'A', 100),
  crew('PAX', 'front-right', 'B', 100),
  crew('PAX', 'rear-left', 'C', 100),
  crew('PAX', 'rear-right', 'D', 100),
];

function flight(aircraft: Aircraft, over: Partial<FlightDoc> = {}): FlightDoc {
  return {
    ...emptyFlightDoc('2026-11-21'),
    blockOff: '09:00',
    taxiOutMin: 15,
    taxiInMin: 15,
    aircraftId: aircraft.id,
    route: [adPoint('LGTT'), adPoint('LGMG'), adPoint('LGTT')],
    crew: [crew('PIC', 'front-left', 'Pat Pilot', 80), crew('PAX', 'rear-left', 'Robin Rider', 70)],
    baggageKg: {},
    fobL: 100,
    ...over,
  };
}
const calcOf = (doc: FlightDoc, aircraft: Aircraft) =>
  computeExportCalc({
    doc,
    aircraft,
    settings: pilot.settings,
    weather: null,
    metar: null,
    nowMs: Date.parse('2026-11-15T12:00:00Z'),
    ref: baseRef,
  });

/** The editor's endpoint, built from the export's (same perf, mass and aerodrome). */
function editorEndpoint(e: ReturnType<typeof calcOf>['departure']): EndpointCalc {
  return {
    phase: e.phase,
    aerodrome: e.aerodrome,
    timeMs: NaN,
    surface: null,
    reports: null,
    perf: e.perf,
    massKg: e.massKg,
    massSource: e.massSource,
    massReason: e.massReason ?? null,
  };
}

describe('editor take-off & landing verdict matches the MD 4.4 export', () => {
  const cases: [string, Aircraft, Partial<FlightDoc>][] = [
    ['SX-ASG, 4 × 100 kg, FOB 182 L (above MTOW, table extrapolated)', ASG, { crew: four, fobL: 182 }],
    ['SX-ASG, 4 × 100 kg, FOB 200 L', ASG, { crew: four, fobL: 200 }],
    ['SX-ASV, 4 × 100 kg, FOB 140 L', ASV, { crew: four, fobL: 140 }],
    ['SX-ASV, normal load', ASV, {}],
  ];
  test.each(cases)('%s', (_name, aircraft, over) => {
    const doc = flight(aircraft, over);
    const calc = calcOf(doc, aircraft);
    const sheet = perfSheetModel({ doc, aircraft, pilot, calc });
    for (const [e, block] of [
      [calc.departure, sheet.departure],
      [calc.arrival, sheet.arrival],
    ] as const) {
      const v = endpointVerdict(editorEndpoint(e), aircraft);
      expect(v.verdict).toBe(block.verdict);
      expect(v.text).toBe(block.verdictText);
    }
  });

  test('take-off above MTOW is No-go in the editor, with the excess named', () => {
    const doc = flight(ASG, { crew: four, fobL: 182 });
    const calc = calcOf(doc, ASG);
    expect(calc.departure.massKg!).toBeGreaterThan(ASG.massBalance.mtowKg);
    const v = endpointVerdict(editorEndpoint(calc.departure), ASG);
    expect(v.verdict).toBe('fail');
    expect(v.overMass?.limitName).toBe('MTOW');
    expect(v.overMass?.text).toMatch(/kg above the MTOW of 1043 kg/);
    expect(v.extrapolated).toBe(true);
  });
});

describe('perfVerdict', () => {
  const perf = (over: Record<string, unknown> = {}, dist: Record<string, unknown> = {}) =>
    ({
      runway: null,
      wind: { headwindKt: 0, crosswindKt: 0, crossFrom: '' },
      pressureAltFt: 0,
      densityAltFt: 0,
      isaDevC: 0,
      distances: { extrapolated: false, ...dist },
      availableGroundM: 1000,
      availableTotalM: 1000,
      marginM: 300,
      crosswindOk: true,
      crosswindGustKt: null,
      variableWind: false,
      tailwind: false,
      alternative: null,
      warnings: [],
      ...over,
    }) as never;
  const mb = { mtowKg: 1043, mlwKg: null };
  const base = { phase: 'takeoff' as const, massKg: 1000, massBalance: mb, hasAerodrome: true };
  test('pass when everything fits', () => expect(perfVerdict({ ...base, perf: perf() }).verdict).toBe('pass'));
  test('extrapolated is a fail even when the distances fit', () => {
    const v = perfVerdict({ ...base, perf: perf({}, { extrapolated: true }) });
    expect(v).toMatchObject({ verdict: 'fail', text: 'Outside the AFM table', extrapolated: true });
  });
  test('over MTOW wins over everything', () => {
    const v = perfVerdict({ ...base, massKg: 1100, perf: perf({ crosswindOk: false }) });
    expect(v.verdict).toBe('fail');
    expect(v.text).toBe('Take-off mass above MTOW');
    expect(v.overMass!.excessKg).toBeCloseTo(57, 6);
  });
  test('landing checks the MLW when published, else MTOW', () => {
    expect(
      perfVerdict({ ...base, phase: 'landing', massKg: 1040, massBalance: { mtowKg: 1043, mlwKg: 1000 }, perf: perf() })
        .text,
    ).toBe('Landing mass above MLW');
    expect(perfVerdict({ ...base, phase: 'landing', massKg: 1040, perf: perf() }).verdict).toBe('pass');
  });
  test('over-mass is reported even without performance figures', () => {
    expect(perfVerdict({ ...base, massKg: 1100, perf: null }).verdict).toBe('fail');
    expect(perfVerdict({ ...base, perf: null }).verdict).toBe('incomplete');
  });
  test('crosswind and distance failures; unknown declared distances', () => {
    expect(perfVerdict({ ...base, perf: perf({ crosswindOk: false }) }).text).toBe('Crosswind above the limit');
    expect(perfVerdict({ ...base, perf: perf({ marginM: -5 }) }).text).toBe('Take-off distance not available');
    expect(perfVerdict({ ...base, perf: perf({ marginM: null }) }).verdict).toBe('incomplete');
  });
});

describe('baggage above the placard is kept and flagged', () => {
  test('SX-ASG, 60 kg in baggage area 1 (max 54): station breach, W&B not ok', async () => {
    const { wbStatus } = await import('../../../src/calc/wb');
    const doc = flight(ASG, { baggageKg: { bag1: 60 } });
    const calc = calcOf(doc, ASG);
    expect(calc.wb).toBeTruthy();
    expect(calc.wb!.limitBreaches.some((b) => b.kind === 'station' && /60 kg exceeds the 54 kg/.test(b.text))).toBe(
      true,
    );
    expect(wbStatus(calc.wb!).loading).toBe(false);
  });
});
