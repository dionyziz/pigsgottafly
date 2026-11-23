// The eAIP's table of contents (side.htm on the AIP CD / online eAIP) → src/data/ref/aip-files.json: the PDF
// of each AIP section by its reference ('ENR 5.1', 'AD 2 LGAV', 'AD 1.6.5', 'AD 3.13', 'GEN 2.7'), and of each
// aerodrome's VFR chart ('VFR LGAV': AD 2.24 / AD 1.6.N.24 '…_VFR_en.pdf'), as a path relative to the eAIP root. The online root of the current AIRAC is AIP_EAIP_BASE in src/data/aipLinks.ts
// (set by tools/update_aip.sh); src/data/aipLinks.ts turns a source reference into a link. The AIP SUPs in force
// ('AIP SUP 09/24', sources of SUP areas) come from the supplements' own menu, esup/sups-menu.htm.
//
//   npx tsx tools/aip_files.ts <iso>/ais/side.htm src/data/ref/aip-files.json [<iso>/ais/esup/sups-menu.htm]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Section reference → relative PDF path, from the hrefs of side.htm (and of esup/sups-menu.htm, whose hrefs are
 * relative to esup/). Of the charts only the VFR charts are kept.
 */
export function aipFiles(html: string, supsMenu = ''): Record<string, string> {
  const out: Record<string, string> = {};
  const hrefs = [
    ...[...html.matchAll(/href="([^"]+\.pdf)\s*"/gi)].map((m) => m[1].trim()),
    ...[...supsMenu.matchAll(/href="([^"]+\.pdf)\s*"/gi)].map((m) => 'esup/' + m[1].trim().replace(/^\.\//, '')),
  ];
  for (const rel of hrefs) {
    const file = rel.split('/').pop()!;
    let key: string | null = null;
    let f: RegExpMatchArray | null;
    if ((f = file.match(/^LG_AD_(?:2|1_6_\d+)_(LG[A-Z]{2})_VFR_en\.pdf$/))) key = `VFR ${f[1]}`;
    else if ((f = file.match(/^LG_AD_2_(LG[A-Z]{2})_en\.pdf$/))) key = `AD 2 ${f[1]}`;
    else if ((f = file.match(/^LG_AD_1_6_(\d+)_[A-Z0-9-]+_en\.pdf$/))) key = `AD 1.6.${f[1]}`;
    else if ((f = file.match(/^LG_AD_3_(\d+)_[A-Z0-9-]+_en\.pdf$/))) key = `AD 3.${f[1]}`;
    else if ((f = file.match(/^LG_(GEN|ENR|AD)_(\d+)_(\d+)_en\.pdf$/))) key = `${f[1]} ${f[2]}.${f[3]}`;
    else if ((f = file.match(/^LG_SUP_A_\d{2}(\d{2})_(\d{2})_en\.pdf$/))) key = `AIP SUP ${f[2]}/${f[1]}`;
    if (key && !out[key]) out[key] = rel;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [src, dst, sups] = process.argv.slice(2);
  if (!src || !dst) {
    console.error('usage: tsx tools/aip_files.ts <side.htm> <out.json> [<esup/sups-menu.htm>]');
    process.exit(2);
  }
  const files = aipFiles(fs.readFileSync(src, 'latin1'), sups ? fs.readFileSync(sups, 'latin1') : '');
  fs.writeFileSync(dst, JSON.stringify(files, null, 1) + '\n');
  console.log(`${Object.keys(files).length} AIP sections → ${dst}`);
}
