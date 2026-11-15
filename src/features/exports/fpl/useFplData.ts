// Loads what the FPL needs outside the editor: the flight's aircraft, the winds aloft for the
// navlog (EET), and the fuel plan (endurance). Calculations come from src/calc; the weather from
// src/data/weather (Open-Meteo), as in the editor (panels/calc.tsx).
import { useEffect, useMemo, useState } from 'react';
import { buildLegs, computeNavlog, defaultAltitudes, navlogAircraft, planFuel, type FuelPlan, type NavlogResult } from '../../../calc';
import type { Aircraft, Flight, Pilot } from '../../../shared';
import { api } from '../../../data/api';
import { REF, SUN_TABLES } from '../../../data/ref';
import { fetchRouteWeather, windProviderFromLegs, type RouteWeather } from '../../../data/weather';

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
  const [aircraft, setAircraft] = useState<Aircraft | null>(null);
  const [aircraftLoading, setAircraftLoading] = useState(!!flight.aircraftId);
  useEffect(() => {
    let live = true;
    if (!flight.aircraftId) { setAircraft(null); setAircraftLoading(false); return; }
    setAircraftLoading(true);
    api.aircraft.get(flight.aircraftId)
      .then((a) => { if (live) setAircraft(a); })
      .catch(() => { if (live) setAircraft(null); })
      .finally(() => { if (live) setAircraftLoading(false); });
    return () => { live = false; };
  }, [flight.aircraftId]);

  const legs = useMemo(() => buildLegs(flight.route, flight.date), [flight.route, flight.date]);
  const overrides = useMemo(() => legs.map((l) => flight.legOverrides[l.key]), [legs, flight.legOverrides]);
  const altitudesFt = useMemo(() => {
    const ov = overrides.map((o) => o?.altFt);
    const d = defaultAltitudes(flight.route, { aerodromes: REF.aerodromes, vfrPoints: REF.vfrPoints, vfrRoutes: REF.vfrRoutes }, ov);
    return d.map((x, i) => ov[i] ?? x.altFt);
  }, [flight.route, overrides]);

  const [weather, setWeather] = useState<RouteWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(legs.length > 0);
  useEffect(() => {
    let live = true;
    if (!legs.length) { setWeather(null); setWeatherLoading(false); return; }
    setWeatherLoading(true);
    fetchRouteWeather({
      date: flight.date,
      model: flight.options.windModel,
      legMidpoints: legs.map((l) => ({ lat: +l.mid.lat.toFixed(3), lon: +l.mid.lon.toFixed(3) })),
      departure: null,
      destination: null,
    }).then((w) => { if (live) { setWeather(w); setWeatherLoading(false); } });
    return () => { live = false; };
  }, [legs, flight.date, flight.options.windModel]);

  const navlog = useMemo(() => {
    if (!legs.length || !aircraft) return null;
    const perLeg = weather ? weather.legs : [];
    return safe(() => computeNavlog({
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
    }));
  }, [legs, aircraft, weather, flight.date, flight.blockOff, flight.taxiOutMin, flight.taxiInMin, altitudesFt, overrides, flight.options.compassCard]);

  const fuel = useMemo(() => {
    if (!aircraft) return null;
    return safe(() => planFuel({
      tripFuelL: navlog ? navlog.totals.tripFuel : 0,
      taxiAllowanceL: aircraft.fuel.taxiAllowanceL,
      burnLph: aircraft.fuel.burnLph,
      finalReserveMin: pilot.settings.finalReserveMin ?? 0,
      reserveMin: pilot.settings.reserveMin,
      fobL: flight.fobL,
      usableL: aircraft.fuel.usableL,
      tripMin: navlog ? navlog.flightMin : 0,
    }));
  }, [aircraft, navlog, pilot.settings.finalReserveMin, pilot.settings.reserveMin, flight.fobL]);

  return { aircraft, aircraftLoading, weather, weatherLoading, navlog, fuel };
}
