// Weather hazards on the map: each hazard of a leg is drawn as a wide translucent band over the
// stretch of the leg it affects (amber = warn, red = danger) with a short label on it ("BKN 1700 ft ·
// planned 1900 ft"); aerodrome hazards as a ring around the aerodrome. No leg reference: the mark
// sits on the affected stretch (PLAN-v3). Self-contained: adds its own source and layers on demand.
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { Hazard } from '../../../calc';
import type { LatLon } from '../../../shared';

export interface MapHazard {
  level: 'danger' | 'warn';
  /** Line (leg stretch) or a single point (aerodrome). */
  coords: [number, number][];
  label: string;
}

const SRC = 'wx-hazards';
export const HAZARD_LAYER_IDS = ['wx-hazards-band', 'wx-hazards-ring', 'wx-hazards-label'] as const;

const lerp = (a: LatLon, b: LatLon, f: number): [number, number] => [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f];

/** Map marks of the flight's hazards: legs[i] gives each leg's end points. */
export function mapHazards(hazards: Hazard[], legs: { from: LatLon; to: LatLon }[]): MapHazard[] {
  const out: MapHazard[] = [];
  for (const h of hazards) {
    // the label without the time range and source (shown in the strip)
    const label = h.text.replace(/,\s*\d{2}:\d{2}(–\d{2}:\d{2})?Z$/, '');
    if (h.scope.type === 'leg') {
      const l = legs[h.scope.legIndex];
      if (!l) continue;
      const a = h.fromFrac, b = Math.max(h.toFrac, a + 0.02);
      out.push({ level: h.level, coords: [lerp(l.from, l.to, a), lerp(l.from, l.to, Math.min(1, b))], label });
    } else {
      const l = h.scope.type === 'departure' ? legs[0] : legs[legs.length - 1];
      if (!l) continue;
      const p = h.scope.type === 'departure' ? l.from : l.to;
      out.push({ level: h.level, coords: [[p.lon, p.lat]], label });
    }
  }
  return out;
}

function featureCollection(list: MapHazard[]) {
  return {
    type: 'FeatureCollection',
    features: list.map((h, i) => ({
      type: 'Feature', id: i,
      properties: { level: h.level, label: h.label },
      geometry: h.coords.length > 1 ? { type: 'LineString', coordinates: h.coords } : { type: 'Point', coordinates: h.coords[0] },
    })),
  };
}

function ensureLayers(m: MlMap, beforeId: string | undefined) {
  if (m.getSource(SRC)) return;
  m.addSource(SRC, { type: 'geojson', data: featureCollection([]) as never });
  const color = ['match', ['get', 'level'], 'danger', '#d64545', '#e0a106'] as never;
  const before = beforeId && m.getLayer(beforeId) ? beforeId : undefined;
  m.addLayer({
    id: 'wx-hazards-band', type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-opacity': 0.32, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 10, 10, 22] as never },
  }, before);
  m.addLayer({
    id: 'wx-hazards-ring', type: 'circle', source: SRC, filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 18, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': color, 'circle-stroke-width': 3, 'circle-stroke-opacity': 0.75 },
  }, before);
  m.addLayer({
    id: 'wx-hazards-label', type: 'symbol', source: SRC,
    layout: {
      'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] as never,
      'symbol-placement': 'point', 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-max-width': 14, 'text-optional': true,
    } as never,
    paint: { 'text-color': color, 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
  });
}

/** Sets the hazard marks (adds the layers the first time). */
export function setHazardLayer(m: MlMap, list: MapHazard[], beforeId?: string) {
  try {
    ensureLayers(m, beforeId);
    (m.getSource(SRC) as GeoJSONSource | undefined)?.setData(featureCollection(list) as never);
  } catch {
    /* style not ready or glyphs missing: the strip still lists the hazards */
  }
}
