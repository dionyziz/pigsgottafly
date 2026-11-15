// The map (map agent owns src/features/editor/map/**). PLACEHOLDER: MapLibre with an OpenStreetMap
// raster base and the route as a line. To build: VFR-chart layers from useEditor().ref, route
// drawing with snapping, custom waypoints, drag/insert/delete, leg labels (MC + distance, editable
// altitude) — all changes through useEditor().update().
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useEditor } from '../state';

const OSM: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function MapView() {
  const { doc } = useEditor();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({ container: el.current, style: OSM, center: [23.8, 38.1], zoom: 7, attributionControl: { compact: true } });
    } catch (e) {
      setFailed('The map needs WebGL, which this browser could not start.');
      return;
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#b4231a', 'line-width': 3 } });
      (m as any)._pgfLoaded = true;
      m.fire('pgf:route');
    });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      const src = m.getSource('route') as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: doc.route.map((p) => [p.lon, p.lat]) } });
    };
    if ((m as any)._pgfLoaded) draw();
    else m.once('pgf:route', draw);
  }, [doc.route]);

  return (
    <div ref={el} data-testid="map" style={{ position: 'absolute', inset: 0 }}>
      {failed && <div className="loading-screen">{failed}</div>}
    </div>
  );
}
