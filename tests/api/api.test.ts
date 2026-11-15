// The API on in-memory PGlite: sign-in, profile, hangar, passengers, waypoints, flights, ref data,
// and isolation between two pilots for every entity.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { client, startApi, type Client } from './helpers';
import { blankAircraft } from '../../src/shared/templates';
import type { Flight } from '../../src/shared/types';

let api: Awaited<ReturnType<typeof startApi>>;
let a: Client, b: Client;
beforeAll(async () => {
  api = await startApi();
  a = client(api.base);
  b = client(api.base);
  expect((await a.login('sub-a', 'a@example.com')).status).toBe(200);
  expect((await b.login('sub-b', 'b@example.com')).status).toBe(200);
});
afterAll(() => api.close());

const aircraftBody = (reg: string) => {
  const ac = blankAircraft();
  ac.registration = reg;
  ac.cruiseTasKt = 92;
  ac.patternTasKt = 80;
  ac.massBalance.stations = [{ id: 'front', name: 'Front', kind: 'seat', armM: 0.94, seats: [{ id: 'front-left', label: 'Front left' }, { id: 'front-right', label: 'Front right' }] }];
  return ac;
};

describe('session', () => {
  test('requires sign-in', async () => {
    const anon = client(api.base);
    expect((await anon.call('GET', 'flights')).status).toBe(401);
    expect((await anon.call('GET', 'me')).status).toBe(401);
    const s = (await anon.call('GET', 'session')).body;
    expect(s).toMatchObject({ authed: false, mode: 'google' });
  });
  test('a new pilot starts with an empty profile and an empty hangar', async () => {
    const me = (await a.call('GET', 'me')).body;
    expect(me.email).toBe('a@example.com');
    expect(me.homeAerodrome).toBeNull();
    expect(me.settings.taxiOutMin).toBeNull();
    expect((await a.call('GET', 'aircraft')).body).toEqual([]);
  });
  test('signing in again keeps the account; sign-out ends only that session', async () => {
    const c = client(api.base);
    await c.login('sub-d', 'd@example.com');
    await c.call('PUT', 'me', { fullName: 'D Pilot' });
    const again = client(api.base);
    await again.login('sub-d', 'd.new@example.com');
    const me = (await again.call('GET', 'me')).body;
    expect(me.fullName).toBe('D Pilot');
    expect(me.email).toBe('d.new@example.com');
    await again.call('POST', 'logout');
    expect((await again.call('GET', 'me')).status).toBe(401);
    expect((await c.call('GET', 'me')).status).toBe(200);
  });
  test('bad tokens are refused', async () => {
    const c = client(api.base);
    expect((await c.call('POST', 'login', { credential: 'x.y.z' })).status).toBe(401);
  });
});

describe('profile', () => {
  test('updates and validates', async () => {
    const r = await a.call('PUT', 'me', { fullName: 'Alice Pilot', phone: '+30 690 000 0000', homeAerodrome: 'lgtt', weightKg: 70, settings: { taxiOutMin: 15, taxiInMin: 10, reserveMin: 60 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ fullName: 'Alice Pilot', homeAerodrome: 'LGTT', weightKg: 70, settings: { taxiOutMin: 15, taxiInMin: 10, reserveMin: 60, windModel: 'ecmwf_ifs025' } });
    expect((await a.call('PUT', 'me', { weightKg: -3 })).status).toBe(400);
    expect((await a.call('PUT', 'me', { dateOfBirth: '1990-13-45' })).status).toBe(400);
    expect((await b.call('GET', 'me')).body.fullName).toBe('');
  });
});

describe('hangar default aircraft', () => {
  test('the first aircraft becomes the default; later ones do not replace it', async () => {
    const c = client(api.base);
    await c.login('sub-first-ac', 'first-ac@example.com');
    expect((await c.call('GET', 'me')).body.defaultAircraftId).toBeNull();
    const one = (await c.call('POST', 'aircraft', aircraftBody('SX-ONE'))).body;
    expect((await c.call('GET', 'me')).body.defaultAircraftId).toBe(one.id);
    const two = (await c.call('POST', 'aircraft', aircraftBody('SX-TWO'))).body;
    expect((await c.call('GET', 'me')).body.defaultAircraftId).toBe(one.id);
    expect((await c.call('POST', 'flights', {})).body.aircraftId).toBe(one.id);
    // deleting the default clears it; the next aircraft added takes its place
    expect((await c.call('DELETE', `aircraft/${one.id}`)).status).toBe(204);
    expect((await c.call('GET', 'me')).body.defaultAircraftId).toBeNull();
    const three = (await c.call('POST', 'aircraft', aircraftBody('SX-THR'))).body;
    expect((await c.call('GET', 'me')).body.defaultAircraftId).toBe(three.id);
    expect(two.id).not.toBe(three.id);
  });
});

describe('isolation between pilots, per entity', () => {
  for (const [path, body, patch] of [
    ['aircraft', () => aircraftBody('SX-AAA'), { colours: 'WHITE' }],
    ['passengers', () => ({ fullName: 'Pax One', weightKg: 80 }), { phone: '123' }],
    ['waypoints', () => ({ name: 'zofri', lat: 38.1, lon: 23.8 }), { notes: 'x' }],
    ['flights', () => ({ title: 'Mine' }), null],
  ] as const) {
    test(path, async () => {
      const made = await a.call('POST', path, body());
      expect(made.status).toBe(201);
      const id = made.body.id;
      expect((await a.call('GET', path)).body.some((x: any) => x.id === id)).toBe(true);
      expect((await b.call('GET', path)).body.some((x: any) => x.id === id)).toBe(false);
      expect((await b.call('GET', `${path}/${id}`)).status).toBe(404);
      const put = path === 'flights' ? { flight: { title: 'stolen' }, version: 1 } : patch;
      expect((await b.call('PUT', `${path}/${id}`, put)).status).toBe(404);
      expect((await b.call('DELETE', `${path}/${id}`)).status).toBe(404);
      expect((await a.call('GET', `${path}/${id}`)).status).toBe(200);
      if (patch) expect((await a.call('PUT', `${path}/${id}`, patch)).body).toMatchObject(patch);
    });
  }
  test('a flight cannot reference another pilot’s aircraft or passengers', async () => {
    const ac = (await b.call('POST', 'aircraft', aircraftBody('SX-BBB'))).body;
    const pax = (await b.call('POST', 'passengers', { fullName: 'B Pax' })).body;
    expect((await a.call('POST', 'flights', { aircraftId: ac.id })).status).toBe(400);
    const f = (await a.call('POST', 'flights', {})).body as Flight;
    const crew = [...f.crew, { role: 'PAX', passengerId: pax.id, seat: 'front-right', snapshot: { fullName: 'B Pax' } }];
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { crew }, version: f.version })).status).toBe(400);
    expect((await a.call('PUT', 'me', { defaultAircraftId: ac.id })).status).toBe(400);
  });
  test('a flight id taken by another pilot is not reused', async () => {
    const f = (await a.call('POST', 'flights', { id: 'claimedid1' })).body;
    expect(f.id).toBe('claimedid1');
    const g = (await b.call('POST', 'flights', { id: 'claimedid1' })).body;
    expect(g.id).not.toBe('claimedid1');
  });
});

describe('hangar', () => {
  test('registration is unique per pilot and required', async () => {
    expect((await a.call('POST', 'aircraft', aircraftBody('SX-DUP'))).status).toBe(201);
    expect((await a.call('POST', 'aircraft', aircraftBody('SX-DUP'))).status).toBe(409);
    expect((await b.call('POST', 'aircraft', aircraftBody('SX-DUP'))).status).toBe(201);
    expect((await a.call('POST', 'aircraft', aircraftBody(''))).status).toBe(400);
  });
});

describe('flights', () => {
  test('new flights take the profile defaults: home → home, taxi times, PIC on the manifest', async () => {
    const ac = (await a.call('POST', 'aircraft', aircraftBody('SX-DEF'))).body;
    await a.call('PUT', 'me', { defaultAircraftId: ac.id });
    const f = (await a.call('POST', 'flights', {})).body as Flight;
    expect(f.route.map((p) => p.refId)).toEqual(['LGTT', 'LGTT']);
    expect(f.taxiOutMin).toBe(15);
    expect(f.taxiInMin).toBe(10);
    expect(f.aircraftId).toBe(ac.id);
    expect(f.crew).toEqual([{ role: 'PIC', passengerId: null, seat: 'front-left', snapshot: expect.objectContaining({ fullName: 'Alice Pilot', weightKg: 70 }) }]);
    expect(f.version).toBe(1);
    const row = ((await a.call('GET', 'flights')).body as any[]).find((x) => x.id === f.id);
    expect(row.points).toEqual(['LGTT', 'LGTT']);
  });
  test('versions, conflicts, manifest, trash, restore, copy', async () => {
    const pax = (await a.call('POST', 'passengers', { fullName: 'Bob Pax', weightKg: 90 })).body;
    const f = (await a.call('POST', 'flights', { title: 'Trip' })).body as Flight;
    const crew = [...f.crew, { role: 'PAX', passengerId: pax.id, seat: 'front-right', snapshot: { fullName: 'Bob Pax', weightKg: 90 } }];
    const r = await a.call('PUT', `flights/${f.id}`, { flight: { crew, blockOff: '09:30', fobL: 100 }, version: 1 });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(2);
    const stale = await a.call('PUT', `flights/${f.id}`, { flight: { title: 'late' }, version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.blockOff).toBe('09:30');
    const got = (await a.call('GET', `flights/${f.id}`)).body as Flight;
    expect(got.crew.map((c) => c.role)).toEqual(['PIC', 'PAX']);
    expect(got.fobL).toBe(100);
    // manifest rules
    const twoPics = [...crew, { role: 'PIC', passengerId: null, seat: 'rear-left', snapshot: {} }];
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { crew: twoPics }, version: 2 })).status).toBe(400);
    const sameSeat = [crew[0], { ...crew[1], seat: 'front-left' }];
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { crew: sameSeat }, version: 2 })).status).toBe(400);
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { blockOff: '25:00' }, version: 2 })).status).toBe(400);
    // deleting the passenger keeps the snapshot
    expect((await a.call('DELETE', `passengers/${pax.id}`)).status).toBe(204);
    const after = (await a.call('GET', `flights/${f.id}`)).body as Flight;
    expect(after.crew[1]).toMatchObject({ passengerId: null, snapshot: { fullName: 'Bob Pax' } });
    // trash and restore
    expect((await a.call('DELETE', `flights/${f.id}`)).status).toBe(204);
    expect((await a.call('GET', 'flights')).body.some((x: any) => x.id === f.id)).toBe(false);
    expect((await a.call('GET', 'flights?trash=1')).body.some((x: any) => x.id === f.id)).toBe(true);
    expect((await a.call('POST', `flights/${f.id}/restore`)).body.deleted).toBe(false);
    // copy
    const c = await a.call('POST', `flights/${f.id}/copy`, {});
    expect(c.status).toBe(201);
    expect(c.body.title).toBe('Copy of Trip');
    expect(c.body.crew.length).toBe(2);
    expect((await a.call('POST', `flights/${f.id}/opened`)).status).toBe(204);
  });
});

describe('reference data', () => {
  test('current AIRAC and records', async () => {
    const airac = (await a.call('GET', 'ref/airac')).body;
    expect(airac.id).toMatch(/^\d{4}$/);
    const ads = (await a.call('GET', 'ref/aerodromes')).body;
    expect(ads.find((x: any) => x.icao === 'LGTT')).toMatchObject({ elevFt: expect.any(Number) });
    const bundle = (await a.call('GET', 'ref/bundle')).body;
    expect(bundle.vfrPoints.length).toBeGreaterThan(400);
    expect(bundle.vfrRoutes.length).toBeGreaterThan(300);
    expect(bundle.fis.units.length).toBe(2);
    expect((await a.call('GET', 'ref/nope')).status).toBe(404);
  });
});

describe('access control', () => {
  test('ALLOWED_EMAILS limits who can sign in', async () => {
    const s = await startApi({ allowedEmails: ['pilot@example.com'] });
    try {
      expect((await client(s.base).login('x', 'other@example.com')).status).toBe(403);
      expect((await client(s.base).login('y', 'Pilot@example.com')).status).toBe(200);
    } finally { await s.close(); }
  });
  test('local mode: no sign-in, one local pilot', async () => {
    const s = await startApi({ google: false });
    try {
      const c = client(s.base);
      expect((await c.call('GET', 'session')).body).toMatchObject({ authed: true, mode: 'local', googleClientId: null });
      expect((await c.call('POST', 'flights', {})).status).toBe(201);
      expect((await c.call('POST', 'login', { credential: 'x' })).status).toBe(404);
    } finally { await s.close(); }
  });
});
