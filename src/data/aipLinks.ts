// Links to the official AIP Greece (HASP eAIP, PDF per section) for the AIP references the app shows
// ('AD 2 LGAV', 'LGAV AD 2.3', 'AD 1.6.5.3', 'ENR 2.1.3, ENR 2.1.4', 'ENR 5.1', …). The section → file map
// comes from the eAIP's table of contents of the AIRAC in effect (src/data/ref/cycles/<id>/aip-files.json, tools/aip_files.ts); a reference
// with no PDF links the eAIP's start page.
import { airacDay, cycleOn, type RefAirac } from '../shared/ref';
// the core's cycle list, not ./ref: the native core links the AIP too and ships only this part of each cycle
import { CYCLES } from './ref/cycles/core';

const CYCLE = cycleOn(CYCLES, airacDay());

/**
 * Root of the online eAIP of an AIRAC, as HASP publishes it: 'AIRAC AMDT 10/26 (wef 26 NOV 2026)' →
 * https://aisgr.hasp.gov.gr/aipgr_incl_amdt_1026_wef_26nov2026/cd/ais/ (tests/unit/data/aipLinks.test.ts).
 */
export function eaipBase(airac: RefAirac): string {
  const m = /AMDT (\d\d)\/(\d\d) \(wef (\d+) ([A-Z]{3}) (\d{4})\)/.exec(airac.name);
  if (!m) return 'https://aisgr.hasp.gov.gr/';
  return `https://aisgr.hasp.gov.gr/aipgr_incl_amdt_${m[1]}${m[2]}_wef_${m[3].padStart(2, '0')}${m[4].toLowerCase()}${m[5]}/cd/ais/`;
}

/** Root of the online eAIP of the AIRAC in effect (the reference data's). */
export const AIP_EAIP_BASE = eaipBase(CYCLE.airac);

const FILES = CYCLE.aipFiles;

/** The eAIP start page (all sections, amendments, supplements). */
export const AIP_EAIP_INDEX = AIP_EAIP_BASE + 'index.html';

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

/** URL of the AIP PDF for a reference, or of the eAIP start page when there is none. */
export function aipUrl(ref: string): string {
  const k = aipSection(ref);
  const f = k ? FILES[k] : undefined;
  return f ? AIP_EAIP_BASE + encodeURI(f) : AIP_EAIP_INDEX;
}

/** True when the reference has its own PDF (not just the start page). */
export function hasAipPdf(ref: string): boolean {
  const k = aipSection(ref);
  return !!(k && FILES[k]);
}

/** URL of an aerodrome's AIP VFR chart (AD 2.24 / AD 1.6.N.24, by its ICAO: 'LGAV'), or null when it has none. */
export function vfrChartUrl(icao: string): string | null {
  const f = FILES[`VFR ${icao.toUpperCase()}`];
  return f ? AIP_EAIP_BASE + encodeURI(f) : null;
}
