// Everything numeric comes from src/calc through the pure functions of flightCalc.ts (shared with the
// native app's core); this file only wires inputs.
import { createContext, type ReactNode, use, useEffect, useEffectEvent, useMemo, useState } from 'react';

import type { AdNotamEffect, FuelPlan, Hazard, NavlogResult, WbResult, WbStatus } from '../../../calc';
import { endpointAerodrome } from '../../../data/atc';
import { fetchHazardWeather, type HazardWeather } from '../../../data/hazardWeather';
import { REF, runwaysOf, SUN_TABLES } from '../../../data/ref';
import { useTerrain } from '../../../data/terrain';
import { useFlightWeather } from '../../../data/useFlightWeather';
import type { OpenMeteoLocation, RouteWeather } from '../../../data/weather';
import type { MetarTafResult } from '../../../data/weatherMetar';
import { localDuration, requestTiming, type RoutePoint, taxiAllowanceOf } from '../../../shared';
import type { RefAerodrome } from '../../../shared/ref';
import { useNotams } from '../notams';
import { useEditor } from '../state';
import type { AdCheck } from './aerodromeChecks';
import {
  calcAdEffects,
  calcAerodromeChecks,
  calcCrewErrors,
  calcEndpoint,
  calcFuel,
  calcHazards,
  calcNavlog,
  calcSectors,
  calcStops,
  type CalcWarning,
  calcWarnings,
  calcWb,
  calcWbOk,
  type EndpointCalc,
  type EndpointContext,
  midKey,
  type StopCalc,
} from './flightCalc';

export { AD_ROLE, type AdCheck } from './aerodromeChecks';
export type { CalcWarning, EndpointCalc, StopCalc } from './flightCalc';

export interface FlightCalc {
  weather: RouteWeather | null;
  weatherLoading: boolean;
  refreshWeather: () => void;
  metar: MetarTafResult | null;
  navlog: NavlogResult | null;
  fuel: FuelPlan | null;
  wb: WbResult | null;
  /** W&B status for the flight's category: take-off and landing (envelope, mass, MTOW/MLW) and the
   *  loading (station and combined maxima, seat counts, utility restrictions). See wbStatus. */
  wbOk: WbStatus | null;
  /** Names of the people on the manifest with no weight (counted as 0 kg in the W&B): the
   *  balance is incomplete until they are set, whatever wbOk says. */
  wbMissingWeights: string[];
  departure: EndpointCalc;
  arrival: EndpointCalc;
  /** Intermediate full stops in route order. */
  stops: StopCalc[];
  crewErrors: string[];
  /** Epoch ms of 00:00 UTC of the flight date (NaN if no date). */
  dayMs: number;
  /** Weather hazards along the route (thunderstorms, visibility, cloud vs planned altitude). */
  hazards: Hazard[];
  hazardWeather: HazardWeather | null;
  /** The route's aerodromes at their planned times against their hours (route order). */
  aerodromeChecks: AdCheck[];
  /** The flight's NOTAMs that change aerodrome hours, ATS or handling. */
  adEffects: AdNotamEffect[];
  warnings: CalcWarning[];
}

const CalcContext = createContext<FlightCalc | null>(null);
export function useFlightCalc(): FlightCalc {
  const v = use(CalcContext);
  if (!v) throw new Error('useFlightCalc outside <FlightCalcProvider>');
  return v;
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

/** The aerodrome a route endpoint stands for (the point's own aerodrome, else one within 2 NM). */
export function endpointOf(p: RoutePoint | undefined): RefAerodrome | null {
  if (!p) return null;
  return endpointAerodrome(p, REF.aerodromes);
}

export function FlightCalcProvider({ children }: { children: ReactNode }) {
  const { doc, legs, altitudesFt, aircraft, pilot, setDerived } = useEditor();

  // ---- winds aloft at the leg midpoints, surface forecast and METAR/TAF at the departure, the stops
  // (full stops and touch-and-goes) and the destination
  const model = doc.options.windModel;
  const wx = useFlightWeather({
    date: doc.date,
    route: doc.route,
    options: doc.options,
    model,
    legs,
    debounceMs: 500,
    metar: 'always',
  });
  const { weather, weatherLoading, metar, refresh: refreshWeather, refreshCount, mids } = wx;
  const dep = wx.departure;
  const arr = wx.destination;
  const stopIdx = useMemo(() => wx.stops.map((x) => x.pointIndex), [wx.stops]);
  const stopAds = useMemo(() => wx.stops.map((x) => x.aerodrome), [wx.stops]);
  const dayMs = doc.date ? Date.parse(doc.date + 'T00:00:00Z') : NaN;
  const force = refreshCount;
  // Winds kept by leg midpoint, so unchanged legs keep their data while a changed route refetches.
  // A result is only ever the newest request's, made for the midpoints of this render.
  const [byMid, setByMid] = useState<Map<string, OpenMeteoLocation | null>>(new Map());
  const keepByMid = useEffectEvent(() => {
    setByMid(weather ? new Map(mids.map((m, i) => [midKey(m), weather.legs[i] ?? null])) : new Map());
  });
  useEffect(() => keepByMid(), [weather]);

  // ---- weather hazards: corridor samples along each leg (grid cells cached individually)
  const hzKey = JSON.stringify([
    doc.date,
    model,
    legs.map((l) => [l.from.lat, l.from.lon, l.to.lat, l.to.lon].map((x) => x.toFixed(3))),
    dep && [dep.lat, dep.lon],
    arr && [arr.lat, arr.lon],
  ]);
  const [hazardWeather, setHazardWeather] = useState<HazardWeather | null>(null);
  const fetchHazards = useEffectEvent(() =>
    legs.length && doc.date
      ? () =>
          fetchHazardWeather({
            date: doc.date,
            model,
            legs: legs.map((l) => ({ from: l.from, to: l.to, distNm: l.distNm })),
            departure: dep ? { lat: dep.lat, lon: dep.lon } : null,
            destination: arr ? { lat: arr.lat, lon: arr.lon } : null,
            force: force > 0,
          })
      : null,
  );
  useEffect(() => {
    const request = fetchHazards();
    if (!request) {
      setHazardWeather(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      request().then(
        (h) => {
          if (live) setHazardWeather(h);
        },
        () => {
          if (live) setHazardWeather(null);
        },
      );
    }, 700);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [hzKey, force]);

  const circuitMin = pilot.settings.circuitMin;
  const timing = useMemo(() => requestTiming(doc.route, doc.options, circuitMin), [doc.route, doc.options, circuitMin]);
  /** Start-up, taxi, take-off and landing fuel per take-off: the flight's, else the aircraft's. */
  const taxiAllowanceL = aircraft ? taxiAllowanceOf(aircraft.fuel, doc.options) : 0;
  const navlog = useMemo(
    () =>
      calcNavlog({
        doc: {
          date: doc.date,
          blockOff: doc.blockOff,
          taxiOutMin: doc.taxiOutMin,
          taxiInMin: doc.taxiInMin,
          legOverrides: doc.legOverrides,
          route: doc.route,
          options: { compassCard: doc.options.compassCard, localDurationMin: doc.options.localDurationMin },
        },
        legs,
        altitudesFt,
        aircraft,
        perLeg: legs.map((l) => byMid.get(midKey(l.mid)) ?? null),
        timing,
        taxiAllowanceL,
        sunTables: SUN_TABLES,
      }),
    [
      legs,
      aircraft,
      byMid,
      doc.date,
      doc.blockOff,
      doc.taxiOutMin,
      doc.taxiInMin,
      altitudesFt,
      doc.legOverrides,
      doc.options.compassCard,
      doc.route,
      doc.options.localDurationMin,
      taxiAllowanceL,
      timing,
    ],
  );

  const { finalReserveMin, reserveMin } = pilot.settings;
  const fuel = useMemo(
    () =>
      calcFuel({
        doc: { fobL: doc.fobL, route: doc.route },
        aircraft,
        settings: { finalReserveMin, reserveMin },
        navlog,
        timing,
        taxiAllowanceL,
      }),
    [aircraft, navlog, finalReserveMin, reserveMin, doc.fobL, doc.route, timing, taxiAllowanceL],
  );

  const { category, fuelL: fuelMix } = doc.options;
  const wbAll = useMemo(
    () =>
      calcWb({
        doc: { crew: doc.crew, baggageKg: doc.baggageKg, options: { category, fuelL: fuelMix } },
        aircraft,
        fuel,
      }),
    [aircraft, doc.crew, doc.baggageKg, fuel, category, fuelMix],
  );
  const wb = wbAll?.wb ?? null;
  // Sectors between intermediate full stops: each one's W&B with its own take-off / landing fuel.
  const sectorCalc = useMemo(
    () =>
      calcSectors({
        doc: { crew: doc.crew, baggageKg: doc.baggageKg, options: { category, fuelL: fuelMix } },
        aircraft,
        navlog,
        fuel,
        wb,
        timing,
        taxiAllowanceL,
      }),
    [aircraft, navlog, fuel, wb, timing, taxiAllowanceL, doc.crew, doc.baggageKg, category, fuelMix],
  );
  const wbMissingWeights = useMemo(() => wbAll?.missingWeights ?? [], [wbAll]);
  const wbOk = useMemo(() => calcWbOk(wb, category), [wb, category]);

  // Only with a block start time: computeNavlog assumes 12:00 without one, and sampling the weather
  // at that made-up time would show distances for conditions nobody planned (the MD 4.4 export
  // likewise uses ISA and calm then).
  const times = navlog?.blockOffSet ? navlog.times : undefined;
  const takeoffMs = fin(dayMs) && times ? dayMs + times.takeoffMin * 60000 : NaN;
  const landingMs = fin(dayMs) && times ? dayMs + times.landingMin * 60000 : NaN;
  const endpointCtx = useMemo(
    (): EndpointContext => ({
      wb,
      metar,
      aircraft,
      wbMissingWeights,
      date: doc.date,
      options: doc.options,
      runwaysOf,
    }),
    [wb, metar, aircraft, wbMissingWeights, doc.date, doc.options],
  );
  const departure = useMemo(
    () => calcEndpoint(endpointCtx, 'takeoff', dep, weather?.departure ?? null, takeoffMs),
    [endpointCtx, dep, weather, takeoffMs],
  );
  const arrival = useMemo(
    () => calcEndpoint(endpointCtx, 'landing', arr, weather?.destination ?? null, landingMs),
    [endpointCtx, arr, weather, landingMs],
  );
  const stops = useMemo(
    (): StopCalc[] =>
      calcStops({
        sectorCalc,
        doc: { route: doc.route, options: doc.options },
        stopIdx,
        stopAds,
        weather,
        times,
        dayMs,
        endpoint: endpointCtx,
        aerodromeOf: endpointOf,
      }),
    [sectorCalc, stopIdx, stopAds, weather, times, dayMs, endpointCtx, doc.route, doc.options],
  );

  const hazards = useMemo(
    () => calcHazards({ hazardWeather, navlog, dayMs, dep, arr, metar, nowMs: Date.now() }),
    [hazardWeather, navlog, dayMs, dep, arr, metar],
  );

  const { briefing } = useNotams();
  const adEffects = useMemo(() => calcAdEffects(briefing), [briefing]);
  const aerodromeChecks = useMemo(
    (): AdCheck[] =>
      calcAerodromeChecks({
        doc: { route: doc.route, options: doc.options },
        dep,
        arr,
        aerodromeOf: endpointOf,
        dayMs,
        times,
        navlog,
        stops,
        effects: adEffects,
        sunTables: SUN_TABLES,
      }),
    [adEffects, dayMs, times, doc.route, doc.options, dep, arr, stops, navlog],
  );

  const crewErrors = useMemo(() => calcCrewErrors(doc.crew, aircraft), [doc.crew, aircraft]);

  const terrain = useTerrain();
  const compassCard = doc.options.compassCard;
  const warnings = useMemo(
    () =>
      calcWarnings({
        doc: { date: doc.date, options: { category, fuelL: fuelMix, compassCard } },
        aircraft,
        crewErrors,
        weather,
        weatherLoading,
        navlog,
        dayMs,
        fuel,
        wbAll,
        wb,
        departure,
        arrival,
        stops,
        takeoffMs,
        hazards,
        hazardWeather,
        legs,
        dep,
        arr,
        aerodromeChecks,
        terrain,
        altitudesFt,
        nowMs: Date.now(),
      }),
    [
      aircraft,
      crewErrors,
      weather,
      weatherLoading,
      navlog,
      doc.date,
      category,
      fuelMix,
      compassCard,
      dayMs,
      fuel,
      wbAll,
      wb,
      departure,
      arrival,
      stops,
      takeoffMs,
      hazards,
      hazardWeather,
      legs,
      dep,
      arr,
      aerodromeChecks,
      terrain,
      altitudesFt,
    ],
  );

  // ETE and fuel for the lobby summary (setDerived: no undo step).
  const planned = !!navlog && (navlog.legs.length > 0 || navlog.local);
  // a local flight's time is known without an aircraft
  const eteMin = planned ? navlog.totals.ete : localDuration(doc.route, doc.options);
  const fuelL = planned && aircraft ? navlog.totals.fuel : null;
  useEffect(() => {
    if (doc.summary.eteMin === eteMin && doc.summary.fuelL === fuelL) return;
    if (weatherLoading) return;
    setDerived({ eteMin, fuelL });
  }, [doc.summary.eteMin, doc.summary.fuelL, eteMin, fuelL, weatherLoading, setDerived]);

  const value: FlightCalc = {
    weather,
    weatherLoading,
    refreshWeather,
    metar,
    navlog,
    fuel,
    wb,
    wbOk,
    wbMissingWeights,
    departure,
    arrival,
    stops,
    crewErrors,
    dayMs,
    hazards,
    hazardWeather,
    aerodromeChecks,
    adEffects,
    warnings,
  };
  return <CalcContext value={value}>{children}</CalcContext>;
}
