// Local flights (src/shared/local.ts): the same aerodrome at both ends with nothing between; the
// pilot's duration stands for the navlog in the times, the fuel and the flight plan (LOCAL, -LGTT0100).
import { describe, expect, test } from 'vitest';

import { buildLegs, computeNavlog, defaultAltitudes, localNavlog, navlogAircraft, planFuel } from '../../../src/calc';
import { aerodrome, REF } from '../../../src/data/ref';
import { buildFpl } from '../../../src/features/exports/fpl/fpl';
import { fplInputFrom, totalEetMin } from '../../../src/features/exports/fpl/input';
import { parseFplMessage } from '../../../src/features/exports/fpl/parseFpl';
import { isLocalSummary, routeLine } from '../../../src/features/lobby/format';
import {
  aerodromePoint,
  type Aircraft,
  DEFAULT_LOCAL_DURATION_MIN,
  emptyFlightDoc,
  type Flight,
  isLocalFlight,
  localDuration,
  localDurationOf,
  type RoutePoint,
} from '../../../src/shared';
import { parseDuration } from '../../../src/shared/typedInput';

const tt = () => aerodromePoint(aerodrome('LGTT')!);
const mg = () => aerodromePoint(aerodrome('LGMG')!);
const custom = (lat: number, lon: number): RoutePoint => ({
  uid: 'c',
  kind: 'custom',
  refId: null,
  name: 'X',
  lat,
  lon,
});

describe('isLocalFlight', () => {
  test('the same aerodrome at both ends, nothing between', () => {
    expect(isLocalFlight([tt(), tt()])).toBe(true);
    expect(isLocalFlight([tt(), mg()])).toBe(false);
    // a circular route with points between has legs and a navlog
    expect(isLocalFlight([tt(), custom(38.2, 23.6), tt()])).toBe(false);
    expect(isLocalFlight([tt()])).toBe(false);
    expect(isLocalFlight([])).toBe(false);
    const a = tt();
    expect(isLocalFlight([{ ...custom(a.lat, a.lon) }, { ...custom(a.lat, a.lon) }])).toBe(false);
  });
  test('duration: the pilot’s, else 60 min; only while local', () => {
    expect(localDurationOf(undefined)).toBe(DEFAULT_LOCAL_DURATION_MIN);
    expect(localDurationOf({ localDurationMin: null })).toBe(60);
    expect(localDurationOf({ localDurationMin: 90 })).toBe(90);
    expect(localDuration([tt(), tt()], { localDurationMin: 90 })).toBe(90);
    expect(localDuration([tt(), mg()], { localDurationMin: 90 })).toBeNull();
  });
  test('no legs and no altitudes', () => {
    const r = [tt(), tt()];
    expect(buildLegs(r, '2026-11-24')).toEqual([]);
    expect(
      defaultAltitudes(r, { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes }),
    ).toEqual([]);
  });
  test('typed durations', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('1h30')).toBe(90);
    expect(parseDuration('1h')).toBe(60);
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('130')).toBe(90);
    expect(parseDuration('1:75')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
  });
});

const aircraft = {
  registration: 'SX-ASV',
  makeModel: 'Reims/Cessna F172M',
  icaoType: 'C172',
  wake: 'L',
  operator: '',
  colours: 'WHITE',
  cruiseTasKt: 92,
  patternTasKt: 80,
  equipment: {
    item10a: 'SDFGY',
    item10b: 'C',
    pbn: '',
    item18Extras: '',
    emergencyRadio: { uhf: false, vhf: false, elt: true },
    survival: { polar: false, desert: false, maritime: false, jungle: false },
    jackets: { present: false, light: false, fluorescein: false, uhf: false, vhf: false },
    dinghies: null,
    remarks: '',
  },
  compassCards: [],
  fuel: { burnLph: 30, taxiAllowanceL: 4, usableL: 144 },
} as unknown as Aircraft;

function localNav(route: RoutePoint[], durationMin: number) {
  return computeNavlog({
    date: '2026-11-24',
    blockOff: '08:00',
    taxiOutMin: 10,
    taxiInMin: 5,
    legs: buildLegs(route, '2026-11-24'),
    altitudesFt: [],
    overrides: [],
    aircraft: navlogAircraft(aircraft),
    winds: null,
    ...localNavlog(route, { localDurationMin: durationMin }),
  });
}

describe('times and fuel of a local flight', () => {
  test('landing = take-off + duration; block on adds the taxi in; trip fuel = burn × duration', () => {
    const n = localNav([tt(), tt()], 90);
    expect(n.local).toBe(true);
    expect(n.legs).toEqual([]);
    expect(n.times).toEqual({ blockOffMin: 480, takeoffMin: 490, landingMin: 580, blockOnMin: 585 });
    expect(n.flightMin).toBe(90);
    expect(n.totals.ete).toBe(90);
    expect(n.totals.tripFuel).toBe(45);
    expect(n.totals.fuel).toBe(49);
    expect(n.sunsetMin).not.toBeNull();
    const f = planFuel({
      tripFuelL: n.totals.tripFuel,
      taxiAllowanceL: 4,
      burnLph: 30,
      finalReserveMin: 0,
      reserveMin: 30,
      fobL: null,
      usableL: 144,
      tripMin: n.flightMin,
      localFlight: true,
    });
    expect(f.tripL).toBe(45);
    expect(f.requiredL).toBe(49);
    expect(f.fobL).toBe(64);
  });
  test('a cross-country route ignores the duration', () => {
    const n = localNav([tt(), mg()], 90);
    expect(n.local).toBe(false);
    expect(n.legs.length).toBe(1);
  });
});

describe('the flight plan of a local flight', () => {
  const doc = emptyFlightDoc('2026-11-24');
  const flight = (durationMin: number): Flight => ({
    ...doc,
    id: 'f1',
    version: 1,
    created: 0,
    updated: 0,
    opened: 0,
    deleted: false,
    blockOff: '08:00',
    route: [tt(), tt()],
    options: { ...doc.options, localDurationMin: durationMin },
  });

  test('item 15 LOCAL, item 16 the departure with the duration (-LGTT0100)', () => {
    const f = flight(60);
    const navlog = localNav(f.route, 60);
    expect(totalEetMin(navlog)).toBe(60);
    const r = buildFpl(
      fplInputFrom({
        flight: f,
        aircraft,
        pilot: { fullName: 'Pat Pilot', phone: '+30 2100000000' },
        navlog,
        fuel: null,
      }),
    );
    expect(r.fields.item13).toEqual({ adep: 'LGTT', eobt: '0800' });
    expect(r.fields.item15).toEqual({ speed: 'N0092', level: 'VFR', route: 'LOCAL' });
    expect(r.fields.item16.ades).toBe('LGTT');
    expect(r.fields.item16.eet).toBe('0100');
    expect(r.message).toContain('-N0092VFR LOCAL\n-LGTT0100');
  });
  test('the duration without a navlog (no aircraft yet)', () => {
    const r = buildFpl(
      fplInputFrom({
        flight: flight(90),
        aircraft: null,
        pilot: { fullName: '', phone: '' },
        navlog: null,
        fuel: null,
      }),
    );
    expect(r.fields.item16.eet).toBe('0130');
    expect(r.fields.item15.route).toBe('LOCAL');
  });
  test('the faxed form read back from the message is the same plan', () => {
    const r = buildFpl(
      fplInputFrom({
        flight: flight(90),
        aircraft,
        pilot: { fullName: 'Pat Pilot', phone: '' },
        navlog: localNav(flight(90).route, 90),
        fuel: null,
      }),
    );
    expect(parseFplMessage(r.message)).toEqual(r.fields);
    expect(parseFplMessage(r.lines.join(' '))).toEqual(r.fields);
  });
});

describe('the lobby row', () => {
  const s = (route: [number, number][], from: string, to: string, eteMin: number | null) => ({
    route,
    from,
    to,
    eteMin,
  });
  test('LGTT local · 1:00', () => {
    expect(
      routeLine(
        s(
          [
            [38.11, 23.78],
            [38.11, 23.78],
          ],
          'LGTT',
          'LGTT',
          60,
        ),
      ),
    ).toBe('LGTT local · 1:00');
    expect(
      routeLine(
        s(
          [
            [38.11, 23.78],
            [38.11, 23.78],
          ],
          'LGTT',
          'LGTT',
          null,
        ),
      ),
    ).toBe('LGTT local');
    expect(
      isLocalSummary(
        s(
          [
            [38.11, 23.78],
            [38.2, 23.6],
            [38.11, 23.78],
          ],
          'LGTT',
          'LGTT',
          60,
        ),
      ),
    ).toBe(false);
    expect(
      routeLine(
        s(
          [
            [38.11, 23.78],
            [38.2, 23.6],
            [38.11, 23.78],
          ],
          'LGTT',
          'LGTT',
          60,
        ),
      ),
    ).toBe('LGTT → LGTT');
    expect(
      routeLine(
        s(
          [
            [38.11, 23.78],
            [37.98, 23.37],
          ],
          'LGTT',
          'LGMG',
          30,
        ),
      ),
    ).toBe('LGTT → LGMG');
  });
});
