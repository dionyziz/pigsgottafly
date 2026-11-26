// What the core's domain modules share: JSON in and out, the reference data of a call, the terrain
// grid, and the flight's weather and pilot as the website's editor resolves them.
import { buildLegs, TERRAIN_GRID } from '../../calc';
import { weatherPlan } from '../../data/flightWeatherPlan';
import { type HazardWeather, hazardWeatherFrom, hazardWeatherPlan } from '../../data/hazardWeather';
import { CYCLES } from '../../data/ref/cycles/core';
import firJson from '../../data/ref/fir.json';
import { type RouteWeather, routeWeatherFrom, routeWeatherPlan } from '../../data/weather';
import { answerOf, type GridAnswer, gridRequests, type GridResult, mergeGrid } from '../../data/weatherGrid';
import { metarGroups, metarTafOf, type MetarTafResult } from '../../data/weatherMetar';
import {
  aerodromeIndex,
  airacDay,
  type Aircraft,
  cycleOn,
  DEFAULT_SETTINGS,
  type Flight,
  type MetarTafResponse,
  type Pilot,
  type PilotSettings,
  type RefAdAirspace,
  type RefAerodrome,
  type RefBundle,
  type RefFir,
  type RefNavaid,
  type RefRunway,
  type RefSunTable,
} from '../../shared';
import { flightPilot } from '../../shared/sharing';
import type { WeatherGridResponse } from '../../shared/weatherGrid';

declare const __PGF_VERSION__: string;
/** The core's version: package.json's and a hash of the bundle (tools/build_native_core.ts). */
export const version: string = typeof __PGF_VERSION__ === 'string' ? __PGF_VERSION__ : 'dev';

// ---------------------------------------------------------------- input, output

export type Json<T> = T | string;
export const arg = <T>(x: Json<T> | null | undefined): T =>
  typeof x === 'string' ? (JSON.parse(x) as T) : (x ?? ({} as T));
/** A plain JSON value: what JSON.stringify writes (NaN → null, a Map → {}, undefined fields dropped). */
export const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Epoch ms of a call: its `now`, else the clock. */
export const nowOf = (now: unknown): number => (fin(now) ? now : Date.now());

// ---------------------------------------------------------------- reference data

/** GET /api/ref/bundle. What it lacks (the CTRs/ATZs, the FIR, the navaids, the sunset tables: the
 *  website ships them with its code) comes with the core. */
export type CoreRef = RefBundle & { sunTables?: Record<string, RefSunTable> };

export interface Ref {
  bundle: RefBundle & { adAirspaces: RefAdAirspace[]; fir: RefFir; navaids: RefNavaid[] };
  sunTables: Record<string, RefSunTable>;
  runwaysOf: (aerodromeId: string) => RefRunway[];
  /** Aerodrome by id or ICAO, as src/data/ref's aerodrome(). */
  find: (idOrIcao: string | null | undefined) => RefAerodrome | undefined;
  /** The aerodrome a typed text names, as src/data/ref's resolveAerodrome(). */
  resolve: (text: string) => RefAerodrome | undefined;
}

let lastRef: { given: CoreRef; ref: Ref } | null = null;
/** The reference data of a call; a call without it uses the last one given. */
export function refOf(given: CoreRef | null | undefined): Ref {
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
  const index = aerodromeIndex(given.aerodromes ?? []);
  // the server picks the AIRAC in effect; what its bundle lacks comes from the core's copy of that same cycle
  const cycle = CYCLES.find((c) => c.airac.id === given.airac?.id) ?? cycleOn(CYCLES, airacDay());
  const ref: Ref = {
    bundle: {
      ...given,
      adAirspaces: given.adAirspaces ?? cycle.adAirspaces,
      fir: given.fir ?? (firJson as unknown as RefFir),
      navaids: given.navaids ?? cycle.navaids,
      areas: given.areas ?? [],
    },
    sunTables: given.sunTables ?? cycle.sun,
    runwaysOf: (id) => byAd.get(id) ?? [],
    find: index.find,
    resolve: index.resolve,
  };
  lastRef = { given, ref };
  return ref;
}

// ---------------------------------------------------------------- terrain

let terrain: Uint8Array | null = null;
/** The grid setTerrain kept (null: none). */
export const terrainGrid = (): Uint8Array | null => terrain;
/** Keeps a grid when it has the size of TERRAIN_GRID; returns whether it was kept. */
export function keepTerrain(g: Uint8Array | null): boolean {
  terrain = g && g.length === TERRAIN_GRID.rows * TERRAIN_GRID.cols ? g : null;
  return !!terrain;
}

/** The reference data as the website's calculations take it (src/features/exports, src/calc). */
export function calcRef(ref: Ref) {
  return {
    aerodromes: ref.bundle.aerodromes,
    vfrPoints: ref.bundle.vfrPoints,
    vfrRoutes: ref.bundle.vfrRoutes,
    airspaces: ref.bundle.airspaces,
    fis: ref.bundle.fis,
    sunTables: ref.sunTables,
    runwaysOf: ref.runwaysOf,
    terrain,
  };
}

// ---------------------------------------------------------------- weather

export const API = '/api/';
export const metarPath = (ids: string[]) => `${API}weather/metar?ids=${ids.map(encodeURIComponent).join(',')}`;

/** The flight's legs and what its weather is fetched for (as the editor: METAR/TAF always). */
export function weatherSetup(flight: Flight, ref: Ref, nowMs: number) {
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

export type Answers = Record<string, unknown>;
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

export function weatherOf(s: ReturnType<typeof weatherSetup>, answers: Answers, nowMs: number) {
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

// ---------------------------------------------------------------- a flight's call

export interface FlightArgs {
  flight: Flight;
  ref?: CoreRef | null;
  /** Epoch ms; default now. */
  now?: number;
}

export interface FlightCallInput extends FlightArgs {
  /** The flight's aircraft (GET /api/aircraft/:id); a shared flight's comes with it (flight.access). */
  aircraft?: Aircraft | null;
  /** The session pilot (GET /api/me); a shared flight is computed with its owner's settings. */
  pilot?: Pilot | null;
  /** The answers of weatherRequests' paths (a path missing or null: not fetched). */
  weather?: Answers | null;
}

/**
 * What a call about a flight works from, as the website resolves it: the reference data, the pilot
 * the flight is computed for (useFlightPilot), their settings, the flight's aircraft
 * (useFlightAircraft) and the weather from the answers.
 */
export function flightContext(i: FlightCallInput) {
  const nowMs = nowOf(i.now);
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
  const settings: PilotSettings = { ...DEFAULT_SETTINGS, ...pilot.settings };
  const aircraft =
    (flight.aircraftId ? [i.aircraft, flight.access?.aircraft].find((a) => a?.id === flight.aircraftId) : null) ?? null;
  const setup = weatherSetup(flight, ref, nowMs);
  return { nowMs, ref, flight, session, pilot, settings, aircraft, setup, ...weatherOf(setup, i.weather ?? {}, nowMs) };
}
