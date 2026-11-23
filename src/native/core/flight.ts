// The flight as the website's editor computes it, its weather requests, the terrain grid and the
// File & forms rows.
import { defaultAltitudes, type LegGeometry } from '../../calc';
import { atcEntryLegs, atcInput, atcLegRelevance, generateAtcList } from '../../data/atc';
import { gridRequests } from '../../data/weatherGrid';
import { computeFlightCalc } from '../../features/editor/panels/flightCalc';
import {
  paperwork as paperworkRows,
  picMissingOf,
  readiness,
  readinessWarnings,
} from '../../features/editor/panels/readiness';
import {
  type AtcEntry,
  type Flight,
  isLocalFlight,
  localDuration,
  type RefAerodrome,
  requestTiming,
} from '../../shared';
import type { FilingState, NotamBriefing } from '../../shared/briefing';
import type { DeclarationsState } from '../../shared/declarations';
import type { FormsState } from '../../shared/forms';
import type { ProgressAtc } from '../progress';
import {
  API,
  arg,
  fin,
  type FlightArgs,
  type FlightCallInput,
  flightContext,
  type Json,
  keepTerrain,
  metarPath,
  nowOf,
  plain,
  type Ref,
  refOf,
  terrainGrid,
  version,
  weatherSetup,
} from './shared';

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
  return { ok: keepTerrain(v ? fromBase64(v) : null) };
}

/**
 * The GET paths (on https://pigsgottafly.com) the app fetches for the flight's weather: the winds
 * aloft and surface forecast (/api/weather/grid?kind=wind), the hazard data along the route
 * (kind=hazard) and METAR/TAF (/api/weather/metar), as the website's editor fetches them. Their
 * answers go to computeFlight's `weather`, keyed by these paths.
 */
export function weatherRequests(input: Json<FlightArgs>): string[] {
  const i = arg(input);
  const s = weatherSetup(i.flight, refOf(i.ref), nowOf(i.now));
  const paths: string[] = [];
  if (s.wind && !('done' in s.wind)) for (const g of gridRequests(s.wind.grid)) paths.push(API + g.path);
  for (const g of s.metar) paths.push(metarPath(g));
  if (s.hazard && !('done' in s.hazard)) for (const g of gridRequests(s.hazard.grid)) paths.push(API + g.path);
  return paths;
}

export interface ComputeFlightInput extends FlightCallInput {
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
  const { nowMs, ref, flight, session, settings, aircraft, setup: s, weather, hazardWeather, metar } = flightContext(i);
  const terrain = terrainGrid();
  const legs: LegGeometry[] = s.legs;
  const overrides = legs.map((l) => flight.legOverrides?.[l.key]?.altFt);
  const timing = requestTiming(flight.route, flight.options, settings.circuitMin);
  const defaults = defaultAltitudes(
    flight.route,
    {
      aerodromes: ref.bundle.aerodromes,
      vfrPoints: ref.bundle.vfrPoints,
      vfrRoutes: ref.bundle.vfrRoutes,
      terrain,
      layers: flight.options?.mapLayers,
    },
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
    local: isLocalFlight(flight.route),
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
  const localMin = localDuration(flight.route, flight.options);
  const at = (min: number | undefined) => (nav?.blockOffSet && fin(dayMs) && fin(min) ? dayMs + min * 60000 : null);
  return plain({
    version,
    legs: legs.map((l, k) => ({ ...l, altFt: altitudesFt[k], altSource: defaults[k]?.source ?? null })),
    altitudesFt,
    // a local flight: no legs, the pilot's airborne time
    local:
      localMin != null
        ? { aerodrome: flight.route[0].name, lat: flight.route[0].lat, lon: flight.route[0].lon, durationMin: localMin }
        : null,
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
      eteMin: nav && (nav.legs.length || nav.local) ? nav.totals.ete : localMin,
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
