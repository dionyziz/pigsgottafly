// Winds/temperature aloft and surface conditions from Open-Meteo (free, no key), ported from the
// v2 js/weather.js: values interpolated in height (geopotential) and time.
// Owned by the data agent (METAR/TAF via /api/weather/metar, caching, error states, …).
import type { WindModel } from '../shared';
import type { WindProvider, WindSample } from '../calc';

export const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600] as const;
export const SURFACE = ['pressure_msl', 'temperature_2m', 'dew_point_2m', 'wind_speed_10m', 'wind_direction_10m', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'] as const;

/** One location's hourly arrays as returned by Open-Meteo (keys like 'wind_speed_850hPa'). */
export type Hourly = { time: string[] } & Record<string, (number | null)[] | string[]>;
export interface OpenMeteoLocation { hourly: Hourly }

export function buildUrl(points: { lat: number; lon: number }[], dateFrom: string, dateTo: string, model: WindModel): string {
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
    models: model || 'ecmwf_ifs025',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

interface Level { z: number; u: number; v: number; temp: number }
const val = (h: Hourly, k: string, i: number) => (h[k] as (number | null)[] | undefined)?.[i];
const times = (h: Hourly) => h.time.map((t) => Date.parse(t.endsWith('Z') ? t : t + 'Z'));

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

/** Wind (FROM, true) and temperature at altitude ft MSL and time (ms UTC), or null. */
export function sampleAt(h: Hourly, altFt: number, timeMs: number): WindSample | null {
  const ts = times(h);
  let i = ts.findIndex((t) => t > timeMs) - 1;
  if (i < 0) i = timeMs < ts[0] ? 0 : ts.length - 2;
  i = Math.max(0, Math.min(ts.length - 2, i));
  const f = Math.max(0, Math.min(1, (timeMs - ts[i]) / (ts[i + 1] - ts[i])));
  const a = atHeight(h, i, altFt), b = atHeight(h, i + 1, altFt);
  if (!a || !b) {
    const x = a || b;
    if (!x) return null;
    const w = toDirSpd(x.u, x.v);
    return { dirDeg: w.dir, speedKt: w.spd, tempC: x.temp };
  }
  const mix = (x: number, y: number) => x + (y - x) * f;
  const w = toDirSpd(mix(a.u, b.u), mix(a.v, b.v));
  return { dirDeg: w.dir, speedKt: w.spd, tempC: mix(a.temp, b.temp) };
}

export interface SurfaceSample {
  qnh: number;
  temp: number;
  dew: number;
  wind: { dir: number; spd: number } | null;
  /** Cloud cover by layer, %. */
  low: number;
  mid: number;
  high: number;
}

/** Surface conditions at a time, or null. */
export function sampleSurface(h: Hourly, timeMs: number): SurfaceSample | null {
  const ts = times(h);
  let i = Math.max(0, Math.min(ts.length - 2, ts.findIndex((t) => t > timeMs) - 1));
  if (timeMs >= ts[ts.length - 1]) i = ts.length - 2;
  const f = Math.max(0, Math.min(1, (timeMs - ts[i]) / (ts[i + 1] - ts[i])));
  const at = (k: string) => {
    const a = val(h, k, i), b = val(h, k, i + 1);
    if (a == null && b == null) return NaN;
    if (a == null) return b as number;
    if (b == null) return a as number;
    return (a as number) + ((b as number) - (a as number)) * f;
  };
  const uv = (j: number) => {
    const ws = val(h, 'wind_speed_10m', j), wd = val(h, 'wind_direction_10m', j);
    if (ws == null || wd == null) return null;
    const r = ((wd as number) * Math.PI) / 180;
    return { u: -(ws as number) * Math.sin(r), v: -(ws as number) * Math.cos(r) };
  };
  const A = uv(i), B = uv(i + 1);
  let wind = null;
  if (A || B) {
    const a = (A || B)!, b = (B || A)!;
    wind = toDirSpd(a.u + (b.u - a.u) * f, a.v + (b.v - a.v) * f);
  }
  const out: SurfaceSample = { qnh: at('pressure_msl'), temp: at('temperature_2m'), dew: at('dew_point_2m'), wind, low: at('cloud_cover_low'), mid: at('cloud_cover_mid'), high: at('cloud_cover_high') };
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

const cache = new Map<string, OpenMeteoLocation[]>();
/** Fetches hourly data for the points (one response entry per point, same order). */
export async function fetchPoints(points: { lat: number; lon: number }[], dateFrom: string, dateTo: string, model: WindModel): Promise<OpenMeteoLocation[]> {
  const url = buildUrl(points, dateFrom, dateTo, model);
  const hit = cache.get(url);
  if (hit) return hit;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.reason) || `Open-Meteo HTTP ${res.status}`);
  const arr = (Array.isArray(body) ? body : [body]) as OpenMeteoLocation[];
  cache.set(url, arr);
  return arr;
}
export const clearCache = () => cache.clear();

/** A WindProvider over per-leg midpoint data: perLeg[i] is the response for leg i's midpoint. */
export function windProviderFromLegs(perLeg: (OpenMeteoLocation | null)[]): WindProvider {
  return ({ legIndex, altFt, timeMs }) => {
    const loc = perLeg[legIndex];
    return loc && loc.hourly && isFinite(altFt) && isFinite(timeMs) ? sampleAt(loc.hourly, altFt, timeMs) : null;
  };
}
