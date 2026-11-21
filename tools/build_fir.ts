// Builds src/data/ref/fir.json: the ATHINAI FIR / HELLAS UIR (LGGG) boundary and the ATHINAI CTA /
// MAKEDONIA CTA dividing line, for the map.
//
//   npx tsx tools/build_fir.ts <greek-borders.json>
//
// Over land the FIR follows the Greek national frontier. It is taken from OpenStreetMap, the source of the
// base map's own borders, so the two lines coincide: the ways shared by the admin_level=2 relations of
// Greece (192307) and of each neighbour, Albania (53292), North Macedonia (53293), Bulgaria (186382) and
// Türkiye (174737; the Evros down to its mouth). <greek-borders.json> is the answer of the Overpass API
// (data © OpenStreetMap contributors, ODbL) to this query (the lines marked `>`):
//
//   > [out:json][timeout:300][bbox:39.5,19.8,42.0,26.8];
//   > rel(192307);way(r)->.gr;
//   > rel(53292);way(r)->.al;
//   > rel(53293);way(r)->.mk;
//   > rel(186382);way(r)->.bg;
//   > rel(174737);way(r)->.tr;
//   > make neighbour name="Albania";out;
//   > way.gr.al;out tags geom;
//   > make neighbour name="North Macedonia";out;
//   > way.gr.mk;out tags geom;
//   > make neighbour name="Bulgaria";out;
//   > way.gr.bg;out tags geom;
//   > make neighbour name="Türkiye";out;
//   > way.gr.tr;out tags geom;
//
// fetched with (about 1 MB; not committed):
//
//   sed -n 's|^//   > ||p' tools/build_fir.ts > /tmp/q.overpassql
//   curl -A pigsgottafly https://overpass-api.de/api/interpreter --data-urlencode data@/tmp/q.overpassql \
//     -o /tmp/greek-borders.json
//
// The `neighbour` markers say whose border the ways after them are. Ways tagged maritime=yes (territorial
// waters) are left out: at sea the AIP lines below apply. fir.json was last built from the OSM data of
// 2026-11-16T18:39:05Z; the land borders are thinned by Douglas-Peucker at TOLERANCE_M.
//
// Sources
//   AIP Greece ENR 2.1.1 / 2.1.2: 3605N 03000E - 3330N 03000E - 3400N 02710E - 3400N 02410E -
//     3420N 02335E - 3630N 01900E - 4025N 01900E, then along the seaward end of the Greek-Albanian
//     frontier and the lines determining the Northern and Eastern frontier of Greece and the Western
//     frontier of Türkiye, to 3605N 03000E.
//   AIP Greece ENR 2.1.3 / 2.1.3.1 (ATHINAI CTA, Kerkira upper sector): 402630N 0204730E - 393915N
//     0213700E - 374836N 0232724E - 375055N 0241807E - 375558N 0243920E - 381449N 0261010E, then the
//     FIR boundary.
//   Approximations (no published coordinates): the Corfu strait from 4025N 01900E to the seaward end
//     of the Greek-Albanian frontier (CORFU_STRAIT), and the line between the Greek islands and the
//     Turkish coast from the Evros mouth to 3605N 03000E (AEGEAN: about midway in the straits, about
//     6 NM off the Turkish coast in the open sea, passing 381449N 0261010E).
import fs from 'node:fs';
import path from 'node:path';

type LonLat = [number, number];

const dms = (s: string): number => {
  // 3605N / 0204730E / 402630N
  const m = /^(\d+)([NSEW])$/.exec(s.replace('Ν', 'N').replace('Ε', 'E'));
  if (!m) throw new Error('bad coordinate ' + s);
  const d = m[1];
  const deg =
    d.length <= 3
      ? +d
      : d.length <= 5
        ? +d.slice(0, d.length - 2) + +d.slice(-2) / 60
        : +d.slice(0, d.length - 4) + +d.slice(-4, -2) / 60 + +d.slice(-2) / 3600;
  return m[2] === 'S' || m[2] === 'W' ? -deg : deg;
};
const pt = (lat: string, lon: string): LonLat => [dms(lon), dms(lat)];

/** ENR 2.1.2, 3605N 03000E … 4025N 01900E. */
const SEA_AIP: LonLat[] = [
  pt('3605N', '03000E'),
  pt('3330N', '03000E'),
  pt('3400N', '02710E'),
  pt('3400N', '02410E'),
  pt('3420N', '02335E'),
  pt('3630N', '01900E'),
  pt('4025N', '01900E'),
];
/** 4025N 01900E to the seaward end of the Greek-Albanian frontier, north of Corfu and through the strait (approximate). */
const CORFU_STRAIT: LonLat[] = [
  [19.86, 39.87],
  [19.95, 39.8],
  [19.985, 39.74],
];
/** Evros mouth to 3605N 03000E between the Greek islands and the Turkish coast (approximate). */
const AEGEAN: LonLat[] = [
  [25.9, 40.58],
  [25.72, 40.33],
  [25.58, 40.15],
  [25.58, 39.95],
  [25.75, 39.8],
  [25.9, 39.65],
  [25.95, 39.5],
  [26.2, 39.43],
  [26.5, 39.33],
  [26.7, 39.15],
  [26.72, 39.0],
  [26.45, 38.82],
  [26.34, 38.62],
  [26.32, 38.46],
  [26.22, 38.32],
  pt('381449N', '0261010E'),
  [26.22, 38.12],
  [26.6, 38.08],
  [26.9, 37.92],
  [27.02, 37.76],
  [27.06, 37.68],
  [27.1, 37.55],
  [27.18, 37.36],
  [27.2, 37.15],
  [27.24, 37.0],
  [27.37, 36.95],
  [27.4, 36.84],
  [27.3, 36.72],
  [27.42, 36.61],
  [27.7, 36.66],
  [27.95, 36.68],
  [28.02, 36.56],
  [28.25, 36.55],
  [28.55, 36.56],
  [28.9, 36.55],
  [29.08, 36.45],
  [29.24, 36.22],
  [29.45, 36.16],
  [29.57, 36.175],
  [29.66, 36.11],
];
/** ENR 2.1.3.1: the ATHINAI / MAKEDONIA line (west to east; both ends on the FIR boundary). */
const DIVIDER: LonLat[] = [
  pt('402630N', '0204730E'),
  pt('393915N', '0213700E'),
  pt('374836N', '0232724E'),
  pt('375055N', '0241807E'),
  pt('375558N', '0243920E'),
  pt('381449N', '0261010E'),
];

/** The neighbours along the frontier, west to east, as the query's markers name them. */
const NEIGHBOURS = ['Albania', 'North Macedonia', 'Bulgaria', 'Türkiye'] as const;
type Neighbour = (typeof NEIGHBOURS)[number];
/** Douglas-Peucker tolerance for the land borders, metres. */
const TOLERANCE_M = 25;
/** Aerodromes near every part of the boundary, which must lie inside it. */
const MUST_CONTAIN = ['LGTT', 'LGKR', 'LGAL', 'LGSM', 'LGRP', 'LGKO'];

interface Overpass {
  osm3s?: { timestamp_osm_base?: string };
  elements: (
    | { type: 'neighbour'; tags: { name: string } }
    | { type: 'way'; id: number; tags?: Record<string, string>; geometry: { lat: number; lon: number }[] }
  )[];
}

/** The land frontier with each neighbour: the shared ways (not the maritime ones), stitched into one line. */
function landBorders(file: string): { borders: Map<Neighbour, LonLat[]>; timestamp: string } {
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as Overpass;
  const ways = new Map<Neighbour, LonLat[][]>(NEIGHBOURS.map((n) => [n, []]));
  let current: LonLat[][] | undefined;
  for (const e of json.elements) {
    if (e.type === 'neighbour') {
      current = ways.get(e.tags.name as Neighbour);
      if (!current) throw new Error('unknown neighbour ' + e.tags.name);
    } else {
      if (!current) throw new Error(`way ${e.id} before any neighbour marker`);
      if (e.tags?.maritime === 'yes') continue;
      current.push(e.geometry.map(({ lat, lon }): LonLat => [lon, lat]));
    }
  }
  const borders = new Map<Neighbour, LonLat[]>();
  for (const [n, w] of ways) {
    if (!w.length) throw new Error(`${n}: no shared ways`);
    borders.set(n, stitch(w, n));
  }
  return { borders, timestamp: json.osm3s?.timestamp_osm_base ?? 'unknown' };
}

const same = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];
const reversed = (p: LonLat[]) => [...p].reverse();
const at = ([lon, lat]: LonLat) => `${lat}N ${lon}E`;

/** Joins ways (in any order and direction) end to end into one line; throws on a gap or a branch. */
function stitch(ways: LonLat[][], name: string): LonLat[] {
  const left = [...ways];
  let line = left.pop()!;
  while (left.length) {
    const head = line[0],
      tail = line[line.length - 1];
    const i = left.findIndex((w) => [w[0], w[w.length - 1]].some((p) => same(p, head) || same(p, tail)));
    if (i < 0) throw new Error(`${name}: ${left.length} ways do not join the line ${at(head)} … ${at(tail)}`);
    const [w] = left.splice(i, 1);
    if (same(w[0], tail)) line = [...line, ...w.slice(1)];
    else if (same(w[w.length - 1], tail)) line = [...line, ...reversed(w).slice(1)];
    else if (same(w[w.length - 1], head)) line = [...w, ...line.slice(1)];
    else line = [...reversed(w), ...line.slice(1)];
  }
  return line;
}

function from(line: LonLat[], start: LonLat, name: string): LonLat[] {
  if (same(line[0], start)) return line;
  if (same(line[line.length - 1], start)) return reversed(line);
  throw new Error(`${name} does not start at ${at(start)}`);
}

/** Metres per degree around 40N (equirectangular; good to a fraction of a percent along the frontier). */
const M_LAT = 111_045,
  M_LON = M_LAT * Math.cos((40 * Math.PI) / 180);

function simplify(p: LonLat[], tolM: number): LonLat[] {
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const ax = p[i][0] * M_LON,
      ay = p[i][1] * M_LAT;
    const dx = p[j][0] * M_LON - ax,
      dy = p[j][1] * M_LAT - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1,
      bd = 0;
    for (let k = i + 1; k < j; k++) {
      const px = p[k][0] * M_LON - ax,
        py = p[k][1] * M_LAT - ay;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > bd) [bd, best] = [d, k];
    }
    if (bd > tolM) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return p.filter((_, k) => keep[k]);
}

/** Whether segments ab and cd meet (crossing or touching). */
function meet(a: LonLat, b: LonLat, c: LonLat, d: LonLat): boolean {
  const side = (p: LonLat, q: LonLat, r: LonLat) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const within = (p: LonLat, q: LonLat, r: LonLat) =>
    Math.min(p[0], q[0]) <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) &&
    Math.min(p[1], q[1]) <= r[1] &&
    r[1] <= Math.max(p[1], q[1]);
  const [s1, s2, s3, s4] = [side(a, b, c), side(a, b, d), side(c, d, a), side(c, d, b)];
  if (s1 !== s2 && s3 !== s4) return true;
  return (!s1 && within(a, b, c)) || (!s2 && within(a, b, d)) || (!s3 && within(c, d, a)) || (!s4 && within(c, d, b));
}

/** Throws unless the ring is closed, has no repeated point and no two non-adjacent edges meet. */
function checkSimple(ring: LonLat[]): void {
  if (!same(ring[0], ring[ring.length - 1])) throw new Error('the ring is not closed');
  const n = ring.length - 1; // edges
  for (let i = 0; i < n; i++) {
    const [a, b] = [ring[i], ring[i + 1]];
    if (same(a, b)) throw new Error(`repeated point ${at(a)}`);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the last edge meets the first at the closing point
      const [c, d] = [ring[j], ring[j + 1]];
      if (
        Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
        Math.min(c[0], d[0]) > Math.max(a[0], b[0]) ||
        Math.max(c[1], d[1]) < Math.min(a[1], b[1]) ||
        Math.min(c[1], d[1]) > Math.max(a[1], b[1])
      )
        continue;
      if (meet(a, b, c, d)) throw new Error(`the ring crosses itself: edges at ${at(a)} and ${at(c)}`);
    }
  }
}

function inside([x, y]: LonLat, ring: LonLat[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const src = process.argv[2];
if (!src) {
  console.error('usage: tsx tools/build_fir.ts <greek-borders.json>');
  process.exit(1);
}
const { borders, timestamp } = landBorders(src);
const [AL, MK, BG, TR] = NEIGHBOURS.map((n) => borders.get(n)!);
// Albania's border runs from the coast (south) to the tripoint with North Macedonia; each next one
// starts where the previous one ends, and Türkiye's ends at the Evros mouth
const mkEnds = [MK[0], MK[MK.length - 1]];
const al = mkEnds.some((p) => same(p, AL[AL.length - 1])) ? AL : reversed(AL);
const mk = from(MK, al[al.length - 1], 'North Macedonia');
const bg = from(BG, mk[mk.length - 1], 'Bulgaria');
const tr = from(TR, bg[bg.length - 1], 'Türkiye');
const land = [...al, ...mk.slice(1), ...bg.slice(1), ...tr.slice(1)];
const r5 = (v: number) => +v.toFixed(5);
// rounded as written, so the checks see the ring the map gets
const ring = [...SEA_AIP, ...CORFU_STRAIT, ...simplify(land, TOLERANCE_M), ...AEGEAN, SEA_AIP[0]]
  .map(([lon, lat]): LonLat => [r5(lon), r5(lat)])
  .filter((p, i, a) => i === 0 || !same(p, a[i - 1]));
checkSimple(ring);
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const aerodromes = JSON.parse(fs.readFileSync(path.join(root, 'src/data/ref/aerodromes.json'), 'utf8')) as {
  id: string;
  lat: number;
  lon: number;
}[];
for (const id of MUST_CONTAIN) {
  const a = aerodromes.find((x) => x.id === id);
  if (!a || !inside([a.lon, a.lat], ring)) throw new Error(`${id} is not inside the FIR`);
}
const toLatLon = (p: LonLat[]) => p.map(([lon, lat]) => [r5(lat), r5(lon)]);
const out = {
  id: 'LGGG',
  name: 'ATHINAI FIR',
  boundary: toLatLon(ring),
  divider: { label: 'ATHINAI | MAKEDONIA', line: toLatLon(DIVIDER) },
  source: 'ENR 2.1',
};
const file = path.join(root, 'src', 'data', 'ref', 'fir.json');
fs.writeFileSync(file, JSON.stringify(out) + '\n');
console.log(
  `${file}: ${ring.length} boundary points (OSM ${timestamp}: land ${land.length} → ${TOLERANCE_M} m tolerance)`,
);
