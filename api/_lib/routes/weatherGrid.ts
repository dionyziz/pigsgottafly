// Forecast proxy: GET /weather/grid → WeatherGridResponse (src/shared/weatherGrid.ts). The browser
// never calls Open-Meteo itself; it asks for model grid nodes (winds aloft, hazard corridor) and
// aerodromes (surface conditions), and this route answers from a cache shared by every pilot:
//
//   - Cache rows (weather_cache, migration 044) are keyed by (model, endpoint, model run, variable
//     set, location, UTC day). The latest run comes from Open-Meteo's meta.json (checked again only
//     once the next run is due), so each node is fetched once per model run (ECMWF: every 6 h).
//   - Missing locations are fetched in batched multi-location requests (comma-separated lists), with
//     the same parameters the browser used to send (Open-Meteo answers a node with that grid cell).
//   - Every Open-Meteo call is counted the way Open-Meteo counts it (a location with more than 10
//     variables or 14 days counts as more than one call) against OPEN_METEO_DAILY_BUDGET (default
//     8000 per UTC day, all pilots together) and a per-pilot daily share (rateLimit 'weatherFetch').
//     Over either, cached locations are still served and the rest come back null with a message.
//   - Requests are rate-limited per pilot ('weather').
// Open-Meteo failures (its own daily limit, a range error) are answers too: null locations and the
// reason in `message`, never a 5xx.
import { isIsoDate, isoDay } from '../../../src/shared/date.js';
import type { IsoDate, WindModel } from '../../../src/shared/types.js';
import {
  forecastAvailability,
  GRID_MAX_DAYS,
  GRID_MAX_LOCATIONS,
  GRID_MAX_POINTS,
  gridStep,
  gridVariables,
  type Hourly,
  isWindModel,
  MODEL_META_IDS,
  type ModelRun,
  type OpenMeteoEndpoint,
  type OpenMeteoLocation,
  parseLocKey,
  type WeatherGridKind,
  type WeatherGridResponse,
} from '../../../src/shared/weatherGrid.js';
import type { Queryable } from '../db.js';
import type { Route } from '../http.js';
import type { Req } from '../http.js';
import { HttpError, reply } from '../http.js';
import { rateLimit, takeTokens } from '../rateLimit.js';

const HOSTS: Record<OpenMeteoEndpoint, string> = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  historical: 'https://historical-forecast-api.open-meteo.com/v1/forecast',
};
const META_URL = (id: string) => `https://api.open-meteo.com/data/${id}/static/meta.json`;
const MIN = 60e3;
const HOUR = 3600e3;
const DAY = 86400e3;
/** Hours between runs of each model (when the next one is due after the last). */
const RUN_EVERY_MS: Record<WindModel, number> = {
  ecmwf_ifs025: 6 * HOUR,
  gfs_seamless: 6 * HOUR,
  icon_seamless: 3 * HOUR,
  best_match: 3 * HOUR,
};
/** A forecast row is useless once a newer run has replaced it; kept a little longer for a slow meta.json. */
const FORECAST_KEEP_MS = 12 * HOUR;
const ARCHIVE_KEEP_MS = 7 * DAY;
/** meta.json is not asked again sooner than this (the pilot's "refresh" included). */
const META_MIN_MS = 1 * MIN;
/** While a new run is due, meta.json is asked again after this. */
const META_RECHECK_MS = 10 * MIN;
/** Without a known run (meta.json down, best_match): data is reused for this long. */
const UNKNOWN_RUN_MS = 3 * HOUR;
/** Locations per Open-Meteo request (URL length). */
const LOCATIONS_PER_REQUEST = 100;
export const DEFAULT_DAILY_BUDGET = 8000;
export const TIMEOUT_MS = 20000;
/** Grid nodes and aerodromes must lie around Greece. */
const BBOX = { minLat: 28, maxLat: 48, minLon: 10, maxLon: 40 };

export interface WeatherGridOptions {
  /** Upstream fetch (tests and local runs inject a mock or synthetic data; default: global fetch). */
  fetch?: typeof fetch;
  now?: () => number;
  /** Open-Meteo calls per UTC day for all pilots together (OPEN_METEO_DAILY_BUDGET). */
  dailyBudget?: number;
  /** The upstream is generated data (local runs). */
  synthetic?: boolean;
  timeoutMs?: number;
}

export interface GridQuery {
  kind: WeatherGridKind;
  model: WindModel;
  from: IsoDate;
  to: IsoDate;
  locs: string[];
  fresh: boolean;
}

/** Open-Meteo's count for one request: each location, ×(variables/10) above 10, ×(days/14) above 14. */
export function weightOf(locations: number, variables: number, days: number): number {
  return locations * Math.max(1, variables / 10) * Math.max(1, days / 14);
}

const daysFrom = (from: IsoDate, to: IsoDate): IsoDate[] => {
  const out: IsoDate[] = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += DAY) out.push(isoDay(t));
  return out;
};

/** Parses and checks the query (400 on anything malformed). */
export function parseGridQuery(q: URLSearchParams): GridQuery {
  const kind = q.get('kind');
  if (kind !== 'wind' && kind !== 'hazard') throw new HttpError(400, 'kind: wind or hazard');
  const model = q.get('model') || '';
  if (!isWindModel(model)) throw new HttpError(400, 'model: unknown');
  const from = q.get('from') || '',
    to = q.get('to') || from;
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw new HttpError(400, 'from/to: YYYY-MM-DD');
  if (daysFrom(from, to).length > GRID_MAX_DAYS) throw new HttpError(400, `at most ${GRID_MAX_DAYS} days`);
  const locs = [...new Set((q.get('locs') || '').split(';').filter(Boolean))];
  if (!locs.length) throw new HttpError(400, 'locs: one or more locations');
  if (locs.length > GRID_MAX_LOCATIONS) throw new HttpError(400, `at most ${GRID_MAX_LOCATIONS} locations`);
  const step = gridStep(kind, model);
  let points = 0;
  for (const k of locs) {
    const p = parseLocKey(k);
    if (!p || p.lat < BBOX.minLat || p.lat > BBOX.maxLat || p.lon < BBOX.minLon || p.lon > BBOX.maxLon)
      throw new HttpError(400, `locs: ${k.slice(0, 40)} is not a location here`);
    if (p.point) {
      if (kind !== 'wind') throw new HttpError(400, 'locs: points only for winds');
      points++;
    } else {
      const off = (x: number) => Math.abs(x / step - Math.round(x / step));
      if (off(p.lat) > 1e-6 || off(p.lon) > 1e-6) throw new HttpError(400, `locs: ${k} is not a ${step}° grid node`);
    }
  }
  if (points > GRID_MAX_POINTS) throw new HttpError(400, `at most ${GRID_MAX_POINTS} points`);
  return { kind, model, from, to, locs, fresh: q.get('fresh') === '1' };
}

/** One location's response split into UTC days ('2026-11-16T05:00' → '2026-11-16'). */
export function splitByDay(loc: OpenMeteoLocation): Map<IsoDate, OpenMeteoLocation> {
  const out = new Map<IsoDate, OpenMeteoLocation>();
  const h = loc?.hourly;
  if (!h || !Array.isArray(h.time)) return out;
  const keys = Object.keys(h).filter((k) => k !== 'time');
  h.time.forEach((t, i) => {
    const day = String(t).slice(0, 10);
    let d = out.get(day);
    if (!d) {
      const hourly = { time: [] as string[] } as Hourly;
      for (const k of keys) (hourly as Record<string, unknown[]>)[k] = [];
      d = {
        hourly,
        ...(loc.latitude !== undefined ? { latitude: loc.latitude } : {}),
        ...(loc.longitude !== undefined ? { longitude: loc.longitude } : {}),
        ...(loc.elevation !== undefined ? { elevation: loc.elevation } : {}),
      };
      out.set(day, d);
    }
    d.hourly.time.push(String(t));
    for (const k of keys) (d.hourly as Record<string, unknown[]>)[k].push((h[k] as unknown[])?.[i] ?? null);
  });
  return out;
}

/** Days joined back into one location (the first day's coordinates). */
export function joinDays(parts: OpenMeteoLocation[]): OpenMeteoLocation | null {
  if (!parts.length) return null;
  const keys = Object.keys(parts[0].hourly).filter((k) => k !== 'time');
  const hourly = { time: parts.flatMap((p) => p.hourly.time) } as Hourly;
  for (const k of keys)
    (hourly as Record<string, unknown[]>)[k] = parts.flatMap(
      (p) => (p.hourly[k] as unknown[]) ?? p.hourly.time.map(() => null),
    );
  const { latitude, longitude, elevation } = parts[0];
  return {
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(elevation !== undefined ? { elevation } : {}),
    hourly,
  };
}

/** Deletes expired forecast rows and budget days older than a week. */
export async function cleanupWeatherCache(db: Queryable, t: number): Promise<void> {
  await db.query('DELETE FROM weather_cache WHERE expires < $1', [t]);
  await db.query('DELETE FROM weather_budget WHERE day < $1', [isoDay(t - 7 * DAY)]);
}

export function upstreamUrl(o: {
  endpoint: OpenMeteoEndpoint;
  kind: WeatherGridKind;
  model: WindModel;
  nodes: boolean;
  locs: { lat: number; lon: number }[];
  from: IsoDate;
  to: IsoDate;
}): string {
  const p = new URLSearchParams({
    latitude: o.locs.map((x) => String(x.lat)).join(','),
    longitude: o.locs.map((x) => String(x.lon)).join(','),
    hourly: gridVariables(o.kind).join(','),
    ...(o.kind === 'wind' ? { wind_speed_unit: 'kn' } : {}),
    timezone: 'GMT',
    start_date: o.from,
    end_date: o.to,
    models: o.model,
  });
  return `${HOSTS[o.endpoint]}?${p}`;
}

class Upstream extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Shorter words for Open-Meteo's refusals. */
function upstreamMessage(e: unknown): string {
  const m = String((e as Error)?.message || e);
  if (/daily api request limit/i.test(m)) return 'Open-Meteo daily request limit reached; try again later';
  if (/(minutely|hourly) api request limit/i.test(m)) return 'Open-Meteo busy; try again in a minute';
  return m.replace(/^Error: /, '');
}

export function createWeatherGrid(opts: WeatherGridOptions = {}) {
  const now = () => (opts.now || Date.now)();
  const doFetch = (u: string, init?: RequestInit) => (opts.fetch || fetch)(u, init);
  const budget = Math.max(0, opts.dailyBudget ?? DEFAULT_DAILY_BUDGET);
  const meta = new Map<string, { at: number; run: ModelRun | null; p?: Promise<ModelRun | null> }>();
  /** In-flight upstream fetches of this instance, by cache key: a second request waits for the first. */
  const inflight = new Map<string, Promise<OpenMeteoLocation | null | undefined>>();

  const nextRunDue = (model: WindModel, run: ModelRun) =>
    (run.availableMs ?? run.runMs + 5 * HOUR) + RUN_EVERY_MS[model];

  async function fetchMeta(model: WindModel): Promise<ModelRun | null> {
    const id = MODEL_META_IDS[model];
    if (!id) return null;
    try {
      const res = await doFetch(META_URL(id), { signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS) });
      if (!res.ok) return null;
      const m = (await res.json()) as { last_run_initialisation_time?: unknown; last_run_availability_time?: unknown };
      const init = Number(m?.last_run_initialisation_time),
        avail = Number(m?.last_run_availability_time);
      return isFinite(init) && init > 0
        ? { runMs: init * 1000, availableMs: isFinite(avail) && avail > 0 ? avail * 1000 : null }
        : null;
    } catch {
      return null;
    }
  }

  /** The latest run of a model: meta.json, asked again only once the next run is due (or on a refresh). */
  async function latestRun(model: WindModel, fresh: boolean): Promise<ModelRun | null> {
    if (!MODEL_META_IDS[model]) return null;
    const t = now();
    const hit = meta.get(model);
    if (hit?.p) return hit.p;
    const stale =
      !hit ||
      (fresh && t - hit.at >= META_MIN_MS) ||
      (t - hit.at >= META_RECHECK_MS && (!hit.run || t >= nextRunDue(model, hit.run)));
    if (!stale) return hit.run;
    const p = fetchMeta(model);
    meta.set(model, { at: hit?.at ?? 0, run: hit?.run ?? null, p });
    const run = await p;
    // a failed meta.json keeps the last known run
    meta.set(model, { at: now(), run: run ?? hit?.run ?? null });
    return run ?? hit?.run ?? null;
  }

  /** Takes `weight` calls from today's budget; false when that would exceed it. */
  async function takeBudget(db: Queryable, weight: number): Promise<boolean> {
    if (weight > budget) return false;
    const rows = await db.query(
      `INSERT INTO weather_budget (day, calls, requests) VALUES ($1, $2, 1)
       ON CONFLICT (day) DO UPDATE SET calls = weather_budget.calls + $2, requests = weather_budget.requests + 1
       WHERE weather_budget.calls + $2 <= $3
       RETURNING calls`,
      [isoDay(now()), weight, budget],
    );
    return rows.length > 0;
  }

  async function fetchUpstream(url: string): Promise<OpenMeteoLocation[]> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
        });
      } catch (e) {
        if (attempt < 1) continue;
        throw new Upstream(`Open-Meteo did not answer (${String((e as Error)?.message || e)})`, 0);
      }
      const body = (await res.json().catch(() => null)) as
        { error?: boolean; reason?: string } | OpenMeteoLocation | OpenMeteoLocation[] | null;
      if (!res.ok || !body || (body as { error?: boolean }).error) {
        if (res.status >= 500 && attempt < 1) continue;
        throw new Upstream(
          (body && (body as { reason?: string }).reason) || `Open-Meteo HTTP ${res.status}`,
          res.status,
        );
      }
      return (Array.isArray(body) ? body : [body]) as OpenMeteoLocation[];
    }
  }

  async function serve(
    db: Queryable,
    q: GridQuery,
    who: { pilotId?: string | null; req?: Req },
  ): Promise<WeatherGridResponse> {
    const t = now();
    const av = forecastAvailability(q.from, q.model, t);
    const empty = (message: string): WeatherGridResponse => ({
      endpoint: av.kind === 'historical' ? 'historical' : 'forecast',
      run: null,
      recheckMs: t + 15 * MIN,
      locations: Object.fromEntries(q.locs.map((k) => [k, null])),
      message,
      ...(opts.synthetic ? { synthetic: true } : {}),
    });
    if (av.kind === 'invalid') throw new HttpError(400, 'from: YYYY-MM-DD');
    if (av.kind === 'too-far') return empty(`forecast reaches ${av.lastDate}`);
    const endpoint = av.endpoint;
    // the last day must be in the range too
    const days = daysFrom(q.from, q.to).filter((d) => d <= av.lastDate);
    const run = endpoint === 'forecast' ? await latestRun(q.model, q.fresh) : null;
    const runKey = endpoint === 'historical' ? 0 : run ? run.runMs : -Math.floor(t / UNKNOWN_RUN_MS) * UNKNOWN_RUN_MS;
    const recheckMs =
      endpoint === 'historical'
        ? t + DAY
        : run
          ? Math.max(t + 5 * MIN, nextRunDue(q.model, run) > t ? nextRunDue(q.model, run) : t + META_RECHECK_MS)
          : t + 15 * MIN;
    const expires = t + (endpoint === 'historical' ? ARCHIVE_KEEP_MS : FORECAST_KEEP_MS);
    const ck = (loc: string, day: string) => `${q.model}|${endpoint}|${runKey}|${q.kind}|${loc}|${day}`;

    // ---- cached
    const have = new Map<string, OpenMeteoLocation | null>(); // ck → data (null: Open-Meteo has none)
    const rows = await db.query<{ loc: string; day: string; data: OpenMeteoLocation | string | null }>(
      `SELECT loc, day, data FROM weather_cache
       WHERE model = $1 AND endpoint = $2 AND run = $3 AND kind = $4 AND expires > $5
         AND day IN (SELECT jsonb_array_elements_text($6::jsonb)) AND loc IN (SELECT jsonb_array_elements_text($7::jsonb))`,
      [q.model, endpoint, runKey, q.kind, t, JSON.stringify(days), JSON.stringify(q.locs)],
    );
    for (const r of rows) have.set(ck(r.loc, r.day), typeof r.data === 'string' ? JSON.parse(r.data) : r.data);

    // ---- missing: wait for the same fetch in flight on this instance, else fetch
    const messages = new Set<string>();
    const waits: Promise<void>[] = [];
    const want = new Map<string, IsoDate[]>(); // loc → days to fetch
    for (const loc of q.locs) {
      for (const day of days) {
        const key = ck(loc, day);
        if (have.has(key)) continue;
        const p = inflight.get(key);
        if (p) {
          waits.push(
            p.then((v) => {
              if (v !== undefined) have.set(key, v);
            }),
          );
          continue;
        }
        want.set(loc, [...(want.get(loc) ?? []), day]);
      }
    }
    // group by (node or point, days wanted): one request covers the days of a group
    const groups = new Map<string, { nodes: boolean; days: IsoDate[]; locs: string[] }>();
    for (const [loc, ds] of want) {
      const nodes = !loc.startsWith('p:');
      const g = `${nodes}|${ds.join(',')}`;
      if (!groups.has(g)) groups.set(g, { nodes, days: ds, locs: [] });
      groups.get(g)!.locs.push(loc);
    }
    const nVars = gridVariables(q.kind).length;
    for (const g of groups.values()) {
      for (let i = 0; i < g.locs.length; i += LOCATIONS_PER_REQUEST) {
        const chunk = g.locs.slice(i, i + LOCATIONS_PER_REQUEST);
        const job = fetchChunk(chunk, g.nodes, g.days);
        for (const loc of chunk)
          for (const day of g.days) {
            const key = ck(loc, day);
            const p = job.then((m) => m.get(key));
            inflight.set(key, p);
            p.finally(() => {
              if (inflight.get(key) === p) inflight.delete(key);
            }).catch(() => {});
          }
        waits.push(
          job.then((m) => {
            for (const [k, v] of m) have.set(k, v);
          }),
        );
      }
    }

    /** Fetches a chunk for its days (all at once; the first day alone when the range is refused). */
    async function fetchChunk(
      chunk: string[],
      nodes: boolean,
      ds: IsoDate[],
    ): Promise<Map<string, OpenMeteoLocation | null>> {
      const got = new Map<string, OpenMeteoLocation | null>();
      const tryDays = async (dd: IsoDate[]): Promise<boolean> => {
        const weight = weightOf(chunk.length, nVars, dd.length);
        const mine = await takeTokens(db, 'weatherFetch', who, weight);
        if (!mine.ok) {
          messages.add('your daily forecast share used up');
          return true;
        }
        if (!(await takeBudget(db, weight))) {
          messages.add('daily forecast budget used up (resets 00:00Z)');
          return true;
        }
        const locs = chunk.map((k) => parseLocKey(k)!);
        let res: OpenMeteoLocation[];
        try {
          res = await fetchUpstream(
            upstreamUrl({ endpoint, kind: q.kind, model: q.model, nodes, locs, from: dd[0], to: dd[dd.length - 1] }),
          );
        } catch (e) {
          if (e instanceof Upstream && e.status === 400 && dd.length > 1) return false; // e.g. the last day is out of range
          messages.add(upstreamMessage(e));
          return true;
        }
        const toStore: unknown[][] = [];
        chunk.forEach((loc, k) => {
          const byDay = splitByDay(res[k]);
          for (const day of dd) {
            const v = byDay.get(day) ?? null;
            got.set(ck(loc, day), v);
            toStore.push([loc, day, v]);
          }
        });
        await db.query(
          `INSERT INTO weather_cache (model, endpoint, run, kind, loc, day, data, fetched, expires)
           SELECT $1, $2, $3, $4, x->>0, x->>1, NULLIF(x->2, 'null'::jsonb), $5, $6 FROM jsonb_array_elements($7::jsonb) AS x
           ON CONFLICT (model, endpoint, run, kind, loc, day) DO UPDATE SET data = EXCLUDED.data, fetched = EXCLUDED.fetched, expires = EXCLUDED.expires`,
          [q.model, endpoint, runKey, q.kind, t, expires, JSON.stringify(toStore)],
        );
        return true;
      };
      if (!(await tryDays(ds))) await tryDays(ds.slice(0, 1));
      return got;
    }

    await Promise.all(waits);
    // now and then, forget expired rows and old budget days
    if (Math.random() < 0.02) await cleanupWeatherCache(db, t);

    // ---- answer: each location's days from `from`, as far as they go without a gap
    const locations: Record<string, OpenMeteoLocation | null> = {};
    let missing = 0;
    for (const loc of q.locs) {
      const parts: OpenMeteoLocation[] = [];
      for (const day of days) {
        const v = have.get(ck(loc, day));
        if (!v) break;
        parts.push(v);
      }
      locations[loc] = joinDays(parts);
      if (!locations[loc]) missing++;
    }
    const message = missing && messages.size ? [...messages].join('; ') : undefined;
    return {
      endpoint,
      run,
      recheckMs,
      locations,
      ...(message ? { message } : {}),
      ...(opts.synthetic ? { synthetic: true } : {}),
    };
  }

  return {
    serve,
    latestRun,
    clear: () => {
      meta.clear();
      inflight.clear();
    },
  };
}

// one service per API configuration (its meta.json cache and in-flight fetches)
const services = new WeakMap<object, ReturnType<typeof createWeatherGrid>>();
const DEFAULT_KEY = {};
export function weatherGridFor(o: WeatherGridOptions | undefined): ReturnType<typeof createWeatherGrid> {
  const key = o ?? DEFAULT_KEY;
  let s = services.get(key);
  if (!s) services.set(key, (s = createWeatherGrid(o)));
  return s;
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/weather/grid',
    async handler(ctx) {
      const q = parseGridQuery(ctx.query);
      const who = { pilotId: ctx.pilot?.id, req: ctx.req };
      await rateLimit(ctx.db, 'weather', who);
      const body = await weatherGridFor(ctx.config.openMeteo).serve(ctx.db, q, who);
      return reply(200, body, { 'Cache-Control': 'private, no-store' });
    },
  },
];
