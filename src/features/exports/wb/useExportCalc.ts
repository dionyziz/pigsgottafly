// The weather comes from useFlightWeather, as for the navlog and the editor, so the printouts agree.
import { useMemo, useState } from 'react';

import { refOfFlight } from '../../../data/ref';
import { useTerrain } from '../../../data/terrain';
import { useFlightWeather } from '../../../data/useFlightWeather';
import type { RouteWeather } from '../../../data/weather';
import type { MetarTafResult } from '../../../data/weatherMetar';
import type { Aircraft, Flight, Pilot } from '../../../shared';
import { useFlightAircraft, useFlightPilot } from '../useExportData';
import { computeExportCalc, type ExportCalc } from './exportCalc';

export interface ExportCalcState {
  loading: boolean;
  pilot: Pilot;
  aircraft: Aircraft | null;
  weather: RouteWeather | null;
  metar: MetarTafResult | null;
  weatherPending: boolean;
  refresh: () => void;
  calc: ExportCalc | null;
  nowMs: number;
}

export function useExportCalc(flight: Flight): ExportCalcState {
  const pilot = useFlightPilot(flight);
  const ac = useFlightAircraft(flight);
  const aircraft = ac.aircraft;
  const wx = useFlightWeather({
    date: flight.date,
    route: flight.route,
    options: flight.options,
    model: flight.options.windModel || pilot.settings.windModel,
  });
  const { weather, metar } = wx;
  const terrain = useTerrain();
  // the cycle in effect on the flight's date
  const rd = refOfFlight(flight.date);

  const loading = ac.loading;
  const [nowMs] = useState(() => Date.now());
  const calc = useMemo(() => {
    if (loading) return null;
    return computeExportCalc({
      doc: flight,
      aircraft,
      settings: pilot.settings,
      weather,
      metar,
      nowMs: Date.now(),
      ref: {
        aerodromes: rd.ref.aerodromes,
        vfrPoints: rd.ref.vfrPoints,
        vfrRoutes: rd.ref.vfrRoutes,
        sunTables: rd.sun,
        runwaysOf: rd.runwaysOf,
        terrain,
      },
    });
  }, [loading, flight, aircraft, pilot, weather, metar, terrain, rd]);

  return {
    loading,
    pilot,
    aircraft,
    weather,
    metar,
    weatherPending: wx.weatherLoading,
    refresh: wx.refresh,
    calc,
    nowMs,
  };
}
