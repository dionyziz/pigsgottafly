// PGF.chartStyle and PGF.chartData: the website's map style (buildStyle) with the NOTAM layers it adds
// at run time, and the same GeoJSON the website's map sets on each source (RouteMap.tsx).
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, test } from 'vitest';

import { magneticVariation } from '../../../src/calc';
import { visibleNotams } from '../../../src/data/notams';
import { REF } from '../../../src/data/ref';
import { airspaceInfos } from '../../../src/features/editor/map/airspace';
import {
  aerodromeFeatures,
  airspaceFeatures,
  areaFeatures,
  firFeatures,
  midpointFeatures,
  navaidFeatures,
  routeArrowFeatures,
  routeLineFeatures,
  routePointFeatures,
  vfrPointFeatures,
  vfrRouteArrowFeatures,
  vfrRouteFeatures,
  waypointFeatures,
  zoneFeatures,
} from '../../../src/features/editor/map/features';
import { airspaceShown } from '../../../src/features/editor/map/mapPrefs';
import { mapNotams, notamFeatures } from '../../../src/features/editor/map/notamLayer';
import { buildStyle, DATA_SOURCES, LAYER_GROUPS, LINE_STYLES } from '../../../src/features/editor/map/style';
import { SYMBOLS } from '../../../src/features/editor/map/symbols';
import { chartData, chartStyle, layerGroups, lineStyles, symbolNames } from '../../../src/native/core';
import { DEFAULT_MAP_LAYERS, type MapLayers, type Waypoint } from '../../../src/shared';
import { API_REF, briefing, flight, notam, NOW, ROUTE } from './fixtures';

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('chartStyle', () => {
  for (const base of ['light', 'terrain', 'street'] as const)
    test(`${base}: a valid style whose every layer has its source; the website's layers plus the NOTAM areas`, () => {
      const style = chartStyle({ base, vector: null });
      expect(validateStyleMin(style as never).map((e: { message: string }) => e.message)).toEqual([]);
      for (const l of style.layers) if ('source' in l) expect(style.sources[l.source], l.id).toBeDefined();
      const web = buildStyle(base, false, null).style.layers.map((l) => l.id);
      const ids = style.layers.map((l) => l.id);
      const at = web.indexOf('route-casing');
      expect(ids).toEqual([...web.slice(0, at), 'notam-fill', 'notam-line', ...web.slice(at)]);
      expect(Object.keys(style.sources).sort()).toEqual(
        [...Object.keys(buildStyle(base, false, null).style.sources), 'notam-areas'].sort(),
      );
      const shown = style.layers.find((l) => l.id === `base-${base}` || l.id.startsWith(`vb-${base}`))!;
      expect(shown.layout?.visibility).toBe('visible');
    });

  test('with the vector base style: its sources and layers, as the website', () => {
    const vector = {
      version: 8 as const,
      sources: { openmaptiles: { type: 'vector' as const, url: 'https://tiles.openfreemap.org/planet' } },
      sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
      layers: [
        { id: 'background', type: 'background' as const, paint: { 'background-color': '#fff' } },
        { id: 'water', type: 'fill' as const, source: 'openmaptiles', 'source-layer': 'water' },
      ],
    };
    const style = chartStyle(JSON.stringify({ base: 'light', vector }));
    expect(style.layers.slice(0, 2).map((l) => [l.id, l.layout?.visibility])).toEqual([
      ['vb-light:background', 'visible'],
      ['vb-light:water', 'visible'],
    ]);
    expect(style.sprite).toBe(vector.sprite);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  test('the layer toggles set the layers’ visibility; far airspaces fade by their `far` property', () => {
    const layers: MapLayers = { ...DEFAULT_MAP_LAYERS, tma: false, notams: false, ofm: true };
    const style = chartStyle({ base: 'terrain', vector: null, layers });
    const vis = (id: string) => style.layers.find((l) => l.id === id)!.layout?.visibility;
    for (const id of LAYER_GROUPS.tma) expect(vis(id)).toBe('none');
    for (const id of LAYER_GROUPS.zones) expect(vis(id)).toBe('visible');
    expect(vis('notam-fill')).toBe('none');
    expect(vis('ofm')).toBe('visible');
    const fill = style.layers.find((l) => l.id === 'airspace-fill')!;
    expect(JSON.stringify(fill.paint)).toContain('["get","far"]');
    expect(layerGroups().notams).toEqual(['notam-fill', 'notam-line']);
  });

  test('symbolNames: every symbol image the style uses, described', () => {
    const names = symbolNames().map((s) => s.name);
    expect(names.sort()).toEqual(Object.keys(SYMBOLS).sort());
    const style = JSON.stringify(chartStyle({ base: 'light', vector: null }));
    for (const n of ['pgf-arrow', 'pgf-wpt', 'pgf-route-arrow', 'pgf-hatch-r']) expect(style).toContain(`"${n}"`);
    for (const s of symbolNames()) expect(s.description.length).toBeGreaterThan(20);
  });

  test('lineStyles: the legend samples’ line styles, as the style draws them, colours resolved', () => {
    const st = lineStyles();
    expect(Object.keys(st).sort()).toEqual(Object.keys(LINE_STYLES).sort());
    for (const v of Object.values(st)) expect(v.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(st.mtma).toEqual({
      color: '#8a3b9c',
      width: 2,
      dash: [4, 2],
      opacity: 0.75,
      fill: 0.025,
      hatch: null,
      casing: 0,
    });
    expect(st.restricted.hatch).toBe('pgf-hatch-r');
    expect(st.route.casing).toBe(7.5);
    const line = chartStyle({ base: 'light', vector: null }).layers.find((l) => l.id === 'airspace-line-m')!;
    expect((line.paint as Record<string, unknown>)['line-dasharray']).toEqual(st.mtma.dash);
  });
});

describe('chartData', () => {
  const f = flight(ROUTE());
  const waypoints = [{ id: 'w1', name: 'HOME', lat: 38.1, lon: 23.8, note: '' } as unknown as Waypoint];
  const notams = briefing([notam(), notam({ key: 'A2/26', relevant: false, center: { lat: 37.5, lon: 23 } })]);
  const layers: MapLayers = { ...DEFAULT_MAP_LAYERS, mil: false };
  const data = chartData({ ref: API_REF, flight: f, notams, layers, waypoints, now: NOW }) as Record<
    string,
    { features: { properties: Record<string, unknown> }[] }
  >;
  const withoutFar = (fc: { features: { properties: Record<string, unknown> }[] }) =>
    json({ ...fc, features: fc.features.map((x) => ({ ...x, properties: { ...x.properties, far: undefined } })) });

  test('a collection for every data source of the style', () => {
    expect(Object.keys(data).sort()).toEqual([...DATA_SOURCES, 'notam-areas'].sort());
    const style = chartStyle({ base: 'light', vector: null });
    for (const [id, src] of Object.entries(style.sources))
      if (src.type === 'geojson') expect(data[id], id).toMatchObject({ type: 'FeatureCollection' });
  });

  test('the same features as the website’s map for the same flight, reference data and layers', () => {
    const all = airspaceInfos(REF.airspaces, REF.adAirspaces ?? [], REF.areas ?? [], REF.fir);
    const shown = all.filter((a) => airspaceShown(layers, a.type));
    expect(withoutFar(data.airspaces)).toEqual(json(airspaceFeatures(all)));
    expect(withoutFar(data.zones)).toEqual(json(zoneFeatures(all)));
    expect(withoutFar(data.areas)).toEqual(json(areaFeatures(shown)));
    expect(data.areas.features.length).toBeLessThan(areaFeatures(all).features.length); // MIL hidden
    expect(data.fir).toEqual(json(firFeatures(REF.fir)));
    expect(data['vfr-routes']).toEqual(json(vfrRouteFeatures(REF.vfrRoutes, REF.vfrPoints)));
    expect(data['vfr-route-arrows']).toEqual(json(vfrRouteArrowFeatures(REF.vfrRoutes, REF.vfrPoints)));
    expect(data['vfr-points']).toEqual(json(vfrPointFeatures(REF.vfrPoints)));
    expect(data.navaids).toEqual(json(navaidFeatures(REF.navaids ?? [])));
    const variation = magneticVariation(38, 24, new Date(NOW).toISOString().slice(0, 10));
    expect(data.aerodromes).toEqual(json(aerodromeFeatures(REF.aerodromes, variation)));
    expect(data.waypoints).toEqual(json(waypointFeatures(waypoints)));
    expect(data['route-line']).toEqual(json(routeLineFeatures(f.route)));
    expect(data['route-arrows']).toEqual(json(routeArrowFeatures(f.route)));
    expect(data['route-points']).toEqual(json(routePointFeatures(f.route, null)));
    expect(data['route-mid']).toEqual(json(midpointFeatures(f.route)));
    expect(data['notam-areas']).toEqual(json(notamFeatures(mapNotams(visibleNotams(notams, false)), null)));
    expect(data['notam-areas'].features).toHaveLength(1); // the hidden one is not drawn
    for (const id of ['route-band', 'snap', 'leg-focus', 'air-focus']) expect(data[id].features).toEqual([]);
  });

  test('airspaces far from the route are marked far (the website fades them by a feature state)', () => {
    const far = (fc: { features: { properties: Record<string, unknown> }[] }, id: string) =>
      fc.features.find((x) => x.properties.id === id)?.properties.far;
    expect(far(data.zones, 'LGTT-ATZ')).toBe(false);
    expect(far(data.zones, 'LGRP-CTR')).toBe(true);
    // no route: nothing is far
    const none = chartData({ flight: flight([]), now: NOW }) as typeof data;
    expect(none.zones.features.every((x) => x.properties.far === false)).toBe(true);
  });
});
