// Builds src/data/licenses.json: the third-party software, fonts and data that reach users, with each
// one's license text, for About → Open-source licenses on the website (src/app/LicensesPage.tsx) and
// in the iPhone app (LicensesView.swift, which bundles the same file). The file is committed.
//   npm run licenses              (write it)
//   npm run licenses -- --check   (fail when the committed file is not what the sources build)
// The npm packages are those package-lock.json does not mark dev: the closure of package.json's
// "dependencies", which is what the client bundle, the serverless API, core.js and sheets.html can
// contain. A font in public/fonts or a MapLibre Native version in project.yml without an entry
// here fails the build, so neither can ship unlisted.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LICENSES_OUT = path.join(ROOT, 'src/data/licenses.json');
const TEXTS = path.join(ROOT, 'tools/licenses');
const FONTS = path.join(ROOT, 'public/fonts');

export interface LicenseEntry {
  group: 'Software' | 'Fonts' | 'Data';
  name: string;
  version?: string;
  license: string;
  copyright?: string;
  url?: string;
  /** Key into texts: identical license texts (dozens of MIT and Apache copies) are stored once. */
  text: string;
}
export interface Licenses {
  entries: LicenseEntry[];
  texts: Record<string, string>;
}

interface LockPackage {
  version?: string;
  license?: string;
  dev?: boolean;
  devOptional?: boolean;
}
interface PackageJson {
  name: string;
  version: string;
  license?: string;
  author?: string | { name?: string };
  homepage?: string;
  repository?: string | { url?: string };
}

const read = (file: string) => fs.readFileSync(file, 'utf8');
const normalize = (text: string) => text.replace(/\r\n?/g, '\n').trim();

/** "Copyright (c) 2015 X" lines, not the Apache appendix's "[yyyy] [name of copyright owner]" template,
 *  the license's own prose about "the copyright owner" or its clause "(c) You must retain…". */
function copyrightOf(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(copyright\b|©|\(c\)\s*\d)/i.test(l))
    .filter((l) => !/\[yyyy\]|\{yyyy\}|copyright (owner|notice|holders?\b(?! of)|license|statement)/i.test(l));
  return lines.length ? [...new Set(lines)].slice(0, 3).join('\n') : undefined;
}

const authorOf = (p: PackageJson) =>
  (typeof p.author === 'string' ? p.author : p.author?.name)?.replace(/\s*[<(].*$/, '').trim() || undefined;

function urlOf(p: PackageJson): string {
  const repo = typeof p.repository === 'string' ? p.repository : p.repository?.url;
  const fromRepo = repo
    ?.replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
  if (fromRepo?.startsWith('https://')) return fromRepo;
  return p.homepage ?? `https://www.npmjs.com/package/${p.name}`;
}

const MIT = (holder: string) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** A few packages publish no license file (puppeteer-core, @puppeteer/browsers, murmurhash-js,
 *  splaytree): their license is then the standard text of the one package.json names. */
function fallbackText(p: PackageJson): string {
  const holder = authorOf(p);
  if (p.license === 'MIT' && holder) return MIT(holder);
  if (p.license === 'Apache-2.0') return read(path.join(TEXTS, 'Apache-2.0.txt'));
  throw new Error(`${p.name}@${p.version} has no license file and no standard text for ${p.license}`);
}

function packageEntries(): (Omit<LicenseEntry, 'text'> & { body: string })[] {
  const lock = JSON.parse(read(path.join(ROOT, 'package-lock.json'))) as { packages: Record<string, LockPackage> };
  const seen = new Set<string>();
  const out: (Omit<LicenseEntry, 'text'> & { body: string })[] = [];
  for (const [dir, lp] of Object.entries(lock.packages)) {
    if (!dir || lp.dev || lp.devOptional) continue;
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(path.join(abs, 'package.json')))
      throw new Error(`${dir} is not installed: run npm ci before npm run licenses`);
    const p = JSON.parse(read(path.join(abs, 'package.json'))) as PackageJson;
    // type declarations are never part of a bundle
    if (p.name.startsWith('@types/')) continue;
    const key = `${p.name}@${p.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const files = fs
      .readdirSync(abs)
      .filter((f) => /^(licen[cs]e|copying)(-mit)?(\.(md|txt))?$/i.test(f))
      .sort();
    const notices = fs.readdirSync(abs).filter((f) => /^notice(\.(md|txt))?$/i.test(f));
    let body = files.length ? files.map((f) => normalize(read(path.join(abs, f)))).join('\n\n') : fallbackText(p);
    if (notices.length) body += '\n\n' + notices.map((f) => normalize(read(path.join(abs, f)))).join('\n\n');
    out.push({
      group: 'Software',
      name: p.name,
      version: p.version,
      license: p.license ?? lp.license ?? 'Unknown',
      copyright: copyrightOf(body) ?? (authorOf(p) ? `© ${authorOf(p)}` : undefined),
      url: urlOf(p),
      body,
    });
  }
  return out;
}

/** The map renderer inside the iPhone app (a binary Swift package: its LICENSE.md is copied into
 *  tools/licenses, checked against the version project.yml pins). */
const MAPLIBRE_NATIVE_VERSION = '6.31.0';
function maplibreNative(): Omit<LicenseEntry, 'text'> & { body: string } {
  const yml = read(path.join(ROOT, 'native/ios/project.yml'));
  const pinned = /maplibre-gl-native-distribution\s+exactVersion:\s*([\d.]+)/.exec(yml)?.[1];
  if (pinned !== MAPLIBRE_NATIVE_VERSION)
    throw new Error(
      `project.yml pins MapLibre Native ${pinned}, the license list ${MAPLIBRE_NATIVE_VERSION}: update ` +
        'MAPLIBRE_NATIVE_VERSION in tools/build_licenses.ts and the package LICENSE.md in tools/licenses/maplibre-native.txt',
    );
  const body = normalize(read(path.join(TEXTS, 'maplibre-native.txt')));
  return {
    group: 'Software',
    name: 'MapLibre Native (iOS)',
    version: MAPLIBRE_NATIVE_VERSION,
    license: 'BSD-2-Clause',
    copyright: copyrightOf(body),
    url: 'https://github.com/maplibre/maplibre-native',
    body,
  };
}

const FONT_LIST: {
  files: string[];
  name: string;
  license: string;
  licenseFile: string;
  copyright?: string;
  url: string;
}[] = [
  {
    files: ['Inter-latin.woff2', 'Inter-greek.woff2'],
    name: 'Inter',
    license: 'OFL-1.1',
    licenseFile: 'OFL.txt',
    url: 'https://github.com/rsms/inter',
  },
  {
    files: ['Arimo-Regular.woff2', 'Arimo-Bold.woff2', 'Arimo-Italic.woff2', 'Arimo-BoldItalic.woff2'],
    name: 'Arimo',
    license: 'OFL-1.1',
    licenseFile: 'Arimo-OFL.txt',
    url: 'https://github.com/googlefonts/arimo',
  },
  {
    files: ['DejaVuSansMono.woff2', 'DejaVuSansMono-symbols.woff2'],
    name: 'DejaVu Sans Mono',
    license: 'Bitstream-Vera',
    licenseFile: 'DejaVuSansMono-LICENSE.txt',
    copyright: 'Copyright (c) 2003 by Bitstream, Inc.\nCopyright (c) 2006 by Tavmjong Bah',
    url: 'https://dejavu-fonts.github.io',
  },
  {
    files: ['HomemadeApple-Regular.ttf'],
    name: 'Homemade Apple',
    license: 'Apache-2.0',
    licenseFile: 'HomemadeApple-LICENSE.txt',
    copyright: '© Font Diner',
    url: 'https://fonts.google.com/specimen/Homemade+Apple',
  },
];

function fontEntries(): (Omit<LicenseEntry, 'text'> & { body: string })[] {
  const listed = new Set(FONT_LIST.flatMap((f) => [...f.files, f.licenseFile]));
  const unlisted = fs.readdirSync(FONTS).filter((f) => !listed.has(f));
  if (unlisted.length)
    throw new Error(`public/fonts has fonts the license list does not name: ${unlisted.join(', ')} (FONT_LIST)`);
  return FONT_LIST.map((f) => {
    const body = normalize(read(path.join(FONTS, f.licenseFile)));
    return {
      group: 'Fonts',
      name: f.name,
      license: f.license,
      copyright: f.copyright ?? copyrightOf(body),
      url: f.url,
      body,
    };
  });
}

/** The data the maps, terrain, weather and magnetic variation come from, as their providers ask to be
 *  credited (About names them too). */
const DATA: (Omit<LicenseEntry, 'text' | 'group'> & { body: string })[] = [
  {
    name: 'OpenStreetMap',
    license: 'ODbL-1.0',
    copyright: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
    body: 'Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0.\nhttps://www.openstreetmap.org/copyright\nhttps://opendatacommons.org/licenses/odbl/1-0/',
  },
  {
    name: 'OpenFreeMap',
    license: 'OpenMapTiles (BSD-3-Clause, CC-BY-4.0)',
    copyright: '© OpenMapTiles',
    url: 'https://openfreemap.org',
    body: 'The "Light" base map: vector tiles and the Positron style from OpenFreeMap (https://openfreemap.org).\nTile schema and style © OpenMapTiles (https://openmaptiles.org): code under the BSD 3-Clause License, design under CC-BY 4.0.\nMap data © OpenStreetMap contributors.',
  },
  {
    name: 'OpenTopoMap',
    license: 'CC-BY-SA-3.0',
    copyright: '© OpenTopoMap',
    url: 'https://opentopomap.org',
    body: 'The "Terrain" base map: map style © OpenTopoMap (https://opentopomap.org), under the Creative Commons Attribution-ShareAlike 3.0 license (https://creativecommons.org/licenses/by-sa/3.0/).\nMap data © OpenStreetMap contributors, SRTM.',
  },
  {
    name: 'open flightmaps',
    license: 'OFMA General Users’ License',
    copyright: '© open flightmaps association',
    url: 'https://www.openflightmaps.org',
    body: 'The aeronautical map overlay: aero data © open flightmaps (https://www.openflightmaps.org), under the open flightmaps association’s General Users’ License.',
  },
  {
    name: 'Terrain Tiles',
    license: 'Attribution (multiple sources)',
    url: 'https://registry.opendata.aws/terrain-tiles/',
    body: 'Terrain elevations from Terrain Tiles on AWS (https://registry.opendata.aws/terrain-tiles/), built from SRTM, GMTED, ETOPO1 and other sources.\nSources and their attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  },
  {
    name: 'Open-Meteo',
    license: 'CC-BY-4.0',
    copyright: '© Open-Meteo.com',
    url: 'https://open-meteo.com',
    body: 'Weather data by Open-Meteo.com (https://open-meteo.com), under the Creative Commons Attribution 4.0 International license (https://creativecommons.org/licenses/by/4.0/). Forecasts from the ECMWF IFS model.',
  },
  {
    name: 'World Magnetic Model WMM2025',
    license: 'Public domain',
    copyright: 'NOAA NCEI and the British Geological Survey',
    url: 'https://www.ncei.noaa.gov/products/world-magnetic-model',
    body: 'The World Magnetic Model WMM2025, by the NOAA National Centers for Environmental Information and the British Geological Survey. A work of the United States Government, in the public domain.',
  },
];

/** The licenses.json text the sources build. */
export function buildLicenses(): string {
  const byName = (a: { name: string; version?: string }, b: { name: string; version?: string }) =>
    a.name.localeCompare(b.name, 'en') || (a.version ?? '').localeCompare(b.version ?? '', 'en', { numeric: true });
  const all = [
    ...[...packageEntries(), maplibreNative()].sort(byName),
    ...fontEntries(),
    ...DATA.map((d) => ({ ...d, group: 'Data' as const })),
  ];
  const texts: Record<string, string> = {};
  const entries: LicenseEntry[] = all.map(({ body, ...e }) => {
    const key = createHash('sha256').update(body).digest('hex').slice(0, 12);
    texts[key] = body;
    return { ...e, text: key };
  });
  return JSON.stringify({ entries, texts } satisfies Licenses) + '\n';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = buildLicenses();
  const rel = path.relative(ROOT, LICENSES_OUT);
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(LICENSES_OUT) ? read(LICENSES_OUT) : '';
    if (current !== text) {
      console.error(`${rel} is stale: run npm run licenses`);
      process.exit(1);
    }
    console.log(`${rel} is up to date`);
  } else {
    fs.writeFileSync(LICENSES_OUT, text);
    const n = (JSON.parse(text) as Licenses).entries.length;
    console.log(`${rel}: ${n} entries, ${(text.length / 1024).toFixed(0)} KB`);
  }
}
