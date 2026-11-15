// The numbers behind the W&B (MD 4.3) and performance (MD 4.4) exports, computed the way the
// flight editor computes them (src/features/editor/panels/calc.tsx), but without the editor
// context: navlog + fuel (via the navlog export's computeFlightNavlog), W&B from the manifest and
// the fuel plan, and the take-off / landing performance at the departure and destination.
// Pure: no I/O, no DOM (the hook in useExportCalc.ts fetches the inputs).
import type { Aircraft, FlightDoc, PilotSettings, RoutePoint } from '../../../shared';
import type { RefAerodrome, RefRunway, RefSunTable, RefVfrPoint, RefVfrRoute } from '../../../shared/ref';
import {
  aerodromePerformance, isaTempC, magneticVariation, performanceMass, wbLoadsFromManifest, weightAndBalance,
  type AerodromePerf, type WbResult,
} from '../../../calc';
import type { RouteWeather, SurfaceConditions } from '../../../data/weather';
import { toPerfWind } from '../../../data/weather';
import type { MetarTafResult } from '../../../data/weatherMetar';
import { computeFlightNavlog, endpointWeather, type EndpointWeather, type NavlogComputed } from '../navlog/model';

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
  perf: AerodromePerf | null;
}

export interface ExportCalc {
  computed: NavlogComputed;
  wb: WbResult | null;
  /** Manifest problems found while building the loads (missing weights…). */
  wbLoadWarnings: string[];
  /** People on the manifest with no weight (0 kg in the W&B): the balance is incomplete. */
  missingWeights: string[];
  /** Fuel at take-off / landing used for the W&B, L. */
  fuelTakeoffL: number;
  fuelLandingL: number;
  /** Fuel burnt between take-off and landing in the W&B (taxi allowance + trip), L. */
  fuelBurnL: number;
  departure: EndpointPerf;
  arrival: EndpointPerf;
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

export function computeExportCalc(input: ExportCalcInput): ExportCalc {
  const { doc, aircraft, settings, weather, metar, nowMs, ref } = input;
  const computed = computeFlightNavlog({ doc, aircraft, settings, weather, ref });
  const { navlog, fuel } = computed;

  // ---- W&B: take-off with the fuel on board at block-off, landing with FOB − (taxi + trip)
  //      (MD 4.3 and the club calculator: no taxi burn before take-off).
  let wb: WbResult | null = null;
  let wbLoadWarnings: string[] = [];
  let missingWeights: string[] = [];
  const fuelTakeoffL = fuel ? fuel.fobL : fin(doc.fobL) ? doc.fobL : 0;
  const rawLanding = fuel ? fuel.landingFuelL : fuelTakeoffL;
  const fuelLandingL = rawLanding;
  const fuelBurnL = fuel ? fuel.taxiL + fuel.tripL : 0;
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
        fuelDensityKgPerL: aircraft.fuel.densityKgPerL,
        unusableFuelL: aircraft.fuel.unusableL,
        unusableIncludedInEmptyMass: aircraft.fuel.unusableIncludedInEmptyMass,
        category: doc.options.category,
      });
    } catch {
      wb = null;
    }
  }

  // ---- performance at both ends
  const route = doc.route;
  const depPoint = route[0] ?? null;
  const arrPoint = route.length > 1 ? route[route.length - 1] : null;
  const times = navlog.times;
  const wxOpts = { date: doc.date, aerodromes: ref.aerodromes, weather, metar, nowMs };

  const endpoint = (phase: 'takeoff' | 'landing', point: RoutePoint | null, timeMin: number): EndpointPerf => {
    const loc = phase === 'takeoff' ? weather?.departure ?? null : weather?.destination ?? null;
    const ew = point ? endpointWeather(point, loc, timeMin, wxOpts) : null;
    const ad = ew?.aerodrome ?? null;
    const conditions = ew?.conditions ?? null;
    const elev = ad?.elevFt ?? 0;
    const qnhAssumed = !(conditions && fin(conditions.qnhHpa));
    const qnhHpa = qnhAssumed ? 1013.25 : (conditions!.qnhHpa as number);
    const oatAssumed = !(conditions && fin(conditions.tempC));
    const oatC = oatAssumed ? isaTempC(elev) : (conditions!.tempC as number);
    const wind = toPerfWind(conditions);
    const date = doc.date || new Date(nowMs).toISOString().slice(0, 10);
    const variationDeg = ad ? magneticVariation(ad.lat, ad.lon, date) : 0;
    const { massKg, massSource, reason: massReason } = performanceMass(wb, phase, aircraft?.massBalance.mtowKg, missingWeights.length);
    const surface = phase === 'takeoff' ? doc.options.departureSurface : doc.options.arrivalSurface;
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
          runway: phase === 'takeoff' ? doc.options.departureRunway : doc.options.arrivalRunway,
          surface,
        });
      } catch {
        perf = null;
      }
    }
    return {
      phase, point, aerodrome: ad, timeMin, weather: ew, conditions,
      qnhHpa, qnhAssumed, oatC, oatAssumed, wind, variationDeg, massKg, massSource, massReason, surface, perf,
    };
  };

  const blockOffSet = navlog.blockOffSet;
  const departure = endpoint('takeoff', depPoint, blockOffSet ? times.takeoffMin : NaN);
  const arrival = endpoint('landing', arrPoint, blockOffSet ? times.landingMin : NaN);
  return { computed, wb, wbLoadWarnings, missingWeights, fuelTakeoffL, fuelLandingL, fuelBurnL, departure, arrival };
}
