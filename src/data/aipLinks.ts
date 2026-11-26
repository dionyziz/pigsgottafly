// Links to the official AIP Greece (HASP eAIP, PDF per section) for the AIP references the app shows
// ('AD 2 LGAV', 'LGAV AD 2.3', 'AD 1.6.5.3', 'ENR 2.1.3, ENR 2.1.4', 'ENR 5.1', …), into the eAIP of the AIRAC a
// flight is planned with. The section → file map comes from each cycle's table of contents
// (src/data/ref/cycles/<id>/aip-files.json, tools/aip_files.ts); a reference with no PDF links the eAIP's start page.
import { airacDay, cycleOn, type RefAirac } from '../shared/ref';
// the core's cycle list, not ./ref: the native core links the AIP too and ships only this part of each cycle
import { CYCLES } from './ref/cycles/core';

/**
 * Root of the online eAIP of an AIRAC, as HASP publishes it: 'AIRAC AMDT 10/26 (wef 26 NOV 2026)' →
 * https://aisgr.hasp.gov.gr/aipgr_incl_amdt_1026_wef_26nov2026/cd/ais/ (tests/unit/data/aipLinks.test.ts).
 */
export function eaipBase(airac: RefAirac): string {
  const m = /AMDT (\d\d)\/(\d\d) \(wef (\d+) ([A-Z]{3}) (\d{4})\)/.exec(airac.name);
  if (!m) return 'https://aisgr.hasp.gov.gr/';
  return `https://aisgr.hasp.gov.gr/aipgr_incl_amdt_${m[1]}${m[2]}_wef_${m[3].padStart(2, '0')}${m[4].toLowerCase()}${m[5]}/cd/ais/`;
}

/**
 * The section key of an AIP reference: 'LGAV AD 2.17' → 'AD 2 LGAV', 'AD 1.6.12.3' → 'AD 1.6.12', 'ENR 2.1.3' →
 * 'ENR 2.1', 'AIP SUP 09/24' → 'AIP SUP 09/24'.
 */
export function aipSection(ref: string): string | null {
  const s = ref.toUpperCase();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\bAIP SUP (\d{2}\/\d{2})\b/))) return `AIP SUP ${m[1]}`;
  if ((m = s.match(/\bAD ?2[ .-]+(LG[A-Z]{2})\b/)) || (m = s.match(/\b(LG[A-Z]{2}) AD ?2\b/))) return `AD 2 ${m[1]}`;
  if ((m = s.match(/\bAD ?1\.6\.(\d+)/))) return `AD 1.6.${m[1]}`;
  if ((m = s.match(/\bAD ?3\.(\d+)/))) return `AD 3.${m[1]}`;
  if ((m = s.match(/\b(GEN|ENR|AD) ?(\d)\.(\d+)/))) return `${m[1]} ${m[2]}.${m[3]}`;
  return null;
}

export interface AipLinks {
  airac: RefAirac;
  /** Root of the cycle's online eAIP. */
  base: string;
  /** The eAIP start page (all sections, amendments, supplements). */
  index: string;
  /** URL of the AIP PDF for a reference, or of the eAIP start page when there is none. */
  url: (ref: string) => string;
  /** True when the reference has its own PDF (not just the start page). */
  hasPdf: (ref: string) => boolean;
  /** URL of an aerodrome's AIP VFR chart (AD 2.24 / AD 1.6.N.24, by its ICAO: 'LGAV'), or null when it has none. */
  vfrChartUrl: (icao: string) => string | null;
}

const links = new Map<string, AipLinks>();

/** The links into the eAIP of the AIRAC in effect on a day ('YYYY-MM-DD'). */
export function aipLinksOn(day: string): AipLinks {
  const cycle = cycleOn(CYCLES, day);
  let l = links.get(cycle.airac.id);
  if (l) return l;
  const base = eaipBase(cycle.airac);
  const files = cycle.aipFiles;
  const index = base + 'index.html';
  l = {
    airac: cycle.airac,
    base,
    index,
    url: (ref) => {
      const k = aipSection(ref);
      const f = k ? files[k] : undefined;
      return f ? base + encodeURI(f) : index;
    },
    hasPdf: (ref) => {
      const k = aipSection(ref);
      return !!(k && files[k]);
    },
    vfrChartUrl: (icao) => {
      const f = files[`VFR ${icao.toUpperCase()}`];
      return f ? base + encodeURI(f) : null;
    },
  };
  links.set(cycle.airac.id, l);
  return l;
}

const today = () => aipLinksOn(airacDay());
/** Today's eAIP, for pages with no flight (About). */
export const aipUrl = (ref: string) => today().url(ref);
export const hasAipPdf = (ref: string) => today().hasPdf(ref);
