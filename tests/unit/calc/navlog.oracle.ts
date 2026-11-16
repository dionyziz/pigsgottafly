// Independent reference for the navlog rules, written from the specification (the MD4.2 paper
// workflow) and NOT importing src/: a TypeScript port of tests/e2e/oracle.mjs (vector-method course
// and midpoint, atan2 haversine, card from the swing report's steer column). Used by navlog.test.ts.
const R = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180,
  deg = (r: number) => (r * 180) / Math.PI;
export const n360 = (d: number) => ((d % 360) + 360) % 360;
export interface P {
  lat: number;
  lon: number;
}

export function haversineNm(a: P, b: P): number {
  const x =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
const vec = (p: P) => [
  Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)),
  Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)),
  Math.sin(rad(p.lat)),
];
/** Initial course by projecting the chord on the local north/east plane. */
export function course(a: P, b: P): number {
  const A = vec(a),
    B = vec(b);
  const north = [
    -Math.sin(rad(a.lat)) * Math.cos(rad(a.lon)),
    -Math.sin(rad(a.lat)) * Math.sin(rad(a.lon)),
    Math.cos(rad(a.lat)),
  ];
  const east = [-Math.sin(rad(a.lon)), Math.cos(rad(a.lon)), 0];
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  return n360(deg(Math.atan2(dot(d, east), dot(d, north))));
}
export function midpoint(a: P, b: P): P {
  const A = vec(a),
    B = vec(b),
    M = [A[0] + B[0], A[1] + B[1], A[2] + B[2]];
  return { lat: deg(Math.atan2(M[2], Math.hypot(M[0], M[1]))), lon: deg(Math.atan2(M[1], M[0])) };
}
/** Swing reports list the compass heading to steer for 000, 030, … 330. */
export const STEER = {
  'SX-ASV': [2, 31, 62, 92, 121, 148, 181, 211, 239, 268, 298, 329],
  'SX-ASG': [1, 32, 62, 93, 122, 152, 181, 212, 241, 272, 303, 331],
};
export function dev(steer: number[], mh: number): number {
  const h = n360(mh);
  const i = Math.floor(h / 30),
    f = (h - 30 * i) / 30;
  const d = (k: number) => {
    let x = steer[k % 12] - (k % 12) * 30;
    if (x > 180) x -= 360;
    if (x < -180) x += 360;
    return x;
  };
  return d(i) * (1 - f) + d(i + 1) * f;
}
export interface OracleLeg {
  a: P;
  b: P;
  tas: number;
  wd: number;
  ws: number;
  variation: number;
}
export interface OracleRow {
  tc: number;
  dist: number;
  wca: number;
  th: number;
  mh: number;
  dev: number | null;
  ch: number | null;
  gs: number;
  min: number;
  ete: number;
  fuel: number;
  rem: number;
  ate: number;
}

/** Expected written cells per leg (+ totals), from the paper rules. */
export function navlog(legs: OracleLeg[], { steer = null as number[] | null, flow = 30, extra = 4 } = {}) {
  const rows: OracleRow[] = legs.map((L) => {
    // TC at the leg midpoint (as read off a VFR chart): the course from the midpoint to the end.
    const tc = Math.round(course(midpoint(L.a, L.b), L.b));
    const dist = Math.round(haversineNm(L.a, L.b));
    const awa = rad(L.wd - tc);
    const wcaExact = deg(Math.asin((L.ws * Math.sin(awa)) / L.tas));
    const wca = Math.round(wcaExact);
    const th = n360(tc + wca);
    const mh = n360(th - Math.round(L.variation));
    const dv = steer ? Math.round(dev(steer, mh)) : null;
    const ch = steer ? n360(mh + (dv as number)) : null;
    const gs = Math.round(L.tas * Math.cos(rad(wcaExact)) - L.ws * Math.cos(awa));
    const min = (dist / gs) * 60;
    return {
      tc,
      dist,
      wca,
      th,
      mh,
      dev: dv,
      ch,
      gs,
      min,
      ete: Math.round(min),
      fuel: Math.ceil(min * (flow / 60) - 1e-9),
      rem: 0,
      ate: 0,
    };
  });
  rows.forEach((r, i) => {
    r.rem = rows.slice(i + 1).reduce((s, x) => s + x.dist, 0);
    r.ate = rows.slice(i + 1).reduce((s, x) => s + x.ete, 0);
  });
  const trip = rows.reduce((s, r) => s + r.fuel, 0);
  return {
    rows,
    totals: {
      dist: rows.reduce((s, r) => s + r.dist, 0),
      ete: rows.reduce((s, r) => s + r.ete, 0),
      trip,
      fuel: trip + extra,
    },
  };
}
