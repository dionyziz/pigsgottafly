// A fixture flight's navlog, as the export page builds it (NavlogExport.tsx): SX-ASV from LGTT over
// ten named points to LGMG (11 legs: two sheets), wind typed on every leg (no network).
import reims from '../../data/aircraft/reims-f172m.json';
import { atcInput, atcLegRelevance, generateAtcList } from '../../src/data/atc';
import { aerodrome, REF, SUN_TABLES } from '../../src/data/ref';
import { buildNavlogDocument, computeFlightNavlog } from '../../src/features/exports/navlog/model';
import {
  type Aircraft,
  aircraftFromTypeJson,
  DEFAULT_SETTINGS,
  emptyFlightDoc,
  type FlightDoc,
  legKey,
  type NavlogContent,
  type RoutePoint,
} from '../../src/shared';

export const NAVLOG_POINTS = [
  'ALPHA',
  'BRAVO',
  'CHARLIE',
  'DELTA',
  'ECHO',
  'FOXTROT',
  'GOLF',
  'HOTEL',
  'INDIA',
  'JULIETT',
];

const ad = (icao: string, uid: string): RoutePoint => {
  const a = aerodrome(icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};

export function fixtureNavlog(date = '2026-11-21'): NavlogContent {
  const route = [
    ad('LGTT', 'a'),
    ...NAVLOG_POINTS.map((name, i): RoutePoint => ({
      uid: `p${i}`,
      kind: 'custom',
      refId: null,
      name,
      lat: 38.05 + 0.08 * Math.sin(i),
      lon: 23.6 + 0.06 * i,
    })),
    ad('LGMG', 'b'),
  ];
  const legOverrides: FlightDoc['legOverrides'] = {};
  for (let i = 0; i + 1 < route.length; i++)
    legOverrides[legKey(route[i], route[i + 1])] = { windDirDeg: 300, windKt: 15, tempC: 10 };
  const doc: FlightDoc = {
    ...emptyFlightDoc(date),
    blockOff: '09:00',
    taxiOutMin: 15,
    taxiInMin: 15,
    aircraftId: 'ac1',
    route,
    legOverrides,
  };
  const aircraft: Aircraft = {
    ...aircraftFromTypeJson(reims),
    id: 'ac1',
    registration: 'SX-ASV',
    cruiseTasKt: 92,
    patternTasKt: 80,
    created: 0,
    updated: 0,
  };
  aircraft.fuel = { ...aircraft.fuel, burnLph: 30, taxiAllowanceL: 4, usableL: 144 };
  const settings = { ...DEFAULT_SETTINGS, taxiOutMin: 15, taxiInMin: 15, reserveMin: 60 };
  const computed = computeFlightNavlog({
    doc,
    aircraft,
    settings,
    weather: null,
    ref: { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes, sunTables: SUN_TABLES },
  });
  const gen = atcInput(doc.route, computed.altitudesFt, REF, 2);
  const out = buildNavlogDocument({
    doc,
    aircraft,
    computed,
    atc: generateAtcList(gen),
    atcRelevance: atcLegRelevance(gen),
    aerodromes: REF.aerodromes,
    weather: null,
    metar: null,
    nowMs: Date.parse('2026-11-15T12:00:00Z'),
  });
  return { sheets: out.sheets };
}
