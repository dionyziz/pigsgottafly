// What the FPL needs outside the editor: the flight's aircraft (shared entity cache), the winds
// aloft for the navlog (EET), and the fuel plan (endurance). Calculations come from src/calc; the
// weather from useFlightWeather, as for the other exports and the editor.
import { useMemo } from 'react';

import {
  computeNavlog,
  defaultAltitudes,
  type FuelPlan,
  navlogAircraft,
  type NavlogResult,
  planFuel,
} from '../../../calc';
import { REF, SUN_TABLES } from '../../../data/ref';
import { useFlightWeather } from '../../../data/useFlightWeather';
import { type RouteWeather, windProviderFromLegs } from '../../../data/weather';
import type { Aircraft, Flight, Pilot } from '../../../shared';
import { requestTiming } from '../../../shared';
import { useFlightAircraft } from '../useExportData';

export interface FplData {
  aircraft: Aircraft | null;
  aircraftLoading: boolean;
  weather: RouteWeather | null;
  weatherLoading: boolean;
  navlog: NavlogResult | null;
  fuel: FuelPlan | null;
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('FPL calculation failed', e);
    return null;
  }
}

export function useFplData(flight: Flight, pilot: Pilot): FplData {
  const { aircraft, loading: aircraftLoading } = useFlightAircraft(flight.aircraftId);
  const wx = useFlightWeather({
    date: flight.date,
    route: flight.route,
    options: flight.options,
    model: flight.options.windModel || pilot.settings.windModel,
  });
  const { legs, weather } = wx;
  const weatherLoading = wx.weatherLoading && legs.length > 0;
  const overrides = useMemo(() => legs.map((l) => flight.legOverrides[l.key]), [legs, flight.legOverrides]);
  const timing = useMemo(() => requestTiming(flight.route, flight.options), [flight.route, flight.options]);
  const altitudesFt = useMemo(() => {
    const ov = overrides.map((o) => o?.altFt);
    const d = defaultAltitudes(
      flight.route,
      { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes },
      ov,
      timing.patternPoints,
    );
    return d.map((x, i) => ov[i] ?? x.altFt);
  }, [flight.route, overrides, timing]);

  const navlog = useMemo(() => {
    if (!legs.length || !aircraft) return null;
    const perLeg = weather ? weather.legs : [];
    return safe(() =>
      computeNavlog({
        date: flight.date,
        blockOff: flight.blockOff,
        taxiOutMin: flight.taxiOutMin,
        taxiInMin: flight.taxiInMin,
        legs,
        altitudesFt,
        overrides,
        aircraft: navlogAircraft(aircraft, flight.options.compassCard),
        winds: perLeg.some(Boolean) ? windProviderFromLegs(perLeg) : null,
        sunTables: SUN_TABLES,
        patternLegs: timing.patternLegs,
        groundAfterLegMin: timing.groundAfterLegMin,
        circuitAfterLegMin: timing.circuitAfterLegMin,
      }),
    );
  }, [
    legs,
    aircraft,
    weather,
    flight.date,
    flight.blockOff,
    flight.taxiOutMin,
    flight.taxiInMin,
    altitudesFt,
    overrides,
    flight.options.compassCard,
    timing,
  ]);

  const fuel = useMemo(() => {
    if (!aircraft) return null;
    return safe(() =>
      planFuel({
        tripFuelL: navlog ? navlog.totals.tripFuel : 0,
        taxiAllowanceL: aircraft.fuel.taxiAllowanceL,
        burnLph: aircraft.fuel.burnLph,
        finalReserveMin: pilot.settings.finalReserveMin ?? 0,
        reserveMin: pilot.settings.reserveMin,
        fobL: flight.fobL,
        usableL: aircraft.fuel.usableL,
        tripMin: navlog ? navlog.flightMin : 0,
        stops: timing.groundAfterLegMin.filter((m) => m > 0).length,
      }),
    );
  }, [aircraft, navlog, pilot.settings.finalReserveMin, pilot.settings.reserveMin, flight.fobL, timing]);

  return { aircraft, aircraftLoading, weather, weatherLoading, navlog, fuel };
}
