// Fuel planning.
//   taxi = the aircraft's start-up/taxi/take-off/landing allowance × (1 + intermediate full stops):
//     a stop (shut-down, start-up, taxi, another take-off) costs the same allowance again; a
//     touch-and-go costs nothing extra (its pattern time is already in the trip legs at pattern TAS).
//   required = taxi allowance + trip + final reserve (PilotSettings.finalReserveMin, default 0)
//   default FOB = required + reserve (PilotSettings.reserveMin at the planning burn; null = not set)
//   legal floor: whatever the profile says, the fuel left at landing must last at least the EASA
//   Part-NCO final reserve for day VFR (NCO.OP.125(a)(1)(i)): 30 min, or 10 min for a local flight
//   (take-off and landing at the same aerodrome, remaining within sight of it), at the planning
//   burn. Below it the plan is flagged as danger; a local flight between 10 and 30 min is a warning
//   (the 10 min only holds while the aerodrome stays in sight).
// Reserve litres are rounded UP to whole litres (as each leg's fuel on the paper sheet); trip and
// taxi litres are used as given (NavlogResult.totals.tripFuel is already a sum of whole litres).

import { distanceNm, fmtDuration } from './nav.js';

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
  /** Take-off and landing at the same aerodrome (isLocalFlight): the legal floor is 10 min, not 30. */
  localFlight?: boolean;
  /**
   * Intermediate full stops (AerodromeRequest kind 'stop'): each adds one more taxi allowance.
   * Fuel at landing (landingFuelL) is at the FINAL landing.
   */
  stops?: number;
}

/** EASA NCO.OP.125 day VFR final reserve, minutes: 30, or 10 for a local flight. */
export const LEGAL_FINAL_RESERVE_MIN = 30;
export const LEGAL_LOCAL_FINAL_RESERVE_MIN = 10;

export interface FuelIssue {
  level: 'danger' | 'warn';
  text: string;
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
  /**
   * The minimum endurance at landing checked against: max(legal floor, PilotSettings.finalReserveMin),
   * minutes (legal floor 30 min, or 10 min for a local flight).
   */
  minLandingReserveMin: number;
  /** Fuel at landing lasts less than minLandingReserveMin (or is negative). */
  landingReserveShort: boolean;
  /** Human-readable warnings (= issues' texts). */
  warnings: string[];
  /** The same warnings with a level: danger (no-go as planned) or warn. */
  issues: FuelIssue[];
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
  const stops = fin(input.stops) ? Math.max(0, Math.floor(input.stops)) : 0;
  const taxiL = (fin(input.taxiAllowanceL) ? Math.max(0, input.taxiAllowanceL) : 0) * (1 + stops);
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
  const enduranceMin = minutesFor(fobL, input.burnLph);
  const landingEnduranceMin = minutesFor(landingFuelL, input.burnLph);
  const finalReserveMin = fin(input.finalReserveMin) ? Math.max(0, input.finalReserveMin) : 0;
  const legalMin = input.localFlight ? LEGAL_LOCAL_FINAL_RESERVE_MIN : LEGAL_FINAL_RESERVE_MIN;
  const minLandingReserveMin = Math.max(legalMin, finalReserveMin);
  // Compare litres, not rounded-down minutes: the reserve's litres at the planning burn.
  const landingLitresNeeded = (m: number) => (input.burnLph > 0 ? (m * input.burnLph) / 60 : NaN);
  const short = (m: number) => landingFuelL < 0 || (input.burnLph > 0 && landingFuelL < landingLitresNeeded(m) - 1e-9);
  const landingReserveShort = short(minLandingReserveMin);

  const issues: FuelIssue[] = [];
  const add = (level: FuelIssue['level'], text: string) => issues.push({ level, text });
  if (!(input.burnLph > 0)) add('warn', 'Aircraft burn rate not set.');
  if (reserveUnset) add('warn', 'Fuel reserve not set in the profile: no reserve added to the default fuel on board.');
  if (overCapacity) add('danger', `Fuel on board ${fobL} L exceeds usable capacity ${usable} L.`);
  else if (fobIsDefault && defaultOverCapacity)
    add('warn', `Required + reserve ${defaultFobL} L exceeds usable capacity ${usable} L.`);
  if (belowRequired) add('danger', `Fuel on board ${fobL} L is below required ${requiredL} L.`);
  if (input.burnLph > 0 && landingFuelL >= 0) {
    const left = `Fuel at landing ${landingFuelL} L lasts ${fmtDuration(landingEnduranceMin)}`;
    if (short(legalMin)) {
      add(
        'danger',
        input.localFlight
          ? `${left}: below the ${legalMin} min legal final reserve for a local VFR flight (NCO.OP.125).`
          : `${left}: below the ${legalMin} min legal final reserve for day VFR (NCO.OP.125).`,
      );
    } else if (finalReserveMin > legalMin && short(finalReserveMin) && !belowRequired) {
      add('danger', `${left}: below your final reserve of ${finalReserveMin} min.`);
    } else if (input.localFlight && short(LEGAL_FINAL_RESERVE_MIN)) {
      add(
        'warn',
        `${left}: the 10 min final reserve holds only for a local flight that stays within sight of the aerodrome (30 min otherwise).`,
      );
    }
  }
  if (!isFinite(usable)) add('warn', 'Aircraft usable fuel capacity not set.');
  warnings.push(...issues.map((i) => i.text));

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
    enduranceMin,
    landingEnduranceMin,
    overCapacity,
    defaultOverCapacity,
    belowRequired,
    reserveUnset,
    minLandingReserveMin,
    landingReserveShort,
    warnings,
    issues,
  };
}

/** Route starts and ends at the same place (within 1 NM): a local flight for the fuel reserve. */
export function isLocalFlight(route: { lat: number; lon: number }[]): boolean {
  if (route.length < 2) return false;
  return distanceNm(route[0], route[route.length - 1]) <= 1;
}
