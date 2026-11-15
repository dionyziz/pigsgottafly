// Map style: keyless raster base maps, the optional openflightmaps aero overlay, and the VFR-chart
// vector layers drawn from our reference data, plus the route layers.
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

/** Chart palette (kept close to ICAO VFR charts, calm against the light base map). */
export const CHART = {
  aerodrome: '#1d3f8f',
  tma: '#2f64c0',
  mtma: '#8a3b9c',
  zone: '#b4235a',
  fis: '#6b7480',
  vfr: '#1e6b46',
  waypoint: '#7a3db8',
  route: '#c2185b',
  routeCasing: '#ffffff',
  halo: 'rgba(255,255,255,0.92)',
  ink: '#16191d',
} as const;

export type BaseMapId = 'light' | 'terrain' | 'street';

interface RasterBase { id: BaseMapId; label: string; kind: 'raster'; tiles: string[]; maxzoom: number; attribution: string }
interface VectorBase { id: BaseMapId; label: string; kind: 'vector'; styleUrl: string }

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/** Keyless base maps. "Light" is the OpenFreeMap Positron vector style (no key, no registration). */
export const BASE_MAPS: (RasterBase | VectorBase)[] = [
  { id: 'light', label: 'Light', kind: 'vector', styleUrl: 'https://tiles.openfreemap.org/styles/positron' },
  {
    id: 'terrain', label: 'Terrain', kind: 'raster',
    tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    maxzoom: 17,
    attribution: `${OSM_ATTR}, SRTM · style © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)`,
  },
  { id: 'street', label: 'Street', kind: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], maxzoom: 19, attribution: OSM_ATTR },
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
    void vectorCache.then((v) => { if (!v) vectorCache = null; }); // retry next time
  }
  return vectorCache;
}

/**
 * openflightmaps aero overlay (transparent PNG tiles, no key; verified 2026-11 with CORS *).
 * The data are the current OFM AIRAC for the LGGG region.
 */
export const OFM_TILES = 'https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest';
export const OFM_ATTRIBUTION = 'Aero data © <a href="https://www.openflightmaps.org" target="_blank" rel="noopener">open flightmaps</a>';

/** Keyless glyphs for the vector labels (OpenFreeMap). */
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const REG = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];

/** LGGG (Athinai FIR) at a glance, [west, south, east, north]. */
export const LGGG_BOUNDS: [number, number, number, number] = [19.2, 34.6, 29.8, 41.9];

const EMPTY = { type: 'FeatureCollection', features: [] } as const;

/** Sources that carry our own data (setData later). */
export const DATA_SOURCES = [
  'airspaces', 'zones', 'fis', 'vfr-routes', 'vfr-points', 'aerodromes', 'waypoints',
  'route-line', 'route-band', 'route-mid', 'route-points', 'snap',
] as const;
export type DataSourceId = (typeof DATA_SOURCES)[number];

/** Layers making up each base map, with the visibility each has when that base is shown. */
export type BaseLayers = Record<BaseMapId, { id: string; visible: boolean }[]>;

export function buildStyle(base: BaseMapId, ofm: boolean, vector: StyleSpecification | null): { style: StyleSpecification; baseLayers: BaseLayers } {
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
          layers.push({ ...l, id, layout: { ...((l as { layout?: object }).layout ?? {}), visibility: vis(b.id, visible) } } as LayerSpecification);
        }
      } else {
        // offline / unreachable: OSM raster tiles stand in
        const osm = BASE_MAPS.find((x): x is RasterBase => x.id === 'street')!;
        sources[`base-${b.id}`] = { type: 'raster', tiles: osm.tiles, tileSize: 256, maxzoom: osm.maxzoom, attribution: osm.attribution };
        layers.push({ id: `base-${b.id}`, type: 'raster', source: `base-${b.id}`, layout: { visibility: vis(b.id) }, paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.85 } });
        baseLayers[b.id].push({ id: `base-${b.id}`, visible: true });
      }
    } else {
      sources[`base-${b.id}`] = { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
      layers.push({ id: `base-${b.id}`, type: 'raster', source: `base-${b.id}`, layout: { visibility: vis(b.id) }, paint: { 'raster-fade-duration': 150 } });
      baseLayers[b.id].push({ id: `base-${b.id}`, visible: true });
    }
  }
  sources.ofm = { type: 'raster', tiles: [OFM_TILES], tileSize: 256, minzoom: 6, maxzoom: 12, attribution: OFM_ATTRIBUTION };
  layers.push({ id: 'ofm', type: 'raster', source: 'ofm', layout: { visibility: ofm ? 'visible' : 'none' }, paint: { 'raster-fade-duration': 150 } });
  for (const id of DATA_SOURCES) sources[id] = { type: 'geojson', data: EMPTY as never, ...(id === 'route-mid' ? { generateId: true } : {}) };
  layers.push(...chartLayers(), ...routeLayers());
  const style: StyleSpecification = { version: 8, glyphs: GLYPHS, sources, layers };
  if (sprite) style.sprite = sprite;
  return { style, baseLayers };
}

/** Our chart layers (toggled together by "Chart layers"). */
export const CHART_LAYER_IDS = [
  'airspace-fill', 'airspace-line', 'airspace-line-m', 'airspace-label', 'zone-fill', 'zone-line', 'fis-line', 'fis-label',
  'vfr-route-line', 'vfr-route-arrow', 'vfr-route-alt', 'vfr-point-icon', 'vfr-point-label',
  'aerodrome-icon', 'aerodrome-label', 'waypoint-icon', 'waypoint-label',
];

function chartLayers(): LayerSpecification[] {
  const isM: ExpressionSpecification = ['==', ['get', 'kind'], 'MTMA'];
  return [
    {
      id: 'airspace-fill', type: 'fill', source: 'airspaces',
      paint: { 'fill-color': ['case', isM, CHART.mtma, CHART.tma], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.05, 10, 0.025] },
    },
    {
      id: 'airspace-line', type: 'line', source: 'airspaces', filter: ['!', isM],
      paint: { 'line-color': CHART.tma, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2], 'line-opacity': 0.75 },
    },
    {
      id: 'airspace-line-m', type: 'line', source: 'airspaces', filter: isM,
      paint: { 'line-color': CHART.mtma, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2], 'line-opacity': 0.75, 'line-dasharray': [4, 2] },
    },
    {
      id: 'airspace-label', type: 'symbol', source: 'airspaces', minzoom: 7,
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 520, 'text-field': ['get', 'label'], 'text-font': BOLD,
        'text-size': 10, 'text-letter-spacing': 0.04, 'text-offset': [0, 0.9], 'text-max-angle': 25, 'text-keep-upright': true,
      },
      paint: { 'text-color': ['case', isM, CHART.mtma, CHART.tma], 'text-halo-color': CHART.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'zone-fill', type: 'fill', source: 'zones', minzoom: 8,
      paint: { 'fill-color': CHART.zone, 'fill-opacity': 0.03 },
    },
    {
      id: 'zone-line', type: 'line', source: 'zones', minzoom: 7,
      paint: { 'line-color': CHART.zone, 'line-width': 1.3, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
    },
    {
      id: 'fis-line', type: 'line', source: 'fis',
      paint: { 'line-color': CHART.fis, 'line-width': 1.2, 'line-dasharray': [6, 3, 1, 3], 'line-opacity': 0.7 },
    },
    {
      id: 'fis-label', type: 'symbol', source: 'fis', minzoom: 6.5,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 700, 'text-field': ['get', 'label'], 'text-font': REG, 'text-size': 10, 'text-offset': [0, 0.9] },
      paint: { 'text-color': CHART.fis, 'text-halo-color': CHART.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'vfr-route-line', type: 'line', source: 'vfr-routes', minzoom: 7.5,
      paint: { 'line-color': CHART.vfr, 'line-width': ['interpolate', ['linear'], ['zoom'], 7.5, 0.8, 11, 1.8], 'line-opacity': 0.7 },
    },
    {
      id: 'vfr-route-arrow', type: 'symbol', source: 'vfr-routes', minzoom: 9, filter: ['==', ['get', 'oneway'], true],
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'pgf-arrow', 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map' },
    },
    {
      id: 'vfr-route-alt', type: 'symbol', source: 'vfr-routes', minzoom: 8.5,
      layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'alt'], 'text-font': BOLD, 'text-size': 10, 'text-offset': [0, -0.75], 'text-keep-upright': true },
      paint: { 'text-color': CHART.vfr, 'text-halo-color': CHART.halo, 'text-halo-width': 1.6 },
    },
    {
      id: 'vfr-point-icon', type: 'symbol', source: 'vfr-points', minzoom: 7.5,
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 9]],
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 7.5, 0.75, 10, 1] },
    },
    {
      id: 'vfr-point-label', type: 'symbol', source: 'vfr-points', minzoom: 8.5,
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 9.5]],
      layout: {
        'text-field': ['get', 'label'], 'text-font': REG, 'text-size': 10.5, 'text-letter-spacing': 0.03,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.75, 'text-justify': 'auto',
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': CHART.vfr, 'text-halo-color': CHART.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'waypoint-icon', type: 'symbol', source: 'waypoints',
      layout: { 'icon-image': 'pgf-wpt', 'icon-allow-overlap': true },
    },
    {
      id: 'waypoint-label', type: 'symbol', source: 'waypoints', minzoom: 7,
      layout: { 'text-field': ['get', 'label'], 'text-font': BOLD, 'text-size': 10.5, 'text-variable-anchor': ['left', 'right', 'top'], 'text-radial-offset': 0.8 },
      paint: { 'text-color': CHART.waypoint, 'text-halo-color': CHART.halo, 'text-halo-width': 1.5 },
    },
    {
      id: 'aerodrome-icon', type: 'symbol', source: 'aerodromes',
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 6.5]],
      layout: {
        'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 9, 1],
        'symbol-sort-key': ['get', 'rank'],
      },
    },
    {
      id: 'aerodrome-label', type: 'symbol', source: 'aerodromes',
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 7.5]],
      layout: {
        'text-field': ['step', ['zoom'],
          ['get', 'label'],
          8.5, ['format', ['get', 'label'], { 'font-scale': 1 }, '\n', {}, ['get', 'sub'], { 'font-scale': 0.78, 'text-font': ['literal', REG] }],
        ],
        'text-font': BOLD, 'text-size': 12, 'text-line-height': 1.15,
        'text-variable-anchor': ['top', 'bottom', 'right', 'left'], 'text-radial-offset': 1.15, 'text-justify': 'auto',
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': CHART.aerodrome, 'text-halo-color': CHART.halo, 'text-halo-width': 1.6 },
    },
  ];
}

function routeLayers(): LayerSpecification[] {
  return [
    {
      id: 'route-casing', type: 'line', source: 'route-line', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': CHART.routeCasing, 'line-width': 7.5, 'line-opacity': 0.9 },
    },
    {
      id: 'route-line', type: 'line', source: 'route-line', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': CHART.route, 'line-width': 3.5 },
    },
    {
      id: 'route-band', type: 'line', source: 'route-band', layout: { 'line-cap': 'round' },
      paint: { 'line-color': CHART.route, 'line-width': 2.5, 'line-dasharray': [2, 1.6], 'line-opacity': 0.85 },
    },
    {
      id: 'route-mid', type: 'circle', source: 'route-mid',
      paint: {
        'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 6.5, 4.5],
        'circle-color': '#fff', 'circle-stroke-color': CHART.route, 'circle-stroke-width': 1.6,
        'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.8],
        'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.7],
      },
    },
    {
      id: 'snap-ring', type: 'circle', source: 'snap',
      paint: { 'circle-radius': 13, 'circle-color': CHART.route, 'circle-opacity': 0.12, 'circle-stroke-color': CHART.route, 'circle-stroke-width': 2 },
    },
    {
      id: 'route-points', type: 'circle', source: 'route-points',
      paint: {
        'circle-radius': ['case', ['get', 'selected'], 8, ['==', ['get', 'role'], 'mid'], 5.5, 7],
        'circle-color': ['case', ['get', 'selected'], CHART.route, '#ffffff'],
        'circle-stroke-color': ['case', ['get', 'selected'], '#ffffff', CHART.route],
        'circle-stroke-width': ['case', ['get', 'selected'], 3, ['==', ['get', 'role'], 'mid'], 2.5, 3],
      },
    },
    {
      id: 'route-point-label', type: 'symbol', source: 'route-points', filter: ['==', ['get', 'showName'], true],
      layout: {
        'text-field': ['get', 'name'], 'text-font': BOLD, 'text-size': 11.5, 'text-letter-spacing': 0.04,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 1, 'text-allow-overlap': false,
      },
      paint: { 'text-color': CHART.route, 'text-halo-color': CHART.halo, 'text-halo-width': 1.8 },
    },
  ];
}
