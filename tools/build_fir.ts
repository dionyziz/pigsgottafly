// Builds src/data/ref/fir.json: the ATHINAI FIR / HELLAS UIR (LGGG) boundary and the ATHINAI CTA /
// MAKEDONIA CTA dividing line, for the map.
//
//   npx tsx tools/build_fir.ts <countries-10m.json>
//
// <countries-10m.json> is Natural Earth admin-0 countries at 1:10m (public domain) as TopoJSON, from the
// npm package world-atlas@2.0.2 (`npm pack world-atlas@2.0.2`). TopoJSON shares the arcs between
// neighbours, so the Greek land borders are the arcs Greece shares with Albania, North Macedonia,
// Bulgaria and Türkiye.
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

interface Topo {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { countries: { geometries: { properties: { name: string }; arcs: unknown }[] } };
}

function landBorders(file: string): Record<string, LonLat[]> {
  const topo = JSON.parse(fs.readFileSync(file, 'utf8')) as Topo;
  const [sx, sy] = topo.transform.scale,
    [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((a) => {
    let x = 0,
      y = 0;
    return a.map(([dx, dy]): LonLat => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
  const arcSet = (name: string) => {
    const g = topo.objects.countries.geometries.find((c) => c.properties.name === name);
    if (!g) throw new Error('no ' + name);
    const s = new Set<number>();
    const walk = (o: unknown): void => {
      if (typeof o === 'number') s.add(o >= 0 ? o : ~o);
      else if (Array.isArray(o)) o.forEach(walk);
    };
    walk(g.arcs);
    return s;
  };
  const gr = arcSet('Greece');
  const out: Record<string, LonLat[]> = {};
  for (const n of ['Albania', 'Macedonia', 'Bulgaria', 'Turkey']) {
    const shared = [...arcSet(n)].filter((i) => gr.has(i));
    if (shared.length !== 1) throw new Error(`${n}: ${shared.length} shared arcs`);
    out[n] = arcs[shared[0]];
  }
  return out;
}

/** Douglas-Peucker in degrees (the borders at about 100 m). */
function simplify(p: LonLat[], tol: number): LonLat[] {
  if (p.length < 3) return p;
  const [a, b] = [p[0], p[p.length - 1]];
  let best = -1,
    bd = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-12;
    const d = Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > bd) {
      bd = d;
      best = i;
    }
  }
  if (bd <= tol) return [a, b];
  return [...simplify(p.slice(0, best + 1), tol).slice(0, -1), ...simplify(p.slice(best), tol)];
}

const near = (a: LonLat, b: LonLat) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
/** The arc oriented to start at `from`. */
function from(arc: LonLat[], start: LonLat): LonLat[] {
  if (near(arc[0], start)) return arc;
  if (near(arc[arc.length - 1], start)) return [...arc].reverse();
  throw new Error('arcs do not join');
}

const src = process.argv[2];
if (!src) {
  console.error('usage: tsx tools/build_fir.ts <countries-10m.json>');
  process.exit(1);
}
const b = landBorders(src);
// Albania's arc starts on the coast (south-west) in Natural Earth; orient each to run west → east
const al = b.Albania[0][1] < b.Albania[b.Albania.length - 1][1] ? b.Albania : [...b.Albania].reverse();
const mk = from(b.Macedonia, al[al.length - 1]);
const bg = from(b.Bulgaria, mk[mk.length - 1]);
const tr = from(b.Turkey, bg[bg.length - 1]);
const land = [...al, ...mk.slice(1), ...bg.slice(1), ...tr.slice(1)];
const ring = [...SEA_AIP, ...CORFU_STRAIT, ...simplify(land, 0.001), ...AEGEAN, SEA_AIP[0]];
const r6 = (v: number) => +v.toFixed(5);
const toLatLon = (p: LonLat[]) => p.map(([lon, lat]) => [r6(lat), r6(lon)]);
const out = {
  id: 'LGGG',
  name: 'ATHINAI FIR',
  boundary: toLatLon(ring),
  divider: { label: 'ATHINAI | MAKEDONIA', line: toLatLon(DIVIDER) },
  source: 'ENR 2.1',
};
const file = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'data', 'ref', 'fir.json');
fs.writeFileSync(file, JSON.stringify(out) + '\n');
console.log(`${file}: ${ring.length} boundary points (land ${land.length} → simplified)`);
