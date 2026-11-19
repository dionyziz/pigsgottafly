// The areas a NOTAM's text (item E) describes, read automatically, and their distance to a route.
//
//   - Coordinates: DDMMSS[.ss]N DDDMMSS[.ss]E (also DDMMN DDDMME, ',' decimals, '-' between them).
//   - Coordinates written one after the other (separated by spaces, dashes, commas) form a polygon
//     ("AREA: A - B - C - A"); followed by "x NM EITHER SIDE" they form a corridor along a line.
//   - "x NM RADIUS CENTERED ON <coordinate>" (or "… RADIUS x NM") is a circle; NM, KM and M.
//   - A lone coordinate that is not a circle's centre (an obstacle, a crane) is not an area.
//   - A shape reaching well outside the Q-line circle is a misread and dropped.
// Distances use a flat projection (NM east/north of the route's latitude), plenty at Greek scales.
import type { LatLon } from './types.js';

export type NotamArea =
  | { kind: 'polygon'; points: LatLon[] }
  | { kind: 'circle'; center: LatLon; radiusNm: number }
  | { kind: 'line'; points: LatLon[]; halfWidthNm: number };

const COORD =
  /(\d{2})(\d{2})(\d{2}(?:[.,]\d+)?)?\s*([NS])[\s-]*(\d{2,3})(\d{2})(\d{2}(?:[.,]\d+)?)?\s*([EW])(?![A-Z])/g;
const JOIN = /^[\s\-–,;:/]*$/;
const NUM = String.raw`(\d+(?:[.,]\d+)?)\s*(NM|KM|M)\b`;
const RADIUS_BEFORE = new RegExp(`${NUM}\\s*RADIUS`);
const RADIUS_AFTER = new RegExp(`RADIUS\\s*(?:OF\\s*)?:?\\s*${NUM}`);
const EITHER_SIDE = new RegExp(`^[\\s.,]*${NUM}\\s*EITHER\\s+SIDE`);
/** Q-line circles this large are the whole FIR, not an area. */
export const FIR_WIDE_NM = 300;

const num = (s: string | undefined) => (s ? Number(s.replace(',', '.')) : 0);
function toNm(v: string, unit: string): number {
  const x = num(v);
  return unit === 'NM' ? x : unit === 'KM' ? x / 1.852 : x / 1852;
}

interface Hit {
  p: LatLon;
  start: number;
  end: number;
}

function coords(text: string): Hit[] {
  const out: Hit[] = [];
  for (const m of text.matchAll(COORD)) {
    const [la, lm, ls, ns, lo, om, os, ew] = m.slice(1);
    if (+lm >= 60 || num(ls) >= 60 || +om >= 60 || num(os) >= 60 || +la > 90 || +lo > 180) continue;
    const lat = (+la + +lm / 60 + num(ls) / 3600) * (ns === 'S' ? -1 : 1);
    const lon = (+lo + +om / 60 + num(os) / 3600) * (ew === 'W' ? -1 : 1);
    out.push({ p: { lat: +lat.toFixed(6), lon: +lon.toFixed(6) }, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const same = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;

/** The areas item E describes (empty when it describes none). */
export function parseNotamAreas(
  text: string,
  q: { center: LatLon | null; radiusNm: number | null } = { center: null, radiusNm: null },
): NotamArea[] {
  const t = text.toUpperCase();
  const hits = coords(t);
  const areas: NotamArea[] = [];
  let i = 0;
  while (i < hits.length) {
    const h = hits[i];
    const before = t.slice(Math.max(i ? hits[i - 1].end : 0, h.start - 100), h.start);
    if (/CENT(?:ER|RE)(?:ED|D)?\b/.test(before)) {
      const after = t.slice(h.end, Math.min(hits[i + 1]?.start ?? t.length, h.end + 60));
      const r =
        RADIUS_BEFORE.exec(before) ??
        RADIUS_AFTER.exec(before) ??
        RADIUS_AFTER.exec(after) ??
        RADIUS_BEFORE.exec(after);
      if (r) areas.push({ kind: 'circle', center: h.p, radiusNm: toNm(r[1], r[2]) });
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < hits.length && JOIN.test(t.slice(hits[j].end, hits[j + 1].start))) j++;
    const pts = hits.slice(i, j + 1).map((x) => x.p);
    const side = EITHER_SIDE.exec(t.slice(hits[j].end, hits[j].end + 40));
    if (side && pts.length >= 2) areas.push({ kind: 'line', points: pts, halfWidthNm: toNm(side[1], side[2]) });
    else if (pts.length >= 3) {
      if (same(pts[0], pts[pts.length - 1])) pts.pop();
      if (pts.length >= 3) areas.push({ kind: 'polygon', points: pts });
    }
    i = j + 1;
  }
  if (!q.center || q.radiusNm === null || q.radiusNm >= FIR_WIDE_NM) return areas;
  const limit = q.radiusNm * 1.5 + 10;
  const c = q.center;
  return areas.filter((a) =>
    a.kind === 'circle' ? flatDist(c, a.center) - a.radiusNm <= limit : a.points.every((p) => flatDist(c, p) <= limit),
  );
}

// --- flat geometry (NM) --------------------------------------------------------------------------

type XY = [number, number];
const proj = (p: LatLon, cosLat: number): XY => [p.lon * 60 * cosLat, p.lat * 60];
const flatDist = (a: LatLon, b: LatLon) => {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * 60 * k, (a.lat - b.lat) * 60);
};

function pointSeg(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segSeg(a: XY, b: XY, c: XY, d: XY): number {
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
}

function inside(p: XY, ring: XY[]): boolean {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

/**
 * Distance (NM) from the areas to the route (0 when the route enters one) and the nearest leg
 * (0-based; null for a single-point route). Infinity without areas or route.
 */
export function areasToRoute(areas: NotamArea[], route: LatLon[]): { dist: number; leg: number | null } {
  if (!areas.length || !route.length) return { dist: Infinity, leg: null };
  const k = Math.cos((route[0].lat * Math.PI) / 180);
  const r = route.map((p) => proj(p, k));
  const legs: [XY, XY][] = r.length > 1 ? r.slice(1).map((b, i) => [r[i], b]) : [[r[0], r[0]]];
  let best = { dist: Infinity, leg: 0 };
  const take = (d: number, leg: number) => {
    if (d < best.dist) best = { dist: Math.max(0, d), leg };
  };
  for (const a of areas) {
    legs.forEach(([p, q], leg) => {
      if (a.kind === 'circle') return take(pointSeg(proj(a.center, k), p, q) - a.radiusNm, leg);
      const pts = a.points.map((x) => proj(x, k));
      const edges: [XY, XY][] = pts.slice(1).map((b, i) => [pts[i], b]);
      if (a.kind === 'polygon') {
        edges.push([pts[pts.length - 1], pts[0]]);
        if (inside(p, pts) || inside(q, pts)) return take(0, leg);
      }
      const w = a.kind === 'line' ? a.halfWidthNm : 0;
      for (const [e, f] of edges) take(segSeg(p, q, e, f) - w, leg);
    });
  }
  return { dist: best.dist, leg: r.length > 1 ? best.leg : null };
}
