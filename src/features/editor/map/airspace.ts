// TMAs/MTMAs (ENR 2.1), aerodrome CTRs/ATZs (AD 2.17) and the ENR 5 navigation-warning areas. Pure (no map).
import polygonClipping from 'polygon-clipping';

import { deg, R_NM, rad } from '../../../calc';
import { areasToRoute } from '../../../shared/notamAreas';
import type { RefAdAirspace, RefAirspace, RefArea, RefAtcUnitRef, RefFir } from '../../../shared/ref';
import type { LatLon } from '../../../shared/types';
import { FAR_NM } from './style';

/** Great circle; returns [lon, lat]. */
export function destination(lat: number, lon: number, bearingDeg: number, distNm: number): [number, number] {
  const d = distNm / R_NM,
    b = rad(bearingDeg),
    p1 = rad(lat),
    l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(l2), deg(p2)];
}

/** Closed ring, [lon, lat]. */
export function circleRing(lat: number, lon: number, radiusNm: number, n = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) ring.push(destination(lat, lon, (360 * i) / n, radiusNm));
  ring.push(ring[0]);
  return ring;
}

export type AirspaceType = 'TMA' | 'MTMA' | 'CTR' | 'ATZ' | RefArea['kind'];

export const AREA_TYPES: readonly AirspaceType[] = ['P', 'R', 'D', 'MIL', 'ACT'];
export const isArea = (t: AirspaceType) => AREA_TYPES.includes(t);

export interface AirspaceInfo {
  id: string;
  /** As published, e.g. 'ATHINAI TMA', 'DEKELIA TATOI MIL ATZ'. */
  name: string;
  /** Sector of a TMA split into several, e.g. 'North sector'. */
  sector: string;
  type: AirspaceType;
  /** As published, e.g. 'D', 'E (C above FL 195)'. */
  cls: string;
  lower: string;
  upper: string;
  /** Lateral limits in a few words (AD 2.17 text, or 'Circle, 1.5 NM radius' / 'Polygon, 6 points'). */
  lateral: string;
  /** ENR 5 areas: time of activity as printed ('H24', 'SR-SS', 'Activated by NOTAM', …). */
  activity?: string;
  /** ENR 5 areas: the short chart label ('LGD45', or the name of an ENR 5.3 area). */
  code?: string;
  /** Notes on the limits (FIR boundary clipping, a quadrant with another upper limit, AFIS). */
  notes: string[];
  units: RefAtcUnitRef[];
  remarks: string;
  source: string;
  /** Closed ring, [lon, lat]. */
  ring: [number, number][];
  /** [west, south, east, north] of the ring. */
  bbox: [number, number, number, number];
}

/** Class letter for a label: 'E (C above FL 195)' → 'E'. */
export function shortClass(cls: string): string {
  return cls.trim().split(/[\s(]/)[0] ?? '';
}

/** A vertical limit as printed on charts: 'SFC', '1000 ft AGL', '5000 ft', 'FL155', 'UNL'. */
export function fmtVLimit(s: string): string {
  const t = s.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!t) return '?';
  if (t === 'GND' || t === 'SFC') return t;
  const fl = t.match(/^FL ?(\d{2,3})/);
  if (fl) return `FL${fl[1].padStart(3, '0')}`;
  const ft = t.match(/^(\d+) ?FT( AGL| AMSL| MSL| ALT)?/);
  if (ft) return `${ft[1]} ft${ft[2] === ' AGL' ? ' AGL' : ''}`;
  return t;
}

/** Vertical extent for comparisons: feet (FL ×100, as an approximation of altitude), and whether AGL. */
export function limitFt(s: string): { ft: number; agl: boolean } {
  const t = s.trim().toUpperCase();
  if (!t || t === 'SFC' || t === 'GND') return { ft: 0, agl: true };
  if (t.startsWith('UNL')) return { ft: Infinity, agl: false };
  const fl = t.match(/^FL ?(\d{2,3})/);
  if (fl) return { ft: +fl[1] * 100, agl: false };
  const ft = t.match(/^(\d+) ?FT/);
  if (ft) return { ft: +ft[1], agl: /\bAGL\b/.test(t) };
  return { ft: NaN, agl: false };
}

/** "SFC – 5000 ft", "1000 ft AGL – FL155". */
export function fmtVertical(lower: string, upper: string): string {
  return `${fmtVLimit(lower)} – ${fmtVLimit(upper)}`;
}

/** Chart label, e.g. 'DEKELIA TATOI MIL ATZ · D · SFC – 5000 ft'. */
export function airspaceLabel(a: Pick<AirspaceInfo, 'name' | 'cls' | 'lower' | 'upper'>): string {
  const c = shortClass(a.cls);
  return [a.name, c, fmtVertical(a.lower, a.upper)].filter(Boolean).join(' · ');
}

function bboxOf(ring: [number, number][]): [number, number, number, number] {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const [x, y] of ring) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [w, s, e, n];
}

/** The AIP limits this airspace by the FIR boundary ("limited to East by ATHINAI - ISTANBUL FIR boundaries"). */
const FIR_LIMITED = /\bFIR\b/i;

export function firRing(fir: RefFir | undefined): [number, number][] | null {
  return fir && fir.boundary.length >= 3
    ? closed(fir.boundary.map(([lat, lon]) => [lon, lat] as [number, number]))
    : null;
}

/** The part of `ring` inside the FIR (its largest piece); the ring itself when nothing is left or no FIR. */
export function clipToFir(ring: [number, number][], fir: [number, number][] | null): [number, number][] {
  if (!fir) return ring;
  const pieces = polygonClipping.intersection([ring], [fir]);
  let best: [number, number][] | null = null;
  let bestArea = 0;
  for (const [outer] of pieces) {
    const a = Math.abs(ringArea(outer));
    if (a > bestArea) [best, bestArea] = [outer, a];
  }
  return best ? closed(best) : ring;
}

function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}

function closed(ring: [number, number][]): [number, number][] {
  if (!ring.length) return ring;
  const [f, l] = [ring[0], ring[ring.length - 1]];
  return f[0] === l[0] && f[1] === l[1] ? ring : [...ring, f];
}

export function fromTma(s: RefAirspace, fir: [number, number][] | null = null): AirspaceInfo {
  let ring = closed(s.polygon.map(([lat, lon]) => [lon, lat] as [number, number]));
  if (FIR_LIMITED.test(s.note ?? '')) ring = clipToFir(ring, fir);
  const type: AirspaceType = s.kind === 'MTMA' ? 'MTMA' : 'TMA';
  return {
    id: s.id,
    name: s.name,
    sector: s.sector,
    type,
    cls: s.class,
    lower: s.lower,
    upper: s.upper,
    lateral: `Polygon, ${ring.length - 1} points`,
    notes: s.note ? [s.note] : [],
    units: s.units,
    remarks: '',
    source: s.source || 'ENR 2.1',
    ring,
    bbox: bboxOf(ring),
  };
}

export function fromAd(z: RefAdAirspace, fir: [number, number][] | null = null): AirspaceInfo | null {
  let ring: [number, number][];
  if (z.circle) ring = circleRing(z.circle.lat, z.circle.lon, z.circle.radiusNm, 72);
  else if (z.polygon && z.polygon.length >= 3)
    ring = closed(z.polygon.map(([lat, lon]) => [lon, lat] as [number, number]));
  else return null;
  if (FIR_LIMITED.test(`${z.lateral} ${z.lateralNote ?? ''}`)) ring = clipToFir(ring, fir);
  const notes: string[] = [];
  if (z.lateralNote) notes.push(z.lateralNote);
  if (z.verticalNote) notes.push(z.verticalNote);
  if (z.afis) notes.push('Class D only while ATC is provided. AFIS at present: RMZ, class G (see remarks).');
  return {
    id: z.id,
    name: z.name,
    sector: '',
    type: z.kind,
    cls: z.class,
    lower: z.lower,
    upper: z.upper,
    lateral: z.lateral,
    notes,
    units: z.units,
    remarks: z.remarks,
    source: z.source,
    ring,
    bbox: bboxOf(ring),
  };
}

const fmtNm = (nm: number) => (nm >= 1 ? String(+nm.toFixed(1)) : nm.toFixed(2).replace(/0$/, ''));

/** An ENR 5 area; null when its lateral limits could not be drawn. */
export function fromArea(a: RefArea): AirspaceInfo | null {
  let ring: [number, number][];
  let lateral: string;
  if (a.circle) {
    ring = circleRing(a.circle.lat, a.circle.lon, a.circle.radiusNm, 64);
    lateral = `Circle, ${fmtNm(a.circle.radiusNm)} NM radius`;
  } else if (a.polygon && a.polygon.length >= 3) {
    ring = closed(a.polygon.map(([lat, lon]) => [lon, lat] as [number, number]));
    lateral = `Polygon, ${ring.length - 1} points`;
  } else return null;
  return {
    id: a.id,
    name: a.kind === 'ACT' ? a.name || a.id : a.name ? `${a.id} ${a.name}` : a.id,
    sector: '',
    type: a.kind,
    cls: '',
    lower: a.lower,
    upper: a.upper,
    lateral,
    activity: a.activity,
    code: a.kind === 'ACT' ? a.name || a.id : a.id,
    notes: a.geometryNote ? [a.geometryNote] : [],
    units: [],
    remarks: a.remarks,
    source: a.source,
    ring,
    bbox: bboxOf(ring),
  };
}

/** All airspace shown on the map: TMAs/MTMAs, then CTRs and ATZs, then the ENR 5 areas. */
export function airspaceInfos(
  tmas: RefAirspace[],
  ad: RefAdAirspace[] = [],
  areas: RefArea[] = [],
  fir?: RefFir,
): AirspaceInfo[] {
  const firR = firRing(fir);
  const out = tmas.filter((s) => s.polygon.length >= 3).map((s) => fromTma(s, firR));
  for (const z of ad) {
    const i = fromAd(z, firR);
    if (i) out.push(i);
  }
  for (const a of areas) {
    const i = fromArea(a);
    if (i) out.push(i);
  }
  return out;
}

/** Point in a closed [lon, lat] ring (even-odd; planar, fine for these small shapes). */
export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function contains(a: AirspaceInfo, lon: number, lat: number): boolean {
  const [w, s, e, n] = a.bbox;
  return lon >= w && lon <= e && lat >= s && lat <= n && pointInRing(lon, lat, a.ring);
}

const ORDER: Record<AirspaceType, number> = { P: 0, R: 1, D: 2, ATZ: 3, CTR: 4, ACT: 5, MIL: 6, TMA: 7, MTMA: 8 };

/** Airspaces containing a point: prohibited / restricted / danger areas first, then ATZ, CTR, other areas, TMA, MTMA. */
export function airspacesAt(infos: AirspaceInfo[], lon: number, lat: number): AirspaceInfo[] {
  return infos
    .filter((a) => contains(a, lon, lat))
    .sort((x, y) => ORDER[x.type] - ORDER[y.type] || limitFt(x.upper).ft - limitFt(y.upper).ft);
}

/** Further than FAR_NM from a route of two or more points (the map draws it faint). */
export function farFromRoute(a: Pick<AirspaceInfo, 'ring'>, route: LatLon[]): boolean {
  return (
    route.length >= 2 &&
    areasToRoute([{ kind: 'polygon', points: a.ring.map(([lon, lat]) => ({ lat, lon })) }], route).dist > FAR_NM
  );
}
