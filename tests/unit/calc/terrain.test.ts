import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

import { lowLegs, TERRAIN_GRID, terrainFtAt, terrainMaxFt } from '../../../src/calc/terrain';

const G = TERRAIN_GRID;
/** A flat grid at sea level with one hill (a single cell) of `units` × 12 m at lat, lon. */
function gridWithHill(lat: number, lon: number, units: number) {
  const g = new Uint8Array(G.rows * G.cols);
  g[Math.floor((lat - G.south) / G.step) * G.cols + Math.floor((lon - G.west) / G.step)] = units;
  return g;
}
const pt = (lat: number, lon: number, kind = 'vfr') => ({ lat, lon, kind });

describe('terrain', () => {
  // 100 units = 1200 m = 3937 ft
  const g = gridWithHill(38.005, 23.505, 100);

  test('a point reads its cell; outside the grid is unknown', () => {
    expect(terrainFtAt(g, { lat: 38.005, lon: 23.505 })).toBeCloseTo(3937, 0);
    expect(terrainFtAt(g, { lat: 38.02, lon: 23.505 })).toBe(0);
    expect(Number.isNaN(terrainFtAt(g, { lat: 45, lon: 23 }))).toBe(true);
  });

  test('the highest cell the track crosses', () => {
    expect(terrainMaxFt(g, { lat: 38.005, lon: 23.4 }, { lat: 38.005, lon: 23.6 })).toBeCloseTo(3937, 0);
    expect(terrainMaxFt(g, { lat: 38.05, lon: 23.4 }, { lat: 38.05, lon: 23.6 })).toBe(0);
  });

  test('legs under 1000 ft above the ground, except to and from aerodromes', () => {
    const legs = [
      { from: pt(38.005, 23.4, 'aerodrome'), to: pt(38.005, 23.6) },
      { from: pt(38.005, 23.4), to: pt(38.005, 23.6) },
      { from: pt(38.005, 23.4), to: pt(38.005, 23.6) },
      { from: pt(38.005, 23.4), to: pt(38.005, 23.6) },
      { from: pt(38.005, 23.6), to: pt(38.005, 23.7, 'aerodrome') },
    ];
    const low = lowLegs(g, legs, [2000, 4500, 3500, 5000, 0]);
    expect(low).toEqual([
      { legIndex: 1, altFt: 4500, terrainFt: 3940, below: false },
      { legIndex: 2, altFt: 3500, terrainFt: 3940, below: true },
    ]);
  });

  test('the built grid: Olympus, the sea, Parnitha', () => {
    const grid = new Uint8Array(fs.readFileSync('public/terrain/greece.bin'));
    expect(grid.length).toBe(G.rows * G.cols);
    const olympusFt = terrainFtAt(grid, { lat: 40.0857, lon: 22.3586 });
    expect(olympusFt).toBeGreaterThan(9300); // 2918 m = 9573 ft
    expect(olympusFt).toBeLessThan(9700);
    expect(terrainFtAt(grid, { lat: 37.0, lon: 25.0 })).toBe(0); // Aegean
    const parnitha = terrainFtAt(grid, { lat: 38.1734, lon: 23.7178 }); // 1413 m = 4636 ft
    expect(parnitha).toBeGreaterThan(4400);
    expect(parnitha).toBeLessThan(4800);
  });
});
