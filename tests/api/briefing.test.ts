// NOTAM briefing and flight-plan filing, against a MOCKED autorouter API (nothing is sent to
// autorouter in tests): decoding, relevance to the flight, caching, "not configured" / "filing not
// enabled yet" states, file / delay / cancel / refresh, the action log, and AFTN addressees
// (AIP Greece ENR 1.11).
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { generateAddressees, northOfBoundary } from '../../api/_lib/addressees';
import type { AutorouterSettings } from '../../api/_lib/autorouter';
import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { assessNotams, normalizeNotam, parseLimit, upperAmslFt } from '../../api/_lib/notams';
import { createServer } from '../../server/server';
import { TERRAIN_GRID } from '../../src/calc/terrain';
import aerodromes from '../../src/data/ref/aerodromes.json';
import airspaces from '../../src/data/ref/airspaces.json';
import fis from '../../src/data/ref/fis.json';
import type { RefAerodrome, RefAirspace, RefFis } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import { CID, type Client, client, JWK } from './helpers';

const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const SPACES = ((airspaces as any).airspaces ?? airspaces) as RefAirspace[];
const ad = (id: string) => ADS.find((a) => a.id === id)!;
const pt = (id: string, uid: string): RoutePoint => ({
  uid,
  kind: 'aerodrome',
  refId: id,
  name: id,
  lat: ad(id).lat,
  lon: ad(id).lon,
});

// ---------------------------------------------------------------- mock autorouter

const G = 2 ** 30 / 90; // degrees → Garmin units
interface Call {
  method: string;
  path: string;
  body: any;
  auth: string | null;
}
function mockAutorouter() {
  const calls: Call[] = [];
  const state = {
    notams: [] as any[],
    tokens: 0,
    failNotams: false,
    rejectTokenOnce: false,
    status: 'filed',
    fileError: '',
    parseError: false,
    /** The message queue: what autorouter sent over AFTN. */
    queue: [] as any[],
  };
  let seq = 100;
  const aftn = (message: string, recipients: string[]) => ({
    id: ++seq,
    type: 'fplan_aftn_out',
    message: { fplid: 2763, message, priority: 'FF', recipients },
  });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1\.0/, '');
    const auth = new Headers(init?.headers).get('authorization');
    const body =
      typeof init?.body === 'string'
        ? path === '/oauth2/token'
          ? Object.fromEntries(new URLSearchParams(init.body))
          : JSON.parse(init.body)
        : null;
    calls.push({ method: init?.method || 'GET', path: path + url.search, body, auth });
    if (path === '/oauth2/token') {
      if (body.client_id !== 'app@example.com' || body.client_secret !== 's3cret')
        return json(400, { error: 'invalid_client', error_description: 'The client credentials are invalid' });
      state.tokens++;
      return json(200, { access_token: `tok${state.tokens}`, expires_in: 3600, token_type: 'Bearer' });
    }
    if (state.rejectTokenOnce) {
      state.rejectTokenOnce = false;
      return json(403, { error: 'invalid token' });
    }
    if (!auth?.startsWith('Bearer tok')) return json(403, { error: 'invalid token' });
    if (path === '/notam') {
      if (state.failNotams) return json(500, { error: 'backend down' });
      const items = JSON.parse(url.searchParams.get('itemas')!) as string[];
      const rows = state.notams.filter((n) => n.itema.some((a: string) => items.includes(a)));
      const off = +url.searchParams.get('offset')!,
        lim = +url.searchParams.get('limit')!;
      return json(200, { total: rows.length, rows: rows.slice(off, off + lim) });
    }
    if (path === '/router' && init?.method === 'POST') return new Response('LGTT-LGMG-6aff6ee6fbb39', { status: 200 });
    if (path === '/flightplan/file/LGTT-LGMG-6aff6ee6fbb39' && init?.method === 'POST') {
      if (state.fileError) return json(200, { error: state.fileError });
      if (state.parseError)
        return json(502, {
          error: 'flight plan parsing failed',
          code: 'PARSE_FAILED',
          data: { error2: [{ errorcode: 'FPLAN_ITEM7_INVALIDCALLSIGN', text: 'invalid callsign' }] },
        });
      const body = JSON.parse(String(init.body));
      state.queue.push(
        { id: 1, type: 'fplan_filed', message: { fplid: 2763 } },
        aftn(body.fpl.replace(/\n-E\/[\s\S]*\)$/, ')'), ['LGMGZTZX']), // the alternate: without item 19
        aftn(body.fpl.replace('REG/SXASV', 'REG/SXASV ORGN/KSTPXAAP'), [...body.addresses, 'LGTTYXYX']),
        { id: 4, type: 'fplan_aftn_out', message: { fplid: 999, message: '(FPL-OTHER)', recipients: [] } },
      );
      return json(200, { flightid: 2763, trackingkey: 'L5ZS', queued: false });
    }
    let m = /^\/flightplan\/file\/(\d+)$/.exec(path);
    if (m) return json(200, { flightplanid: +m[1], status: state.status, eobt: Math.floor(Date.now() / 1000) + 3600 });
    m = /^\/flightplan\/file\/(\d+)\/(delay|cancel)$/.exec(path);
    if (m) {
      if (m[2] === 'cancel') state.queue.push(aftn('(CNL-SXASV-LGTT0900-LGMG-DOF/261116)', ['LGGGZFZX', 'LGTTZTZX']));
      return json(200, { status: 'success' });
    }
    if (path === '/message') return json(200, state.queue);
    if (path === '/message/acknowledge') {
      const ids = new Set(JSON.parse(String(init!.body)));
      state.queue = state.queue.filter((x) => !ids.has(x.id));
      return json(200, []);
    }
    return json(404, { error: 'no such endpoint' });
  }) as typeof globalThis.fetch;
  return { calls, state, fetch };
}

/** The pilots of these tests who may use the autorouter account (AUTOROUTER_PILOTS). */
const AR_PILOTS = ['na@example.com', 'nb@example.com', 'fa@example.com', 'fb@example.com'];
async function start(autorouter: AutorouterSettings | null, autorouterPilots: string[] = AR_PILOTS) {
  const s = createServer({
    db: 'memory://',
    googleClientId: CID,
    googleKeys: async () => [JWK],
    autorouter,
    autorouterPilots,
    client: (_q, r) => {
      r.writeHead(404);
      r.end();
    },
  });
  await s.ready;
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/`,
    close: () => new Promise<void>((r) => s.close(() => r())),
  };
}

const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
const at = (hhmm: string) => Date.parse(`${tomorrow}T${hhmm}:00Z`);
async function newFlight(c: Client, route = [pt('LGTT', 'a'), pt('LGMG', 'b')]) {
  const f = (
    await c.call('POST', 'flights', { date: tomorrow, blockOff: '08:00', taxiOutMin: 10, taxiInMin: 10, route })
  ).body;
  expect(f.id).toBeTruthy();
  return f.id as string;
}

// ---------------------------------------------------------------- NOTAMs

const mid = { lat: (ad('LGTT').lat + ad('LGMG').lat) / 2, lon: (ad('LGTT').lon + ad('LGMG').lon) / 2 };
const notam = (o: Record<string, unknown>) => ({
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
  estimation: null,
  itemd: null,
  iteme: 'TEST',
  itemf: 'SFC',
  itemg: '5000FT AMSL',
  ...o,
});

describe('NOTAM decoding', () => {
  test('autorouter row → ICAO format with decoded Q code', () => {
    const n = normalizeNotam(
      notam({
        number: 825,
        code23: 'FA',
        code45: 'LT',
        itema: ['EDDS'],
        lat: 580814790,
        lon: 109959116,
        radius: 5,
        lower: 0,
        upper: 999,
        scope: 'A',
        purpose: 'NBO',
        traffic: 'IV',
        fir: 'EDGG',
        series: 'P',
        year: 17,
      }),
    )!;
    expect(n.key).toBe('P0825/17');
    expect(n.subject).toBe('Aerodrome');
    expect(n.condition).toBe('Limited to');
    expect(n.center!.lat).toBeCloseTo(48.68, 2); // 4840N00912E in the wiki example
    expect(n.center!.lon).toBeCloseTo(9.22, 2);
    expect(n.raw).toContain('Q) EDGG/QFALT/IV/NBO/A/000/999/4841N00913E005');
    expect(n.raw).toContain('A) EDDS B) ');
    expect(normalizeNotam(notam({ endvalidity: 2 ** 32 - 1 }))!.to).toBeNull();
    expect(normalizeNotam({} as any)).toBeNull();
  });
});

describe('NOTAM relevance: areas far below the leg', () => {
  const box = (lat: number, lon: number) =>
    normalizeNotam(
      notam({
        lat: Math.round(lat * G),
        lon: Math.round(lon * G),
        radius: 1,
        upper: 4,
        itemf: null,
        itemg: null,
        iteme: `UAV AREA: ${dms(lat, 'N')} ${dms(lon, 'E')} - ${dms(lat + 0.01, 'N')} ${dms(lon, 'E')} - ${dms(lat + 0.01, 'N')} ${dms(lon + 0.01, 'E')}`,
      }),
    )!;
  const dms = (v: number, h: string) => {
    const d = Math.floor(v),
      m = Math.floor((v - d) * 60),
      s = Math.round(((v - d) * 60 - m) * 60);
    return `${String(d).padStart(h === 'E' ? 3 : 2, '0')}${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}${h}`;
  };
  test('SFC–400 ft under a 4500 ft leg: hidden, unless near an aerodrome of the route', () => {
    const field = { lat: 38.11, lon: 23.78 };
    const route = [field, { lat: 37.75, lon: 23.55 }, { lat: 37.5, lon: 23.5 }];
    const [far, near] = assessNotams([box(37.8, 23.6), box(38.12, 23.79)], {
      route,
      aerodromes: new Map(),
      window: { from: at('06:00'), to: at('12:00') },
      maxAltFt: 4500,
      corridorNm: 10,
      legAltFt: [4500, 4500],
      fields: [field],
    }).sort((a, b) => a.center!.lat - b.center!.lat);
    expect(far.relevant).toBe(false);
    expect(far.reasons[0]).toMatch(/^below the planned altitude/);
    expect(near.relevant).toBe(true);
  });
  test('item G when it reads: AGL over the highest ground under the area; else the Q line', () => {
    expect(parseLimit('250FT AGL')).toEqual({ ft: 250, agl: true });
    expect(parseLimit('GND')).toEqual({ ft: 0, agl: true });
    expect(parseLimit('FL095')).toEqual({ ft: 9500, agl: false });
    expect(parseLimit('3000FT AMSL')).toEqual({ ft: 3000, agl: false });
    expect(parseLimit('150M AGL')!.ft).toBeCloseTo(492, 0);
    expect(parseLimit('UNL')).toBeNull();
    const route = [
      { lat: 37.9, lon: 23.6 },
      { lat: 37.7, lon: 23.6 },
    ];
    // Q line up to FL020, item G 250 ft AGL, under a 2500 ft leg
    const n = () => {
      const x = box(37.8, 23.62);
      x.upperFt = 2000;
      x.upperText = '250FT AGL';
      return x;
    };
    const flat = new Uint8Array(TERRAIN_GRID.rows * TERRAIN_GRID.cols).fill(10); // 120 m everywhere
    const inp = {
      route,
      aerodromes: new Map(),
      window: { from: at('06:00'), to: at('12:00') },
      maxAltFt: 2500,
      corridorNm: 10,
      legAltFt: [2500],
      fields: [],
    };
    expect(upperAmslFt(n(), flat)).toBeCloseTo(250 + 120 / 0.3048, 0);
    expect(assessNotams([n()], { ...inp, terrain: flat })[0].relevant).toBe(false);
    // no terrain: the Q line (2000 ft) is not 1000 ft under the leg
    expect(assessNotams([n()], { ...inp, terrain: null })[0].relevant).toBe(true);
  });
});

describe('NOTAM briefing route', () => {
  const ar = mockAutorouter();
  let api: Awaited<ReturnType<typeof start>>;
  let a: Client, b: Client, fid: string;
  beforeAll(async () => {
    api = await start({ email: 'app@example.com', password: 's3cret', filing: false, fetch: ar.fetch });
    a = client(api.base);
    b = client(api.base);
    await a.login('n-a', 'na@example.com');
    await b.login('n-b', 'nb@example.com');
    fid = await newFlight(a);
    ar.state.notams = [
      notam({
        number: 1,
        itema: ['LGMG'],
        code23: 'MR',
        code45: 'LC',
        lat: 0,
        lon: 0,
        radius: 5,
        upper: 999,
        iteme: 'RWY 08/26 CLSD',
      }),
      notam({ number: 2 }), // on the route
      notam({ number: 3, lat: Math.round(35.3 * G), lon: Math.round(25.1 * G) }), // Crete
      notam({ number: 4, endvalidity: Math.floor(at('05:00') / 1000) }), // over before block start − 1 h
      notam({ number: 5, lower: 150, upper: 245 }), // above the planned altitudes
      notam({ number: 6, traffic: 'I', code23: 'PI', code45: 'AU' }), // IFR only, not at a used aerodrome
      notam({ number: 7, code23: 'KK', code45: 'KK' }), // checklist
      notam({ number: 8, itema: ['LGMG'], traffic: 'I', code23: 'IC', code45: 'AS', lat: 0, lon: 0 }), // IFR, but at the destination
      notam({ number: 9, itema: ['LGSR'], lat: Math.round(36.4 * G), lon: Math.round(25.48 * G) }), // not queried
      // a statement about another NOTAM, its Q-line circle covering the FIR
      notam({ number: 10, code23: 'AF', code45: 'XX', radius: 341, iteme: 'NAVIGATIONAL WARNING TO ALL CONCERNED: …' }),
      // an aerodrome-only NOTAM for an aerodrome near the route the flight does not use
      notam({ number: 12, itema: ['LGEL'], scope: 'A', code23: 'MR', code45: 'LC', iteme: 'RWY CLOSED' }),
      // a wide Q-line circle over the route; the area itself, in item E, is off Crete
      notam({
        number: 11,
        code23: 'WE',
        code45: 'LW',
        radius: 150,
        iteme:
          'EXER WILL TAKE PLACE WI AREA AS FLW: 350000N 0250000E - 350000N 0251000E - 345000N 0251000E - 350000N 0250000E.',
      }),
    ];
  });
  afterAll(() => api.close());

  test('relevant NOTAMs first, the others hidden with reasons', async () => {
    const r = await a.call('GET', `flights/${fid}/notams`);
    expect(r.status).toBe(200);
    const br = r.body;
    expect(br).toMatchObject({ status: 'ok', source: 'autorouter', relevantCount: 3, hiddenCount: 8 });
    expect(br.locations).toEqual(expect.arrayContaining(['LGTT', 'LGMG', 'LGGG', 'LGEL']));
    expect(br.locations).not.toContain('LGSR');
    const by = Object.fromEntries(br.notams.map((n: any) => [n.key, n]));
    expect(
      br.notams
        .slice(0, 3)
        .map((n: any) => n.key)
        .sort(),
    ).toEqual(['A0001/26', 'A0002/26', 'A0008/26']);
    expect(by['A0001/26'].reasons).toEqual(['destination LGMG']);
    expect(by['A0002/26'].reasons[0]).toMatch(/on the route \(leg 1\)/);
    expect(by['A0002/26'].legIndex).toBe(0);
    expect(by['A0003/26']).toMatchObject({ relevant: false });
    expect(by['A0003/26'].reasons[0]).toMatch(/NM from the route/);
    expect(by['A0004/26'].reasons).toContain('ends before the flight');
    expect(by['A0005/26'].reasons[0]).toMatch(/above the planned altitudes/);
    expect(by['A0006/26'].reasons).toContain('IFR only');
    expect(by['A0007/26'].reasons).toContain('checklist');
    expect(by['A0010/26'].reasons).toContain('FIR-wide notice');
    expect(by['A0012/26'].reasons).toContain('for LGEL, not used by the flight');
    expect(by['A0011/26'].areas).toEqual([{ kind: 'polygon', points: expect.any(Array) }]);
    expect(by['A0011/26'].reasons[0]).toMatch(/^\d+ NM from the route/);
    expect(br.window.from).toBe(at('07:00'));
    expect(br.window.to).toBeGreaterThan(at('09:00'));
    // the query sent: validity window in seconds, item A list as JSON
    const q = ar.calls.find((c) => c.path.startsWith('/notam'))!;
    expect(q.auth).toBe('Bearer tok1');
    expect(q.path).toContain(`startvalidity=${Math.floor(at('07:00') / 1000)}`);
  });

  test('cached per flight; refresh=1 fetches again; a failed source falls back to the cache', async () => {
    const n = ar.calls.filter((c) => c.path.startsWith('/notam')).length;
    await a.call('GET', `flights/${fid}/notams`);
    expect(ar.calls.filter((c) => c.path.startsWith('/notam')).length).toBe(n);
    await a.call('GET', `flights/${fid}/notams?refresh=1`);
    expect(ar.calls.filter((c) => c.path.startsWith('/notam')).length).toBe(n + 1);
    expect(ar.calls.filter((c) => c.path === '/oauth2/token').map((c) => c.path)).toEqual(['/oauth2/token']); // the token is reused
    ar.state.failNotams = true;
    const r = (await a.call('GET', `flights/${fid}/notams?refresh=1`)).body;
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/Could not refresh/);
    ar.state.failNotams = false;
  });

  test('parameters: maxAltFt shows higher NOTAMs; bad values are 400', async () => {
    const r = (await a.call('GET', `flights/${fid}/notams?maxAltFt=20000`)).body;
    expect(r.notams.find((n: any) => n.key === 'A0005/26').relevant).toBe(true);
    expect((await a.call('GET', `flights/${fid}/notams?maxAltFt=abc`)).status).toBe(400);
  });

  test('a token refused mid-session is renewed once', async () => {
    ar.state.rejectTokenOnce = true;
    const r = await a.call('GET', `flights/${fid}/notams?refresh=1`);
    expect(r.body.status).toBe('ok');
    expect(ar.state.tokens).toBe(2);
  });

  test('another pilot cannot read the briefing', async () => {
    expect((await b.call('GET', `flights/${fid}/notams`)).status).toBe(404);
  });
});

describe('without autorouter', () => {
  let api: Awaited<ReturnType<typeof start>>;
  let a: Client, fid: string;
  beforeAll(async () => {
    api = await start(null);
    a = client(api.base);
    await a.login('x-a', 'xa@example.com');
    fid = await newFlight(a);
  });
  afterAll(() => api.close());

  test('NOTAMs: not-configured, with a message', async () => {
    const r = (await a.call('GET', `flights/${fid}/notams`)).body;
    expect(r).toMatchObject({ status: 'not-configured', source: null, notams: [] });
    expect(r.message).toMatch(/NOTAM source is not configured/);
  });
  test('filing disabled: actions refused with 503 and logged; addressees still proposed', async () => {
    const s = (await a.call('GET', `flights/${fid}/filing`)).body;
    expect(s.enabled).toBe(false);
    expect(s.reason).toMatch(/not available|not enabled/);
    expect(s.filing).toBeNull();
    expect(s.addressees.map((x: any) => x.address)).toEqual(
      expect.arrayContaining(['LGMDZFZX', 'LGMDYXYK', 'LGTTZTZX', 'LGMGZPZX']),
    );
    const r = await a.call('POST', `flights/${fid}/filing`, {
      fpl: '(FPL-SXASV-VG -C172/L -S/C -LGTT0800 -N0092VFR DCT -LGMG0030 -0)',
      addresses: [],
    });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ enabled: false });
    const log = (await a.call('GET', 'filing/log')).body;
    expect(log[0]).toMatchObject({ action: 'file', ok: false, flightId: fid });
  });
});

describe('filing via autorouter (mocked)', () => {
  const ar = mockAutorouter();
  let api: Awaited<ReturnType<typeof start>>;
  let a: Client, b: Client, fid: string;
  const FPL =
    '(FPL-SXASV-VG\n-C172/L-SDFGY/C\n-LGTT0800\n-N0092VFR DCT\n-LGMG0030\n-DOF/261116 REG/SXASV\n-E/0400 P/2 A/WHITE C/PILOT +3069000000)';
  const mails: SentMail[] = [];
  beforeAll(async () => {
    setMailTransport(async (m) => {
      mails.push(m);
      return { id: `msg-${mails.length}` };
    });
    api = await start({
      email: 'app@example.com',
      password: 's3cret',
      filing: true,
      fetch: ar.fetch,
      sleep: async () => {},
    });
    a = client(api.base);
    b = client(api.base);
    await a.login('f-a', 'fa@example.com');
    await b.login('f-b', 'fb@example.com');
    // the first aircraft becomes the default, so new flights are flown in SX-ASV (item 7 SXASV)
    expect((await a.call('POST', 'aircraft', { registration: 'SX-ASV' })).status).toBe(201);
    fid = await newFlight(a);
  });
  afterAll(() => {
    setMailTransport(null);
    return api.close();
  });

  test('input is validated', async () => {
    expect((await a.call('POST', `flights/${fid}/filing`, { fpl: 'hello', addresses: [] })).status).toBe(400);
    expect((await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: ['LGGG'] })).status).toBe(400);
    expect(
      (await a.call('POST', `flights/${fid}/filing`, { fpl: FPL.replace('PILOT', 'πιλότος'), addresses: [] })).status,
    ).toBe(400);
    expect(
      (await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [], eobt: Date.now() + 30 * 24 * 3600e3 }))
        .status,
    ).toBe(400);
  });
  test('file, poll, delay, cancel; every action logged', async () => {
    const s = (await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: ['lgggzfzx', 'LGTTZTZX'] })).body;
    expect(s.enabled).toBe(true);
    expect(s.filing).toMatchObject({
      provider: 'autorouter',
      providerId: '2763',
      status: 'filed',
      eobt: at('08:00'),
      addresses: ['LGGGZFZX', 'LGTTZTZX'],
    });
    const sent = ar.calls.find((c) => c.path === '/flightplan/file/LGTT-LGMG-6aff6ee6fbb39')!;
    expect(sent.body).toMatchObject({ fpl: FPL, addresses: ['LGGGZFZX', 'LGTTZTZX'], force: false });
    // filing twice is refused while the plan is open
    expect((await a.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [] })).status).toBe(409);
    ar.state.status = 'departed';
    expect((await a.call('POST', `flights/${fid}/filing/refresh`)).body.filing.status).toBe('departed');
    const eobt = at('09:00');
    expect((await a.call('POST', `flights/${fid}/filing/delay`, { eobt })).body.filing.eobt).toBe(eobt);
    expect(ar.calls.find((c) => c.path === '/flightplan/file/2763/delay')!.body).toEqual({ neweobt: eobt / 1000 });
    const c = (await a.call('POST', `flights/${fid}/filing/cancel`, { reason: 'Weather' })).body;
    expect(c.filing.status).toBe('cancelled');
    expect((await a.call('POST', `flights/${fid}/filing/cancel`, {})).status).toBe(409);
    expect(c.log.map((l: any) => l.action)).toEqual(['copy', 'cancel', 'copy', 'delay', 'refresh', 'copy', 'file']);
    expect(c.log.every((l: any) => l.ok)).toBe(true);
    // LGTT asks for a copy of every plan (ref_aerodrome_contacts): what autorouter sent, the pilot in cc
    expect(c.copyTo).toEqual([{ email: 'lgttatc@gmail.com', for: 'LGTT' }]);
    expect(mails.map((m) => m.to)).toEqual([['lgttatc@gmail.com'], ['lgttatc@gmail.com'], ['lgttatc@gmail.com']]);
    expect(mails[0].cc).toEqual(['fa@example.com']);
    expect(mails[0].subject).toMatch(
      /^-TITLE ACK -MSGTYP VFPL SXASV LGTT0800 LGMG autorouter MSG -FILTIM \d{6} -ORIGINDT \d{10} \(PILOT \+3069000000\)$/,
    );
    expect(mails[0].text).toContain('-BEGIN ADDR\n     -FAC KSTPXAAP\n-END ADDR\n-IFPLID VFR\n-MSGTXT (FPL-SXASV-VG\n');
    expect(mails[0].text).toContain('-E/0400 P/2 A/WHITE C/PILOT +3069000000)');
    expect(mails[0].text).toContain('Original message addressees...\n\nFF LGMGZTZX LGGGZFZX LGTTZTZX LGTTYXYX\n');
    expect(mails[0].text).not.toContain('OTHER');
    expect(mails[2].subject).toMatch(/^-TITLE ACK -MSGTYP CNL SXASV LGTT0900 LGMG autorouter MSG /);
    expect(mails[2].text).toMatch(/cancellation confirmation[\s\S]*-MSGTXT \(CNL-SXASV-LGTT0900-LGMG-DOF\/261116\)/);
    // everything read from the queue is acknowledged
    expect(ar.state.queue).toEqual([]);
  });
  test('provider errors are shown and logged', async () => {
    const f2 = await newFlight(a);
    ar.state.fileError = 'FPLAN_ITEM15_INVALIDROUTETOKEN';
    const r = await a.call('POST', `flights/${f2}/filing`, { fpl: FPL, addresses: [] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/INVALIDROUTETOKEN/);
    const s = (await a.call('GET', `flights/${f2}/filing`)).body;
    expect(s.filing).toBeNull();
    expect(s.log[0]).toMatchObject({ action: 'file', ok: false });
    ar.state.fileError = '';
    ar.state.parseError = true;
    const p = await a.call('POST', `flights/${f2}/filing`, { fpl: FPL, addresses: [] });
    expect(p.status).toBe(400);
    expect(p.body.error).toMatch(/parsing failed: invalid callsign/);
    ar.state.parseError = false;
  });
  test('the plan must be for the flight’s aircraft (item 7 and REG/)', async () => {
    const f2 = await newFlight(a);
    const sent = () => ar.calls.filter((c) => c.path === '/flightplan/file/LGTT-LGMG-6aff6ee6fbb39').length;
    const before = sent();
    for (const fpl of [
      FPL.replace('FPL-SXASV', 'FPL-SXABC'),
      FPL.replace('REG/SXASV', 'REG/SXABC'),
      FPL.replace('FPL-SXASV', 'FPL-OAL123'),
    ]) {
      const r = await a.call('POST', `flights/${f2}/filing`, { fpl, addresses: [] });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/aircraft/);
    }
    // a flight without an aircraft cannot be filed at all
    const f3 = (
      await a.call('POST', 'flights', {
        date: tomorrow,
        blockOff: '08:00',
        aircraftId: null,
        route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      })
    ).body.id;
    expect((await a.call('POST', `flights/${f3}/filing`, { fpl: FPL, addresses: [] })).status).toBe(400);
    expect(sent()).toBe(before);
  });
  test('isolation: another pilot sees nothing and cannot act', async () => {
    expect((await b.call('GET', `flights/${fid}/filing`)).status).toBe(404);
    expect((await b.call('POST', `flights/${fid}/filing/cancel`, {})).status).toBe(404);
    expect((await b.call('GET', 'filing/log')).body).toEqual([]);
  });
});

// ---------------------------------------------------------------- addressees (ENR 1.11)

describe('AFTN addressees', () => {
  const ctx = { aerodromes: ADS, airspaces: SPACES, fis: fis as RefFis, alternates: [] as string[] };
  // ENR 2.1.3: the ATHINAI/MAKEDONIA ACC dividing line runs 374836N 0232724E – 375055N 0241807E, south
  // of Athens: Attica is MAKEDONIA ACC (the FIS split the ATC list uses too).
  test('Tatoi → Megara: MAKEDONIA ACC, ATHINAI TMA, both aerodromes and Elefsina CTR crossed', () => {
    const out = generateAddressees({ ...ctx, route: [pt('LGTT', 'a'), pt('LGMG', 'b')], altitudesFt: [2500] });
    const addrs = out.map((x) => x.address);
    expect(addrs).toEqual(
      expect.arrayContaining([
        'LGMDZFZX',
        'LGMDYXYK',
        'LGATZAZV',
        'LGAVZTZX',
        'LGAVZPZX',
        'LGTTZTZX',
        'LGTTZPZX',
        'LGMGZTZX',
        'LGMGZPZX',
        'LGELZTZX',
        'LGELZPZX',
      ]),
    );
    expect(addrs).not.toContain('LGGGZFZX');
    expect(out.find((x) => x.address === 'LGTTZTZX')!.reasons).toContain('departure LGTT');
    expect(out.find((x) => x.address === 'LGELZPZX')!.reasons).toContain('LGEL CTR/ATZ');
  });
  test('Santorini → Iraklion: ATHINAI ACC, SANTORINI and IRAKLION TMAs', () => {
    const addrs = generateAddressees({ ...ctx, route: [pt('LGSR', 'a'), pt('LGIR', 'b')], altitudesFt: [5500] }).map(
      (x) => x.address,
    );
    expect(addrs).toEqual(
      expect.arrayContaining(['LGGGZFZX', 'LGGGYXYK', 'LGSRZAZX', 'LGIRZAZX', 'LGSRZTZX', 'LGIRZPZX']),
    );
    expect(addrs).not.toContain('LGMDZFZX');
  });
  test('Thessaloniki → Kozani: MAKEDONIA ACC and MAKEDONIA TMA; alternates added', () => {
    const out = generateAddressees({
      ...ctx,
      alternates: ['LGKV'],
      route: [pt('LGTS', 'a'), pt('LGKZ', 'b')],
      altitudesFt: [4500],
    });
    const addrs = out.map((x) => x.address);
    expect(addrs).toEqual(
      expect.arrayContaining(['LGMDZFZX', 'LGMDYXYK', 'LGTSZAZX', 'LGTSZTZX', 'LGKZZTZX', 'LGKVZTZX', 'LGKVZPZX']),
    );
    expect(addrs).not.toContain('LGGGZFZX');
  });
  test('FIS boundary side', () => {
    expect(northOfBoundary({ lat: 40.5, lon: 23 }, (fis as RefFis).boundary)).toBe(true);
    expect(northOfBoundary({ lat: 37.97, lon: 23.73 }, (fis as RefFis).boundary)).toBe(true); // Athens
    expect(northOfBoundary({ lat: 37.6, lon: 23.5 }, (fis as RefFis).boundary)).toBe(false); // Saronic gulf
    expect(northOfBoundary({ lat: 35.3, lon: 25.1 }, (fis as RefFis).boundary)).toBe(false);
  });
});

// ---------------------------------------------------------------- who may use the autorouter account

describe('autorouter account allow-list', () => {
  const ar = mockAutorouter();
  const settings = { email: 'app@example.com', password: 's3cret', filing: true, fetch: ar.fetch };
  const FPL =
    '(FPL-SXASV-VG\n-C172/L-SDFGY/C\n-LGTT0800\n-N0092VFR DCT\n-LGMG0030\n-DOF/261116 REG/SXASV\n-E/0400 P/2 A/WHITE C/PILOT +3069000000)';
  async function attempt(pilots: string[], email: string) {
    const api = await start(settings, pilots);
    try {
      const c = client(api.base);
      await c.login(`s-${email}`, email);
      expect((await c.call('POST', 'aircraft', { registration: 'SX-ASV' })).status).toBe(201);
      const fid = await newFlight(c);
      return {
        state: (await c.call('GET', `flights/${fid}/filing`)).body,
        file: await c.call('POST', `flights/${fid}/filing`, { fpl: FPL, addresses: [] }),
        notams: (await c.call('GET', `flights/${fid}/notams`)).body,
      };
    } finally {
      await api.close();
    }
  }
  test('a pilot not on the list: no filing, no NOTAM quota, nothing sent to autorouter', async () => {
    const n = ar.calls.length;
    const r = await attempt(['owner@example.com'], 'stranger@example.com');
    expect(r.state).toMatchObject({ enabled: false });
    expect(r.state.reason).toMatch(/not available for this account/);
    expect(r.file.status).toBe(503);
    expect(r.notams).toMatchObject({ status: 'not-configured', notams: [] });
    expect(r.notams.message).toMatch(/not available for this account/);
    expect(ar.calls.length).toBe(n);
  });
  test('an empty list (no AUTOROUTER_PILOTS, no ALLOWED_EMAILS) means nobody in Google mode', async () => {
    const n = ar.calls.length;
    const r = await attempt([], 'anyone@example.com');
    expect(r.file.status).toBe(503);
    expect(r.notams.status).toBe('not-configured');
    expect(ar.calls.length).toBe(n);
  });
  test('a listed pilot (case-insensitive) may file', async () => {
    const r = await attempt(['Owner@Example.com'], 'owner@example.com');
    expect(r.state.enabled).toBe(true);
    expect(r.file.status).toBe(200);
    expect(r.notams.status).toBe('ok');
  });
  test("'*': every signed-in pilot may file", async () => {
    const r = await attempt(['*'], 'anyone@example.com');
    expect(r.state.enabled).toBe(true);
    expect(r.file.status).toBe(200);
    expect(r.notams.status).toBe('ok');
  });
});

describe('configFromEnv: AUTOROUTER_PILOTS', () => {
  test('parsed and lower-cased; unset falls back to ALLOWED_EMAILS in createApi', async () => {
    const { configFromEnv } = await import('../../api/_lib/app');
    expect(
      configFromEnv({ AUTOROUTER_PILOTS: ' Pilot@Example.com , b@y.gr,', ALLOWED_EMAILS: 'x@y.z' }).autorouterPilots,
    ).toEqual(['pilot@example.com', 'b@y.gr']);
    expect(configFromEnv({ AUTOROUTER_PILOTS: '' }).autorouterPilots).toEqual([]);
    expect(configFromEnv({ AUTOROUTER_PILOTS: '*' }).autorouterPilots).toEqual(['*']);
    expect('autorouterPilots' in configFromEnv({ ALLOWED_EMAILS: 'x@y.z' })).toBe(false);
  });
});
