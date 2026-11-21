// NOTAM areas on the map: the areas each NOTAM's text describes (polygons, circles, corridors),
// else its Q-line circle, drawn translucent with a dashed outline (relevant: amber; hidden ones,
// with "show all": grey; the one picked in the panel or on the map: accent). FIR-wide NOTAMs and
// those without a position have no area; aerodrome NOTAMs are not drawn (the panel lists them). Hovering shows the NOTAM's ID, validity and limits; a click opens the
// details (NotamPopover). Self-contained: adds its own source and layers on demand.
import type { GeoJSONSource, LayerSpecification, Map as MlMap } from 'maplibre-gl';

import { isAerodromeNotam, notamRings, ringsSizeNm } from '../../../data/notams';
import type { Notam } from '../../../shared/briefing';
import { CHART } from './style';

export interface MapNotam {
  key: string;
  relevant: boolean;
  /** Outline rings, [lon, lat], closed. */
  rings: [number, number][][];
  /** Size, NM (smaller areas sort first under the cursor). */
  sizeNm: number;
}

export const NOTAM_SOURCE = 'notam-areas';
export const NOTAM_LAYER_IDS = ['notam-fill', 'notam-line'] as const;

/** Map areas of the NOTAMs that have one. */
export function mapNotams(list: Notam[]): MapNotam[] {
  const out: MapNotam[] = [];
  for (const n of list) {
    if (isAerodromeNotam(n)) continue;
    const rings = notamRings(n);
    if (rings.length) out.push({ key: n.key, relevant: n.relevant, rings, sizeNm: ringsSizeNm(rings) });
  }
  return out;
}

/** The GeoJSON of the NOTAM areas (the 'notam-areas' source); feature ids are indices into the list. */
export function notamFeatures(list: MapNotam[], selected: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: list.map((n, i) => ({
      type: 'Feature' as const,
      id: i,
      properties: { key: n.key, relevant: n.relevant ? 1 : 0, selected: n.key === selected ? 1 : 0 },
      geometry: { type: 'MultiPolygon' as const, coordinates: n.rings.map((r) => [r]) },
    })),
  };
}

/** The NOTAM layers, drawn under the route (before 'route-casing'). */
export function notamLayers(): LayerSpecification[] {
  const color = [
    'case',
    ['==', ['get', 'selected'], 1],
    CHART.notamSelected,
    ['==', ['get', 'relevant'], 1],
    CHART.notam,
    CHART.notamOff,
  ] as never;
  return [
    {
      id: 'notam-fill',
      type: 'fill',
      source: NOTAM_SOURCE,
      paint: { 'fill-color': color, 'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.18, 0.04] as never },
    },
    {
      id: 'notam-line',
      type: 'line',
      source: NOTAM_SOURCE,
      paint: {
        'line-color': color,
        'line-width': ['case', ['==', ['get', 'selected'], 1], 2.4, 1] as never,
        'line-dasharray': [3, 2],
        'line-opacity': ['case', ['==', ['get', 'selected'], 1], 0.9, 0.55] as never,
      },
    },
  ];
}

function ensureLayers(m: MlMap, beforeId: string | undefined) {
  if (m.getSource(NOTAM_SOURCE)) return;
  m.addSource(NOTAM_SOURCE, { type: 'geojson', data: notamFeatures([], null) as never });
  const before = beforeId && m.getLayer(beforeId) ? beforeId : undefined;
  for (const l of notamLayers()) m.addLayer(l, before);
}

/** Sets the NOTAM areas (adds the layers the first time) and their visibility. */
export function setNotamLayer(
  m: MlMap,
  list: MapNotam[],
  selected: string | null,
  visible: boolean,
  beforeId?: string,
) {
  try {
    ensureLayers(m, beforeId);
    void m.getSource<GeoJSONSource>(NOTAM_SOURCE)?.setData(notamFeatures(list, selected));
    for (const id of NOTAM_LAYER_IDS)
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  } catch {
    /* style not ready: the panel still lists the NOTAMs */
  }
}

/** Keys of the NOTAM areas under a screen point, smallest area first, or []. */
export function notamKeysAt(m: MlMap, point: { x: number; y: number }, list: MapNotam[]): string[] {
  if (!list.length || !m.getLayer('notam-fill') || m.getLayoutProperty('notam-fill', 'visibility') === 'none')
    return [];
  let feats: { id?: string | number }[];
  try {
    feats = m.queryRenderedFeatures(
      [
        [point.x - 2, point.y - 2],
        [point.x + 2, point.y + 2],
      ],
      { layers: [...NOTAM_LAYER_IDS] },
    );
  } catch {
    return [];
  }
  const hits = new Map<string, MapNotam>();
  for (const f of feats) {
    const n = typeof f.id === 'number' ? list[f.id] : undefined;
    if (n) hits.set(n.key, n);
  }
  return [...hits.values()].sort((a, b) => a.sizeNm - b.sizeNm).map((n) => n.key);
}
