// A fake Open-Meteo built from recorded ECMWF IFS 0.25° responses, for the weather tests:
//   - tests/fixtures/weather/open-meteo-ecmwf-2026-11-15.json (winds aloft + surface, 2 nodes) and
//     tests/fixtures/openmeteo-hazards-lgtt-2026-11-16.json (hazard variables, 5 nodes) are the
//     templates; every 0.25° node over Greece gets one of them (by its indices) with a small
//     node-specific offset, so neighbouring nodes differ;
//   - a location is answered the way Open-Meteo does: the nearest grid node's values, with the
//     elevation of the point asked for (its terrain) and the 2 m temperature corrected to it
//     (0.65 °C per 100 m), as Open-Meteo's downscaling does (cell_selection=nearest: the node's own);
//   - hours are absolute (any start_date gives the same values for the same hour), 48-hour cycle;
//   - meta.json answers a fixed run.
// Also: gridApi() serves GET /api/weather/grid (the real route, on in-memory PGlite) with it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../../api/_lib/db';
import { openDb } from '../../api/_lib/db';
import { routes as gridRoutes, type WeatherGridOptions } from '../../api/_lib/routes/weatherGrid';
import { Reply, type Ctx } from '../../api/_lib/http';
import type { OpenMeteoLocation } from '../../src/shared/weatherGrid';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIND: OpenMeteoLocation[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/fixtures/weather/open-meteo-ecmwf-2026-11-15.json'), 'utf8'),
);
const HAZ: OpenMeteoLocation[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/fixtures/openmeteo-hazards-lgtt-2026-11-16.json'), 'utf8'),
);
const EPOCH = Date.parse('2026-11-15T00:00:00Z');
const H = 3600e3;
export const META = {
  last_run_initialisation_time: Date.parse('2026-11-15T06:00:00Z') / 1000,
  last_run_availability_time: Date.parse('2026-11-15T13:05:38Z') / 1000,
};

function nodeValue(v: string, i: number, j: number, hour: number): number | null {
  const n = ((hour % 48) + 48) % 48;
  const wind = WIND[Math.abs(i * 7 + j * 3) % WIND.length].hourly as Record<string, unknown[]>;
  const haz = HAZ[Math.abs(i * 5 + j * 11) % HAZ.length].hourly as Record<string, unknown[]>;
  const src = v in wind ? wind : v in haz ? haz : null;
  const raw = src ? src[v]?.[n] : null;
  if (typeof raw !== 'number') return null;
  const d = ((((i * 13 + j * 7) % 10) + 10) % 10) / 10; // 0 … 0.9 by node
  if (/^wind_speed/.test(v)) return raw + d * 3;
  if (/^wind_direction/.test(v)) return (raw + d * 40) % 360;
  if (/^temperature|^dew_point/.test(v)) return raw + d;
  if (/^geopotential_height/.test(v)) return raw + d * 20;
  if (/^cloud_cover/.test(v)) return Math.min(100, raw + d * 10);
  if (/pressure/.test(v)) return raw + d;
  return raw;
}
const nodeElevation = (i: number, j: number) => [242, 81, 193, 208, 46, 183, 0][Math.abs(i * 3 + j) % 7];
/** The DEM elevation Open-Meteo would use at an exact point (m). */
const pointElevation = (lat: number, lon: number) =>
  Math.round(Math.abs(Math.sin(lat * 37) * Math.cos(lon * 29)) * 400);

export interface FakeOpenMeteo {
  fetch: typeof fetch;
  /** Forecast URLs requested (not meta.json). */
  calls: string[];
  /** Locations requested in all (each counts with Open-Meteo). */
  locations(): number;
  /** Answer the next requests with this status and reason (e.g. 429 "Daily API request limit exceeded"). */
  fail(status: number | null, reason?: string): void;
  /** meta.json requests so far. */
  metaCalls(): number;
  /** A new model run is out (initialised at runMs, available at availableMs). */
  setRun(runMs: number, availableMs: number): void;
}

export function fakeOpenMeteo(opts: { step?: number; lastDate?: string; noMeta?: boolean } = {}): FakeOpenMeteo {
  const step = opts.step ?? 0.25;
  const calls: string[] = [];
  let failing: { status: number; reason: string } | null = null;
  let meta = { ...META },
    metaCalls = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith('/meta.json')) {
      metaCalls++;
      return opts.noMeta ? json({}, 404) : json(meta);
    }
    calls.push(url.href);
    if (failing) return json({ error: true, reason: failing.reason }, failing.status);
    const q = url.searchParams;
    if (opts.lastDate && (q.get('end_date') || '') > opts.lastDate)
      return json(
        { error: true, reason: `Parameter 'end_date' is out of allowed range from 2026-08-14 to ${opts.lastDate}` },
        400,
      );
    const lats = q.get('latitude')!.split(',').map(Number),
      lons = q.get('longitude')!.split(',').map(Number);
    const vars = q.get('hourly')!.split(',');
    const nearest = q.get('cell_selection') === 'nearest';
    const d0 = Date.parse(q.get('start_date') + 'T00:00:00Z'),
      d1 = Date.parse(q.get('end_date') + 'T00:00:00Z');
    const out = lats.map((lat, k) => {
      const lon = lons[k];
      const i = Math.round(lat / step),
        j = Math.round(lon / step);
      const elevation = nearest ? nodeElevation(i, j) : pointElevation(lat, lon);
      const time: string[] = [];
      for (let t = d0; t < d1 + 24 * H; t += H) time.push(new Date(t).toISOString().slice(0, 16));
      const hourly: Record<string, unknown[]> = { time };
      for (const v of vars) {
        hourly[v] = time.map((t) => {
          const x = nodeValue(v, i, j, Math.round((Date.parse(t + 'Z') - EPOCH) / H));
          if (x === null || nearest || v !== 'temperature_2m') return x;
          return x + (nodeElevation(i, j) - elevation) * 0.0065; // downscaled to the point
        });
      }
      return { latitude: i * step, longitude: j * step, elevation, hourly };
    });
    return json(out.length === 1 ? out[0] : out);
  }) as typeof fetch;
  return {
    fetch: f,
    calls,
    locations: () => calls.reduce((n, c) => n + new URL(c).searchParams.get('latitude')!.split(',').length, 0),
    fail: (status, reason = '') => {
      failing = status === null ? null : { status, reason };
    },
    metaCalls: () => metaCalls,
    setRun: (runMs, availableMs) => {
      meta = { last_run_initialisation_time: runMs / 1000, last_run_availability_time: availableMs / 1000 };
    },
  };
}

/** GET /api/weather/grid through the real route on in-memory PGlite, with `openMeteo` as its options. */
export async function gridApi(openMeteo: WeatherGridOptions, db?: Db) {
  const d = db ?? (await openDb('memory://'));
  const route = gridRoutes.find((r) => r.path === '/weather/grid')!;
  const requests: string[] = [];
  const get = async (p: string): Promise<unknown> => {
    requests.push(p);
    const query = new URLSearchParams(p.split('?')[1] || '');
    const ctx = {
      db: d,
      query,
      pilot: undefined,
      req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } },
      config: { openMeteo },
      headers: {},
    } as unknown as Ctx;
    const out = await route.handler(ctx);
    return out instanceof Reply ? out.body : out;
  };
  return { get, db: d, requests, close: () => (db ? Promise.resolve() : d.close()) };
}
