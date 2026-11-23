// Map style: keyless raster base maps, the optional openflightmaps aero overlay, and the VFR-chart
// vector layers drawn from our reference data, plus the route layers.
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

import type { BaseMapId } from '../../../shared/mapLayers';

/** Chart palette (kept close to ICAO VFR charts, calm against the light base map). The values are the
 *  --map-* tokens of src/app/styles.css: loadChartTokens() reads them from the page before the map is
 *  built; these defaults are the same values (Node, unit tests). */
const CHART_DEFAULTS = {
  aerodrome: '#1d3f8f',
  /** Radio navaids (VOR, DME, NDB, locator symbols and their labels). */
  navaid: '#0e5a78',
  tma: '#2f64c0',
  mtma: '#8a3b9c',
  zone: '#b4235a',
  /** Class G aerodrome zones (AFIS / uncontrolled ATZ). */
  zoneG: '#4f7d86',
  fis: '#6b7480',
  /** ENR 5 areas: prohibited (red, tinted), restricted (red, hatched), danger (amber, dashed),
   *  military exercise / training (violet, dash-dot), other activities (green, dotted). */
  prohibited: '#b71c1c',
  restricted: '#c62828',
  danger: '#b45309',
  mil: '#5b4a8a',
  act: '#2e7d32',
  vfr: '#1e6b46',
  waypoint: '#7a3db8',
  route: '#c2185b',
  /** Chart white: route casing, route points, symbol outlines. */
  paper: '#ffffff',
  halo: 'rgba(255, 255, 255, 0.92)',
  /** NOTAM areas: relevant, hidden by the filters, picked in the panel. */
  notam: '#c77700',
  notamOff: '#7a828c',
  notamSelected: '#1f5fbf',
  /** Weather hazard bands and rings (and the leg-label badge). */
  hazard: '#d64545',
  hazardWarn: '#d49a06',
};
export type ChartColor = keyof typeof CHART_DEFAULTS;

export const CHART_TOKENS: Record<ChartColor, string> = {
  aerodrome: '--map-aerodrome',
  navaid: '--map-navaid',
  tma: '--map-tma',
  mtma: '--map-mtma',
  zone: '--map-zone',
  zoneG: '--map-zone-g',
  fis: '--map-fis',
  prohibited: '--map-prohibited',
  restricted: '--map-restricted',
  danger: '--map-danger-area',
  mil: '--map-mil',
  act: '--map-activity',
  vfr: '--map-vfr',
  waypoint: '--map-waypoint',
  route: '--map-route',
  paper: '--map-paper',
  halo: '--map-halo',
  notam: '--map-notam',
  notamOff: '--map-notam-off',
  notamSelected: '--map-notam-selected',
  hazard: '--map-hazard',
  hazardWarn: '--map-hazard-warn',
};
export const CHART_DEFAULT_VALUES: Readonly<Record<ChartColor, string>> = CHART_DEFAULTS;

/** The defaults until loadChartTokens(). */
export const CHART: Record<ChartColor, string> = { ...CHART_DEFAULTS };

/** A token that is not set keeps its default. */
export function loadChartTokens(
  root: Element | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root || typeof getComputedStyle === 'undefined') return;
  const cs = getComputedStyle(root);
  for (const k of Object.keys(CHART_TOKENS) as ChartColor[]) {
    const v = cs.getPropertyValue(CHART_TOKENS[k]).trim();
    if (v) CHART[k] = v;
  }
}

export type { BaseMapId };

interface RasterBase {
  id: BaseMapId;
  label: string;
  kind: 'raster';
  tiles: string[];
  maxzoom: number;
  attribution: string;
}
interface VectorBase {
  id: BaseMapId;
  label: string;
  kind: 'vector';
  styleUrl: string;
}

const OSM_ATTR =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/** Keyless base maps. "Light" is the OpenFreeMap Positron vector style (no key, no registration). */
export const BASE_MAPS: (RasterBase | VectorBase)[] = [
  { id: 'light', label: 'Light', kind: 'vector', styleUrl: 'https://tiles.openfreemap.org/styles/positron' },
  {
    id: 'terrain',
    label: 'Terrain',
    kind: 'raster',
    tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    maxzoom: 17,
    attribution: `${OSM_ATTR}, SRTM · style © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)`,
  },
  {
    id: 'street',
    label: 'Street',
    kind: 'raster',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
    attribution: OSM_ATTR,
  },
];

let vectorCache: Promise<StyleSpecification | null> | null = null;
/** The vector base style (fetched once; null when unreachable, then "Light" falls back to OSM tiles). */
export function loadVectorBase(timeoutMs = 6000): Promise<StyleSpecification | null> {
  const vb = BASE_MAPS.find((b): b is VectorBase => b.kind === 'vector');
  if (!vb) return Promise.resolve(null);
  if (!vectorCache) {
    vectorCache = (async () => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const r = await fetch(vb.styleUrl, { signal: ctl.signal });
        if (!r.ok) return null;
        const st = (await r.json()) as StyleSpecification;
        return st && st.version === 8 && Array.isArray(st.layers) ? st : null;
      } catch {
        return null;
      } finally {
        clearTimeout(t);
      }
    })();
    void vectorCache.then((v) => {
      if (!v) vectorCache = null;
    }); // retry next time
  }
  return vectorCache;
}

/**
 * openflightmaps aero overlay (transparent PNG tiles, no key; verified 2026-11 with CORS *).
 * The data are the current OFM AIRAC for the LGGG region.
 */
export const OFM_TILES = 'https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest';
export const OFM_ATTRIBUTION =
  'Aero data © <a href="https://www.openflightmaps.org" target="_blank" rel="noopener">open flightmaps</a>';

/** Keyless glyphs for the vector labels (OpenFreeMap). */
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const REG = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];

/** LGGG (Athinai FIR) at a glance, [west, south, east, north]. */
export const LGGG_BOUNDS: [number, number, number, number] = [19.2, 34.6, 29.8, 41.9];

const EMPTY = { type: 'FeatureCollection', features: [] } as const;

/** Sources that carry our own data (setData later). */
export const DATA_SOURCES = [
  'airspaces',
  'zones',
  'areas',
  'fir',
  'vfr-routes',
  'vfr-route-arrows',
  'vfr-points',
  'navaids',
  'aerodromes',
  'waypoints',
  'air-focus',
  'local-area',
  'route-line',
  'leg-focus',
  'route-arrows',
  'route-band',
  'route-mid',
  'route-points',
  'snap',
] as const;
export type DataSourceId = (typeof DATA_SOURCES)[number];

/** Layers making up each base map, with the visibility each has when that base is shown. */
export type BaseLayers = Record<BaseMapId, { id: string; visible: boolean }[]>;

export function buildStyle(
  base: BaseMapId,
  ofm: boolean,
  vector: StyleSpecification | null,
): { style: StyleSpecification; baseLayers: BaseLayers } {
  const sources: StyleSpecification['sources'] = {};
  const layers: LayerSpecification[] = [];
  const baseLayers = { light: [], terrain: [], street: [] } as BaseLayers;
  const vis = (id: BaseMapId, visible = true): 'visible' | 'none' => (id === base && visible ? 'visible' : 'none');
  let sprite: StyleSpecification['sprite'];
  for (const b of BASE_MAPS) {
    if (b.kind === 'vector') {
      if (vector) {
        for (const [k, v] of Object.entries(vector.sources)) sources[k] = v;
        sprite = vector.sprite;
        for (const l of vector.layers) {
          const visible = (l as { layout?: { visibility?: string } }).layout?.visibility !== 'none';
          const id = `vb-${b.id}:${l.id}`;
          baseLayers[b.id].push({ id, visible });
          layers.push({
            ...l,
            id,
            layout: { ...((l as { layout?: object }).layout ?? {}), visibility: vis(b.id, visible) },
          });
        }
      } else {
        // offline / unreachable: OSM raster tiles stand in
        const osm = BASE_MAPS.find((x): x is RasterBase => x.id === 'street')!;
        sources[`base-${b.id}`] = {
          type: 'raster',
          tiles: osm.tiles,
          tileSize: 256,
          maxzoom: osm.maxzoom,
          attribution: osm.attribution,
        };
        layers.push({
          id: `base-${b.id}`,
          type: 'raster',
          source: `base-${b.id}`,
          layout: { visibility: vis(b.id) },
          paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.85 },
        });
        baseLayers[b.id].push({ id: `base-${b.id}`, visible: true });
      }
    } else {
      sources[`base-${b.id}`] = {
        type: 'raster',
        tiles: b.tiles,
        tileSize: 256,
        maxzoom: b.maxzoom,
        attribution: b.attribution,
      };
      layers.push({
        id: `base-${b.id}`,
        type: 'raster',
        source: `base-${b.id}`,
        layout: { visibility: vis(b.id) },
        paint: { 'raster-fade-duration': 150 },
      });
      baseLayers[b.id].push({ id: `base-${b.id}`, visible: true });
    }
  }
  sources.ofm = {
    type: 'raster',
    tiles: [OFM_TILES],
    tileSize: 256,
    minzoom: 6,
    maxzoom: 12,
    attribution: OFM_ATTRIBUTION,
  };
  layers.push({
    id: 'ofm',
    type: 'raster',
    source: 'ofm',
    layout: { visibility: ofm ? 'visible' : 'none' },
    paint: { 'raster-fade-duration': 150 },
  });
  for (const id of DATA_SOURCES) {
    sources[id] = {
      type: 'geojson',
      data: EMPTY as never,
      // hover feature-state keyed by the feature's index (midpoint handles, route points)
      ...(id === 'route-mid' || id === 'route-points' ? { generateId: true } : {}),
      // airspace hover highlight (feature-state keyed by the airspace id)
      ...(id === 'airspaces' || id === 'zones' || id === 'areas' ? { promoteId: 'id' } : {}),
    };
  }
  layers.push(...chartLayers(), ...routeLayers());
  const style: StyleSpecification = { version: 8, glyphs: GLYPHS, sources, layers };
  if (sprite) style.sprite = sprite;
  return { style, baseLayers };
}

/** Our chart layers by the layer toggle that shows them (MapLayers). The ENR 5 areas are always
 *  visible: their toggles filter the data (one per area kind). */
export const LAYER_GROUPS = {
  fir: ['fir-line', 'fir-divider', 'fir-label', 'fir-divider-label'],
  tma: ['airspace-fill', 'airspace-line', 'airspace-line-m', 'airspace-label'],
  zones: ['zone-fill', 'zone-line', 'zone-line-atz', 'zone-label'],
  aerodromes: ['aerodrome-icon', 'aerodrome-label'],
  vfrPoints: ['vfr-point-icon', 'vfr-point-label'],
  vfrRoutes: ['vfr-route-line', 'vfr-route-arrow', 'vfr-route-alt'],
  helRoutes: ['hel-route-line', 'hel-route-arrow', 'hel-route-alt'],
  milRoutes: ['mil-route-line', 'mil-route-arrow', 'mil-route-alt'],
  navaids: ['navaid-icon', 'navaid-label'],
  waypoints: ['waypoint-icon', 'waypoint-label'],
} as const satisfies Record<string, readonly string[]>;

/** Airspaces further than this from the route are drawn faint… */
export const FAR_NM = 10;
/** …at this share of their opacity. */
export const FAR_OPACITY = 0.3;
/** The sources of the airspaces and areas (drawn faint when far from the route). */
export const AIR_SOURCES: readonly string[] = ['airspaces', 'zones', 'areas'];
/** The opacity property that fades a layer of each type. */
export const FAR_OPACITY_PROP: Record<string, 'fill-opacity' | 'line-opacity' | 'text-opacity'> = {
  fill: 'fill-opacity',
  line: 'line-opacity',
  symbol: 'text-opacity',
};

/** An opacity value scaled by `far` (an expression giving FAR_OPACITY when the feature is far, else 1). */
export function farScaled(
  v: ExpressionSpecification | number | undefined,
  far: ExpressionSpecification,
): ExpressionSpecification {
  const value = v ?? 1;
  // a zoom curve must stay the top-level expression: scale each of its outputs instead
  const isZoomCurve =
    Array.isArray(value) &&
    (value[0] === 'interpolate' || value[0] === 'step') &&
    JSON.stringify(value).includes('"zoom"');
  return (
    isZoomCurve
      ? // outputs: [interpolate, type, input, z, OUT, z, OUT…] and [step, input, OUT, z, OUT…]
        value.map((x, i) => (i >= (value[0] === 'interpolate' ? 4 : 2) && i % 2 === 0 ? ['*', x, far] : x))
      : ['*', value, far]
  ) as ExpressionSpecification;
}

/** ENR 5 areas in VFR-chart style: P red tint, R red hatching, D amber dashed, MIL violet dash-dot, ACT green dotted. */
function areaLayers(hov: ExpressionSpecification): LayerSpecification[] {
  const kind = (...k: string[]): ExpressionSpecification => ['in', ['get', 'kind'], ['literal', k]];
  const color: ExpressionSpecification = [
    'match',
    ['get', 'kind'],
    'P',
    CHART.prohibited,
    'R',
    CHART.restricted,
    'D',
    CHART.danger,
    'MIL',
    CHART.mil,
    CHART.act,
  ];
  const width = (base: number): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['zoom'],
    6,
    ['case', hov, base + 1.2, base * 0.7],
    10,
    ['case', hov, base + 1.6, base],
  ];
  return [
    {
      id: 'area-fill',
      type: 'fill',
      source: 'areas',
      filter: ['!', kind('R')],
      paint: {
        'fill-color': color,
        'fill-opacity': ['+', ['case', hov, 0.08, 0], ['match', ['get', 'kind'], 'P', 0.16, 'D', 0.07, 0.04]],
      },
    },
    {
      id: 'area-hatch',
      type: 'fill',
      source: 'areas',
      filter: kind('R'),
      paint: { 'fill-pattern': 'pgf-hatch-r', 'fill-opacity': ['case', hov, 1, 0.8] },
    },
    {
      id: 'area-line',
      type: 'line',
      source: 'areas',
      filter: kind('P', 'R'),
      paint: { 'line-color': color, 'line-width': width(2), 'line-opacity': 0.9 },
    },
    {
      id: 'area-line-d',
      type: 'line',
      source: 'areas',
      filter: kind('D'),
      paint: { 'line-color': color, 'line-width': width(1.8), 'line-dasharray': [3, 1.6], 'line-opacity': 0.9 },
    },
    {
      id: 'area-line-mil',
      type: 'line',
      source: 'areas',
      filter: kind('MIL'),
      paint: { 'line-color': color, 'line-width': width(1.4), 'line-dasharray': [5, 2, 1, 2], 'line-opacity': 0.75 },
    },
    {
      id: 'area-line-act',
      type: 'line',
      source: 'areas',
      filter: kind('ACT'),
      paint: { 'line-color': color, 'line-width': width(1.6), 'line-dasharray': [1, 1.6], 'line-opacity': 0.85 },
    },
    {
      id: 'area-label',
      type: 'symbol',
      source: 'areas',
      minzoom: 7.5,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 360,
        'text-field': ['get', 'label'],
        'text-font': BOLD,
        'text-size': 9.5,
        'text-letter-spacing': 0.03,
        'text-offset': [0, 0.85],
        'text-max-angle': 30,
        'text-keep-upright': true,
      },
      paint: { 'text-color': color, 'text-halo-color': CHART.halo, 'text-halo-width': 1.4 },
    },
  ];
}

/** The VFR route layers of each kind (features.ts vfrRouteFeatures `kind`), by layer-id prefix: the
 *  helicopter and military / jet routes are drawn apart from the ordinary ones (dashed, dash-dot) so a
 *  pilot who shows them does not take one for a route open to every flight. */
const VFR_ROUTE_KINDS: {
  prefix: 'vfr-route' | 'hel-route' | 'mil-route';
  kinds: string[];
  color: ChartColor;
  dash?: number[];
}[] = [
  { prefix: 'vfr-route', kinds: ['vfr'], color: 'vfr' },
  { prefix: 'hel-route', kinds: ['hel'], color: 'vfr', dash: [3, 2] },
  { prefix: 'mil-route', kinds: ['mil', 'jet'], color: 'mil', dash: [5, 2, 1, 2] },
];

function vfrRouteLayers(): LayerSpecification[] {
  return VFR_ROUTE_KINDS.flatMap(({ prefix, kinds, color, dash }): LayerSpecification[] => {
    const filter: ExpressionSpecification = ['in', ['get', 'kind'], ['literal', kinds]];
    return [
      {
        id: `${prefix}-line`,
        type: 'line',
        source: 'vfr-routes',
        minzoom: 7.5,
        filter,
        paint: {
          'line-color': CHART[color],
          'line-width': ['interpolate', ['linear'], ['zoom'], 7.5, 0.8, 11, 1.8],
          'line-opacity': 0.7,
          ...(dash ? { 'line-dasharray': dash } : {}),
        },
      },
      {
        // one arrow per direction of a one-way segment (features.ts vfrRouteArrowFeatures); the icon
        // points east, `rot` is clockwise from north
        id: `${prefix}-arrow`,
        type: 'symbol',
        source: 'vfr-route-arrows',
        minzoom: 9,
        filter,
        layout: {
          'icon-image': 'pgf-arrow',
          'icon-rotate': ['-', ['get', 'rot'], 90],
          'icon-allow-overlap': true,
          'icon-rotation-alignment': 'map',
        },
      },
      {
        id: `${prefix}-alt`,
        type: 'symbol',
        source: 'vfr-routes',
        minzoom: 8.5,
        filter,
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'alt'],
          'text-font': BOLD,
          'text-size': 10,
          'text-offset': [0, -0.75],
          'text-keep-upright': true,
        },
        paint: { 'text-color': CHART[color], 'text-halo-color': CHART.halo, 'text-halo-width': 1.6 },
      },
    ];
  });
}

function chartLayers(): LayerSpecification[] {
  const isM: ExpressionSpecification = ['==', ['get', 'kind'], 'MTMA'];
  const hov: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
  const isCtr: ExpressionSpecification = ['==', ['get', 'kind'], 'CTR'];
  const zoneColor: ExpressionSpecification = ['case', ['==', ['get', 'cls'], 'G'], CHART.zoneG, CHART.zone];
  return [
    {
      id: 'airspace-fill',
      type: 'fill',
      source: 'airspaces',
      paint: {
        'fill-color': ['case', isM, CHART.mtma, CHART.tma],
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          6,
          ['case', hov, 0.12, 0.05],
          10,
          ['case', hov, 0.1, 0.025],
        ],
      },
    },
    {
      id: 'airspace-line',
      type: 'line',
      source: 'airspaces',
      filter: ['!', isM],
      paint: {
        'line-color': CHART.tma,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', hov, 2.6, 1], 10, ['case', hov, 3.4, 2]],
        'line-opacity': 0.75,
      },
    },
    {
      id: 'airspace-line-m',
      type: 'line',
      source: 'airspaces',
      filter: isM,
      paint: {
        'line-color': CHART.mtma,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', hov, 2.6, 1], 10, ['case', hov, 3.4, 2]],
        'line-opacity': 0.75,
        'line-dasharray': [4, 2],
      },
    },
    {
      id: 'airspace-label',
      type: 'symbol',
      source: 'airspaces',
      minzoom: 7,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 520,
        'text-field': ['get', 'label'],
        'text-font': BOLD,
        'text-size': 10,
        'text-letter-spacing': 0.04,
        'text-offset': [0, 0.9],
        'text-max-angle': 25,
        'text-keep-upright': true,
      },
      paint: {
        'text-color': ['case', isM, CHART.mtma, CHART.tma],
        'text-halo-color': CHART.halo,
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'zone-fill',
      type: 'fill',
      source: 'zones',
      minzoom: 6.5,
      paint: { 'fill-color': zoneColor, 'fill-opacity': ['case', hov, 0.1, isCtr, 0.025, 0.04] },
    },
    {
      // CTR: long dashes
      id: 'zone-line',
      type: 'line',
      source: 'zones',
      minzoom: 6.5,
      filter: isCtr,
      paint: {
        'line-color': zoneColor,
        'line-width': ['case', hov, 2.6, 1.5],
        'line-dasharray': [5, 2],
        'line-opacity': 0.85,
      },
    },
    {
      // ATZ: short dashes
      id: 'zone-line-atz',
      type: 'line',
      source: 'zones',
      minzoom: 7,
      filter: ['!', isCtr],
      paint: {
        'line-color': zoneColor,
        'line-width': ['case', hov, 2.4, 1.2],
        'line-dasharray': [2, 1.5],
        'line-opacity': 0.85,
      },
    },
    {
      id: 'zone-label',
      type: 'symbol',
      source: 'zones',
      minzoom: 8,
      filter: ['any', isCtr, ['>=', ['zoom'], 9]],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 420,
        'text-field': ['get', 'label'],
        'text-font': BOLD,
        'text-size': 9.5,
        'text-letter-spacing': 0.03,
        'text-offset': [0, 0.85],
        'text-max-angle': 30,
        'text-keep-upright': true,
      },
      paint: { 'text-color': zoneColor, 'text-halo-color': CHART.halo, 'text-halo-width': 1.4 },
    },
    ...areaLayers(hov),
    {
      // LGGG FIR boundary: dark grey, long dash-dot (ICAO FIR boundary)
      id: 'fir-line',
      type: 'line',
      source: 'fir',
      filter: ['==', ['get', 'kind'], 'fir'],
      paint: {
        'line-color': CHART.fis,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 9, 2.4],
        'line-dasharray': [7, 2, 1.5, 2],
        'line-opacity': 0.85,
      },
    },
    {
      // ATHINAI / MAKEDONIA line
      id: 'fir-divider',
      type: 'line',
      source: 'fir',
      filter: ['==', ['get', 'kind'], 'divider'],
      paint: { 'line-color': CHART.fis, 'line-width': 1.2, 'line-dasharray': [6, 3, 1, 3], 'line-opacity': 0.7 },
    },
    {
      id: 'fir-label',
      type: 'symbol',
      source: 'fir',
      filter: ['==', ['get', 'kind'], 'fir'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 600,
        'text-field': ['get', 'label'],
        'text-font': BOLD,
        'text-size': 10.5,
        'text-letter-spacing': 0.08,
        'text-max-angle': 30,
        'text-keep-upright': true,
      },
      paint: { 'text-color': CHART.fis, 'text-halo-color': CHART.halo, 'text-halo-width': 1.6 },
    },
    {
      id: 'fir-divider-label',
      type: 'symbol',
      source: 'fir',
      filter: ['==', ['get', 'kind'], 'divider'],
      minzoom: 5.5,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 500,
        'text-field': ['get', 'label'],
        'text-font': BOLD,
        'text-size': 10,
        'text-letter-spacing': 0.06,
        'text-max-angle': 30,
        'text-keep-upright': true,
      },
      paint: { 'text-color': CHART.fis, 'text-halo-color': CHART.halo, 'text-halo-width': 1.6 },
    },
    ...vfrRouteLayers(),
    // radio navaids: VORs and en-route NDBs from the FIR view, aerodrome locators once zoomed in
    {
      id: 'navaid-icon',
      type: 'symbol',
      source: 'navaids',
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 7.5]],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 9, 1],
        'symbol-sort-key': ['get', 'rank'],
      },
    },
    {
      id: 'navaid-label',
      type: 'symbol',
      source: 'navaids',
      minzoom: 7,
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 8.5]],
      layout: {
        'text-field': [
          'step',
          ['zoom'],
          ['get', 'label'],
          9,
          [
            'format',
            ['get', 'label'],
            {},
            ' ',
            {},
            ['get', 'freq'],
            { 'font-scale': 0.85, 'text-font': ['literal', REG] },
          ],
        ],
        'text-font': BOLD,
        'text-size': 10.5,
        'text-letter-spacing': 0.04,
        'text-variable-anchor': ['bottom-left', 'top-left', 'bottom-right', 'top-right'],
        'text-radial-offset': 0.9,
        'text-justify': 'auto',
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': CHART.navaid, 'text-halo-color': CHART.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'vfr-point-icon',
      type: 'symbol',
      source: 'vfr-points',
      minzoom: 7.5,
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 9]],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7.5, 0.75, 10, 1],
      },
    },
    {
      id: 'vfr-point-label',
      type: 'symbol',
      source: 'vfr-points',
      minzoom: 8.5,
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 9.5]],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': REG,
        'text-size': 10.5,
        'text-letter-spacing': 0.03,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.75,
        'text-justify': 'auto',
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': CHART.vfr, 'text-halo-color': CHART.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'waypoint-icon',
      type: 'symbol',
      source: 'waypoints',
      layout: { 'icon-image': 'pgf-wpt', 'icon-allow-overlap': true },
    },
    {
      id: 'waypoint-label',
      type: 'symbol',
      source: 'waypoints',
      minzoom: 7,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': BOLD,
        'text-size': 10.5,
        'text-variable-anchor': ['left', 'right', 'top'],
        'text-radial-offset': 0.8,
      },
      paint: { 'text-color': CHART.waypoint, 'text-halo-color': CHART.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'aerodrome-icon',
      type: 'symbol',
      source: 'aerodromes',
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 6.5]],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-rotate': ['get', 'rot'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 9, 1],
        'symbol-sort-key': ['get', 'rank'],
      },
    },
    {
      id: 'aerodrome-label',
      type: 'symbol',
      source: 'aerodromes',
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 7.5]],
      layout: {
        'text-field': [
          'step',
          ['zoom'],
          ['get', 'label'],
          8.5,
          [
            'format',
            ['get', 'label'],
            { 'font-scale': 1 },
            '\n',
            {},
            ['get', 'sub'],
            { 'font-scale': 0.78, 'text-font': ['literal', REG] },
          ],
        ],
        'text-font': BOLD,
        'text-size': 12,
        'text-line-height': 1.15,
        'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
        'text-radial-offset': 1.15,
        'text-justify': 'auto',
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': CHART.aerodrome, 'text-halo-color': CHART.halo, 'text-halo-width': 1.6 },
    },
  ];
}

const HOVER: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];

/** Dash phases of a focused outline (airspace, leg): stepping through them walks the dashes along it. */
export const FOCUS_DASHES: number[][] = (() => {
  // dash ON, gap OFF (line widths), shifted forward by STEP each phase; one cycle is ON + OFF
  const [on, off, step] = [3, 2, 0.5];
  const out: number[][] = [];
  for (let t = 0; t < off; t += step) out.push([0, t, on, off - t]);
  for (let t = 0; t < on; t += step) out.push([t, off, on - t]);
  return out;
})();

function routeLayers(): LayerSpecification[] {
  const selected: ExpressionSpecification = ['get', 'selected'];
  const isMid: ExpressionSpecification = ['==', ['get', 'role'], 'mid'];
  return [
    // the airspace focused in the popover: a halo and marching dashes in its own colour
    {
      id: 'air-focus-casing',
      type: 'line',
      source: 'air-focus',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': CHART.paper, 'line-width': 6, 'line-opacity': 0.85 },
    },
    {
      id: 'air-focus-line',
      type: 'line',
      source: 'air-focus',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': ['literal', FOCUS_DASHES[0]] },
    },
    // a local flight's area around its aerodrome: faint, under the route
    {
      id: 'local-area-fill',
      type: 'fill',
      source: 'local-area',
      paint: { 'fill-color': CHART.route, 'fill-opacity': 0.05 },
    },
    {
      id: 'local-area-line',
      type: 'line',
      source: 'local-area',
      paint: {
        'line-color': CHART.route,
        'line-width': 1.5,
        'line-opacity': 0.45,
        'line-dasharray': ['literal', [3, 2]],
      },
    },
    {
      id: 'route-casing',
      type: 'line',
      source: 'route-line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': CHART.paper, 'line-width': 7.5, 'line-opacity': 0.9 },
    },
    {
      id: 'route-line',
      type: 'line',
      source: 'route-line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': CHART.route, 'line-width': 3.5 },
    },
    // the leg hovered in the navlog: drawn wider, with marching dashes along it
    {
      id: 'leg-focus-casing',
      type: 'line',
      source: 'leg-focus',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': CHART.route, 'line-width': 8 },
    },
    {
      id: 'leg-focus-line',
      type: 'line',
      source: 'leg-focus',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': CHART.paper, 'line-width': 2.5, 'line-dasharray': ['literal', FOCUS_DASHES[0]] },
    },
    {
      // direction of flight: arrowheads on each leg (features.ts routeArrowFeatures)
      id: 'route-arrows',
      type: 'symbol',
      source: 'route-arrows',
      layout: {
        'icon-image': 'pgf-route-arrow',
        'icon-rotate': ['get', 'rot'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.75, 9, 1],
      },
    },
    {
      id: 'route-band',
      type: 'line',
      source: 'route-band',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': CHART.route, 'line-width': 2.5, 'line-dasharray': [2, 1.6], 'line-opacity': 0.85 },
    },
    {
      id: 'route-mid',
      type: 'circle',
      source: 'route-mid',
      paint: {
        'circle-radius': ['case', HOVER, 6.5, 4.5],
        'circle-color': CHART.paper,
        'circle-stroke-color': CHART.route,
        'circle-stroke-width': 1.6,
        'circle-opacity': ['case', HOVER, 1, 0.8],
        'circle-stroke-opacity': ['case', HOVER, 1, 0.7],
      },
    },
    {
      id: 'snap-ring',
      type: 'circle',
      source: 'snap',
      paint: {
        'circle-radius': 13,
        'circle-color': CHART.route,
        'circle-opacity': 0.12,
        'circle-stroke-color': CHART.route,
        'circle-stroke-width': 2,
      },
    },
    {
      // the halo around a route point under the cursor (it can be dragged, clicked, right-clicked)
      id: 'route-point-halo',
      type: 'circle',
      source: 'route-points',
      paint: {
        'circle-radius': ['case', HOVER, 15, 0],
        'circle-color': CHART.route,
        'circle-opacity': 0.16,
        'circle-stroke-color': CHART.route,
        'circle-stroke-width': ['case', HOVER, 1, 0],
        'circle-stroke-opacity': 0.35,
      },
    },
    {
      id: 'route-points',
      type: 'circle',
      source: 'route-points',
      paint: {
        'circle-radius': [
          'case',
          HOVER,
          ['case', selected, 9.5, isMid, 7.5, 8.5],
          ['case', selected, 8, isMid, 5.5, 7],
        ],
        'circle-color': ['case', selected, CHART.route, CHART.paper],
        'circle-stroke-color': ['case', selected, CHART.paper, CHART.route],
        'circle-stroke-width': ['case', selected, 3, isMid, 2.5, 3],
      },
    },
    {
      id: 'route-point-label',
      type: 'symbol',
      source: 'route-points',
      filter: ['==', ['get', 'showName'], true],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': BOLD,
        'text-size': 11.5,
        'text-letter-spacing': 0.04,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 1,
        'text-allow-overlap': false,
      },
      paint: { 'text-color': CHART.route, 'text-halo-color': CHART.halo, 'text-halo-width': 1.8 },
    },
  ];
}
