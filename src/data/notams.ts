// NOTAM briefing on the client: GET /api/flights/:id/notams (the server fetches, decodes and
// assesses relevance, see api/_lib/notams.ts) and pure helpers that turn a Notam into the texts
// the editor panel, the map and the briefing export show, plus its map geometry (the areas its
// text describes, else its Q-line circle).
import type { Notam, NotamBriefing } from '../shared/briefing';
import { fmtAltitude, fmtDateTimeMs } from '../shared/format';
import { FIR_WIDE_NM, type NotamArea } from '../shared/notamAreas';
import { peekGet, rememberGet, request } from './api';

export type { Notam, NotamBriefing };

export interface NotamQuery {
  /** Highest planned altitude, ft (default: the server's computed altitudes of the saved flight). */
  maxAltFt?: number;
  /** Half-width of the route corridor, NM (server default 10). */
  corridorNm?: number;
  /** Bypass the server's 10-minute cache. */
  refresh?: boolean;
}

export function notamsPath(flightId: string, q: NotamQuery = {}): string {
  const p = new URLSearchParams();
  if (q.maxAltFt != null && Number.isFinite(q.maxAltFt)) p.set('maxAltFt', String(Math.round(q.maxAltFt)));
  if (q.corridorNm != null && Number.isFinite(q.corridorNm)) p.set('corridorNm', String(q.corridorNm));
  if (q.refresh) p.set('refresh', '1');
  const s = p.toString();
  return `flights/${encodeURIComponent(flightId)}/notams${s ? '?' + s : ''}`;
}

export async function fetchNotams(flightId: string, q: NotamQuery = {}): Promise<NotamBriefing> {
  const b = await request<NotamBriefing>('GET', notamsPath(flightId, q));
  rememberGet(notamsPath(flightId), b); // a refresh too: lastNotams answers with the newest
  return b;
}

/** The flight's last NOTAM briefing this session, to show while a new one loads. */
export function lastNotams(flightId: string): NotamBriefing | undefined {
  return peekGet<NotamBriefing>(notamsPath(flightId));
}

/** Epoch ms → '2026-11-15 06:00Z'. */
export function fmtNotamTime(ms: number): string {
  return Number.isFinite(new Date(ms).getTime()) ? fmtDateTimeMs(ms) : '?';
}

/** Validity, e.g. '15 Nov 06:00Z – 20 Nov 18:00Z EST' or '1 Mar 00:00Z – PERM'. */
export function notamValidity(n: Pick<Notam, 'from' | 'to' | 'estimated'>): string {
  return `${fmtNotamTime(n.from)} – ${n.to === null ? 'PERM' : fmtNotamTime(n.to) + (n.estimated ? ' EST' : '')}`;
}

/** One vertical limit (ft) as charts write it: 'SFC', '2500 ft', 'FL095', 'UNL'. */
export function fmtNotamLevel(ft: number, upper: boolean): string {
  if (!Number.isFinite(ft)) return '?';
  if (!upper && ft <= 0) return 'SFC';
  if (upper && ft >= 99900) return 'UNL';
  // the app-wide altitude format: feet up to the transition altitude, flight levels above it
  return fmtAltitude(ft, { unit: true });
}

/** Vertical limits: items F/G as written when given, else the Q-line, e.g. 'SFC – 2500 ft AMSL'. */
export function notamLimits(n: Pick<Notam, 'lowerFt' | 'upperFt' | 'lowerText' | 'upperText'>): string {
  if (n.lowerText || n.upperText)
    return `${n.lowerText ?? fmtNotamLevel(n.lowerFt, false)} – ${n.upperText ?? fmtNotamLevel(n.upperFt, true)}`;
  return `${fmtNotamLevel(n.lowerFt, false)} – ${fmtNotamLevel(n.upperFt, true)}`;
}

/** Decoded Q code: 'Temporary restricted area: activated', else the code itself. */
export function notamSubject(n: Pick<Notam, 'subject' | 'condition' | 'qcode'>): string {
  if (!n.subject) return n.qcode;
  return n.condition ? `${n.subject}: ${n.condition.charAt(0).toLowerCase()}${n.condition.slice(1)}` : n.subject;
}

/**
 * Only autorouter returned it: the owner's personal autorouter access is merged in on his own
 * flights, and these are the NOTAMs other pilots (who get only the shared feeds) would not see.
 */
export function onlyFromAutorouter(n: Pick<Notam, 'sources'>): boolean {
  return !!n.sources?.length && n.sources.every((s) => s === 'autorouter');
}

/** Where it applies: item A locations, e.g. 'LGAV' or 'LGGG'. */
export function notamWhere(n: Pick<Notam, 'itemA' | 'fir'>): string {
  return n.itemA.length ? n.itemA.join(' ') : n.fir;
}

/** The NOTAM has a Q-line circle that is not FIR-wide (radius under FIR_WIDE_NM). */
export function hasNotamArea(n: Pick<Notam, 'center' | 'radiusNm'>): boolean {
  return !!n.center && n.radiusNm !== null && n.radiusNm > 0 && n.radiusNm < FIR_WIDE_NM;
}

type Ring = [number, number][];
const lonLat = (p: { lat: number; lon: number }): [number, number] => [p.lon, p.lat];

/** A corridor of halfWidthNm either side of a line: a quadrilateral per segment and a disc per point. */
function corridorRings(points: { lat: number; lon: number }[], halfWidthNm: number): Ring[] {
  const w = Math.max(halfWidthNm, 0.2);
  const out: Ring[] = points.map((p) => circleRing(p, w, 24));
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i],
      b = points[i + 1];
    const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    const dx = (b.lon - a.lon) * k,
      dy = b.lat - a.lat;
    const len = Math.hypot(dx, dy) || 1;
    // the normal, w NM long, in degrees
    const nLat = ((dx / len) * w) / 60,
      nLon = ((-dy / len) * w) / 60 / k;
    const off = (p: typeof a, s: number): [number, number] => [p.lon + s * nLon, p.lat + s * nLat];
    out.push([off(a, 1), off(b, 1), off(b, -1), off(a, -1), off(a, 1)]);
  }
  return out;
}

function areaRings(a: NotamArea): Ring[] {
  if (a.kind === 'circle') return [circleRing(a.center, a.radiusNm, 48)];
  if (a.kind === 'line') return corridorRings(a.points, a.halfWidthNm);
  const ring = a.points.map(lonLat);
  return [[...ring, ring[0]]];
}

/**
 * The NOTAM's outline on the map as GeoJSON rings ([lon, lat], closed): the areas its text
 * describes, else its Q-line circle; [] when it has neither (FIR-wide, no position).
 */
export function notamRings(n: Pick<Notam, 'center' | 'radiusNm' | 'areas'>): Ring[] {
  if (n.areas?.length) return n.areas.flatMap(areaRings);
  return hasNotamArea(n) ? [circleRing(n.center!, n.radiusNm!)] : [];
}

/** Rough size of the outline, NM (√ of the bounding box area): smaller ones are picked first. */
export function ringsSizeNm(rings: Ring[]): number {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    no = -Infinity;
  for (const r of rings)
    for (const [lon, lat] of r) {
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      s = Math.min(s, lat);
      no = Math.max(no, lat);
    }
  if (!Number.isFinite(w)) return 0;
  return Math.sqrt((e - w) * 60 * Math.cos((((s + no) / 2) * Math.PI) / 180) * (no - s) * 60);
}

const R_NM = 3440.065;
/**
 * Circle of radius `radiusNm` around `center` as a closed GeoJSON ring of [lon, lat] (great-circle
 * destination points; `steps` segments).
 */
export function circleRing(center: { lat: number; lon: number }, radiusNm: number, steps = 64): [number, number][] {
  const toRad = Math.PI / 180;
  const lat1 = center.lat * toRad,
    lon1 = center.lon * toRad,
    d = radiusNm / R_NM;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const brg = ((i % steps) / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 =
      lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    out.push([+(lon2 / toRad).toFixed(6), +(lat2 / toRad).toFixed(6)]);
  }
  return out;
}

/** An aerodrome's NOTAM (item A is one aerodrome), as opposed to an airspace one (item A a FIR). */
export function isAerodromeNotam(n: Pick<Notam, 'itemA' | 'fir'>): boolean {
  return n.itemA.length === 1 && n.itemA[0] !== n.fir;
}

export interface NotamGroup {
  /** The aerodrome's ICAO, or null for the airspace group. */
  icao: string | null;
  notams: Notam[];
}

/**
 * NOTAMs by aerodrome, then the airspace ones. The aerodromes in `always` (the departure and the
 * destination) come first and are listed even with no NOTAM; the others follow in the list's order.
 */
export function groupNotams(list: Notam[], always: string[] = []): NotamGroup[] {
  const ads = new Map<string, Notam[]>();
  for (const icao of always) if (!ads.has(icao)) ads.set(icao, []);
  const air: Notam[] = [];
  for (const n of list) {
    if (!isAerodromeNotam(n)) air.push(n);
    else ads.set(n.itemA[0], [...(ads.get(n.itemA[0]) ?? []), n]);
  }
  const out: NotamGroup[] = [...ads].map(([icao, notams]) => ({ icao, notams }));
  return air.length ? [...out, { icao: null, notams: air }] : out;
}

/** The NOTAMs a list shows: relevant ones, or all of them with "show all". */
export function visibleNotams(b: NotamBriefing | null, showAll: boolean): Notam[] {
  if (!b) return [];
  return showAll ? b.notams : b.notams.filter((n) => n.relevant);
}

/**
 * The briefing's sources for its meta line: 'autorouter, International NOTAM feed, Notamify', and the ones that did not answer
 * ('Notamify timed out'). Briefings stored before there were several sources: their one.
 */
export function notamSourcesLine(b: Pick<NotamBriefing, 'source' | 'sources'>): { from: string; failed: string[] } {
  const list = b.sources ?? (b.source ? [{ id: b.source, label: b.source, status: 'ok' as const, message: null }] : []);
  return {
    from: list
      .filter((s) => s.status === 'ok')
      .map((s) => s.label)
      .join(', '),
    failed: list
      .filter((s) => s.status !== 'ok')
      .map((s) =>
        s.status === 'timeout' ? `${s.label} timed out` : `${s.label} failed${s.message ? ` (${s.message})` : ''}`,
      ),
  };
}
