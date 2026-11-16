// The eAIP's table of contents (side.htm on the AIP CD / online eAIP) → src/data/ref/aip-files.json: the PDF
// of each AIP section by its reference ('ENR 5.1', 'AD 2 LGAV', 'AD 1.6.5', 'AD 3.13', 'GEN 2.7'), as a path
// relative to the eAIP root. The online root of the current AIRAC is AIP_EAIP_BASE in src/data/aipLinks.ts
// (set by tools/update_aip.sh); src/data/aipLinks.ts turns a source reference into a link.
//
//   npx tsx tools/aip_files.ts <iso>/ais/side.htm src/data/ref/aip-files.json
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Section reference → relative PDF path, from the hrefs of side.htm. Charts and other annexes are skipped. */
export function aipFiles(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/href="([^"]+\.pdf)\s*"/gi)) {
    const rel = m[1].trim();
    const file = rel.split('/').pop()!;
    let key: string | null = null;
    let f: RegExpMatchArray | null;
    if ((f = file.match(/^LG_AD_2_(LG[A-Z]{2})_en\.pdf$/))) key = `AD 2 ${f[1]}`;
    else if ((f = file.match(/^LG_AD_1_6_(\d+)_[A-Z0-9-]+_en\.pdf$/))) key = `AD 1.6.${f[1]}`;
    else if ((f = file.match(/^LG_AD_3_(\d+)_[A-Z0-9-]+_en\.pdf$/))) key = `AD 3.${f[1]}`;
    else if ((f = file.match(/^LG_(GEN|ENR|AD)_(\d+)_(\d+)_en\.pdf$/))) key = `${f[1]} ${f[2]}.${f[3]}`;
    if (key && !out[key]) out[key] = rel;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) {
    console.error('usage: tsx tools/aip_files.ts <side.htm> <out.json>');
    process.exit(2);
  }
  const files = aipFiles(fs.readFileSync(src, 'latin1'));
  fs.writeFileSync(dst, JSON.stringify(files, null, 1) + '\n');
  console.log(`${Object.keys(files).length} AIP sections → ${dst}`);
}
