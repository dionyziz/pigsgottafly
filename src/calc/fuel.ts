// Fuel planning.
//   required = taxi allowance + trip + final reserve (PilotSettings.finalReserveMin, default 0)
//   default FOB = required + reserve (PilotSettings.reserveMin, default 60 min at the planning burn)
import { NotImplementedError } from './errors.js';

export interface FuelPlanInput {
  /** Σ leg fuel, L (NavlogResult.totals.tripFuel). */
  tripFuelL: number;
  /** Aircraft FuelSpec.taxiAllowanceL. */
  taxiAllowanceL: number;
  burnLph: number;
  /** PilotSettings.finalReserveMin (inside "required"). */
  finalReserveMin: number;
  /** PilotSettings.reserveMin (on top of "required" for the default FOB). */
  reserveMin: number;
  /** FlightDoc.fobL; null = default. */
  fobL: number | null;
  /** FuelSpec.usableL */
  usableL: number;
  /** Trip time, minutes (for landing fuel and endurance). */
  tripMin: number;
}

export interface FuelPlan {
  taxiL: number;
  tripL: number;
  finalReserveL: number;
  requiredL: number;
  reserveL: number;
  defaultFobL: number;
  /** FOB used: input.fobL ?? defaultFobL. */
  fobL: number;
  /** FOB − taxi − trip. */
  landingFuelL: number;
  /** Endurance at block-off from FOB at the planning burn, minutes (FPL item 19 E/). */
  enduranceMin: number;
  /** FOB above usable capacity. */
  overCapacity: boolean;
  /** FOB below required. */
  belowRequired: boolean;
}

/** @throws NotImplementedError until the calc agent implements it. */
export function planFuel(input: FuelPlanInput): FuelPlan {
  void input;
  throw new NotImplementedError('planFuel');
}
