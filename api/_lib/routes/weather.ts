// Weather proxy: GET /weather/metar?ids=LGAV,LGTT → MetarTafResponse, from aviationweather.gov
// (https://aviationweather.gov/api/data/metar and /taf, JSON). The browser cannot call it directly
// (no CORS), so the API fetches on its behalf.
//
//   - Up to MAX_IDS (6) ICAO codes per request; anything that is not 4 letters is ignored. Rate-limited
//     per pilot (rateLimit.ts).
//   - Per-station cache: METAR 5 min, TAF 10 min, "no report" (e.g. LGTT) remembered as well, so a
//     non-reporting aerodrome does not cost a request every time.
//   - Graceful failure: if one of the two upstream requests fails, the other's reports are still
//     returned; a failed upstream falls back to cached reports up to 3 h old; only when nothing at
//     all can be had does the route answer 502.
//   - aviationweather.gov answers 204 when no station in the list has a report.
//   - Slow upstream: the first request from a cold instance has been seen to take ~12 s (later ones
//     ~0.2 s). Each attempt may take TIMEOUT_MS; a timeout, network error or 5xx is retried once.
import type { Route } from '../http.js';
import { HttpError, reply } from '../http.js';
import type { MetarTafResponse } from '../../../src/shared/api.js';
import { rateLimit } from '../rateLimit.js';

export const MAX_IDS = 6;
export const METAR_TTL_MS = 5 * 60 * 1000;
export const TAF_TTL_MS = 10 * 60 * 1000;
/** Cached reports are served this long when the upstream fails. */
export const STALE_MAX_MS = 3 * 60 * 60 * 1000;
const UPSTREAM = 'https://aviationweather.gov/api/data';
/** Per-attempt upstream timeout. */
export const TIMEOUT_MS = 15000;
/** Extra attempts after a timeout, network error or 5xx. */
export const RETRIES = 1;

interface MetarRow { icaoId?: string; rawOb?: string; obsTime?: number; reportTime?: string }
interface TafRow { icaoId?: string; rawTAF?: string; issueTime?: string; mostRecent?: number }

interface Entry<T> { at: number; value: T | null }
interface MetarValue { raw: string; observed: number | null }

export interface WeatherProxyOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** Per-attempt timeout, ms (default TIMEOUT_MS). */
  timeoutMs?: number;
  /** Retries after a timeout, network error or 5xx (default RETRIES). */
  retries?: number;
}

class UpstreamError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

/** Parses ?ids= (comma or space separated), upper-cased, de-duplicated, valid ICAO only. */
export function parseIds(q: string | null): string[] {
  const ids = (q || '').toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z]{4}$/.test(x));
  return [...new Set(ids)];
}

/** Latest METAR per station from the provider's JSON rows. */
export function pickMetars(rows: MetarRow[]): Map<string, MetarValue> {
  const out = new Map<string, MetarValue>();
  for (const r of rows) {
    if (!r || typeof r.icaoId !== 'string' || typeof r.rawOb !== 'string' || !r.rawOb.trim()) continue;
    const observed = typeof r.obsTime === 'number' && isFinite(r.obsTime) ? r.obsTime * 1000 : (r.reportTime ? Date.parse(r.reportTime) || null : null);
    const prev = out.get(r.icaoId);
    if (!prev || (observed ?? 0) > (prev.observed ?? 0)) out.set(r.icaoId, { raw: r.rawOb.trim(), observed });
  }
  return out;
}

/** Most recent TAF per station from the provider's JSON rows. */
export function pickTafs(rows: TafRow[]): Map<string, string> {
  const best = new Map<string, { raw: string; t: number }>();
  for (const r of rows) {
    if (!r || typeof r.icaoId !== 'string' || typeof r.rawTAF !== 'string' || !r.rawTAF.trim()) continue;
    const t = (r.issueTime ? Date.parse(r.issueTime) : 0) || 0;
    const prev = best.get(r.icaoId);
    if (!prev || t > prev.t) best.set(r.icaoId, { raw: r.rawTAF.trim(), t });
  }
  return new Map([...best].map(([k, v]) => [k, v.raw]));
}

export function createWeatherProxy(opts: WeatherProxyOptions = {}) {
  const now = opts.now || Date.now;
  const metarCache = new Map<string, Entry<MetarValue>>();
  const tafCache = new Map<string, Entry<string>>();

  async function attempt(kind: 'metar' | 'taf', ids: string[]): Promise<unknown[]> {
    const doFetch = opts.fetch || fetch;
    const url = `${UPSTREAM}/${kind}?ids=${ids.join(',')}&format=json`;
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'vfr-planner-weather-proxy' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError(`${kind}: ${String((e as Error)?.message || e)}`, true); // timeout or network error
    }
    if (res.status === 204) return [];
    if (!res.ok) throw new UpstreamError(`${kind} HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    let body: unknown;
    try { body = await res.json(); } catch (e) { throw new UpstreamError(`${kind}: ${String((e as Error)?.message || e)}`, true); }
    if (!Array.isArray(body)) throw new UpstreamError(`${kind}: unexpected response`, false);
    return body;
  }

  async function upstream(kind: 'metar' | 'taf', ids: string[]): Promise<unknown[]> {
    const retries = opts.retries ?? RETRIES;
    for (let i = 0; ; i++) {
      try {
        return await attempt(kind, ids);
      } catch (e) {
        if (!(e instanceof UpstreamError) || !e.retryable || i >= retries) throw e;
        console.warn(`weather proxy: ${e.message}; retrying`);
      }
    }
  }

  /** Refreshes one cache for the ids that are missing or expired; false if the upstream failed. */
  async function refresh<T>(cache: Map<string, Entry<T>>, ttl: number, ids: string[], load: (ids: string[]) => Promise<Map<string, T>>): Promise<boolean> {
    const t = now();
    const need = ids.filter((id) => { const e = cache.get(id); return !e || t - e.at >= ttl; });
    if (!need.length) return true;
    try {
      const got = await load(need);
      for (const id of need) cache.set(id, { at: t, value: got.get(id) ?? null });
      return true;
    } catch (e) {
      console.warn('weather proxy:', String((e as Error)?.message || e));
      return false;
    }
  }

  async function get(ids: string[]): Promise<MetarTafResponse> {
    const [okM, okT] = await Promise.all([
      refresh(metarCache, METAR_TTL_MS, ids, async (x) => pickMetars((await upstream('metar', x)) as MetarRow[])),
      refresh(tafCache, TAF_TTL_MS, ids, async (x) => pickTafs((await upstream('taf', x)) as TafRow[])),
    ]);
    const t = now();
    const usable = <T>(e: Entry<T> | undefined) => (e && t - e.at <= STALE_MAX_MS ? e : undefined);
    const stations: MetarTafResponse['stations'] = {};
    let any = false;
    for (const id of ids) {
      const m = usable(metarCache.get(id)), f = usable(tafCache.get(id));
      if (m || f) any = true;
      if (!m?.value && !f?.value) continue;
      stations[id] = { metar: m?.value?.raw ?? null, taf: f?.value ?? null, observed: m?.value?.observed ?? null };
    }
    if (!okM && !okT && !any) throw new HttpError(502, 'weather service unavailable');
    return { stations, fetched: t };
  }

  const routes: Route[] = [
    {
      method: 'GET', path: '/weather/metar',
      async handler(ctx) {
        const ids = parseIds(ctx.query.get('ids'));
        if (!ids.length) throw new HttpError(400, 'ids: one or more ICAO codes');
        if (ids.length > MAX_IDS) throw new HttpError(400, `at most ${MAX_IDS} aerodromes`);
        if (ctx.db) await rateLimit(ctx.db, 'metar', { pilotId: ctx.pilot?.id, req: ctx.req });
        const body = await get(ids);
        return reply(200, body, { 'Cache-Control': 'private, max-age=60' });
      },
    },
  ];
  return { routes, get, clear: () => { metarCache.clear(); tafCache.clear(); } };
}

// one proxy (and cache) per API configuration that brings its own upstream (tests), else the shared one
const shared = createWeatherProxy();
const proxies = new WeakMap<WeatherProxyOptions, ReturnType<typeof createWeatherProxy>>();
const proxyFor = (o: WeatherProxyOptions | undefined) => {
  if (!o) return shared;
  let p = proxies.get(o);
  if (!p) proxies.set(o, (p = createWeatherProxy(o)));
  return p;
};
export const routes: Route[] = shared.routes.map((r) => ({ ...r, handler: (ctx) => proxyFor(ctx.config?.aviationWeather).routes.find((x) => x.path === r.path)!.handler(ctx) }));
