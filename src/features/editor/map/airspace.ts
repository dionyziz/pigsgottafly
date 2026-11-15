// Airspace on the map: one shape for TMAs/MTMAs (ENR 2.1) and aerodrome CTRs/ATZs (AD 2.17), chart
// labels, which airspaces lie under the cursor, and which route legs enter each one at their planned
// altitude. Pure (no map), unit-tested.
import type { LatLon } from '../../../shared';
import type { RefAdAirspace, RefAirspace, RefAtcUnitRef } from '../../../shared/ref';
import { deg, distanceNm, midpoint, rad, R_NM } from '../../../calc';

/** Point at distance/bearing from a start (great circle), [lon, lat]. */
export function destination(lat: number, lon: number, bearingDeg: number, distNm: number): [number, number] {
  const d = distNm / R_NM, b = rad(bearingDeg), p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(l2), deg(p2)];
}

/** Closed ring approximating a circle, [lon, lat] (64 vertices). */
export function circleRing(lat: number, lon: number, radiusNm: number, n = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) ring.push(destination(lat, lon, (360 * i) / n, radiusNm));
  ring.push(ring[0]);
  return ring;
}

export type AirspaceType = 'TMA' | 'MTMA' | 'CTR' | 'ATZ';

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
  /** Lateral limits in words (AD 2.17 text, or a summary of the polygon). */
  lateral: string;
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
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

function closed(ring: [number, number][]): [number, number][] {
  if (!ring.length) return ring;
  const [f, l] = [ring[0], ring[ring.length - 1]];
  return f[0] === l[0] && f[1] === l[1] ? ring : [...ring, f];
}

export function fromTma(s: RefAirspace): AirspaceInfo {
  const ring = closed(s.polygon.map(([lat, lon]) => [lon, lat] as [number, number]));
  const type: AirspaceType = s.kind === 'MTMA' ? 'MTMA' : 'TMA';
  return {
    id: s.id, name: s.name, sector: s.sector, type, cls: s.class, lower: s.lower, upper: s.upper,
    lateral: `Polygon of ${ring.length - 1} points (${s.source || 'ENR 2.1'})`,
    notes: s.note ? [s.note] : [], units: s.units, remarks: '', source: s.source || 'ENR 2.1', ring, bbox: bboxOf(ring),
  };
}

export function fromAd(z: RefAdAirspace): AirspaceInfo | null {
  let ring: [number, number][];
  if (z.circle) ring = circleRing(z.circle.lat, z.circle.lon, z.circle.radiusNm, 72);
  else if (z.polygon && z.polygon.length >= 3) ring = closed(z.polygon.map(([lat, lon]) => [lon, lat] as [number, number]));
  else return null;
  const notes: string[] = [];
  if (z.lateralNote) notes.push(`${z.lateralNote} (drawn as the full circle).`);
  if (z.verticalNote) notes.push(z.verticalNote);
  if (z.afis) notes.push('Class D only while ATC is provided. AFIS at present: RMZ, class G (see remarks).');
  return {
    id: z.id, name: z.name, sector: '', type: z.kind, cls: z.class, lower: z.lower, upper: z.upper, lateral: z.lateral,
    notes, units: z.units, remarks: z.remarks, source: z.source, ring, bbox: bboxOf(ring),
  };
}

/** All airspace shown on the map: TMAs/MTMAs, then CTRs, then ATZs. */
export function airspaceInfos(tmas: RefAirspace[], ad: RefAdAirspace[] = []): AirspaceInfo[] {
  const out = tmas.filter((s) => s.polygon.length >= 3).map(fromTma);
  for (const z of ad) { const i = fromAd(z); if (i) out.push(i); }
  return out;
}

/** Point in a closed [lon, lat] ring (even-odd; planar, fine for these small shapes). */
export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function contains(a: AirspaceInfo, lon: number, lat: number): boolean {
  const [w, s, e, n] = a.bbox;
  return lon >= w && lon <= e && lat >= s && lat <= n && pointInRing(lon, lat, a.ring);
}

const ORDER: Record<AirspaceType, number> = { ATZ: 0, CTR: 1, TMA: 2, MTMA: 3 };

/** Airspaces containing a point, smallest first (ATZ, CTR, TMA, MTMA). */
export function airspacesAt(infos: AirspaceInfo[], lon: number, lat: number): AirspaceInfo[] {
  return infos.filter((a) => contains(a, lon, lat)).sort((x, y) => ORDER[x.type] - ORDER[y.type] || limitFt(x.upper).ft - limitFt(y.upper).ft);
}

export interface LegEntry {
  /** Leg index in the route (0 = first leg). */
  index: number;
  from: string;
  to: string;
  altFt: number;
  /**
   * inside: the planned altitude is within the vertical limits; above / below: the leg crosses the
   * lateral limits outside them; unknown: no altitude. AGL lower limits are compared as if the
   * ground were at sea level (said so in the popover).
   */
  vertical: 'inside' | 'above' | 'below' | 'unknown';
}

/** Points along the leg (every ~0.5 NM, at least the ends and the middle). */
function samples(a: LatLon, b: LatLon): LatLon[] {
  const n = Math.max(2, Math.min(400, Math.ceil(distanceNm(a, b) / 0.5)));
  const out: LatLon[] = [];
  // linear in lat/lon is within metres of the great circle over a VFR leg
  for (let i = 0; i <= n; i++) out.push({ lat: a.lat + ((b.lat - a.lat) * i) / n, lon: a.lon + ((b.lon - a.lon) * i) / n });
  return out;
}

/** Legs of the route whose track crosses the airspace's lateral limits, with the vertical relation. */
export function legsThrough(
  a: AirspaceInfo,
  legs: { from: LatLon & { name: string }; to: LatLon & { name: string } }[],
  altsFt: number[],
): LegEntry[] {
  const lo = limitFt(a.lower).ft, hi = limitFt(a.upper).ft;
  const out: LegEntry[] = [];
  legs.forEach((l, i) => {
    const m = midpoint(l.from, l.to);
    const [w, s, e, n] = a.bbox;
    const lw = Math.min(l.from.lon, l.to.lon, m.lon), le = Math.max(l.from.lon, l.to.lon, m.lon);
    const ls = Math.min(l.from.lat, l.to.lat, m.lat), ln = Math.max(l.from.lat, l.to.lat, m.lat);
    if (le < w || lw > e || ln < s || ls > n) return;
    if (!samples(l.from, l.to).some((p) => pointInRing(p.lon, p.lat, a.ring))) return;
    const alt = altsFt[i];
    const vertical: LegEntry['vertical'] = !isFinite(alt) ? 'unknown' : alt > hi ? 'above' : alt < lo ? 'below' : 'inside';
    out.push({ index: i, from: l.from.name, to: l.to.name, altFt: alt, vertical });
  });
  return out;
}
