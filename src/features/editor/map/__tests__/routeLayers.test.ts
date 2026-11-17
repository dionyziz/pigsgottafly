// Route direction arrows, the route-point hover halo, the layer toggles, the FIR and the chart colours (design tokens).
import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FIR } from '../../../../data/ref';
import type { RoutePoint } from '../../../../shared';
import { DEFAULT_MAP_LAYERS, mapLayersOf } from '../../../../shared/mapLayers';
import { ARROW_AT, firFeatures, routeArrowFeatures } from '../features';
import { airspaceShown, areaShown, areaToggle, flightLayers, legacyLayers } from '../mapPrefs';
import {
  buildStyle,
  CHART,
  CHART_DEFAULT_VALUES,
  CHART_TOKENS,
  type ChartColor,
  LAYER_GROUPS,
  loadChartTokens,
} from '../style';

const p = (lat: number, lon: number): RoutePoint => ({
  uid: `${lat},${lon}`,
  kind: 'custom',
  refId: null,
  name: 'P',
  lat,
  lon,
});

describe('route arrows', () => {
  it('puts two arrowheads on each leg, pointing along it (degrees clockwise from north)', () => {
    const fc = routeArrowFeatures([p(38, 23), p(38, 24), p(39, 24), p(38, 24)]);
    // legs 1 and 2 are the same line flown both ways: one arrow each, near each one's end
    expect(fc.features).toHaveLength(ARROW_AT.length + 2);
    expect(fc.features.map((f) => f.properties.rot)).toEqual([90, 90, 0, 180]);
    expect(fc.features.map((f) => f.properties.leg)).toEqual([0, 0, 1, 2]);
    const [, latUp] = fc.features[2].geometry.coordinates;
    const [, latDown] = fc.features[3].geometry.coordinates;
    expect(latUp).toBeGreaterThan(38.69);
    expect(latDown).toBeLessThan(38.31);
    // along the drawn (Mercator-straight) line, clear of the middle where the insert handle is
    const [lon, lat] = fc.features[0].geometry.coordinates;
    expect(lon).toBeCloseTo(23.3, 6);
    expect(lat).toBeCloseTo(38, 6);
    const [, latN] = routeArrowFeatures([p(38, 24), p(39, 24)]).features[0].geometry.coordinates;
    expect(latN).toBeGreaterThan(38.29);
    expect(latN).toBeLessThan(38.31);
  });
  it('skips a leg that goes nowhere and a route without legs', () => {
    expect(routeArrowFeatures([p(38, 23), p(38, 23)]).features).toEqual([]);
    expect(routeArrowFeatures([p(38, 23)]).features).toEqual([]);
    const ne = routeArrowFeatures([p(38, 23), p(39, 24)]).features[0].properties.rot as number;
    expect(ne).toBeGreaterThan(30);
    expect(ne).toBeLessThan(45);
  });
});

describe('route layers', () => {
  it('draws the arrows over the line and the hover halo under the points, with hover ids on the points', () => {
    const { style } = buildStyle('light', false, null);
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf('route-arrows')).toBe(ids.indexOf('route-line') + 1);
    expect(ids.indexOf('route-point-halo')).toBe(ids.indexOf('route-points') - 1);
    expect((style.sources['route-points'] as { generateId?: boolean }).generateId).toBe(true);
    expect(style.sources['route-arrows']).toBeDefined();
  });
});

describe('layer toggles and the FIR', () => {
  it('every toggled layer exists in the style', () => {
    const ids = new Set(buildStyle('light', false, null).style.layers.map((l) => l.id));
    for (const g of Object.values(LAYER_GROUPS)) for (const id of g) expect(ids.has(id), id).toBe(true);
  });
  it('draws the LGGG boundary (closed, through the AIP points) and the ATHINAI | MAKEDONIA line ending on it', () => {
    const fc = firFeatures(FIR);
    const fir = fc.features.find((f) => f.properties.kind === 'fir')!;
    const div = fc.features.find((f) => f.properties.kind === 'divider')!;
    expect(fir.properties.label).toBe('LGGG ATHINAI FIR');
    expect(div.properties.label).toBe('ATHINAI | MAKEDONIA');
    const ring = fir.geometry.coordinates;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const has = (lon: number, lat: number) =>
      ring.some(([x, y]) => Math.abs(x - lon) < 1e-4 && Math.abs(y - lat) < 1e-4);
    expect(has(30, 36 + 5 / 60) && has(30, 33.5) && has(19, 36.5) && has(19, 40 + 25 / 60)).toBe(true);
    // the dividing line ends on the boundary at 381449N 0261010E
    const end = div.geometry.coordinates[div.geometry.coordinates.length - 1];
    expect(has(end[0], end[1])).toBe(true);
    expect(div.geometry.coordinates).toHaveLength(6);
    // the land borders reach the Bulgarian and Turkish tripoint area (about 41.7N 26.3E)
    expect(Math.max(...ring.map(([, y]) => y))).toBeGreaterThan(41.7);
    expect(firFeatures(undefined).features).toEqual([]);
  });
});

describe('chart colours', () => {
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  it('are the --map-* tokens of the stylesheet, with the same defaults', () => {
    const css = read('../../../../app/styles.css');
    const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();
    for (const [k, token] of Object.entries(CHART_TOKENS)) {
      const m = css.match(new RegExp(`${token}:\\s*([^;]+);`));
      expect(m, token).not.toBeNull();
      expect(norm(m![1]), token).toBe(norm(CHART_DEFAULT_VALUES[k as ChartColor]));
    }
  });
  it('the map stylesheet uses tokens, not colour literals', () => {
    expect(read('../map.css').match(/#[0-9a-f]{3,8}\b|rgba?\(/gi)).toBeNull();
  });
  it('loadChartTokens takes the page values and keeps the defaults for unset tokens', () => {
    const values: Record<string, string> = { '--map-route': ' #ff0000 ' };
    const g = globalThis as { getComputedStyle?: unknown };
    const prev = g.getComputedStyle;
    g.getComputedStyle = () => ({ getPropertyValue: (n: string) => values[n] ?? '' });
    try {
      loadChartTokens({} as Element);
      expect(CHART.route).toBe('#ff0000');
      expect(CHART.tma).toBe(CHART_DEFAULT_VALUES.tma);
    } finally {
      g.getComputedStyle = prev;
      Object.assign(CHART, CHART_DEFAULT_VALUES);
    }
  });
});

describe('map prefs', () => {
  it('maps each ENR 5 area kind to its toggle', () => {
    expect(['P', 'R', 'D', 'MIL', 'ACT'].map(areaToggle)).toEqual(['prd', 'prd', 'prd', 'mil', 'act']);
    expect(areaShown({ ...DEFAULT_MAP_LAYERS, mil: false }, 'MIL')).toBe(false);
    expect(areaShown({ ...DEFAULT_MAP_LAYERS, mil: false }, 'R')).toBe(true);
  });
  it('TMA/MTMA and CTR/ATZ details follow their own toggles', () => {
    const l = { ...DEFAULT_MAP_LAYERS, tma: false };
    expect(['TMA', 'MTMA', 'CTR', 'ATZ', 'D'].map((t) => airspaceShown(l, t))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(airspaceShown({ ...DEFAULT_MAP_LAYERS, zones: false }, 'ATZ')).toBe(false);
  });
  it("a flight keeps its own layers; else the pilot's setting; else what the browser used; else all", () => {
    const store = new Map<string, string>();
    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    try {
      expect(flightLayers(undefined, null)).toEqual(DEFAULT_MAP_LAYERS);
      store.set(
        'pgf:map',
        JSON.stringify({
          base: 'terrain',
          ofm: false,
          chart: false,
          tips: true,
          notams: true,
          prd: true,
          mil: true,
          act: true,
        }),
      );
      const legacy = legacyLayers()!;
      expect([legacy.base, legacy.tma, legacy.aerodromes, legacy.notams]).toEqual(['terrain', false, false, true]);
      expect(flightLayers(undefined, undefined)).toEqual(legacy);
      expect(flightLayers(null, { ...DEFAULT_MAP_LAYERS, vfrRoutes: false }).vfrRoutes).toBe(false);
      expect(
        flightLayers({ ...DEFAULT_MAP_LAYERS, base: 'street' }, { ...DEFAULT_MAP_LAYERS, vfrRoutes: false }),
      ).toEqual({ ...DEFAULT_MAP_LAYERS, base: 'street' });
    } finally {
      g.localStorage = prev;
    }
  });
  it('a stored selection is completed and checked', () => {
    expect(mapLayersOf('x')).toBeNull();
    expect(mapLayersOf({ base: 'moon', tma: 'no', zones: false, junk: 1 })).toEqual({
      ...DEFAULT_MAP_LAYERS,
      zones: false,
    });
  });
});
