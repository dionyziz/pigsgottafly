// Forecast data through our server (GET /api/weather/grid → WeatherGridResponse): the variables the
// client asks for, the model grids, the forecast range of each model, and the wire format of grid
// nodes and points. Shared by the client (src/data/weatherGrid.ts) and the API
// (api/_lib/routes/weatherGrid.ts).
//
// Winds aloft and hazards are sampled at the model's own grid nodes (ECMWF IFS 0.25°: every 0.25° of
// latitude and longitude), so one node is fetched once per model run and serves every leg, edit and
// pilot near it. Surface conditions at aerodromes are fetched at the aerodrome itself (Open-Meteo
// corrects 2 m temperature and surface pressure to the aerodrome's elevation).
import type { IsoDate, WindModel } from './types.js';
import { isoDay } from './date.js';

/** Pressure levels of the winds aloft and of the cloud layers (hPa). */
export const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600] as const;
/** Surface variables of the wind set. */
export const SURFACE = [
  'pressure_msl',
  'surface_pressure',
  'temperature_2m',
  'dew_point_2m',
  'wind_speed_10m',
  'wind_direction_10m',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
] as const;
/** Surface variables of the hazard set. */
export const HAZARD_SURFACE = [
  'weather_code',
  'cape',
  'visibility',
  'cloud_cover_low',
  'temperature_2m',
  'dew_point_2m',
] as const;

export type WeatherGridKind = 'wind' | 'hazard';

/** Open-Meteo hourly variables of each set, in request order. */
export function gridVariables(kind: WeatherGridKind): string[] {
  const vars: string[] = [];
  if (kind === 'wind') {
    for (const l of LEVELS)
      vars.push(`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `temperature_${l}hPa`, `geopotential_height_${l}hPa`);
    vars.push(...SURFACE);
  } else {
    vars.push(...HAZARD_SURFACE);
    for (const l of LEVELS) vars.push(`cloud_cover_${l}hPa`, `geopotential_height_${l}hPa`);
  }
  return vars;
}

export const DEFAULT_MODEL: WindModel = 'ecmwf_ifs025';

/**
 * Grid spacing of each model over Greece, degrees: ECMWF IFS 0.25° and GFS 0.25° (regular grids
 * through 0°), ICON-EU 0.0625°. Open-Meteo's best match mixes models: the finest of them.
 */
export const GRID_STEP_DEG: Record<WindModel, number> = {
  ecmwf_ifs025: 0.25,
  gfs_seamless: 0.25,
  icon_seamless: 0.0625,
  best_match: 0.0625,
};
/** Hazard corridor samples use the 0.25° grid whatever the model (a node of every model's grid). */
export const HAZARD_STEP_DEG = 0.25;
export const gridStep = (kind: WeatherGridKind, model: WindModel): number =>
  kind === 'hazard' ? HAZARD_STEP_DEG : (GRID_STEP_DEG[model] ?? 0.0625);

/** Nearest grid node of a point. */
export function snapToGrid(p: { lat: number; lon: number }, step: number): { lat: number; lon: number } {
  return { lat: Math.round(p.lat / step) * step, lon: Math.round(p.lon / step) * step };
}

const coord = (x: number, digits: number) => String(+x.toFixed(digits));
/** Wire key of a grid node: '38.25,23.75'. */
export const nodeKey = (p: { lat: number; lon: number }): string => `${coord(p.lat, 4)},${coord(p.lon, 4)}`;
/** Wire key of an exact point (an aerodrome): 'p:37.936,23.945'. */
export const pointKey = (p: { lat: number; lon: number }): string => `p:${coord(p.lat, 3)},${coord(p.lon, 3)}`;
/** Parses '38.25,23.75' (a node) or 'p:37.936,23.945' (a point); null when malformed. */
export function parseLocKey(key: string): { point: boolean; lat: number; lon: number } | null {
  const m = /^(p:)?(-?\d{1,2}(?:\.\d{1,4})?),(-?\d{1,3}(?:\.\d{1,4})?)$/.exec(key);
  if (!m) return null;
  const lat = +m[2],
    lon = +m[3];
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { point: !!m[1], lat, lon };
}

/** Forecast length of each model on Open-Meteo, days after today (ICON global/EU ~7.5 days). */
export const MODEL_HORIZON_DAYS: Record<WindModel, number> = {
  ecmwf_ifs025: 15,
  gfs_seamless: 16,
  icon_seamless: 7,
  best_match: 16,
};
/** The forecast endpoint serves this many past days; older dates go to the historical-forecast API. */
export const FORECAST_PAST_DAYS = 92;
/** Open-Meteo metadata ids of the model actually used over Greece (seamless → the regional run). */
export const MODEL_META_IDS: Partial<Record<WindModel, string>> = {
  ecmwf_ifs025: 'ecmwf_ifs025',
  gfs_seamless: 'ncep_gfs025',
  icon_seamless: 'dwd_icon_eu',
};
export const isWindModel = (m: string): m is WindModel => m in MODEL_HORIZON_DAYS;

export type OpenMeteoEndpoint = 'forecast' | 'historical';

const DAY = 86400000;
const dayMs = (d: IsoDate) => Date.parse(d + 'T00:00:00Z');

export type ForecastAvailability =
  | { kind: 'forecast' | 'historical'; endpoint: OpenMeteoEndpoint; lastDate: IsoDate }
  | { kind: 'too-far'; availableFrom: IsoDate; lastDate: IsoDate }
  | { kind: 'invalid' };

/** Whether forecast data can be had for a date with this model, and from which endpoint. */
export function forecastAvailability(
  date: IsoDate,
  model: WindModel,
  nowMs: number = Date.now(),
): ForecastAvailability {
  const d = dayMs(date);
  if (!isFinite(d)) return { kind: 'invalid' };
  const today = dayMs(isoDay(nowMs));
  const horizon = MODEL_HORIZON_DAYS[model] ?? 15;
  const last = today + horizon * DAY;
  if (d > last) return { kind: 'too-far', availableFrom: isoDay(d - horizon * DAY), lastDate: isoDay(last) };
  if (d < today - FORECAST_PAST_DAYS * DAY)
    return { kind: 'historical', endpoint: 'historical', lastDate: isoDay(last) };
  return { kind: 'forecast', endpoint: 'forecast', lastDate: isoDay(last) };
}

export interface ModelRun {
  /** Initialisation (analysis) time of the latest run, epoch ms. */
  runMs: number;
  /** When that run became available on Open-Meteo, epoch ms. */
  availableMs: number | null;
}

/** One location's hourly arrays as Open-Meteo returns them (keys like 'wind_speed_850hPa'). */
export type Hourly = { time: string[] } & Record<string, (number | null)[] | string[]>;
export interface OpenMeteoLocation {
  hourly: Hourly;
  /** Grid point actually used and its elevation (m), as returned. */
  latitude?: number;
  longitude?: number;
  elevation?: number;
}

/** Most grid nodes + points in one GET /api/weather/grid. */
export const GRID_MAX_LOCATIONS = 100;
/** Most exact points (aerodromes) in one request. */
export const GRID_MAX_POINTS = 12;
/** Most days in one request. */
export const GRID_MAX_DAYS = 2;

/**
 * GET /api/weather/grid?kind=wind|hazard&model=…&from=YYYY-MM-DD&to=YYYY-MM-DD&locs=k;k;…[&fresh=1]
 * (keys from nodeKey / pointKey; points only for kind=wind).
 */
export interface WeatherGridResponse {
  endpoint: OpenMeteoEndpoint;
  /** The model run the data is from (forecast endpoint), or null when unknown. */
  run: ModelRun | null;
  /** Ask again after this: a newer model run may be out by then (epoch ms). */
  recheckMs: number;
  /** Per requested key: hourly data from `from` (00Z) through `to` (or fewer days at the end of the range); null = none. */
  locations: Record<string, OpenMeteoLocation | null>;
  /** Why some locations have no data (daily budget, Open-Meteo's answer). */
  message?: string;
  /** Local runs: generated data, not a forecast. */
  synthetic?: boolean;
}
