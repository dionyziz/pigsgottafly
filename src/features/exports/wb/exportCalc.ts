// Computed the way the flight editor computes them (src/features/editor/panels/calc.tsx), without the
// editor context, so the exports agree with the editor.
import {
  type AerodromePerf,
  aerodromePerformance,
  type FlightSector,
  flightSectors,
  isaTempC,
  magneticVariation,
  performanceMass,
  sectorBalances,
  stopsOf,
  wbLoadsFromManifest,
  type WbResult,
  weightAndBalance,
} from '../../../calc';
import type { OpenMeteoLocation, RouteWeather, SurfaceConditions } from '../../../data/weather';
import { toPerfWind } from '../../../data/weather';
import type { MetarTafResult } from '../../../data/weatherMetar';
import type { Aircraft, FlightDoc, PilotSettings, RoutePoint } from '../../../shared';
import {
  activeRequests,
  type FuelLoad,
  fuelLoad,
  landingPointIndices,
  type RequestTiming,
  requestTiming,
  taxiAllowanceOf,
} from '../../../shared';
import type { RefAerodrome, RefRunway, RefSunTable, RefVfrPoint, RefVfrRoute } from '../../../shared/ref';
import { computeFlightNavlog, type EndpointWeather, endpointWeather, type NavlogComputed } from '../navlog/model';

const sectorTiming = (t: RequestTiming) => ({ groundAfterLegMin: t.groundAfterLegMin, touchAfterLeg: t.touchAfterLeg });

export interface ExportCalcInput {
  doc: FlightDoc;
  aircraft: Aircraft | null;
  settings: PilotSettings | null;
  weather: RouteWeather | null;
  metar: MetarTafResult | null;
  nowMs: number;
  ref: {
    aerodromes: RefAerodrome[];
    vfrPoints: RefVfrPoint[];
    vfrRoutes: RefVfrRoute[];
    sunTables: Record<string, RefSunTable>;
    runwaysOf: (aerodromeId: string) => RefRunway[];
    terrain?: Uint8Array | null;
  };
}

export interface EndpointPerf {
  phase: 'takeoff' | 'landing';
  point: RoutePoint | null;
  aerodrome: RefAerodrome | null;
  /** Minutes after 00:00 UTC of the flight date of the take-off / landing (NaN when unknown). */
  timeMin: number;
  /** The surface conditions used (METAR when current, else forecast), null = none (ISA, calm). */
  weather: EndpointWeather | null;
  conditions: SurfaceConditions | null;
  qnhHpa: number;
  qnhAssumed: boolean;
  oatC: number;
  oatAssumed: boolean;
  /** Wind (true) used for the components; dirTrueDeg null = variable (or calm at 0 kt); null = unknown. */
  wind: { dirTrueDeg: number | null; speedKt: number; gustKt: number | null } | null;
  variationDeg: number;
  massKg: number | null;
  massSource: 'wb' | 'mtow' | null;
  /** Why MTOW stands in: no W&B, or someone on the manifest has no weight. */
  massReason: 'weight-missing' | 'no-wb' | null;
  surface: string | null;
  /** Runway chosen in the editor (null = from the wind). */
  forcedRunway: string | null;
  perf: AerodromePerf | null;
}

/** An intermediate full stop: its landing (end of sector `before`) and take-off (start of `after`). */
export interface ExportStop {
  point: RoutePoint;
  pointIndex: number;
  /** A full stop, or a touch-and-go (a landing and an immediate take-off). */
  kind: 'stop' | 'touch-and-go';
  before: FlightSector;
  after: FlightSector;
  /** W&B of the sectors before and after the stop (null without an aircraft). */
  wbBefore: WbResult | null;
  wbAfter: WbResult | null;
  landing: EndpointPerf;
  takeoff: EndpointPerf;
}

export interface ExportCalc {
  computed: NavlogComputed;
  wb: WbResult | null;
  wbLoadWarnings: string[];
  /** People on the manifest with no weight (0 kg in the W&B): the balance is incomplete. */
  missingWeights: string[];
  /** Fuel at take-off / landing used for the W&B, L. */
  fuelTakeoffL: number;
  /** Fuel on board at block start by type (litres, mass, the mix's density); null without an aircraft. */
  fuelLoad: FuelLoad | null;
  fuelLandingL: number;
  /** Fuel burnt between take-off and landing in the W&B (taxi allowance + trip), L. */
  fuelBurnL: number;
  departure: EndpointPerf;
  arrival: EndpointPerf;
  /** Take-off → landing sectors (one per leg run between full stops); [] without a route. */
  sectors: FlightSector[];
  stops: ExportStop[];
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

export function computeExportCalc(input: ExportCalcInput): ExportCalc {
  const { doc, aircraft, settings, weather, metar, nowMs, ref } = input;
  const computed = computeFlightNavlog({ doc, aircraft, settings, weather, ref });
  const { navlog, fuel } = computed;

  // ---- W&B: take-off with the fuel on board at block start, landing with FOB − (taxi + trip)
  //      (MD 4.3 and the club calculator: no taxi burn before take-off).
  let wb: WbResult | null = null;
  let wbLoadWarnings: string[] = [];
  let missingWeights: string[] = [];
  const fuelTakeoffL = fuel ? fuel.fobL : fin(doc.fobL) ? doc.fobL : 0;
  const rawLanding = fuel ? fuel.landingFuelL : fuelTakeoffL;
  const fuelLandingL = rawLanding;
  const fuelBurnL = fuel ? fuel.taxiL + fuel.tripL : 0;
  // Mixed tanks: the mass is Σ litres × density; the fuel burnt comes from the mix (its average density).
  const load = aircraft ? fuelLoad(aircraft.fuel, fuelTakeoffL, doc.options.fuelL) : null;
  if (aircraft) {
    const mb = aircraft.massBalance;
    const m = wbLoadsFromManifest(doc.crew, doc.baggageKg, mb.stations);
    const loads = m.loads;
    wbLoadWarnings = m.warnings;
    missingWeights = m.missingWeights;
    try {
      wb = weightAndBalance({
        massBalance: mb,
        loads,
        fuelTakeoffL,
        fuelLandingL,
        fuelDensityKgPerL: load!.densityKgPerL,
        unusableFuelL: aircraft.fuel.unusableL,
        unusableIncludedInEmptyMass: aircraft.fuel.unusableIncludedInEmptyMass,
        category: doc.options.category,
      });
    } catch {
      wb = null;
    }
  }

  // ---- sectors (intermediate full stops): W&B of each sector with its own take-off / landing fuel
  const sectors =
    aircraft && navlog.legs.length
      ? flightSectors({
          legs: navlog.legs,
          ...sectorTiming(requestTiming(doc.route, doc.options, settings?.circuitMin)),
          circuits: navlog.circuits,
          taxiAllowanceL: taxiAllowanceOf(aircraft.fuel, doc.options),
          fobL: fuelTakeoffL,
        })
      : [];
  let sectorWb: (WbResult | null)[] = sectors.map(() => null);
  if (aircraft && wb && sectors.length > 1) {
    try {
      sectorWb = sectorBalances(
        {
          massBalance: aircraft.massBalance,
          loads: wbLoadsFromManifest(doc.crew, doc.baggageKg, aircraft.massBalance.stations).loads,
          fuelDensityKgPerL: load!.densityKgPerL,
          unusableFuelL: aircraft.fuel.unusableL,
          unusableIncludedInEmptyMass: aircraft.fuel.unusableIncludedInEmptyMass,
          category: doc.options.category,
        },
        sectors,
      );
    } catch {
      sectorWb = sectors.map(() => null);
    }
  }

  const route = doc.route;
  const depPoint = route[0] ?? null;
  const arrPoint = route.length > 1 ? route[route.length - 1] : null;
  const times = navlog.times;
  const wxOpts = { date: doc.date, aerodromes: ref.aerodromes, weather, metar, nowMs };

  const endpoint = (
    phase: 'takeoff' | 'landing',
    point: RoutePoint | null,
    loc: OpenMeteoLocation | null,
    timeMin: number,
    massWb: WbResult | null,
    forcedRunway: string | null,
    surface: string | null,
  ): EndpointPerf => {
    const ew = point ? endpointWeather(point, loc, timeMin, wxOpts) : null;
    const ad = ew?.aerodrome ?? null;
    const conditions = ew?.conditions ?? null;
    const elev = ad?.elevFt ?? 0;
    const qnhAssumed = !(conditions && fin(conditions.qnhHpa));
    const qnhHpa = qnhAssumed ? 1013.25 : (conditions.qnhHpa as number);
    const oatAssumed = !(conditions && fin(conditions.tempC));
    const oatC = oatAssumed ? isaTempC(elev) : (conditions.tempC as number);
    const wind = toPerfWind(conditions);
    const date = doc.date || new Date(nowMs).toISOString().slice(0, 10);
    const variationDeg = ad ? magneticVariation(ad.lat, ad.lon, date) : 0;
    const {
      massKg,
      massSource,
      reason: massReason,
    } = performanceMass(massWb, phase, aircraft?.massBalance.mtowKg, missingWeights.length);
    let perf: AerodromePerf | null = null;
    if (ad && aircraft && massKg != null) {
      try {
        perf = aerodromePerformance({
          phase,
          aerodromeElevFt: elev,
          runways: ref.runwaysOf(ad.id),
          wind,
          qnhHpa,
          oatC,
          variationDeg,
          massKg,
          tables: aircraft.performance,
          runway: forcedRunway,
          surface,
        });
      } catch {
        perf = null;
      }
    }
    return {
      phase,
      point,
      aerodrome: ad,
      timeMin,
      weather: ew,
      conditions,
      qnhHpa,
      qnhAssumed,
      oatC,
      oatAssumed,
      wind,
      variationDeg,
      massKg,
      massSource,
      massReason,
      surface,
      forcedRunway,
      perf,
    };
  };

  const blockOffSet = navlog.blockOffSet;
  const o = doc.options;
  const departure = endpoint(
    'takeoff',
    depPoint,
    weather?.departure ?? null,
    blockOffSet ? times.takeoffMin : NaN,
    wb,
    o.departureRunway,
    o.departureSurface,
  );
  const arrival = endpoint(
    'landing',
    arrPoint,
    weather?.destination ?? null,
    blockOffSet ? times.landingMin : NaN,
    wb,
    o.arrivalRunway,
    o.arrivalSurface,
  );
  const reqs = new Map(activeRequests(route, o).map((r) => [`${r.request.kind}|${r.index}`, r.request]));
  // weather.stops is fetched for landingPointIndices() (useExportCalc), the same points the sectors end at.
  const wxStops = landingPointIndices(route, o);
  const stops: ExportStop[] = stopsOf(sectors).map((s) => {
    const point = route[s.pointIndex];
    const req = reqs.get(`${s.kind}|${s.pointIndex}`);
    const k = wxStops.indexOf(s.pointIndex);
    // A stop at the departure or the destination: that end's surface forecast.
    const loc =
      k >= 0
        ? (weather?.stops?.[k] ?? null)
        : s.pointIndex === 0
          ? (weather?.departure ?? null)
          : s.pointIndex === route.length - 1
            ? (weather?.destination ?? null)
            : null;
    const wbBefore = sectorWb[s.before.index] ?? null;
    const wbAfter = sectorWb[s.after.index] ?? null;
    return {
      point,
      pointIndex: s.pointIndex,
      kind: s.kind,
      before: s.before,
      after: s.after,
      wbBefore,
      wbAfter,
      landing: endpoint(
        'landing',
        point,
        loc,
        blockOffSet ? s.before.landingMin : NaN,
        wbBefore,
        req?.landingRunway ?? null,
        req?.surface ?? null,
      ),
      takeoff: endpoint(
        'takeoff',
        point,
        loc,
        blockOffSet ? s.after.takeoffMin : NaN,
        wbAfter,
        req?.takeoffRunway ?? null,
        req?.surface ?? null,
      ),
    };
  });
  return {
    computed,
    wb,
    wbLoadWarnings,
    missingWeights,
    fuelTakeoffL,
    fuelLoad: load,
    fuelLandingL,
    fuelBurnL,
    departure,
    arrival,
    sectors,
    stops,
  };
}
