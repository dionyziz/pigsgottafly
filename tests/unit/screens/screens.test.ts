// Pure helpers of the lobby and the account list pages.
import { describe, expect, it } from 'vitest';

import { resolveAerodrome, searchAerodromes } from '../../../src/data/ref';
import { alternateCode, alternatesFrom } from '../../../src/features/editor/panels/fplOptions';
import { addPicToCrew, picSeat } from '../../../src/features/editor/panels/manifest';
import { flightSearchText, matchesQuery, passengerNames, splitFlights } from '../../../src/features/lobby/format';
import { passengerInputOf, personForm, validatePerson } from '../../../src/features/passengers/person';
import { formOf, type ProfileForm, toUpdate, validateProfile } from '../../../src/features/profile/ProfilePage';
import { formatDms, formatIcao, normaliseWaypointName, parseLatLon } from '../../../src/features/waypoints/coords';
import { validateWaypoint } from '../../../src/features/waypoints/WaypointsPage';
import {
  EMPTY_PERSON,
  EMPTY_SUMMARY,
  type FlightCrew,
  type FlightListItem,
  type Pilot,
  type Waypoint,
} from '../../../src/shared';
import { ageOn, daysBetween, fmtDate, relativeDay, utcToLocal } from '../../../src/shared/date';
import { fmtDuration } from '../../../src/shared/format';
import { DEFAULT_MAP_LAYERS } from '../../../src/shared/mapLayers';

const item = (
  id: string,
  date: string,
  extra: Partial<FlightListItem['summary']> = {},
  updated = 0,
  points: string[] = [],
  passengers: string[] = [],
): FlightListItem => ({
  id,
  date,
  aircraftId: null,
  version: 1,
  created: 0,
  updated,
  opened: 0,
  deleted: false,
  filingStatus: null,
  summary: { ...EMPTY_SUMMARY, date, ...extra },
  points,
  passengers,
});

describe('lobby format', () => {
  it('formats dates and relative days', () => {
    expect(fmtDate('2026-11-15')).toBe('2026-11-15');
    expect(fmtDate('nope')).toBe('');
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2);
    expect(relativeDay('2026-11-15', '2026-11-15')).toBe('today');
    expect(relativeDay('2026-11-16', '2026-11-15')).toBe('tomorrow');
    expect(relativeDay('2026-11-20', '2026-11-15')).toBe('in 5 days');
    expect(relativeDay('2026-11-12', '2026-11-15')).toBe('3 days ago');
    expect(relativeDay('2027-03-01', '2026-11-15')).toBe('');
    expect(fmtDuration(95)).toBe('1h35');
    expect(fmtDuration(10)).toBe('0h10');
    expect(fmtDuration(null)).toBe('');
  });
  it('converts UTC block start to a local clock time', () => {
    expect(utcToLocal('2026-07-01', '09:30', 'Europe/Athens')).toBe('12:30'); // EEST, UTC+3
    expect(utcToLocal('2026-12-01', '09:30', 'Europe/Athens')).toBe('11:30'); // EET, UTC+2
    expect(utcToLocal('2026-12-01', '', 'Europe/Athens')).toBe('');
  });
  it('lists both sections newest first (an undated draft at the top)', () => {
    const rows = [
      item('a', '2026-11-10'),
      item('b', '2026-11-20', { blockOff: '10:00' }),
      item('c', '2026-11-15'),
      item('d', '2026-11-01'),
      item('e', '2026-11-20', { blockOff: '08:00' }),
      item('f', ''),
    ];
    const { upcoming, past } = splitFlights(rows, '2026-11-15');
    expect(upcoming.map((r) => r.id)).toEqual(['f', 'b', 'e', 'c']);
    expect(past.map((r) => r.id)).toEqual(['a', 'd']);
  });
  it('searches title, aerodromes, aircraft and date', () => {
    const r = item('a', '2026-11-15', { title: 'LGTT → LGMG → LGTT', from: 'LGTT', to: 'LGTT', aircraft: 'SX-ASV' });
    const t = flightSearchText(r);
    expect(matchesQuery(t, 'lgmg')).toBe(true);
    expect(matchesQuery(t, 'sxasv')).toBe(true);
    expect(matchesQuery(t, 'asv 2026-11')).toBe(true);
    expect(matchesQuery(t, '2026-11-15')).toBe(true);
    expect(matchesQuery(t, 'lgav')).toBe(false);
    expect(matchesQuery(t, '')).toBe(true);
  });
  it('searches every point along the route, not only the title and the ends', () => {
    const r = item('a', '2026-11-15', { title: 'Skyros day trip', from: 'LGTT', to: 'LGTT', aircraft: 'SX-ASV' }, 0, [
      'LGTT',
      'KEA',
      'LGSY',
      'ZOFRI',
      'LGTT',
    ]);
    const t = flightSearchText(r);
    expect(matchesQuery(t, 'LGSY')).toBe(true);
    expect(matchesQuery(t, 'zofri skyros')).toBe(true);
    expect(matchesQuery(t, 'LGMG')).toBe(false);
  });
  it('lists and searches the passengers', () => {
    const r = item('a', '2026-11-15', { title: 'Skyros day trip' }, 0, [], ['Jane Doe', 'Nikos P.']);
    expect(passengerNames(r)).toBe('Jane Doe, Nikos P.');
    expect(passengerNames(item('b', '2026-11-15'))).toBe('');
    expect(matchesQuery(flightSearchText(r), 'nikos')).toBe(true);
    expect(matchesQuery(flightSearchText(r), 'maria')).toBe(false);
  });
  it('computes ages', () => {
    expect(ageOn('1990-11-16', '2026-11-15')).toBe(35);
    expect(ageOn('1990-11-15', '2026-11-15')).toBe(36);
    expect(ageOn(null, '2026-11-15')).toBeNull();
  });
});

describe('waypoint coordinates', () => {
  const near = (p: { lat: number; lon: number } | null, lat: number, lon: number) => {
    expect(p).not.toBeNull();
    expect(p!.lat).toBeCloseTo(lat, 5);
    expect(p!.lon).toBeCloseTo(lon, 5);
  };
  it('parses decimal degrees', () => {
    near(parseLatLon('37.9083, 23.7261'), 37.9083, 23.7261);
    near(parseLatLon('37.9083 23.7261'), 37.9083, 23.7261);
    near(parseLatLon('-12.5 -45.25'), -12.5, -45.25);
    near(parseLatLon('37.9083N 23.7261E'), 37.9083, 23.7261);
    near(parseLatLon('N37.9083 E23.7261'), 37.9083, 23.7261);
    near(parseLatLon('37.5S 23.25W'), -37.5, -23.25);
  });
  it('parses degrees, minutes and seconds', () => {
    near(parseLatLon(`37°54'30"N 023°43'34"E`), 37 + 54 / 60 + 30 / 3600, 23 + 43 / 60 + 34 / 3600);
    near(parseLatLon('37 54 30 N 23 43 34 E'), 37 + 54 / 60 + 30 / 3600, 23 + 43 / 60 + 34 / 3600);
    near(parseLatLon(`37°54.5'N 23°43.6'E`), 37 + 54.5 / 60, 23 + 43.6 / 60);
    near(parseLatLon('37 54.5, 23 43.6'), 37 + 54.5 / 60, 23 + 43.6 / 60);
  });
  it('parses the ICAO compact form', () => {
    near(parseLatLon('375430N 0234334E'), 37 + 54 / 60 + 30 / 3600, 23 + 43 / 60 + 34 / 3600);
    near(parseLatLon('375430N0234334E'), 37 + 54 / 60 + 30 / 3600, 23 + 43 / 60 + 34 / 3600);
    near(parseLatLon('3754N 02343E'), 37 + 54 / 60, 23 + 43 / 60);
  });
  it('rejects nonsense', () => {
    for (const s of ['', 'ZOFRI', '95, 20', '37 61 00 N 23 00 00 E', '37.5', '1 2 3', 'abc def'])
      expect(parseLatLon(s), s).toBeNull();
  });
  it('formats and round-trips', () => {
    const p = { lat: 37.908333, lon: 23.726111 };
    expect(formatDms(p)).toBe(`37°54'30"N 023°43'34"E`);
    expect(formatIcao(p)).toBe('375430N0234334E');
    near(parseLatLon(formatDms(p)), p.lat, p.lon);
    near(parseLatLon(formatIcao(p)), p.lat, p.lon);
    expect(formatDms({ lat: -0.5, lon: -1.25 })).toBe(`00°30'00"S 001°15'00"W`);
    expect(normaliseWaypointName('  zofri  point ')).toBe('ZOFRI POINT');
  });
});

describe('aerodrome picker', () => {
  it('resolves ICAO codes and finds by prefix or name', () => {
    expect(resolveAerodrome('lgtt')?.icao).toBe('LGTT');
    expect(resolveAerodrome('XXXX')).toBeUndefined();
    expect(resolveAerodrome('')).toBeUndefined();
    expect(searchAerodromes('LGT')[0].icao).toMatch(/^LGT/);
    expect(searchAerodromes('tatoi').some((a) => a.icao === 'LGTT')).toBe(true);
    expect(searchAerodromes('')).toEqual([]);
  });
});

describe('profile form', () => {
  const base: ProfileForm = {
    fullName: ' Test Pilot ',
    phone: '+30 690',
    licenceNo: '',
    nationality: 'greek',
    relation: 'M123',
    dateOfBirth: '',
    weightKg: 80,
    idType: '',
    idNumber: '',
    notes: '',
    homeAerodrome: 'lgtt',
    defaultAircraftId: '',
    defaultAlternate: '',
    taxiOutMin: null,
    taxiInMin: 12,
    reserveMin: null,
    finalReserveMin: null,
    circuitMin: null,
    enrouteAerodromeRadiusNm: null,
    mapLayers: null,
  };
  it('sends the full profile, without the wind model', () => {
    const u = toUpdate(base);
    expect(u).toMatchObject({ fullName: 'Test Pilot', phone: '+30 690', homeAerodrome: 'LGTT' });
    expect(u.nationality).toBe('GREEK');
    expect(u.weightKg).toBe(80);
    expect(u.defaultAircraftId).toBeNull();
    // taxi times are not made up: what the pilot left empty stays empty
    expect(u.settings).toMatchObject({ taxiOutMin: null, taxiInMin: 12, reserveMin: null });
    expect(u.settings).toMatchObject({ finalReserveMin: 0, enrouteAerodromeRadiusNm: 2, defaultAlternate: null });
    expect(u.settings).not.toHaveProperty('windModel');
    expect(toUpdate({ ...base, defaultAlternate: 'lgav' }).settings?.defaultAlternate).toBe('LGAV');
    // map layers for new flights: sent once chosen
    expect(u.settings).not.toHaveProperty('mapLayers');
    const layers = { ...DEFAULT_MAP_LAYERS, vfrRoutes: false };
    expect(toUpdate({ ...base, mapLayers: layers }).settings?.mapLayers).toEqual(layers);
    expect(() => toUpdate({ ...base, defaultAlternate: 'nowhere' })).toThrow(/not an aerodrome/);
  });
  it('an account with only its e-mail can be saved: nothing is required', () => {
    const empty = {
      ...base,
      fullName: '',
      phone: '',
      homeAerodrome: '',
      nationality: '',
      relation: '',
      weightKg: null,
    };
    expect(validateProfile(empty)).toEqual([]);
    expect(toUpdate(empty)).toMatchObject({ fullName: '', phone: '', homeAerodrome: null });
  });
  it('rejects an unknown aerodrome and bad numbers', () => {
    expect(() => toUpdate({ ...base, homeAerodrome: 'ZZZZ' })).toThrow(/not an aerodrome/);
    expect(() => toUpdate({ ...base, taxiOutMin: -5 })).toThrow(/Taxi out/);
    expect(() => toUpdate({ ...base, weightKg: 400 })).toThrow(/Weight/);
  });
  it('names every bad field, the person fields first', () => {
    const issues = validateProfile({
      ...base,
      weightKg: 400,
      homeAerodrome: 'ZZZZ',
      defaultAlternate: 'nowhere',
      reserveMin: 9999,
    });
    expect(issues.map((i) => i.field)).toEqual(['weightKg', 'homeAerodrome', 'reserveMin', 'defaultAlternate']);
  });
  it('fills the form from the pilot', () => {
    const f = formOf({
      ...EMPTY_PERSON,
      id: 'p',
      email: '',
      fullName: 'A B',
      licenceNo: 'L1',
      homeAerodrome: 'LGTT',
      defaultAircraftId: null,
      settings: {
        taxiOutMin: 10,
        taxiInMin: null,
        reserveMin: 45,
        finalReserveMin: 0,
        enrouteAerodromeRadiusNm: 2,
        defaultAlternate: 'LGAV',
      },
    } as unknown as Pilot);
    expect(f).toMatchObject({
      fullName: 'A B',
      licenceNo: 'L1',
      homeAerodrome: 'LGTT',
      taxiOutMin: 10,
      taxiInMin: null,
      reserveMin: 45,
      defaultAlternate: 'LGAV',
      weightKg: null,
    });
  });
});

describe('passenger form', () => {
  it('normalises input and validates', () => {
    const f = {
      ...personForm(null, 'Jane  Doe'),
      email: ' jane@example.com ',
      weightKg: 62.5,
      nationality: 'greek',
      dateOfBirth: '1990-01-02',
    };
    expect(passengerInputOf(f)).toMatchObject({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      weightKg: 62.5,
      nationality: 'GREEK',
      dateOfBirth: '1990-01-02',
      phone: '',
    });
    expect(passengerInputOf({ ...f, weightKg: null }).weightKg).toBeNull();
    expect(() => passengerInputOf({ ...f, fullName: '' })).toThrow(/name/);
    expect(() => passengerInputOf({ ...f, weightKg: 400 })).toThrow(/Weight/);
    expect(() => passengerInputOf({ ...f, dateOfBirth: '2999-01-01' })).toThrow(/future/);
    expect(() => passengerInputOf({ ...f, email: '' })).toThrow(/e-mail/);
    expect(() => passengerInputOf({ ...f, email: 'jane@' })).toThrow(/Not an e-mail/);
  });
  it('reports each problem under its field', () => {
    const f = { ...personForm(null), dateOfBirth: '2026-02-30', weightKg: 0 };
    expect(validatePerson(f, { today: '2026-11-16' })).toEqual([
      { field: 'fullName', message: 'Enter the full name' },
      { field: 'email', message: 'Enter the e-mail address' },
      { field: 'dateOfBirth', message: 'Not a valid date' },
      { field: 'weightKg', message: 'Weight must be 1–300 kg' },
    ]);
    // the pilot needs a phone, a passenger an e-mail
    expect(validatePerson({ ...personForm(null, 'X') }, { pilot: true }).map((i) => i.field)).toEqual(['phone']);
    expect(validatePerson({ ...personForm(null, 'X') }).map((i) => i.field)).toEqual(['email']);
    expect(validatePerson({ ...personForm(null, 'X'), email: 'x@example.com' })).toEqual([]);
  });
});

describe('waypoint form', () => {
  const existing = [{ id: 'w1', name: 'ZOFRI', lat: 37.9, lon: 23.7, notes: '', created: 0, updated: 0 }] as Waypoint[];
  it('names the bad field', () => {
    expect(validateWaypoint('', 'x', existing).map((i) => i.field)).toEqual(['name', 'position']);
    expect(validateWaypoint('zofri', '375430N 0234334E', existing)).toEqual([
      { field: 'name', message: 'You already have ZOFRI' },
    ]);
    expect(validateWaypoint('zofri', '375430N 0234334E', existing, 'w1')).toEqual([]);
    expect(validateWaypoint('kavos', '', existing)).toEqual([{ field: 'position', message: 'Enter a position' }]);
  });
});

describe('manifest: putting the PIC back', () => {
  const C172 = ['front-left', 'front-right', 'rear-left', 'rear-right'];
  const pax = (name: string, seat: string): FlightCrew => ({
    role: 'PAX',
    passengerId: name,
    seat,
    snapshot: { fullName: name } as FlightCrew['snapshot'],
  });
  const me = { fullName: 'Me' } as FlightCrew['snapshot'];
  it('seats the PIC front left when it is free', () => {
    const r = addPicToCrew([pax('A', 'rear-left')], C172, me)!;
    expect(r.crew[0]).toMatchObject({ role: 'PIC', seat: 'front-left' });
    expect(r.moved).toBeNull();
  });
  it('moves whoever sits front left to the first free seat', () => {
    const r = addPicToCrew([pax('A', 'front-left'), pax('B', 'front-right')], C172, me)!;
    expect(r.crew.map((c) => [c.role, c.seat])).toEqual([
      ['PIC', 'front-left'],
      ['PAX', 'rear-left'],
      ['PAX', 'front-right'],
    ]);
    expect(r.moved).toMatchObject({ passengerId: 'A', seat: 'rear-left' });
    expect(new Set(r.crew.map((c) => c.seat)).size).toBe(r.crew.length);
  });
  it('refuses when every seat is taken, and keeps an existing PIC', () => {
    expect(
      addPicToCrew(
        C172.map((s, i) => pax(String(i), s)),
        C172,
        me,
      ),
    ).toBeNull();
    const withPic: FlightCrew[] = [{ role: 'PIC', passengerId: null, seat: 'front-right', snapshot: me }];
    expect(addPicToCrew(withPic, C172, me)!.crew).toBe(withPic);
  });
  it('falls back to the first seat on an aircraft without a front-left seat', () => {
    expect(picSeat(['left', 'right'])).toBe('left');
    expect(picSeat(C172)).toBe('front-left');
  });
});

describe('flight plan options', () => {
  it('stores alternates as ICAO codes, drops empties and duplicates, keeps at most two', () => {
    expect(alternateCode(' lgav ')).toBe('LGAV');
    expect(alternateCode('EDDF')).toBe('EDDF'); // not in the Greek AIP: kept as typed
    expect(alternatesFrom(['', 'lgav'])).toEqual(['LGAV']);
    expect(alternatesFrom(['LGAV', 'lgav'])).toEqual(['LGAV']);
    expect(alternatesFrom(['LGAV', 'LGMG', 'LGTT'])).toEqual(['LGAV', 'LGMG']);
    expect(alternatesFrom(['', ''])).toEqual([]);
  });
});
