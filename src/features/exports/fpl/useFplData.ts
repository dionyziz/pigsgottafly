// What the FPL needs outside the editor: the winds aloft for the navlog (EET) and the fuel plan (endurance).
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
import { useTerrain } from '../../../data/terrain';
import { useFlightWeather } from '../../../data/useFlightWeather';
import { type RouteWeather, windProviderFromLegs } from '../../../data/weather';
import type { Aircraft, Flight, Pilot } from '../../../shared';
import { navlogTiming, requestTiming, taxiAllowanceOf } from '../../../shared';
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
  const { aircraft, loading: aircraftLoading } = useFlightAircraft(flight);
  const wx = useFlightWeather({
    date: flight.date,
    route: flight.route,
    options: flight.options,
    model: flight.options.windModel || pilot.settings.windModel,
  });
  const { legs, weather } = wx;
  const weatherLoading = wx.weatherLoading && legs.length > 0;
  const overrides = useMemo(() => legs.map((l) => flight.legOverrides[l.key]), [legs, flight.legOverrides]);
  const circuitMin = pilot.settings.circuitMin;
  const timing = useMemo(
    () => requestTiming(flight.route, flight.options, circuitMin),
    [flight.route, flight.options, circuitMin],
  );
  const terrain = useTerrain();
  const altitudesFt = useMemo(() => {
    const ov = overrides.map((o) => o?.altFt);
    const d = defaultAltitudes(
      flight.route,
      { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes, terrain },
      ov,
      timing.patternPoints,
    );
    return d.map((x, i) => ov[i] ?? x.altFt);
  }, [flight.route, overrides, timing, terrain]);

  const taxiAllowanceL = aircraft ? taxiAllowanceOf(aircraft.fuel, flight.options) : 0;
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
        aircraft: navlogAircraft(aircraft, flight.options.compassCard, taxiAllowanceL),
        winds: perLeg.some(Boolean) ? windProviderFromLegs(perLeg) : null,
        sunTables: SUN_TABLES,
        ...navlogTiming(timing),
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
    taxiAllowanceL,
    timing,
  ]);

  const fuel = useMemo(() => {
    if (!aircraft) return null;
    return safe(() =>
      planFuel({
        tripFuelL: navlog ? navlog.totals.tripFuel : 0,
        taxiAllowanceL,
        burnLph: aircraft.fuel.burnLph,
        finalReserveMin: pilot.settings.finalReserveMin ?? 0,
        reserveMin: pilot.settings.reserveMin,
        fobL: flight.fobL,
        usableL: aircraft.fuel.usableL,
        tripMin: navlog ? navlog.flightMin : 0,
        stops: timing.stops,
      }),
    );
  }, [
    aircraft,
    navlog,
    pilot.settings.finalReserveMin,
    pilot.settings.reserveMin,
    flight.fobL,
    timing,
    taxiAllowanceL,
  ]);

  return { aircraft, aircraftLoading, weather, weatherLoading, navlog, fuel };
}
