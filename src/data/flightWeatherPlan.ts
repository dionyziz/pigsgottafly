// What a flight's weather is fetched for (pure): the points useFlightWeather.ts asks the server about
// (winds aloft at the leg midpoints; surface forecast and METAR/TAF at the departure, the stops and
// the destination). The website's hook and the native core (src/native/core.ts) share it.
import type { LegGeometry } from '../calc';
import type { FlightOptions, LatLon, RefAerodrome, RoutePoint, WindModel } from '../shared';
import { landingPointIndices } from '../shared';
import { endpointAerodrome } from './atc';

/** METAR/TAF matter when the flight day's noon is within 12 h + this of now. */
export const METAR_HORIZON_MS = 6 * 3600 * 1000;

/** Whether current reports (METAR/TAF) can matter for a flight on `date` ('YYYY-MM-DD'). */
export function metarRelevant(date: string, nowMs = Date.now()): boolean {
  const day = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(day) && Math.abs(day + 12 * 3600000 - nowMs) < 12 * 3600000 + METAR_HORIZON_MS;
}

export interface WeatherStop {
  pointIndex: number;
  aerodrome: RefAerodrome | null;
  /** Where its surface weather is sampled: the aerodrome, else the route point. */
  loc: LatLon;
}

export interface FlightWeatherPlan {
  departure: RefAerodrome | null;
  destination: RefAerodrome | null;
  stops: WeatherStop[];
  /** Leg midpoints, rounded to 3 decimals (≈ 100 m: the weather cache key). */
  mids: LatLon[];
  /** Departure, stops, destination ICAO codes, without repeats. */
  icaos: string[];
  /** Changes exactly when the weather request changes. */
  key: string;
  depLoc: LatLon | null;
  destLoc: LatLon | null;
}

const r3 = (p: LatLon): LatLon => ({ lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3) });
const at = (a: RefAerodrome | null, p: RoutePoint): LatLon => r3(a ? { lat: a.lat, lon: a.lon } : p);

/** What to fetch for a route, with the aerodromes of the reference data. */
export function weatherPlan(args: {
  date: string;
  model: WindModel | null | undefined;
  route: RoutePoint[];
  options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined;
  legs: LegGeometry[];
  aerodromes: RefAerodrome[];
}): FlightWeatherPlan {
  const ads = args.aerodromes;
  const { route } = args;
  const first = route[0];
  const last = route.length > 1 ? route[route.length - 1] : undefined;
  const departure = first ? endpointAerodrome(first, ads) : null;
  const destination = last ? endpointAerodrome(last, ads) : null;
  const stops = landingPointIndices(route, args.options).map((i): WeatherStop => {
    const aerodrome = endpointAerodrome(route[i], ads);
    return { pointIndex: i, aerodrome, loc: at(aerodrome, route[i]) };
  });
  const mids = args.legs.map((l) => r3(l.mid));
  const depLoc = first ? at(departure, first) : null;
  const destLoc = last ? at(destination, last) : null;
  const icaos = [
    ...new Set(
      [departure?.icao, ...stops.map((s) => s.aerodrome?.icao), destination?.icao].filter((x): x is string => !!x),
    ),
  ];
  const key = JSON.stringify([args.date, args.model ?? null, mids, depLoc, destLoc, stops.map((s) => s.loc)]);
  return { departure, destination, stops, mids, icaos, key, depLoc, destLoc };
}
