// Take-off and landing performance (MD 4.4): runway from the wind, wind components, PA/DA, AFM table
// interpolation with corrections and club factors, compared with the declared distances.
//
// Club rules (PerformanceFactors): AFM distance (interpolated in mass, pressure altitude and
// headwind) × temperature correction (+10% per 15 °C above standard) → surface factor (grass,
// RWYCC) → slope factor (×1.1 per 2% upslope for take-off / downslope for landing) → safety
// factor (1.33 take-off, 1.43 landing). Compare TODR with TODA, TORR with TORA, LDR with LDA.
// Crosswind limits 20 kt take-off / 15 kt landing.
import type { PerformanceTables } from '../shared/types.js';
import type { RefRunway } from '../shared/ref.js';
import { norm180, rad } from './nav.js';
import { NotImplementedError } from './errors.js';

export interface WindComponents {
  /** Positive = headwind, negative = tailwind, kt. */
  headwindKt: number;
  /** Magnitude, kt. */
  crosswindKt: number;
  /** Side the crosswind comes from ('' when calm). */
  crossFrom: 'L' | 'R' | '';
}

/**
 * Head/crosswind on a runway. Use the same reference for both angles (both magnetic, or both true).
 * @param runwayHdgDeg runway heading
 * @param windDirDeg direction the wind blows FROM
 */
export function windComponents(runwayHdgDeg: number, windDirDeg: number, windKt: number): WindComponents {
  if (!(windKt > 0)) return { headwindKt: 0, crosswindKt: 0, crossFrom: '' };
  const a = rad(norm180(windDirDeg - runwayHdgDeg));
  const cross = windKt * Math.sin(a);
  return { headwindKt: windKt * Math.cos(a), crosswindKt: Math.abs(cross), crossFrom: cross > 1e-9 ? 'R' : cross < -1e-9 ? 'L' : '' };
}

/** Pressure altitude, ft: elevation + (1013.25 − QNH) × 30 ft/hPa (the rule of thumb on MD 4.4). */
export function pressureAltitudeFt(elevFt: number, qnhHpa: number): number {
  return elevFt + (1013.25 - qnhHpa) * 30;
}

/** ISA temperature at a pressure altitude, °C (15 − 1.98/1000 ft). */
export function isaTempC(pressureAltFt: number): number {
  return 15 - (1.98 * pressureAltFt) / 1000;
}

/** Density altitude, ft: PA + 120 ft per °C above ISA. */
export function densityAltitudeFt(pressureAltFt: number, oatC: number): number {
  return pressureAltFt + 120 * (oatC - isaTempC(pressureAltFt));
}

export interface RunwayChoice {
  runway: RefRunway;
  wind: WindComponents;
}

/**
 * The runway direction with the most headwind (ties: the longer TORA/LDA), considering only the
 * aerodrome's runways. Wind direction is TRUE (forecast); runway headings are magnetic: pass the
 * variation (E positive) to convert. Calm: the first runway, or `preferred` if given.
 * @throws NotImplementedError until the calc agent implements it.
 */
export function selectRunway(
  runways: RefRunway[],
  wind: { dirTrueDeg: number; speedKt: number } | null,
  variationDeg: number,
  preferred?: string | null,
): RunwayChoice | null {
  void runways; void wind; void variationDeg; void preferred;
  throw new NotImplementedError('selectRunway');
}

export interface PerfConditions {
  massKg: number;
  pressureAltFt: number;
  oatC: number;
  /** Positive head, negative tail, kt. */
  headwindKt: number;
  /** Key of PerformanceFactors.runwayCondition, or null for paved dry. */
  surface: string | null;
  /** Slope in the direction of travel, %: positive uphill. */
  slopePct: number;
}

export interface PerfDistances {
  /** AFM figures after interpolation and temperature correction, m. */
  groundM: number;
  totalM: number;
  /** Each factor applied, for the MD 4.4 printout. */
  factors: { temperature: number; surface: number; slope: number; safety: number };
  /** After all factors: TORR/TODR (take-off) or LDR (landing; groundM = landing roll), m. */
  requiredGroundM: number;
  requiredTotalM: number;
  /** Conditions outside the AFM table (extrapolated). */
  extrapolated: boolean;
}

/** @throws NotImplementedError until the calc agent implements it. */
export function takeoffDistances(tables: PerformanceTables, c: PerfConditions): PerfDistances {
  void tables; void c;
  throw new NotImplementedError('takeoffDistances');
}

/** @throws NotImplementedError until the calc agent implements it. */
export function landingDistances(tables: PerformanceTables, c: PerfConditions): PerfDistances {
  void tables; void c;
  throw new NotImplementedError('landingDistances');
}

export interface AerodromePerfInput {
  phase: 'takeoff' | 'landing';
  aerodromeElevFt: number;
  runways: RefRunway[];
  /** Surface wind (true) and conditions at the time of take-off/landing. */
  wind: { dirTrueDeg: number; speedKt: number } | null;
  qnhHpa: number;
  oatC: number;
  variationDeg: number;
  massKg: number;
  tables: PerformanceTables;
  /** Runway forced by the pilot (FlightOptions.departureRunway/arrivalRunway). */
  runway: string | null;
  surface: string | null;
}

export interface AerodromePerf {
  runway: RefRunway | null;
  wind: WindComponents;
  pressureAltFt: number;
  densityAltFt: number;
  isaDevC: number;
  distances: PerfDistances | null;
  /** Available: TORA/TODA (take-off) or LDA (landing), m; null if unpublished. */
  availableGroundM: number | null;
  availableTotalM: number | null;
  /** available − required (m), null if unknown; negative = does not fit. */
  marginM: number | null;
  crosswindOk: boolean;
  tailwind: boolean;
  warnings: string[];
}

/** Everything for one MD 4.4 block. @throws NotImplementedError until implemented. */
export function aerodromePerformance(input: AerodromePerfInput): AerodromePerf {
  void input;
  throw new NotImplementedError('aerodromePerformance');
}
