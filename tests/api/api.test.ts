// The API on in-memory PGlite: sign-in, profile, hangar, passengers, waypoints, flights, ref data,
// and isolation between two pilots for every entity.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { AREAS, resolveAerodrome } from '../../src/data/ref';
import { aerodromePoint } from '../../src/shared';
import { DEFAULT_MAP_LAYERS } from '../../src/shared/mapLayers';
import { blankAircraft } from '../../src/shared/templates';
import type { Flight } from '../../src/shared/types';
import { type Client, client, startApi } from './helpers';

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
  ac.massBalance.stations = [
    {
      id: 'front',
      name: 'Front',
      kind: 'seat',
      armM: 0.94,
      seats: [
        { id: 'front-left', label: 'Front left' },
        { id: 'front-right', label: 'Front right' },
      ],
    },
  ];
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
  test('a new pilot starts with an empty profile (but the usual taxi times) and an empty hangar', async () => {
    const me = (await a.call('GET', 'me')).body;
    expect(me.email).toBe('a@example.com');
    expect(me.homeAerodrome).toBeNull();
    expect([me.settings.taxiOutMin, me.settings.taxiInMin]).toEqual([15, 15]);
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
    const r = await a.call('PUT', 'me', {
      fullName: 'Alice Pilot',
      phone: '+30 690 000 0000',
      homeAerodrome: 'lgtt',
      weightKg: 70,
      settings: { taxiOutMin: 15, taxiInMin: 10, reserveMin: 60 },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      fullName: 'Alice Pilot',
      homeAerodrome: 'LGTT',
      weightKg: 70,
      settings: { taxiOutMin: 15, taxiInMin: 10, reserveMin: 60, windModel: 'ecmwf_ifs025' },
    });
    expect((await a.call('PUT', 'me', { weightKg: -3 })).status).toBe(400);
    expect((await a.call('PUT', 'me', { dateOfBirth: '1990-13-45' })).status).toBe(400);
    expect((await b.call('GET', 'me')).body.fullName).toBe('');
  });
  test('default alternate: pre-filled on new flights, not when the flight ends there or alternates are given', async () => {
    const c = client(api.base);
    await c.login('sub-altn', 'altn@example.com');
    expect((await c.call('PUT', 'me', { settings: { defaultAlternate: 'not an aerodrome!' } })).status).toBe(400);
    const me = await c.call('PUT', 'me', { homeAerodrome: 'LGTT', settings: { defaultAlternate: 'lgav' } });
    expect(me.body.settings.defaultAlternate).toBe('LGAV');
    expect((await c.call('POST', 'flights', {})).body.options.alternates).toEqual(['LGAV']);
    expect((await c.call('POST', 'flights', { options: { alternates: ['LGMG'] } })).body.options.alternates).toEqual([
      'LGMG',
    ]);
    const toLgav = [aerodromePoint(resolveAerodrome('LGTT')!), aerodromePoint(resolveAerodrome('LGAV')!)];
    expect((await c.call('POST', 'flights', { route: toLgav })).body.options.alternates).toEqual([]);
    await c.call('PUT', 'me', { settings: { defaultAlternate: null } });
    expect((await c.call('POST', 'flights', {})).body.options.alternates).toEqual([]);
  });
  test("map layers: the profile's choice goes to new flights; each flight keeps its own", async () => {
    const c = client(api.base);
    await c.login('sub-layers', 'layers@example.com');
    const old = (await c.call('POST', 'flights', {})).body;
    expect(old.options.mapLayers).toBeUndefined();
    expect((await c.call('PUT', 'me', { settings: { mapLayers: 'all' } })).status).toBe(400);
    const me = await c.call('PUT', 'me', {
      settings: { mapLayers: { base: 'terrain', vfrRoutes: false, junk: true } },
    });
    expect(me.body.settings.mapLayers).toEqual({ ...DEFAULT_MAP_LAYERS, base: 'terrain', vfrRoutes: false });
    const f = (await c.call('POST', 'flights', {})).body;
    expect(f.options.mapLayers).toEqual(me.body.settings.mapLayers);
    const mine = { ...DEFAULT_MAP_LAYERS, tma: false };
    const put = await c.call('PUT', `flights/${f.id}`, {
      flight: { options: { ...f.options, mapLayers: mine } },
      version: f.version,
    });
    expect(put.status).toBe(200);
    expect((await c.call('GET', `flights/${f.id}`)).body.options.mapLayers).toEqual(mine);
    expect(
      (await c.call('PUT', `flights/${f.id}`, { flight: { options: { mapLayers: 5 } }, version: put.body.version }))
        .status,
    ).toBe(400);
    // a flight from before keeps working without layers
    expect((await c.call('GET', `flights/${old.id}`)).body.options.mapLayers).toBeUndefined();
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
    const crew = [
      ...f.crew,
      { role: 'PAX', passengerId: pax.id, seat: 'front-right', snapshot: { fullName: 'B Pax' } },
    ];
    // another pilot's passenger is never linked: the reference is dropped, the snapshot stays
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { crew }, version: f.version })).status).toBe(200);
    const saved = (await a.call('GET', `flights/${f.id}`)).body as Flight;
    expect(saved.crew[1]).toMatchObject({ passengerId: null, snapshot: { fullName: 'B Pax' } });
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
  test('new flights take the profile defaults: from home (no destination), taxi times, PIC on the manifest', async () => {
    const ac = (await a.call('POST', 'aircraft', aircraftBody('SX-DEF'))).body;
    await a.call('PUT', 'me', { defaultAircraftId: ac.id });
    const f = (await a.call('POST', 'flights', {})).body as Flight;
    expect(f.route.map((p) => p.refId)).toEqual(['LGTT']);
    expect(f.taxiOutMin).toBe(15);
    expect(f.taxiInMin).toBe(10);
    expect(f.aircraftId).toBe(ac.id);
    expect(f.crew).toEqual([
      {
        role: 'PIC',
        passengerId: null,
        seat: 'front-left',
        snapshot: expect.objectContaining({ fullName: 'Alice Pilot', weightKg: 70 }),
        overrides: [],
      },
    ]);
    expect(f.version).toBe(1);
    const row = ((await a.call('GET', 'flights')).body as any[]).find((x) => x.id === f.id);
    expect(row.points).toEqual(['LGTT']);
  });
  test('versions, conflicts, manifest, trash, restore, copy', async () => {
    const pax = (await a.call('POST', 'passengers', { fullName: 'Bob Pax', weightKg: 90 })).body;
    const f = (await a.call('POST', 'flights', { title: 'Trip' })).body as Flight;
    const crew = [
      ...f.crew,
      { role: 'PAX', passengerId: pax.id, seat: 'front-right', snapshot: { fullName: 'Bob Pax', weightKg: 90 } },
    ];
    const r = await a.call('PUT', `flights/${f.id}`, { flight: { crew, blockOff: '09:30', fobL: 100 }, version: 1 });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(2);
    const stale = await a.call('PUT', `flights/${f.id}`, { flight: { title: 'late' }, version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.blockOff).toBe('09:30');
    const got = (await a.call('GET', `flights/${f.id}`)).body as Flight;
    expect(got.crew.map((c) => c.role)).toEqual(['PIC', 'PAX']);
    expect(got.fobL).toBe(100);
    // fields edited on the flight (unknown names dropped) are kept with the row
    expect(got.crew[1].overrides).toEqual([]);
    const edited = [
      crew[0],
      { ...crew[1], snapshot: { fullName: 'Bob Pax', weightKg: 84 }, overrides: ['weightKg', 'bogus'] },
    ];
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { crew: edited }, version: 2 })).status).toBe(200);
    expect(((await a.call('GET', `flights/${f.id}`)).body as Flight).crew[1]).toMatchObject({
      snapshot: { weightKg: 84 },
      overrides: ['weightKg'],
    });
    expect(
      (
        await a.call('PUT', `flights/${f.id}`, {
          flight: { crew: [crew[0], { ...crew[1], overrides: 'weightKg' }] },
          version: 3,
        })
      ).status,
    ).toBe(400);
    const twoPics = [...crew, { role: 'PIC', passengerId: null, seat: 'rear-left', snapshot: {} }];
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { crew: twoPics }, version: 3 })).status).toBe(400);
    const sameSeat = [crew[0], { ...crew[1], seat: 'front-left' }];
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { crew: sameSeat }, version: 3 })).status).toBe(400);
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { blockOff: '25:00' }, version: 3 })).status).toBe(400);
    // deleting the passenger keeps the snapshot
    expect((await a.call('DELETE', `passengers/${pax.id}`)).status).toBe(204);
    const after = (await a.call('GET', `flights/${f.id}`)).body as Flight;
    expect(after.crew[1]).toMatchObject({ passengerId: null, snapshot: { fullName: 'Bob Pax' } });
    expect((await a.call('DELETE', `flights/${f.id}`)).status).toBe(204);
    expect((await a.call('GET', 'flights')).body.some((x: any) => x.id === f.id)).toBe(false);
    expect((await a.call('GET', 'flights?trash=1')).body.some((x: any) => x.id === f.id)).toBe(true);
    expect((await a.call('POST', `flights/${f.id}/restore`)).body.deleted).toBe(false);
    const c = await a.call('POST', `flights/${f.id}/copy`, {});
    expect(c.status).toBe(201);
    expect(c.body.title).toBe('Copy of Trip');
    expect(c.body.crew.length).toBe(2);
    expect(c.body.crew[1].overrides).toEqual(['weightKg']);
    // "Fly again": the same trip on another day, named after its route, nothing filed
    const again = await a.call('POST', `flights/${f.id}/copy`, { title: '', date: '2027-01-09' });
    expect(again.status).toBe(201);
    expect([again.body.title, again.body.date, again.body.summary.date]).toEqual(['', '2027-01-09', '2027-01-09']);
    expect(again.body.crew.length).toBe(2);
    const listed = (await a.call('GET', 'flights')).body.find((x: any) => x.id === again.body.id);
    expect(listed.filingStatus).toBeNull();
    expect((await a.call('POST', `flights/${f.id}/copy`, { date: '9 Jan' })).status).toBe(400);
    expect((await a.call('POST', `flights/${f.id}/opened`)).status).toBe(204);
  });
});

describe('flight list and options', () => {
  test("the list names each flight's passengers in manifest order, not the PIC, and only to its pilot", async () => {
    const ac = aircraftBody('SX-PAX');
    ac.massBalance.stations.push({
      id: 'rear',
      name: 'Rear',
      kind: 'seat',
      armM: 1.85,
      seats: [
        { id: 'rear-left', label: 'Rear left' },
        { id: 'rear-right', label: 'Rear right' },
      ],
    });
    const acId = (await a.call('POST', 'aircraft', ac)).body.id;
    const pax = (await a.call('POST', 'passengers', { fullName: 'Jane Doe', weightKg: 60 })).body;
    const f = (await a.call('POST', 'flights', { title: 'With passengers', aircraftId: acId })).body as Flight;
    const crew = [
      ...f.crew,
      { role: 'PAX', passengerId: null, seat: 'rear-right', snapshot: { fullName: 'Nikos P.', weightKg: 80 } },
      { role: 'PAX', passengerId: pax.id, seat: 'front-right', snapshot: { fullName: 'Jane Doe', weightKg: 60 } },
      { role: 'PAX', passengerId: null, seat: 'rear-left', snapshot: { fullName: '  ', weightKg: 20 } },
    ];
    expect((await a.call('PUT', `flights/${f.id}`, { flight: { crew }, version: f.version })).status).toBe(200);
    const row = ((await a.call('GET', 'flights')).body as any[]).find((x) => x.id === f.id);
    expect(row.passengers).toEqual(['Nikos P.', 'Jane Doe']);
    const empty = (await a.call('POST', 'flights', { title: 'Solo' })).body as Flight;
    expect(((await a.call('GET', 'flights')).body as any[]).find((x) => x.id === empty.id).passengers).toEqual([]);
    expect(((await b.call('GET', 'flights')).body as any[]).some((x) => x.id === f.id)).toBe(false);
  });
  test('the taxi allowance override is kept with the flight; bad values are 400', async () => {
    const f = (await a.call('POST', 'flights', { title: 'Allowance' })).body as Flight;
    const put = (taxiAllowanceL: unknown, version: number) =>
      a.call('PUT', `flights/${f.id}`, { flight: { options: { ...f.options, taxiAllowanceL } }, version });
    expect((await put(6.5, f.version)).status).toBe(200);
    let got = (await a.call('GET', `flights/${f.id}`)).body as Flight;
    expect(got.options.taxiAllowanceL).toBe(6.5);
    for (const bad of [-1, 1001, '6', {}]) expect((await put(bad, got.version)).status, String(bad)).toBe(400);
    expect((await put(null, got.version)).status).toBe(200);
    got = (await a.call('GET', `flights/${f.id}`)).body as Flight;
    expect(got.options.taxiAllowanceL).toBeNull();
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
    // ENR 5 areas (migration 017), the same records as the client ships
    expect(bundle.areas.length).toBe(AREAS.length);
    const areas = (await a.call('GET', 'ref/areas')).body;
    expect(areas.find((x: any) => x.id === 'LGP1')).toEqual(AREAS.find((x) => x.id === 'LGP1'));
    expect((await a.call('GET', 'ref/nope')).status).toBe(404);
  });
});

describe('access control', () => {
  test('ALLOWED_EMAILS limits who can sign in', async () => {
    const s = await startApi({ allowedEmails: ['pilot@example.com'] });
    try {
      expect((await client(s.base).login('x', 'other@example.com')).status).toBe(403);
      expect((await client(s.base).login('y', 'Pilot@example.com')).status).toBe(200);
    } finally {
      await s.close();
    }
  });
  test('local mode: no sign-in, one local pilot', async () => {
    const s = await startApi({ google: false });
    try {
      const c = client(s.base);
      expect((await c.call('GET', 'session')).body).toMatchObject({
        authed: true,
        mode: 'local',
        googleClientId: null,
      });
      expect((await c.call('POST', 'flights', {})).status).toBe(201);
      expect((await c.call('POST', 'login', { credential: 'x' })).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});
