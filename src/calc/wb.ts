// Weight and balance (MD 4.3): loading table, take-off and landing mass/CG, envelope checks.
//
// Conventions (cross-checked against the Aeroclub Mesogeion calculator, tests/unit/calc/club.test.ts):
//   - Empty aircraft: the weighing report's moment is used as printed (emptyMomentKgM), not
//     mass × rounded arm (SX-ASV: 691.2 kg, 719.12 kg·m, while 691.2 × 1.0403 = 719.06).
//   - Seats: each person sits in a seat (SeatPosition.id); the seat's station gives the arm.
//   - Fuel: litres × the aircraft's fuel density, at the fuel station arm. The fuel given for
//     take-off is the caller's choice; the club (and MD 4.3) use the fuel on board at block-off,
//     i.e. the start-up/taxi fuel is not subtracted before take-off (conservative mass).
//   - Unusable fuel: added as its own row when the weighing report excludes it (SX-ASG was weighed
//     with empty tanks). The club calculator does NOT add it for SX-ASG (see the club test).
//   - Envelopes: a point is inside when it is inside (or on the edge of) the CG polygon AND, when
//     the envelope has one, the moment polygon (the club's "torque" limits).
import type { MassBalance, Station, WbCategory, Envelope } from '../shared/types.js';

export interface WbLoad {
  /** Station id (MassBalance.stations[].id). Ignored when seatId resolves to a station. */
  stationId: string;
  /** Seat (SeatPosition.id) for people: the arm comes from the seat's station. */
  seatId?: string | null;
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
  /** Inside the envelope polygon (mass and CG), and inside the moment polygon if there is one. */
  inEnvelope: boolean;
  /** Mass ≤ envelope max. */
  massOk: boolean;
  /** CG polygon alone. */
  inCgPolygon?: boolean;
  /** Moment polygon alone; null when the envelope has none. */
  inMomentPolygon?: boolean | null;
}

export interface WbResult {
  /** Empty aircraft, (unusable fuel), each load, fuel at take-off: the MD 4.3 table. */
  rows: WbRow[];
  /**
   * The MD 4.3 / club table: empty aircraft, (unusable fuel), one row per station in station order
   * (zero rows included, people and baggage summed per station), usable fuel at take-off.
   */
  stationRows?: WbRow[];
  zeroFuel: WbPoint;
  takeoff: WbPoint;
  landing: WbPoint;
  normal: { takeoff: WbCheck; landing: WbCheck };
  utility: { takeoff: WbCheck; landing: WbCheck } | null;
  /** Station or combined limits exceeded, utility restrictions (no rear pax/baggage)… */
  warnings: string[];
  /**
   * The published limits this loading breaks (each one's text is also in warnings): station and
   * combined station maxima, seat counts, MTOW, MLW, the chosen category's mass and envelope, and
   * the utility-category restrictions. Empty when the loading is within every limit; any entry
   * makes the W&B a fail.
   */
  limitBreaches: WbLimitBreach[];
}

export type WbLimitKind = 'station' | 'combined' | 'seats' | 'mtow' | 'mlw' | 'category' | 'envelope' | 'utility';

export interface WbLimitBreach {
  kind: WbLimitKind;
  /** The flight phase the breach belongs to; absent for loading limits that hold in every phase. */
  phase?: 'takeoff' | 'landing';
  text: string;
}

/** W&B status for one category: per phase (envelope, mass, MTOW/MLW) and for the loading itself
 *  (station, combined, seat and category restrictions). All three true = within every limit. */
export interface WbStatus {
  takeoff: boolean;
  landing: boolean;
  loading: boolean;
}

/** Summarises a W&B result as pass/fail per phase and for the loading, counting every breach in
 *  limitBreaches, not only the envelope check. */
export function wbStatus(wb: WbResult): WbStatus {
  const b = wb.limitBreaches;
  return {
    takeoff: !b.some((x) => x.phase === 'takeoff'),
    landing: !b.some((x) => x.phase === 'landing'),
    loading: !b.some((x) => !x.phase),
  };
}

const EPS = 1e-9;

function point(massKg: number, momentKgM: number): WbPoint {
  return { massKg, momentKgM, armM: massKg > 0 ? momentKgM / massKg : 0 };
}

/** Point in polygon of [x, y] vertices; points on an edge or vertex count as inside. */
export function insidePolygon(x: number, y: number, poly: [number, number][]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    // on the segment?
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    const len = Math.hypot(xj - xi, yj - yi) || 1;
    if (Math.abs(cross) / len < 1e-7 && x >= Math.min(xi, xj) - 1e-9 && x <= Math.max(xi, xj) + 1e-9 && y >= Math.min(yi, yj) - 1e-9 && y <= Math.max(yi, yj) + 1e-9) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Checks a point against one envelope. */
export function checkEnvelope(env: Envelope, p: WbPoint): WbCheck {
  const inCg = p.massKg > 0 && insidePolygon(p.armM, p.massKg, env.polygon);
  const inMoment = env.momentPolygon && env.momentPolygon.length >= 3 ? insidePolygon(p.momentKgM, p.massKg, env.momentPolygon) : null;
  const massOk = p.massKg <= env.maxKg + EPS;
  return { inEnvelope: inCg && inMoment !== false && massOk, massOk, inCgPolygon: inCg, inMomentPolygon: inMoment };
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export function weightAndBalance(input: WbInput): WbResult {
  const mb = input.massBalance;
  const warnings: string[] = [];
  const limitBreaches: WbLimitBreach[] = [];
  const breach = (kind: WbLimitKind, text: string, phase?: 'takeoff' | 'landing') => {
    warnings.push(text);
    limitBreaches.push(phase ? { kind, phase, text } : { kind, text });
  };
  const stations = mb.stations;
  const byId = new Map(stations.map((s) => [s.id, s]));
  const seatToStation = new Map<string, Station>();
  for (const s of stations) if (s.kind === 'seat') for (const seat of s.seats || []) seatToStation.set(seat.id, s);
  const fuelStation = stations.find((s) => s.kind === 'fuel');
  if (!fuelStation && (input.fuelTakeoffL > 0 || input.unusableFuelL > 0)) warnings.push('The aircraft has no fuel station: fuel is not in the balance.');
  const fuelArm = fuelStation?.armM ?? 0;
  const rho = input.fuelDensityKgPerL;
  if (!(rho > 0) && input.fuelTakeoffL > 0) warnings.push('Fuel density is not set: fuel mass is zero.');

  const rows: WbRow[] = [];
  const emptyMoment = mb.emptyMomentKgM > 0 ? mb.emptyMomentKgM : mb.emptyMassKg * mb.emptyArmM;
  if (!(mb.emptyMassKg > 0)) warnings.push('Empty mass is not set (weighing report).');
  rows.push({ label: 'Empty aircraft', stationId: null, massKg: mb.emptyMassKg, armM: mb.emptyMassKg > 0 ? emptyMoment / mb.emptyMassKg : mb.emptyArmM, momentKgM: emptyMoment });

  let unusableRow: WbRow | null = null;
  if (!input.unusableIncludedInEmptyMass && input.unusableFuelL > 0) {
    const m = input.unusableFuelL * (rho > 0 ? rho : 0);
    unusableRow = { label: `Unusable fuel (${fmt(input.unusableFuelL)} L)`, stationId: fuelStation?.id ?? null, massKg: m, armM: fuelArm, momentKgM: m * fuelArm };
    rows.push(unusableRow);
  }

  // Loads (people and baggage).
  const perStation = new Map<string, { mass: number; moment: number }>();
  const seatsUsed = new Map<string, number>();
  const peoplePerStation = new Map<string, number>();
  for (const l of input.loads) {
    let st: Station | undefined;
    if (l.seatId) {
      st = seatToStation.get(l.seatId);
      if (!st) warnings.push(`Seat ${l.seatId} does not exist on this aircraft (${l.label}).`);
      seatsUsed.set(l.seatId, (seatsUsed.get(l.seatId) || 0) + 1);
    }
    if (!st) st = byId.get(l.stationId);
    if (!st) {
      warnings.push(`Unknown station ${l.stationId || '(none)'} for ${l.label}: not in the balance.`);
      continue;
    }
    if (!(l.massKg >= 0)) {
      warnings.push(`Mass of ${l.label} is not set.`);
      continue;
    }
    let arm = st.armM;
    if (l.armM != null && isFinite(l.armM)) {
      arm = l.armM;
      if (st.armRangeM && (arm < st.armRangeM[0] - EPS || arm > st.armRangeM[1] + EPS)) warnings.push(`${l.label}: arm ${arm} m is outside ${st.name} (${st.armRangeM[0]}–${st.armRangeM[1]} m).`);
    }
    rows.push({ label: l.label, stationId: st.id, massKg: l.massKg, armM: arm, momentKgM: l.massKg * arm });
    const agg = perStation.get(st.id) || { mass: 0, moment: 0 };
    agg.mass += l.massKg;
    agg.moment += l.massKg * arm;
    perStation.set(st.id, agg);
    if (st.kind === 'seat') peoplePerStation.set(st.id, (peoplePerStation.get(st.id) || 0) + 1);
  }
  for (const [seat, n] of seatsUsed) if (n > 1) breach('seats', `${n} people in seat ${seat}.`);
  for (const st of stations) {
    const agg = perStation.get(st.id);
    if (st.kind === 'seat' && st.seats && st.seats.length) {
      const n = peoplePerStation.get(st.id) || 0;
      if (n > st.seats.length) breach('seats', `${st.name}: ${n} people for ${st.seats.length} seats.`);
    }
    if (agg && st.maxKg != null && agg.mass > st.maxKg + EPS) breach('station', `${st.name}: ${fmt(agg.mass)} kg exceeds the ${st.maxKg} kg limit.`);
  }
  for (const lim of mb.combinedLimits || []) {
    const m = lim.stations.reduce((s, id) => s + (perStation.get(id)?.mass || 0), 0);
    if (m > lim.maxKg + EPS) {
      const names = lim.stations.map((id) => byId.get(id)?.name ?? id).join(' + ');
      breach('combined', `${names}: ${fmt(m)} kg exceeds the combined ${lim.maxKg} kg limit.`);
    }
  }

  // Fuel.
  let fuelTo = input.fuelTakeoffL;
  let fuelLdg = input.fuelLandingL;
  if (!(fuelTo >= 0)) fuelTo = 0;
  if (!(fuelLdg >= 0)) {
    warnings.push('Fuel at landing is negative: not enough fuel for the trip.');
    fuelLdg = 0;
  }
  if (fuelLdg > fuelTo + EPS) warnings.push('Fuel at landing exceeds fuel at take-off.');
  const fuelToKg = fuelTo * (rho > 0 ? rho : 0);
  const fuelLdgKg = fuelLdg * (rho > 0 ? rho : 0);
  const fuelRow: WbRow = { label: `Usable fuel (${fmt(fuelTo)} L)`, stationId: fuelStation?.id ?? null, massKg: fuelToKg, armM: fuelArm, momentKgM: fuelToKg * fuelArm };

  const zfMass = rows.reduce((s, r) => s + r.massKg, 0);
  const zfMoment = rows.reduce((s, r) => s + r.momentKgM, 0);
  rows.push(fuelRow);

  const zeroFuel = point(zfMass, zfMoment);
  const takeoff = point(zfMass + fuelToKg, zfMoment + fuelToKg * fuelArm);
  const landing = point(zfMass + fuelLdgKg, zfMoment + fuelLdgKg * fuelArm);

  // MD 4.3 table, one row per station.
  const stationRows: WbRow[] = [rows[0]];
  if (unusableRow) stationRows.push(unusableRow);
  for (const st of stations) {
    if (st.kind === 'fuel') continue;
    const agg = perStation.get(st.id);
    const m = agg?.mass || 0;
    const mom = agg?.moment || 0;
    stationRows.push({ label: st.name, stationId: st.id, massKg: m, armM: m > 0 ? mom / m : st.armM, momentKgM: mom });
  }
  stationRows.push(fuelRow);

  // Limits.
  if (mb.mtowKg > 0 && takeoff.massKg > mb.mtowKg + EPS) breach('mtow', `Take-off mass ${fmt(takeoff.massKg)} kg exceeds MTOW ${mb.mtowKg} kg by ${fmt(takeoff.massKg - mb.mtowKg)} kg.`, 'takeoff');
  const mlw = mb.mlwKg ?? mb.mtowKg;
  if (mlw > 0 && landing.massKg > mlw + EPS) breach('mlw', `Landing mass ${fmt(landing.massKg)} kg exceeds the maximum landing mass ${mlw} kg.`, 'landing');

  const normalEnv = mb.envelopes.normal;
  const normal = { takeoff: checkEnvelope(normalEnv, takeoff), landing: checkEnvelope(normalEnv, landing) };
  const utilEnv = mb.envelopes.utility;
  const utility = utilEnv ? { takeoff: checkEnvelope(utilEnv, takeoff), landing: checkEnvelope(utilEnv, landing) } : null;

  const chosen = input.category === 'utility' ? utility : normal;
  const catName = input.category === 'utility' ? 'utility' : 'normal';
  if (input.category === 'utility' && !utilEnv) {
    // No utility limits to check against: the flight cannot be in the utility category.
    breach('category', 'This aircraft has no utility category.');
  }
  if (chosen) {
    for (const [phase, label, c] of [['takeoff', 'Take-off', chosen.takeoff], ['landing', 'Landing', chosen.landing]] as const) {
      if (!c.massOk) breach('envelope', `${label} mass is above the ${catName} category maximum.`, phase);
      else if (!c.inEnvelope) breach('envelope', `${label} CG is outside the ${catName} envelope.`, phase);
    }
  }
  if (input.category === 'utility' && utilEnv) {
    // AFM / club: utility category with no rear passengers and no baggage.
    const rear = stations.filter((s) => s.kind === 'seat' && s.id !== stations.find((x) => x.kind === 'seat')?.id);
    const rearMass = rear.reduce((s, st) => s + (perStation.get(st.id)?.mass || 0), 0);
    const bagMass = stations.filter((s) => s.kind === 'baggage').reduce((s, st) => s + (perStation.get(st.id)?.mass || 0), 0);
    if (rearMass > 0) breach('utility', 'Utility category: no rear passengers allowed.');
    if (bagMass > 0) breach('utility', 'Utility category: no baggage allowed.');
  }

  return { rows, stationRows, zeroFuel, takeoff, landing, normal, utility, warnings, limitBreaches };
}

/** Manifest + baggage → W&B loads (people by seat, baggage by station). */
export function wbLoadsFromManifest(
  crew: { role: string; seat: string; snapshot: { fullName: string; weightKg: number | null } }[],
  baggageKg: Record<string, number>,
  stations: Station[],
): { loads: WbLoad[]; warnings: string[]; missingWeights: string[] } {
  const loads: WbLoad[] = [];
  const warnings: string[] = [];
  const missingWeights: string[] = [];
  const seatToStation = new Map<string, Station>();
  for (const s of stations) if (s.kind === 'seat') for (const seat of s.seats || []) seatToStation.set(seat.id, s);
  for (const c of crew) {
    const name = c.snapshot.fullName || (c.role === 'PIC' ? 'PIC' : 'Passenger');
    const st = seatToStation.get(c.seat);
    if (c.snapshot.weightKg == null) {
      warnings.push(`Weight of ${name} is not set.`);
      missingWeights.push(name);
    }
    loads.push({ stationId: st?.id ?? '', seatId: c.seat, label: `${c.role} ${name}`, massKg: c.snapshot.weightKg ?? 0 });
  }
  for (const st of stations) {
    if (st.kind !== 'baggage') continue;
    const m = baggageKg[st.id];
    if (m && m > 0) loads.push({ stationId: st.id, label: st.name, massKg: m });
  }
  for (const id of Object.keys(baggageKg)) if (baggageKg[id] > 0 && !stations.some((s) => s.id === id && s.kind === 'baggage')) warnings.push(`Baggage at unknown station ${id}.`);
  return { loads, warnings, missingWeights };
}

/**
 * The mass the take-off / landing performance uses. The W&B mass when the balance is complete;
 * MTOW (the conservative bound) when there is no W&B or when someone on the manifest has no
 * weight: the W&B total would then be too light by that person's weight.
 */
export function performanceMass(
  wb: Pick<WbResult, 'takeoff' | 'landing'> | null,
  phase: 'takeoff' | 'landing',
  mtowKg: number | null | undefined,
  missingWeights: number,
): { massKg: number | null; massSource: 'wb' | 'mtow' | null; reason: 'weight-missing' | 'no-wb' | null } {
  if (wb && missingWeights === 0) return { massKg: phase === 'takeoff' ? wb.takeoff.massKg : wb.landing.massKg, massSource: 'wb', reason: null };
  if (typeof mtowKg === 'number' && mtowKg > 0) return { massKg: mtowKg, massSource: 'mtow', reason: wb ? 'weight-missing' : 'no-wb' };
  return { massKg: null, massSource: null, reason: null };
}
