// One weather loader for a flight, used by the editor (panels/calc.tsx) and the exports (navlog,
// W&B/performance, FPL), so they all fetch the same points the same way:
//   - winds aloft at every leg midpoint, surface forecast at the departure, the destination and
//     every intermediate full stop or touch-and-go (Open-Meteo, src/data/weather.ts);
//   - METAR/TAF at those aerodromes when the flight is near now (metarRelevant), or always.
// Only the newest request sets state; a failed request ends loading (never a spinner forever).
//
//   const wx = useFlightWeather({ date: doc.date, route: doc.route, options: doc.options, model: doc.options.windModel });
//   wx.weather, wx.weatherLoading, wx.metar, wx.refresh(), wx.departure / wx.destination / wx.stops
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { buildLegs, type LegGeometry } from '../calc';
import type { FlightOptions, RefAerodrome, RoutePoint, WindModel } from '../shared';
import { type FlightWeatherPlan, metarRelevant, weatherPlan } from './flightWeatherPlan';
import { REF } from './ref';
import { useSequencer } from './sequence';
import { fetchRouteWeather, type RouteWeather } from './weather';
import { fetchMetarTaf, type MetarTafResult } from './weatherMetar';

export { type FlightWeatherPlan, metarRelevant } from './flightWeatherPlan';

/** What to fetch for a route (pure; exported for tests): weatherPlan, with the client's reference data by default. */
export function flightWeatherPlan(args: {
  date: string;
  model: WindModel | null | undefined;
  route: RoutePoint[];
  options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined;
  legs: LegGeometry[];
  aerodromes?: RefAerodrome[];
}): FlightWeatherPlan {
  return weatherPlan({ ...args, aerodromes: args.aerodromes ?? REF.aerodromes });
}

export interface FlightWeatherInput {
  date: string;
  route: RoutePoint[];
  options: Pick<FlightOptions, 'aerodromeRequests'> | null | undefined;
  model: WindModel | null | undefined;
  /** The flight's legs when the caller already has them (else built from route and date). */
  legs?: LegGeometry[];
  /** Wait this long after the last change before fetching (the editor, while the route is drawn). */
  debounceMs?: number;
  /** 'near' (default): METAR/TAF only when metarRelevant(date); 'always': whenever there are ICAO codes. */
  metar?: 'near' | 'always';
  /** Nothing is fetched while false (e.g. the aircraft is still loading). */
  enabled?: boolean;
}

export interface FlightWeather extends FlightWeatherPlan {
  legs: LegGeometry[];
  weather: RouteWeather | null;
  /** The winds/surface request is running (or waiting for its debounce). */
  weatherLoading: boolean;
  metar: MetarTafResult | null;
  metarLoading: boolean;
  /** Refetch, ignoring the caches. */
  refresh: () => void;
  /** Bumped by every refresh() (0 = never refreshed). */
  refreshCount: number;
}

export function useFlightWeather(input: FlightWeatherInput): FlightWeather {
  const { date, route, options, model, debounceMs = 0, enabled = true } = input;
  const builtLegs = useMemo(() => (input.legs ? null : buildLegs(route, date)), [input.legs, route, date]);
  const legs = input.legs ?? builtLegs!;

  const plan = useMemo(
    () => flightWeatherPlan({ date, model, route, options, legs }),
    [date, model, route, options, legs],
  );

  const [refreshCount, setRefreshCount] = useState(0);
  const refresh = useCallback(() => setRefreshCount((n) => n + 1), []);
  const lastRefresh = useRef({ wx: 0, metar: 0 });

  const wxSeq = useSequencer();
  const [weather, setWeather] = useState<RouteWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const hasPoints = plan.mids.length > 0 || !!plan.depLoc;
  // one request per plan key (route, date, model) and refresh, with the plan of that render
  const requestWeather = useEffectEvent((current: () => boolean): (() => void) | undefined => {
    if (!hasPoints || !date) {
      setWeather(null);
      setWeatherLoading(false);
      return undefined;
    }
    const force = refreshCount !== lastRefresh.current.wx;
    setWeatherLoading(true);
    const p = plan;
    const go = () => {
      if (!current()) return;
      lastRefresh.current.wx = refreshCount;
      fetchRouteWeather({
        date,
        model,
        legMidpoints: p.mids,
        departure: p.depLoc,
        destination: p.destLoc,
        stops: p.stops.map((s) => s.loc),
        force,
      }).then(
        (w) => {
          if (current()) {
            setWeather(w);
            setWeatherLoading(false);
          }
        },
        (e: unknown) => {
          if (!current()) return;
          setWeather({
            status: 'error',
            message: `Winds unavailable: ${String((e as Error)?.message || e)}`,
            legs: p.mids.map(() => null),
            departure: null,
            destination: null,
            stops: p.stops.map(() => null),
            source: null,
          });
          setWeatherLoading(false);
        },
      );
    };
    if (debounceMs > 0) {
      const t = setTimeout(go, debounceMs);
      return () => clearTimeout(t);
    }
    go();
    return undefined;
  });
  useEffect(() => {
    const current = wxSeq.next();
    if (!enabled) return;
    return requestWeather(current);
  }, [wxSeq, plan.key, refreshCount, enabled]);

  const metarSeq = useSequencer();
  const [metar, setMetar] = useState<MetarTafResult | null>(null);
  const [metarLoading, setMetarLoading] = useState(false);
  const wantMetar = (input.metar ?? 'near') === 'always' || metarRelevant(date);
  const icaoKey = wantMetar ? plan.icaos.join(',') : '';
  useEffect(() => {
    const current = metarSeq.next();
    if (!enabled) return;
    if (!icaoKey) {
      setMetar(null);
      setMetarLoading(false);
      return;
    }
    const force = refreshCount !== lastRefresh.current.metar;
    lastRefresh.current.metar = refreshCount;
    setMetarLoading(true);
    fetchMetarTaf(icaoKey.split(','), { force }).then(
      (m) => {
        if (current()) {
          setMetar(m);
          setMetarLoading(false);
        }
      },
      () => {
        if (current()) {
          setMetar(null);
          setMetarLoading(false);
        }
      },
    );
  }, [metarSeq, icaoKey, refreshCount, enabled]);

  return {
    ...plan,
    legs,
    weather,
    weatherLoading: weatherLoading && hasPoints,
    metar,
    metarLoading,
    refresh,
    refreshCount,
  };
}
