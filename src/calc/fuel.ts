// Fuel planning.
//   required = taxi allowance + trip + final reserve (PilotSettings.finalReserveMin, default 0)
//   default FOB = required + reserve (PilotSettings.reserveMin at the planning burn; null = not set)
// Reserve litres are rounded UP to whole litres (as each leg's fuel on the paper sheet); trip and
// taxi litres are used as given (NavlogResult.totals.tripFuel is already a sum of whole litres).

export interface FuelPlanInput {
  /** Σ leg fuel, L (NavlogResult.totals.tripFuel). */
  tripFuelL: number;
  /** Aircraft FuelSpec.taxiAllowanceL. */
  taxiAllowanceL: number;
  burnLph: number;
  /** PilotSettings.finalReserveMin (inside "required"). */
  finalReserveMin: number;
  /** PilotSettings.reserveMin (on top of "required" for the default FOB); null = not set (0 used, flagged). */
  reserveMin: number | null;
  /** FlightDoc.fobL; null = default. */
  fobL: number | null;
  /** FuelSpec.usableL */
  usableL: number;
  /** Trip time, minutes (informational; endurance figures come from the litres). */
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
  /** True when FOB is the default (input.fobL null). */
  fobIsDefault: boolean;
  /** FOB − taxi − trip. */
  landingFuelL: number;
  /** Endurance at block-off from FOB at the planning burn, whole minutes rounded down (FPL item 19 E/). */
  enduranceMin: number;
  /** Endurance of the fuel left on landing at the planning burn, whole minutes rounded down. */
  landingEnduranceMin: number;
  /** FOB above usable capacity. */
  overCapacity: boolean;
  /** Default FOB (required + reserve) above usable capacity. */
  defaultOverCapacity: boolean;
  /** FOB below required. */
  belowRequired: boolean;
  /** PilotSettings.reserveMin was not set (reserve 0 used). */
  reserveUnset: boolean;
  /** Human-readable warnings. */
  warnings: string[];
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
/** Litres for minutes at a burn, rounded up to whole litres. */
export const litresFor = (minutes: number, burnLph: number): number =>
  fin(minutes) && fin(burnLph) && minutes > 0 && burnLph > 0 ? Math.ceil((minutes * burnLph) / 60 - 1e-9) : 0;
/** Whole minutes (rounded down) that `litres` last at a burn; NaN without a burn. */
export const minutesFor = (litres: number, burnLph: number): number =>
  fin(litres) && burnLph > 0 ? Math.floor((litres / burnLph) * 60 + 1e-9) : NaN;

export function planFuel(input: FuelPlanInput): FuelPlan {
  const warnings: string[] = [];
  const taxiL = fin(input.taxiAllowanceL) ? Math.max(0, input.taxiAllowanceL) : 0;
  const tripL = fin(input.tripFuelL) ? Math.max(0, input.tripFuelL) : 0;
  const finalReserveL = litresFor(fin(input.finalReserveMin) ? input.finalReserveMin : 0, input.burnLph);
  const requiredL = taxiL + tripL + finalReserveL;
  const reserveUnset = !fin(input.reserveMin);
  const reserveL = litresFor(reserveUnset ? 0 : (input.reserveMin as number), input.burnLph);
  const defaultFobL = requiredL + reserveL;
  const fobIsDefault = !fin(input.fobL);
  const fobL = fobIsDefault ? defaultFobL : (input.fobL as number);
  const landingFuelL = fobL - taxiL - tripL;
  const usable = fin(input.usableL) && input.usableL > 0 ? input.usableL : NaN;
  const overCapacity = isFinite(usable) && fobL > usable + 1e-9;
  const defaultOverCapacity = isFinite(usable) && defaultFobL > usable + 1e-9;
  const belowRequired = fobL < requiredL - 1e-9;

  if (!(input.burnLph > 0)) warnings.push('Aircraft burn rate not set.');
  if (reserveUnset) warnings.push('Fuel reserve not set in the profile: no reserve added to the default fuel on board.');
  if (overCapacity) warnings.push(`Fuel on board ${fobL} L exceeds usable capacity ${usable} L.`);
  else if (fobIsDefault && defaultOverCapacity) warnings.push(`Required + reserve ${defaultFobL} L exceeds usable capacity ${usable} L.`);
  if (belowRequired) warnings.push(`Fuel on board ${fobL} L is below required ${requiredL} L.`);
  if (!isFinite(usable)) warnings.push('Aircraft usable fuel capacity not set.');

  return {
    taxiL,
    tripL,
    finalReserveL,
    requiredL,
    reserveL,
    defaultFobL,
    fobL,
    fobIsDefault,
    landingFuelL,
    enduranceMin: minutesFor(fobL, input.burnLph),
    landingEnduranceMin: minutesFor(landingFuelL, input.burnLph),
    overCapacity,
    defaultOverCapacity,
    belowRequired,
    reserveUnset,
    warnings,
  };
}
