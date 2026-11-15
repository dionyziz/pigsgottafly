// The navlog: times, winds, WCA/TH/MH/DEV/CH/GS/ETE/fuel per leg.
//
// Rules (PLAN-v3 "Calculations"):
//   - block-off + taxi out = take-off; legs flown in sequence; landing + taxi in = block-on.
//   - first and last legs at pattern TAS, the others at cruise TAS (LegOverride.tasKt wins).
//   - wind/temperature per leg sampled at the leg midpoint, leg altitude and mid-leg time; since
//     GS depends on the wind and the mid-leg time on GS, iterate (the v2 app did 4 passes).
//   - variation per leg from WMM at the midpoint (LegGeometry.variation); deviation from the card.
//   - rounding as on the paper sheet: nav.computeLeg(); totals with nav.summarize().
//   - trip fuel = Σ leg fuel (each rounded up); fuel total on the sheet = trip + taxi allowance.
import type { ClockUtc, IsoDate, LegOverride } from '../shared/types.js';
import type { LegGeometry } from './legs.js';
import type { ComputedLeg, NavTotals } from './nav.js';
import { NotImplementedError } from './errors.js';

/** Wind/temperature at a point; dir = FROM, true. */
export interface WindSample {
  dirDeg: number;
  speedKt: number;
  tempC: number;
}

/**
 * Synchronous wind lookup over data fetched beforehand (src/data/weather.ts builds one from the
 * Open-Meteo responses). legIndex lets the provider use per-leg midpoint data.
 * Returns null when there is no data (the leg is then computed with calm wind and flagged).
 */
export type WindProvider = (q: { legIndex: number; lat: number; lon: number; altFt: number; timeMs: number }) => WindSample | null;

export interface NavlogAircraft {
  cruiseTasKt: number;
  patternTasKt: number;
  /** Planning burn, L/h. */
  burnLph: number;
  /** Fixed start-up/taxi/take-off/landing allowance, L. */
  taxiAllowanceL: number;
  /** Compass card points, or null (no DEV/CH columns). */
  card: [number, number][] | null;
}

export interface NavlogInput {
  date: IsoDate;
  /** Block-off 'HH:MM' UTC; '' → 12:00 assumed and NavlogResult.blockOffSet = false. */
  blockOff: ClockUtc;
  taxiOutMin: number;
  taxiInMin: number;
  legs: LegGeometry[];
  /** Effective altitude of each leg, ft (default or override); NaN = unknown. */
  altitudesFt: number[];
  /** Per-leg overrides, indexed like legs (altFt is ignored here: use altitudesFt). */
  overrides: (LegOverride | undefined)[];
  aircraft: NavlogAircraft;
  winds: WindProvider | null;
}

export interface NavlogLeg extends ComputedLeg {
  index: number;
  altFt: number;
  tasKt: number;
  /** Wind used (FROM, true) and speed, as written (rounded). NaN if none. */
  windDirDeg: number;
  windKt: number;
  tempC: number;
  /** True when no forecast was available and no override given (calm wind assumed). */
  windMissing: boolean;
  /** Magnetic course, rounded, as on the map label. */
  mc: number;
  /** Minutes after 00:00 UTC of the flight date: start and end of the leg (unrounded). */
  startMin: number;
  endMin: number;
}

export interface NavlogResult {
  legs: NavlogLeg[];
  /** dist, ete, tripFuel, fuel = tripFuel + taxi allowance. */
  totals: NavTotals;
  /** Minutes after 00:00 UTC of the flight date (may exceed 1440 past midnight). */
  times: { blockOffMin: number; takeoffMin: number; landingMin: number; blockOnMin: number };
  blockOffSet: boolean;
  /** Human-readable warnings: missing winds, crosswind > TAS, unknown altitude… */
  warnings: string[];
}

/**
 * Computes the whole navlog. Pure and synchronous.
 * @throws NotImplementedError until the calc agent implements it.
 */
export function computeNavlog(input: NavlogInput): NavlogResult {
  void input;
  throw new NotImplementedError('computeNavlog');
}
