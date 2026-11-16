// NOTAM areas on the map: each NOTAM with a Q-line circle (centre + radius below 999 NM) is drawn
// as a translucent circle with a dashed outline (relevant: amber; hidden ones, with "show all":
// grey; the one picked in the panel or on the map: accent). FIR-wide NOTAMs and those without a
// position have no area. Hovering shows the NOTAM's ID, validity and limits; a click opens the
// details (NotamPopover). Self-contained: adds its own source and layers on demand.
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { Notam } from '../../../shared/briefing';
import { circleRing, hasNotamArea } from '../../../data/notams';
import { CHART } from './style';

export interface MapNotam {
  key: string;
  relevant: boolean;
  ring: [number, number][];
  /** Radius, NM (smaller areas sort first under the cursor). */
  radiusNm: number;
}

const SRC = 'notam-areas';
export const NOTAM_LAYER_IDS = ['notam-fill', 'notam-line'] as const;

/** Map areas of the NOTAMs that have one. */
export function mapNotams(list: Notam[]): MapNotam[] {
  const out: MapNotam[] = [];
  for (const n of list) {
    if (!hasNotamArea(n)) continue;
    out.push({ key: n.key, relevant: n.relevant, ring: circleRing(n.center!, n.radiusNm!), radiusNm: n.radiusNm! });
  }
  return out;
}

function featureCollection(list: MapNotam[], selected: string | null) {
  return {
    type: 'FeatureCollection',
    features: list.map((n, i) => ({
      type: 'Feature',
      id: i,
      properties: { key: n.key, relevant: n.relevant ? 1 : 0, selected: n.key === selected ? 1 : 0 },
      geometry: { type: 'Polygon', coordinates: [n.ring] },
    })),
  };
}

function ensureLayers(m: MlMap, beforeId: string | undefined) {
  if (m.getSource(SRC)) return;
  m.addSource(SRC, { type: 'geojson', data: featureCollection([], null) as never });
  const color = [
    'case',
    ['==', ['get', 'selected'], 1],
    CHART.notamSelected,
    ['==', ['get', 'relevant'], 1],
    CHART.notam,
    CHART.notamOff,
  ] as never;
  const before = beforeId && m.getLayer(beforeId) ? beforeId : undefined;
  m.addLayer(
    {
      id: 'notam-fill',
      type: 'fill',
      source: SRC,
      paint: { 'fill-color': color, 'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.2, 0.1] as never },
    },
    before,
  );
  m.addLayer(
    {
      id: 'notam-line',
      type: 'line',
      source: SRC,
      paint: {
        'line-color': color,
        'line-width': ['case', ['==', ['get', 'selected'], 1], 2.4, 1.4] as never,
        'line-dasharray': [3, 2],
        'line-opacity': 0.9,
      },
    },
    before,
  );
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
    (m.getSource(SRC) as GeoJSONSource | undefined)?.setData(featureCollection(list, selected) as never);
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
  return [...hits.values()].sort((a, b) => a.radiusNm - b.radiusNm).map((n) => n.key);
}
