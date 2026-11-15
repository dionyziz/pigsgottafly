// Weight and balance (MD 4.3): loading table, take-off and landing mass/CG, envelope checks.
import type { MassBalance, WbCategory } from '../shared/types.js';
import { NotImplementedError } from './errors.js';

export interface WbLoad {
  /** Station id (MassBalance.stations[].id). */
  stationId: string;
  /** e.g. 'PIC J. Doe', 'Baggage area 1'. */
  label: string;
  massKg: number;
  /** Arm override (adjustable seats), m; default = station arm. */
  armM?: number;
}

export interface WbInput {
  massBalance: MassBalance;
  /** Crew and baggage (fuel is given separately). */
  loads: WbLoad[];
  fuelTakeoffL: number;
  fuelLandingL: number;
  fuelDensityKgPerL: number;
  /** Add the unusable fuel mass when the weighing report excludes it. */
  unusableFuelL: number;
  unusableIncludedInEmptyMass: boolean;
  category: WbCategory;
}

export interface WbRow {
  label: string;
  stationId: string | null;
  massKg: number;
  armM: number;
  momentKgM: number;
}

export interface WbPoint {
  massKg: number;
  momentKgM: number;
  armM: number;
}

export interface WbCheck {
  /** Inside the envelope polygon (mass and CG). */
  inEnvelope: boolean;
  /** Mass ≤ envelope max. */
  massOk: boolean;
}

export interface WbResult {
  /** Empty aircraft, (unusable fuel), each load, fuel at take-off: the MD 4.3 table. */
  rows: WbRow[];
  zeroFuel: WbPoint;
  takeoff: WbPoint;
  landing: WbPoint;
  normal: { takeoff: WbCheck; landing: WbCheck };
  utility: { takeoff: WbCheck; landing: WbCheck } | null;
  /** Station or combined limits exceeded, utility restrictions (no rear pax/baggage)… */
  warnings: string[];
}

/** @throws NotImplementedError until the calc agent implements it. */
export function weightAndBalance(input: WbInput): WbResult {
  void input;
  throw new NotImplementedError('weightAndBalance');
}
