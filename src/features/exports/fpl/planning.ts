// What the FPL needs outside the editor: the navlog with the winds aloft (EET) and the fuel plan
// (endurance). Shared by the FPL page (./useFplData.ts) and the native core.
import {
  computeNavlog,
  defaultAltitudes,
  type FuelPlan,
  type LegGeometry,
  localNavlog,
  navlogAircraft,
  type NavlogResult,
  planFuel,
  returnsToStart,
} from '../../../calc';
import { type RouteWeather, windProviderFromLegs } from '../../../data/weather';
import type { Aircraft, Flight, PilotSettings } from '../../../shared';
import { navlogTiming, requestTiming, taxiAllowanceOf } from '../../../shared';
import type { RefAerodrome, RefSunTable, RefVfrPoint, RefVfrRoute } from '../../../shared/ref';

export interface FplPlanningInput {
  flight: Flight;
  aircraft: Aircraft | null;
  settings: Pick<PilotSettings, 'circuitMin' | 'finalReserveMin' | 'reserveMin'>;
  legs: LegGeometry[];
  weather: RouteWeather | null;
  ref: {
    aerodromes: RefAerodrome[];
    vfrPoints: RefVfrPoint[];
    vfrRoutes: RefVfrRoute[];
    sunTables: Record<string, RefSunTable>;
    terrain: Uint8Array | null;
  };
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('FPL calculation failed', e);
    return null;
  }
}

export function fplPlanning(i: FplPlanningInput): { navlog: NavlogResult | null; fuel: FuelPlan | null } {
  const { flight, aircraft, settings, legs, weather, ref } = i;
  const overrides = legs.map((l) => flight.legOverrides[l.key]);
  const timing = requestTiming(flight.route, flight.options, settings.circuitMin);
  const ov = overrides.map((o) => o?.altFt);
  const altitudesFt = defaultAltitudes(
    flight.route,
    { aerodromes: ref.aerodromes, vfrPoints: ref.vfrPoints, vfrRoutes: ref.vfrRoutes, terrain: ref.terrain },
    ov,
    timing.patternPoints,
  ).map((x, k) => ov[k] ?? x.altFt);
  const taxiAllowanceL = aircraft ? taxiAllowanceOf(aircraft.fuel, flight.options) : 0;
  const local = localNavlog(flight.route, flight.options);
  const perLeg = weather ? weather.legs : [];
  const navlog =
    (!legs.length && !local.local) || !aircraft
      ? null
      : safe(() =>
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
            sunTables: ref.sunTables,
            ...navlogTiming(timing),
            ...local,
          }),
        );
  const fuel = !aircraft
    ? null
    : safe(() =>
        planFuel({
          tripFuelL: navlog ? navlog.totals.tripFuel : 0,
          taxiAllowanceL,
          burnLph: aircraft.fuel.burnLph,
          finalReserveMin: settings.finalReserveMin ?? 0,
          reserveMin: settings.reserveMin,
          fobL: flight.fobL,
          usableL: aircraft.fuel.usableL,
          tripMin: navlog ? navlog.flightMin : 0,
          localFlight: returnsToStart(flight.route),
          stops: timing.stops,
        }),
      );
  return { navlog, fuel };
}
