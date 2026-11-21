// The editor's flight calculations as pure functions (no React, no I/O): the navlog, fuel, W&B (also
// at each stop), take-off/landing performance (also the landing at and the take-off from each stop),
// the aerodrome checks and one list of warnings. calc.tsx calls each of them in its own memo; the
// native app's core (src/native/core.ts) calls computeFlightCalc, which runs them all in order, so
// the website and the app compute the same numbers and the same warnings.
import {
  type AdNotamEffect,
  aerodromeNotamEffects,
  type AerodromePerf,
  aerodromePerformance,
  computeNavlog,
  type FlightSector,
  flightSectors,
  type FuelPlan,
  type Hazard,
  hazardLines,
  isaTempC,
  isLocalFlight,
  type LegGeometry,
  lowLegs,
  magneticVariation,
  navlogAircraft,
  type NavlogResult,
  performanceMass,
  pickCompassCard,
  planFuel,
  sectorBalances,
  stopsOf,
  TERRAIN_CLEARANCE_FT,
  wbLoadsFromManifest,
  type WbPoint,
  type WbResult,
  type WbStatus,
  wbStatus,
  weightAndBalance,
} from '../../../calc';
import { endpointAerodrome } from '../../../data/atc';
import { weatherPlan } from '../../../data/flightWeatherPlan';
import { computeRouteHazards, type HazardWeather } from '../../../data/hazardWeather';
import {
  chooseSurface,
  type OpenMeteoLocation,
  type RouteWeather,
  type SurfaceConditions,
  surfaceConditions,
  toPerfWind,
  windProviderFromLegs,
} from '../../../data/weather';
import type { MetarTafResult, StationReports } from '../../../data/weatherMetar';
import {
  activeRequests,
  type Aircraft,
  CARD_EXPIRY_WARN_DAYS,
  type FlightDoc,
  type FlightOptions,
  fuelLoad,
  navlogTiming,
  type PilotSettings,
  type RequestTiming,
  requestTiming,
  type RoutePoint,
  seatLayout,
  taxiAllowanceOf,
  validateCrew,
} from '../../../shared';
import type { NotamBriefing } from '../../../shared/briefing';
import { todayUtc } from '../../../shared/date';
import { fmtClock } from '../../../shared/format';
import type { RefAerodrome, RefRunway, RefSunTable } from '../../../shared/ref';
import { type AdCheck, aerodromeChecks as buildAdChecks, aerodromeWarnings } from './aerodromeChecks';

export type WarningLevel = 'danger' | 'warn' | 'info';
export type WarningArea =
  'navlog' | 'weather' | 'fuel' | 'wb' | 'performance' | 'manifest' | 'aircraft' | 'time' | 'aerodrome';
export interface CalcWarning {
  level: WarningLevel;
  area: WarningArea;
  text: string;
  /** About this leg only: the strip shows it under the leg's row, as `detail` (the text without 'A → B: '). */
  leg?: { index: number; detail: string };
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

/** The reference data the calculations read. */
export interface CalcRef {
  aerodromes: RefAerodrome[];
  runwaysOf: (aerodromeId: string) => RefRunway[];
  sunTables: Record<string, RefSunTable>;
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
export const midKey = (p: { lat: number; lon: number }) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
const DAY = 86400000;
const fmtMin = (min: number): string => fmtClock(min, { fallback: '--:--' });

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('calculation failed', e);
    return null;
  }
}

// ---- navlog

export function calcNavlog(a: {
  doc: Pick<FlightDoc, 'date' | 'blockOff' | 'taxiOutMin' | 'taxiInMin' | 'legOverrides'> & {
    options: Pick<FlightOptions, 'compassCard'>;
  };
  legs: LegGeometry[];
  altitudesFt: number[];
  aircraft: Aircraft | null;
  /** The winds aloft of each leg (its midpoint's forecast), null where there is none. */
  perLeg: (OpenMeteoLocation | null)[];
  timing: RequestTiming;
  taxiAllowanceL: number;
  sunTables: Record<string, RefSunTable>;
}): NavlogResult | null {
  const { doc, legs, aircraft } = a;
  if (!legs.length || !aircraft) return null;
  const haveAny = a.perLeg.some(Boolean);
  return safe(() =>
    computeNavlog({
      date: doc.date,
      blockOff: doc.blockOff,
      taxiOutMin: doc.taxiOutMin,
      taxiInMin: doc.taxiInMin,
      legs,
      altitudesFt: a.altitudesFt,
      overrides: legs.map((l) => doc.legOverrides[l.key]),
      aircraft: navlogAircraft(aircraft, doc.options.compassCard, a.taxiAllowanceL),
      winds: haveAny ? windProviderFromLegs(a.perLeg) : null,
      sunTables: a.sunTables,
      ...navlogTiming(a.timing),
    }),
  );
}

// ---- fuel

export function calcFuel(a: {
  doc: Pick<FlightDoc, 'fobL' | 'route'>;
  aircraft: Aircraft | null;
  settings: Pick<PilotSettings, 'finalReserveMin' | 'reserveMin'>;
  navlog: NavlogResult | null;
  timing: RequestTiming;
  taxiAllowanceL: number;
}): FuelPlan | null {
  const { aircraft, navlog } = a;
  if (!aircraft) return null;
  return safe(() =>
    planFuel({
      tripFuelL: navlog ? navlog.totals.tripFuel : 0,
      taxiAllowanceL: a.taxiAllowanceL,
      burnLph: aircraft.fuel.burnLph,
      finalReserveMin: a.settings.finalReserveMin ?? 0,
      reserveMin: a.settings.reserveMin,
      fobL: a.doc.fobL,
      usableL: aircraft.fuel.usableL,
      tripMin: navlog ? navlog.flightMin : 0,
      localFlight: isLocalFlight(a.doc.route),
      stops: a.timing.stops,
    }),
  );
}

// ---- weight and balance

export interface WbCalc {
  wb: WbResult;
  loadWarnings: string[];
  missingWeights: string[];
}

export function calcWb(a: {
  doc: Pick<FlightDoc, 'crew' | 'baggageKg'> & { options: Pick<FlightOptions, 'fuelL' | 'category'> };
  aircraft: Aircraft | null;
  fuel: FuelPlan | null;
}): WbCalc | null {
  const { doc, aircraft, fuel } = a;
  if (!aircraft) return null;
  const mb = aircraft.massBalance;
  const { loads, warnings, missingWeights } = wbLoadsFromManifest(doc.crew, doc.baggageKg, mb.stations);
  const fob = fuel ? fuel.fobL : 0;
  const load = fuelLoad(aircraft.fuel, fob, doc.options.fuelL);
  const landingL = fuel ? Math.max(0, fuel.landingFuelL) : fob;
  const r = safe(() =>
    weightAndBalance({
      massBalance: mb,
      loads,
      fuelTakeoffL: fob,
      fuelLandingL: landingL,
      fuelDensityKgPerL: load.densityKgPerL,
      unusableFuelL: aircraft.fuel.unusableL,
      unusableIncludedInEmptyMass: aircraft.fuel.unusableIncludedInEmptyMass,
      category: doc.options.category,
    }),
  );
  return r ? { wb: r, loadWarnings: warnings, missingWeights } : null;
}

export interface SectorCalc {
  sectors: FlightSector[];
  wbs: WbResult[];
}

/** Sectors between intermediate full stops: each one's W&B with its own take-off / landing fuel. */
export function calcSectors(a: {
  doc: Pick<FlightDoc, 'crew' | 'baggageKg'> & { options: Pick<FlightOptions, 'fuelL' | 'category'> };
  aircraft: Aircraft | null;
  navlog: NavlogResult | null;
  fuel: FuelPlan | null;
  wb: WbResult | null;
  timing: RequestTiming;
  taxiAllowanceL: number;
}): SectorCalc | null {
  const { doc, aircraft, navlog, fuel, wb, timing } = a;
  if (!aircraft || !navlog || !navlog.legs.length || !fuel || !wb) return null;
  const sectors = flightSectors({
    legs: navlog.legs,
    groundAfterLegMin: timing.groundAfterLegMin,
    touchAfterLeg: timing.touchAfterLeg,
    circuits: navlog.circuits,
    taxiAllowanceL: a.taxiAllowanceL,
    fobL: fuel.fobL,
  });
  if (sectors.length < 2) return { sectors, wbs: [] as WbResult[] };
  const mb = aircraft.massBalance;
  const wbs =
    safe(() =>
      sectorBalances(
        {
          massBalance: mb,
          loads: wbLoadsFromManifest(doc.crew, doc.baggageKg, mb.stations).loads,
          fuelDensityKgPerL: fuelLoad(aircraft.fuel, fuel.fobL, doc.options.fuelL).densityKgPerL,
          unusableFuelL: aircraft.fuel.unusableL,
          unusableIncludedInEmptyMass: aircraft.fuel.unusableIncludedInEmptyMass,
          category: doc.options.category,
        },
        sectors,
      ),
    ) ?? [];
  return { sectors, wbs };
}

/** The W&B status for the flight's category (see wbStatus). */
export function calcWbOk(wb: WbResult | null, category: FlightDoc['options']['category']): WbStatus | null {
  if (!wb) return null;
  const checks = category === 'utility' && wb.utility ? wb.utility : wb.normal;
  const s = wbStatus(wb);
  return {
    takeoff: s.takeoff && checks.takeoff.inEnvelope && checks.takeoff.massOk,
    landing: s.landing && checks.landing.inEnvelope && checks.landing.massOk,
    loading: s.loading,
  };
}

// ---- surface conditions and performance at both ends and at the stops

export interface EndpointContext {
  wb: WbResult | null;
  metar: MetarTafResult | null;
  aircraft: Aircraft | null;
  wbMissingWeights: string[];
  date: string;
  options: FlightDoc['options'];
  runwaysOf: (aerodromeId: string) => RefRunway[];
  /** Now, epoch ms (which METAR is current); default Date.now(). */
  nowMs?: number;
}

/** Surface conditions and performance of one take-off or landing. */
export function calcEndpoint(
  c: EndpointContext,
  phase: 'takeoff' | 'landing',
  ad: RefAerodrome | null,
  loc: OpenMeteoLocation | null,
  timeMs: number,
  massWb: WbResult | null = c.wb,
  runway: string | null = phase === 'takeoff' ? c.options.departureRunway : c.options.arrivalRunway,
  surfaceKey: string | null = phase === 'takeoff' ? c.options.departureSurface : c.options.arrivalSurface,
  stopUid?: string,
  stopKind?: 'stop' | 'touch-and-go',
): EndpointCalc {
  const { metar, aircraft } = c;
  const reports = ad?.icao && metar ? (metar.stations[ad.icao] ?? null) : null;
  const forecast = fin(timeMs) ? surfaceConditions(loc, timeMs) : null;
  const surface = fin(timeMs)
    ? chooseSurface({ metar: reports?.metar ?? null, forecast, timeMs, ...(c.nowMs != null ? { nowMs: c.nowMs } : {}) })
    : null;
  const {
    massKg,
    massSource,
    reason: massReason,
  } = performanceMass(massWb, phase, aircraft?.massBalance.mtowKg, c.wbMissingWeights.length);
  let perf: AerodromePerf | null = null;
  if (ad && aircraft && massKg != null) {
    const elev = ad.elevFt ?? 0;
    perf = safe(() =>
      aerodromePerformance({
        phase,
        aerodromeElevFt: elev,
        runways: c.runwaysOf(ad.id),
        wind: toPerfWind(surface),
        qnhHpa: surface?.qnhHpa ?? 1013.25,
        oatC: surface?.tempC ?? isaTempC(elev),
        variationDeg: magneticVariation(ad.lat, ad.lon, c.date || todayUtc()),
        massKg: massKg,
        tables: aircraft.performance,
        runway,
        surface: surfaceKey,
      }),
    );
  }
  const out: EndpointCalc = {
    phase,
    aerodrome: ad,
    timeMs,
    surface,
    reports,
    perf,
    massKg,
    massSource,
    massReason,
  };
  if (stopUid) {
    out.stopUid = stopUid;
    out.stopKind = stopKind ?? 'stop';
  }
  return out;
}

/** The intermediate full stops and touch-and-goes: landing and take-off there, W&B and fuel at each. */
export function calcStops(a: {
  sectorCalc: SectorCalc | null;
  doc: Pick<FlightDoc, 'route' | 'options'>;
  /** The stops' route point indices and aerodromes, as the weather was fetched for them (weatherPlan). */
  stopIdx: number[];
  stopAds: (RefAerodrome | null)[];
  weather: RouteWeather | null;
  times: NavlogResult['times'] | undefined;
  dayMs: number;
  endpoint: EndpointContext;
  aerodromeOf: (p: RoutePoint | undefined) => RefAerodrome | null;
}): StopCalc[] {
  const { sectorCalc, doc, stopIdx, stopAds, weather, times, dayMs } = a;
  if (!sectorCalc || sectorCalc.sectors.length < 2) return [];
  const reqs = new Map(activeRequests(doc.route, doc.options).map((r) => [`${r.request.kind}|${r.index}`, r.request]));
  const cat = doc.options.category === 'utility' ? 'utility' : 'normal';
  return stopsOf(sectorCalc.sectors).map((x): StopCalc => {
    const point = doc.route[x.pointIndex];
    const k = stopIdx.indexOf(x.pointIndex);
    const ad = k >= 0 ? stopAds[k] : a.aerodromeOf(point);
    // A stop at the departure or the destination: that end's surface forecast.
    const loc =
      k >= 0
        ? (weather?.stops?.[k] ?? null)
        : x.pointIndex === 0
          ? (weather?.departure ?? null)
          : x.pointIndex === doc.route.length - 1
            ? (weather?.destination ?? null)
            : null;
    const req = reqs.get(`${x.kind}|${x.pointIndex}`);
    const before = sectorCalc.wbs[x.before.index] ?? null;
    const after = sectorCalc.wbs[x.after.index] ?? null;
    const ms = (min: number) => (fin(dayMs) && times ? dayMs + min * 60000 : NaN);
    let wbOk: boolean | null = null;
    if (before && after) {
      const envB = cat === 'utility' ? before.utility : before.normal;
      const envA = cat === 'utility' ? after.utility : after.normal;
      wbOk =
        !!envB &&
        !!envA &&
        envB.landing.inEnvelope &&
        envB.landing.massOk &&
        envA.takeoff.inEnvelope &&
        envA.takeoff.massOk &&
        !before.limitBreaches.some((b) => b.phase === 'landing') &&
        !after.limitBreaches.some((b) => b.phase === 'takeoff');
    }
    return {
      pointIndex: x.pointIndex,
      kind: x.kind,
      point,
      aerodrome: ad,
      landing: calcEndpoint(
        a.endpoint,
        'landing',
        ad,
        loc,
        ms(x.before.landingMin),
        before,
        req?.landingRunway ?? null,
        req?.surface ?? null,
        point.uid,
        x.kind,
      ),
      takeoff: calcEndpoint(
        a.endpoint,
        'takeoff',
        ad,
        loc,
        ms(x.after.takeoffMin),
        after,
        req?.takeoffRunway ?? null,
        req?.surface ?? null,
        point.uid,
        x.kind,
      ),
      wb: before ? before.landing : null,
      wbOk,
      fuelL: Math.max(0, x.before.fuelLandingL),
    };
  });
}

// ---- weather hazards and aerodrome hours

export function calcHazards(a: {
  hazardWeather: HazardWeather | null;
  navlog: NavlogResult | null;
  dayMs: number;
  dep: RefAerodrome | null;
  arr: RefAerodrome | null;
  metar: MetarTafResult | null;
  nowMs: number;
}): Hazard[] {
  const { dep, arr, metar } = a;
  return (
    safe(() =>
      computeRouteHazards({
        hw: a.hazardWeather,
        navlog: a.navlog,
        dayMs: a.dayMs,
        departure: dep
          ? { elevFt: dep.elevFt ?? 0, reports: dep.icao && metar ? (metar.stations[dep.icao] ?? null) : null }
          : null,
        destination: arr
          ? { elevFt: arr.elevFt ?? 0, reports: arr.icao && metar ? (metar.stations[arr.icao] ?? null) : null }
          : null,
        nowMs: a.nowMs,
      }),
    ) ?? []
  );
}

/** The flight's NOTAMs that change aerodrome hours, ATS or handling. */
export const calcAdEffects = (briefing: NotamBriefing | null): AdNotamEffect[] =>
  aerodromeNotamEffects(briefing?.notams ?? []);

export function calcAerodromeChecks(a: {
  doc: Pick<FlightDoc, 'route' | 'options'>;
  dep: RefAerodrome | null;
  arr: RefAerodrome | null;
  aerodromeOf: (p: RoutePoint | undefined) => RefAerodrome | null;
  dayMs: number;
  times: NavlogResult['times'] | undefined;
  navlog: NavlogResult | null;
  stops: StopCalc[];
  effects: AdNotamEffect[];
  sunTables: Record<string, RefSunTable>;
}): AdCheck[] {
  return buildAdChecks({
    route: a.doc.route,
    options: a.doc.options,
    departure: a.dep,
    destination: a.arr,
    aerodromeOf: a.aerodromeOf,
    dayMs: a.dayMs,
    times: a.times,
    legEndMin: a.navlog ? a.navlog.legs.map((l) => l.endMin) : [],
    stops: a.stops.map((x) => ({
      pointIndex: x.pointIndex,
      aerodrome: x.aerodrome,
      landingMs: x.landing.timeMs,
      takeoffMs: x.takeoff.timeMs,
    })),
    effects: a.effects,
    sunTables: a.sunTables,
  });
}

/** Problems with the manifest (seats, duplicates…). */
export const calcCrewErrors = (crew: FlightDoc['crew'], aircraft: Aircraft | null): string[] =>
  validateCrew(crew, aircraft ? seatLayout(aircraft.massBalance.stations).map((s) => s.id) : null);

// ---- warnings

export interface WarningsInput {
  doc: Pick<FlightDoc, 'date'> & { options: Pick<FlightOptions, 'category' | 'fuelL' | 'compassCard'> };
  aircraft: Aircraft | null;
  crewErrors: string[];
  weather: RouteWeather | null;
  weatherLoading: boolean;
  navlog: NavlogResult | null;
  dayMs: number;
  fuel: FuelPlan | null;
  wbAll: WbCalc | null;
  wb: WbResult | null;
  departure: EndpointCalc;
  arrival: EndpointCalc;
  stops: StopCalc[];
  takeoffMs: number;
  hazards: Hazard[];
  hazardWeather: HazardWeather | null;
  legs: LegGeometry[];
  dep: RefAerodrome | null;
  arr: RefAerodrome | null;
  aerodromeChecks: AdCheck[];
  terrain: Uint8Array | null;
  altitudesFt: number[];
  nowMs: number;
}

/** Every warning of the flight, most of them in the order the panels show them. */
export function calcWarnings(i: WarningsInput): CalcWarning[] {
  const { aircraft, weather, weatherLoading, navlog, dayMs, fuel, wbAll, wb, stops, legs, dep, arr } = i;
  const { departure, arrival, hazardWeather, terrain, altitudesFt } = i;
  const doc = i.doc;
  const card = aircraft ? pickCompassCard(aircraft.compassCards, doc.options.compassCard) : null;
  const w: CalcWarning[] = [];
  const add = (level: WarningLevel, area: WarningArea, text: string, leg?: CalcWarning['leg']) => {
    if (w.some((x) => x.text === text && x.leg?.index === leg?.index)) return;
    w.push(leg ? { level, area, text, leg } : { level, area, text });
  };
  if (!aircraft) add('warn', 'aircraft', 'No aircraft chosen.');
  for (const e of i.crewErrors) add('danger', 'manifest', `Manifest: ${e}.`);
  if (weather && (weather.status === 'unavailable' || weather.status === 'error'))
    add('warn', 'weather', weather.message);
  if (navlog) {
    const ofLeg = new Set(navlog.legWarnings.map((x) => x.text));
    const level = (t: string): WarningLevel => (/exceed|cannot/i.test(t) ? 'danger' : 'warn');
    const area = (t: string): WarningArea => (/wind/i.test(t) ? 'weather' : 'navlog');
    for (const t of navlog.warnings) {
      // sunset: the editor's own warning below (with the 30-minute margin) stands for it
      if (ofLeg.has(t) || /after sunset/i.test(t) || (/No winds aloft/i.test(t) && (weatherLoading || !weather)))
        continue;
      add(level(t), area(t), t);
    }
    for (const x of navlog.legWarnings)
      add(level(x.text), area(x.text), x.text, { index: x.legIndex, detail: x.detail });
    const missing = navlog.legs.filter((l) => l.windMissing).length;
    if (missing && missing < navlog.legs.length && !weatherLoading)
      add('warn', 'weather', `No wind forecast for ${missing} of ${navlog.legs.length} legs: calm wind assumed there.`);
    const unknownAlt = navlog.legs.filter((l) => !fin(l.altFt)).length;
    if (unknownAlt)
      add('warn', 'navlog', `Altitude unknown on ${unknownAlt} leg${unknownAlt > 1 ? 's' : ''}: set it on the map.`);
    if (navlog.sunsetMin != null && navlog.blockOffSet && navlog.times.landingMin > navlog.sunsetMin) {
      add(
        'danger',
        'time',
        `Landing ${fmtMin(navlog.times.landingMin)}Z is after sunset at the destination (${fmtMin(navlog.sunsetMin)}Z).`,
      );
    } else if (navlog.sunsetMin != null && navlog.blockOffSet && navlog.times.landingMin > navlog.sunsetMin - 30) {
      add(
        'warn',
        'time',
        `Landing ${fmtMin(navlog.times.landingMin)}Z is within 30 min of sunset (${fmtMin(navlog.sunsetMin)}Z).`,
      );
    }
  }
  if (aircraft && card && doc.date) {
    const exp = Date.parse(card.expires + 'T00:00:00Z');
    if (fin(exp) && fin(dayMs)) {
      if (dayMs > exp) add('danger', 'aircraft', `Compass card "${card.name}" expired on ${card.expires}.`);
      else if (exp - dayMs <= CARD_EXPIRY_WARN_DAYS * DAY)
        add('warn', 'aircraft', `Compass card "${card.name}" expires on ${card.expires}.`);
    }
  } else if (aircraft && !card) add('info', 'aircraft', `${aircraft.registration} has no compass card: no DEV/CH.`);
  if (fuel) for (const t of fuel.issues) add(t.level, 'fuel', t.text);
  if (aircraft && fuel) {
    const un = fuelLoad(aircraft.fuel, fuel.fobL, doc.options.fuelL).unapproved;
    if (un.length)
      add(
        'danger',
        'fuel',
        `${un.join(' and ')} ${un.length > 1 ? 'are' : 'is'} not an approved fuel of ${aircraft.registration || 'this aircraft'}.`,
      );
  }
  if (fuel && fuel.landingFuelL < 0) add('danger', 'fuel', 'Fuel on board does not cover the trip.');
  if (wbAll) {
    for (const t of wbAll.loadWarnings) add('warn', 'wb', t);
    const n = wbAll.missingWeights.length;
    if (n)
      add('warn', 'wb', `W&B incomplete: weight missing for ${n} ${n > 1 ? 'people' : 'person'} (counted as 0 kg).`);
  }
  if (wb) {
    for (const t of wb.warnings) add('danger', 'wb', t);
    const cat = doc.options.category === 'utility' ? 'utility' : 'normal';
    // wbOk also fails on MTOW/MLW (their own text is in wb.warnings): name the envelope only when it is the envelope.
    const env = doc.options.category === 'utility' && wb.utility ? wb.utility : wb.normal;
    if (!(env.takeoff.inEnvelope && env.takeoff.massOk))
      add(
        'danger',
        'wb',
        `Take-off mass/CG outside the ${cat} envelope (${wb.takeoff.massKg.toFixed(1)} kg, CG ${wb.takeoff.armM.toFixed(3)} m).`,
      );
    if (!(env.landing.inEnvelope && env.landing.massOk))
      add(
        'danger',
        'wb',
        `Landing mass/CG outside the ${cat} envelope (${wb.landing.massKg.toFixed(1)} kg, CG ${wb.landing.armM.toFixed(3)} m).`,
      );
  }
  for (const x of stops) {
    if (x.wbOk !== false || !x.wb) continue;
    const cat = doc.options.category === 'utility' ? 'utility' : 'normal';
    const where = x.aerodrome ? x.aerodrome.icao || x.aerodrome.name : x.point.name;
    add(
      'danger',
      'wb',
      `${x.kind === 'touch-and-go' ? 'Touch-and-go' : 'Stop'} ${where}: mass/CG outside limits (${cat} category, MLW/MTOW) at ${x.wb.massKg.toFixed(1)} kg, CG ${x.wb.armM.toFixed(3)} m.`,
    );
  }
  for (const e of [departure, ...stops.flatMap((x) => [x.landing, x.takeoff]), arrival]) {
    const name =
      (e.aerodrome ? e.aerodrome.icao || e.aerodrome.name : '') +
      (e.stopUid ? (e.stopKind === 'touch-and-go' ? ' (touch-and-go)' : ' (stop)') : '');
    const p = e.perf;
    if (!p) continue;
    const label = `${e.phase === 'takeoff' ? 'Take-off' : 'Landing'} ${name}`;
    for (const t of p.warnings) {
      const level: WarningLevel = /does not fit|exceeds/i.test(t)
        ? 'danger'
        : /No surface wind|unknown|not published|choose|AFM method/i.test(t)
          ? 'info'
          : 'warn';
      add(level, 'performance', `${label}: ${t}`);
    }
    if (p.marginM != null && p.marginM >= 0 && p.distances) {
      const avail = p.availableTotalM ?? 0;
      if (avail > 0 && p.marginM < avail * 0.15)
        add('warn', 'performance', `${label}: margin only ${Math.round(p.marginM)} m.`);
    }
    if (e.massSource === 'mtow') {
      add(
        e.massReason === 'weight-missing' ? 'warn' : 'info',
        'performance',
        e.massReason === 'weight-missing'
          ? `${label}: W&B incomplete (weight missing), MTOW used.`
          : `${label}: mass unknown, MTOW used.`,
      );
    }
    if (fin(e.timeMs) && !e.surface && !weatherLoading)
      add('info', 'performance', `${label}: no surface forecast, ISA and calm assumed.`);
  }
  if (
    navlog &&
    !navlog.blockOffSet &&
    (departure.perf || arrival.perf || stops.some((x) => x.landing.perf || x.takeoff.perf))
  )
    add('info', 'performance', 'Block start time not set: take-off and landing distances use ISA and calm wind.');
  if (navlog && navlog.legs.length) {
    if (!navlog.blockOffSet)
      add('info', 'weather', 'Block start time not set: no weather hazard check along the route.');
    else if (hazardWeather && hazardWeather.status !== 'ok' && hazardWeather.message)
      add('info', 'weather', hazardWeather.message);
    const leg = (k: number) => (legs[k] ? { from: legs[k].from.name, to: legs[k].to.name } : null);
    const endName = (e: 'departure' | 'destination') => {
      const a = e === 'departure' ? dep : arr;
      return a ? a.icao || a.name : '';
    };
    for (const l of hazardLines(i.hazards, leg, endName, { perLeg: true }))
      add(
        l.level,
        'weather',
        `${l.text}.`,
        l.legIndex != null ? { index: l.legIndex, detail: `${l.detail}.` } : undefined,
      );
  }
  // height above the ground, away from the aerodromes
  if (terrain)
    for (const x of lowLegs(terrain, legs, altitudesFt)) {
      const l = legs[x.legIndex];
      const detail = x.below
        ? `At or below the ground (terrain up to ${x.terrainFt} ft).`
        : `Less than ${TERRAIN_CLEARANCE_FT} ft above the ground (terrain up to ${x.terrainFt} ft).`;
      add(x.below ? 'danger' : 'warn', 'navlog', `${l.from.name} → ${l.to.name}: ${detail}`, {
        index: x.legIndex,
        detail,
      });
    }
  // aerodrome hours (AIP AD 2.3 / AD 1.6, NOTAMs) at the planned times
  for (const x of aerodromeWarnings(i.aerodromeChecks)) add(x.level, 'aerodrome', x.text);
  if (fin(dayMs) && navlog && (fin(i.takeoffMs) ? i.takeoffMs : dayMs + DAY) < i.nowMs - DAY)
    add('info', 'time', 'This flight is in the past.');
  return w;
}

// ---- everything at once (the native core)

export interface FlightCalcInput {
  doc: FlightDoc;
  legs: LegGeometry[];
  altitudesFt: number[];
  aircraft: Aircraft | null;
  settings: PilotSettings;
  weather: RouteWeather | null;
  metar: MetarTafResult | null;
  hazardWeather: HazardWeather | null;
  briefing: NotamBriefing | null;
  terrain: Uint8Array | null;
  ref: CalcRef;
  nowMs: number;
}

export interface FlightCalcResult {
  navlog: NavlogResult | null;
  fuel: FuelPlan | null;
  wb: WbResult | null;
  wbOk: WbStatus | null;
  wbMissingWeights: string[];
  departure: EndpointCalc;
  arrival: EndpointCalc;
  stops: StopCalc[];
  crewErrors: string[];
  dayMs: number;
  hazards: Hazard[];
  aerodromeChecks: AdCheck[];
  adEffects: AdNotamEffect[];
  warnings: CalcWarning[];
}

/** The editor's calculations of a flight whose weather has been fetched (as FlightCalcProvider runs them). */
export function computeFlightCalc(i: FlightCalcInput): FlightCalcResult {
  const { doc, legs, altitudesFt, aircraft, settings, weather, metar, ref, nowMs } = i;
  const plan = weatherPlan({
    date: doc.date,
    model: doc.options.windModel,
    route: doc.route,
    options: doc.options,
    legs,
    aerodromes: ref.aerodromes,
  });
  const dep = plan.departure;
  const arr = plan.destination;
  const aerodromeOf = (p: RoutePoint | undefined) => (p ? endpointAerodrome(p, ref.aerodromes) : null);
  const dayMs = doc.date ? Date.parse(doc.date + 'T00:00:00Z') : NaN;
  const byMid = new Map(weather ? plan.mids.map((m, k) => [midKey(m), weather.legs[k] ?? null]) : []);
  const timing = requestTiming(doc.route, doc.options, settings.circuitMin);
  const taxiAllowanceL = aircraft ? taxiAllowanceOf(aircraft.fuel, doc.options) : 0;
  const navlog = calcNavlog({
    doc,
    legs,
    altitudesFt,
    aircraft,
    perLeg: legs.map((l) => byMid.get(midKey(l.mid)) ?? null),
    timing,
    taxiAllowanceL,
    sunTables: ref.sunTables,
  });
  const fuel = calcFuel({ doc, aircraft, settings, navlog, timing, taxiAllowanceL });
  const wbAll = calcWb({ doc, aircraft, fuel });
  const wb = wbAll?.wb ?? null;
  const sectorCalc = calcSectors({ doc, aircraft, navlog, fuel, wb, timing, taxiAllowanceL });
  const wbMissingWeights = wbAll?.missingWeights ?? [];
  const wbOk = calcWbOk(wb, doc.options.category);
  const times = navlog?.blockOffSet ? navlog.times : undefined;
  const takeoffMs = fin(dayMs) && times ? dayMs + times.takeoffMin * 60000 : NaN;
  const landingMs = fin(dayMs) && times ? dayMs + times.landingMin * 60000 : NaN;
  const ctx: EndpointContext = {
    wb,
    metar,
    aircraft,
    wbMissingWeights,
    date: doc.date,
    options: doc.options,
    runwaysOf: ref.runwaysOf,
    nowMs,
  };
  const departure = calcEndpoint(ctx, 'takeoff', dep, weather?.departure ?? null, takeoffMs);
  const arrival = calcEndpoint(ctx, 'landing', arr, weather?.destination ?? null, landingMs);
  const stops = calcStops({
    sectorCalc,
    doc,
    stopIdx: plan.stops.map((x) => x.pointIndex),
    stopAds: plan.stops.map((x) => x.aerodrome),
    weather,
    times,
    dayMs,
    endpoint: ctx,
    aerodromeOf,
  });
  const hazards = calcHazards({ hazardWeather: i.hazardWeather, navlog, dayMs, dep, arr, metar, nowMs });
  const adEffects = calcAdEffects(i.briefing);
  const aerodromeChecks = calcAerodromeChecks({
    doc,
    dep,
    arr,
    aerodromeOf,
    dayMs,
    times,
    navlog,
    stops,
    effects: adEffects,
    sunTables: ref.sunTables,
  });
  const crewErrors = calcCrewErrors(doc.crew, aircraft);
  const warnings = calcWarnings({
    doc,
    aircraft,
    crewErrors,
    weather,
    weatherLoading: false,
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
    hazardWeather: i.hazardWeather,
    legs,
    dep,
    arr,
    aerodromeChecks,
    terrain: i.terrain,
    altitudesFt,
    nowMs,
  });
  return {
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
    aerodromeChecks,
    adEffects,
    warnings,
  };
}
