// The e2e tests' copy of the reference data: the AIRAC cycle in effect today (src/shared/ref.ts cycleOn), the
// one the browser and the API under test pick by the same clock.
import fs from 'node:fs';
import path from 'node:path';

const CYCLES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'src', 'data', 'ref', 'cycles');

function cycleDir() {
  const today = new Date().toISOString().slice(0, 10);
  const cycles = fs
    .readdirSync(CYCLES)
    .filter((d) => /^\d{4}$/.test(d))
    .map((d) => ({ d, effective: JSON.parse(fs.readFileSync(path.join(CYCLES, d, 'airac.json'), 'utf8')).effective }))
    .sort((a, b) => a.effective.localeCompare(b.effective));
  return path.join(CYCLES, (cycles.filter((c) => c.effective <= today).at(-1) ?? cycles[0]).d);
}

/** A file of the cycle in effect, parsed: refJson('aerodromes.json'). */
export const refJson = (file) => JSON.parse(fs.readFileSync(path.join(cycleDir(), file), 'utf8'));
