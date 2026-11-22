// Tatoi (LGTT) publishes METAR and TAF that reach EUROCONTROL's database (autorouter) but not the
// international feed (aviationweather.gov): the pilot's own autorouter account fills the gap for that
// pilot only, since the access is personal.
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { metarTime } from '../../api/_lib/routes/weather';
import { createServer } from '../../server/server';
import { CID, client, JWK } from './helpers';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const LGTT_METAR = 'METAR LGTT 220730Z 00000KT 9999 FEW030 14/09 Q1020';
const LGTT_TAF = 'TAF LGTT 220700Z 2209/2218 24008KT 9999 FEW025';
const LGAV_METAR = 'METAR LGAV 220720Z VRB03KT 9999 FEW030 16/06 Q1021 NOSIG';
const NOW = Date.UTC(2026, 10, 22, 7, 50);

let arCalls: string[] = [];
const autorouterFetch = (async (input: string | URL | Request) => {
  const path = new URL(String(input)).pathname.replace(/^\/v1\.0/, '');
  arCalls.push(path);
  if (path === '/oauth2/token') return json(200, { access_token: 'tok', expires_in: 3600 });
  if (path === '/met/metartaf/LGTT') return json(200, { metar: LGTT_METAR, taf: LGTT_TAF });
  return json(404, { error: '' });
}) as typeof fetch;
// aviationweather.gov: LGAV only, as in reality
const awcFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/metar'))
    return json(200, [{ icaoId: 'LGAV', rawOb: LGAV_METAR, obsTime: Date.UTC(2026, 10, 22, 7, 20) / 1000 }]);
  return new Response(null, { status: 204 });
}) as typeof fetch;

let base = '';
let close: () => Promise<void>;
beforeAll(async () => {
  const s = createServer({
    db: 'memory://',
    googleClientId: CID,
    googleKeys: async () => [JWK],
    autorouter: { email: 'me@example.com', password: 'x', filing: false, fetch: autorouterFetch },
    autorouterPilots: ['owner@example.com'],
    aviationWeather: { fetch: awcFetch, now: () => NOW },
    client: (_q, r) => {
      r.writeHead(404);
      r.end();
    },
  });
  await s.ready;
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/`;
  close = () => new Promise<void>((r) => s.close(() => r()));
});
afterAll(() => close());

describe('METAR and TAF where the international feed has none', () => {
  test("the autorouter account's pilot gets Tatoi's reports", async () => {
    arCalls = [];
    const c = client(base);
    await c.login('s-owner', 'owner@example.com');
    const r = (await c.call('GET', 'weather/metar?ids=LGTT,LGAV')).body;
    expect(r.stations.LGTT).toEqual({ metar: LGTT_METAR, taf: LGTT_TAF, observed: Date.UTC(2026, 10, 22, 7, 30) });
    expect(r.stations.LGAV.metar).toBe(LGAV_METAR);
    expect(arCalls).toContain('/met/metartaf/LGTT');
  });

  test('another pilot gets none of it, and autorouter is not asked', async () => {
    arCalls = [];
    const c = client(base);
    await c.login('s-other', 'other@example.com');
    const r = (await c.call('GET', 'weather/metar?ids=LGTT,LGAV')).body;
    expect(r.stations.LGTT).toBeUndefined();
    expect(r.stations.LGAV.metar).toBe(LGAV_METAR);
    expect(arCalls).toEqual([]);
  });

  test("a METAR's time: the latest DDHHMM not after now, across a month end", () => {
    expect(metarTime(LGTT_METAR, NOW)).toBe(Date.UTC(2026, 10, 22, 7, 30));
    expect(metarTime('METAR LGTT 302350Z 00000KT', Date.UTC(2026, 11, 1, 0, 10))).toBe(Date.UTC(2026, 10, 30, 23, 50));
    expect(metarTime('no time', NOW)).toBeNull();
  });
});
