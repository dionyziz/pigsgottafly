// Operational hours and handling of every aerodrome, as printed in the eAIP:
//   AD 2:   <ICAO> AD 2.3 OPERATIONAL HOURS  (1 AD Administration, 2 Customs and immigration, 7 ATS, 9 Handling, 12 Remarks)
//   AD 1.6: AD 1.6.N.3 OPERATIONAL HOURS     (1 AD Administration, 7/8 ATS, 12 Remarks; a few list 2 … 11 as AD 2.3)
//           AD 1.6.N.4 HANDLING SERVICES AND FACILITIES (used for handling when .3 has no item 9)
//
//   npx tsx tools/extract_ad_hours.ts TXT_DIR        (TXT_DIR: `pdftotext -layout` of the AD 2 / AD 1.6 PDFs,
//                                                      tools/update_aip.sh step 2)
//
// Writes tools/ad_hours.json: the text of each item VERBATIM (continuation lines joined with '\n',
// page headers and footers dropped). Nothing is interpreted here: `npm run ref` (tools/build_ref.ts)
// parses the texts with src/calc/adHours.ts and loads them into the reference data (migration 012).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AD_HOURS_JSON = path.join(ROOT, 'tools', 'ad_hours.json');

export interface RawAdHours {
  /** e.g. 'LGAV AD 2.3', 'AD 1.6.5.3'. */
  source: string;
  /** The PDF page's AIRAC amendment (footer of the page the section starts on), e.g. 'AIRAC AMDT 10/25'. */
  amdt: string | null;
  ad: string | null;
  customs: string | null;
  ats: string | null;
  handling: string | null;
  /** Where `handling` comes from: the item 9 of the hours table, or the AD 1.6.N.4 section. */
  handlingSource: string;
  handlingFromSection: boolean;
  remarks: string | null;
}

const LABELS: Record<string, keyof RawAdHours | null> = {
  'AD Administration': 'ad',
  'Customs and immigration': 'customs',
  'Health and sanitation': null,
  'AIS Briefing Office': null,
  'ATS Reporting Office (ARO)': null,
  'MET Briefing Office': null,
  ATS: 'ats',
  Fuelling: null,
  Handling: 'handling',
  Security: null,
  'De-icing': null,
  Remarks: 'remarks',
};
const LABEL_RE = new RegExp(`^\\s{0,10}(\\d{1,2})\\s+(${Object.keys(LABELS).map((l) => l.replace(/[()]/g, '\\$&')).join('|')})(?:\\s{2,}(\\S.*))?$`);

/** Page furniture of the eAIP PDFs (running headers and footers). */
function isFurniture(line: string): boolean {
  const t = line.trim();
  return /^HELLENIC AVIATION SERVICE PROVIDER\b/.test(t) || /^AIRAC AMDT \d+\/\d+\s+HELLENIC AVIATION SERVICE PROVIDER$/.test(t)
    || /^(AD 2 LG[A-Z]{2}|AD 1\.6\.\d+)-\d+\s+AIP$/.test(t) || /^AIP\s+(AD 2 LG[A-Z]{2}|AD 1\.6\.\d+)-\d+$/.test(t)
    || /^\d{2} [A-Z]{3} \d{4}\s+GREECE$/.test(t) || /^GREECE\s+\d{2} [A-Z]{3} \d{4}$/.test(t);
}

/** The lines of a section: from the line matching `start` up to (not including) the line matching `end`. */
function section(lines: string[], start: RegExp, end: RegExp): string[] | null {
  const i = lines.findIndex((l) => start.test(l));
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !end.test(lines[j])) j++;
  return lines.slice(i + 1, j);
}

/** Items of an hours table: label → text (value column, continuation lines joined with '\n'). */
export function tableItems(lines: string[]): Map<string, string> {
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const line of lines) {
    if (!line.trim() || isFurniture(line)) continue;
    const m = LABEL_RE.exec(line);
    if (m) {
      cur = [];
      out.set(m[2], cur);
      if (m[3]) cur.push(m[3].trim());
      continue;
    }
    // a continuation line of the value column (deeply indented)
    if (cur && /^\s{20,}\S/.test(line)) cur.push(line.trim());
  }
  return new Map([...out].map(([k, v]) => [k, v.join('\n')]));
}

function amdtOf(lines: string[], from: number): string | null {
  for (let i = from; i < lines.length; i++) {
    const m = /AIRAC AMDT (\d+\/\d+)/.exec(lines[i]);
    if (m) return `AIRAC AMDT ${m[1]}`;
  }
  return null;
}

/** One AD 2 aerodrome file. */
export function extractAd2(icao: string, text: string): RawAdHours | null {
  const lines = text.split('\n');
  const sec = section(lines, new RegExp(`${icao} AD 2\\.3 OPERATIONAL HOURS`), /\bAD 2\.4 /);
  if (!sec) return null;
  const items = tableItems(sec);
  const start = lines.findIndex((l) => l.includes(`${icao} AD 2.3 OPERATIONAL HOURS`));
  return {
    source: `${icao} AD 2.3`, amdt: amdtOf(lines, start),
    ad: items.get('AD Administration') ?? null, customs: items.get('Customs and immigration') ?? null, ats: items.get('ATS') ?? null,
    handling: items.get('Handling') ?? null, handlingSource: `${icao} AD 2.3`, handlingFromSection: false,
    remarks: items.get('Remarks') ?? null,
  };
}

/** One AD 1.6 aerodrome file (section number n). */
export function extractAd16(n: number, text: string): RawAdHours | null {
  const lines = text.split('\n');
  const sec = section(lines, new RegExp(`AD 1\\.6\\.${n}\\.3 OPERATIONAL HOURS`), new RegExp(`AD 1\\.6\\.${n}\\.4 `));
  if (!sec) return null;
  const items = tableItems(sec);
  const start = lines.findIndex((l) => l.includes(`AD 1.6.${n}.3 OPERATIONAL HOURS`));
  let handling = items.get('Handling') ?? null;
  let handlingSource = `AD 1.6.${n}.3`;
  let fromSection = false;
  if (handling === null) {
    const h = section(lines, new RegExp(`AD 1\\.6\\.${n}\\.4 HANDLING SERVICES AND FACILITIES`), new RegExp(`AD 1\\.6\\.${n}\\.5 `)) ?? [];
    handling = h.filter((l) => l.trim() && !isFurniture(l)).map((l) => l.trim().replace(/\s{2,}/g, '  ')).join('\n') || null;
    handlingSource = `AD 1.6.${n}.4`;
    fromSection = true;
  }
  return {
    source: `AD 1.6.${n}.3`, amdt: amdtOf(lines, start),
    ad: items.get('AD Administration') ?? null, customs: items.get('Customs and immigration') ?? null, ats: items.get('ATS') ?? null,
    handling, handlingSource, handlingFromSection: fromSection,
    remarks: items.get('Remarks') ?? null,
  };
}

/** Every aerodrome of the reference data → its raw hours (aerodromes without a section are left out and reported). */
export function extractAll(txtDir: string, aerodromes: { id: string; icao: string | null; source: string }[]): { out: Record<string, RawAdHours>; missing: string[] } {
  const files = fs.readdirSync(txtDir);
  const out: Record<string, RawAdHours> = {};
  const missing: string[] = [];
  for (const a of aerodromes) {
    let r: RawAdHours | null = null;
    const m16 = /^AD 1\.6\.(\d+)$/.exec(a.source);
    if (m16) {
      const n = +m16[1];
      const f = files.find((x) => new RegExp(`^LG_AD_1_6_${n}_[^_]+(?:_en)?\\.txt$`).test(x) && !/_(ADC|APDC|IAC|SID|STAR|VFR)/.test(x));
      if (f) r = extractAd16(n, fs.readFileSync(path.join(txtDir, f), 'utf8'));
    } else if (a.icao) {
      const f = path.join(txtDir, `LG_AD_2_${a.icao}_en.txt`);
      if (fs.existsSync(f)) r = extractAd2(a.icao, fs.readFileSync(f, 'utf8'));
    }
    if (r && r.ad !== null) out[a.id] = r;
    else missing.push(a.id);
  }
  return { out, missing };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: npx tsx tools/extract_ad_hours.ts TXT_DIR'); process.exit(2); }
  const ads = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'ref', 'aerodromes.json'), 'utf8'));
  const { out, missing } = extractAll(dir, ads);
  for (const id of missing) console.warn('no operational hours found for', id);
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(AD_HOURS_JSON, JSON.stringify(sorted, null, 1) + '\n');
  console.log(`wrote ${path.relative(ROOT, AD_HOURS_JSON)}: ${Object.keys(out).length} aerodromes`);
}
