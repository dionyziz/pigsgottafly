// The native iPhone app's core (NATIVE.md "core.js API"): the website's computations behind one
// global, PGF, that the app runs in JavaScriptCore. Built into native/ios/PigsGottaFly/Resources/core.js
// by `npm run native:core` (tools/build_native_core.ts). Unit-tested in tests/unit/native/.
//
// Every function takes one argument, an object or its JSON text, and returns a plain object that
// JSON.stringify turns into its JSON (NaN and ±Infinity become null). Pure and synchronous: no DOM,
// no fetch, no timers; JavaScriptCore has only the ECMAScript globals (and Intl). The app fetches
// what weatherRequests lists and hands the answers to computeFlight.
import type { StyleSpecification } from 'maplibre-gl';

import { buildLegs, defaultAltitudes, type LegGeometry, magneticVariation, TERRAIN_GRID } from '../calc';
import { atcEntryLegs, atcInput, atcLegRelevance, generateAtcList } from '../data/atc';
import { weatherPlan } from '../data/flightWeatherPlan';
import { type HazardWeather, hazardWeatherFrom, hazardWeatherPlan } from '../data/hazardWeather';
import { visibleNotams } from '../data/notams';
import adAirspacesJson from '../data/ref/ad-airspaces.json';
import firJson from '../data/ref/fir.json';
import navaidsJson from '../data/ref/navaids.json';
import sunJson from '../data/ref/sun.json';
import { type RouteWeather, routeWeatherFrom, routeWeatherPlan } from '../data/weather';
import { answerOf, type GridAnswer, gridRequests, type GridResult, mergeGrid } from '../data/weatherGrid';
import { metarGroups, metarTafOf, type MetarTafResult } from '../data/weatherMetar';
import { airspaceInfos, farFromRoute } from '../features/editor/map/airspace';
import {
  aerodromeFeatures,
  airspaceFeatures,
  areaFeatures,
  firFeatures,
  focusFeatures,
  midpointFeatures,
  navaidFeatures,
  routeArrowFeatures,
  routeLineFeatures,
  routePointFeatures,
  vfrPointFeatures,
  vfrRouteArrowFeatures,
  vfrRouteFeatures,
  waypointFeatures,
  zoneFeatures,
} from '../features/editor/map/features';
import { airspaceShown } from '../features/editor/map/mapPrefs';
import {
  mapNotams,
  NOTAM_LAYER_IDS,
  NOTAM_SOURCE,
  notamFeatures,
  notamLayers,
} from '../features/editor/map/notamLayer';
import {
  AIR_SOURCES,
  type BaseMapId,
  buildStyle,
  DATA_SOURCES,
  FAR_OPACITY,
  FAR_OPACITY_PROP,
  farScaled,
  LAYER_GROUPS,
} from '../features/editor/map/style';
import { SYMBOL_INFO } from '../features/editor/map/symbols';
import { computeFlightCalc } from '../features/editor/panels/flightCalc';
import {
  paperwork as paperworkRows,
  picMissingOf,
  readiness,
  readinessWarnings,
} from '../features/editor/panels/readiness';
import { buildFromTemplate, TYPE_TEMPLATES } from '../features/hangar/templates';
import {
  type Aircraft,
  type AircraftInput,
  type AtcEntry,
  DEFAULT_MAP_LAYERS,
  DEFAULT_SETTINGS,
  type Flight,
  type MapLayers,
  mapLayersOf,
  type MetarTafResponse,
  type Pilot,
  type RefAdAirspace,
  type RefAerodrome,
  type RefBundle,
  type RefFir,
  type RefNavaid,
  type RefRunway,
  type RefSunTable,
  requestTiming,
  type Waypoint,
} from '../shared';
import type { FilingState, NotamBriefing } from '../shared/briefing';
import type { DeclarationsState } from '../shared/declarations';
import type { FormsState } from '../shared/forms';
import { flightPilot } from '../shared/sharing';
import type { WeatherGridResponse } from '../shared/weatherGrid';
import { progress as progressOf, type ProgressAtc } from './progress';

declare const __PGF_VERSION__: string;
/** The core's version: package.json's and a hash of the bundle (tools/build_native_core.ts). */
export const version: string = typeof __PGF_VERSION__ === 'string' ? __PGF_VERSION__ : 'dev';

// ---------------------------------------------------------------- input, output

type Json<T> = T | string;
const arg = <T>(x: Json<T> | null | undefined): T => (typeof x === 'string' ? (JSON.parse(x) as T) : (x ?? ({} as T)));
/** A plain JSON value: what JSON.stringify writes (NaN → null, a Map → {}, undefined fields dropped). */
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

// ---------------------------------------------------------------- reference data

/** GET /api/ref/bundle. What it lacks (the CTRs/ATZs, the FIR, the navaids, the sunset tables: the
 *  website ships them with its code) comes with the core. */
export type CoreRef = RefBundle & { sunTables?: Record<string, RefSunTable> };

interface Ref {
  bundle: RefBundle & { adAirspaces: RefAdAirspace[]; fir: RefFir; navaids: RefNavaid[] };
  sunTables: Record<string, RefSunTable>;
  runwaysOf: (aerodromeId: string) => RefRunway[];
}

let lastRef: { given: CoreRef; ref: Ref } | null = null;
/** The reference data of a call; a call without it uses the last one given. */
function refOf(given: CoreRef | null | undefined): Ref {
  if (!given) {
    if (!lastRef) throw new Error('ref (GET /api/ref/bundle) is needed');
    return lastRef.ref;
  }
  if (lastRef?.given === given) return lastRef.ref;
  const byAd = new Map<string, RefRunway[]>();
  for (const r of given.runways ?? []) {
    const list = byAd.get(r.aerodromeId) ?? [];
    list.push(r);
    byAd.set(r.aerodromeId, list);
  }
  const ref: Ref = {
    bundle: {
      ...given,
      adAirspaces: given.adAirspaces ?? (adAirspacesJson as unknown as RefAdAirspace[]),
      fir: given.fir ?? (firJson as unknown as RefFir),
      navaids: given.navaids ?? (navaidsJson as unknown as RefNavaid[]),
      areas: given.areas ?? [],
    },
    sunTables: given.sunTables ?? (sunJson as unknown as Record<string, RefSunTable>),
    runwaysOf: (id) => byAd.get(id) ?? [],
  };
  lastRef = { given, ref };
  return ref;
}

// ---------------------------------------------------------------- terrain

let terrain: Uint8Array | null = null;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 → bytes (JavaScriptCore has no atob). */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/**
 * The terrain grid (https://pigsgottafly.com/terrain/greece.bin, base64), kept for the following
 * computeFlight calls: the default altitude of uncharted legs and the low-leg warnings use it, as on
 * the website. Null forgets it. Returns whether a grid is set.
 */
export function setTerrain(input: Json<{ base64: string | null }> | null): { ok: boolean } {
  // the base64 text itself, or { base64 } (as an object or its JSON)
  const v =
    typeof input === 'string' && !input.trimStart().startsWith('{')
      ? input
      : arg<{ base64?: string | null }>(input ?? {}).base64;
  if (!v) {
    terrain = null;
    return { ok: false };
  }
  const g = fromBase64(v);
  terrain = g.length === TERRAIN_GRID.rows * TERRAIN_GRID.cols ? g : null;
  return { ok: !!terrain };
}

// ---------------------------------------------------------------- the chart

/** The chart's symbol images (the app draws them under these names), with what each looks like. */
export function symbolNames(): {
  name: string;
  size: number;
  colors: string[];
  rotates: boolean;
  pattern: boolean;
  description: string;
}[] {
  return Object.entries(SYMBOL_INFO).map(([name, s]) => ({
    name,
    size: s.size,
    colors: s.colors,
    rotates: !!s.rotates,
    pattern: !!s.pattern,
    description: s.description,
  }));
}

/** The style's layers by the layer toggle (MapLayers key) that shows them. */
export function layerGroups(): Record<string, string[]> {
  const groups: Record<string, readonly string[]> = { ...LAYER_GROUPS, notams: NOTAM_LAYER_IDS };
  return Object.fromEntries(Object.entries(groups).map(([k, ids]) => [k, [...ids]]));
}

const FAR_PROPERTY: ['case', ['boolean', ['get', string], boolean], number, number] = [
  'case',
  ['boolean', ['get', 'far'], false],
  FAR_OPACITY,
  1,
];

/**
 * The MapLibre style: the website's (buildStyle) with the NOTAM areas under the route, the layers
 * shown as `layers` says (all of them by default), and the airspaces far from the route faded by
 * their `far` property (chartData sets it; the website uses a feature state for it).
 */
export function chartStyle(
  input: Json<{ base?: BaseMapId; vector?: StyleSpecification | null; layers?: Partial<MapLayers> | null }>,
): StyleSpecification {
  const i = arg(input);
  const layers = mapLayersOf(i.layers ?? null) ?? { ...DEFAULT_MAP_LAYERS };
  const base = i.base ?? layers.base;
  const { style } = buildStyle(base, layers.ofm, i.vector ?? null);
  style.sources[NOTAM_SOURCE] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  const at = style.layers.findIndex((l) => l.id === 'route-casing');
  style.layers.splice(at < 0 ? style.layers.length : at, 0, ...notamLayers());
  const groups = layerGroups();
  for (const l of style.layers) {
    for (const [k, ids] of Object.entries(groups))
      if (ids.includes(l.id))
        l.layout = { ...(l.layout ?? {}), visibility: layers[k as keyof MapLayers] ? 'visible' : 'none' } as never;
    const prop = FAR_OPACITY_PROP[l.type];
    if (prop && 'source' in l && typeof l.source === 'string' && AIR_SOURCES.includes(l.source)) {
      const paint = (l.paint ?? {}) as Record<string, unknown>;
      paint[prop] = farScaled(paint[prop] as never, FAR_PROPERTY);
      (l as { paint?: unknown }).paint = paint;
    }
  }
  return plain(style);
}

/** The GeoJSON of every data source of chartStyle, as the website's map fills them. */
export function chartData(
  input: Json<{
    ref?: CoreRef | null;
    flight: Pick<Flight, 'route' | 'options'>;
    notams?: NotamBriefing | null;
    layers?: Partial<MapLayers> | null;
    /** The pilot's saved waypoints (GET /api/waypoints), drawn as on the website. */
    waypoints?: Waypoint[] | null;
    /** Epoch ms (the date of the aerodrome symbols' magnetic variation); default now. */
    now?: number;
  }>,
): Record<string, unknown> {
  const i = arg(input);
  const r = refOf(i.ref).bundle;
  const flight = i.flight;
  const layers = mapLayersOf(i.layers ?? null) ?? mapLayersOf(flight?.options?.mapLayers ?? null) ?? DEFAULT_MAP_LAYERS;
  const route = flight?.route ?? [];
  const routeLatLon = route.map((p) => ({ lat: p.lat, lon: p.lon }));
  const allInfos = airspaceInfos(r.airspaces, r.adAirspaces, r.areas ?? [], r.fir);
  const airInfos = allInfos.filter((a) => airspaceShown(layers, a.type));
  const far = new Set(allInfos.filter((a) => farFromRoute(a, routeLatLon)).map((a) => a.id));
  const withFar = <T extends { features: { properties: unknown }[] }>(fc: T): T => {
    for (const f of fc.features) {
      const p = f.properties as { id?: string; far?: boolean };
      p.far = !!p.id && far.has(p.id);
    }
    return fc;
  };
  const day = new Date(fin(i.now) ? i.now : Date.now()).toISOString().slice(0, 10);
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const out: Record<string, unknown> = {
    airspaces: withFar(airspaceFeatures(allInfos)),
    zones: withFar(zoneFeatures(allInfos)),
    areas: withFar(areaFeatures(airInfos)),
    fir: firFeatures(r.fir),
    'vfr-routes': vfrRouteFeatures(r.vfrRoutes, r.vfrPoints),
    'vfr-route-arrows': vfrRouteArrowFeatures(r.vfrRoutes, r.vfrPoints),
    'vfr-points': vfrPointFeatures(r.vfrPoints),
    navaids: navaidFeatures(r.navaids),
    aerodromes: aerodromeFeatures(r.aerodromes, magneticVariation(38, 24, day)),
    waypoints: waypointFeatures(i.waypoints ?? []),
    'air-focus': focusFeatures(null),
    'route-line': routeLineFeatures(route),
    'leg-focus': routeLineFeatures([]),
    'route-arrows': routeArrowFeatures(route),
    'route-band': EMPTY,
    'route-mid': midpointFeatures(route),
    'route-points': routePointFeatures(route, null),
    snap: EMPTY,
    [NOTAM_SOURCE]: notamFeatures(mapNotams(visibleNotams(i.notams ?? null, false)), null),
  };
  for (const id of DATA_SOURCES) if (!(id in out)) out[id] = EMPTY;
  return plain(out);
}

// ---------------------------------------------------------------- weather

interface FlightArgs {
  flight: Flight;
  ref?: CoreRef | null;
  /** Epoch ms; default now. */
  now?: number;
}

/** The flight's legs and what its weather is fetched for (as the editor: METAR/TAF always). */
function weatherSetup(flight: Flight, ref: Ref, nowMs: number) {
  const legs = buildLegs(flight.route ?? [], flight.date);
  const model = flight.options?.windModel;
  const plan = weatherPlan({
    date: flight.date,
    model,
    route: flight.route ?? [],
    options: flight.options,
    legs,
    aerodromes: ref.bundle.aerodromes,
  });
  const routeReq = {
    date: flight.date,
    model,
    legMidpoints: plan.mids,
    departure: plan.depLoc,
    destination: plan.destLoc,
    stops: plan.stops.map((s) => s.loc),
  };
  const wind = plan.mids.length || plan.depLoc ? routeWeatherPlan(routeReq, nowMs) : null;
  const dep = plan.departure,
    arr = plan.destination;
  const hazardReq = {
    date: flight.date,
    model,
    legs: legs.map((l) => ({ from: l.from, to: l.to, distNm: l.distNm })),
    departure: dep ? { lat: dep.lat, lon: dep.lon } : null,
    destination: arr ? { lat: arr.lat, lon: arr.lon } : null,
  };
  const hazard = legs.length && flight.date ? hazardWeatherPlan(hazardReq, nowMs) : null;
  return { legs, plan, routeReq, wind, hazardReq, hazard, metar: metarGroups(plan.icaos) };
}

const API = '/api/';
const metarPath = (ids: string[]) => `${API}weather/metar?ids=${ids.map(encodeURIComponent).join(',')}`;

/**
 * The GET paths (on https://pigsgottafly.com) the app fetches for the flight's weather: the winds
 * aloft and surface forecast (/api/weather/grid?kind=wind), the hazard data along the route
 * (kind=hazard) and METAR/TAF (/api/weather/metar), as the website's editor fetches them. Their
 * answers go to computeFlight's `weather`, keyed by these paths.
 */
export function weatherRequests(input: Json<FlightArgs>): string[] {
  const i = arg(input);
  const nowMs = fin(i.now) ? i.now : Date.now();
  const s = weatherSetup(i.flight, refOf(i.ref), nowMs);
  const paths: string[] = [];
  if (s.wind && !('done' in s.wind)) for (const g of gridRequests(s.wind.grid)) paths.push(API + g.path);
  for (const g of s.metar) paths.push(metarPath(g));
  if (s.hazard && !('done' in s.hazard)) for (const g of gridRequests(s.hazard.grid)) paths.push(API + g.path);
  return paths;
}

type Answers = Record<string, unknown>;
const notFetched = () => new Error('not fetched');

/** A grid request's result from the answers (as fetchGrid without its cache), or the error. */
function gridFrom(grid: Parameters<typeof gridRequests>[0], answers: Answers): GridResult | Error {
  const byLoc = new Map<string, GridAnswer>();
  for (const g of gridRequests(grid)) {
    const body = answers[API + g.path] as WeatherGridResponse | null | undefined;
    for (const k of g.locs)
      byLoc.set(
        k,
        body && typeof body === 'object' && body.locations
          ? { status: 'fulfilled', value: answerOf(body, k) }
          : { status: 'rejected', reason: notFetched() },
      );
  }
  const locs = [...new Set(grid.locs)];
  try {
    return mergeGrid(
      locs,
      locs.map((k) => byLoc.get(k)!),
    );
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

function weatherOf(s: ReturnType<typeof weatherSetup>, answers: Answers, nowMs: number) {
  const weather: RouteWeather | null = !s.wind
    ? null
    : 'done' in s.wind
      ? s.wind.done
      : routeWeatherFrom(s.routeReq, s.wind, gridFrom(s.wind.grid, answers), nowMs);
  const hazardWeather: HazardWeather | null = !s.hazard
    ? null
    : 'done' in s.hazard
      ? s.hazard.done
      : hazardWeatherFrom(s.hazardReq, s.hazard, gridFrom(s.hazard.grid, answers), nowMs);
  let metar: MetarTafResult | null = null;
  if (s.metar.length) {
    const bodies = s.metar.map((g) => answers[metarPath(g)] as MetarTafResponse | null | undefined);
    metar = metarTafOf(bodies.every((b) => b && typeof b === 'object' && b.stations) ? bodies : notFetched());
  }
  return { weather, hazardWeather, metar };
}

// ---------------------------------------------------------------- the flight

export interface ComputeFlightInput extends FlightArgs {
  /** The flight's aircraft (GET /api/aircraft/:id); a shared flight's comes with it (flight.access). */
  aircraft?: Aircraft | null;
  /** The session pilot (GET /api/me); a shared flight is computed with its owner's settings. */
  pilot?: Pilot | null;
  /** The answers of weatherRequests' paths (a path missing or null: not fetched). */
  weather?: Answers | null;
  /** The NOTAM briefing (GET /api/flights/:id/notams): aerodrome hours and the NOTAMs row. */
  notams?: NotamBriefing | null;
  /** The relevant NOTAMs were marked read. */
  notamsRead?: boolean;
}

/** The ATC list and what progress needs to tell where each row applies. */
function atcOf(flight: Flight, altitudesFt: number[], ref: Ref, radiusNm: number): ProgressAtc {
  const route = flight.route ?? [];
  const gen = atcInput(route, altitudesFt, ref.bundle, radiusNm);
  let entries: AtcEntry[] = [];
  let relevance = new Map<string, number[]>();
  try {
    entries = flight.atc ?? (route.length ? generateAtcList(gen) : []);
    relevance = atcLegRelevance(gen);
  } catch {
    /* as the ATC section: no list */
  }
  const adByKey = new Map<string, RefAerodrome>();
  for (const a of ref.bundle.aerodromes) {
    adByKey.set(a.id, a);
    if (a.icao) adByKey.set(a.icao, a);
  }
  return {
    entries,
    legs: entries.map((e) => atcEntryLegs(e, relevance)),
    aerodromes: entries.map((e) => {
      const m = /^ad:([^:]+)/.exec(e.sourceKey ?? '');
      const a = m ? adByKey.get(m[1]) : undefined;
      return a ? { lat: a.lat, lon: a.lon, zoneNm: a.zones.reduce((x, z) => Math.max(x, z.radiusNm), 0) } : null;
    }),
    polygons: entries.map((e) => {
      const m = /^as:(.+):[^:]*$/.exec(e.sourceKey ?? '');
      if (!m) return null;
      const vols = ref.bundle.airspaces.filter((v) => v.name === m[1]);
      return vols.length ? vols.map((v) => v.polygon) : null;
    }),
    fis: ref.bundle.fis
      ? {
          boundary: ref.bundle.fis.boundary,
          units: ref.bundle.fis.units.map((u) => ({ side: u.side, callsign: u.callsign })),
        }
      : null,
  };
}

/**
 * The flight as the website's editor computes it: legs, altitudes, navlog, fuel, W&B, take-off and
 * landing performance, the warnings, the "Ready to fly" rows of the Plan and Brief stages, the
 * times, the weather used and the ATC list (for progress).
 */
export function computeFlight(input: Json<ComputeFlightInput>) {
  const i = arg(input);
  const nowMs = fin(i.now) ? i.now : Date.now();
  const ref = refOf(i.ref);
  const flight = i.flight;
  const session = i.pilot ?? null;
  const pilot: Pick<Pilot, 'fullName' | 'phone' | 'settings'> = session
    ? flightPilot(session, flight)
    : {
        fullName: flight.access?.pilot.fullName ?? '',
        phone: flight.access?.pilot.phone ?? '',
        settings: flight.access?.pilot.settings ?? DEFAULT_SETTINGS,
      };
  const settings = { ...DEFAULT_SETTINGS, ...pilot.settings };
  const aircraft =
    (flight.aircraftId ? [i.aircraft, flight.access?.aircraft].find((a) => a?.id === flight.aircraftId) : null) ?? null;

  const s = weatherSetup(flight, ref, nowMs);
  const { weather, hazardWeather, metar } = weatherOf(s, i.weather ?? {}, nowMs);
  const legs: LegGeometry[] = s.legs;
  const overrides = legs.map((l) => flight.legOverrides?.[l.key]?.altFt);
  const timing = requestTiming(flight.route, flight.options, settings.circuitMin);
  const defaults = defaultAltitudes(
    flight.route,
    { aerodromes: ref.bundle.aerodromes, vfrPoints: ref.bundle.vfrPoints, vfrRoutes: ref.bundle.vfrRoutes, terrain },
    overrides,
    timing.patternPoints,
  );
  const altitudesFt = defaults.map((d, k) => overrides[k] ?? d.altFt);
  const calc = computeFlightCalc({
    doc: flight,
    legs,
    altitudesFt,
    aircraft,
    settings,
    weather,
    metar,
    hazardWeather,
    briefing: i.notams ?? null,
    terrain,
    ref: { aerodromes: ref.bundle.aerodromes, runwaysOf: ref.runwaysOf, sunTables: ref.sunTables },
    nowMs,
  });
  const rows = readiness({
    // a shared flight's PIC is its owner: their details are not the viewer's to add
    picMissing:
      session && !flight.access
        ? picMissingOf(flight.crew ?? [], {
            fullName: session.fullName ?? '',
            phone: session.phone ?? '',
            idNumber: session.idNumber ?? '',
          })
        : [],
    routePoints: flight.route.length,
    hasAircraft: !!flight.aircraftId,
    warnings: readinessWarnings(calc.warnings),
    notams: i.notams ?? null,
    notamsRead: !!i.notamsRead,
    filing: null,
    forms: null,
    declarations: null,
  }).filter((x) => x.stage !== 'file');
  const nav = calc.navlog;
  const dayMs = calc.dayMs;
  const at = (min: number | undefined) => (nav?.blockOffSet && fin(dayMs) && fin(min) ? dayMs + min * 60000 : null);
  return plain({
    version,
    legs: legs.map((l, k) => ({ ...l, altFt: altitudesFt[k], altSource: defaults[k]?.source ?? null })),
    altitudesFt,
    navlog: nav,
    fuel: calc.fuel,
    wb: calc.wb,
    wbOk: calc.wbOk,
    wbMissingWeights: calc.wbMissingWeights,
    warnings: calc.warnings,
    readiness: rows,
    times: {
      dayMs: fin(dayMs) ? dayMs : null,
      blockOffSet: !!nav?.blockOffSet,
      ...(nav ? nav.times : {}),
      sunsetMin: nav?.sunsetMin ?? null,
      blockOffMs: at(nav?.times.blockOffMin),
      takeoffMs: at(nav?.times.takeoffMin),
      landingMs: at(nav?.times.landingMin),
      blockOnMs: at(nav?.times.blockOnMin),
      eteMin: nav && nav.legs.length ? nav.totals.ete : null,
    },
    departure: calc.departure,
    arrival: calc.arrival,
    stops: calc.stops,
    crewErrors: calc.crewErrors,
    hazards: calc.hazards,
    aerodromeChecks: calc.aerodromeChecks,
    weather: {
      winds: weather ? { status: weather.status, message: weather.message, source: weather.source } : null,
      hazards: hazardWeather ? { status: hazardWeather.status, message: hazardWeather.message } : null,
      metar: metar
        ? { status: metar.status, message: metar.message, fetchedMs: metar.fetchedMs, stations: metar.stations }
        : null,
    },
    atc: atcOf(flight, altitudesFt, ref, settings.enrouteAerodromeRadiusNm ?? 2),
  });
}

/** The File & forms rows (GET /api/flights/:id/filing, /forms, /declarations). */
export function paperwork(
  input: Json<{ filing?: FilingState | null; forms?: FormsState | null; declarations?: DeclarationsState | null }>,
) {
  const i = arg(input);
  return plain(
    paperworkRows({ filing: i.filing ?? null, forms: i.forms ?? null, declarations: i.declarations ?? null }),
  );
}

// ---------------------------------------------------------------- in flight

/**
 * Where the aircraft is along the route (src/native/progress.ts). `computed` is computeFlight's
 * answer for the flight; `position` a GPS fix { lat, lon, altFt?, trackDeg?, gsKt?, time }.
 */
export function progress(
  input: Json<{
    flight?: Pick<Flight, 'route'> | null;
    computed: ReturnType<typeof computeFlight>;
    position: Parameters<typeof progressOf>[0]['position'];
    lastLegIndex?: number | null;
  }>,
) {
  const i = arg(input);
  const c = i.computed;
  const navLegs = (c?.navlog?.legs ?? []) as {
    altFt: number | null;
    gs?: number | null;
    mh?: number | null;
    ch?: number | null;
  }[];
  return plain(
    progressOf({
      legs: (c?.legs ?? []).map((l) => ({ from: l.from, to: l.to, distNm: l.distNm, variation: l.variation })),
      navlog: (c?.legs ?? []).map((l, k) => navLegs[k] ?? { altFt: l.altFt ?? null }),
      atc: c?.atc ?? null,
      position: i.position,
      lastLegIndex: i.lastLegIndex ?? null,
    }),
  );
}

// ---------------------------------------------------------------- a new pilot's first aircraft

/** The hangar's type templates ("Add aircraft" on the website), offered when the hangar is empty. */
export function aircraftTemplates(): { id: string; label: string; description: string }[] {
  return TYPE_TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description }));
}

/** The aircraft a template builds, with the registration: the body of POST /api/aircraft, as the
 *  website's Add aircraft dialog sends it. An unknown template id is a blank airframe. */
export function aircraftFromTemplate(input: Json<{ id: string | null; registration: string }>): AircraftInput {
  const i = arg(input);
  return plain({
    ...buildFromTemplate(i.id ?? null),
    registration: String(i.registration ?? '')
      .trim()
      .toUpperCase(),
  });
}
