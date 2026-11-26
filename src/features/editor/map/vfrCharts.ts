// Which AIP VFR chart (an aerodrome's AD 2.24 / AD 1.6.N.24 VFR chart, src/data/aipLinks.ts vfrChartUrl)
// covers a map item, for the links in the info boxes: the aerodrome's own chart, the chart a VFR point is
// printed on, and otherwise the smallest chart whose area (its aerodrome and the reporting points printed
// on it) holds the item. Pure (no map), unit-tested.
import type { AipLinks } from '../../../data/aipLinks';
import type { RefAerodrome, RefVfrPoint } from '../../../shared/ref';
import { type AirspaceInfo, isArea, pointInRing } from './airspace';

export interface VfrChart {
  icao: string;
  url: string;
}

interface Cover {
  chart: VfrChart;
  /** [west, south, east, north], padded. */
  bbox: [number, number, number, number];
  area: number;
}

export interface VfrChartIndex {
  /** The eAIP of the flight's cycle the charts link to. */
  aip: AipLinks;
  /** Smallest first. */
  covers: Cover[];
  byAerodrome: Map<string, { a: RefAerodrome; chart: VfrChart }>;
}

/** Margin around a chart's points, degrees (a few NM). */
const PAD = 0.05;

export function vfrChart(aip: AipLinks, icao: string): VfrChart | null {
  const url = aip.vfrChartUrl(icao);
  return url ? { icao: icao.toUpperCase(), url } : null;
}

export function vfrChartIndex(aerodromes: RefAerodrome[], points: RefVfrPoint[], aip: AipLinks): VfrChartIndex {
  const byChart = new Map<string, [number, number][]>();
  for (const p of points) {
    if (!isFinite(p.lat) || !isFinite(p.lon)) continue;
    const l = byChart.get(p.chart) ?? [];
    l.push([p.lon, p.lat]);
    byChart.set(p.chart, l);
  }
  const covers: Cover[] = [];
  const byAerodrome = new Map<string, { a: RefAerodrome; chart: VfrChart }>();
  for (const a of aerodromes) {
    const chart = a.icao ? vfrChart(aip, a.icao) : null;
    if (!chart || !isFinite(a.lat) || !isFinite(a.lon)) continue;
    byAerodrome.set(a.id, { a, chart });
    const pts: [number, number][] = [[a.lon, a.lat], ...(byChart.get(chart.icao) ?? [])];
    const lons = pts.map((p) => p[0]),
      lats = pts.map((p) => p[1]);
    const bbox: Cover['bbox'] = [
      Math.min(...lons) - PAD,
      Math.min(...lats) - PAD,
      Math.max(...lons) + PAD,
      Math.max(...lats) + PAD,
    ];
    covers.push({ chart, bbox, area: (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) });
  }
  covers.sort((x, y) => x.area - y.area);
  return { aip, covers, byAerodrome };
}

/** The smallest VFR chart showing this position (none outside every chart). */
export function vfrChartsAt(idx: VfrChartIndex, lon: number, lat: number): VfrChart[] {
  const c = idx.covers.find(({ bbox: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n);
  return c ? [c.chart] : [];
}

/** An aerodrome's own VFR chart, else the chart that shows it. */
export function aerodromeVfrCharts(idx: VfrChartIndex, a: RefAerodrome): VfrChart[] {
  const own = idx.byAerodrome.get(a.id);
  return own ? [own.chart] : vfrChartsAt(idx, a.lon, a.lat);
}

/** The chart a VFR reporting point is printed on (its id is '<chart>/<NAME>'); open-flightmaps points
 *  (chart 'LGGG') take the chart that shows them. */
export function vfrPointCharts(idx: VfrChartIndex, p: Pick<RefVfrPoint, 'chart' | 'lat' | 'lon'>): VfrChart[] {
  const own = vfrChart(idx.aip, p.chart);
  return own ? [own] : vfrChartsAt(idx, p.lon, p.lat);
}

/**
 * VFR charts for an airspace: a CTR / ATZ → its aerodrome's chart; a TMA / MTMA → the charts of the
 * aerodromes inside it; an ENR 5 area (or any of these without one) → the chart that shows its middle.
 */
export function airspaceVfrCharts(idx: VfrChartIndex, s: AirspaceInfo): VfrChart[] {
  if (s.type === 'CTR' || s.type === 'ATZ') {
    const own = vfrChart(idx.aip, s.id.replace(/-(CTR|ATZ)$/, ''));
    if (own) return [own];
  } else if (!isArea(s.type)) {
    const [w, so, e, n] = s.bbox;
    const inside = [...idx.byAerodrome.values()]
      .filter(({ a }) => a.lon >= w && a.lon <= e && a.lat >= so && a.lat <= n && pointInRing(a.lon, a.lat, s.ring))
      .map(({ chart }) => chart)
      .sort((x, y) => x.icao.localeCompare(y.icao));
    if (inside.length) return inside;
  }
  const [w, so, e, n] = s.bbox;
  return vfrChartsAt(idx, (w + e) / 2, (so + n) / 2);
}
