// GET /api/weather/grid (api/_lib/routes/weatherGrid.ts): the forecast proxy with its shared cache
// (migration 044), model runs, batching, the daily budget and the per-pilot limits, against the fake
// Open-Meteo of tests/helpers/openMeteoGrid.ts (recorded ECMWF data).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../server/server';
import { openDb, type Db } from '../../api/_lib/db';
import {
  cleanupWeatherCache,
  createWeatherGrid,
  parseGridQuery,
  splitByDay,
  joinDays,
  weightOf,
} from '../../api/_lib/routes/weatherGrid';
import { HttpError } from '../../api/_lib/http';
import type { WeatherGridResponse } from '../../src/shared/weatherGrid';
import { CID, JWK, client } from './helpers';
import { fakeOpenMeteo, META } from '../helpers/openMeteoGrid';

const T = (s: string) => Date.parse(s);
const NOW = T('2026-11-15T13:36:00Z');
const RUN = META.last_run_initialisation_time * 1000;
const q = (o: Record<string, string>) => parseGridQuery(new URLSearchParams(o));
const wind = (locs: string[], o: Record<string, string> = {}) =>
  q({ kind: 'wind', model: 'ecmwf_ifs025', from: '2026-11-16', to: '2026-11-17', locs: locs.join(';'), ...o });
const who = { pilotId: null };

let db: Db;
beforeAll(async () => {
  db = await openDb('memory://');
});
afterAll(async () => {
  await db.close();
});

describe('query', () => {
  test('kind, model, dates, grid nodes and points are checked', () => {
    const bad = (o: Record<string, string>) => {
      try {
        q(o);
        return null;
      } catch (e) {
        return (e as HttpError).status + ' ' + (e as Error).message;
      }
    };
    const base = { kind: 'wind', model: 'ecmwf_ifs025', from: '2026-11-16', locs: '38,23.75' };
    expect(q(base)).toEqual({
      kind: 'wind',
      model: 'ecmwf_ifs025',
      from: '2026-11-16',
      to: '2026-11-16',
      locs: ['38,23.75'],
      fresh: false,
    });
    expect(bad({ ...base, kind: 'rain' })).toBe('400 kind: wind or hazard');
    expect(bad({ ...base, model: 'x' })).toBe('400 model: unknown');
    expect(bad({ ...base, to: '2026-11-19' })).toBe('400 at most 2 days');
    expect(bad({ ...base, locs: '38.1,23.75' })).toBe('400 locs: 38.1,23.75 is not a 0.25° grid node');
    expect(bad({ ...base, model: 'icon_seamless', locs: '38.0625,23.75' })).toBeNull(); // ICON-EU 0.0625°
    expect(bad({ ...base, kind: 'hazard', locs: 'p:37.936,23.945' })).toBe('400 locs: points only for winds');
    expect(bad({ ...base, locs: '51.5,0' })).toMatch(/^400 locs: 51.5,0 is not a location here/);
    expect(
      bad({
        ...base,
        locs: Array.from({ length: 151 }, (_, i) => `${30 + Math.floor(i / 40) * 0.25},${15 + (i % 40) * 0.25}`).join(
          ';',
        ),
      }),
    ).toMatch(/^400/);
    expect(bad({ ...base, locs: Array.from({ length: 13 }, (_, i) => `p:37.9${i},23.9`).join(';') })).toBe(
      '400 at most 12 points',
    );
  });

  test('days split and joined; Open-Meteo weighting', () => {
    const loc = {
      latitude: 38,
      longitude: 23.75,
      elevation: 193,
      hourly: { time: ['2026-11-16T22:00', '2026-11-16T23:00', '2026-11-17T00:00'], cape: [1, 2, 3] },
    };
    const d = splitByDay(loc);
    expect([...d.keys()]).toEqual(['2026-11-16', '2026-11-17']);
    expect(d.get('2026-11-17')).toEqual({
      latitude: 38,
      longitude: 23.75,
      elevation: 193,
      hourly: { time: ['2026-11-17T00:00'], cape: [3] },
    });
    expect(joinDays([...d.values()])).toEqual(loc);
    expect(weightOf(1, 45, 2)).toBe(4.5);
    expect(weightOf(10, 24, 1)).toBe(24);
    expect(weightOf(3, 8, 28)).toBe(6);
  });
});

describe('cache, runs, batching', () => {
  test('one batched request per node set; shared by every later request of the same run', async () => {
    const om = fakeOpenMeteo();
    const g = createWeatherGrid({ fetch: om.fetch, now: () => NOW });
    const a = await g.serve(db, wind(['38,23.75', '38,24', 'p:37.936,23.945']), who);
    expect(a.run).toEqual({ runMs: RUN, availableMs: META.last_run_availability_time * 1000 });
    expect(a.recheckMs).toBe(META.last_run_availability_time * 1000 + 6 * 3600e3);
    expect(Object.keys(a.locations)).toEqual(['38,23.75', '38,24', 'p:37.936,23.945']);
    expect(a.locations['38,24']!.hourly.time).toHaveLength(48);
    expect(om.calls.map((c) => new URL(c).searchParams.get('latitude'))).toEqual(['38,38', '37.936']);
    // a second instance (another serverless function) reads the database
    const g2 = createWeatherGrid({ fetch: om.fetch, now: () => NOW });
    const b = await g2.serve(db, wind(['38,24', '38.25,24']), who);
    expect(b.locations['38,24']).toEqual(a.locations['38,24']);
    expect(om.calls).toHaveLength(3);
    expect(new URL(om.calls[2]).searchParams.get('latitude')).toBe('38.25');
    // one day of a cached pair: no request
    await g2.serve(db, wind(['38,24'], { to: '2026-11-16' }), who);
    expect(om.calls).toHaveLength(3);
    // meta.json once per instance until the next run is due
    expect(om.metaCalls()).toBe(2);
  });

  test('concurrent requests for the same nodes share one Open-Meteo request', async () => {
    const om = fakeOpenMeteo();
    const g = createWeatherGrid({ fetch: om.fetch, now: () => NOW });
    const locs = ['37,22', '37,22.25'];
    const [a, b] = await Promise.all([g.serve(db, wind(locs), who), g.serve(db, wind(locs), who)]);
    expect(om.calls).toHaveLength(1);
    expect(b.locations).toEqual(a.locations);
  });

  test('a new model run: asked again only once it is due, then every node is fetched again', async () => {
    const om = fakeOpenMeteo();
    let now = NOW;
    const g = createWeatherGrid({ fetch: om.fetch, now: () => now });
    await g.serve(db, wind(['36,25']), who);
    expect([om.calls.length, om.metaCalls()]).toEqual([1, 1]);
    now = NOW + 3 * 3600e3; // before the next run is due: neither meta.json nor data
    await g.serve(db, wind(['36,25']), who);
    expect([om.calls.length, om.metaCalls()]).toEqual([1, 1]);
    const due = META.last_run_availability_time * 1000 + 6 * 3600e3;
    now = due + 60e3; // due, but not out yet: meta.json says the same run
    const same = await g.serve(db, wind(['36,25']), who);
    expect([om.calls.length, om.metaCalls()]).toEqual([1, 2]);
    expect(same.recheckMs).toBe(now + 10 * 60e3);
    now += 5 * 60e3; // asked again after 10 min only
    await g.serve(db, wind(['36,25']), who);
    expect(om.metaCalls()).toBe(2);
    now += 6 * 60e3;
    om.setRun(RUN + 6 * 3600e3, due + 5 * 60e3);
    const fresh = await g.serve(db, wind(['36,25']), who);
    expect(fresh.run!.runMs).toBe(RUN + 6 * 3600e3);
    expect([om.calls.length, om.metaCalls()]).toEqual([2, 3]);
    // the pilot's refresh asks meta.json again (at most once a minute) but not the data
    now += 2 * 60e3;
    await g.serve(db, wind(['36,25'], { fresh: '1' }), who);
    expect([om.calls.length, om.metaCalls()]).toEqual([2, 4]);
  });

  test('expired rows and old budget days are cleaned up', async () => {
    await db.query(
      `INSERT INTO weather_cache (model, endpoint, run, kind, loc, day, data, fetched, expires) VALUES ('ecmwf_ifs025', 'forecast', 1, 'wind', '30,20', '2026-01-01', NULL, 0, 5)`,
    );
    await db.query(
      `INSERT INTO weather_budget (day, calls, requests) VALUES ('2026-01-01', 10, 1) ON CONFLICT DO NOTHING`,
    );
    const n = async () => (await db.query(`SELECT count(*)::int AS n FROM weather_cache WHERE loc = '30,20'`))[0].n;
    expect(await n()).toBe(1);
    await cleanupWeatherCache(db, NOW);
    expect(await n()).toBe(0);
    expect(await db.query(`SELECT day FROM weather_budget WHERE day = '2026-01-01'`)).toEqual([]);
  });
});

describe('limits and failures', () => {
  test('the daily budget: cached nodes are served, the rest are null with the reason', async () => {
    const own = await openDb('memory://');
    try {
      const om = fakeOpenMeteo();
      const g = createWeatherGrid({ fetch: om.fetch, now: () => NOW, dailyBudget: 10 });
      const a = await g.serve(own, wind(['38,23.75', '38,24']), who); // 2 × 4.5 calls
      expect(a.message).toBeUndefined();
      const b = await g.serve(own, wind(['38,23.75', '38.5,24']), who); // 4.5 more would be 13.5
      expect(b.locations['38,23.75']).toEqual(a.locations['38,23.75']);
      expect(b.locations['38.5,24']).toBeNull();
      expect(b.message).toBe('daily forecast budget used up (resets 00:00Z)');
      expect(om.calls).toHaveLength(1);
      expect(await own.query('SELECT day, calls, requests FROM weather_budget')).toEqual([
        { day: '2026-11-15', calls: 9, requests: 1 },
      ]);
      // a pilot's own share
      const g2 = createWeatherGrid({ fetch: om.fetch, now: () => NOW });
      await own.query(`UPDATE rate_limits SET tokens = 1, updated = $1 WHERE bucket = 'weatherFetch'`, [Date.now()]);
      const c = await g2.serve(own, wind(['39,24']), who);
      expect(c.locations['39,24']).toBeNull();
      expect(c.message).toBe('your daily forecast share used up');
    } finally {
      await own.close();
    }
  });

  test("Open-Meteo's refusals come back as a reason, not an error; nothing is cached", async () => {
    const om = fakeOpenMeteo();
    const g = createWeatherGrid({ fetch: om.fetch, now: () => NOW });
    om.fail(429, 'Daily API request limit exceeded. Please try again tomorrow.');
    const a = await g.serve(db, wind(['35,24']), who);
    expect(a.locations).toEqual({ '35,24': null });
    expect(a.message).toBe('Open-Meteo daily request limit reached; try again later');
    om.fail(null);
    const b = await g.serve(db, wind(['35,24']), who);
    expect(b.locations['35,24']).not.toBeNull();
    // no answer at all (network), after one retry
    const down = createWeatherGrid({
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
      now: () => NOW,
    });
    const c = await down.serve(db, wind(['35.25,24']), who);
    expect(c.message).toBe('Open-Meteo did not answer (fetch failed)');
    expect(c.run).toBeNull();
  });

  test('beyond the forecast range: no request', async () => {
    const om = fakeOpenMeteo();
    const g = createWeatherGrid({ fetch: om.fetch, now: () => NOW });
    const r = await g.serve(db, wind(['38,24'], { from: '2026-12-20', to: '2026-12-20' }), who);
    expect(r).toMatchObject({ locations: { '38,24': null }, message: 'forecast reaches 2026-11-30' });
    expect(om.calls).toHaveLength(0);
  });
});

describe('the route', () => {
  let base = '';
  let close: () => Promise<void>;
  const om = fakeOpenMeteo();
  beforeAll(async () => {
    const s = createServer({
      db: 'memory://',
      googleClientId: CID,
      googleKeys: async () => [JWK],
      openMeteo: { fetch: om.fetch },
      client: (_req, res) => {
        res.writeHead(404);
        res.end();
      },
    });
    await s.ready;
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/`;
    close = () => new Promise<void>((r) => s.close(() => r()));
  });
  afterAll(async () => {
    await close();
  });

  test('signed in only; JSON answer; 400 on a bad query; rate-limited per pilot', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const path = `weather/grid?kind=hazard&model=ecmwf_ifs025&from=${today}&locs=38%3B23.75`.replace(
      '38%3B23.75',
      encodeURIComponent('38,23.75'),
    );
    const anon = client(base);
    expect((await anon.call('GET', path)).status).toBe(401);
    const c = client(base);
    expect((await c.login('wx-1', 'wx1@example.com')).status).toBe(200);
    const r = await c.call<WeatherGridResponse>('GET', path);
    expect(r.status).toBe(200);
    expect(r.body.locations['38,23.75']!.hourly.cape).toBeTruthy();
    expect(r.body.synthetic).toBeUndefined();
    expect((await c.call('GET', 'weather/grid?kind=hazard&model=ecmwf_ifs025&from=x&locs=38,23.75')).status).toBe(400);
    let last = 200;
    for (let i = 0; i < 205 && last !== 429; i++) last = (await c.call('GET', path)).status;
    expect(last).toBe(429);
  });
});
