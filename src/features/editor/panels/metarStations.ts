// Which aerodromes the METAR box lists, and when it shows at all.
//
//   - The route's aerodromes (departure, stops, destination), then those with an ICAO code within
//     AREA_RADIUS_NM of a leg, in the order the route passes them. Only those with a report are
//     shown (most small aerodromes have none).
//   - Shown from METAR_LEAD_MS before take-off until METAR_TAIL_MS after landing; without a block
//     start time, when the flight's day is near (metarRelevant).
import { distanceNm, pointSegDistNm } from '../../../calc/nav';
import { metarRelevant } from '../../../data/flightWeatherPlan';
import type { RefAerodrome } from '../../../shared/ref';
import type { LatLon } from '../../../shared/types';

export const AREA_RADIUS_NM = 20;
export const METAR_LEAD_MS = 6 * 3600 * 1000;
export const METAR_TAIL_MS = 3600 * 1000;

export interface MetarStation {
  icao: string;
  aerodrome: RefAerodrome;
  role: 'departure' | 'stop' | 'destination' | 'area';
  /** Area aerodromes: distance from the route, NM. */
  offRouteNm?: number;
}

/** Whether the METAR box is shown now: the flight is about to start or under way. */
export function metarBoxShown(date: string, takeoffMs: number, landingMs: number, nowMs: number = Date.now()): boolean {
  if (!Number.isFinite(takeoffMs)) return !!date && metarRelevant(date, nowMs);
  const end = Number.isFinite(landingMs) ? landingMs : takeoffMs;
  return nowMs >= takeoffMs - METAR_LEAD_MS && nowMs <= end + METAR_TAIL_MS;
}

/**
 * The stations of a route: its own aerodromes in route order (each once, the first role wins), then
 * the reporting candidates within radiusNm of a leg, by where the route passes them.
 */
export function metarStations(
  route: (RefAerodrome | null)[],
  path: LatLon[],
  aerodromes: readonly RefAerodrome[],
  radiusNm: number = AREA_RADIUS_NM,
): MetarStation[] {
  const out: MetarStation[] = [];
  const seen = new Set<string>();
  route.forEach((ad, i) => {
    if (!ad?.icao || seen.has(ad.icao)) return;
    seen.add(ad.icao);
    out.push({
      icao: ad.icao,
      aerodrome: ad,
      role: i === 0 ? 'departure' : i === route.length - 1 ? 'destination' : 'stop',
    });
  });
  const area: (MetarStation & { at: number })[] = [];
  for (const ad of aerodromes) {
    if (!ad.icao || seen.has(ad.icao)) continue;
    let best = { dist: Infinity, at: 0 };
    for (let i = 0; i + 1 < path.length; i++) {
      const { dist, t } = pointSegDistNm(ad, path[i], path[i + 1]);
      if (dist < best.dist) best = { dist, at: i + t };
    }
    if (best.dist <= radiusNm)
      area.push({ icao: ad.icao, aerodrome: ad, role: 'area', offRouteNm: best.dist, at: best.at });
  }
  area.sort((a, b) => a.at - b.at);
  return [...out, ...area.map(({ at: _at, ...s }) => s)];
}

const ROLE: Record<MetarStation['role'], string> = {
  departure: 'Departure',
  stop: 'Stop',
  destination: 'Destination',
  area: '',
};

/**
 * Where a station is, for its row: the route's own aerodromes by role; a nearby one by its distance from the
 * closest of them when that is about as near as the route itself (it stands in for one with no METAR, like
 * LGTT), else by its distance off the route.
 */
export function metarWhere(s: MetarStation, stations: MetarStation[]): string {
  if (s.role !== 'area') return ROLE[s.role];
  const off = s.offRouteNm ?? 0;
  const near = stations
    .filter((o) => o.role !== 'area')
    .map((o) => ({ icao: o.icao, nm: distanceNm(o.aerodrome, s.aerodrome) }))
    .sort((a, b) => a.nm - b.nm)[0];
  return near && near.nm < off + 5 ? `${Math.round(near.nm)} NM from ${near.icao}` : `${Math.round(off)} NM off route`;
}
