// Model data for the weather hazards along the route (src/calc/hazards.ts): weather code, CAPE,
// visibility, low cloud, 2 m temperature/dewpoint and cloud cover + height of each pressure level,
// from Open-Meteo (the flight's model; ECMWF IFS by default) at corridor points, through our server
// (GET /api/weather/grid, src/data/weatherGrid.ts).
//
// Corridor: every ~10 NM along each leg and ±5 NM either side. Points are snapped to the 0.25°
// model grid and de-duplicated; each grid node is cached on its own (per model run, here and on
// the server for every pilot), so editing the route only fetches the nodes that are new.
import type { CorridorSeries, Hazard, HazardSample, NavlogResult } from '../calc';
import { aerodromeModelHazards, legHazards, reportHazards, tafHazardContent } from '../calc';
import type { IsoDate, LatLon, WindModel } from '../shared';
import { isoDay } from '../shared/date';
import { HAZARD_STEP_DEG, nodeKey } from '../shared/weatherGrid';
import {
  DEFAULT_MODEL,
  describeSource,
  forecastAvailability,
  type ForecastSource,
  isGridResult,
  LEVELS,
  METAR_MAX_AGE_MS,
  METAR_USE_WINDOW_MS,
  MODEL_LABELS,
  type OpenMeteoEndpoint,
  type OpenMeteoLocation,
} from './weather';
import { clearGridCache, fetchGrid, type GridGet, type GridResult } from './weatherGrid';
import type { StationReports } from './weatherMetar';

export const CORRIDOR_STEP_NM = 10;
export const CORRIDOR_HALF_WIDTH_NM = 5;
export const GRID_DEG = HAZARD_STEP_DEG;
const DAY = 86400000;
export const clearHazardCache = () => clearGridCache();

export interface GridCell {
  key: string;
  lat: number;
  lon: number;
}
const snap = (x: number) => Math.round(x / GRID_DEG) * GRID_DEG;
export function gridCell(p: LatLon): GridCell {
  const lat = snap(p.lat),
    lon = snap(p.lon);
  return { key: `${lat.toFixed(2)},${lon.toFixed(2)}`, lat, lon };
}

/** Corridor points of a leg: fractions along it and the grid cells (de-duplicated per fraction). */
export function legCorridor(
  from: LatLon,
  to: LatLon,
  distNm: number,
): { spacingFrac: number; points: { frac: number; cells: GridCell[] }[] } {
  const n = Math.max(1, Math.ceil((isFinite(distNm) ? distNm : 0) / CORRIDOR_STEP_NM));
  const cosLat = Math.cos((((from.lat + to.lat) / 2) * Math.PI) / 180) || 1;
  // local flat frame in NM: x east, y north
  const dx = (to.lon - from.lon) * 60 * cosLat,
    dy = (to.lat - from.lat) * 60;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len,
    py = dx / len; // unit normal (left of track)
  const points: { frac: number; cells: GridCell[] }[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const lat0 = from.lat + (to.lat - from.lat) * f,
      lon0 = from.lon + (to.lon - from.lon) * f;
    const cells = new Map<string, GridCell>();
    for (const off of [0, -CORRIDOR_HALF_WIDTH_NM, CORRIDOR_HALF_WIDTH_NM]) {
      const c = gridCell({ lat: lat0 + (py * off) / 60, lon: lon0 + (px * off) / (60 * cosLat) });
      cells.set(c.key, c);
    }
    points.push({ frac: f, cells: [...cells.values()] });
  }
  return { spacingFrac: 1 / n, points };
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
      const zM = num(h[`geopotential_height_${l}hPa`], i),
        coverPct = num(h[`cloud_cover_${l}hPa`], i);
      if (zM != null && coverPct != null) levels.push({ zM, coverPct });
    }
    return {
      timeMs: Date.parse(String(t).endsWith('Z') ? String(t) : `${t}Z`),
      weatherCode: num(h.weather_code, i),
      capeJkg: num(h.cape, i),
      visibilityM: num(h.visibility, i),
      cloudLowPct: num(h.cloud_cover_low, i),
      tempC: num(h.temperature_2m, i),
      dewC: num(h.dew_point_2m, i),
      elevM,
      levels,
    };
  });
}

export interface HazardWeatherRequest {
  date: IsoDate;
  model: WindModel | null | undefined;
  legs: { from: LatLon; to: LatLon; distNm: number }[];
  departure: LatLon | null;
  destination: LatLon | null;
  force?: boolean;
  get?: GridGet;
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

/** Corridor data for the hazards of a whole flight. Never rejects. */
export async function fetchHazardWeather(req: HazardWeatherRequest): Promise<HazardWeather> {
  const now = req.now || Date.now;
  const plan = hazardWeatherPlan(req, now());
  if ('done' in plan) return plan.done;
  try {
    const r = await fetchGrid({ ...plan.grid, force: !!req.force, get: req.get, now });
    return hazardWeatherFrom(req, plan, r, now());
  } catch (e) {
    return hazardWeatherFrom(req, plan, e, now());
  }
}

/** What fetchHazardWeather asks the grid for, or its answer when it asks nothing. */
export type HazardWeatherPlan =
  | { done: HazardWeather }
  | {
      model: WindModel;
      endpoint: OpenMeteoEndpoint;
      grid: { kind: 'hazard'; model: WindModel; from: IsoDate; to: IsoDate; locs: string[] };
      corridors: ReturnType<typeof legCorridor>[];
      cells: GridCell[];
      depCell: GridCell | null;
      destCell: GridCell | null;
    };

const emptyHazards = (
  req: Pick<HazardWeatherRequest, 'legs'>,
  status: HazardWeather['status'],
  message: string,
): HazardWeather => ({
  status,
  message,
  legs: req.legs.map(() => ({ corridor: [], spacingFrac: 1 })),
  departure: [],
  destination: [],
  sourceLabel: '',
  source: null,
});

/** The grid request of a flight's hazard data at a time (pure: fetchHazardWeather and the native core). */
export function hazardWeatherPlan(
  req: Pick<HazardWeatherRequest, 'date' | 'model' | 'legs' | 'departure' | 'destination'>,
  nowMs: number,
): HazardWeatherPlan {
  const model = req.model || DEFAULT_MODEL;
  if (!req.legs.length && !req.departure && !req.destination) return { done: emptyHazards(req, 'idle', '') };
  const av = forecastAvailability(req.date, model, nowMs);
  if (av.kind === 'invalid') return { done: emptyHazards(req, 'idle', 'No flight date') };
  if (av.kind === 'too-far')
    return {
      done: emptyHazards(
        req,
        'unavailable',
        `${MODEL_LABELS[model]} forecast reaches ${av.lastDate}: no weather hazards for ${req.date} yet`,
      ),
    };
  const next = isoDay(Date.parse(req.date + 'T00:00:00Z') + DAY);
  const d1 = next <= av.lastDate ? next : req.date;
  const corridors = req.legs.map((l) => legCorridor(l.from, l.to, l.distNm));
  const cells = new Map<string, GridCell>();
  for (const c of corridors) for (const p of c.points) for (const g of p.cells) cells.set(g.key, g);
  const depCell = req.departure ? gridCell(req.departure) : null;
  const destCell = req.destination ? gridCell(req.destination) : null;
  for (const g of [depCell, destCell]) if (g) cells.set(g.key, g);
  const list = [...cells.values()];
  return {
    model,
    endpoint: av.endpoint,
    grid: { kind: 'hazard', model, from: req.date, to: d1, locs: list.map((c) => nodeKey(c)) },
    corridors,
    cells: list,
    depCell,
    destCell,
  };
}

/** The flight's hazard data from the grid's answer (or the error it failed with). */
export function hazardWeatherFrom(
  req: Pick<HazardWeatherRequest, 'legs'>,
  plan: Exclude<HazardWeatherPlan, { done: HazardWeather }>,
  answer: GridResult | unknown,
  nowMs: number,
): HazardWeather {
  const { model, corridors, depCell, destCell } = plan;
  try {
    if (!isGridResult(answer)) throw answer;
    const data = new Map<string, HazardSample[] | null>();
    for (const c of plan.cells) {
      const loc = answer.locations.get(nodeKey(c)) ?? null;
      data.set(c.key, loc ? hazardSeries(loc) : null);
    }
    const endpoint = answer.endpoint ?? plan.endpoint;
    const run = endpoint === 'forecast' ? answer.run : null;
    if ([...data.values()].every((v) => v === null))
      return emptyHazards(req, 'error', `Weather hazards unavailable: ${answer.message || 'no data'}`);
    const source: ForecastSource = {
      provider: 'Open-Meteo',
      model,
      modelLabel: MODEL_LABELS[model] || model,
      endpoint,
      run,
      fetchedMs: nowMs,
      coverFromMs: null,
      coverToMs: null,
      ...(answer.synthetic ? { synthetic: true } : {}),
    };
    const runText = run ? `run ${describeSource(source).split('run ')[1]?.split(',')[0] ?? ''}` : '';
    const sourceLabel = [source.modelLabel, runText].filter(Boolean).join(', ');
    return {
      status: 'ok',
      message: describeSource(source),
      sourceLabel,
      source,
      legs: corridors.map((c) => ({
        spacingFrac: c.spacingFrac,
        corridor: c.points.flatMap((p) => p.cells.map((g) => ({ frac: p.frac, samples: data.get(g.key) ?? [] }))),
      })),
      departure: depCell ? (data.get(depCell.key) ?? []) : [],
      destination: destCell ? (data.get(destCell.key) ?? []) : [],
    };
  } catch (e) {
    return emptyHazards(req, 'error', `Weather hazards unavailable: ${String((e as Error)?.message || e)}`);
  }
}

export interface RouteHazardsInput {
  hw: HazardWeather | null;
  navlog: NavlogResult | null;
  /** 00:00 UTC of the flight date, epoch ms. */
  dayMs: number;
  departure: { elevFt: number; reports: StationReports | null } | null;
  destination: { elevFt: number; reports: StationReports | null } | null;
  nowMs: number;
}

const hhmmZ = (ms: number) =>
  `${new Date(ms).toISOString().slice(8, 10)}${new Date(ms).toISOString().slice(11, 16).replace(':', '')}Z`;

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
      out.push(
        ...legHazards({
          legIndex: k,
          altFt: l.altFt,
          startMs: at(l.startMin),
          endMs: at(l.endMin),
          corridor: c.corridor,
          source: hw.sourceLabel,
          spacingFrac: c.spacingFrac,
        }),
      );
    });
    const first = navlog.legs[0],
      last = navlog.legs[navlog.legs.length - 1];
    if (i.departure)
      out.push(
        ...aerodromeModelHazards({
          end: 'departure',
          altFt: first.altFt,
          timeMs: at(navlog.times.takeoffMin),
          samples: hw.departure,
          source: hw.sourceLabel,
        }),
      );
    if (i.destination)
      out.push(
        ...aerodromeModelHazards({
          end: 'destination',
          altFt: last.altFt,
          timeMs: at(navlog.times.landingMin),
          samples: hw.destination,
          source: hw.sourceLabel,
        }),
      );
  }
  const ends = [
    { end: 'departure' as const, e: i.departure, timeMs: at(navlog.times.takeoffMin), altFt: navlog.legs[0].altFt },
    {
      end: 'destination' as const,
      e: i.destination,
      timeMs: at(navlog.times.landingMin),
      altFt: navlog.legs[navlog.legs.length - 1].altFt,
    },
  ];
  for (const { end, e, timeMs, altFt } of ends) {
    const m = e?.reports?.metar;
    if (
      e &&
      m &&
      !m.nil &&
      m.timeMs != null &&
      i.nowMs - m.timeMs <= METAR_MAX_AGE_MS &&
      Math.abs(timeMs - m.timeMs) <= METAR_USE_WINDOW_MS
    ) {
      out.push(
        ...reportHazards(
          {
            label: `${m.type} ${m.station} ${hhmmZ(m.timeMs)}`,
            timeFromMs: m.timeMs,
            timeToMs: m.timeMs,
            visibilityM: m.cavok ? 9999 : m.visibilityM,
            clouds: m.clouds,
            weather: m.weather,
          },
          { end, elevFt: e.elevFt, altFt },
        ),
      );
    }
    const t = e?.reports?.taf;
    if (e && t && t.validFromMs != null && t.validToMs != null && timeMs >= t.validFromMs && timeMs <= t.validToMs) {
      const content = tafHazardContent(t.raw);
      out.push(
        ...reportHazards(
          {
            label: `TAF ${t.station}${t.issuedMs != null ? ` ${hhmmZ(t.issuedMs)}` : ''}`,
            timeFromMs: t.validFromMs,
            timeToMs: t.validToMs,
            ...content,
          },
          { end, elevFt: e.elevFt, altFt },
        ),
      );
    }
  }
  return out;
}
