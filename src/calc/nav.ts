// Pure navigation helpers, ported from js/nav.js (unit-tested in tests/unit/calc/nav.test.ts).
// Geodesy on a sphere, wind triangle, compass deviation, NOAA sunset, the paper-sheet rounding rules.
import type { LatLon } from '../shared/types.js';

/** Mean Earth radius in NM. */
export const R_NM = 3440.065;
export const rad = (d: number): number => (d * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;
/** Normalise to [0, 360). */
export const norm360 = (d: number): number => ((d % 360) + 360) % 360;
/** Normalise to (-180, 180]. */
export const norm180 = (d: number): number => {
  d = norm360(d);
  return d > 180 ? d - 360 : d;
};

// ---------- geodesy ----------

/** Great-circle distance, NM (haversine). */
export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat),
    dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle true course a → b, degrees [0, 360). */
export function trueCourse(a: LatLon, b: LatLon): number {
  const la1 = rad(a.lat),
    la2 = rad(b.lat),
    dl = rad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return norm360(deg(Math.atan2(y, x)));
}

/** Great-circle midpoint. */
export function midpoint(a: LatLon, b: LatLon): LatLon {
  const la1 = rad(a.lat),
    lo1 = rad(a.lon),
    la2 = rad(b.lat),
    dl = rad(b.lon - a.lon);
  const bx = Math.cos(la2) * Math.cos(dl),
    by = Math.cos(la2) * Math.sin(dl);
  const la = Math.atan2(Math.sin(la1) + Math.sin(la2), Math.sqrt((Math.cos(la1) + bx) ** 2 + by ** 2));
  const lo = lo1 + Math.atan2(by, Math.cos(la1) + bx);
  return { lat: deg(la), lon: deg(lo) };
}

/** Local flat projection (NM) around a reference latitude — adequate for leg-scale geometry. */
function proj(p: LatLon, lat0: number): { x: number; y: number } {
  return { x: p.lon * 60 * Math.cos(rad(lat0)), y: p.lat * 60 };
}

/** Distance from p to segment a–b, NM, and the position t ∈ [0,1] of the closest point. */
export function pointSegDistNm(p: LatLon, a: LatLon, b: LatLon): { dist: number; t: number } {
  const lat0 = (a.lat + b.lat + p.lat) / 3;
  const P = proj(p, lat0),
    A = proj(a, lat0),
    B = proj(b, lat0);
  const dx = B.x - A.x,
    dy = B.y - A.y,
    L2 = dx * dx + dy * dy;
  let t = L2 ? ((P.x - A.x) * dx + (P.y - A.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { dist: Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy)), t };
}

/** poly: [[lat, lon], …] */
export function pointInPolygon(p: LatLon, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0],
      xi = poly[i][1],
      yj = poly[j][0],
      xj = poly[j][1];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segIntersect(p1: LatLon, p2: LatLon, p3: LatLon, p4: LatLon): boolean {
  const d = (a: LatLon, b: LatLon, c: LatLon) => (c.lon - a.lon) * (b.lat - a.lat) - (b.lon - a.lon) * (c.lat - a.lat);
  const d1 = d(p3, p4, p1),
    d2 = d(p3, p4, p2),
    d3 = d(p1, p2, p3),
    d4 = d(p1, p2, p4);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

/** True if segment a–b starts/ends inside the polygon or crosses its boundary. */
export function segmentEntersPolygon(a: LatLon, b: LatLon, poly: [number, number][]): boolean {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segIntersect(a, b, { lat: poly[j][0], lon: poly[j][1] }, { lat: poly[i][0], lon: poly[i][1] })) return true;
  }
  return false;
}

/** "1000 FT AGL" → 1000 (surface taken as MSL: conservative), "FL 155" → 15500, "UNL" → Infinity. */
export function parseLevelFt(s: string | null | undefined): number {
  if (!s) return NaN;
  s = String(s).toUpperCase().trim();
  if (s === 'UNL') return Infinity;
  if (s === 'SFC' || s === 'GND') return 0;
  let m = s.match(/^FL\s*(\d+)/);
  if (m) return +m[1] * 100;
  m = s.match(/^(\d+)\s*FT/);
  if (m) return +m[1];
  return NaN;
}

// ---------- wind triangle ----------

/**
 * tc: true course; tas kt; wd: direction the wind blows FROM (true); ws kt.
 * Returns the wind correction angle (−L +R) and ground speed, or null if the crosswind exceeds TAS.
 */
export function windTriangle(tc: number, tas: number, wd: number, ws: number): { wca: number; gs: number } | null {
  if (!(tas > 0)) return null;
  if (!isFinite(wd) || !isFinite(ws) || ws === 0) return { wca: 0, gs: tas };
  const a = rad(wd - tc);
  const x = (ws * Math.sin(a)) / tas;
  if (Math.abs(x) > 1) return null;
  const wca = deg(Math.asin(x));
  const gs = tas * Math.cos(rad(wca)) - ws * Math.cos(a);
  return { wca, gs };
}

// ---------- compass deviation ----------

/**
 * card: [[for, steer], …] with for = magnetic heading wanted, steer = compass heading to fly.
 * Returns the deviation (steer − for) at magnetic heading mh, linearly interpolated, or null.
 */
export function deviation(card: [number, number][] | null | undefined, mh: number): number | null {
  if (!card || !card.length) return null;
  const pts = card.map(([f, s]) => [norm360(f), norm180(s - f)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const h = norm360(mh);
  for (let i = 0; i < pts.length; i++) {
    const [f0, d0] = pts[i];
    const [f1r, d1] = pts[(i + 1) % pts.length];
    const f1 = i + 1 < pts.length ? f1r : f1r + 360;
    const hh = h < f0 ? h + 360 : h;
    if (hh >= f0 && hh <= f1) return d0 + ((d1 - d0) * (hh - f0)) / (f1 - f0);
  }
  return pts[0][1];
}

// ---------- sunset (NOAA) ----------

/** Minutes after 00:00 UTC of dateStr (YYYY-MM-DD) at which the sun sets, or null (polar). */
export function sunsetUtcMinutes(dateStr: string, lat: number, lon: number): number | null {
  return sunEventUtcMinutes(dateStr, lat, lon, false);
}

/** Minutes after 00:00 UTC of dateStr (YYYY-MM-DD) at which the sun rises, or null (polar). */
export function sunriseUtcMinutes(dateStr: string, lat: number, lon: number): number | null {
  return sunEventUtcMinutes(dateStr, lat, lon, true);
}

function sunEventUtcMinutes(dateStr: string, lat: number, lon: number, rise: boolean): number | null {
  const [Y, M, D] = dateStr.split('-').map(Number);
  const jd = Date.UTC(Y, M - 1, D) / 86400000 + 2440587.5;
  function calc(t: number) {
    const L0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032));
    const Mn = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const C =
      Math.sin(rad(Mn)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
      Math.sin(rad(2 * Mn)) * (0.019993 - 0.000101 * t) +
      Math.sin(rad(3 * Mn)) * 0.000289;
    const trueLong = L0 + C;
    const omega = 125.04 - 1934.136 * t;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
    const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(rad(omega));
    const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
    const y = Math.tan(rad(eps / 2)) ** 2;
    const eqt =
      4 *
      deg(
        y * Math.sin(2 * rad(L0)) -
          2 * e * Math.sin(rad(Mn)) +
          4 * e * y * Math.sin(rad(Mn)) * Math.cos(2 * rad(L0)) -
          0.5 * y * y * Math.sin(4 * rad(L0)) -
          1.25 * e * e * Math.sin(2 * rad(Mn)),
      );
    return { decl, eqt };
  }
  let minutes = 720 - 4 * lon;
  for (let k = 0; k < 3; k++) {
    const t = (jd + minutes / 1440 - 2451545) / 36525;
    const { decl, eqt } = calc(t);
    const cosH =
      Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
    if (cosH < -1 || cosH > 1) return null;
    const H = deg(Math.acos(cosH)) * (rise ? -1 : 1);
    minutes = 720 - 4 * (lon - H) - eqt;
  }
  return minutes;
}

// ---------- formatting ----------

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** Heading as 3 digits, 0 → '360'. '' for non-finite. */
export const fmtHdg = (d: number): string => (isFinite(d) ? pad(norm360(Math.round(d)) || 360, 3) : '');
/** Signed integer with a U+2212 minus ('+5', '−3', '0'). */
export const fmtSigned = (d: number): string =>
  isFinite(d) ? (Math.round(d) > 0 ? '+' : Math.round(d) < 0 ? '−' : '') + Math.abs(Math.round(d)) : '';
/** Minutes → 'h:mm' (machine-ish layouts only; people read fmtDuration). */
export const fmtHmm = (min: number): string => {
  if (!isFinite(min)) return '';
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
};
// fmtDuration ('1h44'), fmtAltitude ('3000' / 'FL065'), fmtClock ('HH:MM') live in src/shared/format.ts.
export { fmtAltitude, fmtClock, fmtDuration, TRANSITION_ALTITUDE_FT } from '../shared/format.js';
/** '0930', '09:30', '09:30Z' → minutes after midnight; NaN if invalid. */
export function parseClock(s: string | null | undefined): number {
  const m = String(s || '')
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2}):?(\d{2})\s*Z?$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return NaN;
  return +m[1] * 60 + +m[2];
}
/** 'h:mm' or plain minutes → minutes; NaN if invalid. */
export function parseHmm(s: string | null | undefined): number {
  s = String(s || '').trim();
  let m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^\d+$/);
  if (m) return +s;
  return NaN;
}

// ---------- the nav log computation (paper-sheet rounding) ----------

export interface ComputeLegInput {
  /** True course, degrees. */
  tc: number;
  /** NM */
  dist: number;
  tas: number;
  /** Wind FROM, true. */
  wd: number;
  ws: number;
  /** Deviation typed by hand when there is no card. */
  devManual?: number;
}
export interface ComputeLegOptions {
  /** Magnetic variation, E positive. */
  variation: number;
  card: [number, number][] | null;
  fuelPerHour: number;
}
/** Every value as written on the MD4.2 sheet (rounded); later columns derive from written values. */
export interface ComputedLeg {
  tc: number;
  dist: number;
  wca?: number;
  th?: number;
  /** Sheet convention "−E +W": 5°E → −5. */
  var?: number;
  mh?: number;
  dev?: number;
  ch?: number;
  gs?: number;
  minutesExact?: number;
  ete?: number;
  /** Litres, rounded UP. */
  fuel?: number;
  /** Filled by summarize(): distance and time remaining after this leg. */
  distRem?: number;
  ateRem?: number;
}

/**
 * One navlog row. Rounding follows the paper workflow: each written value is rounded, and later
 * columns are derived from the written (rounded) values so the sheet can be checked by hand.
 */
export function computeLeg(leg: ComputeLegInput, opts: ComputeLegOptions): ComputedLeg {
  const out: ComputedLeg = { tc: Math.round(leg.tc), dist: Math.round(leg.dist) };
  const wt = windTriangle(out.tc, leg.tas, leg.wd, leg.ws);
  if (!wt) return out;
  out.wca = Math.round(wt.wca);
  out.th = norm360(out.tc + out.wca);
  out.var = -Math.round(opts.variation);
  out.mh = norm360(out.th + out.var);
  if (opts.card) {
    out.dev = Math.round(deviation(opts.card, out.mh) as number);
    out.ch = norm360(out.mh + out.dev);
  } else if (leg.devManual !== undefined && isFinite(leg.devManual)) {
    out.dev = Math.round(leg.devManual);
    out.ch = norm360(out.mh + out.dev);
  }
  out.gs = Math.round(wt.gs);
  if (out.gs > 0) {
    out.minutesExact = (out.dist / out.gs) * 60;
    out.ete = Math.round(out.minutesExact);
    out.fuel = Math.ceil(out.minutesExact * (opts.fuelPerHour / 60) - 1e-9);
  }
  return out;
}

export interface NavTotals {
  dist: number;
  ete: number;
  tripFuel: number;
  /** tripFuel + extraFuel */
  fuel: number;
}

/** Fills distRem/ateRem on each row (mutates) and returns the totals. */
export function summarize(rows: ComputedLeg[], extraFuel: number): NavTotals {
  const n = rows.length;
  let remD = 0,
    remT = 0;
  for (let i = n - 1; i >= 0; i--) {
    rows[i].distRem = remD;
    rows[i].ateRem = remT;
    remD += rows[i].dist || 0;
    remT += rows[i].ete || 0;
  }
  const tripFuel = rows.reduce((s, r) => s + (r.fuel || 0), 0);
  return {
    dist: rows.reduce((s, r) => s + (r.dist || 0), 0),
    ete: rows.reduce((s, r) => s + (r.ete || 0), 0),
    tripFuel,
    fuel: tripFuel + extraFuel,
  };
}
