// Route direction arrows, the route-point hover halo and the chart colours (design tokens).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../../../../shared';
import { ARROW_AT, routeArrowFeatures } from '../features';
import { buildStyle, CHART, CHART_DEFAULT_VALUES, CHART_TOKENS, loadChartTokens, type ChartColor } from '../style';
import { areaShown, areaToggle, DEFAULT_PREFS } from '../mapPrefs';

const p = (lat: number, lon: number): RoutePoint => ({ uid: `${lat},${lon}`, kind: 'custom', refId: null, name: 'P', lat, lon });

describe('route arrows', () => {
  it('puts two arrowheads on each leg, pointing along it (degrees clockwise from north)', () => {
    const fc = routeArrowFeatures([p(38, 23), p(38, 24), p(39, 24), p(38, 24)]);
    expect(fc.features).toHaveLength(3 * ARROW_AT.length);
    expect(fc.features.map((f) => f.properties.rot)).toEqual([90, 90, 0, 0, 180, 180]);
    expect(fc.features.map((f) => f.properties.leg)).toEqual([0, 0, 1, 1, 2, 2]);
    // along the drawn (Mercator-straight) line, clear of the middle where the insert handle is
    const [lon, lat] = fc.features[0].geometry.coordinates;
    expect(lon).toBeCloseTo(23.3, 6);
    expect(lat).toBeCloseTo(38, 6);
    const [, latN] = fc.features[2].geometry.coordinates;
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
    expect(areaShown({ ...DEFAULT_PREFS, mil: false }, 'MIL')).toBe(false);
    expect(areaShown({ ...DEFAULT_PREFS, mil: false }, 'R')).toBe(true);
  });
});
