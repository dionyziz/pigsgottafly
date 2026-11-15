// The METAR/TAF proxy route (api/_lib/routes/weather.ts) with a fake upstream serving the recorded
// aviationweather.gov responses in tests/fixtures/weather/awc-*.json.
import { describe, expect, test } from 'vitest';
import metars from '../../fixtures/weather/awc-metar-2026-11-15.json';
import tafs from '../../fixtures/weather/awc-taf-2026-11-15.json';
import { createWeatherProxy, parseIds, pickMetars, pickTafs, METAR_TTL_MS, STALE_MAX_MS, TAF_TTL_MS } from '../../../api/_lib/routes/weather';
import { HttpError, Reply, type Ctx } from '../../../api/_lib/http';

const T0 = Date.parse('2026-11-15T13:36:00Z');

function upstream() {
  const calls: string[] = [];
  const state = { metarDown: false, tafDown: false };
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname.split('/').pop() + '?' + url.searchParams.get('ids'));
    const kind = url.pathname.endsWith('/metar') ? 'metar' : 'taf';
    if ((kind === 'metar' && state.metarDown) || (kind === 'taf' && state.tafDown)) return new Response('<html>502</html>', { status: 502 });
    const ids = url.searchParams.get('ids')!.split(',');
    const rows = (kind === 'metar' ? metars : tafs).filter((r) => ids.includes(r.icaoId));
    return rows.length ? new Response(JSON.stringify(rows), { status: 200 }) : new Response(null, { status: 204 });
  }) as typeof fetch;
  return { f, calls, state };
}

const ctx = (ids: string) => ({ query: new URLSearchParams({ ids }) }) as unknown as Ctx;

describe('weather proxy', () => {
  test('parseIds / pickMetars / pickTafs', () => {
    expect(parseIds(' lgav,LGTT , lgav ;x, LGIR LG1X')).toEqual(['LGAV', 'LGTT', 'LGIR']);
    expect(parseIds(null)).toEqual([]);
    const m = pickMetars([...metars, { icaoId: 'LGAV', rawOb: 'METAR LGAV 151250Z 04010KT 9999 FEW025 16/12 Q1024', obsTime: metars[0].obsTime - 1800 }, { icaoId: 'LGXX' }]);
    expect(m.get('LGAV')).toEqual({ raw: metars[0].rawOb, observed: metars[0].obsTime * 1000 }); // the latest
    expect(m.has('LGXX')).toBe(false);
    expect(pickTafs([{ icaoId: 'LGAV', rawTAF: 'old', issueTime: '2026-11-15T05:00:00.000Z' }, ...tafs]).get('LGAV')).toBe(tafs[0].rawTAF);
  });

  test('returns METAR + TAF per reporting station; non-reporting ones are absent; caches', async () => {
    const up = upstream();
    let now = T0;
    const p = createWeatherProxy({ fetch: up.f, now: () => now });
    const out = await p.routes[0].handler(ctx('LGAV,LGTT,LGIR'));
    expect(out).toBeInstanceOf(Reply);
    const r = out as Reply;
    expect(r.status).toBe(200);
    expect(r.headers).toEqual({ 'Cache-Control': 'private, max-age=60' });
    const body = r.body as { stations: Record<string, { metar: string; taf: string; observed: number }>; fetched: number };
    expect(Object.keys(body.stations).sort()).toEqual(['LGAV', 'LGIR']);
    expect(body.stations.LGAV).toEqual({ metar: metars[0].rawOb, taf: tafs[0].rawTAF, observed: Date.parse('2026-11-15T13:20:00Z') });
    expect(body.fetched).toBe(T0);
    expect(up.calls.sort()).toEqual(['metar?LGAV,LGTT,LGIR', 'taf?LGAV,LGTT,LGIR']);

    // all cached, including LGTT's "no report"
    await p.get(['LGTT', 'LGAV']);
    expect(up.calls).toHaveLength(2);
    // METAR expires before the TAF; only the requested ids are refetched
    now = T0 + METAR_TTL_MS;
    await p.get(['LGTT', 'LGAV']);
    expect(up.calls.slice(2)).toEqual(['metar?LGTT,LGAV']);
    now = T0 + TAF_TTL_MS;
    await p.get(['LGAV']);
    expect(up.calls.slice(3).sort()).toEqual(['metar?LGAV', 'taf?LGAV']);
  });

  test('204 from upstream (no reports at all) is an empty answer, not an error', async () => {
    const up = upstream();
    const p = createWeatherProxy({ fetch: up.f, now: () => T0 });
    expect(await p.get(['LGTT', 'LGMG'])).toEqual({ stations: {}, fetched: T0 });
  });

  test('graceful failure: partial results, stale cache, 502 only when nothing is available', async () => {
    const up = upstream();
    let now = T0;
    const p = createWeatherProxy({ fetch: up.f, now: () => now });
    up.state.tafDown = true;
    const a = await p.get(['LGAV']);
    expect(a.stations.LGAV).toMatchObject({ metar: metars[0].rawOb, taf: null });
    up.state.tafDown = false;
    await p.get(['LGIR']);
    // upstream down: cached reports served while younger than STALE_MAX_MS
    up.state.metarDown = up.state.tafDown = true;
    now = T0 + 60 * 60 * 1000;
    expect((await p.get(['LGIR'])).stations.LGIR.metar).toBe(metars.find((m) => m.icaoId === 'LGIR')!.rawOb);
    now = T0 + STALE_MAX_MS + 1;
    await expect(p.get(['LGIR'])).rejects.toMatchObject({ status: 502 });
    await expect(p.get(['LGKR'])).rejects.toBeInstanceOf(HttpError);
    // network errors and timeouts are failures too
    const q = createWeatherProxy({ fetch: (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as typeof fetch, now: () => T0 });
    await expect(q.get(['LGAV'])).rejects.toMatchObject({ status: 502 });
  });

  test('a slow or failed first upstream call is retried once (cold instance: ~12 s first answer)', async () => {
    const up = upstream();
    let n = 0;
    // the first call of each kind hangs past the timeout, the retry answers at once
    const seen = new Set<string>();
    const slowFirst = (async (input: RequestInfo | URL, init?: RequestInit) => {
      n++;
      const kind = String(input).includes('/metar') ? 'metar' : 'taf';
      if (!seen.has(kind)) {
        seen.add(kind);
        return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)));
      }
      return up.f(input, init);
    }) as typeof fetch;
    const p = createWeatherProxy({ fetch: slowFirst, now: () => T0, timeoutMs: 50 });
    const r = await p.get(['LGAV']);
    expect(r.stations.LGAV.metar).toBe(metars.find((m) => m.icaoId === 'LGAV')!.rawOb);
    expect(r.stations.LGAV.taf).toBeTruthy();
    expect(n).toBe(4);
    // 5xx is retried, then given up (one retry by default)
    const down = upstream();
    down.state.metarDown = true;
    const q = createWeatherProxy({ fetch: down.f, now: () => T0 });
    const r2 = await q.get(['LGAV']);
    expect(r2.stations.LGAV.metar).toBeNull();
    expect(down.calls.filter((c) => c.startsWith('metar'))).toHaveLength(2);
    // a 4xx is not retried
    const bad = upstream();
    const f400 = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/metar')) { bad.calls.push('metar'); return new Response('bad', { status: 400 }); }
      return bad.f(input, init);
    }) as typeof fetch;
    await createWeatherProxy({ fetch: f400, now: () => T0 }).get(['LGAV']);
    expect(bad.calls.filter((c) => c === 'metar')).toHaveLength(1);
  });

  test('validates ids', async () => {
    const p = createWeatherProxy({ fetch: upstream().f, now: () => T0 });
    await expect(p.routes[0].handler(ctx(''))).rejects.toMatchObject({ status: 400 });
    await expect(p.routes[0].handler(ctx('KJFK,LGAV,EGLL,LGIR,LGKR,LGMG,LGTT,LGEL,LGSA,LGKO,LGRP,LGTS,LGPZ,LGKL,LGKV,LGZA,LGSR,LGMK,LGNX,LGPA,LGKF'))).rejects.toMatchObject({ status: 400 });
  });
});
