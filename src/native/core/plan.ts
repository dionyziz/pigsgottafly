// Planning a flight as the website's editor edits it: the route (map and route fields), snapping,
// local flights, touch-and-go and stop requests, the FPL alternates, the fuel load, the "Ready to
// fly" stages and where a warning's Fix leads, and the ATC list's Regenerate.
import { atcAfterRegenerate, atcInput, atcStale, endpointAerodrome, generateAtcList } from '../../data/atc';
import { sectionOf } from '../../features/editor/focus';
import {
  addDrawnPoint,
  drawIndex,
  insertPoint,
  isBareRoundTrip,
  isRoundTrip,
  makeLocal,
  movePoint,
  pruneOverrides,
  removeDrawnPoint,
  removePoint,
  renamePoint,
  replacePoint,
  setAltitudeOverride,
  setRouteEnd,
} from '../../features/editor/map/routeEdit';
import {
  autoWaypointName,
  bestSnap,
  buildCandidates,
  findSnap,
  pointFromCandidate,
  routeCandidates,
  type ScreenPoint,
  SNAP_RADIUS_PX,
} from '../../features/editor/map/snap';
import { alternatesWith, MAX_ALTERNATES } from '../../features/editor/panels/fplOptions';
import {
  type ItemState,
  type ReadyItem,
  SECTION_STAGE,
  STAGE_LABEL,
  STAGES,
  stageSummary,
} from '../../features/editor/panels/readiness';
import { EDITOR_FOCUS_SECTION, type Fix, fixLink, planningFix } from '../../features/exports/fix';
import {
  activeRequests,
  type AerodromeRequest,
  DEFAULT_LOCAL_DURATION_MIN,
  DEFAULT_MAP_LAYERS,
  DEFAULT_SETTINGS,
  DEFAULT_STOP_MIN,
  type Flight,
  type FlightOptions,
  FUEL_DENSITY,
  FUEL_TYPES,
  fuelByType,
  fuelByTypeTotal,
  fuelLoad as fuelLoadOf,
  type FuelSpec,
  type FuelType,
  isLocalFlight,
  landingPointIndices,
  type LegOverride,
  LOCAL_AREA_NM,
  localDuration,
  localDurationOf,
  type MapLayers,
  mapLayersOf,
  MAX_LOCAL_DURATION_MIN,
  MAX_STOP_MIN,
  type Pilot,
  type RefAerodrome,
  removeRequest,
  requestAllowed,
  requestRemarks,
  type RoutePoint,
  setRequest as setRequestOf,
  setStopChoice,
  stopPointIndices,
  taxiAllowanceOf,
  uid,
  type Waypoint,
} from '../../shared';
import { arg, type CoreRef, type Json, plain, refOf } from './shared';

// ---------------------------------------------------------------- the route

type NewPoint = Omit<RoutePoint, 'uid'> & { uid?: string };
const withUid = (p: NewPoint): RoutePoint => ({ ...p, uid: p.uid || uid() });

export type RouteEditOp =
  | { op: 'add'; point: NewPoint; toEnd?: boolean }
  | { op: 'removeDrawn'; toEnd?: boolean }
  | { op: 'insert'; index: number; point: NewPoint }
  | { op: 'replace'; uid: string; point: Omit<RoutePoint, 'uid'> }
  | { op: 'move'; uid: string; point: Omit<RoutePoint, 'uid'>; newUid?: string }
  | { op: 'remove'; uid: string }
  | { op: 'rename'; uid: string; name: string }
  | { op: 'setEnd'; end: 'from' | 'to'; aerodrome: string | RefAerodrome; ref?: CoreRef | null }
  | { op: 'makeLocal' }
  | { op: 'setAltitude'; key: string; altFt: number | null };

/**
 * One edit of the route as the editor makes it (one undo step): the new route and the leg overrides
 * the editor keeps with it (MapView onRouteChange: overrides of legs that are gone are dropped).
 */
export function routeEdit(
  input: Json<{ route: RoutePoint[]; legOverrides?: Record<string, LegOverride> | null } & RouteEditOp>,
): { route: RoutePoint[]; legOverrides: Record<string, LegOverride> } {
  const i = arg(input);
  const route = i.route ?? [];
  const overrides = i.legOverrides ?? {};
  const routed = (next: RoutePoint[]) => plain({ route: next, legOverrides: pruneOverrides(overrides, next) });
  switch (i.op) {
    case 'add':
      return routed(addDrawnPoint(route, withUid(i.point), !!i.toEnd));
    case 'removeDrawn':
      return routed(removeDrawnPoint(route, !!i.toEnd));
    case 'insert':
      return routed(insertPoint(route, i.index, withUid(i.point)));
    case 'replace':
      return routed(replacePoint(route, i.uid, i.point));
    case 'move':
      return routed(movePoint(route, i.uid, i.point, () => i.newUid || uid()));
    case 'remove':
      return routed(removePoint(route, i.uid));
    case 'rename':
      return routed(renamePoint(route, i.uid, i.name));
    case 'setEnd': {
      const a = typeof i.aerodrome === 'string' ? refOf(i.ref).find(i.aerodrome) : i.aerodrome;
      if (!a) throw new Error(`unknown aerodrome ${String(i.aerodrome)}`);
      return routed(setRouteEnd(route, i.end, a));
    }
    case 'makeLocal':
      return routed(makeLocal(route) ?? route);
    case 'setAltitude':
      return plain({ route, legOverrides: setAltitudeOverride(overrides, i.key, i.altFt) });
    default:
      throw new Error(`unknown route edit ${String((i as { op?: unknown }).op)}`);
  }
}

/** What the map's drawing needs to know of a route. */
export function routeInfo(input: Json<{ route: RoutePoint[] }>) {
  const route = arg(input).route ?? [];
  return {
    roundTrip: isRoundTrip(route),
    bareRoundTrip: isBareRoundTrip(route),
    /** Where drawing adds its next point (before a round trip's closing point). */
    drawIndex: drawIndex(route),
    local: isLocalFlight(route),
    /** The name a new custom point gets (WP1, WP2, …). */
    autoWaypointName: autoWaypointName(route),
  };
}

// ---------------------------------------------------------------- snapping

/** MapLibre's world size at zoom 0, px: its tiles are 512 px (on the website and in MapLibre Native). */
const TILE = 512;
const mercator = (zoom: number) => {
  const world = TILE * 2 ** zoom;
  return {
    project: (lon: number, lat: number): ScreenPoint => {
      const s = Math.sin((lat * Math.PI) / 180);
      return { x: ((lon + 180) / 360) * world, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world };
    },
    unproject: (p: ScreenPoint) => ({
      lon: (p.x / world) * 360 - 180,
      lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * p.y) / world))) * 180) / Math.PI,
    }),
  };
};

let candidateCache: { key: unknown[]; cands: ReturnType<typeof buildCandidates> } | null = null;

/**
 * The point a tap or a drag at (lat, lon) snaps to on the map at `zoom`, as the website's map snaps
 * (RouteMap snapAt): the route's own points and, as the map's layers show them, the aerodromes, the
 * VFR points and the pilot's waypoints, within 12 px. `newUid` gives the route point its uid.
 */
export function snap(
  input: Json<{
    ref?: CoreRef | null;
    route?: RoutePoint[] | null;
    waypoints?: Waypoint[] | null;
    layers?: Partial<MapLayers> | null;
    lat: number;
    lon: number;
    zoom: number;
    exceptUid?: string | null;
    newUid?: string | null;
  }>,
) {
  const i = arg(input);
  const r = refOf(i.ref).bundle;
  const layers = mapLayersOf(i.layers ?? null) ?? DEFAULT_MAP_LAYERS;
  const waypoints = i.waypoints ?? [];
  const key = [r, JSON.stringify(waypoints), layers.aerodromes, layers.vfrPoints, layers.waypoints];
  if (!candidateCache || candidateCache.key.some((k, n) => k !== key[n]))
    candidateCache = {
      key,
      cands: buildCandidates(
        layers.aerodromes ? r.aerodromes : [],
        layers.vfrPoints ? r.vfrPoints : [],
        layers.waypoints ? waypoints : [],
      ),
    };
  const m = mercator(i.zoom);
  const pt = m.project(i.lon, i.lat);
  const pad = SNAP_RADIUS_PX + 4;
  const nw = m.unproject({ x: pt.x - pad, y: pt.y - pad });
  const se = m.unproject({ x: pt.x + pad, y: pt.y + pad });
  const box = { west: nw.lon, east: se.lon, north: nw.lat, south: se.lat };
  const own = findSnap(pt, routeCandidates(i.route ?? [], i.exceptUid ?? undefined), m.project, SNAP_RADIUS_PX, box);
  const hit = bestSnap(own, findSnap(pt, candidateCache.cands, m.project, SNAP_RADIUS_PX, box));
  return plain({ hit, point: hit ? pointFromCandidate(hit.cand, i.newUid || uid()) : null });
}

// ---------------------------------------------------------------- local flights

/** A local flight (the same aerodrome at both ends) and its airborne time (src/shared/local.ts). */
export function localFlight(input: Json<{ route: RoutePoint[]; options?: Partial<FlightOptions> | null }>) {
  const i = arg(input);
  const route = i.route ?? [];
  return {
    local: isLocalFlight(route),
    /** The local flight's airborne time, else null (the navlog gives it). */
    durationMin: localDuration(route, i.options),
    /** The time the flight has when it becomes local (the pilot's, else the default). */
    durationOf: localDurationOf(i.options),
    defaultMin: DEFAULT_LOCAL_DURATION_MIN,
    maxMin: MAX_LOCAL_DURATION_MIN,
    areaNm: LOCAL_AREA_NM,
  };
}

// ---------------------------------------------------------------- touch-and-go and stops

type Kind = AerodromeRequest['kind'];

/** options.aerodromeRequests after one change, as the FPL section, the map and the performance section make it. */
export function setRequest(
  input: Json<
    { aerodromeRequests?: AerodromeRequest[] | null; pointUid: string } & (
      | { op?: 'set'; kind: Kind; stopMin?: number }
      | { op: 'remove'; kind?: Kind }
      | {
          op: 'choice';
          kind: Kind;
          key: 'landingRunway' | 'takeoffRunway' | 'surface';
          value: string | null;
        }
    )
  >,
): AerodromeRequest[] {
  const i = arg(input);
  const list = i.aerodromeRequests ?? undefined;
  if (i.op === 'remove') return plain(removeRequest(list, i.pointUid, i.kind));
  if (i.op === 'choice') return plain(setStopChoice(list, i.pointUid, i.kind, i.key, i.value));
  return plain(setRequestOf(list, i.pointUid, i.kind, i.stopMin));
}

/**
 * The requests as the flight uses them: the active ones in route order, which kinds each point may
 * carry, their FPL remarks (item 18 RMK/), and the points with a full stop or a landing.
 */
export function requests(
  input: Json<{ route: RoutePoint[]; options?: Partial<FlightOptions> | null; ref?: CoreRef | null }>,
) {
  const i = arg(input);
  const route = i.route ?? [];
  const options = i.options ?? {};
  const aerodromes = refOf(i.ref).bundle.aerodromes;
  return plain({
    active: activeRequests(route, options),
    allowed: route.map((_, k) => ({
      'touch-and-go': requestAllowed(route, k, 'touch-and-go'),
      stop: requestAllowed(route, k, 'stop'),
    })),
    remarks: requestRemarks(route, options, (p) => endpointAerodrome(p, aerodromes)?.icao ?? null),
    stopPoints: stopPointIndices(route, options),
    landingPoints: landingPointIndices(route, options),
    stopMin: { default: DEFAULT_STOP_MIN, max: MAX_STOP_MIN },
  });
}

/** FlightOptions.alternates from the alternate fields (FplSection): known aerodromes by ICAO, at most two. */
export function fplOptions(input: Json<{ fields: string[]; ref?: CoreRef | null }>) {
  const i = arg(input);
  return { alternates: alternatesWith(i.fields ?? [], refOf(i.ref).resolve), max: MAX_ALTERNATES };
}

// ---------------------------------------------------------------- fuel

/**
 * The fuel on board by type (src/shared/fuel.ts): `totalL` split as the pilot typed it per type
 * (`byType`), else all of it the aircraft's first fuel; and the taxi allowance per take-off.
 */
export function fuelLoad(
  input: Json<{
    fuel: Pick<FuelSpec, 'types' | 'taxiAllowanceL'>;
    totalL: number;
    byType?: Partial<Record<FuelType, number>> | null;
    options?: { taxiAllowanceL?: number | null } | null;
  }>,
) {
  const i = arg(input);
  const typed = fuelByType(i.byType);
  return plain({
    load: fuelLoadOf(i.fuel, i.totalL, i.byType),
    byType: typed,
    byTypeTotal: fuelByTypeTotal(typed),
    taxiAllowanceL: taxiAllowanceOf(i.fuel, i.options),
    types: FUEL_TYPES,
    density: FUEL_DENSITY,
  });
}

// ---------------------------------------------------------------- readiness

/**
 * The "Ready to fly" stages (ReadinessBar): each stage's worst state and how many of its rows need
 * attention, from computeFlight's `readiness` rows and PGF.paperwork's.
 */
export function readinessStages(input: Json<{ items: ReadyItem[] }>) {
  const items = arg(input).items ?? [];
  return STAGES.map((stage) => ({ stage, label: STAGE_LABEL[stage], ...stageSummary(items, stage) })) as {
    stage: string;
    label: string;
    state: ItemState;
    open: number;
  }[];
}

/**
 * Where a warning's Fix leads (editorWarningFix, fixLink): a field of the flight (its section and
 * stage), or a page elsewhere (the hangar, the profile, a passenger). `text` is a warning's text;
 * `fix` a Fix as the export models give it.
 */
export function focusTarget(
  input: Json<{ text?: string | null; fix?: Fix | null; flightId?: string | null; aircraftId?: string | null }>,
) {
  const i = arg(input);
  const fix = i.fix ?? (i.text ? planningFix(i.text) : null);
  if (!fix) return { fix: null, focus: null, section: null, stage: null, link: null };
  const focus = fix.kind === 'flight' ? (fix.focus ?? 'route') : null;
  const section = focus ? (sectionOf(focus) ?? null) : null;
  return plain({
    fix,
    focus,
    section,
    stage: section ? (SECTION_STAGE[section] ?? null) : null,
    link: fixLink(fix, { flightId: i.flightId ?? undefined, aircraftId: i.aircraftId ?? null }),
  });
}

/** The editor's focus keys by section (EDITOR_FOCUS_SECTION) and the sections by stage. */
export function focusSections() {
  return { fields: { ...EDITOR_FOCUS_SECTION }, stages: { ...SECTION_STAGE } };
}

// ---------------------------------------------------------------- ATC

/**
 * The ATC section's list: the generated one for the route at `altitudesFt` (computeFlight's), whether
 * the flight's edited list is stale, and `atc`, the flight's doc.atc after "Regenerate".
 */
export function regenerateAtc(
  input: Json<{
    flight: Pick<Flight, 'route' | 'atc'>;
    altitudesFt: number[];
    pilot?: Pick<Pilot, 'settings'> | null;
    ref?: CoreRef | null;
  }>,
) {
  const i = arg(input);
  const ref = refOf(i.ref);
  const route = i.flight.route ?? [];
  const radius = { ...DEFAULT_SETTINGS, ...i.pilot?.settings }.enrouteAerodromeRadiusNm ?? 2;
  let generated: ReturnType<typeof generateAtcList> = [];
  try {
    if (route.length) generated = generateAtcList(atcInput(route, i.altitudesFt ?? [], ref.bundle, radius));
  } catch {
    /* as the ATC section: no list */
  }
  const edited = i.flight.atc ?? null;
  return plain({
    generated,
    list: edited ?? generated,
    stale: atcStale(edited, generated),
    atc: atcAfterRegenerate(edited, generated),
  });
}
