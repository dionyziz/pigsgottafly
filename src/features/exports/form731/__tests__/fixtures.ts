// Fixture flight for the filled-form tests: made-up people, real reference aerodromes.
import { aircraftFromTypeJson, emptyFlightDoc, EMPTY_PERSON } from '../../../../shared';
import type { Aircraft, FlightCrew, FlightDoc, Pilot, RoutePoint } from '../../../../shared';
import { aerodrome } from '../../../../data/ref';
import f172m from '../../../../../data/aircraft/reims-f172m.json';

export const aircraft: Aircraft = {
  ...aircraftFromTypeJson(f172m),
  id: 'ac1',
  registration: 'SX-ABC',
  operator: 'Example Aeroclub',
  created: 0,
  updated: 0,
};

export const pilot: Pilot = {
  ...EMPTY_PERSON,
  id: 'p1',
  email: '',
  name: '',
  picture: '',
  licenceNo: '',
  homeAerodrome: 'LGTT',
  defaultAircraftId: null,
  settings: {
    taxiOutMin: null,
    taxiInMin: null,
    reserveMin: null,
    finalReserveMin: 0,
    windModel: 'best_match',
    enrouteAerodromeRadiusNm: 2,
  },
  created: 0,
  lastLogin: 0,
  fullName: 'Pat Pilot',
  phone: '+30 690 000 0000',
  idNumber: 'AB 123456',
  idType: 'ID',
  relation: 'MEMBER 0042',
};

export function ad(id: string, uid: string): RoutePoint {
  const a = aerodrome(id)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: a.icao || a.id, lat: a.lat, lon: a.lon };
}
export function vfr(name: string, uid: string): RoutePoint {
  return { uid, kind: 'vfr', refId: `LGAV/${name}`, name, lat: 38, lon: 23.6 };
}

export const pax = (
  name: string,
  seat: string,
  extra: Partial<FlightCrew['snapshot']> = {},
  id = name,
): FlightCrew => ({
  role: 'PAX',
  passengerId: id,
  seat,
  snapshot: { ...EMPTY_PERSON, fullName: name, ...extra },
});

export function flight(over: Partial<FlightDoc> = {}): FlightDoc {
  return {
    ...emptyFlightDoc('2026-11-21'),
    aircraftId: 'ac1',
    route: [ad('LGTT', 'a'), vfr('KEA', 'b'), ad('LGMG', 'c'), vfr('ELEFSINA', 'd'), ad('LGTT', 'e')],
    crew: [
      pax('Rear Person', 'rear-left', { phone: '+30 691', idNumber: 'X1', idType: 'PASSPORT', relation: 'FRIEND' }),
      { role: 'PIC', passengerId: null, seat: 'front-left', snapshot: { ...EMPTY_PERSON, fullName: 'Pat Pilot' } },
      pax('Front Person', 'front-right', { phone: '+30 692', idNumber: 'AK 1', idType: 'ID', relation: 'FAMILY' }),
    ],
    ...over,
  };
}
