// What the W&B and performance exports need (the session pilot, the flight's aircraft, Open-Meteo
// winds aloft and surface forecast, METAR when the flight is near), through computeExportCalc. The
// weather comes from useFlightWeather, as for the navlog and the editor, so the printouts agree.
import { useMemo, useState } from 'react';

import { REF, runwaysOf, SUN_TABLES } from '../../../data/ref';
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
  /** Winds/surface forecast still loading. */
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
        aerodromes: REF.aerodromes,
        vfrPoints: REF.vfrPoints,
        vfrRoutes: REF.vfrRoutes,
        sunTables: SUN_TABLES,
        runwaysOf,
        terrain,
      },
    });
  }, [loading, flight, aircraft, pilot, weather, metar, terrain]);

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
