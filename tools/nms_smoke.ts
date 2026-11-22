// Live check of the international NOTAM feed (NMS-API) with the credentials in .env.local (NMS_BASE,
// NMS_CLIENT_ID, NMS_CLIENT_SECRET): fetches the given locations (default LGAV LGGG) through the
// app's client and prints the counts. Not part of the test suite (tests never reach the service).
//   npx tsx tools/nms_smoke.ts [LGAV LGGG …] [--env path/to/.env.local]
import fs from 'node:fs';

import { NmsClient, nmsFromEnv } from '../api/_lib/notamSources/nms.js';

const args = process.argv.slice(2);
const envAt = args.indexOf('--env');
const envFile = envAt >= 0 ? args.splice(envAt, 2)[1] : '.env.local';
const env: NodeJS.ProcessEnv = { ...process.env };
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(NMS_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
const s = nmsFromEnv(env);
if (!s) {
  console.error(`NMS_BASE, NMS_CLIENT_ID and NMS_CLIENT_SECRET are needed (looked in ${envFile})`);
  process.exit(1);
}
const client = new NmsClient(s);
console.log(`host ${new URL(s.baseUrl).host}`);
const locations = args.length ? args.map((a) => a.toUpperCase()) : ['LGAV', 'LGGG'];
const day = Date.now();
for (const loc of locations) {
  const features = await client.location(loc);
  const all = await client.notams([loc], 0, 8.64e15);
  const now = await client.notams([loc], day, day + 86400e3);
  const types = all.reduce<Record<string, number>>((o, n) => ((o[n.type] = (o[n.type] ?? 0) + 1), o), {});
  const firs = all.reduce<Record<string, number>>((o, n) => ((o[n.fir ?? '?'] = (o[n.fir ?? '?'] ?? 0) + 1), o), {});
  const withText = all.filter((n) => n.raw).length;
  console.log(
    `${loc}: ${features.length} features, ${all.length} NOTAMs (${JSON.stringify(types)}; FIR ${JSON.stringify(firs)}; ICAO text ${withText}), ${now.length} valid in the next 24 h`,
  );
}
