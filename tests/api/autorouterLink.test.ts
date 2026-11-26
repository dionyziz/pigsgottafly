// Pilots' own autorouter accounts (api/_lib/autorouterLinks.ts, routes/autorouter.ts) against a MOCKED
// autorouter (tests/setup/noExternalApis.ts refuses the real one): the authorization-code flow and its
// state checks, sealed tokens, renewal and broken links, filing, NOTAMs and METAR/TAF with the pilot's
// own token, the deployment's account for the owner unchanged, and nothing offered without a client id.
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { autorouterOAuthFromEnv, type AutorouterOAuthSettings, seal, unseal } from '../../api/_lib/autorouterLinks';
import type { Db } from '../../api/_lib/db';
import { autorouterNotamSource } from '../../api/_lib/notamSources/autorouter';
import { returnPath } from '../../api/_lib/routes/autorouter';
import { createServer } from '../../server/server';
import { AERODROMES as aerodromes } from '../../src/data/ref';
import type { RefAerodrome } from '../../src/shared/ref';
import type { RoutePoint } from '../../src/shared/types';
import { CID, type Client, client, googleClaims, JWK, signToken } from './helpers';

const FPL =
  '(FPL-SXASV-VG\n-C172/L-SDFGY/C\n-LGTT0800\n-N0092VFR DCT\n-LGMG0030\n-DOF/261116 REG/SXASV\n-E/0400 P/2 A/WHITE C/PILOT +3069000000)';
const ADS = ((aerodromes as any).aerodromes ?? aerodromes) as RefAerodrome[];
const pt = (icao: string, uid: string): RoutePoint => {
  const a = ADS.find((x) => x.icao === icao)!;
  return { uid, kind: 'aerodrome', refId: a.id, name: icao, lat: a.lat, lon: a.lon };
};
const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** autorouter: its token endpoint (every grant), and the API answering only live tokens. */
function mockAutorouter() {
  const live = new Set<string>();
  const tokenRequests: Record<string, string>[] = [];
  const calls: { path: string; auth: string | null }[] = [];
  const state = { refreshFails: false, renewed: 0 };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== 'api.autorouter.aero') throw new Error(`unexpected ${url}`);
    const path = url.pathname.replace(/^\/v1\.0/, '');
    if (path === '/oauth2/token') {
      const p = Object.fromEntries(new URLSearchParams(String(init?.body)));
      tokenRequests.push(p);
      if (p.grant_type === 'client_credentials') {
        live.add('owner-tok');
        return json(200, { access_token: 'owner-tok', expires_in: 3600 });
      }
      if (p.client_id !== 'pgf-client' || p.client_secret !== 'pgf-secret')
        return json(401, { error: 'invalid_client', error_description: 'The client credentials are invalid' });
      if (p.grant_type === 'authorization_code') {
        if (!p.code.startsWith('good-')) return json(400, { error: 'invalid_grant', error_description: 'bad code' });
        const t = `linked-${p.code}`;
        live.add(t);
        return json(200, { access_token: t, refresh_token: `refresh-${p.code}`, expires_in: 3 * 24 * 3600 });
      }
      if (p.grant_type === 'refresh_token') {
        if (state.refreshFails)
          return json(400, { error: 'invalid_grant', error_description: 'refresh token revoked' });
        const t = `renewed-${++state.renewed}`;
        live.add(t);
        return json(200, { access_token: t, expires_in: 3 * 24 * 3600 });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ path, auth });
    if (!live.has(String(auth).replace(/^Bearer /, ''))) return json(403, { error: 'forbidden' });
    if (path === '/router') return new Response('R1');
    if (path === '/flightplan/file/R1') return json(200, { flightid: 501, queued: false });
    if (path === '/flightplan/file/501') return json(200, { status: 'filed' });
    if (path === '/message')
      return json(200, [
        { id: 1, type: 'fplan_aftn_out', message: { fplid: 501, message: FPL, priority: 'FF', recipients: [] } },
      ]);
    if (path === '/message/acknowledge') return json(200, {});
    if (path === '/notam') return json(200, { total: 0, rows: [] });
    if (path.startsWith('/met/metartaf/')) return json(200, { metar: 'METAR LGTT 220730Z 00000KT 9999 Q1020' });
    return json(404, { error: 'no such endpoint' });
  }) as typeof globalThis.fetch;
  const by = (token: string) => calls.filter((c) => c.auth === `Bearer ${token}`).map((c) => c.path);
  return { fetch, live, calls, tokenRequests, state, by };
}

const awcFetch = (async () => json(200, [])) as typeof fetch;

async function start(ar: ReturnType<typeof mockAutorouter>, oauth: AutorouterOAuthSettings | null) {
  const s = createServer({
    db: 'memory://',
    googleClientId: CID,
    googleKeys: async () => [JWK],
    autorouter: { email: 'app@example.com', password: 's3cret', filing: true, fetch: ar.fetch, sleep: async () => {} },
    autorouterPilots: ['owner@example.com'],
    autorouterOAuth: oauth,
    aviationWeather: { fetch: awcFetch },
    client: (_q, r) => {
      r.writeHead(404);
      r.end();
    },
  });
  const { db } = await s.ready;
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return { origin, base: `${origin}/api/`, db, close: () => new Promise<void>((r) => s.close(() => r())) };
}

/** A signed-in browser: keeps every cookie, never follows redirects. */
function browser(base: string) {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (r: Response) => {
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  const c = client(base);
  return {
    jar,
    api: c,
    async login(sub: string, email: string) {
      const r = await fetch(`${base}login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: signToken(googleClaims(sub, email)) }),
      });
      keep(r);
      await c.login(sub, email);
    },
    async get(url: string) {
      const r = await fetch(url.startsWith('http') ? url : base + url, {
        headers: { cookie: cookie() },
        redirect: 'manual',
      });
      keep(r);
      return { status: r.status, location: r.headers.get('location') ?? '', setCookie: r.headers.getSetCookie() };
    },
  };
}

const oauthSettings = (ar: ReturnType<typeof mockAutorouter>): AutorouterOAuthSettings => ({
  clientId: 'pgf-client',
  clientSecret: 'pgf-secret',
  tokenKey: 'test-token-key',
  redirectUri: '',
  filing: true,
  fetch: ar.fetch,
  sleep: async () => {},
});

describe('configuration', () => {
  test('linking is offered only with a client id and secret', () => {
    expect(autorouterOAuthFromEnv({})).toBeNull();
    expect(autorouterOAuthFromEnv({ AUTOROUTER_CLIENT_ID: 'x' })).toBeNull();
    expect(autorouterOAuthFromEnv({ AUTOROUTER_CLIENT_ID: ' x ', AUTOROUTER_CLIENT_SECRET: 's' })).toEqual({
      clientId: 'x',
      clientSecret: 's',
      tokenKey: '',
      redirectUri: '',
      filing: true,
    });
    expect(
      autorouterOAuthFromEnv({ AUTOROUTER_CLIENT_ID: 'x', AUTOROUTER_CLIENT_SECRET: 's', AUTOROUTER_FILING: '0' })!
        .filing,
    ).toBe(false);
  });

  test('tokens are sealed: only the same key opens them, and tampering is detected', () => {
    const s = autorouterOAuthFromEnv({ AUTOROUTER_CLIENT_ID: 'x', AUTOROUTER_CLIENT_SECRET: 's' })!;
    const sealed = seal(s, 'the-token');
    expect(sealed).not.toContain('the-token');
    expect(unseal(s, sealed)).toBe('the-token');
    expect(unseal({ ...s, tokenKey: 'other' }, sealed)).toBeNull();
    expect(unseal(s, sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA'))).toBeNull();
  });

  test('the way back is a path on this site only', () => {
    expect(returnPath('/flights/abc/fpl?x=1#filing')).toBe('/flights/abc/fpl?x=1#filing');
    for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/a b'])
      expect(returnPath(bad)).toBe('/profile');
  });

  test("the NOTAM source: a linked account on any flight the pilot is on, the deployment's on their own", () => {
    const c = {} as never;
    expect(autorouterNotamSource(c, true).availableFor({ pilotId: 'p', ownerId: 'o' })).toBe(true);
    expect(autorouterNotamSource(c).availableFor({ pilotId: 'p', ownerId: 'o' })).toBe(false);
    expect(autorouterNotamSource(c).availableFor({ pilotId: 'o', ownerId: 'o' })).toBe(true);
    expect(autorouterNotamSource(null, true).availableFor({ pilotId: 'p', ownerId: 'p' })).toBe(false);
  });
});

describe('without a client id', () => {
  const ar = mockAutorouter();
  let srv: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    srv = await start(ar, null);
  });
  afterAll(() => srv.close());

  test('nothing is offered; the owner files with the deployment account as before', async () => {
    const other = client(srv.base);
    await other.login('n-other', 'other@example.com');
    expect((await other.call('GET', 'autorouter')).body).toEqual({
      enabled: false,
      connected: false,
      broken: false,
      account: null,
      linkedAt: null,
    });
    expect((await other.call('GET', 'autorouter/connect')).status).toBe(404);
    expect((await other.call('POST', 'autorouter/app-connect')).status).toBe(404);
    expect((await other.call('POST', 'autorouter/disconnect')).status).toBe(404);
    const f = (await other.call('POST', 'flights', { date: tomorrow, route: [pt('LGTT', 'a'), pt('LGMG', 'b')] })).body;
    const fi = (await other.call('GET', `flights/${f.id}/filing`)).body.filers[0];
    expect(fi).toMatchObject({
      id: 'autorouter',
      available: false,
      reason: 'Filing is not available for this account.',
    });
    expect(fi.connect).toBeUndefined();

    const owner = client(srv.base);
    await owner.login('n-owner', 'owner@example.com');
    const g = (await owner.call('POST', 'flights', { date: tomorrow, route: [pt('LGTT', 'a'), pt('LGMG', 'b')] })).body;
    expect((await owner.call('GET', `flights/${g.id}/filing`)).body.filers[0]).toMatchObject({ available: true });
  });
});

describe('linking a pilot’s own account', () => {
  const ar = mockAutorouter();
  let srv: Awaited<ReturnType<typeof start>>;
  let db: Db;
  let pilot: ReturnType<typeof browser>;
  let owner: Client;
  let flightId: string;
  let ownersFlight: string;
  beforeAll(async () => {
    srv = await start(ar, oauthSettings(ar));
    db = srv.db;
    pilot = browser(srv.base);
    await pilot.login('l-pilot', 'pilot@example.com');
    owner = client(srv.base);
    await owner.login('l-owner', 'owner@example.com');
    await pilot.api.call('PUT', 'me', { fullName: 'Pat Pilot', phone: '+30 6900000000' });
    await pilot.api.call('POST', 'aircraft', { registration: 'SX-ASV' });
    flightId = (
      await pilot.api.call('POST', 'flights', {
        date: tomorrow,
        blockOff: '08:00',
        taxiOutMin: 10,
        taxiInMin: 10,
        route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      })
    ).body.id;
    ownersFlight = (
      await owner.call('POST', 'flights', {
        date: tomorrow,
        blockOff: '09:00',
        taxiOutMin: 10,
        taxiInMin: 10,
        route: [pt('LGTT', 'a'), pt('LGMG', 'b')],
      })
    ).body.id;
    expect(
      (await owner.call('POST', `flights/${ownersFlight}/shares`, { email: 'pilot@example.com', role: 'view' })).status,
    ).toBe(201);
  });
  afterAll(() => srv.close());

  /** Starts the flow; autorouter's answer comes back to the callback with `code`. */
  const authorize = async (b: ReturnType<typeof browser>, ret = `/flights/${flightId}/fpl`) => {
    const r = await b.get(`autorouter/connect?return=${encodeURIComponent(ret)}`);
    expect(r.status).toBe(302);
    return new URL(r.location);
  };

  test('not linked: the filing panel asks to connect, and autorouter is not used', async () => {
    expect((await pilot.api.call('GET', 'autorouter')).body).toMatchObject({ enabled: true, connected: false });
    const s = (await pilot.api.call('GET', `flights/${flightId}/filing`)).body;
    expect(s.enabled).toBe(false);
    expect(s.filers[0]).toMatchObject({
      id: 'autorouter',
      available: false,
      reason: 'Connect autorouter to file.',
      connect: 'connect',
    });
    const n = ar.calls.length;
    expect((await pilot.api.call('POST', `flights/${flightId}/filing`, { fpl: FPL, addresses: [] })).status).toBe(503);
    const b = (await pilot.api.call('GET', `flights/${flightId}/notams`)).body;
    expect(b.status).toBe('not-configured');
    expect(ar.calls.length).toBe(n);
  });

  test("connect: autorouter's authorize page with a state, bound to this browser by a cookie", async () => {
    const r = await pilot.get(`autorouter/connect?return=${encodeURIComponent('/flights/x/fpl')}`);
    expect(r.status).toBe(302);
    const u = new URL(r.location);
    expect(`${u.origin}${u.pathname}`).toBe('https://www.autorouter.aero/authorize');
    expect(u.searchParams.get('client_id')).toBe('pgf-client');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe(`${srv.origin}/api/autorouter/callback`);
    expect(u.searchParams.get('state')).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(r.setCookie.find((c) => c.startsWith('pgf_ar_oauth='))).toMatch(
      /HttpOnly; SameSite=Lax; Path=\/api\/autorouter/,
    );
    // not signed in: no flow
    expect((await fetch(`${srv.base}autorouter/connect`, { redirect: 'manual' })).status).toBe(401);
  });

  test('the callback refuses a state without its browser, a forged state, and a refusal on autorouter', async () => {
    const u = await authorize(pilot);
    const state = u.searchParams.get('state')!;
    const n = ar.tokenRequests.length;
    // another browser (an attacker's link opened by the pilot, or the reverse): no nonce cookie
    const stranger = browser(srv.base);
    expect((await stranger.get(`autorouter/callback?code=good-x&state=${state}`)).location).toBe(
      '/profile?autorouter=failed',
    );
    const forged = state.replace(/\.[\w-]+$/, '.AAAA');
    expect((await pilot.get(`autorouter/callback?code=good-x&state=${forged}`)).location).toBe(
      '/profile?autorouter=failed',
    );
    expect(ar.tokenRequests.length).toBe(n);
    const u2 = await authorize(pilot);
    expect(
      (await pilot.get(`autorouter/callback?error=access_denied&state=${u2.searchParams.get('state')}`)).location,
    ).toBe(`/flights/${flightId}/fpl?autorouter=denied`);
    const u3 = await authorize(pilot);
    expect((await pilot.get(`autorouter/callback?code=bad&state=${u3.searchParams.get('state')}`)).location).toBe(
      `/flights/${flightId}/fpl?autorouter=failed`,
    );
    expect((await pilot.api.call('GET', 'autorouter')).body.connected).toBe(false);
  });

  test('the callback exchanges the code and stores the tokens sealed; back where the pilot was', async () => {
    const u = await authorize(pilot);
    const r = await pilot.get(`autorouter/callback?code=good-1&state=${u.searchParams.get('state')}`);
    expect(r.location).toBe(`/flights/${flightId}/fpl?autorouter=connected`);
    expect(r.setCookie.find((c) => c.startsWith('pgf_ar_oauth='))).toMatch(/Max-Age=0/);
    expect(ar.tokenRequests.at(-1)).toEqual({
      grant_type: 'authorization_code',
      code: 'good-1',
      redirect_uri: `${srv.origin}/api/autorouter/callback`,
      client_id: 'pgf-client',
      client_secret: 'pgf-secret',
    });
    const st = (await pilot.api.call('GET', 'autorouter')).body;
    expect(st).toMatchObject({ enabled: true, connected: true, broken: false, account: null });
    expect(st.linkedAt).toBeGreaterThan(0);
    const [row] = await db.query('SELECT * FROM autorouter_links');
    expect(row.access_token).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain('linked-good-1');
    expect(JSON.stringify(row)).not.toContain('refresh-good-1');
    // the state is spent with its cookie
    expect((await pilot.get(`autorouter/callback?code=good-2&state=${u.searchParams.get('state')}`)).location).toBe(
      '/profile?autorouter=failed',
    );
    // the export names the link, never its tokens
    const exp = (await pilot.api.call('GET', 'me/export')).body;
    expect(exp.autorouter).toMatchObject({ account: null, broken: null });
    expect(JSON.stringify(exp)).not.toMatch(/linked-good|refresh-good|v1\./);
  });

  test("filing, status, NOTAMs and METAR/TAF go with the pilot's own token", async () => {
    const s = (await pilot.api.call('GET', `flights/${flightId}/filing`)).body;
    expect(s.enabled).toBe(true);
    expect(s.filers[0]).toMatchObject({ id: 'autorouter', available: true });
    expect(s.filers[0].connect).toBeUndefined();
    const f = await pilot.api.call('POST', `flights/${flightId}/filing`, { fpl: FPL, addresses: ['LGGGZFZX'] });
    expect(f.status).toBe(200);
    expect(f.body.filing).toMatchObject({ provider: 'autorouter', providerId: '501', status: 'filed' });
    expect((await pilot.api.call('POST', `flights/${flightId}/filing/refresh`)).status).toBe(200);
    expect(ar.by('linked-good-1')).toEqual(
      expect.arrayContaining(['/router', '/flightplan/file/R1', '/flightplan/file/501']),
    );
    expect(ar.by('owner-tok')).toEqual([]);
    // NOTAMs on their own flight and on the owner's flight shared with them
    const mine = (await pilot.api.call('GET', `flights/${flightId}/notams`)).body;
    expect(mine.sources.map((x: any) => x.id)).toEqual(['autorouter']);
    const shared = (await pilot.api.call('GET', `flights/${ownersFlight}/notams`)).body;
    expect(shared.sources.map((x: any) => [x.id, x.status])).toEqual([['autorouter', 'ok']]);
    expect(ar.by('linked-good-1').filter((p) => p === '/notam').length).toBeGreaterThanOrEqual(2);
    await pilot.api.call('GET', 'weather/metar?ids=LGTT');
    expect(ar.by('linked-good-1')).toContain('/met/metartaf/LGTT');
    // no new token was minted along the way
    expect(ar.tokenRequests.filter((t) => t.grant_type !== 'authorization_code')).toEqual([]);
  });

  test("the owner, not linked, keeps the deployment's account on their own flights", async () => {
    const s = (await owner.call('GET', `flights/${ownersFlight}/filing`)).body;
    expect(s.filers[0]).toMatchObject({ id: 'autorouter', available: true });
    expect(s.filers[0].connect).toBeUndefined();
    const b = (await owner.call('GET', `flights/${ownersFlight}/notams?refresh=1`)).body;
    expect(b.sources.map((x: any) => x.id)).toEqual(['autorouter']);
    expect(ar.by('owner-tok')).toContain('/notam');
    expect((await owner.call('GET', 'autorouter')).body).toMatchObject({ enabled: true, connected: false });
  });

  test('an expired token is renewed with the refresh token, once, and kept for every instance', async () => {
    await db.query('UPDATE autorouter_links SET expires = $1', [Date.now() - 1000]);
    expect((await pilot.api.call('POST', `flights/${flightId}/filing/refresh`)).status).toBe(200);
    expect(ar.tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-good-1' });
    expect(ar.by('renewed-1')).toContain('/flightplan/file/501');
    const [row] = await db.query('SELECT expires FROM autorouter_links');
    expect(Number(row.expires)).toBeGreaterThan(Date.now());
    const n = ar.tokenRequests.length;
    expect((await pilot.api.call('POST', `flights/${flightId}/filing/refresh`)).status).toBe(200);
    expect(ar.tokenRequests.length).toBe(n);
  });

  test('a refused token is renewed; when the renewal is refused too, the link is broken: reconnect', async () => {
    ar.live.delete('renewed-1');
    expect((await pilot.api.call('POST', `flights/${flightId}/filing/refresh`)).status).toBe(200);
    expect(ar.by('renewed-2')).toContain('/flightplan/file/501');

    ar.live.delete('renewed-2');
    ar.state.refreshFails = true;
    const r = await pilot.api.call('POST', `flights/${flightId}/filing/refresh`);
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/reconnect autorouter/);
    expect((await pilot.api.call('GET', 'autorouter')).body).toMatchObject({ connected: false, broken: true });
    const [row] = await db.query('SELECT broken_at, last_error FROM autorouter_links');
    expect(row.last_error).toBe('refresh token revoked');
    const s = (await pilot.api.call('GET', `flights/${flightId}/filing`)).body;
    expect(s.filers[0]).toMatchObject({
      available: false,
      connect: 'reconnect',
      reason: 'Reconnect autorouter to file.',
    });
    ar.state.refreshFails = false;

    // reconnecting mends it
    const u = await authorize(pilot);
    await pilot.get(`autorouter/callback?code=good-3&state=${u.searchParams.get('state')}`);
    expect((await pilot.api.call('GET', 'autorouter')).body).toMatchObject({ connected: true, broken: false });
  });

  test('the iOS app: a ticket opens the flow in the sign-in sheet and comes back to the app', async () => {
    const { url } = (await pilot.api.call('POST', 'autorouter/app-connect')).body;
    expect(url).toMatch(new RegExp(`^${srv.origin}/api/autorouter/app-connect\\?ticket=`));
    const sheet = browser(srv.base); // Safari's cookies, not the app's session
    const r = await sheet.get(url);
    expect(r.status).toBe(302);
    const state = new URL(r.location).searchParams.get('state');
    expect((await sheet.get(`autorouter/callback?code=good-4&state=${state}`)).location).toBe(
      'pigsgottafly://autorouter?result=connected',
    );
    expect((await sheet.get('autorouter/app-connect?ticket=forged.x')).location).toBe(
      'pigsgottafly://autorouter?result=failed',
    );
  });

  test('disconnect forgets the tokens', async () => {
    expect((await pilot.api.call('POST', 'autorouter/disconnect')).body).toMatchObject({ connected: false });
    expect(await db.query('SELECT * FROM autorouter_links')).toEqual([]);
    expect((await pilot.api.call('GET', `flights/${flightId}/filing`)).body.filers[0].connect).toBe('connect');
  });
});
