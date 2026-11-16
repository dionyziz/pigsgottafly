// Small MapLibre map of the pilot's saved waypoints (OpenStreetMap raster, no API key).
// Click a marker to select it; click elsewhere to start a new waypoint there.
import { useEffect, useEffectEvent, useRef } from 'react';

import { maplibregl } from '../../app/maplibre';
import type { Waypoint } from '../../shared';

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.35 } }],
};
/** LGGG (Athinai FIR) roughly. */
const GREECE: [[number, number], [number, number]] = [
  [19.3, 34.6],
  [29.8, 41.8],
];

export function WaypointMap({
  waypoints,
  selectedId,
  onSelect,
  onMapClick,
}: {
  waypoints: Waypoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMapClick: (lat: number, lon: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const cb = useRef({ onSelect, onMapClick });
  cb.current = { onSelect, onMapClick };
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: STYLE,
        bounds: GREECE,
        attributionControl: { compact: true },
      });
    } catch {
      return; // no WebGL: the list still works
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('click', (e) => cb.current.onMapClick(+e.lngLat.lat.toFixed(6), +e.lngLat.lng.toFixed(6)));
    m.getCanvas().style.cursor = 'crosshair';
    map.current = m;
    // the grid column settles after the map is created: keep the canvas the size of its box
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    const ms = markers.current;
    return () => {
      ro.disconnect();
      ms.clear();
      m.remove();
      map.current = null;
    };
  }, []);

  // sync markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const live = new Set(waypoints.map((w) => w.id));
    for (const [id, mk] of markers.current)
      if (!live.has(id)) {
        mk.remove();
        markers.current.delete(id);
      }
    for (const w of waypoints) {
      let mk = markers.current.get(w.id);
      if (!mk) {
        const dot = document.createElement('div');
        dot.className = 'wp-marker';
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          cb.current.onSelect(w.id);
        });
        mk = new maplibregl.Marker({ element: dot }).setLngLat([w.lon, w.lat]).addTo(m);
        markers.current.set(w.id, mk);
      }
      mk.setLngLat([w.lon, w.lat]);
      mk.getElement().title = w.name;
      mk.getElement().classList.toggle('sel', w.id === selectedId);
    }
    if (!fitted.current && waypoints.length) {
      fitted.current = true;
      const b = new maplibregl.LngLatBounds();
      waypoints.forEach((w) => b.extend([w.lon, w.lat]));
      m.fitBounds(b, { padding: 60, maxZoom: 9, duration: 0 });
    }
  }, [waypoints, selectedId]);

  // fly to the selection
  const flyTo = useEffectEvent((id: string | null) => {
    const m = map.current;
    const w = waypoints.find((x) => x.id === id);
    if (m && w) m.easeTo({ center: [w.lon, w.lat], zoom: Math.max(m.getZoom(), 9), duration: 500 });
  });
  useEffect(() => flyTo(selectedId), [selectedId]);

  return <div ref={el} className="wp-map card" data-testid="waypoint-map" />;
}
