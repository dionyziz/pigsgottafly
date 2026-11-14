// Stamp asset URLs in index.html with a content hash (?v=xxxxxxxx) so browsers never combine a new
// page with an old cached script or stylesheet. Run after changing any asset: `npm run stamp`.
// `node tools/stamp.mjs --check` exits non-zero if a stamp is stale (used by the unit tests).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex').slice(0, 10);
const out = html.replace(/(src|href)="((?:js|css|data)\/[^"?]+)(?:\?v=[0-9a-f]*)?"/g, (_, attr, p) => `${attr}="${p}?v=${hash(p)}"`);
if (process.argv.includes('--check')) {
  if (out !== html) { console.error('index.html asset stamps are stale: run `npm run stamp`'); process.exit(1); }
} else {
  fs.writeFileSync(file, out);
  console.log('stamped', (out.match(/\?v=/g) || []).length, 'assets');
}
