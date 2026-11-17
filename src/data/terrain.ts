// The terrain grid (public/terrain/greece.bin, src/calc/terrain.ts), fetched once when first needed.
import { useEffect, useState } from 'react';

import { TERRAIN_GRID } from '../calc/terrain';

const URL = '/terrain/greece.bin';
let pending: Promise<Uint8Array | null> | null = null;

/** The grid, or null when it cannot be had (tried again on the next call). */
export function loadTerrain(): Promise<Uint8Array | null> {
  pending ??= fetch(URL)
    .then(async (r) => {
      if (!r.ok) throw new Error(`terrain ${r.status}`);
      const g = new Uint8Array(await r.arrayBuffer());
      if (g.length !== TERRAIN_GRID.rows * TERRAIN_GRID.cols) throw new Error('terrain grid size');
      return g;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

/** The grid once loaded (null until then). */
export function useTerrain(): Uint8Array | null {
  const [grid, setGrid] = useState<Uint8Array | null>(null);
  useEffect(() => {
    let live = true;
    void loadTerrain().then((g) => {
      if (live) setGrid(g);
    });
    return () => {
      live = false;
    };
  }, []);
  return grid;
}
