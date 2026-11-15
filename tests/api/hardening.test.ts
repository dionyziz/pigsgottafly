// Malformed and hostile requests: bad bodies, bad paths, prototype keys, content validation of the
// flight sub-documents, login CSRF (non-JSON bodies) and revocation through ALLOWED_EMAILS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { client, googleClaims, signToken, startApi, type Client } from './helpers';

let api: Awaited<ReturnType<typeof startApi>>;
let a: Client;
let flightId: string;
let version: number;
beforeAll(async () => {
  api = await startApi();
  a = client(api.base);
  expect((await a.login('sub-h', 'h@example.com')).status).toBe(200);
  const f = (await a.call('POST', 'flights', {})).body;
  flightId = f.id;
  version = f.version;
});
afterAll(() => api.close());

const raw = (p: string, init: RequestInit) => fetch(api.base + p, init);

describe('malformed requests are 4xx, not 500', () => {
  test('a JSON body that is not an object', async () => {
    for (const body of [null, [], 3, 'x', true]) {
      expect((await a.call('PUT', `flights/${flightId}`, body)).status).toBe(400);
      expect((await a.call('POST', 'flights', body)).status).toBe(400);
      expect((await a.call('POST', `flights/${flightId}/copy`, body)).status).toBe(400);
      expect((await a.call('PUT', 'me', body)).status).toBe(400);
      expect((await a.call('POST', 'passengers', body)).status).toBe(400);
    }
    expect((await a.call('POST', 'login', null)).status).toBe(400);
  });
  test('invalid JSON', async () => {
    const r = await raw('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    expect(r.status).toBe(400);
  });
  test('object prototype names are not reference tables', async () => {
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect((await a.call('GET', `ref/${k}`)).status).toBe(404);
    }
    expect((await a.call('GET', 'ref/aerodromes')).status).toBe(200);
  });
  test('a bad percent-escape in the path', async () => {
    expect((await a.call('GET', 'flights/%E0%A4%A')).status).toBe(400);
    expect((await a.call('GET', 'aircraft/%')).status).toBe(400);
  });
});

describe('flight sub-documents are validated on write', () => {
  const put = async (flight: Record<string, unknown>) => {
    const r = await a.call('PUT', `flights/${flightId}`, { flight, version });
    if (r.status === 200) version = r.body.version;
    return r;
  };
  test('route coordinates must be numbers', async () => {
    const pt = (lat: unknown, lon: unknown) => ({ kind: 'custom', name: 'X', lat, lon });
    expect((await put({ route: [pt('38', '23')] })).status).toBe(400);
    expect((await put({ route: [pt(true, null)] })).status).toBe(400);
    expect((await put({ route: [pt(91, 23)] })).status).toBe(400);
    expect((await put({ route: [pt(38, 23), pt(38.5, 23.5)] })).status).toBe(200);
  });
  test('leg overrides: numbers in range, unknown fields dropped, empty legs removed', async () => {
    expect((await put({ legOverrides: { 'a>b': { altFt: 'DROP TABLE' } } })).status).toBe(400);
    expect((await put({ legOverrides: { 'a>b': { altFt: 1e9 } } })).status).toBe(400);
    expect((await put({ legOverrides: { 'a>b': { windDirDeg: 400 } } })).status).toBe(400);
    expect((await put({ legOverrides: { 'a>b': 5 } })).status).toBe(400);
    expect((await put({ legOverrides: { 'a>b': { altFt: 3500, evil: 'x' }, 'c>d': { altFt: null } } })).status).toBe(200);
    expect((await a.call('GET', `flights/${flightId}`)).body.legOverrides).toEqual({ 'a>b': { altFt: 3500 } });
  });
  test('ATC entries', async () => {
    expect((await put({ atc: [1, 'x', null] })).status).toBe(400);
    expect((await put({ atc: [{ role: 'boss', callsign: 'X' }] })).status).toBe(400);
    const e = { id: 'c1', role: 'custom', group: 'G', callsign: 'TATOI TOWER', service: 'TWR', primary: '122.650', backups: ['118.100'], remark: '', sourceKey: null };
    expect((await put({ atc: [{ ...e, backups: [1] }] })).status).toBe(400);
    expect((await put({ atc: [{ ...e, extra: 1 }] })).status).toBe(200);
    expect((await a.call('GET', `flights/${flightId}`)).body.atc).toEqual([e]);
    expect((await put({ atc: null })).status).toBe(200);
  });
  test('baggage must be non-negative numbers', async () => {
    expect((await put({ baggageKg: { bag1: -5 } })).status).toBe(400);
    expect((await put({ baggageKg: { bag1: '10' } })).status).toBe(400);
    expect((await put({ baggageKg: { bag1: 10, bag2: null } })).status).toBe(200);
    expect((await a.call('GET', `flights/${flightId}`)).body.baggageKg).toEqual({ bag1: 10 });
  });
  test('options: wind model and category enums, alternates (at most two, upper-cased)', async () => {
    expect((await put({ options: { windModel: '../../evil' } })).status).toBe(400);
    expect((await put({ options: { windModel: 'toString' } })).status).toBe(400);
    expect((await put({ options: { category: 'aerobatic' } })).status).toBe(400);
    expect((await put({ options: { alternates: [123] } })).status).toBe(400);
    expect((await put({ options: { alternates: ['LGAV', 'LGMG', 'LGTT'] } })).status).toBe(400);
    expect((await put({ options: { windModel: 'gfs_seamless', alternates: ['lgav'], junk: { a: 1 } } })).status).toBe(200);
    const o = (await a.call('GET', `flights/${flightId}`)).body.options;
    expect(o).toMatchObject({ windModel: 'gfs_seamless', alternates: ['LGAV'], category: 'normal' });
    expect(o.junk).toBeUndefined();
  });
  test('summary numbers', async () => {
    expect((await put({ summary: { distNm: 'far' } })).status).toBe(400);
    expect((await put({ summary: { route: [[38, 'x']] } })).status).toBe(400);
    expect((await put({ summary: { title: 'T', distNm: 12.5, route: [[38, 23]] } })).status).toBe(200);
  });
  test('manifest snapshots are checked like passenger records', async () => {
    const pic = (snapshot: unknown) => [{ role: 'PIC', passengerId: null, seat: 'front-left', snapshot }];
    expect((await put({ crew: pic({ fullName: 'P', weightKg: -3 }) })).status).toBe(400);
    expect((await put({ crew: pic({ fullName: 'P', weightKg: 'heavy' }) })).status).toBe(400);
    expect((await put({ crew: [{ role: 'PIC', passengerId: null, seat: 7, snapshot: {} }] })).status).toBe(400);
    expect((await put({ crew: pic({ fullName: 'P', weightKg: 80, extra: 'x' }) })).status).toBe(200);
    const crew = (await a.call('GET', `flights/${flightId}`)).body.crew;
    expect(crew[0].snapshot).toMatchObject({ fullName: 'P', weightKg: 80 });
    expect(crew[0].snapshot.extra).toBeUndefined();
  });
});

describe('sign-in hardening', () => {
  test('bodies must be application/json (no cross-site text/plain form posts)', async () => {
    const credential = signToken(googleClaims('sub-csrf', 'csrf@example.com'));
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const r = await raw('login', { method: 'POST', headers: { 'Content-Type': ct }, body: JSON.stringify({ credential }) });
      expect(r.status).toBe(415);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
    const ok = await raw('login', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ credential }) });
    expect(ok.status).toBe(200);
  });
  test('bodyless POSTs still work', async () => {
    expect((await a.call('POST', `flights/${flightId}/opened`)).status).toBe(204);
  });
  test('removing an email from ALLOWED_EMAILS ends its existing sessions', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgf-allow-'));
    try {
      const s1 = await startApi({ db: dir, allowedEmails: ['keep@example.com', 'gone@example.com'] });
      let cookie = '';
      try {
        const r = await fetch(s1.base + 'login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: signToken(googleClaims('sub-gone', 'gone@example.com')) }) });
        expect(r.status).toBe(200);
        cookie = r.headers.get('set-cookie')!.split(';')[0];
        expect((await fetch(s1.base + 'me', { headers: { cookie } })).status).toBe(200);
      } finally { await s1.close(); }
      const s2 = await startApi({ db: dir, allowedEmails: ['keep@example.com'] });
      try {
        expect((await fetch(s2.base + 'me', { headers: { cookie } })).status).toBe(401);
        const sess = await (await fetch(s2.base + 'session', { headers: { cookie } })).json();
        expect(sess.authed).toBe(false);
        const { db } = await s2.server.ready;
        expect(await db.query(`SELECT 1 FROM sessions s JOIN pilots p ON p.id = s.pilot_id WHERE p.email = 'gone@example.com'`)).toEqual([]);
      } finally { await s2.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
