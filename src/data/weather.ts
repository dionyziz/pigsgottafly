// Winds/temperature aloft and surface conditions from Open-Meteo, through our server (GET
// /api/weather/grid, src/data/weatherGrid.ts), ported from the v2 js/weather.js: values interpolated
// in height (geopotential) and time.
//
//   - sampleAt: wind (u/v interpolated) and temperature at altitude ft MSL and time.
//   - sampleSurface / surfaceConditions: 2 m temperature, dewpoint, MSL pressure (≈ QNH), 10 m wind.
//   - fetchRouteWeather: everything a flight needs (winds aloft at the model grid node nearest each
//     leg midpoint, surface conditions at the departure, stops and destination), with the source
//     recorded (provider, model, model run, fetch time, coverage).
//   - chooseSurface: METAR (src/data/weatherMetar.ts) when it is recent and close to the time of
//     interest, otherwise the forecast.
//
// Directions are TRUE everywhere (Open-Meteo and METAR both report true north).
import type { IsoDate, LatLon, WindModel } from '../shared';
import { WIND_MODELS } from '../shared';
import { isoDay } from '../shared/date';
import {
  DEFAULT_MODEL, GRID_STEP_DEG, LEVELS, forecastAvailability, nodeKey, pointKey, snapToGrid,
  type Hourly, type ModelRun, type OpenMeteoEndpoint, type OpenMeteoLocation,
} from '../shared/weatherGrid';
import type { WindProvider, WindSample } from '../calc';
import { qnhFromStationPressure } from '../calc/performance';
import type { MetarWind, ParsedMetar } from './weatherMetar';
import { clearGridCache, fetchGrid, type GridGet } from './weatherGrid';

export {
  DEFAULT_MODEL, FORECAST_PAST_DAYS, LEVELS, MODEL_HORIZON_DAYS, SURFACE, forecastAvailability,
  type ForecastAvailability, type Hourly, type ModelRun, type OpenMeteoEndpoint, type OpenMeteoLocation,
} from '../shared/weatherGrid';
export const MODEL_LABELS = WIND_MODELS;

interface Level { z: number; u: number; v: number; temp: number }
const val = (h: Hourly, k: string, i: number) => (h[k] as (number | null)[] | undefined)?.[i];
const times = (h: Hourly) => h.time.map((t) => Date.parse(t.endsWith('Z') ? t : t + 'Z'));
/** How far outside the data's hours a time may be and still be answered (the edge value is used). */
const EDGE_MS = 60 * 60 * 1000;

/** Bracketing hour indices and the fraction between them, or null when the time is not covered. */
function bracket(h: Hourly, timeMs: number): { i: number; j: number; f: number } | null {
  if (!h || !Array.isArray(h.time) || !h.time.length || !isFinite(timeMs)) return null;
  const ts = times(h);
  const n = ts.length;
  if (timeMs < ts[0] - EDGE_MS || timeMs > ts[n - 1] + EDGE_MS) return null;
  if (n === 1) return { i: 0, j: 0, f: 0 };
  let i = ts.findIndex((t) => t > timeMs) - 1;
  if (i < 0) i = timeMs < ts[0] ? 0 : n - 2;
  i = Math.max(0, Math.min(n - 2, i));
  const f = Math.max(0, Math.min(1, (timeMs - ts[i]) / (ts[i + 1] - ts[i])));
  return { i, j: i + 1, f };
}

function atHeight(h: Hourly, idx: number, altFt: number): { u: number; v: number; temp: number } | null {
  const altM = altFt * 0.3048;
  const lv: Level[] = [];
  for (const l of LEVELS) {
    const z = val(h, `geopotential_height_${l}hPa`, idx), ws = val(h, `wind_speed_${l}hPa`, idx);
    const wd = val(h, `wind_direction_${l}hPa`, idx), t = val(h, `temperature_${l}hPa`, idx);
    if ([z, ws, wd, t].every((x) => x !== null && x !== undefined && isFinite(x as number))) {
      const r = ((wd as number) * Math.PI) / 180;
      lv.push({ z: z as number, u: -(ws as number) * Math.sin(r), v: -(ws as number) * Math.cos(r), temp: t as number });
    }
  }
  if (!lv.length) return null;
  lv.sort((a, b) => a.z - b.z);
  if (altM <= lv[0].z) return lv[0];
  if (altM >= lv[lv.length - 1].z) return lv[lv.length - 1];
  for (let k = 0; k < lv.length - 1; k++) {
    const a = lv[k], b = lv[k + 1];
    if (altM >= a.z && altM <= b.z) {
      const f = (altM - a.z) / (b.z - a.z);
      return { u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f, temp: a.temp + (b.temp - a.temp) * f };
    }
  }
  return null;
}

function toDirSpd(u: number, v: number) {
  return { dir: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360, spd: Math.hypot(u, v) };
}

/**
 * Wind (FROM, true) and temperature at altitude ft MSL and time (ms UTC), or null when there is no
 * data (no usable level, or the time is more than an hour outside the data's hours).
 */
export function sampleAt(h: Hourly, altFt: number, timeMs: number): WindSample | null {
  if (!isFinite(altFt)) return null;
  const br = bracket(h, timeMs);
  if (!br) return null;
  const a = atHeight(h, br.i, altFt), b = atHeight(h, br.j, altFt);
  if (!a || !b) {
    const x = a || b;
    if (!x) return null;
    const w = toDirSpd(x.u, x.v);
    return { dirDeg: w.dir, speedKt: w.spd, tempC: x.temp };
  }
  const mix = (x: number, y: number) => x + (y - x) * br.f;
  const w = toDirSpd(mix(a.u, b.u), mix(a.v, b.v));
  return { dirDeg: w.dir, speedKt: w.spd, tempC: mix(a.temp, b.temp) };
}

export interface SurfaceSample {
  /**
   * QNH, hPa. With the grid point's elevation and surface_pressure: the surface pressure reduced to
   * sea level through the ISA (the definition of QNH; qnhFromStationPressure). Otherwise the
   * model's mean-sea-level pressure, which is reduced through the model's ACTUAL temperature
   * profile and differs from QNH at elevated points on days away from ISA (LGKZ, 660 m, −10 °C:
   * MSLP ≈ QNH + 6 hPa, i.e. pressure altitude ≈ 170 ft too low, the non-conservative way).
   */
  qnh: number;
  /** Model mean-sea-level pressure, hPa (NaN if not returned). */
  mslp: number;
  /** Model surface pressure at the grid point, hPa (NaN if not returned). */
  psfc: number;
  temp: number;
  dew: number;
  wind: { dir: number; spd: number } | null;
  /** Cloud cover by layer, %. */
  low: number;
  mid: number;
  high: number;
}

/**
 * Surface conditions at a time, or null.
 * @param elevationM the grid point's elevation (OpenMeteoLocation.elevation): with it and
 *   surface_pressure, qnh is the ISA-reduced station pressure; without, the model's MSL pressure.
 */
export function sampleSurface(h: Hourly, timeMs: number, elevationM?: number | null): SurfaceSample | null {
  const br = bracket(h, timeMs);
  if (!br) return null;
  const { i, j, f } = br;
  const at = (k: string) => {
    const a = val(h, k, i), b = val(h, k, j);
    if (a == null && b == null) return NaN;
    if (a == null) return b as number;
    if (b == null) return a as number;
    return (a as number) + ((b as number) - (a as number)) * f;
  };
  const uv = (x: number) => {
    const ws = val(h, 'wind_speed_10m', x), wd = val(h, 'wind_direction_10m', x);
    if (ws == null || wd == null) return null;
    const r = ((wd as number) * Math.PI) / 180;
    return { u: -(ws as number) * Math.sin(r), v: -(ws as number) * Math.cos(r) };
  };
  const A = uv(i), B = uv(j);
  let wind = null;
  if (A || B) {
    const a = (A || B)!, b = (B || A)!;
    wind = toDirSpd(a.u + (b.u - a.u) * f, a.v + (b.v - a.v) * f);
  }
  const mslp = at('pressure_msl');
  const psfc = at('surface_pressure');
  const qnh = isFinite(psfc) && psfc > 0 && typeof elevationM === 'number' && isFinite(elevationM) ? qnhFromStationPressure(psfc, elevationM / 0.3048) : mslp;
  const out: SurfaceSample = { qnh, mslp, psfc, temp: at('temperature_2m'), dew: at('dew_point_2m'), wind, low: at('cloud_cover_low'), mid: at('cloud_cover_mid'), high: at('cloud_cover_high') };
  return isFinite(out.temp) || wind ? out : null;
}

const two = (t: number) => (Math.round(t) < 0 ? 'M' : '') + String(Math.abs(Math.round(t))).padStart(2, '0');
export const fmtQnh = (s: SurfaceSample | null) => (s && isFinite(s.qnh) ? String(Math.round(s.qnh)) : '');
export const fmtTempDew = (s: SurfaceSample | null) => (s && isFinite(s.temp) ? `${two(s.temp)}/${isFinite(s.dew) ? two(s.dew) : '//'}` : '');
/** METAR wind group, e.g. 23004KT; calm 00000KT. */
export function fmtWind(s: SurfaceSample | null): string {
  if (!s || !s.wind) return '';
  const spd = Math.round(s.wind.spd);
  if (spd < 1) return '00000KT';
  const dir = (Math.round(s.wind.dir / 10) * 10) % 360 || 360;
  return `${String(dir).padStart(3, '0')}${String(spd).padStart(2, '0')}KT`;
}
/** Lowest layer ≥ 1 okta below 5000 ft (base from the spread, ~400 ft/°C), else NSC/SKC. */
export function fmtSky(s: SurfaceSample | null): string {
  if (!s || !isFinite(s.low)) return '';
  const okta = (pct: number) => Math.round((pct || 0) / 12.5);
  const code = (o: number) => (o <= 2 ? 'FEW' : o <= 4 ? 'SCT' : o <= 7 ? 'BKN' : 'OVC');
  if (okta(s.low) >= 1 && isFinite(s.temp) && isFinite(s.dew)) {
    const base = Math.max(100, Math.min(6500, Math.round(((s.temp - s.dew) * 400) / 100) * 100));
    if (base < 5000) return `${code(okta(s.low))}${String(base / 100).padStart(3, '0')}`;
  }
  return (s.low || 0) + (s.mid || 0) + (s.high || 0) > 0 ? 'NSC' : 'SKC';
}

// ---- fetching -----------------------------------------------------------------------------------

export const clearCache = () => clearGridCache();

/** A WindProvider over per-leg midpoint data: perLeg[i] is the response for leg i's midpoint. */
export function windProviderFromLegs(perLeg: (OpenMeteoLocation | null)[]): WindProvider {
  return ({ legIndex, altFt, timeMs }) => {
    const loc = perLeg[legIndex];
    return loc && loc.hourly && isFinite(altFt) && isFinite(timeMs) ? sampleAt(loc.hourly, altFt, timeMs) : null;
  };
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
  /** Local runs: generated data (server/syntheticOpenMeteo.ts). */
  synthetic?: boolean;
}

export interface RouteWeatherRequest {
  date: IsoDate;
  model: WindModel | null | undefined;
  /** One point per leg (its midpoint): winds from the model grid node nearest to it. */
  legMidpoints: LatLon[];
  departure: LatLon | null;
  destination: LatLon | null;
  /** Intermediate full-stop aerodromes (surface conditions for their landing and take-off). */
  stops?: LatLon[];
  /** Ask the server again (the pilot's "refresh winds"). */
  force?: boolean;
  get?: GridGet;
  now?: () => number;
}

export interface RouteWeather {
  /** ok: data fetched (individual legs may still lack values, e.g. beyond a model's range). */
  status: 'ok' | 'unavailable' | 'error' | 'idle';
  /** For display, e.g. 'ECMWF IFS 0.25°, run 15 Nov 06Z, fetched 13:36Z' or the reason. */
  message: string;
  legs: (OpenMeteoLocation | null)[];
  departure: OpenMeteoLocation | null;
  destination: OpenMeteoLocation | null;
  /** One per RouteWeatherRequest.stops, in order (missing on older results = none). */
  stops?: (OpenMeteoLocation | null)[];
  source: ForecastSource | null;
}

const hhmmZ = (ms: number) => new Date(ms).toISOString().slice(11, 16) + 'Z';
const runLabel = (ms: number) => { const d = new Date(ms); return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}Z`; };

/** One-line description of a forecast source for the UI and printouts. */
export function describeSource(s: ForecastSource): string {
  const parts = [s.modelLabel];
  if (s.endpoint === 'historical') parts.push('archived forecast');
  if (s.run) parts.push(`run ${runLabel(s.run.runMs)}`);
  parts.push(`fetched ${hhmmZ(s.fetchedMs)}`);
  if (s.synthetic) parts.push('synthetic data');
  return parts.join(', ');
}

const empty = (status: RouteWeather['status'], message: string, n: number): RouteWeather =>
  ({ status, message, legs: Array(n).fill(null), departure: null, destination: null, stops: [], source: null });

const DAY = 86400000;
const dayMs = (d: IsoDate) => Date.parse(d + 'T00:00:00Z');

/** The model grid node whose data stands for a point's winds aloft (Open-Meteo answers a point with its nearest node). */
export const windNode = (p: LatLon, model: WindModel): LatLon => snapToGrid(p, GRID_STEP_DEG[model] ?? 0.0625);

/**
 * Winds aloft at every leg (the model grid node nearest its midpoint) plus surface conditions at the
 * departure, stops and destination, for the flight date and the next day (flights past midnight).
 * Never rejects.
 */
export async function fetchRouteWeather(req: RouteWeatherRequest): Promise<RouteWeather> {
  const n = req.legMidpoints.length;
  const model = req.model || DEFAULT_MODEL;
  const now = req.now || Date.now;
  if (!n && !req.departure && !req.destination) return empty('idle', '', 0);
  const av = forecastAvailability(req.date, model, now());
  if (av.kind === 'invalid') return empty('idle', 'No flight date', n);
  if (av.kind === 'too-far') return empty('unavailable', `${MODEL_LABELS[model]} forecast reaches ${av.lastDate}; winds for ${req.date} from ${av.availableFrom}`, n);
  const legKeys = req.legMidpoints.map((m) => nodeKey(windNode(m, model)));
  const depKey = req.departure ? pointKey(req.departure) : null;
  const destKey = req.destination ? pointKey(req.destination) : null;
  const stopKeys = (req.stops ?? []).map((p) => pointKey(p));
  const order = [...legKeys, depKey, destKey, ...stopKeys].filter((k): k is string => !!k);
  const next = isoDay(dayMs(req.date) + DAY);
  const d1 = next <= av.lastDate ? next : req.date;
  try {
    const r = await fetchGrid({ kind: 'wind', model, from: req.date, to: d1, locs: order, force: req.force, get: req.get, now });
    const at = (k: string | null) => (k ? r.locations.get(k) ?? null : null);
    if (order.every((k) => !at(k))) return empty('error', `Winds unavailable: ${r.message || 'no data'}`, n);
    const legs = legKeys.map(at);
    const firstLoc = at(order[0]);
    const ts = firstLoc?.hourly?.time ? times(firstLoc.hourly) : [];
    const endpoint = r.endpoint ?? av.endpoint;
    const source: ForecastSource = {
      provider: 'Open-Meteo', model, modelLabel: MODEL_LABELS[model] || model, endpoint, run: endpoint === 'forecast' ? r.run : null,
      fetchedMs: now(), coverFromMs: ts.length ? ts[0] : null, coverToMs: ts.length ? ts[ts.length - 1] : null,
      ...(r.synthetic ? { synthetic: true } : {}),
    };
    const gaps = legs.some((l) => !l) && r.message ? ` (some legs without winds: ${r.message})` : '';
    return {
      status: 'ok', message: describeSource(source) + gaps,
      legs, departure: at(depKey), destination: at(destKey), stops: stopKeys.map(at), source,
    };
  } catch (e) {
    return empty('error', `Winds unavailable: ${String((e as Error)?.message || e)}`, n);
  }
}

// ---- surface conditions -----------------------------------------------------------------------------

export interface SurfaceConditions {
  source: 'metar' | 'forecast';
  /** For display: 'METAR LGAV 151320Z' or 'ECMWF IFS 0.25° forecast for 14:00Z'. */
  label: string;
  /** Observation time (METAR) or the time the forecast was sampled for, epoch ms. */
  timeMs: number;
  tempC: number | null;
  dewC: number | null;
  /** QNH: METAR, or the forecast surface pressure reduced to sea level through the ISA (SurfaceSample.qnh). */
  qnhHpa: number | null;
  /** Direction FROM, TRUE; dirTrueDeg null = variable. Null wind = not known. */
  wind: { dirTrueDeg: number | null; speedKt: number; gustKt: number | null } | null;
  /** The raw METAR, when from one. */
  raw?: string;
}

const fin = (x: number) => (isFinite(x) ? x : null);

/** Forecast surface conditions at a time from an Open-Meteo location. */
export function surfaceConditions(loc: OpenMeteoLocation | null, timeMs: number): SurfaceConditions | null {
  const s = loc && loc.hourly ? sampleSurface(loc.hourly, timeMs, loc.elevation) : null;
  if (!s) return null;
  return {
    source: 'forecast', label: `Forecast for ${hhmmZ(timeMs)}`, timeMs,
    tempC: fin(s.temp), dewC: fin(s.dew), qnhHpa: fin(s.qnh),
    wind: s.wind ? { dirTrueDeg: s.wind.spd < 0.5 ? null : s.wind.dir, speedKt: s.wind.spd, gustKt: null } : null,
  };
}

/** Surface conditions from a decoded METAR (null for NIL or a report without time). */
export function surfaceFromMetar(m: ParsedMetar | null): SurfaceConditions | null {
  if (!m || m.nil || m.timeMs === null) return null;
  const w: MetarWind | null = m.wind;
  return {
    source: 'metar', label: `${m.type} ${m.station} ${new Date(m.timeMs).toISOString().slice(8, 10)}${hhmmZ(m.timeMs).replace(':', '')}`,
    timeMs: m.timeMs, tempC: m.tempC, dewC: m.dewC, qnhHpa: m.qnhHpa,
    wind: w ? { dirTrueDeg: w.calm ? null : w.dirDeg, speedKt: w.calm ? 0 : w.speedKt, gustKt: w.gustKt } : null,
    raw: m.raw,
  };
}

/** A METAR is used for a time within this window of its observation… */
export const METAR_USE_WINDOW_MS = 90 * 60 * 1000;
/** …and only while it is this fresh. */
export const METAR_MAX_AGE_MS = 90 * 60 * 1000;

/**
 * The conditions to plan with at an aerodrome for a time: the METAR when it is current (at most
 * 90 min old) and the time of interest is within 90 min of its observation; otherwise the
 * forecast; otherwise whichever exists. Missing METAR fields are filled from the forecast.
 */
export function chooseSurface(o: { metar: ParsedMetar | null; forecast: SurfaceConditions | null; timeMs: number; nowMs?: number }): SurfaceConditions | null {
  const m = surfaceFromMetar(o.metar);
  const now = o.nowMs ?? Date.now();
  const useMetar = !!m && now - m.timeMs <= METAR_MAX_AGE_MS && Math.abs(o.timeMs - m.timeMs) <= METAR_USE_WINDOW_MS;
  if (useMetar && m) {
    const f = o.forecast;
    return f ? { ...m, tempC: m.tempC ?? f.tempC, dewC: m.dewC ?? f.dewC, qnhHpa: m.qnhHpa ?? f.qnhHpa, wind: m.wind ?? f.wind } : m;
  }
  return o.forecast;
}

/**
 * The surface wind in the shape the performance calculation takes (calc SurfaceWind | null).
 * Calm: {dirTrueDeg: null, speedKt: 0}. Variable (VRB): dirTrueDeg null with its speed (the whole
 * speed is then treated as crosswind, with no headwind credit). Gusts are passed on for the
 * crosswind-limit check. Null = no wind known (calm assumed, flagged).
 */
export function toPerfWind(s: SurfaceConditions | null): { dirTrueDeg: number | null; speedKt: number; gustKt: number | null } | null {
  const w = s?.wind;
  if (!w || !isFinite(w.speedKt)) return null;
  const gustKt = w.gustKt != null && isFinite(w.gustKt) && w.gustKt > w.speedKt ? w.gustKt : null;
  if (!(w.speedKt > 0)) return { dirTrueDeg: null, speedKt: 0, gustKt };
  return { dirTrueDeg: w.dirTrueDeg, speedKt: w.speedKt, gustKt };
}
