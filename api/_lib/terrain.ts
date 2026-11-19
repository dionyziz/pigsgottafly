// The terrain grid (public/terrain/greece.bin, src/calc/terrain.ts) on the server: read once from the
// deployment (vercel.json includes it in the API function); null when missing or malformed.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { TERRAIN_GRID } from '../../src/calc/terrain.js';

let grid: Uint8Array | null | undefined;

export function serverTerrain(): Uint8Array | null {
  if (grid === undefined) {
    try {
      const b = readFileSync(path.join(process.cwd(), 'public', 'terrain', 'greece.bin'));
      grid = b.length === TERRAIN_GRID.rows * TERRAIN_GRID.cols ? new Uint8Array(b) : null;
    } catch {
      grid = null;
    }
  }
  return grid;
}
