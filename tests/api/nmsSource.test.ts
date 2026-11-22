// The international NOTAM feed (NMS-API, api/_lib/notamSources/nms.ts): mapping real GeoJSON features
// (tests/fixtures/nms-features.json, from the pre-production service) incl. a NOTAMR, a NOTAMC, a
// multi-part NOTAM and a foreign office's NOTAM; the empty-location shape; the token (cached, renewed
// before expiry, one retry on 401) with a mocked fetch; merging with autorouter; the label; per-source
// freshness; and foreign offices' NOTAMs off the route not shown as relevant.
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { configFromEnv } from '../../api/_lib/app';
import { assessNotams, toNotam } from '../../api/_lib/notams';
import { fromAutorouterRow } from '../../api/_lib/notamSources/autorouter';
import { NOTAM_SOURCE_IDS } from '../../api/_lib/notamSources/index';
import { mergeNotams } from '../../api/_lib/notamSources/merge';
import { freshness, gatherNotams } from '../../api/_lib/notamSources/multiplex';
import {
  fromNms,
  NMS_CONCURRENCY,
  NMS_LABEL,
  NmsClient,
  type NmsFeature,
  nmsFromEnv,
  nmsNotamSource,
  type NmsSettings,
} from '../../api/_lib/notamSources/nms';
import { blankNotam, NotamSourceError, type RawNotam } from '../../api/_lib/notamSources/types';
import { createServer } from '../../server/server';
import aerodromes from '../../src/data/ref/aerodromes.json';
import type { RefAerodrome } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import features from '../fixtures/nms-features.json';
import { CID, type Client, client, JWK } from './helpers';

const FEATURES = features as NmsFeature[];
const byNumber = (n: string) => FEATURES.find((f) => f.properties!.coreNOTAMData!.notam!.number === n)!;
const T = (iso: string) => Date.parse(iso);

describe('mapping', () => {
  test('a NOTAMN with schedule and limits: the ICAO text first', () => {
    expect(fromNms(byNumber('A3462/26'), 'LGGG')).toEqual({
      ...blankNotam('nms'),
      sourceId: 'NMS_ID_1789809271407000',
      series: 'A',
      number: 3462,
      year: 26,
      type: 'N',
      refers: null,
      fir: 'LGGG',
      code23: 'WP',
      code45: 'LW',
      traffic: 'IV',
      purpose: 'M',
      scope: 'W',
      lowerFl: 0,
      upperFl: 30,
      center: { lat: 35.53333, lon: 23.83333 },
      radiusNm: 2,
      itemA: ['LGGG'],
      from: T('2026-10-01T03:00:00Z'),
      to: T('2026-12-31T21:59:00Z'),
      estimated: false,
      itemD: expect.stringMatching(/^OCT 01 02 05-09 .* 28 31 0400-2159$/s),
      itemE: expect.stringMatching(/^PJE WILL TAKE PLACE WI:.*LGD81 AFFECTED\.$/s),
      itemF: 'SFC',
      itemG: '3000FT AMSL',
      raw: expect.stringMatching(/^A3462\/26 NOTAMN\r?\nQ\) LGGG\/QWPLW/),
      location: 'LGGG',
      issued: T('2026-09-19T09:14:00Z'),
    });
  });

  test('a NOTAMR: the NOTAM it replaces, and the Q line over the record (upper FL004, not 999)', () => {
    const n = fromNms(byNumber('A4147/26'), 'LGAV')!;
    expect(n).toMatchObject({
      type: 'R',
      refers: { series: 'A', number: 4131, year: 26 },
      code23: 'OB',
      code45: 'CE',
      purpose: 'M',
      scope: 'AE',
      lowerFl: 0,
      upperFl: 4,
      center: { lat: 37.93333, lon: 23.95 },
      radiusNm: 5,
      itemA: ['LGAV'],
      location: 'LGAV',
    });
    expect(n.itemE).toMatch(/^FOUR TOWER CRANES/);
  });

  test('a NOTAMC (its text is the ICAO message); a foreign office’s NOTAM; a multi-part one', () => {
    expect(fromNms(byNumber('A4332/26'))).toMatchObject({
      type: 'C',
      refers: { series: 'A', number: 4326, year: 26 },
      itemA: ['LGAV'],
      itemE: 'NOTAM CANCELLED.',
      location: 'LGAV',
    });
    expect(fromNms(byNumber('A5198/26'), 'LGGG')).toMatchObject({
      fir: 'LTXX',
      code23: 'AF',
      code45: 'XX',
      itemA: ['LTBB', 'LGGG'],
      radiusNm: 357,
    });
    // 'A) LTBB LGGG  PART 1 OF 4  B) …' on one line
    expect(fromNms(byNumber('A4808/26'), 'LGGG')).toMatchObject({
      fir: 'LTXX',
      code23: 'WE',
      lowerFl: 160,
      upperFl: 240,
      itemA: ['LTBB', 'LGGG'],
      from: T('2026-10-30T18:00:00Z'),
      to: T('2026-12-01T17:00:00Z'),
    });
  });

  test('no ICAO text: the record’s own fields; PERM; geometry point when there are no coordinates', () => {
    const f = structuredClone(byNumber('A3462/26'));
    const core = f.properties!.coreNOTAMData!;
    core.notamTranslation = [];
    Object.assign(core.notam!, { effectiveEnd: 'PERM', estimated: 'True', coordinates: undefined });
    expect(fromNms(f)).toMatchObject({
      series: 'A',
      number: 3462,
      year: 26,
      fir: 'LGGG',
      code23: 'WP',
      code45: 'LW',
      purpose: 'M',
      lowerFl: 0,
      upperFl: 30,
      center: { lat: 35.53333, lon: 23.83333 },
      radiusNm: 2,
      itemA: ['LGGG'],
      from: T('2026-10-01T03:00:00Z'),
      to: null,
      estimated: true,
      itemF: 'SFC',
      itemG: '3000FT AMSL',
      raw: null,
    });
    expect(fromNms(f)!.itemE).toMatch(/^PJE WILL TAKE PLACE/);
    expect(fromNms({ type: 'Feature', properties: {} })).toBeNull();
  });

  test('the briefing’s Notam keeps the source’s ICAO text', () => {
    const n = toNotam(fromNms(byNumber('A4147/26'))!)!;
    expect(n).toMatchObject({ key: 'A4147/26', type: 'R', refers: 'A4131/26', qcode: 'QOBCE', sources: ['nms'] });
    expect(n.raw).toMatch(/^A4147\/26 NOTAMR A4131\/26/);
  });
});

// ---------------------------------------------------------------- client

interface Call {
  url: URL;
  auth: string | null;
  format: string | null;
  body?: string;
}

function mockNms(opts: { byLocation?: Record<string, unknown>; expiresIn?: string } = {}) {
  const calls: Call[] = [];
  const state = {
    tokens: 0,
    /** Tokens refused by the API (expired early). */
    revoked: new Set<string>(),
    tokenStatus: 200,
    fail: 0,
    inFlight: 0,
    maxInFlight: 0,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const h = new Headers(init?.headers);
    calls.push({
      url,
      auth: h.get('authorization'),
      format: h.get('nmsResponseFormat'),
      body: String(init?.body ?? ''),
    });
    if (url.pathname === '/v1/auth/token') {
      if (state.tokenStatus !== 200) return json(state.tokenStatus, { error: 'invalid_client' });
      if (h.get('authorization') !== `Basic ${Buffer.from('cid:csecret').toString('base64')}`)
        return json(401, { error: 'invalid_client' });
      return json(200, { access_token: `tok${++state.tokens}`, expires_in: opts.expiresIn ?? '1799' });
    }
    const token = h.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!/^tok\d+$/.test(token) || state.revoked.has(token))
      return json(401, { status: '401', message: 'Unauthorized' });
    if (state.fail) return json(state.fail, { status: String(state.fail), message: 'Service unavailable' });
    if (url.pathname !== '/nmsapi/v1/notams') return json(404, { message: 'Not Found' });
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    state.inFlight--;
    const loc = url.searchParams.get('location')!;
    return json(200, opts.byLocation?.[loc] ?? { status: 'Success', data: {} });
  }) as typeof globalThis.fetch;
  return { calls, state, fetch };
}

const settings = (m: ReturnType<typeof mockNms>, now?: () => number): NmsSettings => ({
  baseUrl: 'https://nms.test/',
  clientId: 'cid',
  clientSecret: 'csecret',
  fetch: m.fetch,
  now,
});

const geo = (...numbers: string[]) => ({ status: 'Success', data: { geojson: numbers.map(byNumber) } });

describe('NMS client', () => {
  test('one location a request, GEOJSON, the window applied here; a location with nothing is empty', async () => {
    const m = mockNms({ byLocation: { LGAV: geo('A4147/26', 'A4332/26'), LGGG: geo('A3462/26', 'A5198/26') } });
    const c = new NmsClient(settings(m));
    // 24 Nov 2026: A5198/26 (23–25 Nov), the NOTAMC (record valid to 25 Nov) and the long ones
    const got = await c.notams(['LGAV', 'lggg', 'LGTT'], T('2026-11-24T00:00:00Z'), T('2026-11-25T00:00:00Z'));
    expect(got.map((n) => `${n.series}${n.number}`).sort()).toEqual(['A3462', 'A4147', 'A4332', 'A5198']);
    // 26 Nov: not A5198/26 nor the NOTAMC
    expect(
      (await c.notams(['LGAV', 'LGGG'], T('2026-11-26T00:00:00Z'), T('2026-11-27T00:00:00Z')))
        .map((n) => `${n.series}${n.number}`)
        .sort(),
    ).toEqual(['A3462', 'A4147']);
    const asks = m.calls.filter((x) => x.url.pathname === '/nmsapi/v1/notams');
    expect(asks.map((x) => x.url.searchParams.get('location')).sort()).toEqual([
      'LGAV',
      'LGAV',
      'LGGG',
      'LGGG',
      'LGTT',
    ]);
    expect(asks.every((x) => x.format === 'GEOJSON' && x.auth === 'Bearer tok1')).toBe(true);
    // one token for every request
    const tok = m.calls.filter((x) => x.url.pathname === '/v1/auth/token');
    expect(tok).toHaveLength(1);
    expect(tok[0].body).toBe('grant_type=client_credentials');
    expect(await c.location('LGTT')).toEqual([]);
  });

  test(`at most ${NMS_CONCURRENCY} locations at a time`, async () => {
    const m = mockNms();
    const locs = Array.from({ length: 12 }, (_, i) => `LGX${String.fromCharCode(65 + i)}`);
    expect(await new NmsClient(settings(m)).notams(locs, 0, Date.now())).toEqual([]);
    expect(m.state.maxInFlight).toBeGreaterThan(1);
    expect(m.state.maxInFlight).toBeLessThanOrEqual(NMS_CONCURRENCY);
  });

  test('the token is kept until a minute before it expires, then renewed', async () => {
    const m = mockNms();
    let t = 1_000_000;
    const c = new NmsClient(settings(m, () => t));
    expect(await c.accessToken()).toBe('tok1');
    t += 28 * 60e3;
    expect(await c.accessToken()).toBe('tok1');
    t += 60e3; // 29 min of 29:59: less than a minute left
    expect(await c.accessToken()).toBe('tok2');
    // asked together: one token request
    const fresh = new NmsClient(settings(m, () => t));
    expect(await Promise.all([fresh.accessToken(), fresh.accessToken()])).toEqual(['tok3', 'tok3']);
  });

  test('a 401 renews the token once; a second 401 and other errors fail without naming the provider', async () => {
    const m = mockNms({ byLocation: { LGAV: geo('A4147/26') } });
    const c = new NmsClient(settings(m));
    await c.accessToken();
    m.state.revoked.add('tok1');
    expect((await c.location('LGAV')).length).toBe(1);
    expect(m.calls.at(-1)!.auth).toBe('Bearer tok2');
    // every token refused
    m.state.revoked = { has: () => true } as unknown as Set<string>;
    const e1 = await c.location('LGAV').catch((e) => e);
    expect(e1).toBeInstanceOf(NotamSourceError);
    expect(e1.message).toBe(`${NMS_LABEL} answered HTTP 401: Unauthorized`);
    m.state.revoked = new Set();
    m.state.fail = 503;
    const e2 = await c.location('LGAV').catch((e) => e);
    expect(e2.message).toBe(`${NMS_LABEL} answered HTTP 503: Service unavailable`);
    m.state.tokenStatus = 401;
    const e3 = await new NmsClient(settings(m)).accessToken().catch((e) => e);
    expect(e3).toBeInstanceOf(NotamSourceError);
    expect(e3.message).toBe(`${NMS_LABEL}: sign-in refused`);
    for (const e of [e1, e2, e3]) expect(e.message).not.toMatch(/FAA|csecret/i);
  });

  test('the driver: every pilot, cached 15 minutes, a label that never says FAA; one client per settings', () => {
    const m = mockNms();
    const s = settings(m);
    const d = nmsNotamSource(s);
    expect(d).toMatchObject({ id: 'nms', label: 'International NOTAM feed', cacheTtlMs: 15 * 60e3 });
    expect(d.label).not.toMatch(/FAA|federal|aviation administration/i);
    expect(d.availableFor({ pilotId: 'a', ownerId: 'b' })).toBe(true);
    expect(NmsClient.for(s)).toBe(NmsClient.for(s));
  });

  test('NMS_BASE, NMS_CLIENT_ID, NMS_CLIENT_SECRET; the default order puts it between autorouter and Notamify', () => {
    expect(nmsFromEnv({})).toBeNull();
    expect(nmsFromEnv({ NMS_BASE: 'https://x.test', NMS_CLIENT_ID: 'a' })).toBeNull();
    expect(nmsFromEnv({ NMS_BASE: ' https://x.test/ ', NMS_CLIENT_ID: ' a ', NMS_CLIENT_SECRET: 'b' })).toEqual({
      baseUrl: 'https://x.test',
      clientId: 'a',
      clientSecret: 'b',
    });
    expect(configFromEnv({ SHEET_PDF: 'off' }).nms).toBeNull();
    expect(NOTAM_SOURCE_IDS).toEqual(['autorouter', 'nms', 'notamify']);
  });
});

// ---------------------------------------------------------------- with the other sources

describe('merged with autorouter', () => {
  test('the same NOTAM from both: one record, both sources', () => {
    const nms = fromNms(byNumber('A4147/26'), 'LGAV')!;
    const ar = fromAutorouterRow({
      id: 99,
      series: 'A',
      number: 4147,
      year: 26,
      type: 'R',
      referredseries: 'A',
      referrednumber: 4131,
      referredyear: 26,
      fir: 'LGGG',
      code23: 'OB',
      code45: 'CE',
      traffic: 'IV',
      purpose: 'M',
      scope: 'AE',
      lower: 0,
      upper: 4,
      itema: ['LGAV'],
      startvalidity: T('2026-11-09T09:43:00Z') / 1000,
      endvalidity: T('2026-12-31T23:59:00Z') / 1000,
      iteme: 'FOUR TOWER CRANES ERECTED …',
    })!;
    const replaced = { ...fromNms(byNumber('A4147/26'))!, number: 4131, type: 'N' as const, refers: null };
    const out = mergeNotams([ar, nms, replaced], ['autorouter', 'nms', 'notamify']);
    expect(out).toHaveLength(1);
    expect(out[0].sources).toEqual(['autorouter', 'nms']);
    // the most complete record: NMS's, with its Q-line position and ICAO text
    expect(out[0].notam).toMatchObject({ source: 'nms', center: { lat: 37.93333, lon: 23.95 } });
  });

  test('freshness per source: the latest issue time and the highest number of the queried FIR', async () => {
    const list = [byNumber('A3462/26'), byNumber('A4147/26'), byNumber('A5198/26')].map((f) => fromNms(f)!);
    // A5198/26 is the Turkish office's (LTXX), not counted against LGGG's numbers
    expect(freshness(list, ['LGAV', 'LGGG'])).toEqual({
      newestIssued: T('2026-11-16T13:46:00Z'),
      newestNotam: 'A4147/26',
    });
    const ar: RawNotam = { ...blankNotam('autorouter'), series: 'A', number: 4400, year: 26, fir: 'LGGG' };
    const g = await gatherNotams(
      [
        { id: 'autorouter', label: 'autorouter', availableFor: () => true, fetch: async () => [ar] },
        { id: 'nms', label: NMS_LABEL, availableFor: () => true, fetch: async () => list },
      ],
      { locations: ['LGGG'], window: { from: 0, to: 1 } },
    );
    expect(g.statuses.map((s) => [s.id, s.newestIssued, s.newestNotam])).toEqual([
      ['autorouter', null, 'A4400/26'],
      ['nms', T('2026-11-16T13:46:00Z'), 'A4147/26'],
    ]);
  });
});

describe('foreign offices’ NOTAMs naming the FIR', () => {
  const window = { from: T('2026-11-24T06:00:00Z'), to: T('2026-11-24T12:00:00Z') };
  const route = [
    { lat: 37.94, lon: 23.94 },
    { lat: 37.44, lon: 24.94 },
  ];
  const inp = { route, aerodromes: new Map([['LGAV', 'departure']]), window, maxAltFt: 30000, corridorNm: 10 };
  const turkish = (o: Partial<RawNotam> = {}) =>
    toNotam({
      ...fromNms(byNumber('A5198/26'), 'LGGG')!,
      code23: 'RT',
      code45: 'CA',
      raw: null,
      itemE: 'EXERCISE',
      ...o,
    })!;

  test('whole-FIR (LTXX, 357 NM): hidden; the same from the home FIR is shown', () => {
    const [n] = assessNotams([turkish()], { ...inp, homeFir: 'LGGG' });
    expect(n.relevant).toBe(false);
    expect(n.reasons).toEqual(['LTXX NOTAM, not shown to be on the route']);
    expect(assessNotams([turkish({ fir: 'LGGG' })], { ...inp, homeFir: 'LGGG' })[0]).toMatchObject({
      relevant: true,
      reasons: ['whole FIR'],
    });
    // no position: hidden too
    expect(assessNotams([turkish({ center: null, radiusNm: null })], { ...inp, homeFir: 'LGGG' })[0].relevant).toBe(
      false,
    );
  });

  test('its area within the corridor, or an aerodrome the flight uses: shown', () => {
    const near = turkish({ center: { lat: 37.7, lon: 24.4 }, radiusNm: 5 });
    expect(assessNotams([near], { ...inp, homeFir: 'LGGG' })[0]).toMatchObject({ relevant: true });
    const far = turkish({ center: { lat: 38.8, lon: 26.5 }, radiusNm: 20 });
    expect(assessNotams([far], { ...inp, homeFir: 'LGGG' })[0].reasons[0]).toMatch(/NM from the route$/);
    const atField = turkish({ itemA: ['LGAV'] });
    expect(assessNotams([atField], { ...inp, homeFir: 'LGGG' })[0]).toMatchObject({
      relevant: true,
      reasons: ['departure LGAV'],
    });
  });

  test('the real feature (QAFXX) and the multi-part warning off the route: hidden', () => {
    const list = ['A5198/26', 'A4808/26'].map((x) => toNotam(fromNms(byNumber(x), 'LGGG')!)!);
    const out = assessNotams(list, { ...inp, homeFir: 'LGGG' });
    expect(out.every((n) => !n.relevant)).toBe(true);
  });
});

// ---------------------------------------------------------------- the route

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (id: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.id === id)!;
  return { uid, kind: 'aerodrome', refId: id, name: id, lat: a.lat, lon: a.lon };
};

/** The feature made permanent, so that it stays valid for flights tomorrow whenever the test runs. */
function perm(n: string): NmsFeature {
  const f = structuredClone(byNumber(n));
  const core = f.properties!.coreNOTAMData!;
  core.notam!.effectiveEnd = 'PERM';
  for (const t of core.notamTranslation ?? []) t.formattedText = t.formattedText?.replace(/C\) \d{10}/, 'C) PERM');
  return f;
}

describe('briefing from the international feed', () => {
  const m = mockNms({
    byLocation: {
      LGAV: { status: 'Success', data: { geojson: [perm('A4147/26')] } },
      LGGG: { status: 'Success', data: { geojson: [perm('A3462/26')] } },
    },
  });
  let server: ReturnType<typeof createServer>;
  let me: Client;
  beforeAll(async () => {
    server = createServer({
      db: 'memory://',
      googleClientId: CID,
      googleKeys: async () => [JWK],
      nms: settings(m),
      client: (_q, r) => {
        r.writeHead(404);
        r.end();
      },
    });
    await server.ready;
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    me = client(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`);
    await me.login('nms-me', 'pilot@example.com');
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  test('every pilot; labelled without the provider; cached per location', async () => {
    const date = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
    const id = (
      await me.call('POST', 'flights', {
        date,
        blockOff: '08:00',
        taxiOutMin: 10,
        taxiInMin: 10,
        route: [pt('LGAV', 'a'), pt('LGMG', 'b')],
      })
    ).body.id;
    const b = (await me.call('GET', `flights/${id}/notams`)).body;
    expect(b).toMatchObject({ status: 'ok', source: 'nms' });
    expect(b.sources[0]).toMatchObject({ id: 'nms', label: 'International NOTAM feed', status: 'ok' });
    expect(JSON.stringify(b.sources)).not.toMatch(/FAA/);
    expect(b.notams.find((n: any) => n.key === 'A4147/26')).toMatchObject({ relevant: true, sources: ['nms'] });
    const asked = m.calls.length;
    expect((await me.call('GET', `flights/${id}/notams?refresh=1`)).body.status).toBe('ok');
    expect(m.calls.length).toBeGreaterThan(asked);
    const again = m.calls.length;
    const id2 = (
      await me.call('POST', 'flights', {
        date,
        blockOff: '10:00',
        taxiOutMin: 10,
        taxiInMin: 10,
        route: [pt('LGAV', 'a'), pt('LGMG', 'b')],
      })
    ).body.id;
    expect((await me.call('GET', `flights/${id2}/notams`)).body.status).toBe('ok');
    expect(m.calls.length).toBe(again);
  });
});
