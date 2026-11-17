// VFR reporting points printed as text in the eAIP → tools/vfr_points.json (input of tools/build_vfr.py).
//
//   npx tsx tools/parse_vfr.ts <dir with pdftotext -layout files> [more dirs…] tools/vfr_points.json
//
// Sources (pdftotext -layout output, tools/update_aip.sh step 2):
//   LG_AD_2_LGxx_VFR_en.txt, LG_AD_1_6_N_LGxx_VFR_en.txt   the VFR route charts. Most print their reporting
//       points on the chart image only (transcribed in tools/vfr_charts/<ICAO>.json); LGAV, LGIR and LGTG
//       also have a text table, one or two points per line:
//         AGIOS GEORGIOS    37° 29’ 31” N    023° 53’ 55” E          PIKAD     38° 03’ 41” N   022° 41’ 52” E
//         ABEAM AGIOS                    35°21’48’’ N            25°47’21’’ E
//         KALAMO                          381731N 0235149E
//   LG_AD_3_N_<name>_en.txt   heliports: the compulsory reporting points of AD 3.N.21, with an altitude column:
//         DAMARI                         1000FT                               375323N 0235027E
//
// Every chart is listed in the output (with no points when it has no text table) so tools/build_vfr.py knows
// its AIP reference. The parser warns when a table has more coordinates than points read, when a point lies
// outside the FIR's latitude/longitude box, and when a name is printed twice with different positions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TablePoint {
  name: string;
  lat: number;
  lon: number;
}

export interface VfrTable {
  /** The AIP reference of the page: 'AD 2-LGAV-VFR', 'AD 1.6.29-LGTG-VFR', 'AD 3.19'. */
  ref: string;
  points: TablePoint[];
}

const MIN = String.raw`['’′\`]`;
const SEC = String.raw`(?:["”″]|''|’’)`;
const DMS_LAT = String.raw`(\d{2,3})\s*[°º]\s*(\d{2})\s*${MIN}\s*(\d{2}(?:[.,]\d+)?)\s*${SEC}?\s*N`;
const DMS_LON = String.raw`(\d{2,3})\s*[°º]\s*(\d{2})\s*${MIN}\s*(\d{2}(?:[.,]\d+)?)\s*${SEC}?\s*E`;
const DMS_PAIR = new RegExp(DMS_LAT + String.raw`[\s,\-–]*` + DMS_LON, 'g');
const COMPACT_PAIR = /(\d{6}(?:[.,]\d+)?)\s?N[\s,\-–]*(\d{7}(?:[.,]\d+)?)\s?E/g;
/** Latitudes (one per table row) to compare with the points read. */
const ANY_LAT = new RegExp(String.raw`${DMS_LAT}|\b\d{6}(?:[.,]\d+)?\s?N\b`, 'g');

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const num = (s: string) => +s.replace(',', '.');

function compactDeg(digits: string, degLen: number): number {
  const d = digits.replace(',', '.');
  return +d.slice(0, degLen) + +d.slice(degLen, degLen + 2) / 60 + +d.slice(degLen + 2) / 3600;
}

/** 'EGN (EGN)' → 'EGN', 'ELEFSINA (LGEL)' → 'ELEFSINA', 'VILIZA (West Test Flight area)' → 'VILIZA'. */
export function cleanName(raw: string): string {
  let n = raw.replace(/[*]/g, ' ');
  while (/\([^()]*\)\s*$/.test(n)) n = n.replace(/\s*\([^()]*\)\s*$/, '');
  return n
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-.\s]+|[-.\s]+$/g, '');
}

/** The name before a coordinate pair: the nearest column that is not an altitude ('1000FT', 'Outbound 2500FT – …'). */
function nameBefore(text: string): string | null {
  const cells = text
    .split(/\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => c && /^[A-ZΑ-Ω]/.test(c) && !/\d+\s*FT\b|^(Outbound|Inbound)\b/i.test(c));
  if (!cells.length) return null;
  const n = cleanName(cells[cells.length - 1]);
  return /^[A-Z][A-Z0-9 ./'-]*$/.test(n) ? n : null;
}

const nmBetween = (a: TablePoint, b: TablePoint) => {
  const dLat = (a.lat - b.lat) * 60,
    dLon = (a.lon - b.lon) * 60 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
};

/**
 * The reporting points of a page's text (a whole VFR chart text, or the lines of a heliport's reporting-point
 * table). `warn` gets each row it could not read and each position outside 34–42 N, 19–30.5 E.
 */
export function parseTable(text: string, ref: string, warn: (m: string) => void = () => {}): TablePoint[] {
  // Greek capital Ν / Ε printed for N / E
  const lines = text.replace(/Ν/g, 'N').replace(/Ε/g, 'E').split('\n');
  const out: TablePoint[] = [];
  let rows = 0;
  for (const line of lines) {
    rows += (line.match(ANY_LAT) ?? []).length;
    const pairs: { at: number; end: number; lat: number; lon: number }[] = [];
    for (const m of line.matchAll(DMS_PAIR))
      pairs.push({
        at: m.index,
        end: m.index + m[0].length,
        lat: +m[1] + +m[2] / 60 + num(m[3]) / 3600,
        lon: +m[4] + +m[5] / 60 + num(m[6]) / 3600,
      });
    for (const m of line.matchAll(COMPACT_PAIR))
      if (!pairs.some((p) => m.index >= p.at && m.index < p.end))
        pairs.push({ at: m.index, end: m.index + m[0].length, lat: compactDeg(m[1], 2), lon: compactDeg(m[2], 3) });
    pairs.sort((a, b) => a.at - b.at);
    let from = 0;
    for (const p of pairs) {
      const name = nameBefore(line.slice(from, p.at));
      from = p.end;
      if (!name) {
        warn(`${ref}: coordinates without a name: ${line.trim()}`);
        continue;
      }
      const pt = { name, lat: r5(p.lat), lon: r5(p.lon) };
      if (!(pt.lat > 34 && pt.lat < 42 && pt.lon > 19 && pt.lon < 30.5)) {
        warn(`${ref} ${name}: ${pt.lat}, ${pt.lon} is outside the FIR`);
        continue;
      }
      const dup = out.find((q) => q.name === name);
      if (dup) {
        if (nmBetween(dup, pt) > 0.5) warn(`${ref} ${name}: printed twice, ${nmBetween(dup, pt).toFixed(1)} NM apart`);
        continue;
      }
      out.push(pt);
    }
  }
  const read = lines.reduce((n, l) => n + [...l.matchAll(DMS_PAIR)].length + [...l.matchAll(COMPACT_PAIR)].length, 0);
  if (rows > read) warn(`${ref}: the table lists ${rows} positions, ${read} read as points`);
  return out;
}

/** The lines of a heliport's AD 3.N.21 reporting-point table ('REPORTING POINTS … COORDINATES' up to the next paragraph). */
export function heliportTable(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let on = false;
  for (const l of lines) {
    if (/REPORTING POINTS\b.*COORDINATES/.test(l)) on = true;
    else if (on && /^\s*\d+(\.\d+){2,}\s/.test(l)) on = false;
    else if (on) out.push(l);
  }
  return out.join('\n');
}

/** 'LG_AD_2_LGKV_VFR_en.txt' → ['LGKV', 'AD 2-LGKV-VFR']; 'LG_AD_3_19_ATTIKI-KOROPI-PROFARTA_en.txt' → ['AD 3.19', 'AD 3.19']. */
export function sourceOf(file: string): [key: string, ref: string] | null {
  let m: RegExpMatchArray | null;
  if ((m = file.match(/^LG_AD_2_(LG[A-Z]{2})_VFR_en\.txt$/))) return [m[1], `AD 2-${m[1]}-VFR`];
  if ((m = file.match(/^LG_AD_1_6_(\d+)_(LG[A-Z]{2})_VFR_en\.txt$/))) return [m[2], `AD 1.6.${m[1]}-${m[2]}-VFR`];
  if ((m = file.match(/^LG_AD_3_(\d+)_[A-Z0-9-]+_en\.txt$/))) return [`AD 3.${m[1]}`, `AD 3.${m[1]}`];
  return null;
}

export function parseDirs(dirs: string[], warn: (m: string) => void): Record<string, VfrTable> {
  const out: Record<string, VfrTable> = {};
  for (const dir of dirs)
    for (const f of fs.readdirSync(dir).sort()) {
      const src = sourceOf(f);
      if (!src || out[src[0]]) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const heliport = src[0].startsWith('AD 3.');
      const body = heliport ? heliportTable(text) : text;
      if (heliport && !body.trim()) continue; // no reporting points published
      out[src[0]] = { ref: src[1], points: parseTable(body, src[1], warn) };
    }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const outFile = args.pop();
  if (!outFile || !args.length) {
    console.error('usage: tsx tools/parse_vfr.ts <dir with *_VFR_en.txt / LG_AD_3_*_en.txt> [more dirs] <out.json>');
    process.exit(2);
  }
  const tables = parseDirs(args, (m) => console.error('warning:', m));
  for (const [k, t] of Object.entries(tables)) console.error(`${k} (${t.ref}): ${t.points.length} points`);
  fs.writeFileSync(outFile, JSON.stringify(tables, null, 1) + '\n');
}
