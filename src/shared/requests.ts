// Touch-and-go and intermediate-stop requests at aerodromes of the route (PLAN-v3 "Touch-and-go
// and intermediate-stop requests"). Pure helpers shared by the editor, the calculations, the FPL
// export and the API.
//
//   - A request is keyed by the route point's uid, so it follows the point when the route is
//     edited and is dropped when the point is removed or stops being an aerodrome.
//   - Touch-and-go: any aerodrome point. At the departure it is a circuit before leaving
//     ('INITIALLY REQUEST TOUCH N GO AT LGTT').
//   - Intermediate stop (n minutes): an aerodrome point between the departure and the destination.
//   - Item 18: each request becomes one remark in the club's format; several are joined in the one
//     RMK/ field: 'REQUEST TOUCH N GO AT LGMG', 'REQUEST INTERMEDIATE STOP AT LGMG FOR 10 MIN'.
//   - Timing: an intermediate aerodrome with a request is passed at pattern TAS (the legs into and
//     out of it), and a stop adds its minutes between landing and the next take-off.
import type { AerodromeRequest, FlightOptions, RoutePoint } from './types.js';

export const MAX_STOP_MIN = 600;
export const DEFAULT_STOP_MIN = 10;

/** The request on each route point that can carry one, in route order (invalid ones dropped). */
export function activeRequests(route: RoutePoint[], options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined): { index: number; point: RoutePoint; request: AerodromeRequest }[] {
  const reqs = options?.aerodromeRequests ?? [];
  if (!reqs.length) return [];
  const byUid = new Map<string, AerodromeRequest>();
  for (const r of reqs) byUid.set(r.pointUid, r); // the last one for a point wins
  const out: { index: number; point: RoutePoint; request: AerodromeRequest }[] = [];
  route.forEach((p, index) => {
    const r = byUid.get(p.uid);
    if (!r || !requestAllowed(route, index, r.kind)) return;
    out.push({ index, point: p, request: r });
  });
  return out;
}

/** Whether point `index` of the route may carry a request of this kind. */
export function requestAllowed(route: RoutePoint[], index: number, kind: AerodromeRequest['kind']): boolean {
  const p = route[index];
  if (!p || p.kind !== 'aerodrome') return false;
  if (kind === 'stop') return index > 0 && index < route.length - 1;
  return true;
}

/** Location indicator for a remark: the ICAO code when the point has one, else its name. */
export type IcaoOf = (p: RoutePoint) => string | null;

/** The remark of one request, in the club's format (before ATS-text cleaning). */
export function requestRemark(r: AerodromeRequest, where: string, index: number): string {
  if (r.kind === 'stop') return `REQUEST INTERMEDIATE STOP AT ${where} FOR ${Math.round(r.stopMin ?? DEFAULT_STOP_MIN)} MIN`;
  return `${index === 0 ? 'INITIALLY ' : ''}REQUEST TOUCH N GO AT ${where}`;
}

/** Every request's remark, in route order. */
export function requestRemarks(route: RoutePoint[], options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined, icaoOf: IcaoOf): string[] {
  return activeRequests(route, options).map(({ index, point, request }) => requestRemark(request, (icaoOf(point) || point.name).toUpperCase(), index));
}

/** Human label for the editor list: 'Touch-and-go', 'Initial touch-and-go', 'Stop 10 min'. */
export function requestLabel(r: AerodromeRequest, index: number): string {
  if (r.kind === 'stop') return `Intermediate stop ${Math.round(r.stopMin ?? DEFAULT_STOP_MIN)} min`;
  return index === 0 ? 'Touch-and-go before leaving' : 'Touch-and-go';
}

export interface RequestTiming {
  /** Per leg: flown at pattern TAS because it starts or ends at an intermediate request aerodrome. */
  patternLegs: boolean[];
  /** Per route point: an intermediate aerodrome with a request (pattern altitude there). */
  patternPoints: boolean[];
  /** Per leg: minutes on the ground at the leg's end before the next leg (stops). */
  groundAfterLegMin: number[];
}

/** Timing effects of the requests on a route of route.length − 1 legs. */
export function requestTiming(route: RoutePoint[], options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined): RequestTiming {
  const n = Math.max(0, route.length - 1);
  const patternLegs = new Array<boolean>(n).fill(false);
  const patternPoints = new Array<boolean>(route.length).fill(false);
  const groundAfterLegMin = new Array<number>(n).fill(0);
  for (const { index, request } of activeRequests(route, options)) {
    if (index === 0 || index === route.length - 1) continue; // the first and last legs are at pattern TAS anyway
    patternPoints[index] = true;
    patternLegs[index - 1] = true;
    if (index < n) patternLegs[index] = true;
    if (request.kind === 'stop') groundAfterLegMin[index - 1] += Math.max(0, Math.min(MAX_STOP_MIN, request.stopMin ?? DEFAULT_STOP_MIN));
  }
  return { patternLegs, patternPoints, groundAfterLegMin };
}

/** Sets (or, with kind null, removes) the request on a point; returns the new list. */
export function setRequest(list: AerodromeRequest[] | undefined, pointUid: string, kind: AerodromeRequest['kind'] | null, stopMin?: number): AerodromeRequest[] {
  const rest = (list ?? []).filter((r) => r.pointUid !== pointUid);
  if (!kind) return rest;
  return [...rest, kind === 'stop' ? { pointUid, kind, stopMin: Math.max(1, Math.min(MAX_STOP_MIN, Math.round(stopMin ?? DEFAULT_STOP_MIN))) } : { pointUid, kind }];
}
