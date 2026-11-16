// FROZEN COPY of the browser-side Open-Meteo fetching as it was on main at 8030c1a (src/data/weather.ts
// and src/data/hazardWeather.ts before the server proxy): each browser called Open-Meteo directly,
// winds at the exact leg midpoints, hazards at 0.25° cells. Used only by weatherEquivalence.test.ts
// to prove the new path (GET /api/weather/grid) gives identical winds, temperatures and hazards.
// Do not change it.
import type { IsoDate, LatLon, WindModel } from '../../../../src/shared';
import { WIND_MODELS } from '../../../../src/shared';
import { isoDay } from '../../../../src/shared/date';
import type { HazardSample } from '../../../../src/calc';
import { gridCell, hazardSeries, legCorridor, type GridCell, type HazardWeather, type HazardWeatherRequest } from '../../../../src/data/hazardWeather';
import { LEVELS, SURFACE, type Hourly, type OpenMeteoEndpoint, type OpenMeteoLocation, type RouteWeather } from '../../../../src/data/weather';

const DEFAULT_MODEL: WindModel = 'ecmwf_ifs025';
const MODEL_LABELS = WIND_MODELS;
const HAZARD_SURFACE = ['weather_code', 'cape', 'visibility', 'cloud_cover_low', 'temperature_2m', 'dew_point_2m'] as const;
type RouteWeatherRequest = { date: IsoDate; model: WindModel | null | undefined; legMidpoints: LatLon[]; departure: LatLon | null; destination: LatLon | null; stops?: LatLon[]; force?: boolean; fetch?: typeof fetch; now?: () => number };
type BeforeHazardWeatherRequest = Omit<HazardWeatherRequest, 'get'> & { fetch?: typeof fetch };
const times = (h: Hourly) => h.time.map((t) => Date.parse(t.endsWith('Z') ? t : t + 'Z'));

const HOSTS: Record<OpenMeteoEndpoint, string> = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  historical: 'https://historical-forecast-api.open-meteo.com/v1/forecast',
};

export function buildUrl(points: { lat: number; lon: number }[], dateFrom: string, dateTo: string, model: WindModel, endpoint: OpenMeteoEndpoint = 'forecast'): string {
  const vars: string[] = [];
  for (const l of LEVELS) vars.push(`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `temperature_${l}hPa`, `geopotential_height_${l}hPa`);
  vars.push(...SURFACE);
  const p = new URLSearchParams({
    latitude: points.map((x) => x.lat.toFixed(4)).join(','),
    longitude: points.map((x) => x.lon.toFixed(4)).join(','),
    hourly: vars.join(','),
    wind_speed_unit: 'kn',
    timezone: 'GMT',
    start_date: dateFrom,
    end_date: dateTo,
    models: model || DEFAULT_MODEL,
  });
  return `${HOSTS[endpoint]}?${p}`;
}

// ---- fetching -----------------------------------------------------------------------------------

/** Responses are reused for this long (models update every 6 h; the pilot can force a refresh). */
export const FORECAST_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; p: Promise<OpenMeteoLocation[]> }>();

/**
 * Fetches hourly data for the points (one response entry per point, same order). Concurrent and
 * repeated calls for the same URL share one request for FORECAST_TTL_MS. Rejects on HTTP errors with
 * Open-Meteo's reason (e.g. "Parameter 'start_date' is out of allowed range …").
 */
export async function fetchPoints(
  points: { lat: number; lon: number }[], dateFrom: string, dateTo: string, model: WindModel,
  opts: { endpoint?: OpenMeteoEndpoint; fetch?: typeof fetch; now?: () => number } = {},
): Promise<OpenMeteoLocation[]> {
  const url = buildUrl(points, dateFrom, dateTo, model, opts.endpoint);
  const now = (opts.now || Date.now)();
  const hit = cache.get(url);
  if (hit && now - hit.at < FORECAST_TTL_MS) return hit.p;
  const doFetch = opts.fetch || fetch;
  const p = (async () => {
    const res = await doFetch(url);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) throw new Error((body && body.reason) || `Open-Meteo HTTP ${res.status}`);
    return (Array.isArray(body) ? body : [body]) as OpenMeteoLocation[];
  })();
  cache.set(url, { at: now, p });
  p.catch(() => { if (cache.get(url)?.p === p) cache.delete(url); });
  return p;
}
export const clearBefore = () => { cache.clear(); runCache.clear(); cellCache.clear(); };

// ---- availability and model runs ------------------------------------------------------------------

/** Forecast length of each model on Open-Meteo, days after today (ICON global/EU ~7.5 days). */
export const MODEL_HORIZON_DAYS: Record<WindModel, number> = { ecmwf_ifs025: 15, gfs_seamless: 16, icon_seamless: 7, best_match: 16 };
/** The forecast endpoint serves this many past days; older dates go to the historical-forecast API. */
export const FORECAST_PAST_DAYS = 92;

const DAY = 86400000;
const dayMs = (d: IsoDate) => Date.parse(d + 'T00:00:00Z');

export type ForecastAvailability =
  | { kind: 'forecast' | 'historical'; endpoint: OpenMeteoEndpoint; lastDate: IsoDate }
  | { kind: 'too-far'; availableFrom: IsoDate; lastDate: IsoDate }
  | { kind: 'invalid' };

/** Whether winds can be had for a flight date with this model, and from which endpoint. */
export function forecastAvailability(date: IsoDate, model: WindModel, nowMs: number = Date.now()): ForecastAvailability {
  const d = dayMs(date);
  if (!isFinite(d)) return { kind: 'invalid' };
  const today = dayMs(isoDay(nowMs));
  const horizon = MODEL_HORIZON_DAYS[model] ?? 15;
  const last = today + horizon * DAY;
  if (d > last) return { kind: 'too-far', availableFrom: isoDay(d - horizon * DAY), lastDate: isoDay(last) };
  if (d < today - FORECAST_PAST_DAYS * DAY) return { kind: 'historical', endpoint: 'historical', lastDate: isoDay(last) };
  return { kind: 'forecast', endpoint: 'forecast', lastDate: isoDay(last) };
}

/** Open-Meteo metadata ids of the model actually used over Greece (seamless → the regional run). */
const META_IDS: Partial<Record<WindModel, string>> = { ecmwf_ifs025: 'ecmwf_ifs025', gfs_seamless: 'ncep_gfs025', icon_seamless: 'dwd_icon_eu' };
export interface ModelRun {
  /** Initialisation (analysis) time of the latest run, epoch ms. */
  runMs: number;
  /** When that run became available on Open-Meteo, epoch ms. */
  availableMs: number | null;
}
const runCache = new Map<string, { at: number; p: Promise<ModelRun | null> }>();

/** Latest model run (best effort: null for best_match or on any failure). */
export function fetchModelRun(model: WindModel, opts: { fetch?: typeof fetch; now?: () => number } = {}): Promise<ModelRun | null> {
  const id = META_IDS[model];
  if (!id) return Promise.resolve(null);
  const now = (opts.now || Date.now)();
  const hit = runCache.get(id);
  if (hit && now - hit.at < FORECAST_TTL_MS) return hit.p;
  const doFetch = opts.fetch || fetch;
  const p = (async (): Promise<ModelRun | null> => {
    try {
      const res = await doFetch(`https://api.open-meteo.com/data/${id}/static/meta.json`);
      if (!res.ok) return null;
      const m = await res.json();
      const init = Number(m?.last_run_initialisation_time), avail = Number(m?.last_run_availability_time);
      return isFinite(init) && init > 0 ? { runMs: init * 1000, availableMs: isFinite(avail) && avail > 0 ? avail * 1000 : null } : null;
    } catch {
      return null;
    }
  })();
  runCache.set(id, { at: now, p });
  return p;
}

// ---- route weather --------------------------------------------------------------------------------

export interface ForecastSource {
  provider: 'Open-Meteo';
  model: WindModel;
  modelLabel: string;
  endpoint: OpenMeteoEndpoint;
  /** Latest model run (forecast endpoint only), or null when unknown. */
  run: ModelRun | null;
  /** When we fetched, epoch ms. */
  fetchedMs: number;
  /** Hours covered by the data, epoch ms. */
  coverFromMs: number | null;
  coverToMs: number | null;
}

const hhmmZ = (ms: number) => new Date(ms).toISOString().slice(11, 16) + 'Z';
const runLabel = (ms: number) => { const d = new Date(ms); return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}Z`; };

/** One-line description of a forecast source for the UI and printouts. */
export function describeSource(s: ForecastSource): string {
  const parts = [s.modelLabel];
  if (s.endpoint === 'historical') parts.push('archived forecast');
  if (s.run) parts.push(`run ${runLabel(s.run.runMs)}`);
  parts.push(`fetched ${hhmmZ(s.fetchedMs)}`);
  return parts.join(', ');
}

const empty = (status: RouteWeather['status'], message: string, n: number): RouteWeather =>
  ({ status, message, legs: Array(n).fill(null), departure: null, destination: null, stops: [], source: null });

/**
 * Winds aloft at every leg midpoint plus surface conditions at departure and destination, for the
 * flight date and the next day (flights past midnight), in one Open-Meteo request. Never rejects.
 */
export async function fetchRouteWeather(req: RouteWeatherRequest): Promise<RouteWeather> {
  const n = req.legMidpoints.length;
  const model = req.model || DEFAULT_MODEL;
  const now = req.now || Date.now;
  if (!n && !req.departure && !req.destination) return empty('idle', '', 0);
  const av = forecastAvailability(req.date, model, now());
  if (av.kind === 'invalid') return empty('idle', 'No flight date', n);
  if (av.kind === 'too-far') return empty('unavailable', `${MODEL_LABELS[model]} forecast reaches ${av.lastDate}; winds for ${req.date} from ${av.availableFrom}`, n);
  const points: LatLon[] = [...req.legMidpoints];
  const depIdx = req.departure ? points.push(req.departure) - 1 : -1;
  const destIdx = req.destination ? points.push(req.destination) - 1 : -1;
  const stopIdx = (req.stops ?? []).map((p) => points.push(p) - 1);
  const next = isoDay(dayMs(req.date) + DAY);
  const d1 = next <= av.lastDate ? next : req.date;
  if (req.force) for (const k of [...cache.keys()]) if (k.includes(`start_date=${req.date}`)) cache.delete(k);
  const opts = { endpoint: av.endpoint, fetch: req.fetch, now };
  try {
    const runP = av.endpoint === 'forecast' ? fetchModelRun(model, { fetch: req.fetch, now }) : Promise.resolve(null);
    // fall back to the flight date alone at the edge of the range
    const raw = await fetchPoints(points, req.date, d1, model, opts).catch((e) => (d1 !== req.date ? fetchPoints(points, req.date, req.date, model, opts) : Promise.reject(e)));
    const run = await runP;
    const at = (i: number) => (i >= 0 && raw[i] && raw[i].hourly ? raw[i] : null);
    const ts = raw[0]?.hourly?.time ? times(raw[0].hourly) : [];
    const source: ForecastSource = {
      provider: 'Open-Meteo', model, modelLabel: MODEL_LABELS[model] || model, endpoint: av.endpoint, run,
      fetchedMs: now(), coverFromMs: ts.length ? ts[0] : null, coverToMs: ts.length ? ts[ts.length - 1] : null,
    };
    return {
      status: 'ok', message: describeSource(source),
      legs: req.legMidpoints.map((_, i) => at(i)), departure: at(depIdx), destination: at(destIdx), stops: stopIdx.map(at), source,
    };
  } catch (e) {
    return empty('error', `Winds unavailable: ${String((e as Error)?.message || e)}`, n);
  }
}

const CELLS_PER_REQUEST = 80;
const HZ_HOSTS: Record<OpenMeteoEndpoint, string> = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  historical: 'https://historical-forecast-api.open-meteo.com/v1/forecast',
};
const TTL_MS = 30 * 60 * 1000;
export function buildHazardUrl(cells: { lat: number; lon: number }[], dateFrom: string, dateTo: string, model: WindModel, endpoint: OpenMeteoEndpoint = 'forecast'): string {
  const vars: string[] = [...HAZARD_SURFACE];
  for (const l of LEVELS) vars.push(`cloud_cover_${l}hPa`, `geopotential_height_${l}hPa`);
  const p = new URLSearchParams({
    latitude: cells.map((x) => x.lat.toFixed(2)).join(','),
    longitude: cells.map((x) => x.lon.toFixed(2)).join(','),
    hourly: vars.join(','),
    timezone: 'GMT',
    start_date: dateFrom,
    end_date: dateTo,
    models: model || DEFAULT_MODEL,
  });
  return `${HZ_HOSTS[endpoint]}?${p}`;
}

const cellCache = new Map<string, { at: number; p: Promise<HazardSample[] | null> }>();
export const clearHazardCache = () => cellCache.clear();

async function fetchCells(cells: GridCell[], date: IsoDate, d1: IsoDate, model: WindModel, endpoint: OpenMeteoEndpoint, doFetch: typeof fetch, now: number, force: boolean): Promise<Map<string, HazardSample[] | null>> {
  const ck = (c: GridCell) => `${model}|${endpoint}|${date}|${d1}|${c.key}`;
  const missing = cells.filter((c) => { const hit = cellCache.get(ck(c)); return force || !hit || now - hit.at >= TTL_MS; });
  for (let i = 0; i < missing.length; i += CELLS_PER_REQUEST) {
    const chunk = missing.slice(i, i + CELLS_PER_REQUEST);
    const all = (async () => {
      const res = await doFetch(buildHazardUrl(chunk, date, d1, model, endpoint));
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) throw new Error((body && body.reason) || `Open-Meteo HTTP ${res.status}`);
      return (Array.isArray(body) ? body : [body]) as OpenMeteoLocation[];
    })();
    chunk.forEach((c, k) => {
      const p = all.then((locs) => hazardSeries(locs[k] ?? null), () => null);
      cellCache.set(ck(c), { at: now, p });
      // a failed request is not cached
      p.then((v) => { if (v === null && cellCache.get(ck(c))?.p === p) cellCache.delete(ck(c)); });
    });
  }
  const out = new Map<string, HazardSample[] | null>();
  await Promise.all(cells.map(async (c) => { out.set(c.key, (await cellCache.get(ck(c))?.p) ?? null); }));
  return out;
}

/** Corridor data for the hazards of a whole flight. Never rejects. */
export async function fetchHazardWeather(req: BeforeHazardWeatherRequest): Promise<HazardWeather> {
  const model = req.model || DEFAULT_MODEL;
  const now = req.now || Date.now;
  const empty = (status: HazardWeather['status'], message: string): HazardWeather =>
    ({ status, message, legs: req.legs.map(() => ({ corridor: [], spacingFrac: 1 })), departure: [], destination: [], sourceLabel: '', source: null });
  if (!req.legs.length && !req.departure && !req.destination) return empty('idle', '');
  const av = forecastAvailability(req.date, model, now());
  if (av.kind === 'invalid') return empty('idle', 'No flight date');
  if (av.kind === 'too-far') return empty('unavailable', `${MODEL_LABELS[model]} forecast reaches ${av.lastDate}: no weather hazards for ${req.date} yet`);
  const next = isoDay(Date.parse(req.date + 'T00:00:00Z') + DAY);
  const d1 = next <= av.lastDate ? next : req.date;
  const corridors = req.legs.map((l) => legCorridor(l.from, l.to, l.distNm));
  const cells = new Map<string, GridCell>();
  for (const c of corridors) for (const p of c.points) for (const g of p.cells) cells.set(g.key, g);
  const depCell = req.departure ? gridCell(req.departure) : null;
  const destCell = req.destination ? gridCell(req.destination) : null;
  for (const g of [depCell, destCell]) if (g) cells.set(g.key, g);
  try {
    const runP = av.endpoint === 'forecast' ? fetchModelRun(model, { fetch: req.fetch, now }) : Promise.resolve(null);
    const data = await fetchCells([...cells.values()], req.date, d1, model, av.endpoint, req.fetch || fetch, now(), !!req.force);
    const run = await runP;
    if ([...data.values()].every((v) => v === null)) return empty('error', 'Weather hazards unavailable (Open-Meteo did not answer).');
    const source: ForecastSource = { provider: 'Open-Meteo', model, modelLabel: MODEL_LABELS[model] || model, endpoint: av.endpoint, run, fetchedMs: now(), coverFromMs: null, coverToMs: null };
    const runText = run ? `run ${describeSource(source).split('run ')[1]?.split(',')[0] ?? ''}` : '';
    const sourceLabel = [source.modelLabel, runText].filter(Boolean).join(', ');
    return {
      status: 'ok', message: describeSource(source), sourceLabel, source,
      legs: corridors.map((c) => ({
        spacingFrac: c.spacingFrac,
        corridor: c.points.flatMap((p) => p.cells.map((g) => ({ frac: p.frac, samples: data.get(g.key) ?? [] }))),
      })),
      departure: depCell ? data.get(depCell.key) ?? [] : [],
      destination: destCell ? data.get(destCell.key) ?? [] : [],
    };
  } catch (e) {
    return empty('error', `Weather hazards unavailable: ${String((e as Error)?.message || e)}`);
  }
}

