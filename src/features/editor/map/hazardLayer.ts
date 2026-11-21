// The hazard texts are not printed on the chart, where they would collide with the leg labels and each
// other: the leg label carries a small warning badge (hazardsByLeg) and hovering a band, a ring or the
// badge shows the texts.
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';

import type { Hazard } from '../../../calc';
import type { LatLon } from '../../../shared';
import { CHART } from './style';

export interface MapHazard {
  level: 'danger' | 'warn';
  /** Line (leg stretch) or a single point (aerodrome). */
  coords: [number, number][];
  label: string;
  /** Leg the hazard is on (aerodrome hazards: the first / last leg), or null. */
  legIndex: number | null;
}

const SRC = 'wx-hazards';
export const HAZARD_LAYER_IDS = ['wx-hazards-band', 'wx-hazards-ring'] as const;

const lerp = (a: LatLon, b: LatLon, f: number): [number, number] => [
  a.lon + (b.lon - a.lon) * f,
  a.lat + (b.lat - a.lat) * f,
];

/** legs[i] gives each leg's end points. */
export function mapHazards(hazards: Hazard[], legs: { from: LatLon; to: LatLon }[]): MapHazard[] {
  const out: MapHazard[] = [];
  for (const h of hazards) {
    // the label without the time range and source (shown in the strip)
    const label = h.text.replace(/,\s*\d{2}:\d{2}(–\d{2}:\d{2})?Z$/, '');
    if (h.scope.type === 'leg') {
      const l = legs[h.scope.legIndex];
      if (!l) continue;
      const a = h.fromFrac,
        b = Math.max(h.toFrac, a + 0.02);
      out.push({
        level: h.level,
        coords: [lerp(l.from, l.to, a), lerp(l.from, l.to, Math.min(1, b))],
        label,
        legIndex: h.scope.legIndex,
      });
    } else {
      const l = h.scope.type === 'departure' ? legs[0] : legs[legs.length - 1];
      if (!l) continue;
      const p = h.scope.type === 'departure' ? l.from : l.to;
      out.push({
        level: h.level,
        coords: [[p.lon, p.lat]],
        label,
        legIndex: h.scope.type === 'departure' ? 0 : legs.length - 1,
      });
    }
  }
  return out;
}

export interface LegHazards {
  level: 'danger' | 'warn';
  labels: string[];
}

/** Legs without hazards are absent. */
export function hazardsByLeg(list: MapHazard[]): Map<number, LegHazards> {
  const out = new Map<number, LegHazards>();
  const sorted = [...list].sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
  for (const h of sorted) {
    if (h.legIndex === null) continue;
    const cur = out.get(h.legIndex);
    if (!cur) out.set(h.legIndex, { level: h.level, labels: [h.label] });
    else if (!cur.labels.includes(h.label)) cur.labels.push(h.label);
  }
  return out;
}

export function hazardLabelsAt(
  m: MlMap,
  point: { x: number; y: number },
  list: MapHazard[],
): { level: 'danger' | 'warn'; label: string }[] {
  if (!list.length || !m.getLayer('wx-hazards-band')) return [];
  let feats: { id?: string | number }[];
  try {
    feats = m.queryRenderedFeatures(
      [
        [point.x - 3, point.y - 3],
        [point.x + 3, point.y + 3],
      ],
      { layers: [...HAZARD_LAYER_IDS] },
    );
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: { level: 'danger' | 'warn'; label: string }[] = [];
  for (const f of feats) {
    const h = typeof f.id === 'number' ? list[f.id] : undefined;
    if (!h || seen.has(h.label)) continue;
    seen.add(h.label);
    out.push({ level: h.level, label: h.label });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
}

function featureCollection(list: MapHazard[]) {
  return {
    type: 'FeatureCollection',
    features: list.map((h, i) => ({
      type: 'Feature',
      id: i,
      properties: { level: h.level, label: h.label },
      geometry:
        h.coords.length > 1
          ? { type: 'LineString', coordinates: h.coords }
          : { type: 'Point', coordinates: h.coords[0] },
    })),
  };
}

function ensureLayers(m: MlMap, beforeId: string | undefined) {
  if (m.getSource(SRC)) return;
  m.addSource(SRC, { type: 'geojson', data: featureCollection([]) as never });
  const color = ['match', ['get', 'level'], 'danger', CHART.hazard, CHART.hazardWarn] as never;
  const before = beforeId && m.getLayer(beforeId) ? beforeId : undefined;
  m.addLayer(
    {
      id: 'wx-hazards-band',
      type: 'line',
      source: SRC,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-opacity': 0.32,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 10, 10, 22] as never,
      },
    },
    before,
  );
  m.addLayer(
    {
      id: 'wx-hazards-ring',
      type: 'circle',
      source: SRC,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 18,
        'circle-opacity': 0,
        'circle-stroke-color': color,
        'circle-stroke-width': 3,
        'circle-stroke-opacity': 0.75,
      },
    },
    before,
  );
}

export function setHazardLayer(m: MlMap, list: MapHazard[], beforeId?: string) {
  try {
    ensureLayers(m, beforeId);
    void m.getSource<GeoJSONSource>(SRC)?.setData(featureCollection(list) as never);
  } catch {
    /* style not ready or glyphs missing: the strip still lists the hazards */
  }
}
