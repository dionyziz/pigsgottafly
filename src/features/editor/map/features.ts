// GeoJSON for the map layers, built from the reference data, the pilot's waypoints and the route.
// Pure (no map), unit-tested.
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import type { RoutePoint, Waypoint } from '../../../shared';
import type { RefAerodrome, RefAirspace, RefFis, RefVfrPoint, RefVfrRoute } from '../../../shared/ref';
import { aerodromeName } from './snap';
import { mercatorMid } from './routeEdit';
import { airspaceLabel, fmtVertical, isArea, type AirspaceInfo } from './airspace';

export type FC<G extends Point | LineString | Polygon = Point | LineString | Polygon> = FeatureCollection<G, Record<string, unknown>>;
const fc = <G extends Point | LineString | Polygon>(features: Feature<G, Record<string, unknown>>[]): FC<G> => ({ type: 'FeatureCollection', features });

export { destination, circleRing } from './airspace';

/** Runway direction of the first published runway pair ('03/21' → 30), or null. */
export function runwayHeading(a: RefAerodrome): number | null {
  const m = a.runways[0]?.match(/^(\d{1,2})/);
  if (!m) return null;
  const h = (+m[1] * 10) % 180;
  return isFinite(h) ? h : null;
}

/** Aerodrome symbols: properties name (ICAO / label), full name, elevation, icon, rotation. */
export function aerodromeFeatures(aerodromes: RefAerodrome[], variationDeg = 5): FC<Point> {
  return fc(
    aerodromes
      .filter((a) => isFinite(a.lat) && isFinite(a.lon))
      .map((a) => {
        const h = runwayHeading(a);
        const major = !!a.icao && a.freqs.length > 0;
        const elev = a.elevFt !== null && isFinite(a.elevFt) ? `${Math.round(a.elevFt)} ft` : '';
        const title = a.name.includes('/') ? a.name.split('/').map((s) => s.trim()).join(' / ') : a.name;
        return {
          type: 'Feature',
          id: a.id,
          geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
          properties: {
            id: a.id,
            label: aerodromeName(a),
            sub: [a.icao ? title : '', elev].filter(Boolean).join(' · '),
            icon: a.water ? 'pgf-ad-water' : h === null ? 'pgf-ad-plain' : major ? 'pgf-ad-major' : 'pgf-ad-minor',
            // icon rotation is clockwise from true north; runway designators are magnetic
            rot: h === null ? 0 : h + variationDeg,
            rank: major ? 1 : 2,
          },
        };
      }),
  );
}

/**
 * Aerodrome CTRs and ATZs (AD 2.17) with their chart label, e.g.
 * 'DEKELIA TATOI MIL ATZ · D · SFC – 5000 ft'. Class G zones are drawn apart from controlled ones.
 */
export function zoneFeatures(zones: AirspaceInfo[]): FC<Polygon> {
  return fc(
    zones
      .filter((z) => z.type === 'CTR' || z.type === 'ATZ')
      .map((z) => ({
        type: 'Feature',
        id: z.id,
        geometry: { type: 'Polygon', coordinates: [z.ring] },
        properties: { id: z.id, kind: z.type, cls: z.cls.trim().charAt(0), label: airspaceLabel(z) },
      })),
  );
}

/** ENR 5 areas (P / R / D / MIL / ACT) with a chart label 'LGD45 · GND – 5000 ft'. */
export function areaFeatures(infos: AirspaceInfo[]): FC<Polygon> {
  return fc(
    infos
      .filter((a) => isArea(a.type))
      .map((a) => ({
        type: 'Feature',
        id: a.id,
        geometry: { type: 'Polygon', coordinates: [a.ring] },
        properties: { id: a.id, kind: a.type, label: `${a.code ?? a.id} · ${fmtVertical(a.lower, a.upper)}` },
      })),
  );
}

/** Compact vertical limits as printed on charts: 'FL 155' → 'FL155', '1000 FT AGL' → '1000 AGL'. */
export function fmtLimit(s: string): string {
  return s.trim().toUpperCase().replace(/^FL\s+/, 'FL').replace(/\s*FT\b/, '').replace(/\s+/g, ' ');
}

/** TMA/MTMA polygons with a chart label "ATHINAI TMA · D · 1000 ft AGL – FL155". */
export function airspaceFeatures(airspaces: RefAirspace[]): FC<Polygon> {
  return fc(
    airspaces
      .filter((s) => s.polygon.length >= 3)
      .map((s) => {
        const ring = s.polygon.map(([lat, lon]) => [lon, lat] as [number, number]);
        const [f, l] = [ring[0], ring[ring.length - 1]];
        if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
        return {
          type: 'Feature',
          id: s.id,
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { id: s.id, kind: s.kind, label: airspaceLabel({ name: s.name, cls: s.class, lower: s.lower, upper: s.upper }) },
        };
      }),
  );
}

/** The FIS sector boundary (ATHINAI / MAKEDONIA INFORMATION). */
export function fisFeatures(fis: RefFis): FC<LineString> {
  if (fis.boundary.length < 2) return fc([]);
  const label = fis.units.map((u) => `${u.callsign.replace(' INFORMATION', ' INFO')} ${u.freqs[0] ?? ''}`.trim()).join('  ·  ');
  return fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: fis.boundary.map(([lat, lon]) => [lon, lat]) }, properties: { label } }]);
}

/** VFR reporting points: charted ones solid, open-flightmaps ones hollow. */
export function vfrPointFeatures(points: RefVfrPoint[]): FC<Point> {
  return fc(
    points
      .filter((v) => isFinite(v.lat) && isFinite(v.lon))
      .map((v) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
        properties: { id: v.id, label: v.name, icon: v.src === 'ofm' ? 'pgf-vfr-ofm' : 'pgf-vfr', rank: v.src === 'ofm' ? 2 : 1 },
      })),
  );
}

/** Charted altitude of a VFR route segment: '3000' or '2000–3000'. */
export function fmtRouteAltitude(r: Pick<RefVfrRoute, 'minFt' | 'maxFt'>): string {
  return r.minFt === r.maxFt || !isFinite(r.minFt) ? `${r.maxFt}` : `${r.minFt}–${r.maxFt}`;
}

/**
 * VFR route segments as lines between their two reporting points (resolved by chart + name; segments
 * whose points are missing are skipped). One-way segments are drawn a → b and flagged.
 */
export function vfrRouteFeatures(routes: RefVfrRoute[], points: RefVfrPoint[]): FC<LineString> {
  const byChart = new Map<string, RefVfrPoint>();
  for (const p of points) {
    const k = `${p.chart}/${p.name}`;
    // prefer the charted/table point over an open-flightmaps duplicate of the same name
    if (!byChart.has(k) || (byChart.get(k)!.src === 'ofm' && p.src !== 'ofm')) byChart.set(k, p);
  }
  const out: Feature<LineString, Record<string, unknown>>[] = [];
  const seen = new Set<string>();
  for (const r of routes) {
    const a = byChart.get(`${r.chart}/${r.a}`), b = byChart.get(`${r.chart}/${r.b}`);
    if (!a || !b) continue;
    // two-way segments listed in both directions are drawn once
    const key = r.oneway ? `${r.chart}:${r.a}>${r.b}` : `${r.chart}:${[r.a, r.b].sort().join('|')}:${r.minFt}-${r.maxFt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
      properties: { id: r.id, alt: fmtRouteAltitude(r), oneway: r.oneway },
    });
  }
  return fc(out);
}

/** The pilot's saved waypoints. */
export function waypointFeatures(waypoints: Waypoint[]): FC<Point> {
  return fc(
    waypoints
      .filter((w) => isFinite(w.lat) && isFinite(w.lon))
      .map((w) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [w.lon, w.lat] }, properties: { id: w.id, label: w.name } })),
  );
}

/** The route line. */
export function routeLineFeatures(route: Pick<RoutePoint, 'lat' | 'lon'>[]): FC<LineString> {
  if (route.length < 2) return fc([]);
  return fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: route.map((p) => [p.lon, p.lat]) }, properties: {} }]);
}

/** Route points with their role (dep / arr / mid) and selection. */
export function routePointFeatures(route: RoutePoint[], selectedUid: string | null): FC<Point> {
  return fc(
    route.map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        uid: p.uid,
        index: i,
        name: p.name,
        kind: p.kind,
        role: i === 0 ? 'dep' : i === route.length - 1 ? 'arr' : 'mid',
        selected: p.uid === selectedUid,
        // custom/saved points carry their name on the map; known ones already have a chart label
        showName: p.kind === 'custom',
      },
    })),
  );
}

/** Midpoint handles (drag one to insert a point into that leg), at the middle of the drawn line. */
export function midpointFeatures(route: Pick<RoutePoint, 'lat' | 'lon'>[]): FC<Point> {
  const out: Feature<Point, Record<string, unknown>>[] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i], b = route[i + 1];
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: mercatorMid(a, b) }, properties: { leg: i } });
  }
  return fc(out);
}
