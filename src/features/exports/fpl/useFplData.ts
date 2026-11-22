// What the FPL needs outside the editor: the winds aloft for the navlog (EET) and the fuel plan (endurance).
import { useMemo } from 'react';

import type { FuelPlan, NavlogResult } from '../../../calc';
import { REF, SUN_TABLES } from '../../../data/ref';
import { useTerrain } from '../../../data/terrain';
import { useFlightWeather } from '../../../data/useFlightWeather';
import type { RouteWeather } from '../../../data/weather';
import type { Aircraft, Flight, Pilot } from '../../../shared';
import { useFlightAircraft } from '../useExportData';
import { fplPlanning } from './planning';

export interface FplData {
  aircraft: Aircraft | null;
  aircraftLoading: boolean;
  weather: RouteWeather | null;
  weatherLoading: boolean;
  navlog: NavlogResult | null;
  fuel: FuelPlan | null;
}

export function useFplData(flight: Flight, pilot: Pilot): FplData {
  const { aircraft, loading: aircraftLoading } = useFlightAircraft(flight);
  const wx = useFlightWeather({
    date: flight.date,
    route: flight.route,
    options: flight.options,
    model: flight.options.windModel || pilot.settings.windModel,
  });
  const { legs, weather } = wx;
  const weatherLoading = wx.weatherLoading && legs.length > 0;
  const terrain = useTerrain();
  const { circuitMin, finalReserveMin, reserveMin } = pilot.settings;
  const { navlog, fuel } = useMemo(
    () =>
      fplPlanning({
        flight,
        aircraft,
        settings: { circuitMin, finalReserveMin, reserveMin },
        legs,
        weather,
        ref: {
          aerodromes: REF.aerodromes,
          vfrPoints: REF.vfrPoints,
          vfrRoutes: REF.vfrRoutes,
          sunTables: SUN_TABLES,
          terrain,
        },
      }),
    [flight, aircraft, circuitMin, finalReserveMin, reserveMin, legs, weather, terrain],
  );

  return { aircraft, aircraftLoading, weather, weatherLoading, navlog, fuel };
}
