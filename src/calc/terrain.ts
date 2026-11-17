// Height above the ground along a leg, from the terrain grid built by tools/build_terrain.py
// (public/terrain/greece.bin): the highest ground in each 0.01° cell, rounded up.
//
//   - A leg's terrain is the highest cell its track crosses (sampled every TERRAIN_GRID.sample°).
//   - A leg flown less than TERRAIN_CLEARANCE_FT above it is flagged, unless it starts or ends at an
//     aerodrome (climb-out, approach and circuits are low by nature).
import type { LatLon } from '../shared/types.js';

export const TERRAIN_GRID = {
  south: 34,
  west: 19,
  step: 0.01,
  rows: 800,
  cols: 1100,
  /** Metres per unit of a cell's byte. */
  unitM: 12,
  /** Sampling interval along a track, degrees (well under a cell). */
  sample: 0.003,
} as const;

export const TERRAIN_CLEARANCE_FT = 1000;
const M_TO_FT = 1 / 0.3048;

/** Highest ground at a point, ft; NaN outside the grid. */
export function terrainFtAt(grid: Uint8Array, p: LatLon): number {
  const g = TERRAIN_GRID;
  const r = Math.floor((p.lat - g.south) / g.step);
  const c = Math.floor((p.lon - g.west) / g.step);
  if (r < 0 || r >= g.rows || c < 0 || c >= g.cols) return NaN;
  return grid[r * g.cols + c] * g.unitM * M_TO_FT;
}

/** Highest ground along the track a → b, ft (NaN when any of it is outside the grid). */
export function terrainMaxFt(grid: Uint8Array, a: LatLon, b: LatLon): number {
  const n = Math.max(1, Math.ceil(Math.hypot(b.lat - a.lat, b.lon - a.lon) / TERRAIN_GRID.sample));
  let max = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const h = terrainFtAt(grid, { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    if (Number.isNaN(h)) return NaN;
    if (h > max) max = h;
  }
  return max;
}

export interface TerrainLeg {
  from: LatLon & { kind: string };
  to: LatLon & { kind: string };
}

export interface LowLeg {
  legIndex: number;
  altFt: number;
  /** Highest ground under the leg, ft (rounded up to 10 ft). */
  terrainFt: number;
  /** At or below the ground. */
  below: boolean;
}

/** The legs planned less than TERRAIN_CLEARANCE_FT above the ground, aerodrome legs excepted. */
export function lowLegs(grid: Uint8Array, legs: TerrainLeg[], altitudesFt: number[]): LowLeg[] {
  const out: LowLeg[] = [];
  legs.forEach((l, i) => {
    if (l.from.kind === 'aerodrome' || l.to.kind === 'aerodrome') return;
    const alt = altitudesFt[i];
    if (!Number.isFinite(alt)) return;
    const ground = terrainMaxFt(grid, l.from, l.to);
    if (!Number.isFinite(ground) || alt - ground >= TERRAIN_CLEARANCE_FT) return;
    out.push({ legIndex: i, altFt: alt, terrainFt: Math.ceil(ground / 10) * 10, below: alt <= ground });
  });
  return out;
}
