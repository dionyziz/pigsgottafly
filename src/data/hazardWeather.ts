// Model data for the weather hazards along the route (src/calc/hazards.ts): weather code, CAPE,
// visibility, low cloud, 2 m temperature/dewpoint and cloud cover + height of each pressure level,
// from Open-Meteo (the flight's model; ECMWF IFS by default) at corridor points.
//
// Corridor: every ~10 NM along each leg and ±5 NM either side. Points are snapped to the 0.25°
// model grid and de-duplicated, and each grid cell is cached on its own (per model and date), so
// editing the route only fetches the cells that are new.
import type { IsoDate, LatLon, WindModel } from '../shared';
import type { CorridorSeries, Hazard, HazardSample, NavlogResult } from '../calc';
import { aerodromeModelHazards, legHazards, reportHazards, tafHazardContent } from '../calc';
import type { StationReports } from './weatherMetar';
import { DEFAULT_MODEL, LEVELS, METAR_MAX_AGE_MS, METAR_USE_WINDOW_MS, MODEL_LABELS, describeSource, fetchModelRun, forecastAvailability, type ForecastSource, type OpenMeteoEndpoint, type OpenMeteoLocation } from './weather';

export const HAZARD_SURFACE = ['weather_code', 'cape', 'visibility', 'cloud_cover_low', 'temperature_2m', 'dew_point_2m'] as const;
export const CORRIDOR_STEP_NM = 10;
export const CORRIDOR_HALF_WIDTH_NM = 5;
export const GRID_DEG = 0.25;
/** At most this many grid cells per request (URL length); more are fetched in several requests. */
const CELLS_PER_REQUEST = 80;
const HOSTS: Record<OpenMeteoEndpoint, string> = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  historical: 'https://historical-forecast-api.open-meteo.com/v1/forecast',
};
const TTL_MS = 30 * 60 * 1000;
const DAY = 86400000;

export interface GridCell { key: string; lat: number; lon: number }
const snap = (x: number) => Math.round(x / GRID_DEG) * GRID_DEG;
export function gridCell(p: LatLon): GridCell {
  const lat = snap(p.lat), lon = snap(p.lon);
  return { key: `${lat.toFixed(2)},${lon.toFixed(2)}`, lat, lon };
}

/** Corridor points of a leg: fractions along it and the grid cells (de-duplicated per fraction). */
export function legCorridor(from: LatLon, to: LatLon, distNm: number): { spacingFrac: number; points: { frac: number; cells: GridCell[] }[] } {
  const n = Math.max(1, Math.ceil((isFinite(distNm) ? distNm : 0) / CORRIDOR_STEP_NM));
  const cosLat = Math.cos((((from.lat + to.lat) / 2) * Math.PI) / 180) || 1;
  // local flat frame in NM: x east, y north
  const dx = (to.lon - from.lon) * 60 * cosLat, dy = (to.lat - from.lat) * 60;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len; // unit normal (left of track)
  const points: { frac: number; cells: GridCell[] }[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const lat0 = from.lat + (to.lat - from.lat) * f, lon0 = from.lon + (to.lon - from.lon) * f;
    const cells = new Map<string, GridCell>();
    for (const off of [0, -CORRIDOR_HALF_WIDTH_NM, CORRIDOR_HALF_WIDTH_NM]) {
      const c = gridCell({ lat: lat0 + (py * off) / 60, lon: lon0 + (px * off) / (60 * cosLat) });
      cells.set(c.key, c);
    }
    points.push({ frac: f, cells: [...cells.values()] });
  }
  return { spacingFrac: 1 / n, points };
}

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
  return `${HOSTS[endpoint]}?${p}`;
}

const num = (a: unknown, i: number): number | null => {
  const v = Array.isArray(a) ? a[i] : null;
  return typeof v === 'number' && isFinite(v) ? v : null;
};

/** Hourly hazard samples of one Open-Meteo location. */
export function hazardSeries(loc: OpenMeteoLocation | null): HazardSample[] {
  const h = loc?.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const elevM = typeof loc?.elevation === 'number' && isFinite(loc.elevation) ? loc.elevation : null;
  return h.time.map((t, i) => {
    const levels = [];
    for (const l of LEVELS) {
      const zM = num(h[`geopotential_height_${l}hPa`], i), coverPct = num(h[`cloud_cover_${l}hPa`], i);
      if (zM != null && coverPct != null) levels.push({ zM, coverPct });
    }
    return {
      timeMs: Date.parse(String(t).endsWith('Z') ? String(t) : `${t}Z`),
      weatherCode: num(h.weather_code, i), capeJkg: num(h.cape, i), visibilityM: num(h.visibility, i),
      cloudLowPct: num(h.cloud_cover_low, i), tempC: num(h.temperature_2m, i), dewC: num(h.dew_point_2m, i), elevM, levels,
    };
  });
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

export interface HazardWeatherRequest {
  date: IsoDate;
  model: WindModel | null | undefined;
  legs: { from: LatLon; to: LatLon; distNm: number }[];
  departure: LatLon | null;
  destination: LatLon | null;
  force?: boolean;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface HazardWeather {
  status: 'ok' | 'unavailable' | 'error' | 'idle';
  message: string;
  /** Per leg: corridor series (one per corridor point; a point's cells merged) and the spacing. */
  legs: { corridor: CorridorSeries[]; spacingFrac: number }[];
  departure: HazardSample[];
  destination: HazardSample[];
  /** 'ECMWF IFS 0.25°, run 15 Nov 06Z' (for the hazard texts). */
  sourceLabel: string;
  source: ForecastSource | null;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Corridor data for the hazards of a whole flight. Never rejects. */
export async function fetchHazardWeather(req: HazardWeatherRequest): Promise<HazardWeather> {
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

// ---- the flight's hazards ---------------------------------------------------------------------------

export interface RouteHazardsInput {
  hw: HazardWeather | null;
  navlog: NavlogResult | null;
  /** 00:00 UTC of the flight date, epoch ms. */
  dayMs: number;
  departure: { elevFt: number; reports: StationReports | null } | null;
  destination: { elevFt: number; reports: StationReports | null } | null;
  nowMs: number;
}

const hhmmZ = (ms: number) => `${new Date(ms).toISOString().slice(8, 10)}${new Date(ms).toISOString().slice(11, 16).replace(':', '')}Z`;

/**
 * Every hazard of the flight: each leg's corridor at its planned altitude and time, the model at
 * the departure/destination around take-off/landing (against the first/last leg's altitude), and
 * the METAR (when current and within 90 min of that time) and TAF (when valid then).
 * Needs a block-off time (navlog.blockOffSet); without one there are no times to check: [].
 */
export function computeRouteHazards(i: RouteHazardsInput): Hazard[] {
  const { navlog, hw } = i;
  if (!navlog || !navlog.blockOffSet || !navlog.legs.length || !isFinite(i.dayMs)) return [];
  const out: Hazard[] = [];
  const at = (min: number) => i.dayMs + min * 60000;
  if (hw && hw.status === 'ok') {
    navlog.legs.forEach((l, k) => {
      const c = hw.legs[k];
      if (!c) return;
      out.push(...legHazards({ legIndex: k, altFt: l.altFt, startMs: at(l.startMin), endMs: at(l.endMin), corridor: c.corridor, source: hw.sourceLabel, spacingFrac: c.spacingFrac }));
    });
    const first = navlog.legs[0], last = navlog.legs[navlog.legs.length - 1];
    if (i.departure) out.push(...aerodromeModelHazards({ end: 'departure', altFt: first.altFt, timeMs: at(navlog.times.takeoffMin), samples: hw.departure, source: hw.sourceLabel }));
    if (i.destination) out.push(...aerodromeModelHazards({ end: 'destination', altFt: last.altFt, timeMs: at(navlog.times.landingMin), samples: hw.destination, source: hw.sourceLabel }));
  }
  const ends = [
    { end: 'departure' as const, e: i.departure, timeMs: at(navlog.times.takeoffMin), altFt: navlog.legs[0].altFt },
    { end: 'destination' as const, e: i.destination, timeMs: at(navlog.times.landingMin), altFt: navlog.legs[navlog.legs.length - 1].altFt },
  ];
  for (const { end, e, timeMs, altFt } of ends) {
    const m = e?.reports?.metar;
    if (e && m && !m.nil && m.timeMs != null && i.nowMs - m.timeMs <= METAR_MAX_AGE_MS && Math.abs(timeMs - m.timeMs) <= METAR_USE_WINDOW_MS) {
      out.push(...reportHazards({
        label: `${m.type} ${m.station} ${hhmmZ(m.timeMs)}`, timeFromMs: m.timeMs, timeToMs: m.timeMs,
        visibilityM: m.cavok ? 9999 : m.visibilityM, clouds: m.clouds, weather: m.weather,
      }, { end, elevFt: e.elevFt, altFt }));
    }
    const t = e?.reports?.taf;
    if (e && t && t.validFromMs != null && t.validToMs != null && timeMs >= t.validFromMs && timeMs <= t.validToMs) {
      const content = tafHazardContent(t.raw);
      out.push(...reportHazards({
        label: `TAF ${t.station}${t.issuedMs != null ? ` ${hhmmZ(t.issuedMs)}` : ''}`, timeFromMs: t.validFromMs, timeToMs: t.validToMs, ...content,
      }, { end, elevFt: e.elevFt, altFt }));
    }
  }
  return out;
}
