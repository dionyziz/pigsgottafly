// NOTAM sources (api/_lib/notamSources/): each source's normalization, the ICAO text reader, merging
// and de-duplication with replacement chains, the multiplexer with a source failing or timing out,
// the Notamify client (mocked fetch: batching, auth, pages, errors, credits), the per-location cache,
// and the briefing route with two sources, including autorouter's licence gate.
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { configFromEnv } from '../../api/_lib/app';
import { toNotam } from '../../api/_lib/notams';
import { fromAutorouterRow } from '../../api/_lib/notamSources/autorouter';
import { cached, dayBucket, type NotamCacheStore } from '../../api/_lib/notamSources/cache';
import { icaoTime, parseIcaoNotam } from '../../api/_lib/notamSources/icao';
import { sourceOrderFromEnv } from '../../api/_lib/notamSources/index';
import { mergeNotams } from '../../api/_lib/notamSources/merge';
import { gatherNotams } from '../../api/_lib/notamSources/multiplex';
import {
  fromNotamify,
  NotamifyClient,
  notamifyFromEnv,
  type NotamifyNotam,
} from '../../api/_lib/notamSources/notamify';
import {
  blankNotam,
  type NotamSourceDriver,
  NotamSourceError,
  parseNotamId,
  type RawNotam,
} from '../../api/_lib/notamSources/types';
import { createServer } from '../../server/server';
import aerodromes from '../../src/data/ref/aerodromes.json';
import type { RefAerodrome } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import { CID, type Client, client, JWK } from './helpers';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const ad = (id: string) => ADS.find((a) => a.id === id)!;
const pt = (id: string, uid: string): RoutePoint => ({
  uid,
  kind: 'aerodrome',
  refId: id,
  name: id,
  lat: ad(id).lat,
  lon: ad(id).lon,
});

const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
const at = (hhmm: string) => Date.parse(`${tomorrow}T${hhmm}:00Z`);
/** YYMMDDHHMM */
const icao = (ms: number) => new Date(ms).toISOString().replace(/\D/g, '').slice(2, 12);
const mid = { lat: (ad('LGTT').lat + ad('LGMG').lat) / 2, lon: (ad('LGTT').lon + ad('LGMG').lon) / 2 };
const dm = (v: number, w: number) => {
  const d = Math.floor(Math.abs(v));
  return String(d).padStart(w, '0') + String(Math.round((Math.abs(v) - d) * 60)).padStart(2, '0');
};
const qPos = (p: { lat: number; lon: number }, r: number) =>
  `${dm(p.lat, 2)}N${dm(p.lon, 3)}E${String(r).padStart(3, '0')}`;

/** A NOTAM in ICAO format. */
function icaoText(o: {
  id: string;
  type?: 'N' | 'R' | 'C';
  refers?: string;
  q?: string | null;
  a?: string;
  e?: string;
  from?: number;
  to?: number | 'PERM';
}): string {
  const q = o.q === undefined ? `LGGG/QRTCA/IV/BO/W/000/050/${qPos(mid, 3)}` : o.q;
  return [
    `${o.id} NOTAM${o.type ?? 'N'}${o.refers ? ' ' + o.refers : ''}`,
    q ? `Q) ${q}` : '',
    `A) ${o.a ?? 'LGGG'} B) ${icao(o.from ?? at('06:00'))} C) ${o.to === 'PERM' ? 'PERM' : icao(o.to ?? at('12:00'))}`,
    `E) ${o.e ?? 'TEST'}`,
    'F) SFC G) 5000FT AMSL',
  ]
    .filter(Boolean)
    .join('\n');
}

const raw = (o: Partial<RawNotam>): RawNotam => ({
  ...blankNotam('autorouter'),
  series: 'A',
  year: 26,
  fir: 'LGGG',
  code23: 'RT',
  code45: 'CA',
  itemA: ['LGGG'],
  from: at('06:00'),
  to: at('12:00'),
  itemE: 'TEST',
  ...o,
});

// ---------------------------------------------------------------- reading

describe('ICAO text', () => {
  test('header, Q line, items A–G; F and G after a free-text E that quotes markers', () => {
    const p = parseIcaoNotam(
      `A1234/26 NOTAMR A1200/26\nQ) LGGG/QRTCA/IV/BO/W/000/050/3802N02334E003\nA) LGGG B) 2611230600 C) 2611231800 EST\nD) 0600-1800\nE) AREA A) AS FLW 380600N 0233000E.\nF) SFC G) 5000FT AMSL)`,
    );
    expect(p).toMatchObject({
      series: 'A',
      number: 1234,
      year: 26,
      type: 'R',
      refers: { series: 'A', number: 1200, year: 26 },
      fir: 'LGGG',
      code23: 'RT',
      code45: 'CA',
      traffic: 'IV',
      purpose: 'BO',
      scope: 'W',
      lowerFl: 0,
      upperFl: 50,
      radiusNm: 3,
      itemA: ['LGGG'],
      from: Date.UTC(2026, 10, 23, 6, 0),
      to: Date.UTC(2026, 10, 23, 18, 0),
      estimated: true,
      itemD: '0600-1800',
      itemE: 'AREA A) AS FLW 380600N 0233000E.',
      itemF: 'SFC',
      itemG: '5000FT AMSL',
    });
    expect(p.center!.lat).toBeCloseTo(38 + 2 / 60, 4);
    expect(p.center!.lon).toBeCloseTo(23 + 34 / 60, 4);
    expect(parseIcaoNotam('A0001/26 NOTAMN\nA) LGAV B) 2611230600 C) PERM\nE) RWY CLSD')).toMatchObject({
      itemA: ['LGAV'],
      to: null,
      itemE: 'RWY CLSD',
    });
    expect(parseIcaoNotam('A0001/26 NOTAMN\nA) LGAV B) 2611230600 C) PERM\nE) RWY CLSD').fir).toBeUndefined();
    expect(parseIcaoNotam('')).toEqual({});
    expect(icaoTime('2613011200')).toBeNull();
  });
  test('NOTAM numbers', () => {
    expect(parseNotamId('A1234/26')).toEqual({ series: 'A', number: 1234, year: 26 });
    expect(parseNotamId('a12/2026')).toEqual({ series: 'A', number: 12, year: 26 });
    expect(parseNotamId('1234/26')).toBeNull();
  });
});

describe('normalization per source', () => {
  test('autorouter row: Garmin units, PERM, referred NOTAM', () => {
    const G = 2 ** 30 / 90;
    const r = fromAutorouterRow({
      id: 7,
      series: 'a',
      number: 5,
      year: 26,
      type: 'R',
      referredseries: 'A',
      referrednumber: 3,
      referredyear: 2026,
      fir: 'lggg',
      code23: 'rt',
      code45: 'ca',
      lat: Math.round(38 * G),
      lon: Math.round(23.5 * G),
      radius: 3,
      lower: 0,
      upper: 50,
      itema: ['lggg'],
      startvalidity: 1_800_000_000,
      endvalidity: 2 ** 32 - 1,
      iteme: 'X',
    })!;
    expect(r).toMatchObject({
      source: 'autorouter',
      sourceId: '7',
      series: 'A',
      number: 5,
      type: 'R',
      refers: { series: 'A', number: 3, year: 26 },
      fir: 'LGGG',
      code23: 'RT',
      itemA: ['LGGG'],
      from: 1_800_000_000_000,
      to: null,
    });
    expect(r.center!.lat).toBeCloseTo(38, 4);
    expect(fromAutorouterRow({ series: 'A' })).toBeNull();
  });
  test('Notamify: the ICAO text first; its own fields where the text is silent', () => {
    const full = fromNotamify({
      id: 'u1',
      notam_number: 'A0002/26',
      location: 'LGGG',
      starts_at: '2099-01-01T00:00:00',
      ends_at: '2099-01-02T00:00:00',
      is_estimated: false,
      is_permanent: false,
      message: 'TEST',
      icao_message: icaoText({ id: 'A0002/26' }),
    });
    expect(full).toMatchObject({
      source: 'notamify',
      sourceId: 'u1',
      series: 'A',
      number: 2,
      year: 26,
      fir: 'LGGG',
      code23: 'RT',
      itemA: ['LGGG'],
      from: at('06:00'),
      to: at('12:00'),
      itemE: 'TEST',
      itemG: '5000FT AMSL',
      location: 'LGGG',
    });
    expect(full.raw).toMatch(/^A0002\/26 NOTAMN\nQ\) LGGG/);
    // no ICAO text: the record's fields
    const bare = fromNotamify({
      id: 'u2',
      notam_number: 'A0010/26',
      notam_type: 'replacement',
      referenced_notam_number: 'A0009/26',
      icao_code: 'LGMG',
      location: 'LGMG',
      qcode: 'QMRLC',
      starts_at: '2026-11-23T06:00:00Z',
      ends_at: '2026-11-23T12:00:00',
      is_estimated: true,
      is_permanent: false,
      message: 'RWY 08/26 CLSD',
    });
    expect(bare).toMatchObject({
      series: 'A',
      number: 10,
      type: 'R',
      refers: { series: 'A', number: 9, year: 26 },
      fir: null,
      code23: 'MR',
      code45: 'LC',
      center: null,
      itemA: ['LGMG'],
      from: Date.UTC(2026, 10, 23, 6),
      to: Date.UTC(2026, 10, 23, 12),
      estimated: true,
      itemE: 'RWY 08/26 CLSD',
      raw: null,
    });
    expect(
      fromNotamify({ notam_number: 'A0011/26', starts_at: '2026-11-23T06:00:00Z', is_permanent: true }).to,
    ).toBeNull();
    // toNotam: a decoded Notam, the ICAO text kept
    const n = toNotam(full)!;
    expect(n).toMatchObject({
      key: 'A0002/26',
      qcode: 'QRTCA',
      subject: 'Temporary restricted area',
      sources: ['notamify'],
    });
    expect(n.raw).toBe(full.raw);
  });
});

// ---------------------------------------------------------------- merging

describe('merge and de-duplicate', () => {
  test('the same NOTAM from two sources: one record, the most complete, gaps filled from the other', () => {
    const ar = raw({ number: 2, source: 'autorouter', center: null, radiusNm: null, itemF: null, itemG: null });
    const nf = raw({
      number: 2,
      source: 'notamify',
      center: { lat: 38, lon: 23.5 },
      radiusNm: 3,
      itemG: '5000FT AMSL',
      raw: 'A0002/26 NOTAMN …',
    });
    const out = mergeNotams([ar, nf], ['autorouter', 'notamify']);
    expect(out).toHaveLength(1);
    expect(out[0].sources).toEqual(['autorouter', 'notamify']);
    expect(out[0].notam).toMatchObject({ source: 'notamify', center: { lat: 38, lon: 23.5 }, itemG: '5000FT AMSL' });
  });
  test('a record without a Q line (no FIR) matches by its location; the Q line is taken from the other', () => {
    const ar = raw({ number: 1, itemA: ['LGMG'], center: { lat: 37.98, lon: 23.37 }, radiusNm: 5 });
    const nf = raw({
      number: 1,
      source: 'notamify',
      fir: null,
      code23: 'MR',
      code45: 'LC',
      center: null,
      traffic: null,
      itemA: ['LGMG'],
      raw: 'A0001/26 NOTAMN\nA) LGMG …',
    });
    const out = mergeNotams([nf, ar], ['notamify', 'autorouter']);
    expect(out).toHaveLength(1);
    expect(out[0].notam).toMatchObject({ source: 'autorouter', fir: 'LGGG', raw: 'A0001/26 NOTAMN\nA) LGMG …' });
    expect(out[0].sources).toEqual(['notamify', 'autorouter']);
  });
  test('equally complete: the source listed first wins', () => {
    const a = raw({ number: 4, itemE: 'FROM AUTOROUTER' });
    const b = raw({ number: 4, source: 'notamify', itemE: 'FROM NOTAMIFY' });
    expect(mergeNotams([a, b], ['notamify', 'autorouter'])[0].notam.itemE).toBe('FROM NOTAMIFY');
    expect(mergeNotams([a, b], ['autorouter', 'notamify'])[0].notam.itemE).toBe('FROM AUTOROUTER');
  });
  test('the same number from another office (FIR) is another NOTAM', () => {
    const out = mergeNotams(
      [raw({ number: 5 }), raw({ number: 5, source: 'notamify', fir: 'LTAA', itemA: ['LTAA'] })],
      [],
    );
    expect(out).toHaveLength(2);
  });
  test('replacement chains: NOTAMR supersedes, NOTAMC cancels (the NOTAMC stays), across sources', () => {
    const list = [
      raw({ number: 10 }),
      raw({ number: 11, source: 'notamify', type: 'R', refers: { series: 'A', number: 10, year: 26 } }),
      raw({ number: 12, type: 'R', refers: { series: 'A', number: 11, year: 26 } }),
      raw({ number: 20, source: 'notamify' }),
      raw({ number: 21, type: 'C', refers: { series: 'A', number: 20, year: 26 } }),
      // names a NOTAM of another office: nothing removed
      raw({ number: 30 }),
      raw({ number: 31, fir: 'LTAA', itemA: ['LTAA'], type: 'C', refers: { series: 'A', number: 30, year: 26 } }),
    ];
    const keys = mergeNotams(list, ['autorouter', 'notamify'])
      .map((m) => m.notam.number)
      .sort((a, b) => a! - b!);
    expect(keys).toEqual([12, 21, 30, 31]);
  });
  test('records without a number are kept as they are', () => {
    expect(mergeNotams([raw({ series: null, number: null }), raw({ series: null, number: null })], [])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- multiplexer

const driver = (o: Partial<NotamSourceDriver> & Pick<NotamSourceDriver, 'id' | 'fetch'>): NotamSourceDriver => ({
  label: o.id,
  availableFor: () => true,
  ...o,
});

describe('multiplexer', () => {
  test('all sources at once; a failing and a slow source cost only their own NOTAMs', async () => {
    let aborted = false;
    const started: string[] = [];
    const g = await gatherNotams(
      [
        driver({
          id: 'autorouter',
          fetch: async () => {
            started.push('autorouter');
            throw new NotamSourceError('backend down');
          },
        }),
        driver({
          id: 'notamify',
          label: 'Notamify',
          timeoutMs: 50,
          fetch: ({ signal }) => {
            started.push('notamify');
            signal!.addEventListener('abort', () => (aborted = true));
            return new Promise(() => {});
          },
        }),
      ],
      { locations: ['LGGG'], window: { from: 0, to: 1 } },
    );
    expect(started).toEqual(['autorouter', 'notamify']);
    expect(aborted).toBe(true);
    expect(g.notams).toEqual([]);
    expect(g.statuses).toEqual([
      { id: 'autorouter', label: 'autorouter', status: 'error', count: 0, message: 'backend down' },
      { id: 'notamify', label: 'Notamify', status: 'timeout', count: 0, message: 'no answer in 1 s' },
    ]);
  });
  test('one source down, the other answers: its NOTAMs, its status ok; unexpected errors are not shown', async () => {
    const g = await gatherNotams(
      [
        driver({ id: 'autorouter', fetch: async () => Promise.reject(new TypeError('secret detail')) }),
        driver({ id: 'notamify', fetch: async () => [raw({ number: 1, source: 'autorouter' }), raw({ number: 2 })] }),
      ],
      { locations: ['LGGG'], window: { from: 0, to: 1 } },
    );
    expect(g.statuses.map((s) => [s.status, s.count, s.message])).toEqual([
      ['error', 0, 'the NOTAM source failed'],
      ['ok', 2, null],
    ]);
    // labelled with the source that returned them
    expect(g.notams.map((m) => m.sources)).toEqual([['notamify'], ['notamify']]);
  });
});

// ---------------------------------------------------------------- Notamify client

interface NfCall {
  url: URL;
  auth: string | null;
}
function mockNotamify(opts: { notams?: NotamifyNotam[] } = {}) {
  const calls: NfCall[] = [];
  const state = { notams: opts.notams ?? [], fail: 0 as number, failMessage: '', retryAfter: '' };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ url, auth });
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    if (auth !== 'Bearer nf-key') return json(401, { status: 'error', message: 'Invalid or missing API key.' });
    if (state.fail) {
      const s = state.fail;
      if (s === 429) state.fail = 0;
      return json(s, { detail: state.failMessage }, state.retryAfter ? { 'Retry-After': state.retryAfter } : {});
    }
    if (url.pathname !== '/api/v2/notams/raw') return json(404, { detail: 'Not Found' });
    const locs = url.searchParams.getAll('location');
    if (locs.length > 5) return json(422, { detail: 'too many locations' });
    const rows = state.notams.filter((n) => locs.includes(n.location!));
    const page = +url.searchParams.get('page')!,
      per = +url.searchParams.get('per_page')!;
    return json(200, {
      notams: rows.slice((page - 1) * per, page * per),
      total_count: rows.length,
      page,
      per_page: per,
    });
  }) as typeof globalThis.fetch;
  return { calls, state, fetch };
}

const nfNotam = (n: number, location = 'LGGG', o: Partial<NotamifyNotam> = {}): NotamifyNotam => ({
  id: `nf-${location}-${n}`,
  notam_number: `A${String(n).padStart(4, '0')}/26`,
  location,
  starts_at: new Date(at('06:00')).toISOString(),
  ends_at: new Date(at('12:00')).toISOString(),
  is_estimated: false,
  is_permanent: false,
  message: 'TEST',
  icao_message: icaoText({ id: `A${String(n).padStart(4, '0')}/26`, a: location }),
  ...o,
});

describe('Notamify client', () => {
  test('5 locations a request, every page, bearer key, the window as UTC; 1 credit a page', async () => {
    const locs = ['LGTT', 'LGMG', 'LGEL', 'LGAV', 'LGMR', 'LGSY', 'LGGG'];
    const m = mockNotamify({ notams: [...Array.from({ length: 45 }, (_, i) => nfNotam(i + 1)), nfNotam(900, 'LGAV')] });
    const c = new NotamifyClient({ apiKey: 'nf-key', maxCredits: 40, fetch: m.fetch });
    const out = await c.notams(locs, at('07:00'), at('10:00'));
    expect(out).toHaveLength(46);
    expect(
      m.calls.map((x) => [x.url.searchParams.getAll('location').join(' '), x.url.searchParams.get('page')]),
    ).toEqual([
      ['LGTT LGMG LGEL LGAV LGMR', '1'],
      ['LGSY LGGG', '1'],
      ['LGSY LGGG', '2'],
    ]);
    expect(m.calls.every((x) => x.auth === 'Bearer nf-key')).toBe(true);
    expect(m.calls[0].url.searchParams.get('starts_at')).toBe(new Date(at('07:00')).toISOString().replace('.000', ''));
    expect(m.calls[0].url.searchParams.get('per_page')).toBe('30');
    expect(c.credits).toBe(3);
  });
  test('a start more than a day ago is moved up (the API refuses it); a window in the past asks nothing', async () => {
    const m = mockNotamify();
    const now = Date.now();
    const c = new NotamifyClient({ apiKey: 'nf-key', maxCredits: 5, fetch: m.fetch, now: () => now });
    await c.notams(['LGGG'], now - 3 * 86400e3, now + 3600e3);
    expect(Date.parse(m.calls[0].url.searchParams.get('starts_at')!)).toBeGreaterThan(now - 86400e3);
    expect(await c.notams(['LGGG'], now - 5 * 86400e3, now - 2 * 86400e3)).toEqual([]);
    expect(m.calls).toHaveLength(1);
  });
  test('errors: a refused key, an HTTP error with its message, a short 429 waited out, the credit cap', async () => {
    const m = mockNotamify({ notams: Array.from({ length: 70 }, (_, i) => nfNotam(i + 1)) });
    await expect(
      new NotamifyClient({ apiKey: 'wrong', maxCredits: 5, fetch: m.fetch }).notams(['LGGG'], at('07:00'), at('09:00')),
    ).rejects.toThrow('Notamify refused the API key');
    const waits: number[] = [];
    const c = new NotamifyClient({
      apiKey: 'nf-key',
      maxCredits: 2,
      fetch: m.fetch,
      sleep: async (ms) => void waits.push(ms),
    });
    m.state.fail = 500;
    m.state.failMessage = 'upstream unavailable';
    await expect(c.notams(['LGGG'], at('07:00'), at('09:00'))).rejects.toThrow(
      'Notamify answered HTTP 500: upstream unavailable',
    );
    m.state.fail = 429;
    m.state.retryAfter = '2';
    // 70 NOTAMs = 3 pages, 2 credits allowed: an incomplete list is an error, not a briefing
    await expect(c.notams(['LGGG'], at('07:00'), at('09:00'))).rejects.toBeInstanceOf(NotamSourceError);
    expect(waits).toEqual([2000]);
    m.state.fail = 429;
    m.state.retryAfter = '60';
    await expect(c.notams(['LGGG'], at('07:00'), at('09:00'))).rejects.toThrow(/too many requests/);
  });
  test('NOTAMIFY_API_KEY, NOTAMIFY_MAX_CREDITS, NOTAM_SOURCES', () => {
    expect(notamifyFromEnv({})).toBeNull();
    expect(notamifyFromEnv({ NOTAMIFY_API_KEY: ' k ' })).toEqual({ apiKey: 'k', maxCredits: 40 });
    expect(notamifyFromEnv({ NOTAMIFY_API_KEY: 'k', NOTAMIFY_MAX_CREDITS: '12' })!.maxCredits).toBe(12);
    expect(sourceOrderFromEnv(undefined)).toBeUndefined();
    expect(sourceOrderFromEnv(' Notamify, autorouter ,bogus')).toEqual(['notamify', 'autorouter']);
    expect(configFromEnv({ NOTAMIFY_API_KEY: 'k', NOTAM_SOURCES: 'notamify' })).toMatchObject({
      notamify: { apiKey: 'k' },
      notamSources: ['notamify'],
    });
  });
});

// ---------------------------------------------------------------- cache

function memoryStore(): NotamCacheStore & { rows: Map<string, { fetched: number; notams: RawNotam[] }> } {
  const rows = new Map<string, { fetched: number; notams: RawNotam[] }>();
  return {
    rows,
    async get(source, bucket, locations, since) {
      const out = new Map<string, RawNotam[]>();
      for (const l of locations) {
        const r = rows.get(`${source}|${bucket}|${l}`);
        if (r && r.fetched > since) out.set(l, r.notams);
      }
      return out;
    },
    async put(source, bucket, put, fetched) {
      for (const [l, notams] of put) rows.set(`${source}|${bucket}|${l}`, { fetched, notams });
    },
  };
}

describe('per-location cache', () => {
  test('whole UTC days; what is fresh is not asked again; refresh asks again; expiry', async () => {
    expect(dayBucket({ from: at('07:00'), to: at('10:00') })).toEqual({
      from: at('00:00'),
      to: at('00:00') + 86400e3,
      key: `${tomorrow}..${tomorrow}`,
    });
    const asked: string[][] = [];
    const d = driver({
      id: 'notamify',
      cacheTtlMs: 60e3,
      fetch: async ({ locations, window }) => {
        asked.push(locations);
        expect(window).toEqual({ from: at('00:00'), to: at('00:00') + 86400e3 });
        return locations.map((l, i) => raw({ number: i + 1, source: 'notamify', itemA: [l], fir: null }));
      },
    });
    const store = memoryStore();
    let now = 1_000_000;
    const w = { from: at('07:00'), to: at('10:00') };
    expect(await cached(d, store, { now: () => now }).fetch({ locations: ['LGTT', 'LGGG'], window: w })).toHaveLength(
      2,
    );
    expect(await cached(d, store, { now: () => now }).fetch({ locations: ['LGGG', 'LGMG'], window: w })).toHaveLength(
      2,
    );
    expect(asked).toEqual([['LGTT', 'LGGG'], ['LGMG']]);
    await cached(d, store, { now: () => now, refresh: true }).fetch({ locations: ['LGGG'], window: w });
    now += 61e3;
    await cached(d, store, { now: () => now }).fetch({ locations: ['LGTT'], window: w });
    expect(asked.slice(2)).toEqual([['LGGG'], ['LGTT']]);
    // a source without a cacheTtlMs is not wrapped
    const plain = driver({ id: 'autorouter', fetch: async () => [] });
    expect(cached(plain, store)).toBe(plain);
  });
});

// ---------------------------------------------------------------- the briefing route, two sources

const G = 2 ** 30 / 90;
const arRow = (o: Record<string, unknown>) => ({
  id: Math.floor(Math.random() * 1e6),
  series: 'A',
  number: 1,
  year: 26,
  type: 'N',
  fir: 'LGGG',
  code23: 'RT',
  code45: 'CA',
  traffic: 'IV',
  purpose: 'BO',
  scope: 'W',
  lower: 0,
  upper: 50,
  lat: Math.round(mid.lat * G),
  lon: Math.round(mid.lon * G),
  radius: 3,
  itema: ['LGGG'],
  startvalidity: Math.floor(at('06:00') / 1000),
  endvalidity: Math.floor(at('12:00') / 1000),
  iteme: 'TEST',
  itemf: 'SFC',
  itemg: '5000FT AMSL',
  ...o,
});
function mockAutorouter(rows: () => unknown[]) {
  const calls: string[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith('/oauth2/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.pathname.endsWith('/notam')) {
      const items = JSON.parse(url.searchParams.get('itemas')!) as string[];
      const all = rows().filter((r: any) => r.itema.some((a: string) => items.includes(a)));
      return json(200, { total: all.length, rows: all });
    }
    return json(404, { error: 'no such endpoint' });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

describe('briefing from autorouter and Notamify', () => {
  const ar = mockAutorouter(() => [
    arRow({ number: 1, itema: ['LGMG'], code23: 'MR', code45: 'LC', lat: 0, lon: 0, iteme: 'RWY 08/26 CLSD' }),
    arRow({ number: 2 }), // also from Notamify, without a Q line there
    arRow({ number: 3 }), // replaced by Notamify's A0004/26
  ]);
  const nf = mockNotamify({
    notams: [
      nfNotam(2, 'LGGG', { icao_message: null, message: 'TEST FROM NOTAMIFY', qcode: 'QRTCA' }),
      nfNotam(4, 'LGGG', { icao_message: icaoText({ id: 'A0004/26', type: 'R', refers: 'A0003/26' }) }),
      nfNotam(5, 'LGGG'),
    ],
  });
  let server: ReturnType<typeof createServer>;
  let base: string;
  let me: Client, other: Client, mine: string;
  beforeAll(async () => {
    server = createServer({
      db: 'memory://',
      googleClientId: CID,
      googleKeys: async () => [JWK],
      autorouter: { email: 'app@example.com', password: 's3cret', filing: false, fetch: ar.fetch },
      autorouterPilots: ['owner@example.com'],
      notamify: { apiKey: 'nf-key', maxCredits: 40, fetch: nf.fetch },
      client: (_q, r) => {
        r.writeHead(404);
        r.end();
      },
    });
    await server.ready;
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
    me = client(base);
    other = client(base);
    await me.login('m-me', 'owner@example.com');
    await other.login('m-other', 'other@example.com');
    mine = (
      await me.call('POST', 'flights', {
        date: tomorrow,
        blockOff: '08:00',
        taxiOutMin: 10,
        taxiInMin: 10,
        route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      })
    ).body.id;
    expect((await me.call('POST', `flights/${mine}/shares`, { email: 'other@example.com', role: 'view' })).status).toBe(
      201,
    );
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  test('merged: one record per NOTAM, replaced ones gone, every source listed', async () => {
    const b = (await me.call('GET', `flights/${mine}/notams`)).body;
    expect(b).toMatchObject({ status: 'ok', source: 'autorouter' });
    expect(b.sources).toEqual([
      {
        id: 'autorouter',
        label: 'autorouter',
        status: 'ok',
        count: 3,
        message: null,
        newestIssued: null,
        newestNotam: 'A0003/26',
      },
      {
        id: 'notamify',
        label: 'Notamify',
        status: 'ok',
        count: 3,
        message: null,
        newestIssued: null,
        newestNotam: 'A0005/26',
      },
    ]);
    const by = Object.fromEntries(b.notams.map((n: any) => [n.key, n]));
    expect(Object.keys(by).sort()).toEqual(['A0001/26', 'A0002/26', 'A0004/26', 'A0005/26']);
    expect(by['A0001/26'].sources).toEqual(['autorouter']);
    expect(by['A0002/26'].sources).toEqual(['autorouter', 'notamify']);
    expect(by['A0002/26'].center).not.toBeNull(); // autorouter's Q line
    expect(by['A0004/26']).toMatchObject({ type: 'R', refers: 'A0003/26', sources: ['notamify'] });
    expect(by['A0005/26'].raw).toMatch(/^A0005\/26 NOTAMN/);
    // Notamify asked in batches of 5 for the window's whole day
    expect(nf.calls.every((c) => c.url.searchParams.getAll('location').length <= 5)).toBe(true);
    expect(nf.calls[0].url.searchParams.get('starts_at')).toBe(`${tomorrow}T00:00:00Z`);
  });

  test('another pilot on the shared flight: Notamify only, nothing autorouter alone returned, no stored briefing', async () => {
    const n = ar.calls.length;
    const b = (await other.call('GET', `flights/${mine}/notams`)).body;
    expect(b).toMatchObject({ status: 'ok', source: 'notamify' });
    expect(b.sources.map((s: any) => s.id)).toEqual(['notamify']);
    expect(b.notams.map((x: any) => x.key).sort()).toEqual(['A0002/26', 'A0004/26', 'A0005/26']);
    expect(b.notams.every((x: any) => x.sources.join() === 'notamify')).toBe(true);
    // Notamify's own record of A0002/26 (no Q line), not autorouter's
    expect(b.notams.find((x: any) => x.key === 'A0002/26')).toMatchObject({ center: null, text: 'TEST FROM NOTAMIFY' });
    expect(ar.calls.length).toBe(n);
  });

  test('Notamify cached per location and day across flights; refresh asks again', async () => {
    const n = nf.calls.length;
    const second = (
      await me.call('POST', 'flights', {
        date: tomorrow,
        blockOff: '11:00',
        taxiOutMin: 10,
        taxiInMin: 10,
        route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      })
    ).body.id;
    expect((await me.call('GET', `flights/${second}/notams`)).body.status).toBe('ok');
    expect(nf.calls.length).toBe(n);
    await me.call('GET', `flights/${second}/notams?refresh=1`);
    expect(nf.calls.length).toBeGreaterThan(n);
  });

  test('Notamify down: the briefing from autorouter, the failure in the statuses, not kept as complete', async () => {
    nf.state.fail = 503;
    nf.state.failMessage = 'maintenance';
    const b = (await me.call('GET', `flights/${mine}/notams?refresh=1`)).body;
    expect(b.status).toBe('ok');
    expect(b.sources[1]).toMatchObject({
      id: 'notamify',
      status: 'error',
      message: 'Notamify answered HTTP 503: maintenance',
    });
    expect(b.notams.map((x: any) => x.key).sort()).toEqual(['A0001/26', 'A0002/26', 'A0003/26']);
    // the other pilot, whose only source is down, does not get the owner's stored briefing
    const seen = (await other.call('GET', `flights/${mine}/notams?refresh=1`)).body;
    expect(seen).toMatchObject({ status: 'error', notams: [], message: 'Notamify answered HTTP 503: maintenance' });
    nf.state.fail = 0;
    // a partial briefing is not served from the store: gathered again (Notamify from its own cache)
    const again = (await me.call('GET', `flights/${mine}/notams`)).body;
    expect(again.sources.map((s: any) => s.status)).toEqual(['ok', 'ok']);
    expect(again.fetched).toBeGreaterThan(b.fetched - 1);
  });
});
