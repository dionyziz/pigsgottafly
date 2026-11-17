// Sectors of a flight with intermediate full stops (AerodromeRequest kind 'stop'): each sector is
// one take-off and one landing, so a stop adds a landing and a take-off at the stop aerodrome that
// need their own weight & balance point and their own take-off / landing performance.
//
// Fuel through the sectors, with the same conventions as the single-sector W&B (MD 4.3 and the
// club calculator, see wb.ts and fuel.ts):
//   - sector 1 takes off with the fuel on board at block start (no taxi burn before take-off);
//   - each sector lands with its take-off fuel − one start-up/taxi/take-off/landing allowance −
//     the sector's trip fuel (Σ of its legs' whole litres, as the navlog);
//   - the next sector takes off with the fuel it landed with (no refuelling at the stop; the
//     stop's start-up/taxi allowance is charged to the sector that follows, as at the departure).
//   - a touch-and-go at an intermediate aerodrome also ends a sector (a landing and a take-off with
//     their own performance), but the aircraft never stops: no allowance for the next sector.
//   - a touch-and-go followed by a full stop at the same aerodrome: the sector ends at the
//     touch-and-go, then a circuit sector (no legs; NavlogResult.circuits gives its times and fuel)
//     ends at the full-stop landing there.
//   - a stop at the departure: circuit sector(s) from the departure back to it first (a
//     touch-and-go then a full stop with 'Touch-and-go first'); a stop at the destination: the
//     route's last sector lands there (at a touch-and-go when one is requested too, then a circuit
//     sector to the full stop), and a final circuit sector after the ground time lands there again.
// So the last sector lands with FOB − allowance × (1 + stops) − trip = FuelPlan.landingFuelL, and a
// flight without stops is one sector equal to the plain take-off / landing figures.
// Pure: no I/O, no DOM.
import type { NavlogCircuit } from './navlog.js';
import type { WbInput, WbResult } from './wb.js';
import { weightAndBalance } from './wb.js';

export interface SectorLeg {
  /** Whole litres of the leg (NavlogLeg.fuel); missing = 0. */
  fuel?: number;
  /** Minutes after 00:00 UTC of the flight date (NavlogLeg.startMin / endMin). */
  startMin: number;
  endMin: number;
}

export interface FlightSector {
  index: number;
  /** Route point indices of the take-off and the landing aerodrome (the same for a circuit). */
  fromPoint: number;
  toPoint: number;
  /** Leg indices of the sector, inclusive (a circuit has none: lastLeg = firstLeg − 1). */
  firstLeg: number;
  lastLeg: number;
  /** Minutes after 00:00 UTC of the flight date. */
  takeoffMin: number;
  landingMin: number;
  /** Σ leg fuel of the sector, L. */
  tripFuelL: number;
  /** Start-up/taxi/take-off/landing allowance charged to the sector, L. */
  allowanceL: number;
  /** Fuel at take-off and at landing, L (landing may be negative: not enough fuel). */
  fuelTakeoffL: number;
  fuelLandingL: number;
  /** How the sector ends: at a full stop, a touch-and-go, or the destination. */
  ends: 'stop' | 'touch-and-go' | 'destination';
}

const fin = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

/** Leg indices after which the aircraft stops (ground time > 0, never after the last leg). */
export function stopLegs(groundAfterLegMin: readonly number[] | null | undefined, nLegs: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < nLegs - 1; i++) {
    const m = groundAfterLegMin?.[i];
    if (fin(m) && m > 0) out.push(i);
  }
  return out;
}

export interface FlightSectorsInput {
  legs: readonly SectorLeg[];
  /** RequestTiming.groundAfterLegMin. */
  groundAfterLegMin?: readonly number[] | null;
  /** RequestTiming.touchAfterLeg: intermediate touch-and-goes end sectors too. */
  touchAfterLeg?: readonly boolean[] | null;
  /** NavlogResult.circuits: a touch-and-go, then a circuit to the full stop at the same aerodrome. */
  circuits?: readonly NavlogCircuit[] | null;
  /** Aircraft FuelSpec.taxiAllowanceL (per take-off). */
  taxiAllowanceL: number;
  /** Fuel on board at block start, L. */
  fobL: number;
}

/** The flight's sectors in order; [] without legs. */
export function flightSectors(input: FlightSectorsInput): FlightSector[] {
  const n = input.legs.length;
  if (!n) return [];
  const allowance = fin(input.taxiAllowanceL) ? Math.max(0, input.taxiAllowanceL) : 0;
  const circuits = input.circuits ?? [];
  const after = (i: number) => circuits.filter((c) => c.afterLeg === i);
  const ground = (i: number) => {
    const m = input.groundAfterLegMin?.[i];
    return fin(m) && m > 0;
  };
  // How the aircraft comes down at the end of leg i (null: it flies on).
  const legEnd = (i: number): FlightSector['ends'] | null => {
    if (after(i).length) return input.touchAfterLeg?.[i] ? 'touch-and-go' : 'stop';
    if (i === n - 1) return 'destination';
    if (ground(i)) return 'stop';
    return input.touchAfterLeg?.[i] ? 'touch-and-go' : null;
  };
  const out: FlightSector[] = [];
  let fuel = fin(input.fobL) ? input.fobL : 0;
  let charge = allowance;
  const push = (s: Omit<FlightSector, 'index' | 'allowanceL' | 'fuelTakeoffL' | 'fuelLandingL'>) => {
    const landing = fuel - charge - s.tripFuelL;
    out.push({ ...s, index: out.length, allowanceL: charge, fuelTakeoffL: fuel, fuelLandingL: landing });
    // No refuelling: the next sector starts with what is left (never below empty tanks); after a
    // touch-and-go there is no new start-up and taxi.
    fuel = Math.max(0, landing);
    charge = s.ends === 'touch-and-go' ? 0 : allowance;
  };
  const circuitSector = (c: NavlogCircuit) => {
    const point = c.afterLeg + 1;
    push({
      fromPoint: point,
      toPoint: point,
      firstLeg: point,
      lastLeg: c.afterLeg,
      takeoffMin: c.startMin,
      landingMin: c.endMin,
      tripFuelL: fin(c.fuel) ? c.fuel : 0,
      ends: c.ends,
    });
  };
  for (const c of after(-1)) circuitSector(c);
  let first = 0;
  let trip = 0;
  for (let i = 0; i < n; i++) {
    const f = input.legs[i].fuel;
    trip += fin(f) ? f : 0;
    const ends = legEnd(i);
    if (!ends) continue;
    push({
      fromPoint: first,
      toPoint: i + 1,
      firstLeg: first,
      lastLeg: i,
      takeoffMin: input.legs[first].startMin,
      landingMin: input.legs[i].endMin,
      tripFuelL: trip,
      ends,
    });
    for (const c of after(i)) circuitSector(c);
    first = i + 1;
    trip = 0;
  }
  return out;
}

/** W&B of each sector: the same loading, with the sector's take-off and landing fuel. */
export function sectorBalances(
  base: Omit<WbInput, 'fuelTakeoffL' | 'fuelLandingL'>,
  sectors: readonly FlightSector[],
): WbResult[] {
  return sectors.map((s) => weightAndBalance({ ...base, fuelTakeoffL: s.fuelTakeoffL, fuelLandingL: s.fuelLandingL }));
}

/** One intermediate stop or touch-and-go: the landing that ends sector `before` and the take-off that starts the next. */
export interface StopSectors {
  /** Route point index of the stop aerodrome. */
  pointIndex: number;
  kind: 'stop' | 'touch-and-go';
  before: FlightSector;
  after: FlightSector;
}

export function stopsOf(sectors: readonly FlightSector[]): StopSectors[] {
  const out: StopSectors[] = [];
  for (let i = 0; i + 1 < sectors.length; i++)
    out.push({
      pointIndex: sectors[i].toPoint,
      kind: sectors[i].ends === 'touch-and-go' ? 'touch-and-go' : 'stop',
      before: sectors[i],
      after: sectors[i + 1],
    });
  return out;
}
