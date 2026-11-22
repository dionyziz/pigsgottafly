// The core's manifest, W&B chart and share suggestions against the website's modules.
import { describe, expect, test } from 'vitest';

import {
  addPassengerToCrew,
  addPicToCrew,
  applyPerson,
  changeSeat,
  editCrewField,
  manifestSeats,
  personOf,
  resetCrew,
  syncCrew,
} from '../../../src/features/editor/panels/manifest';
import { cgToMomentOutline, chartDomain, chartEnvelopes } from '../../../src/features/exports/wb/model';
import { momentPolygonFromCg } from '../../../src/features/hangar/model';
import { cgToMoment, computeFlight, manifest, shareSuggestions, wbChart } from '../../../src/native/core';
import { type Passenger, type PersonDetails, picSeat, seatLayout, validateCrew } from '../../../src/shared';
import { manifestContacts, passengerShareSuggestions } from '../../../src/shared/sharing';
import { AC, API_REF, crew, flight, NOW, PILOT, ROUTE } from './fixtures';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const stations = AC.massBalance.stations;
const seatIds = seatLayout(stations).map((s) => s.id);
const pax = (id: string, fullName: string, email = ''): Passenger =>
  ({
    id,
    fullName,
    phone: '',
    dateOfBirth: null,
    weightKg: 75,
    idNumber: 'AB1',
    idType: 'ID',
    nationality: 'GR',
    relation: '',
    email,
    notes: '',
  }) as unknown as Passenger;

describe('manifest: the Manifest section’s changes', () => {
  const base = [crew('PIC', 'front-left', 'Test Pilot', 80), crew('PAX', 'rear-left', 'Robin Rider', 70)];

  test('seats, PIC seat and problems with and without an aircraft', () => {
    const out = manifest({ crew: base, stations, op: 'seats' });
    expect(out.seats).toEqual(manifestSeats(stations));
    expect(out.picSeat).toBe(picSeat(seatIds));
    expect(out.errors).toEqual(validateCrew(base, seatIds));
    expect(manifest({ crew: base, op: 'seats' }).seats.map((s) => s.label)).toEqual([
      'Front left',
      'Front right',
      'Rear left',
      'Rear right',
    ]);
    const two = [crew('PIC', 'front-left', 'A', 80), crew('PIC', 'front-left', 'B', 80)];
    expect(manifest({ crew: two, stations, op: 'seats' }).errors).toEqual(validateCrew(two, seatIds));
  });

  test('add a passenger, change seat, remove', () => {
    const p = pax('p9', 'New Person');
    expect(manifest({ crew: base, stations, op: 'addPassenger', passenger: p }).crew).toEqual(
      json(addPassengerToCrew(base, seatIds, p)),
    );
    expect(manifest({ crew: base, stations, op: 'changeSeat', index: 1, seat: 'front-left' }).crew).toEqual(
      json(changeSeat(base, 1, 'front-left')),
    );
    expect(manifest({ crew: base, stations, op: 'remove', index: 1 }).crew).toEqual(json([base[0]]));
  });

  test('every seat taken: the passenger is not added, the PIC cannot come back', () => {
    const full = seatIds.map((s, k) => crew('PAX', s, `P${k}`, 70));
    const out = manifest({ crew: full, stations, op: 'addPassenger', passenger: pax('z', 'Z') });
    expect(out).toMatchObject({ ok: false, full: true });
    expect(out.crew).toEqual(json(full));
    expect(manifest({ crew: full, stations, op: 'addPic', pilot: PILOT }).ok).toBe(false);
    expect(addPicToCrew(full, seatIds, personOf(PILOT))).toBeNull();
  });

  test('add the PIC back: whoever sits front left moves', () => {
    const noPic = [crew('PAX', 'front-left', 'Robin Rider', 70)];
    const web = addPicToCrew(noPic, seatIds, personOf(PILOT))!;
    const out = manifest({ crew: noPic, stations, op: 'addPic', pilot: PILOT });
    expect(out.crew).toEqual(json(web.crew));
    expect(out.moved).toEqual(json(web.moved));
  });

  test('edit a field, apply, reset, sync', () => {
    const p = personOf(pax('p_rear-left', 'Robin R. Rider'));
    expect(manifest({ crew: base, op: 'editField', index: 1, key: 'phone', value: '123' }).crew[1]).toEqual(
      json(editCrewField(base[1], 'phone', '123')),
    );
    expect(manifest({ crew: base, op: 'apply', index: 1, person: p }).crew[1]).toEqual(json(applyPerson(base[1], p)));
    expect(manifest({ crew: base, op: 'reset', index: 1, person: p }).crew[1]).toEqual(json(resetCrew(base[1], p)));
    const before: Record<string, PersonDetails> = { 'p_rear-left': base[1].snapshot, PIC: base[0].snapshot };
    const now: Record<string, PersonDetails> = { PIC: { ...base[0].snapshot, phone: '999' } };
    expect(manifest({ crew: base, op: 'sync', before, now }).crew).toEqual(
      json(syncCrew(base, new Map(Object.entries(before)), new Map(Object.entries(now)))),
    );
  });
});

describe('wbChart and cgToMoment', () => {
  test('the MD 4.3 chart’s envelopes and axes, with computeFlight’s points', () => {
    const c = computeFlight({ flight: flight(ROUTE()), aircraft: AC, pilot: PILOT, ref: API_REF, now: NOW });
    const points = [c.wb!.takeoff, c.wb!.landing, c.wb!.zeroFuel];
    const out = wbChart({ massBalance: AC.massBalance, points });
    const envs = chartEnvelopes(AC.massBalance);
    expect(out.envelopes).toEqual(json(envs));
    expect(out.domain).toEqual(chartDomain(envs, points));
    expect(wbChart({ massBalance: AC.massBalance }).domain).toEqual(chartDomain(envs, []));
  });

  test('a CG envelope in moment space', () => {
    const poly = AC.massBalance.envelopes.normal.polygon;
    expect(cgToMoment({ polygon: poly })).toEqual({
      moment: momentPolygonFromCg(poly),
      outline: cgToMomentOutline(poly),
    });
  });
});

describe('shareSuggestions', () => {
  test('the manifest’s contacts the flight is not shared with yet', () => {
    const list = [pax('p_rear-left', 'Robin', 'robin@example.com'), pax('p_x', 'X', 'x@example.com')];
    const people = [{ email: 'ROBIN@example.com' }];
    const c = [crew('PIC', 'front-left', 'Test Pilot', 80), crew('PAX', 'rear-left', 'Robin Rider', 70)];
    const contacts = manifestContacts(c, list);
    expect(shareSuggestions({ crew: c, passengers: list, people })).toEqual({
      contacts,
      suggestions: passengerShareSuggestions(contacts, people),
    });
    expect(shareSuggestions({ crew: c, passengers: list }).suggestions).toEqual([
      { name: 'Robin Rider', email: 'robin@example.com' },
    ]);
  });
});
