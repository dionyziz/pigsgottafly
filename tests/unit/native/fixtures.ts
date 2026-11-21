// Fixtures of the native core's tests: GET /api/ref/bundle as the server sends it (the client's
// reference data without what only the website ships), an aircraft, a pilot and flights over Attica.
import cards from '../../../data/aircraft/compass-cards.json';
import reims from '../../../data/aircraft/reims-f172m.json';
import { aerodrome, REF, vfrPoint } from '../../../src/data/ref';
import type { CoreRef } from '../../../src/native/core';
import type {
  Aircraft,
  CompassCard,
  Flight,
  FlightCrew,
  FlightDoc,
  MetarTafResponse,
  PersonDetails,
  Pilot,
  RoutePoint,
} from '../../../src/shared';
import { aircraftFromTypeJson, DEFAULT_SETTINGS, emptyFlightDoc } from '../../../src/shared';
import type { Notam, NotamBriefing } from '../../../src/shared/briefing';

/** The API's bundle: no CTRs/ATZs, FIR, navaids or sunset tables (the core brings its own). */
export const API_REF: CoreRef = (() => {
  const { adAirspaces: _a, fir: _f, navaids: _n, ...rest } = REF;
  return JSON.parse(JSON.stringify(rest)) as CoreRef;
})();

export const T = (s: string) => Date.parse(s);
/** "Now" of the weather fixtures (tests/helpers/openMeteoGrid.ts). */
export const NOW = T('2026-11-15T13:36:00Z');
export const DATE = '2026-11-15';

let n = 0;
export const ad = (icao: string): RoutePoint => {
  const a = aerodrome(icao)!;
  return { uid: `u${n++}`, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
export const vfr = (id: string): RoutePoint => {
  const p = vfrPoint(id)!;
  return { uid: `u${n++}`, kind: 'vfr', refId: id, name: p.name, lat: p.lat, lon: p.lon };
};
export const custom = (name: string, lat: number, lon: number): RoutePoint => ({
  uid: `u${n++}`,
  kind: 'custom',
  refId: null,
  name,
  lat,
  lon,
});

export const AC: Aircraft = (() => {
  const a: Aircraft = {
    ...aircraftFromTypeJson(reims),
    id: 'ac1',
    registration: 'SX-ASV',
    cruiseTasKt: 92,
    patternTasKt: 80,
    compassCards: (cards as unknown as Record<string, CompassCard[]>)['SX-ASV'],
    created: 0,
    updated: 0,
  };
  a.fuel = { ...a.fuel, burnLph: 30, taxiAllowanceL: 4, usableL: 144 };
  return a;
})();

export const PILOT: Pilot = {
  id: 'p1',
  email: 'pilot@example.com',
  name: 'Pilot',
  picture: '',
  fullName: 'Test Pilot',
  phone: '+30 210 0000000',
  licenceNo: 'EL.FCL.1',
  homeAerodrome: 'LGTT',
  defaultAircraftId: 'ac1',
  settings: { ...DEFAULT_SETTINGS, reserveMin: 60 },
  created: 0,
  lastLogin: 0,
} as unknown as Pilot;

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
export const crew = (role: 'PIC' | 'PAX', seat: string, name: string, kg: number | null): FlightCrew => ({
  role,
  passengerId: role === 'PIC' ? null : 'p_' + seat,
  seat,
  snapshot: person(name, kg),
});

export function flight(route: RoutePoint[], extra: Partial<FlightDoc> = {}): Flight {
  const doc: FlightDoc = {
    ...emptyFlightDoc(DATE),
    blockOff: '14:00',
    taxiOutMin: 10,
    taxiInMin: 10,
    aircraftId: 'ac1',
    fobL: 120,
    route,
    ...extra,
  };
  doc.options = { ...doc.options, windModel: 'ecmwf_ifs025', ...extra.options };
  doc.crew = extra.crew ?? [crew('PIC', 'front-left', 'Test Pilot', 80), crew('PAX', 'rear-left', 'Robin Rider', 70)];
  return { ...doc, id: 'f1', version: 1, created: 0, updated: 0, opened: 0, deleted: false };
}

/** LGTT → DAPORI → KORINTHOS → LGMG. */
export const ROUTE = () => [ad('LGTT'), vfr('LGAV/DAPORI'), vfr('LGAV/KORINTHOS'), ad('LGMG')];

/** What GET /api/weather/metar answers for LGTT and LGMG. */
export const METAR_ANSWER: MetarTafResponse = {
  stations: {
    LGTT: {
      metar: 'METAR LGTT 151320Z 23008KT 9999 FEW030 18/08 Q1018',
      taf: 'TAF LGTT 151100Z 1512/1612 24010KT 9999 FEW030',
      observed: T('2026-11-15T13:20:00Z'),
    },
  },
  fetched: NOW,
};

export function notam(over: Partial<Notam> = {}): Notam {
  return {
    key: 'A1234/26',
    type: 'N',
    refers: null,
    itemA: ['LGGG'],
    fir: 'LGGG',
    qcode: 'QRTCA',
    subject: 'Temporary restricted area',
    condition: 'Activated',
    traffic: 'IV',
    purpose: 'BO',
    scope: 'W',
    lowerFt: 0,
    upperFt: 2500,
    center: { lat: 38.2, lon: 23.9 },
    radiusNm: 5,
    from: NOW - 3600e3,
    to: NOW + 6 * 3600e3,
    estimated: false,
    schedule: null,
    text: 'TEMPO RESTRICTED AREA ACTIVATED.',
    lowerText: null,
    upperText: null,
    raw: 'A1234/26 NOTAMN\nQ) LGGG/QRTCA/IV/BO/W/000/025/3812N02354E005\nE) TEMPO RESTRICTED AREA ACTIVATED.',
    relevant: true,
    reasons: ['on the route (leg 1)'],
    legIndex: 0,
    ...over,
  };
}

export function briefing(list: Notam[]): NotamBriefing {
  const relevantCount = list.filter((x) => x.relevant).length;
  return {
    status: 'ok',
    source: 'autorouter',
    message: null,
    fetched: NOW - 600e3,
    window: { from: NOW - 3600e3, to: NOW + 3 * 3600e3 },
    params: { maxAltFt: 4500, corridorNm: 10, marginMin: 60 },
    locations: ['LGTT', 'LGMG', 'LGGG'],
    notams: list,
    relevantCount,
    hiddenCount: list.length - relevantCount,
  };
}
