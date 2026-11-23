// The chart: the website's MapLibre style and the GeoJSON of its data sources.
import type { StyleSpecification } from 'maplibre-gl';

import { magneticVariation } from '../../calc';
import { visibleNotams } from '../../data/notams';
import { airspaceInfos, farFromRoute } from '../../features/editor/map/airspace';
import {
  aerodromeFeatures,
  airspaceFeatures,
  areaFeatures,
  firFeatures,
  focusFeatures,
  localAreaFeatures,
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
} from '../../features/editor/map/features';
import { airspaceShown } from '../../features/editor/map/mapPrefs';
import {
  mapNotams,
  NOTAM_LAYER_IDS,
  NOTAM_SOURCE,
  notamFeatures,
  notamLayers,
} from '../../features/editor/map/notamLayer';
import {
  AIR_SOURCES,
  type BaseMapId,
  buildStyle,
  CHART_DEFAULT_VALUES,
  DATA_SOURCES,
  FAR_OPACITY,
  FAR_OPACITY_PROP,
  farScaled,
  LAYER_GROUPS,
  LINE_STYLES,
} from '../../features/editor/map/style';
import { SYMBOL_INFO } from '../../features/editor/map/symbols';
import { DEFAULT_MAP_LAYERS, type Flight, type MapLayers, mapLayersOf, type Waypoint } from '../../shared';
import type { NotamBriefing } from '../../shared/briefing';
import { arg, type CoreRef, fin, type Json, plain, refOf } from './shared';

/** The chart's symbol images (the app draws them under these names), with what each looks like. */
export function symbolNames(): {
  name: string;
  size: number;
  colors: string[];
  rotates: boolean;
  pattern: boolean;
  description: string;
}[] {
  return Object.entries(SYMBOL_INFO).map(([name, s]) => ({
    name,
    size: s.size,
    colors: s.colors,
    rotates: !!s.rotates,
    pattern: !!s.pattern,
    description: s.description,
  }));
}

/** How the style draws each line and area (the legend beside the layer toggles draws its samples with
 *  these): colour as #rrggbb, width in points at zoom 10, dashes in line widths, the area's tint or
 *  hatching opacity, the hatching symbol, the route's white casing width. */
export function lineStyles(): Record<
  string,
  { color: string; width: number; dash: number[]; opacity: number; fill: number; hatch: string | null; casing: number }
> {
  return Object.fromEntries(
    Object.entries(LINE_STYLES).map(([k, st]) => [
      k,
      {
        color: CHART_DEFAULT_VALUES[st.color],
        width: st.width,
        dash: 'dash' in st ? [...st.dash] : [],
        opacity: st.opacity,
        fill: 'fill' in st ? st.fill : 0,
        hatch: 'hatch' in st ? st.hatch : null,
        casing: 'casing' in st ? st.casing : 0,
      },
    ]),
  );
}

/** The style's layers by the layer toggle (MapLayers key) that shows them. */
export function layerGroups(): Record<string, string[]> {
  const groups: Record<string, readonly string[]> = { ...LAYER_GROUPS, notams: NOTAM_LAYER_IDS };
  return Object.fromEntries(Object.entries(groups).map(([k, ids]) => [k, [...ids]]));
}

const FAR_PROPERTY: ['case', ['boolean', ['get', string], boolean], number, number] = [
  'case',
  ['boolean', ['get', 'far'], false],
  FAR_OPACITY,
  1,
];

/**
 * The MapLibre style: the website's (buildStyle) with the NOTAM areas under the route, the layers
 * shown as `layers` says (all of them by default), and the airspaces far from the route faded by
 * their `far` property (chartData sets it; the website uses a feature state for it).
 */
export function chartStyle(
  input: Json<{ base?: BaseMapId; vector?: StyleSpecification | null; layers?: Partial<MapLayers> | null }>,
): StyleSpecification {
  const i = arg(input);
  const layers = mapLayersOf(i.layers ?? null) ?? { ...DEFAULT_MAP_LAYERS };
  const base = i.base ?? layers.base;
  const { style } = buildStyle(base, layers.ofm, i.vector ?? null);
  style.sources[NOTAM_SOURCE] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  const at = style.layers.findIndex((l) => l.id === 'route-casing');
  style.layers.splice(at < 0 ? style.layers.length : at, 0, ...notamLayers());
  const groups = layerGroups();
  for (const l of style.layers) {
    for (const [k, ids] of Object.entries(groups))
      if (ids.includes(l.id))
        l.layout = { ...(l.layout ?? {}), visibility: layers[k as keyof MapLayers] ? 'visible' : 'none' } as never;
    const prop = FAR_OPACITY_PROP[l.type];
    if (prop && 'source' in l && typeof l.source === 'string' && AIR_SOURCES.includes(l.source)) {
      const paint = (l.paint ?? {}) as Record<string, unknown>;
      paint[prop] = farScaled(paint[prop] as never, FAR_PROPERTY);
      (l as { paint?: unknown }).paint = paint;
    }
  }
  return plain(style);
}

/** The GeoJSON of every data source of chartStyle, as the website's map fills them. */
export function chartData(
  input: Json<{
    ref?: CoreRef | null;
    flight: Pick<Flight, 'route' | 'options'>;
    notams?: NotamBriefing | null;
    layers?: Partial<MapLayers> | null;
    /** The pilot's saved waypoints (GET /api/waypoints), drawn as on the website. */
    waypoints?: Waypoint[] | null;
    /** Epoch ms (the date of the aerodrome symbols' magnetic variation); default now. */
    now?: number;
  }>,
): Record<string, unknown> {
  const i = arg(input);
  const r = refOf(i.ref).bundle;
  const flight = i.flight;
  const layers = mapLayersOf(i.layers ?? null) ?? mapLayersOf(flight?.options?.mapLayers ?? null) ?? DEFAULT_MAP_LAYERS;
  const route = flight?.route ?? [];
  const routeLatLon = route.map((p) => ({ lat: p.lat, lon: p.lon }));
  const allInfos = airspaceInfos(r.airspaces, r.adAirspaces, r.areas ?? [], r.fir);
  const airInfos = allInfos.filter((a) => airspaceShown(layers, a.type));
  const far = new Set(allInfos.filter((a) => farFromRoute(a, routeLatLon)).map((a) => a.id));
  const withFar = <T extends { features: { properties: unknown }[] }>(fc: T): T => {
    for (const f of fc.features) {
      const p = f.properties as { id?: string; far?: boolean };
      p.far = !!p.id && far.has(p.id);
    }
    return fc;
  };
  const day = new Date(fin(i.now) ? i.now : Date.now()).toISOString().slice(0, 10);
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const out: Record<string, unknown> = {
    airspaces: withFar(airspaceFeatures(allInfos)),
    zones: withFar(zoneFeatures(allInfos)),
    areas: withFar(areaFeatures(airInfos)),
    fir: firFeatures(r.fir),
    'vfr-routes': vfrRouteFeatures(r.vfrRoutes, r.vfrPoints),
    'vfr-route-arrows': vfrRouteArrowFeatures(r.vfrRoutes, r.vfrPoints),
    'vfr-points': vfrPointFeatures(r.vfrPoints),
    navaids: navaidFeatures(r.navaids),
    aerodromes: aerodromeFeatures(r.aerodromes, magneticVariation(38, 24, day)),
    waypoints: waypointFeatures(i.waypoints ?? []),
    'air-focus': focusFeatures(null),
    'local-area': localAreaFeatures(route),
    'route-line': routeLineFeatures(route),
    'leg-focus': routeLineFeatures([]),
    'route-arrows': routeArrowFeatures(route),
    'route-band': EMPTY,
    'route-mid': midpointFeatures(route),
    'route-points': routePointFeatures(route, null),
    snap: EMPTY,
    [NOTAM_SOURCE]: notamFeatures(mapNotams(visibleNotams(i.notams ?? null, false)), null),
  };
  for (const id of DATA_SOURCES) if (!(id in out)) out[id] = EMPTY;
  return plain(out);
}
