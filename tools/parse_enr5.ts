// AIP Greece ENR 5 navigation-warning areas → RefArea[] (tools/enr5_areas.json).
//
//   npx tsx tools/parse_enr5.ts <dir with LG_ENR_5_*_en.txt> tools/enr5_areas.json
//
// Input is `pdftotext -layout` output of the eAIP PDFs:
//   ENR 5.1  prohibited (LGPn), restricted (LGRn), danger (LGDn) and controlled firing (LGC101) areas,
//   ENR 5.2  military training areas (TSAs),
//   ENR 5.3.1 local flying areas (named, no designators).
// (ENR 5.5 only says "See ENR 5.3.1"; ENR 5.3.2 lists radiosonde launch sites, which are points, not areas.)
//
// The tables are read column by column. Column positions differ per page, so each page's header lines
// ("Upper limit", "(time of activity", …) fix them. A line is cut into chunks at runs of 2+ spaces and each
// chunk goes to the column its first character falls in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RefArea } from '../src/shared/ref.js';

type Kind = RefArea['kind'];
type LatLon = [number, number];

// ---------------------------------------------------------------- coordinates

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Coordinates as printed: DDMM[SS[.ss]]N DDDMM[SS[.ss]]E; the AIP sometimes types Greek Ν/Ε. */
const COORD_SRC = String.raw`(\d{4}(?:\d{2}(?:\.\d+)?)?)\s?([NSΝ])\s*(\d{5}(?:\d{2}(?:\.\d+)?)?)\s?([EWΕ])`;

function dms(digits: string, degLen: number): number {
  const [int, frac = ''] = digits.split('.');
  const d = +int.slice(0, degLen);
  const m = +int.slice(degLen, degLen + 2);
  const s = int.length > degLen + 2 ? +(int.slice(degLen + 2) + (frac ? '.' + frac : '')) : 0;
  return d + m / 60 + s / 3600;
}

/** '375820N 0234333E' → [37.972222, 23.725833]; null if it is not a coordinate pair. */
export function parseCoord(s: string): LatLon | null {
  const m = new RegExp(`^\\s*${COORD_SRC}\\s*$`).exec(s);
  if (!m) return null;
  const lat = dms(m[1], 2) * (m[2] === 'S' ? -1 : 1);
  const lon = dms(m[3], 3) * (m[4] === 'W' ? -1 : 1);
  return [r6(lat), r6(lon)];
}

function findCoords(text: string): { at: number; end: number; p: LatLon }[] {
  const out: { at: number; end: number; p: LatLon }[] = [];
  for (const m of text.matchAll(new RegExp(COORD_SRC, 'g'))) {
    out.push({ at: m.index, end: m.index + m[0].length, p: parseCoord(m[0])! });
  }
  return out;
}

const NM_PER_DEG = 60;

/** Point at `distNm` on true bearing `brgDeg` from `c` (local flat-earth approximation; fine for a few NM). */
function offset(c: LatLon, brgDeg: number, distNm: number): LatLon {
  const b = (brgDeg * Math.PI) / 180;
  const dLat = (distNm * Math.cos(b)) / NM_PER_DEG;
  const dLon = (distNm * Math.sin(b)) / (NM_PER_DEG * Math.cos((c[0] * Math.PI) / 180));
  return [r6(c[0] + dLat), r6(c[1] + dLon)];
}

function bearing(c: LatLon, p: LatLon): number {
  const dy = p[0] - c[0];
  const dx = (p[1] - c[1]) * Math.cos((c[0] * Math.PI) / 180);
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Arc from bearing a to bearing b around c, clockwise or not, end points excluded, about every 10°. */
function arc(c: LatLon, r: number, a: number, b: number, clockwise: boolean): LatLon[] {
  const sweep = clockwise ? (b - a + 360) % 360 : -((a - b + 360) % 360);
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / 10));
  const pts: LatLon[] = [];
  for (let i = 1; i < n; i++) pts.push(offset(c, a + (sweep * i) / n, r));
  return pts;
}

// ---------------------------------------------------------------- lateral limits → geometry

export interface Geometry {
  circle?: RefArea['circle'];
  polygon?: [number, number][];
  geometryNote?: string;
}

function radiusNm(value: string, unit: string): number {
  const v = parseFloat(value);
  const nm = unit === 'NM' ? v : unit === 'KM' ? (v * 1000) / 1852 : v / 1852;
  return Math.round(nm * 10000) / 10000;
}

/**
 * Shape of a lateral-limits text: 'A circle, 700 M radius centered on 375820N 0234333E.' or a list of
 * points 'p1 - p2 - … - p1.'. Only the first shape counts (LGD93/94 go on to describe a target zone inside).
 * An open list is closed. 'excluding X ATZ' is reported, not cut out.
 */
export function parseLateral(text: string): Geometry {
  const coords = findCoords(text);
  const g: Geometry = {};
  const notes: string[] = [];
  if (coords.length === 0) return g;
  const before = text.slice(0, coords[0].at);
  if (/circle/i.test(before)) {
    const rm = /([\d.]+)\s*(NM|KM|M)\b/.exec(before);
    if (rm) g.circle = { lat: coords[0].p[0], lon: coords[0].p[1], radiusNm: radiusNm(rm[1], rm[2]) };
  } else {
    const ring: LatLon[] = [coords[0].p];
    let closed = false;
    for (let i = 1; i < coords.length; i++) {
      const gap = text.slice(coords[i - 1].end, coords[i].at);
      if (!/^[\s\-–.,]*$/.test(gap)) break;
      ring.push(coords[i].p);
      if (coords[i].p[0] === ring[0][0] && coords[i].p[1] === ring[0][1]) {
        closed = true;
        break;
      }
    }
    if (!closed) ring.push(ring[0]);
    if (ring.length >= 4) g.polygon = ring;
  }
  const ex = /excluding\s+(.+?)\s*(?:\.|$)/i.exec(text);
  if (ex) notes.push(`${ex[1]} is excluded from the area but not cut out of the shape`);
  if (notes.length) g.geometryNote = notes.join('; ');
  return g;
}

/**
 * LGD67 NEA PERAMOS: 'A circle, 2 NM radius centered on 380300N 0232400E, which is divided into two
 * circular segments by a string between the points 380127N 0232222E and 380355N 0232618E.'
 * Sub-areas: 'The greater/smaller circular segment than the half circle.' The arc is written out as points.
 */
function circularSegment(parentLateral: string, subLateral: string): Geometry | null {
  const which = /\b(greater|smaller) circular segment/i.exec(subLateral);
  if (!which) return null;
  const parent = parseLateral(parentLateral);
  const chord = /between the points\s+(.+?)\s+and\s+(.+?)\s*\./i.exec(parentLateral);
  if (!parent.circle || !chord) return null;
  const p1 = parseCoord(chord[1]);
  const p2 = parseCoord(chord[2]);
  if (!p1 || !p2) return null;
  const c: LatLon = [parent.circle.lat, parent.circle.lon];
  const a = bearing(c, p1);
  const b = bearing(c, p2);
  const cwSweep = (b - a + 360) % 360;
  const greater = which[1].toLowerCase() === 'greater';
  // Clockwise from p1 to p2 is the greater arc when it sweeps more than 180°.
  const clockwise = greater ? cwSweep > 180 : cwSweep <= 180;
  const ring: LatLon[] = [p1, ...arc(c, parent.circle.radiusNm, a, b, clockwise), p2, p1];
  return { polygon: ring };
}

// ---------------------------------------------------------------- text helpers

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Vertical limit as printed, whitespace normalised: 'FL400' → 'FL 400', '1000FT ALT' → '1000 FT ALT', 'GND / MSL' → 'GND/MSL'. */
export function normLimit(s: string): string {
  return norm(s)
    .replace(/^FL\s*(\d+)/, 'FL $1')
    .replace(/^(\d+)\s*FT\b/, '$1 FT')
    .replace(/\s*\/\s*/g, '/');
}

const LIMIT_RE = /^(UNL|GND|MSL|SFC|GND ?\/ ?MSL|FL ?\d{2,3}|\d+ ?FT( (ALT|AMSL|MSL|AGL|SFC))?)$/;

/** First line of a time-of-activity run. */
const ACT_START =
  /^(H24|HJ\b|HN\b|SR\b|SR-|Daily|DLY|MON\b|MON:|TUE\b|WED\b|THU\b|FRI\b|SAT\b|SUN\b|Every\b|Activated\b|AMC [Mm]anageable|Not activated|FL \d+:|This area is used)/;

const DANGLING =
  /\b(and|or|by|of|to|the|with|from|between|for|as|on|at|in|than|under|when|should|shall|be|may|is|are|which|that|until|till|except|unless|while|a|an|FRI)$/;

/** Does `next` continue the sentence on `prev` (a wrapped line), rather than start a new line? */
function isWrap(prev: string, next: string): boolean {
  if (/^[a-z]\)/.test(next)) return false; // list item a) b) …
  if (/^[a-z]/.test(next)) return !/[.:]$/.test(prev) || /^(to|and|or)\b/.test(next);
  if (/[,\-–/]$/.test(prev) || DANGLING.test(prev)) return true;
  if (/^\d/.test(next) && /\b(FRI|SUN|and)$|-$/.test(prev)) return true;
  // A lone last word: 'MTMA.', 'APP.', 'HOL.', 'SR-1000.', 'Aeroclub.' (but not 'H24' + 'Navy.').
  if (!/[.;)]$/.test(prev) && /^[A-Z0-9][A-Z0-9-]*\.$/.test(next)) return true;
  if (!/[.:;)]$/.test(prev) && / /.test(prev) && /^[A-Z][a-z]+\.$/.test(next)) return true;
  return false;
}

function joinWrapped(lines: string[]): string {
  let out = '';
  for (const l of lines) {
    if (!out) out = l;
    else {
      const prev = out.split('\n').pop()!;
      if (isWrap(prev, l)) out += (/\S-$/.test(prev) && /^[a-z0-9]/.test(l) ? '' : ' ') + l;
      else out += '\n' + l;
    }
  }
  return out;
}

/** Split remarks lines into the time of activity (first run of schedule lines) and the rest. */
export function splitActivity(lines: string[]): { activity: string; remarks: string } {
  const start = lines.findIndex((l) => ACT_START.test(l));
  if (start < 0) return { activity: '', remarks: joinWrapped(lines) };
  let end = start + 1;
  while (end < lines.length && (ACT_START.test(lines[end]) || isWrap(lines[end - 1], lines[end]))) end++;
  return {
    activity: joinWrapped(lines.slice(start, end)),
    remarks: joinWrapped([...lines.slice(0, start), ...lines.slice(end)]),
  };
}

// ---------------------------------------------------------------- table reader

interface Row {
  section: string; // '5.1.1', '5.2.1', '5.3.1', …
  cols: string[]; // text per column ('' when empty)
}

const FOOTER = /HELLENIC AVIATION SERVICE PROVIDER|AIRAC AMDT|FIRST EDITION/;
const NUMBERING = /^\s*1\s{3,}2\s{3,}3(\s{3,}4\s{3,}5)?\s*$/;
const SECTION = /^\s*(5\.\d\.\d)(?!\.\d)\s+\S/;

function headerX(header: string[], words: string[]): number {
  let best = Infinity;
  for (const l of header)
    for (const w of words) {
      const i = l.indexOf(w);
      if (i >= 0) best = Math.min(best, i);
    }
  return best;
}

/** Column start positions for one page, from its header lines. */
function columnStarts(header: string[], ncols: number): number[] | null {
  if (ncols === 3) {
    const up = headerX(header, ['Upper limit']);
    const time = headerX(header, ['(time of']);
    if (!isFinite(up) || !isFinite(time)) return null;
    // Limits sit under 'Upper limit'; the remarks start a little left of '(time of …'.
    const end = up + 'Upper limit'.length;
    return [0, up - 8, Math.min(end + 2, Math.floor((end + time) / 2))];
  }
  const vert = headerX(header, ['Vertical limits']);
  const act = headerX(header, ['Activity', 'Advisory', 'measures']);
  const auth = headerX(header, ['Authority', 'responsible', 'INFO']);
  const time = headerX(header, ['Time of ACT', 'Remarks']);
  if (![vert, act, auth, time].every(isFinite)) return null;
  return [0, vert - 4, act - 4, auth - 4, time - 12];
}

/** The table body rows of an ENR 5 text, cut into columns. */
export function readTable(text: string, ncols: 3 | 5): Row[] {
  const rows: Row[] = [];
  let section = '';
  let header: string[] = [];
  let starts: number[] | null = null;
  for (const raw of text.replace(/\f/g, '\n').split('\n')) {
    // Private-use glyphs are list bullets (Symbol font); drop them, keeping the column positions.
    const line = raw.replace(/[\uE000-\uF8FF]/g, ' ').replace(/\s+$/, '');
    const sec = SECTION.exec(line);
    if (sec) section = sec[1];
    if (FOOTER.test(line) || /^\s*5\.\d\.\d\.\d/.test(line)) {
      starts = null;
      header = [];
      continue;
    }
    if (!starts) {
      if (NUMBERING.test(line)) starts = columnStarts(header, ncols);
      else header.push(line);
      continue;
    }
    if (sec) continue;
    const cols = Array<string>(ncols).fill('');
    const colOf = (x: number) => {
      let c = 0;
      while (c + 1 < ncols && x >= starts![c + 1]) c++;
      return c;
    };
    const add = (c: number, s: string) => (cols[c] = cols[c] ? cols[c] + ' ' + s : s);
    for (const m of line.matchAll(/\S+(?: \S+)*/g)) {
      const c = colOf(m.index);
      // In the 5-column table the authority and remarks columns sometimes touch ('IRAKION Aeroclub Permission …'):
      // split such a chunk word by word.
      if (ncols === 5 && c === 3 && m.index + m[0].length > starts[4]) {
        for (const w of m[0].matchAll(/\S+/g)) add(colOf(m.index + w.index), w[0]);
      } else add(c, m[0]);
    }
    rows.push({ section, cols: cols.map(norm) });
  }
  return rows;
}

// ---------------------------------------------------------------- ENR 5.1 / 5.2

interface RawArea {
  id: string;
  name: string;
  nameOpen: boolean; // still collecting name lines
  kind: Kind;
  lateral: string[];
  limits: string[];
  remarks: string[];
  subs: RawArea[];
  sector?: boolean;
}

const KIND_OF: Record<string, Kind> = {
  '5.1.1': 'P',
  '5.1.2': 'R',
  '5.1.3': 'D',
  '5.1.4': 'D',
  '5.2.1': 'MIL',
  '5.2.2': 'MIL',
};

/** Hand-checked fixes for entries the column layout cannot express. */
const OVERRIDES: Record<string, Partial<RefArea>> = {
  // LGD77 KRANEA prints two limit pairs, 'FL 140 / GND' and 'FL 290 / GND', with the remarks
  //   'FL 140: Daily SR-1300 and SS-21 00 except FRI, SAT, SUN and HOL.
  //    FL 290: Every WED, THU 0530-0730 except HOL.'
  // The area reaches FL 290 at most; the activity keeps both schedules.
  LGD77: { upper: 'FL 290', lower: 'GND' },
};

const DESIG = /^(LG(?:P|R|D|C|TSA)\d+[A-Z0-9]*)\b\s*(.*)$/;
const SECTOR = /^SECTOR ([A-Z]\d?)\b\s*(.*)$/;
const NAME_LINE = /^[A-Z0-9(][A-Z0-9 ()\-–'’.,&/]*$/;

function newRaw(id: string, name: string, kind: Kind): RawArea {
  return { id, name, nameOpen: name === '', kind, lateral: [], limits: [], remarks: [], subs: [] };
}

function readAreas(rows: Row[], sections: string[]): RawArea[] {
  const out: RawArea[] = [];
  let main: RawArea | null = null;
  let cur: RawArea | null = null; // main or its current sub-area
  let lastRemarkOnly: { into: string[] } | null = null;
  let section = '';
  for (const row of rows) {
    if (row.section !== section) {
      section = row.section;
      main = cur = null;
    }
    if (!sections.includes(row.section) || row.cols.every((c) => c === '' || c === 'NIL')) continue;
    const [c1, c2, c3] = row.cols;
    const d = DESIG.exec(c1);
    const s = SECTOR.exec(c1);
    let started = false;
    if (d) {
      const [, id, rest] = d;
      const suffix = main ? id.slice(main.id.length) : '';
      if (main && id.startsWith(main.id) && /^[A-Y]\d?$/.test(suffix)) {
        cur = newRaw(id, rest, main.kind);
        main.subs.push(cur);
      } else {
        main = cur = newRaw(id, rest, KIND_OF[row.section]);
        out.push(main);
        started = true;
      }
    } else if (s && main) {
      cur = newRaw(main.id + s[1], `${main.name} SECTOR ${s[1]}`, main.kind);
      cur.sector = true;
      main.subs.push(cur);
      if (s[2]) cur.lateral.push(s[2]);
    } else if (c1 && cur) {
      if (cur.nameOpen && NAME_LINE.test(c1) && !findCoords(c1).length) cur.name = norm(cur.name + ' ' + c1);
      else {
        cur.nameOpen = false;
        cur.lateral.push(c1);
      }
    }
    if (!cur) continue;
    // A remark line just above a designator that starts 'FL nnn:' belongs to the new entry (LGD77).
    if (started && lastRemarkOnly && /^FL \d+:/.test(lastRemarkOnly.into[lastRemarkOnly.into.length - 1] ?? '')) {
      main!.remarks.push(lastRemarkOnly.into.pop()!);
    }
    if (c2) cur.limits.push(normLimit(c2));
    if (c3) (cur.sector ? cur : main!).remarks.push(c3);
    lastRemarkOnly = c3 && !c1 && !c2 ? { into: (cur.sector ? cur : main!).remarks } : null;
  }
  return out;
}

function limitsOf(a: RawArea, warn: (m: string) => void): { upper: string; lower: string } {
  const vals = a.limits.filter((l) => LIMIT_RE.test(l));
  const junk = a.limits.filter((l) => !LIMIT_RE.test(l));
  if (junk.length) warn(`${a.id}: unexpected text in the limits column: ${junk.join(' | ')}`);
  if (vals.length !== 2 && !OVERRIDES[a.id]?.upper)
    warn(`${a.id}: ${vals.length} vertical limits (${vals.join(', ')})`);
  return { upper: vals[0] ?? '', lower: vals[1] ?? '' };
}

function emit(raws: RawArea[], source: string, warn: (m: string) => void): RefArea[] {
  const out: RefArea[] = [];
  for (const m of raws) {
    const mainLateral = norm(m.lateral.join(' ').replace(/(\d)Ν/g, '$1N').replace(/(\d)Ε/g, '$1E'));
    const parts = m.subs.length ? m.subs : [m];
    for (const p of parts) {
      const isSub = p !== m;
      let lateral = isSub ? norm(p.lateral.join(' ').replace(/(\d)Ν/g, '$1N').replace(/(\d)Ε/g, '$1E')) : mainLateral;
      let geo: Geometry | null = null;
      if (isSub && !findCoords(lateral).length) {
        geo = circularSegment(mainLateral, lateral);
        lateral = norm(`${mainLateral} ${lateral}`);
      }
      geo ??= parseLateral(lateral);
      const lim = limitsOf(p.limits.length || !isSub ? p : m, warn);
      const { activity, remarks } = splitActivity(p.sector ? [...m.remarks, ...p.remarks] : m.remarks);
      const area: RefArea = {
        id: p.id,
        kind: p.kind,
        name: norm(p.name || m.name),
        ...(isSub ? { group: m.id } : {}),
        lower: lim.lower,
        upper: lim.upper,
        lateral,
        ...(geo.circle ? { circle: geo.circle } : {}),
        ...(geo.polygon ? { polygon: geo.polygon } : {}),
        ...(geo.geometryNote ? { geometryNote: geo.geometryNote } : {}),
        activity,
        remarks,
        source,
        ...OVERRIDES[p.id],
      };
      if (!area.circle && !area.polygon && !area.geometryNote)
        area.geometryNote = 'Lateral limits could not be parsed; not drawn';
      out.push(area);
    }
  }
  return out;
}

export function parseEnr51(text: string, warn: (m: string) => void = () => {}): RefArea[] {
  return emit(readAreas(readTable(text, 3), ['5.1.1', '5.1.2', '5.1.3', '5.1.4']), 'ENR 5.1', warn);
}

export function parseEnr52(text: string, warn: (m: string) => void = () => {}): RefArea[] {
  return emit(readAreas(readTable(text, 3), ['5.2.1', '5.2.2']), 'ENR 5.2', warn);
}

// ---------------------------------------------------------------- ENR 5.3.1

interface Raw53 {
  name: string;
  lateral: string[];
  limits: string[];
  activity: string[]; // column 3
  authority: string[]; // column 4
  remarks: string[]; // column 5
  subs: Raw53[];
}

const slug = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function parseEnr53(text: string, warn: (m: string) => void = () => {}): RefArea[] {
  const raws: Raw53[] = [];
  let main: Raw53 | null = null;
  let cur: Raw53 | null = null;
  const blank = (name: string): Raw53 => ({
    name,
    lateral: [],
    limits: [],
    activity: [],
    authority: [],
    remarks: [],
    subs: [],
  });
  for (const row of readTable(text, 5)) {
    if (row.section !== '5.3.1') continue;
    const [c1, c2, c3, c4, c5] = row.cols;
    if (c1 && NAME_LINE.test(c1) && !findCoords(c1).length) {
      if (main && c1.startsWith(main.name + ' ')) {
        cur = blank(c1);
        main.subs.push(cur);
      } else {
        main = cur = blank(c1);
        raws.push(main);
      }
    } else if (c1 && cur) cur.lateral.push(c1);
    if (!cur || !main) continue;
    if (c2) cur.limits.push(normLimit(c2));
    if (c3) main.activity.push(c3);
    if (c4) main.authority.push(c4);
    if (c5) main.remarks.push(c5);
  }
  const out: RefArea[] = [];
  for (const m of raws) {
    for (const p of m.subs.length ? m.subs : [m]) {
      const id = slug(p.name);
      const lateral = norm(p.lateral.join(' '));
      const geo = parseLateral(lateral);
      const vals = p.limits.filter((l) => LIMIT_RE.test(l));
      if (vals.length !== 2 || vals.length !== p.limits.length) warn(`${id}: limits ${p.limits.join(', ')}`);
      const { activity, remarks } = splitActivity(m.remarks);
      const what = norm(m.activity.join(' '));
      const who = norm(m.authority.join(' '));
      const area: RefArea = {
        id,
        kind: 'ACT',
        name: p.name,
        ...(p !== m ? { group: slug(m.name) } : {}),
        lower: vals[1] ?? '',
        upper: vals[0] ?? '',
        lateral,
        ...(geo.circle ? { circle: geo.circle } : {}),
        ...(geo.polygon ? { polygon: geo.polygon } : {}),
        ...(geo.geometryNote ? { geometryNote: geo.geometryNote } : {}),
        activity,
        remarks: [what, who && `Authority: ${who}`, remarks].filter(Boolean).join('\n'),
        source: 'ENR 5.3',
      };
      if (!area.circle && !area.polygon) area.geometryNote = 'Lateral limits could not be parsed; not drawn';
      out.push(area);
    }
  }
  return out;
}

// ---------------------------------------------------------------- CLI

export function parseAll(dir: string, warn: (m: string) => void): RefArea[] {
  const read = (n: string) => fs.readFileSync(path.join(dir, `LG_ENR_5_${n}_en.txt`), 'utf8');
  return [...parseEnr51(read('1'), warn), ...parseEnr52(read('2'), warn), ...parseEnr53(read('3'), warn)];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [dir, outFile] = process.argv.slice(2);
  if (!dir || !outFile) {
    console.error('usage: tsx tools/parse_enr5.ts <dir with LG_ENR_5_*_en.txt> <out.json>');
    process.exit(2);
  }
  const warn = (m: string) => console.error('warning:', m);
  const areas = parseAll(dir, warn);
  const ids = new Set<string>();
  for (const a of areas) {
    if (ids.has(a.id)) warn(`duplicate id ${a.id}`);
    ids.add(a.id);
    if (a.geometryNote)
      console.error(`${a.circle || a.polygon ? 'approximate' : 'NOT DRAWN'}: ${a.id} ${a.name}: ${a.geometryNote}`);
    if (!a.upper || !a.lower) console.error(`missing limits: ${a.id}`);
  }
  const counts: Record<string, number> = {};
  for (const a of areas) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  console.error('areas per kind:', JSON.stringify(counts), 'total', areas.length);
  fs.writeFileSync(outFile, JSON.stringify(areas, null, 1) + '\n');
}
