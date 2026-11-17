// Touch-and-go and intermediate-stop requests at aerodromes of the route (PLAN-v3 "Touch-and-go
// and intermediate-stop requests"). Pure helpers shared by the editor, the calculations, the FPL
// export and the API.
//
//   - A request is keyed by the route point's uid, so it follows the point when the route is
//     edited and is dropped when the point is removed or stops being an aerodrome.
//   - A point carries at most one request of each kind. An intermediate aerodrome may have both:
//     a touch-and-go, a circuit (PilotSettings.circuitMin), then a full-stop landing, n minutes on the ground
//     and a take-off.
//   - Touch-and-go: any aerodrome point. At the departure it is a circuit before leaving
//     ('INITIALLY REQUEST TOUCH N GO AT LGTT').
//   - Stop (n minutes): any aerodrome point of a route of two points or more.
//       - intermediate: landing, n minutes on the ground, take-off.
//       - at the departure: after take-off a circuit, a full-stop landing there,
//         n minutes on the ground, a new take-off, then the route ('Touch-and-go first' too: the
//         touch-and-go circuit, then the circuit to the full stop).
//       - at the destination: landing there (after a touch-and-go and a circuit when both are
//         requested), n minutes on the ground, a new take-off, a circuit and the final landing.
//   - Item 18: each request becomes one remark in the club's format (a point's touch-and-go before
//     its stop); several are joined in the one RMK/ field: 'REQUEST TOUCH N GO AT LGMG',
//     'REQUEST INTERMEDIATE STOP AT LGMG FOR 10 MIN', 'INITIALLY REQUEST FULL STOP AT LGTT FOR
//     10 MIN', 'REQUEST FULL STOP AT LGMG FOR 10 MIN THEN CIRCUIT'.
//   - Timing: an intermediate aerodrome with a request is passed at pattern TAS (the legs into and
//     out of it), a stop adds its minutes between landing and the next take-off, and a touch-and-go
//     followed by a stop there adds the circuit between them (airborne). A touch-and-go alone at
//     the departure or the destination adds no time.
import type { AerodromeRequest, FlightOptions, RoutePoint } from './types.js';

export const MAX_STOP_MIN = 600;
export const DEFAULT_STOP_MIN = 10;
/** Minutes of one circuit when the pilot has not set PilotSettings.circuitMin. */
export const DEFAULT_CIRCUIT_MIN = 7;

type Kind = AerodromeRequest['kind'];
const KINDS: readonly Kind[] = ['touch-and-go', 'stop'];
const same = (r: AerodromeRequest, pointUid: string, kind?: Kind) =>
  r.pointUid === pointUid && (!kind || r.kind === kind);

/** The request of a kind on a point, if any (the last one wins, as in activeRequests). */
export function requestOf(
  list: readonly AerodromeRequest[] | null | undefined,
  pointUid: string,
  kind: Kind,
): AerodromeRequest | undefined {
  const l = list ?? [];
  for (let i = l.length - 1; i >= 0; i--) if (same(l[i], pointUid, kind)) return l[i];
  return undefined;
}

/**
 * The requests on the route points that can carry them, in route order, a point's touch-and-go
 * before its stop (invalid ones dropped).
 */
export function activeRequests(
  route: RoutePoint[],
  options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined,
): { index: number; point: RoutePoint; request: AerodromeRequest }[] {
  const reqs = options?.aerodromeRequests ?? [];
  if (!reqs.length) return [];
  const byKey = new Map<string, AerodromeRequest>();
  for (const r of reqs) byKey.set(`${r.kind}|${r.pointUid}`, r); // the last one of a kind for a point wins
  const out: { index: number; point: RoutePoint; request: AerodromeRequest }[] = [];
  route.forEach((p, index) => {
    for (const kind of KINDS) {
      const r = byKey.get(`${kind}|${p.uid}`);
      if (r && requestAllowed(route, index, kind)) out.push({ index, point: p, request: r });
    }
  });
  return out;
}

/** Whether point `index` of the route may carry a request of this kind. */
export function requestAllowed(route: RoutePoint[], index: number, kind: AerodromeRequest['kind']): boolean {
  const p = route[index];
  if (!p || p.kind !== 'aerodrome') return false;
  if (kind === 'stop') return route.length > 1;
  return true;
}

/** Location indicator for a remark: the ICAO code when the point has one, else its name. */
export type IcaoOf = (p: RoutePoint) => string | null;

/** The remark of one request, in the club's format (before ATS-text cleaning). */
export function requestRemark(r: AerodromeRequest, where: string, index: number, last = Infinity): string {
  if (r.kind === 'stop') {
    const min = `FOR ${Math.round(r.stopMin ?? DEFAULT_STOP_MIN)} MIN`;
    if (index === 0) return `INITIALLY REQUEST FULL STOP AT ${where} ${min}`;
    if (index === last) return `REQUEST FULL STOP AT ${where} ${min} THEN CIRCUIT`;
    return `REQUEST INTERMEDIATE STOP AT ${where} ${min}`;
  }
  return `${index === 0 ? 'INITIALLY ' : ''}REQUEST TOUCH N GO AT ${where}`;
}

/** Every request's remark, in route order. */
export function requestRemarks(
  route: RoutePoint[],
  options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined,
  icaoOf: IcaoOf,
): string[] {
  return activeRequests(route, options).map(({ index, point, request }) =>
    requestRemark(request, (icaoOf(point) || point.name).toUpperCase(), index, route.length - 1),
  );
}

export interface RequestTiming {
  /** Per leg: flown at pattern TAS because it starts or ends at an intermediate request aerodrome. */
  patternLegs: boolean[];
  /** Per route point: an intermediate aerodrome with a request (pattern altitude there). */
  patternPoints: boolean[];
  /** Per leg: minutes on the ground at the leg's end before the next leg (stops). */
  groundAfterLegMin: number[];
  /** Per leg: a touch-and-go at an intermediate aerodrome at the leg's end (a landing and a take-off there). */
  touchAfterLeg: boolean[];
  /**
   * Per leg: minutes of the circuit flown after a touch-and-go at the leg's end before the
   * full-stop landing there (both requested at that aerodrome); 0 otherwise.
   */
  circuitAfterLegMin: number[];
  /**
   * A stop at the departure: the circuits flown from it before the full-stop landing there (one,
   * or two with 'Touch-and-go first': the touch-and-go ends the first), then its minutes on the
   * ground before the take-off for the route. [] and 0 without one.
   */
  departureCircuitsMin: number[];
  departureGroundMin: number;
  /**
   * A stop at the destination: groundAfterLegMin / circuitAfterLegMin / touchAfterLeg of the last
   * leg hold its minutes on the ground and the touch-and-go circuit before it; this is the circuit
   * after the new take-off, before the final landing. 0 without one.
   */
  finalCircuitMin: number;
  /** Full stops (intermediate, at the departure and at the destination): each one more start-up, taxi and take-off. */
  stops: number;
}

const stopMinOf = (r: AerodromeRequest) => Math.max(0, Math.min(MAX_STOP_MIN, r.stopMin ?? DEFAULT_STOP_MIN));

/** Timing effects of the requests on a route of route.length − 1 legs; circuitMin: one circuit's minutes. */
export function requestTiming(
  route: RoutePoint[],
  options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined,
  circuitMin: number = DEFAULT_CIRCUIT_MIN,
): RequestTiming {
  const n = Math.max(0, route.length - 1);
  const patternLegs = new Array<boolean>(n).fill(false);
  const patternPoints = new Array<boolean>(route.length).fill(false);
  const groundAfterLegMin = new Array<number>(n).fill(0);
  const touchAfterLeg = new Array<boolean>(n).fill(false);
  const circuitAfterLegMin = new Array<number>(n).fill(0);
  const departureCircuitsMin: number[] = [];
  let departureGroundMin = 0;
  let finalCircuitMin = 0;
  const active = activeRequests(route, options);
  const at = (index: number, kind: Kind) => active.find((a) => a.index === index && a.request.kind === kind)?.request;
  for (const { index, request } of active) {
    if (index === 0 || index === route.length - 1) continue; // the first and last legs are at pattern TAS anyway
    patternPoints[index] = true;
    patternLegs[index - 1] = true;
    if (index < n) patternLegs[index] = true;
    if (request.kind === 'stop') groundAfterLegMin[index - 1] += stopMinOf(request);
    else touchAfterLeg[index - 1] = true;
  }
  for (let i = 0; i < n; i++) if (touchAfterLeg[i] && groundAfterLegMin[i] > 0) circuitAfterLegMin[i] = circuitMin;
  if (n) {
    const dep = at(0, 'stop');
    if (dep) {
      if (at(0, 'touch-and-go')) departureCircuitsMin.push(circuitMin);
      departureCircuitsMin.push(circuitMin);
      departureGroundMin = stopMinOf(dep);
    }
    const dest = at(n, 'stop');
    if (dest) {
      groundAfterLegMin[n - 1] = stopMinOf(dest);
      if (at(n, 'touch-and-go')) {
        touchAfterLeg[n - 1] = true;
        circuitAfterLegMin[n - 1] = circuitMin;
      }
      finalCircuitMin = circuitMin;
    }
  }
  const stops = groundAfterLegMin.filter((m) => m > 0).length + (departureGroundMin > 0 ? 1 : 0);
  return {
    patternLegs,
    patternPoints,
    groundAfterLegMin,
    touchAfterLeg,
    circuitAfterLegMin,
    departureCircuitsMin,
    departureGroundMin,
    finalCircuitMin,
    stops,
  };
}

/** The NavlogInput fields of the request timing (src/calc/navlog.ts). */
export function navlogTiming(t: RequestTiming) {
  return {
    patternLegs: t.patternLegs,
    groundAfterLegMin: t.groundAfterLegMin,
    circuitAfterLegMin: t.circuitAfterLegMin,
    departureCircuitsMin: t.departureCircuitsMin,
    departureGroundMin: t.departureGroundMin,
    finalCircuitMin: t.finalCircuitMin,
  };
}

/** Sets the request of a kind on a point (its request of the other kind stays); returns the new list. */
export function setRequest(
  list: AerodromeRequest[] | undefined,
  pointUid: string,
  kind: Kind,
  stopMin?: number,
): AerodromeRequest[] {
  const prev = requestOf(list, pointUid, kind);
  const rest = (list ?? []).filter((r) => !same(r, pointUid, kind));
  // A request keeps the runway / surface chosen for it (a stop when only its minutes change).
  const keep = prev ? choices(prev) : {};
  const next: AerodromeRequest =
    kind === 'stop'
      ? {
          pointUid,
          kind,
          stopMin: Math.max(1, Math.min(MAX_STOP_MIN, Math.round(stopMin ?? DEFAULT_STOP_MIN))),
          ...keep,
        }
      : { pointUid, kind, ...keep };
  return [...rest, next];
}

/** Removes the request of a kind on a point, or all of the point's requests without a kind; returns the new list. */
export function removeRequest(list: AerodromeRequest[] | undefined, pointUid: string, kind?: Kind): AerodromeRequest[] {
  return (list ?? []).filter((r) => !same(r, pointUid, kind));
}

type Choices = Pick<AerodromeRequest, 'landingRunway' | 'takeoffRunway' | 'surface'>;
const choices = (r: AerodromeRequest): Choices => {
  const o: Choices = {};
  if (r.landingRunway) o.landingRunway = r.landingRunway;
  if (r.takeoffRunway) o.takeoffRunway = r.takeoffRunway;
  if (r.surface) o.surface = r.surface;
  return o;
};

/**
 * Sets the runway (landing / take-off) or surface chosen at a stop or touch-and-go (each request
 * keeps its own); null = automatic / paved, dry.
 */
export function setStopChoice(
  list: AerodromeRequest[] | undefined,
  pointUid: string,
  kind: Kind,
  key: keyof Choices,
  value: string | null,
): AerodromeRequest[] {
  return (list ?? []).map((r) => {
    if (!same(r, pointUid, kind)) return r;
    const next: AerodromeRequest = { ...r };
    if (value) next[key] = value;
    else delete next[key];
    return next;
  });
}

/**
 * Route point indices of the intermediate full stops (a landing and a new take-off there), in
 * route order: the points after which requestTiming() puts ground time. The calculations'
 * sectors (src/calc/sectors.ts) end at exactly these points.
 */
export function stopPointIndices(
  route: RoutePoint[],
  options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined,
): number[] {
  const g = requestTiming(route, options).groundAfterLegMin;
  const out: number[] = [];
  for (let i = 0; i < g.length - 1; i++) if (g[i] > 0) out.push(i + 1);
  return out;
}

/**
 * Route point indices where the aircraft lands and takes off again between the departure and the
 * destination: intermediate full stops and touch-and-goes, in route order. The calculations'
 * sectors end at these points (each needs its own landing and take-off performance).
 */
export function landingPointIndices(
  route: RoutePoint[],
  options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined,
): number[] {
  const t = requestTiming(route, options);
  const out: number[] = [];
  for (let i = 0; i < t.groundAfterLegMin.length - 1; i++)
    if (t.groundAfterLegMin[i] > 0 || t.touchAfterLeg[i]) out.push(i + 1);
  return out;
}
