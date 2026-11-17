// AIP Greece radio navigation aids → RefNavaid[] (src/data/ref/navaids.json, the map's navaid layer).
//
//   npx tsx tools/parse_navaids.ts <dir with the pdftotext -layout files> src/data/ref/navaids.json
//
// Input is `pdftotext -layout` output of the eAIP PDFs (tools/update_aip.sh step 2):
//   LG_ENR_4_1_en.txt     ENR 4.1 radio navigation aids, en-route,
//   LG_AD_2_LGxx_en.txt   AD 2.19 radio navigation and landing aids of each aerodrome,
//   LG_AD_1_6_*_en.txt    AD 1.6.N.19 of the category B aerodromes.
// ILS components (LLZ, GP and their DME) are left out. A station listed in ENR 4.1 and in one or more
// aerodromes' AD 2.19 is one navaid with all its sources; the ENR 4.1 entry wins where the texts differ.
//
// Every station starts with one line: name, type, ident, frequency, hours, latitude, DME elevation,
// coverage. The lines under it hold the channel, the longitude, the magnetic variation with its year,
// and (VORs) the declination:
//
//   ATHINAI VOR/DME      ATV   114.40 MHz   H24   375319.24N   2378 FT / 724.9 M   Coverage FL 500 / 120 NM
//                               (CH 91X)          0234816.19E
//   (5°E/2025)
//   (5°E)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NavaidType, RefNavaid } from '../src/shared/ref.js';

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** DDMMSS[.ss] (degLen 2) or DDDMMSS[.ss] (degLen 3) → degrees. */
function dms(digits: string, degLen: number): number {
  const d = +digits.slice(0, degLen);
  const m = +digits.slice(degLen, degLen + 2);
  const s = +digits.slice(degLen + 2);
  return d + m / 60 + s / 3600;
}

const TYPES = ['VOR/DME', 'VORTAC', 'VOR', 'DME', 'TACAN', 'NDB/DME', 'NDB', 'L'] as const satisfies NavaidType[];

// name, type, ident, [frequency unit], [(CH nnX)], hours, latitude, rest of the line
const STATION = new RegExp(
  String.raw`^\s*([A-Z][A-Z'.\- ]*?[A-Z])\s+(${TYPES.map((t) => t.replace('/', '\\/')).join('|')})\s+([A-Z]{2,4})\s+` +
    String.raw`(?:(\d+(?:\.\d+)?)\s*(MHz|MHZ|kHz|KHZ)\s+)?(?:\(?CH\s*(\d+[XY])\)?\s+)?` +
    String.raw`([A-Z][A-Z0-9]*)\s+(\d{6}(?:\.\d+)?)\s?[NΝ](.*)$`,
);
const LON = /(\d{7}(?:\.\d+)?)\s?[EΕ]/;
const CHANNEL = /\(?CH\s*(\d+[XY])\)?/;
/** '(5°E/2025)', '(5E/2024)', '(5Ε/2024)' (Greek Ε); the degree sign may be the Symbol font's U+F0B0. */
const VARIATION = /\((\d+(?:\.\d+)?)\s*[°º\uF0B0]?\s*([EΕW])\s*\/\s*(\d{4})\)/;
/** '(5°E)'. */
const DECLINATION = /\((\d+(?:\.\d+)?)\s*[°º\uF0B0]?\s*([EΕW])\)/;
/** Lines that end a station's block. */
const BLOCK_END = /\bILS\b|AIRAC AMDT|HELLENIC AVIATION|Radio Navigation and Landing Aids under/i;

const TYPE_ALONE = new RegExp(String.raw`^(\s*)(${TYPES.map((t) => t.replace('/', '\\/')).join('|')})(?=\s{2}|$)`);
const NAME_IDENT = /^(\s*[A-Z][A-Z'.\- ]*?[A-Z])(\s+[A-Z]{2,4}\s+\d+(?:\.\d+)?\s*(?:MHz|MHZ|kHz|KHZ)\s)/;

/** Some tables wrap the type under the name ('ANCHIALOS  AGH  110.40 MHZ …' / 'VOR/DME  (CH 41X) …'): join it back. */
function typeOnNextLine(lines: string[]): string[] {
  const out = [...lines];
  for (let i = 0; i + 1 < out.length; i++) {
    const n = NAME_IDENT.exec(out[i]);
    const t = n && !STATION.test(out[i]) ? TYPE_ALONE.exec(out[i + 1]) : null;
    if (!n || !t) continue;
    out[i] = n[1] + ' ' + t[2] + out[i].slice(n[1].length);
    out[i + 1] = t[1] + ' '.repeat(t[2].length) + out[i + 1].slice(t[0].length);
  }
  return out;
}

const signed = (v: string, hemi: string) => (hemi === 'W' ? -1 : 1) * +v;

/** The stations of one table (ENR 4.1, or one aerodrome's AD 2.19), all with `source`. */
export function parseStations(text: string, source: string, warn: (m: string) => void = () => {}): RefNavaid[] {
  const lines = typeOnNextLine(text.split('\n'));
  const out: RefNavaid[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = STATION.exec(lines[i]);
    if (!m) continue;
    const [, name, type, ident, freqS, unitS, chS, hours, latS, rest] = m;
    const block: string[] = [];
    for (let j = i + 1; j < lines.length && j <= i + 8; j++) {
      if (STATION.test(lines[j]) || BLOCK_END.test(lines[j])) break;
      block.push(lines[j]);
    }
    const below = block.join('\n');
    const lon = LON.exec(below);
    if (!lon) {
      warn(`${source}: ${ident} ${type}: no longitude`);
      continue;
    }
    const t = type as NavaidType;
    const isVor = t.startsWith('VOR');
    const unit: RefNavaid['unit'] = unitS ? (unitS.toLowerCase() === 'khz' ? 'kHz' : 'MHz') : 'MHz';
    const channel = chS ?? CHANNEL.exec(below)?.[1] ?? null;
    if (!freqS && !channel) {
      warn(`${source}: ${ident} ${type}: no frequency or channel`);
      continue;
    }
    const v = VARIATION.exec(below);
    // the declination is the first '(n°E)' after the variation
    const d = isVor ? DECLINATION.exec(v ? below.slice(v.index + v[0].length) : below) : null;
    const elev = /(\d+(?:\.\d+)?)\s*FT\b/.exec(rest);
    const cov = /Coverage\s+(.+?)(?:\s{3,}|$)/.exec(rest);
    out.push({
      id: `${ident} ${t}`,
      ident,
      name: name.trim(),
      type: t,
      freq: freqS ? +freqS : null,
      unit,
      channel,
      lat: r6(dms(latS, 2)),
      lon: r6(dms(lon[1], 3)),
      elevFt: elev ? Math.round(+elev[1]) : null,
      variation: v ? signed(v[1], v[2]) : null,
      variationYear: v ? +v[3] : null,
      declination: d ? signed(d[1], d[2]) : null,
      hours,
      coverage: cov
        ? cov[1]
            .replace(/[.,]+$/, '')
            .replace(/\s*\/\s*/g, ' / ')
            .replace(/(\d)NM\b/g, '$1 NM')
        : '',
      sources: [source],
    });
  }
  return out;
}

/** The AD 2.19 / AD 1.6.N.19 section of an aerodrome's text, and its source label; null when it has none. */
export function aerodromeSection(text: string): { text: string; source: string } | null {
  const lines = text.split('\n');
  let start = -1,
    source = '';
  for (let i = 0; i < lines.length; i++) {
    const m =
      /\b(LG[A-Z]{2}) AD 2\.19 RADIO NAVIGATION/.exec(lines[i]) ??
      /\bAD (1\.6\.\d+)\.19 RADIO NAVIGATION/.exec(lines[i]);
    if (m) {
      start = i;
      source = m[1].startsWith('LG') ? `${m[1]} AD 2.19` : `AD ${m[1]}.19`;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++)
    if (/\bAD 2\.20\b|\bAD 1\.6\.\d+\.20\b/.test(lines[i])) {
      end = i;
      break;
    }
  return { text: lines.slice(start, end).join('\n'), source };
}

const NEAR_DEG = 0.02; // ~1 NM: the same station printed in two tables

/** One list: a station printed in several tables once, with every source (the first table's data). */
export function mergeNavaids(lists: RefNavaid[][], warn: (m: string) => void = () => {}): RefNavaid[] {
  const out: RefNavaid[] = [];
  for (const list of lists)
    for (const n of list) {
      const same = out.find((o) => o.ident === n.ident && o.type === n.type);
      if (same && Math.abs(same.lat - n.lat) < NEAR_DEG && Math.abs(same.lon - n.lon) < NEAR_DEG) {
        for (const s of n.sources) if (!same.sources.includes(s)) same.sources.push(s);
        if (same.freq !== n.freq) warn(`${n.id}: ${same.sources[0]} ${same.freq}, ${n.sources[0]} ${n.freq}`);
        continue;
      }
      if (same) {
        warn(`${n.id}: two stations ${n.sources[0]} and ${same.sources[0]}, kept apart`);
        n.id = `${n.id} ${n.sources[0]}`;
      }
      out.push({ ...n, sources: [...n.sources] });
    }
  return out.sort((a, b) => a.ident.localeCompare(b.ident) || a.type.localeCompare(b.type));
}

// ---------------------------------------------------------------- CLI

export function parseDir(dir: string, warn: (m: string) => void): RefNavaid[] {
  const files = fs.readdirSync(dir).sort();
  const enr = parseStations(fs.readFileSync(path.join(dir, 'LG_ENR_4_1_en.txt'), 'utf8'), 'ENR 4.1', warn);
  const ad: RefNavaid[][] = [];
  for (const f of files) {
    if (!/^LG_AD_(2_LG[A-Z]{2}|1_6_\d+_.*)_en\.txt$/.test(f)) continue;
    const sec = aerodromeSection(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!sec) continue;
    const list = parseStations(sec.text, sec.source, warn);
    // more frequencies than stations read (ILS components aside): a layout the parser does not read
    const freqs = sec.text.split('\n').filter((l) => /\d\s*(MHz|kHz)/i.test(l) && !/^\s*(ILS|LLZ|GP)\b/.test(l));
    if (freqs.length > list.length) warn(`${sec.source}: ${freqs.length} frequencies, ${list.length} stations read`);
    ad.push(list);
  }
  return mergeNavaids([enr, ...ad], warn);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [dir, outFile] = process.argv.slice(2);
  if (!dir || !outFile) {
    console.error('usage: tsx tools/parse_navaids.ts <dir with LG_ENR_4_1_en.txt and LG_AD_*_en.txt> <out.json>');
    process.exit(2);
  }
  const navaids = parseDir(dir, (m) => console.error('warning:', m));
  const counts: Record<string, number> = {};
  for (const n of navaids) counts[n.type] = (counts[n.type] ?? 0) + 1;
  console.error('navaids per type:', JSON.stringify(counts), 'total', navaids.length);
  fs.writeFileSync(outFile, JSON.stringify(navaids, null, 1) + '\n');
}
