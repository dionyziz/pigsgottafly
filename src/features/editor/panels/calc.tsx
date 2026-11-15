// Live flight calculations for the editor panels and the navlog strip: winds aloft (Open-Meteo),
// METAR/TAF at the departure, destination and intermediate stops, navlog, fuel, W&B (also at each
// stop: src/calc/sectors.ts), take-off/landing performance (also the landing at and the take-off
// from each stop) and one list of warnings. Everything numeric comes from src/calc; this file only wires inputs.
//
// <FlightCalcProvider> sits inside <EditorProvider> (EditorPage); read with useFlightCalc().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  aerodromePerformance,
  computeNavlog,
  flightSectors,
  isLocalFlight,
  isaTempC,
  magneticVariation,
  navlogAircraft,
  performanceMass,
  pickCompassCard,
  planFuel,
  sectorBalances,
  stopsOf,
  wbLoadsFromManifest,
  wbStatus,
  weightAndBalance,
  type AerodromePerf,
  type FuelPlan,
  type NavlogResult,
  type WbPoint,
  type WbResult,
  type WbStatus,
} from '../../../calc';
import { CARD_EXPIRY_WARN_DAYS, activeRequests, fuelLoad, requestTiming, seatLayout, landingPointIndices, validateCrew, type RoutePoint } from '../../../shared';
import type { RefAerodrome } from '../../../shared/ref';
import { fmtClock, fmtDuration, fmtLocalClock } from '../../../shared/format';
import { REF, SUN_TABLES, runwaysOf } from '../../../data/ref';
import { endpointAerodrome } from '../../../data/atc';
import {
  chooseSurface,
  fetchRouteWeather,
  surfaceConditions,
  toPerfWind,
  windProviderFromLegs,
  type OpenMeteoLocation,
  type RouteWeather,
  type SurfaceConditions,
} from '../../../data/weather';
import { fetchMetarTaf, type MetarTafResult, type StationReports } from '../../../data/weatherMetar';
import { computeRouteHazards, fetchHazardWeather, type HazardWeather } from '../../../data/hazardWeather';
import { aerodromeNotamEffects, hazardWhere, type AdNotamEffect, type Hazard } from '../../../calc';
import { aerodromeChecks as buildAdChecks, aerodromeWarnings, type AdCheck } from './aerodromeChecks';
import { useEditor } from '../state';
import { useNotams } from '../notams';

export type WarningLevel = 'danger' | 'warn' | 'info';
export type WarningArea = 'navlog' | 'weather' | 'fuel' | 'wb' | 'performance' | 'manifest' | 'aircraft' | 'time' | 'aerodrome';
export interface CalcWarning {
  level: WarningLevel;
  area: WarningArea;
  text: string;
}

export interface EndpointCalc {
  phase: 'takeoff' | 'landing';
  aerodrome: RefAerodrome | null;
  /** Time of take-off / landing, epoch ms (NaN if unknown). */
  timeMs: number;
  /** Conditions used (METAR when current, else forecast). */
  surface: SurfaceConditions | null;
  reports: StationReports | null;
  perf: AerodromePerf | null;
  /** Mass used for the performance figures, kg, and where it came from. */
  massKg: number | null;
  massSource: 'wb' | 'mtow' | null;
  /** Why MTOW stands in: no W&B, or someone on the manifest has no weight. */
  massReason: 'weight-missing' | 'no-wb' | null;
  /** Set for an intermediate stop: the RoutePoint.uid of the stop (its runway / surface live on its request). */
  stopUid?: string;
  /** At an intermediate aerodrome: a full stop or a touch-and-go. */
  stopKind?: 'stop' | 'touch-and-go';
}

/** An intermediate full stop: the landing there and the take-off from there. */
export interface StopCalc {
  pointIndex: number;
  /** A full stop, or a touch-and-go (a landing and an immediate take-off). */
  kind: 'stop' | 'touch-and-go';
  point: RoutePoint;
  aerodrome: RefAerodrome | null;
  landing: EndpointCalc;
  takeoff: EndpointCalc;
  /** Mass and CG at the stop (landing there = take-off from there: no refuelling, no taxi burn). */
  wb: WbPoint | null;
  /** Within MLW, MTOW and the flight category's envelope at the stop; null without a W&B. */
  wbOk: boolean | null;
  /** Fuel on board at the stop, L. */
  fuelL: number | null;
}

export { AD_ROLE, type AdCheck } from './aerodromeChecks';

export interface FlightCalc {
  weather: RouteWeather | null;
  weatherLoading: boolean;
  refreshWeather(): void;
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
  const v = useContext(CalcContext);
  if (!v) throw new Error('useFlightCalc outside <FlightCalcProvider>');
  return v;
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
const midKey = (p: { lat: number; lon: number }) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
const DAY = 86400000;

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('calculation failed', e);
    return null;
  }
}

/** The aerodrome a route endpoint stands for (the point's own aerodrome, else one within 2 NM). */
export function endpointOf(p: RoutePoint | undefined): RefAerodrome | null {
  if (!p) return null;
  return endpointAerodrome(p, REF.aerodromes);
}

export function FlightCalcProvider({ children }: { children: ReactNode }) {
  const { doc, legs, altitudesFt, aircraft, pilot, setDerived } = useEditor();

  const dep = useMemo(() => endpointOf(doc.route[0]), [doc.route]);
  const arr = useMemo(() => (doc.route.length > 1 ? endpointOf(doc.route[doc.route.length - 1]) : null), [doc.route]);
  // Intermediate full stops and touch-and-goes: their aerodromes get surface weather and METAR too.
  const stopIdx = useMemo(() => landingPointIndices(doc.route, doc.options), [doc.route, doc.options]);
  const stopAds = useMemo(() => stopIdx.map((i) => endpointOf(doc.route[i])), [stopIdx, doc.route]);
  const stopLocs = useMemo(() => stopIdx.map((i, k) => {
    const a = stopAds[k];
    return a ? { lat: a.lat, lon: a.lon } : { lat: doc.route[i].lat, lon: doc.route[i].lon };
  }), [stopIdx, stopAds, doc.route]);
  const dayMs = doc.date ? Date.parse(doc.date + 'T00:00:00Z') : NaN;

  // ---- winds aloft: fetched per leg midpoint, kept by midpoint so unchanged legs keep their data
  const model = doc.options.windModel;
  const mids = useMemo(() => legs.map((l) => ({ lat: +l.mid.lat.toFixed(3), lon: +l.mid.lon.toFixed(3) })), [legs]);
  const fetchKey = JSON.stringify([doc.date, model, mids, dep && [dep.lat, dep.lon], arr && [arr.lat, arr.lon], stopLocs]);
  const [weather, setWeather] = useState<RouteWeather | null>(null);
  const [byMid, setByMid] = useState<Map<string, OpenMeteoLocation | null>>(new Map());
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [force, setForce] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!mids.length && !dep && !arr) { setWeather(null); setWeatherLoading(false); return; }
    const my = ++seq.current;
    setWeatherLoading(true);
    const t = setTimeout(() => {
      fetchRouteWeather({
        date: doc.date,
        model,
        legMidpoints: mids,
        departure: dep ? { lat: dep.lat, lon: dep.lon } : null,
        destination: arr ? { lat: arr.lat, lon: arr.lon } : null,
        stops: stopLocs,
        force: force > 0,
      }).then((w) => {
        if (my !== seq.current) return;
        setWeather(w);
        setByMid(new Map(mids.map((m, i) => [midKey(m), w.legs[i] ?? null])));
        setWeatherLoading(false);
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, force]);
  const refreshWeather = useCallback(() => setForce((x) => x + 1), []);

  // ---- METAR/TAF at the endpoints
  const icaos = [...new Set([dep?.icao, ...stopAds.map((a) => a?.icao), arr?.icao].filter((x): x is string => !!x))];
  const icaoKey = icaos.join(',');
  const [metar, setMetar] = useState<MetarTafResult | null>(null);
  useEffect(() => {
    if (!icaoKey) { setMetar(null); return; }
    let live = true;
    fetchMetarTaf(icaoKey.split(','), { force: force > 0 }).then((m) => { if (live) setMetar(m); });
    return () => { live = false; };
  }, [icaoKey, force]);

  // ---- weather hazards: corridor samples along each leg (grid cells cached individually)
  const hzKey = JSON.stringify([doc.date, model, legs.map((l) => [l.from.lat, l.from.lon, l.to.lat, l.to.lon].map((x) => x.toFixed(3))), dep && [dep.lat, dep.lon], arr && [arr.lat, arr.lon]]);
  const [hazardWeather, setHazardWeather] = useState<HazardWeather | null>(null);
  useEffect(() => {
    if (!legs.length || !doc.date) { setHazardWeather(null); return; }
    let live = true;
    const t = setTimeout(() => {
      fetchHazardWeather({
        date: doc.date, model,
        legs: legs.map((l) => ({ from: l.from, to: l.to, distNm: l.distNm })),
        departure: dep ? { lat: dep.lat, lon: dep.lon } : null,
        destination: arr ? { lat: arr.lat, lon: arr.lon } : null,
        force: force > 0,
      }).then((h) => { if (live) setHazardWeather(h); });
    }, 700);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hzKey, force]);

  // ---- navlog
  const overrides = useMemo(() => legs.map((l) => doc.legOverrides[l.key]), [legs, doc.legOverrides]);
  const timing = useMemo(() => requestTiming(doc.route, doc.options), [doc.route, doc.options]);
  const card = aircraft ? pickCompassCard(aircraft.compassCards, doc.options.compassCard) : null;
  const navlog = useMemo(() => {
    if (!legs.length || !aircraft) return null;
    const perLeg = legs.map((l) => byMid.get(midKey(l.mid)) ?? null);
    const haveAny = perLeg.some(Boolean);
    return safe(() => computeNavlog({
      date: doc.date,
      blockOff: doc.blockOff,
      taxiOutMin: doc.taxiOutMin,
      taxiInMin: doc.taxiInMin,
      legs,
      altitudesFt,
      overrides,
      aircraft: navlogAircraft(aircraft, doc.options.compassCard),
      winds: haveAny ? windProviderFromLegs(perLeg) : null,
      sunTables: SUN_TABLES,
      patternLegs: timing.patternLegs,
      groundAfterLegMin: timing.groundAfterLegMin,
    }));
  }, [legs, aircraft, byMid, doc.date, doc.blockOff, doc.taxiOutMin, doc.taxiInMin, altitudesFt, overrides, doc.options.compassCard, timing]);

  // ---- fuel
  const fuel = useMemo(() => {
    if (!aircraft) return null;
    return safe(() => planFuel({
      tripFuelL: navlog ? navlog.totals.tripFuel : 0,
      taxiAllowanceL: aircraft.fuel.taxiAllowanceL,
      burnLph: aircraft.fuel.burnLph,
      finalReserveMin: pilot.settings.finalReserveMin ?? 0,
      reserveMin: pilot.settings.reserveMin,
      fobL: doc.fobL,
      usableL: aircraft.fuel.usableL,
      tripMin: navlog ? navlog.flightMin : 0,
      localFlight: isLocalFlight(doc.route),
      stops: timing.groundAfterLegMin.filter((m) => m > 0).length,
    }));
  }, [aircraft, navlog, pilot.settings.finalReserveMin, pilot.settings.reserveMin, doc.fobL, doc.route, timing]);

  // ---- weight and balance
  const wbAll = useMemo(() => {
    if (!aircraft) return null;
    const mb = aircraft.massBalance;
    const { loads, warnings, missingWeights } = wbLoadsFromManifest(doc.crew, doc.baggageKg, mb.stations);
    const fob = fuel ? fuel.fobL : 0;
    const load = fuelLoad(aircraft.fuel, fob, doc.options.fuelL);
    const landingL = fuel ? Math.max(0, fuel.landingFuelL) : fob;
    const r = safe(() => weightAndBalance({
      massBalance: mb,
      loads,
      fuelTakeoffL: fob,
      fuelLandingL: landingL,
      fuelDensityKgPerL: load.densityKgPerL,
      unusableFuelL: aircraft.fuel.unusableL,
      unusableIncludedInEmptyMass: aircraft.fuel.unusableIncludedInEmptyMass,
      category: doc.options.category,
    }));
    return r ? { wb: r, loadWarnings: warnings, missingWeights } : null;
  }, [aircraft, doc.crew, doc.baggageKg, fuel, doc.options.category, doc.options.fuelL]);
  const wb = wbAll?.wb ?? null;
  // Sectors between intermediate full stops: each one's W&B with its own take-off / landing fuel.
  const sectorCalc = useMemo(() => {
    if (!aircraft || !navlog || !navlog.legs.length || !fuel || !wb) return null;
    const sectors = flightSectors({ legs: navlog.legs, groundAfterLegMin: timing.groundAfterLegMin, touchAfterLeg: timing.touchAfterLeg, taxiAllowanceL: aircraft.fuel.taxiAllowanceL, fobL: fuel.fobL });
    if (sectors.length < 2) return { sectors, wbs: [] as WbResult[] };
    const mb = aircraft.massBalance;
    const wbs = safe(() => sectorBalances({
      massBalance: mb,
      loads: wbLoadsFromManifest(doc.crew, doc.baggageKg, mb.stations).loads,
      fuelDensityKgPerL: fuelLoad(aircraft.fuel, fuel.fobL, doc.options.fuelL).densityKgPerL,
      unusableFuelL: aircraft.fuel.unusableL,
      unusableIncludedInEmptyMass: aircraft.fuel.unusableIncludedInEmptyMass,
      category: doc.options.category,
    }, sectors)) ?? [];
    return { sectors, wbs };
  }, [aircraft, navlog, fuel, wb, timing, doc.crew, doc.baggageKg, doc.options.category, doc.options.fuelL]);
  const wbMissingWeights = useMemo(() => wbAll?.missingWeights ?? [], [wbAll]);
  const wbOk = useMemo(() => {
    if (!wb) return null;
    const checks = doc.options.category === 'utility' && wb.utility ? wb.utility : wb.normal;
    const s = wbStatus(wb);
    return {
      takeoff: s.takeoff && checks.takeoff.inEnvelope && checks.takeoff.massOk,
      landing: s.landing && checks.landing.inEnvelope && checks.landing.massOk,
      loading: s.loading,
    };
  }, [wb, doc.options.category]);

  // ---- surface conditions and performance at both ends
  // Only with a block-off time: computeNavlog assumes 12:00 without one, and sampling the weather
  // at that made-up time would show distances for conditions nobody planned (the MD 4.4 export
  // likewise uses ISA and calm then).
  const times = navlog?.blockOffSet ? navlog.times : undefined;
  const takeoffMs = fin(dayMs) && times ? dayMs + times.takeoffMin * 60000 : NaN;
  const landingMs = fin(dayMs) && times ? dayMs + times.landingMin * 60000 : NaN;
  const modelLabel = weather?.source?.modelLabel ?? 'Forecast';
  const endpoint = (
    phase: 'takeoff' | 'landing', ad: RefAerodrome | null, loc: OpenMeteoLocation | null, timeMs: number,
    massWb: WbResult | null = wb,
    runway: string | null = phase === 'takeoff' ? doc.options.departureRunway : doc.options.arrivalRunway,
    surfaceKey: string | null = phase === 'takeoff' ? doc.options.departureSurface : doc.options.arrivalSurface,
    stopUid?: string,
    stopKind?: 'stop' | 'touch-and-go',
  ): EndpointCalc => {
    const reports = ad?.icao && metar ? metar.stations[ad.icao] ?? null : null;
    const forecast = fin(timeMs) ? surfaceConditions(loc, timeMs, modelLabel) : null;
    const surface = fin(timeMs) ? chooseSurface({ metar: reports?.metar ?? null, forecast, timeMs }) : null;
    const { massKg, massSource, reason: massReason } = performanceMass(massWb, phase, aircraft?.massBalance.mtowKg, wbMissingWeights.length);
    let perf: AerodromePerf | null = null;
    if (ad && aircraft && massKg != null) {
      const elev = ad.elevFt ?? 0;
      perf = safe(() => aerodromePerformance({
        phase,
        aerodromeElevFt: elev,
        runways: runwaysOf(ad.id),
        wind: toPerfWind(surface),
        qnhHpa: surface?.qnhHpa ?? 1013.25,
        oatC: surface?.tempC ?? isaTempC(elev),
        variationDeg: magneticVariation(ad.lat, ad.lon, doc.date || new Date().toISOString().slice(0, 10)),
        massKg: massKg as number,
        tables: aircraft.performance,
        runway,
        surface: surfaceKey,
      }));
    }
    const out: EndpointCalc = { phase, aerodrome: ad, timeMs, surface, reports, perf, massKg, massSource, massReason };
    if (stopUid) { out.stopUid = stopUid; out.stopKind = stopKind ?? 'stop'; }
    return out;
  };
  const departure = useMemo(() => endpoint('takeoff', dep, weather?.departure ?? null, takeoffMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dep, weather, takeoffMs, metar, wb, wbMissingWeights, aircraft, doc.date, doc.options]);
  const arrival = useMemo(() => endpoint('landing', arr, weather?.destination ?? null, landingMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arr, weather, landingMs, metar, wb, wbMissingWeights, aircraft, doc.date, doc.options]);
  const stops = useMemo((): StopCalc[] => {
    if (!sectorCalc || sectorCalc.sectors.length < 2) return [];
    const reqs = new Map(activeRequests(doc.route, doc.options).map((r) => [r.index, r.request]));
    const cat = doc.options.category === 'utility' ? 'utility' : 'normal';
    return stopsOf(sectorCalc.sectors).map((x): StopCalc => {
      const point = doc.route[x.pointIndex];
      const k = stopIdx.indexOf(x.pointIndex);
      const ad = k >= 0 ? stopAds[k] : endpointOf(point);
      const loc = k >= 0 ? weather?.stops?.[k] ?? null : null;
      const req = reqs.get(x.pointIndex);
      const before = sectorCalc.wbs[x.before.index] ?? null;
      const after = sectorCalc.wbs[x.after.index] ?? null;
      const ms = (min: number) => (fin(dayMs) && times ? dayMs + min * 60000 : NaN);
      let wbOk: boolean | null = null;
      if (before && after) {
        const envB = cat === 'utility' ? before.utility : before.normal;
        const envA = cat === 'utility' ? after.utility : after.normal;
        wbOk = !!envB && !!envA && envB.landing.inEnvelope && envB.landing.massOk && envA.takeoff.inEnvelope && envA.takeoff.massOk
          && !before.limitBreaches.some((b) => b.phase === 'landing') && !after.limitBreaches.some((b) => b.phase === 'takeoff');
      }
      return {
        pointIndex: x.pointIndex, kind: x.kind, point, aerodrome: ad,
        landing: endpoint('landing', ad, loc, ms(x.before.landingMin), before, req?.landingRunway ?? null, req?.surface ?? null, point.uid, x.kind),
        takeoff: endpoint('takeoff', ad, loc, ms(x.after.takeoffMin), after, req?.takeoffRunway ?? null, req?.surface ?? null, point.uid, x.kind),
        wb: before ? before.landing : null,
        wbOk,
        fuelL: Math.max(0, x.before.fuelLandingL),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorCalc, stopIdx, stopAds, weather, metar, times, dayMs, wbMissingWeights, aircraft, doc.date, doc.route, doc.options]);

  // ---- weather hazards at the planned times and altitudes
  const hazards = useMemo(() => safe(() => computeRouteHazards({
    hw: hazardWeather, navlog, dayMs,
    departure: dep ? { elevFt: dep.elevFt ?? 0, reports: dep.icao && metar ? metar.stations[dep.icao] ?? null : null } : null,
    destination: arr ? { elevFt: arr.elevFt ?? 0, reports: arr.icao && metar ? metar.stations[arr.icao] ?? null : null } : null,
    nowMs: Date.now(),
  })) ?? [], [hazardWeather, navlog, dayMs, dep, arr, metar]);

  // ---- aerodrome hours at the planned times (AIP + the flight's NOTAMs)
  const { briefing } = useNotams();
  const adEffects = useMemo(() => aerodromeNotamEffects(briefing?.notams ?? []), [briefing]);
  const aerodromeChecks = useMemo((): AdCheck[] => buildAdChecks({
    route: doc.route, options: doc.options, departure: dep, destination: arr, aerodromeOf: endpointOf, dayMs, times,
    legEndMin: navlog ? navlog.legs.map((l) => l.endMin) : [],
    stops: stops.map((x) => ({ pointIndex: x.pointIndex, aerodrome: x.aerodrome, landingMs: x.landing.timeMs, takeoffMs: x.takeoff.timeMs })),
    effects: adEffects, sunTables: SUN_TABLES,
  }), [adEffects, dayMs, times, doc.route, doc.options, dep, arr, stops, navlog]);

  // ---- manifest
  const crewErrors = useMemo(
    () => validateCrew(doc.crew, aircraft ? seatLayout(aircraft.massBalance.stations).map((s) => s.id) : null),
    [doc.crew, aircraft],
  );

  // ---- warnings
  const warnings = useMemo(() => {
    const w: CalcWarning[] = [];
    const add = (level: WarningLevel, area: WarningArea, text: string) => { if (!w.some((x) => x.text === text)) w.push({ level, area, text }); };
    if (!aircraft) add('warn', 'aircraft', doc.route.length > 1 ? 'Choose an aircraft to compute the navlog, fuel, W&B and performance.' : 'No aircraft chosen.');
    for (const e of crewErrors) add('danger', 'manifest', `Manifest: ${e}.`);
    if (weather && (weather.status === 'unavailable' || weather.status === 'error')) add('warn', 'weather', weather.message);
    if (navlog) {
      for (const t of navlog.warnings) {
        if (/No winds aloft/i.test(t) && (weatherLoading || !weather)) continue;
        add(/exceed|cannot/i.test(t) ? 'danger' : 'warn', /wind/i.test(t) ? 'weather' : 'navlog', t);
      }
      const missing = navlog.legs.filter((l) => l.windMissing).length;
      if (missing && missing < navlog.legs.length && !weatherLoading) add('warn', 'weather', `No wind forecast for ${missing} of ${navlog.legs.length} legs: calm wind assumed there.`);
      const unknownAlt = navlog.legs.filter((l) => !fin(l.altFt)).length;
      if (unknownAlt) add('warn', 'navlog', `Altitude unknown on ${unknownAlt} leg${unknownAlt > 1 ? 's' : ''}: set it on the map.`);
      if (navlog.sunsetMin != null && navlog.blockOffSet && navlog.times.landingMin > navlog.sunsetMin) {
        add('danger', 'time', `Landing ${fmtMin(navlog.times.landingMin)}Z is after sunset at the destination (${fmtMin(navlog.sunsetMin)}Z).`);
      } else if (navlog.sunsetMin != null && navlog.blockOffSet && navlog.times.landingMin > navlog.sunsetMin - 30) {
        add('warn', 'time', `Landing ${fmtMin(navlog.times.landingMin)}Z is within 30 min of sunset (${fmtMin(navlog.sunsetMin)}Z).`);
      }
    }
    if (aircraft && card && doc.date) {
      const exp = Date.parse(card.expires + 'T00:00:00Z');
      if (fin(exp) && fin(dayMs)) {
        if (dayMs > exp) add('danger', 'aircraft', `Compass card "${card.name}" expired on ${card.expires}.`);
        else if (exp - dayMs <= CARD_EXPIRY_WARN_DAYS * DAY) add('warn', 'aircraft', `Compass card "${card.name}" expires on ${card.expires}.`);
      }
    } else if (aircraft && !card) add('info', 'aircraft', `${aircraft.registration} has no compass card: no DEV/CH.`);
    if (fuel) for (const t of fuel.issues) add(t.level, 'fuel', t.text);
    if (aircraft && fuel) {
      const un = fuelLoad(aircraft.fuel, fuel.fobL, doc.options.fuelL).unapproved;
      if (un.length) add('danger', 'fuel', `${un.join(' and ')} ${un.length > 1 ? 'are' : 'is'} not an approved fuel of ${aircraft.registration || 'this aircraft'}.`);
    }
    if (fuel && fuel.landingFuelL < 0) add('danger', 'fuel', 'Fuel on board does not cover the trip.');
    if (wbAll) {
      for (const t of wbAll.loadWarnings) add('warn', 'wb', t);
      const n = wbAll.missingWeights.length;
      if (n) add('warn', 'wb', `W&B incomplete: weight missing for ${n} ${n > 1 ? 'people' : 'person'} (counted as 0 kg).`);
    }
    if (wb) {
      for (const t of wb.warnings) add('danger', 'wb', t);
      const cat = doc.options.category === 'utility' ? 'utility' : 'normal';
      // wbOk also fails on MTOW/MLW (their own text is in wb.warnings): name the envelope only when it is the envelope.
      const env = doc.options.category === 'utility' && wb.utility ? wb.utility : wb.normal;
      if (!(env.takeoff.inEnvelope && env.takeoff.massOk)) add('danger', 'wb', `Take-off mass/CG outside the ${cat} envelope (${wb.takeoff.massKg.toFixed(1)} kg, CG ${wb.takeoff.armM.toFixed(3)} m).`);
      if (!(env.landing.inEnvelope && env.landing.massOk)) add('danger', 'wb', `Landing mass/CG outside the ${cat} envelope (${wb.landing.massKg.toFixed(1)} kg, CG ${wb.landing.armM.toFixed(3)} m).`);
    }
    for (const x of stops) {
      if (x.wbOk !== false || !x.wb) continue;
      const cat = doc.options.category === 'utility' ? 'utility' : 'normal';
      const where = x.aerodrome ? x.aerodrome.icao || x.aerodrome.name : x.point.name;
      add('danger', 'wb', `Stop ${where}: mass/CG outside limits (${cat} category, MLW/MTOW) at ${x.wb.massKg.toFixed(1)} kg, CG ${x.wb.armM.toFixed(3)} m.`);
    }
    for (const e of [departure, ...stops.flatMap((x) => [x.landing, x.takeoff]), arrival]) {
      const name = (e.aerodrome ? e.aerodrome.icao || e.aerodrome.name : '') + (e.stopUid ? (e.stopKind === 'touch-and-go' ? ' (touch-and-go)' : ' (stop)') : '');
      const p = e.perf;
      if (!p) continue;
      const label = `${e.phase === 'takeoff' ? 'Take-off' : 'Landing'} ${name}`;
      for (const t of p.warnings) {
        const level: WarningLevel = /does not fit|exceeds/i.test(t) ? 'danger' : /No surface wind|unknown|not published|choose|AFM method/i.test(t) ? 'info' : 'warn';
        add(level, 'performance', `${label}: ${t}`);
      }
      if (p.marginM != null && p.marginM >= 0 && p.distances) {
        const avail = p.availableTotalM ?? 0;
        if (avail > 0 && p.marginM < avail * 0.15) add('warn', 'performance', `${label}: margin only ${Math.round(p.marginM)} m.`);
      }
      if (e.massSource === 'mtow') {
        add(e.massReason === 'weight-missing' ? 'warn' : 'info', 'performance',
          e.massReason === 'weight-missing' ? `${label}: W&B incomplete (weight missing), MTOW used.` : `${label}: mass unknown, MTOW used.`);
      }
      if (fin(e.timeMs) && !e.surface && !weatherLoading) add('info', 'performance', `${label}: no surface forecast, ISA and calm assumed.`);
    }
    if (navlog && !navlog.blockOffSet && (departure.perf || arrival.perf || stops.some((x) => x.landing.perf || x.takeoff.perf))) add('info', 'performance', 'Block-off time not set: take-off and landing distances use ISA and calm wind.');
    if (navlog && navlog.legs.length) {
      if (!navlog.blockOffSet) add('info', 'weather', 'Block-off time not set: no weather hazard check along the route.');
      else if (hazardWeather && hazardWeather.status !== 'ok' && hazardWeather.message) add('info', 'weather', hazardWeather.message);
      const legName = (i: number) => (legs[i] ? `${legs[i].from.name} → ${legs[i].to.name}` : '');
      const endName = (e: 'departure' | 'destination') => { const a = e === 'departure' ? dep : arr; return a ? a.icao || a.name : ''; };
      for (const h of hazards) add(h.level, 'weather', `${hazardWhere(h, legName, endName)}: ${h.text} (${h.source}).`);
    }
    // aerodrome hours (AIP AD 2.3 / AD 1.6, NOTAMs) at the planned times
    for (const x of aerodromeWarnings(aerodromeChecks, doc.route.length)) add(x.level, 'aerodrome', x.text);
    if (fin(dayMs) && navlog && (fin(takeoffMs) ? takeoffMs : dayMs + DAY) < Date.now() - DAY) add('info', 'time', 'This flight is in the past.');
    return w;
  }, [aircraft, crewErrors, weather, weatherLoading, navlog, card, doc.date, doc.route.length, doc.options.category, doc.options.fuelL, dayMs, fuel, wbAll, wb, wbOk, departure, arrival, stops, takeoffMs, hazards, hazardWeather, legs, dep, arr, aerodromeChecks]);

  // ---- lobby summary: ETE and fuel come from the navlog (setDerived: no undo step).
  const eteMin = navlog && navlog.legs.length ? navlog.totals.ete : null;
  const fuelL = navlog && navlog.legs.length && aircraft ? navlog.totals.fuel : null;
  useEffect(() => {
    if (doc.summary.eteMin === eteMin && doc.summary.fuelL === fuelL) return;
    if (weatherLoading) return;
    setDerived({ eteMin, fuelL });
  }, [doc.summary.eteMin, doc.summary.fuelL, eteMin, fuelL, weatherLoading, setDerived]);

  const value: FlightCalc = {
    weather, weatherLoading, refreshWeather, metar,
    navlog, fuel, wb, wbOk, wbMissingWeights, departure, arrival, stops, crewErrors, dayMs, hazards, hazardWeather, aerodromeChecks, adEffects, warnings,
  };
  return <CalcContext.Provider value={value}>{children}</CalcContext.Provider>;
}

/** Minutes after 00:00 UTC → 'HH:MM' (wraps past midnight; '--:--' when unknown). */
export const fmtMin = (min: number): string => fmtClock(min, { fallback: '--:--' });
/** Duration in minutes → '1h44' ('–' when unknown). */
export const fmtDur = (min: number | null | undefined): string => fmtDuration(min, { fallback: '–' });
/** Local (Greece) clock time of a UTC instant, e.g. '14:30'. */
export const localClock = (ms: number): string => fmtLocalClock(ms);
/** Offset label of local time at an instant, e.g. 'UTC+2'. */
export { localOffsetLabel } from '../../../shared/date';
