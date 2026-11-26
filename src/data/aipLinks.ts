// Links to the official AIP Greece (HASP eAIP, PDF per section) for the AIP references the app shows
// ('AD 2 LGAV', 'LGAV AD 2.3', 'AD 1.6.5.3', 'ENR 2.1.3, ENR 2.1.4', 'ENR 5.1', …). The section → file map
// comes from the eAIP's table of contents (src/data/ref/aip-files.json, tools/aip_files.ts); a reference
// with no PDF links the eAIP's start page.
import aipFilesJson from './ref/aip-files.json';

/**
 * Root of the online eAIP for the AIRAC of the reference data (src/data/ref/airac.json). Updated by
 * tools/update_aip.sh; tests/unit/data/aipLinks.test.ts checks it against the AIRAC.
 */
export const AIP_EAIP_BASE = 'https://aisgr.hasp.gov.gr/aipgr_incl_amdt_1026_wef_26nov2026/cd/ais/';

const FILES = aipFilesJson as Record<string, string>;

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
