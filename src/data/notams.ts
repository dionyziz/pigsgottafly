// NOTAM briefing on the client: GET /api/flights/:id/notams (the server fetches, decodes and
// assesses relevance, see api/_lib/notams.ts) and pure helpers that turn a Notam into the texts
// the editor panel, the map and the briefing export show, plus the map geometry of its Q-line
// circle. No DOM here; unit-tested in tests/unit/data/notams.test.ts.
import type { Notam, NotamBriefing } from '../shared/briefing';
import { fmtAltitude, fmtDateTimeMs } from '../shared/format';
import { request } from './api';

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

export function fetchNotams(flightId: string, q: NotamQuery = {}): Promise<NotamBriefing> {
  return request<NotamBriefing>('GET', notamsPath(flightId, q));
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
  if (n.lowerText || n.upperText) return `${n.lowerText ?? fmtNotamLevel(n.lowerFt, false)} – ${n.upperText ?? fmtNotamLevel(n.upperFt, true)}`;
  return `${fmtNotamLevel(n.lowerFt, false)} – ${fmtNotamLevel(n.upperFt, true)}`;
}

/** Decoded Q code: 'Temporary restricted area: activated', else the code itself. */
export function notamSubject(n: Pick<Notam, 'subject' | 'condition' | 'qcode'>): string {
  if (!n.subject) return n.qcode;
  return n.condition ? `${n.subject}: ${n.condition.charAt(0).toLowerCase()}${n.condition.slice(1)}` : n.subject;
}

/** Where it applies: item A locations, e.g. 'LGAV' or 'LGGG'. */
export function notamWhere(n: Pick<Notam, 'itemA' | 'fir'>): string {
  return n.itemA.length ? n.itemA.join(' ') : n.fir;
}

/** The NOTAM's area on the map: a Q-line circle that is not FIR-wide (radius < 999 NM). */
export function hasNotamArea(n: Pick<Notam, 'center' | 'radiusNm'>): boolean {
  return !!n.center && n.radiusNm !== null && n.radiusNm > 0 && n.radiusNm < 999;
}

const R_NM = 3440.065;
/**
 * Circle of radius `radiusNm` around `center` as a closed GeoJSON ring of [lon, lat] (great-circle
 * destination points; `steps` segments).
 */
export function circleRing(center: { lat: number; lon: number }, radiusNm: number, steps = 64): [number, number][] {
  const toRad = Math.PI / 180;
  const lat1 = center.lat * toRad, lon1 = center.lon * toRad, d = radiusNm / R_NM;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const brg = ((i % steps) / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    out.push([+(lon2 / toRad).toFixed(6), +(lat2 / toRad).toFixed(6)]);
  }
  return out;
}

/** The NOTAMs a list shows: relevant ones, or all of them with "show all". */
export function visibleNotams(b: NotamBriefing | null, showAll: boolean): Notam[] {
  if (!b) return [];
  return showAll ? b.notams : b.notams.filter((n) => n.relevant);
}

/** One-line hover text for a NOTAM: 'A1234/26 · Restricted area: activated · 15 Nov 06:00Z – … · SFC – 2500 ft'. */
export function notamTip(n: Notam): string {
  return `${n.key} · ${notamSubject(n)} · ${notamValidity(n)} · ${notamLimits(n)}`;
}
