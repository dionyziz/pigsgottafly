// Content validation of the JSON sub-documents of an aircraft (fuel, mass & balance, performance
// tables, equipment, compass cards). Same approach as flightDoc.ts: everything a client writes is
// checked for type and range and rebuilt from the known fields only, because these records feed the
// safety numbers (navlog times and fuel, W&B, take-off and landing distances) and the flight's
// manifest (seat layout). Numbers must be JSON numbers: strings, booleans and null are not coerced.
//
// 0 is the hangar's "not set yet" value for speeds, burn rate, masses and capacities (a new aircraft
// from a type template has no airframe data yet, and the hangar shows a warning). The calculations
// treat 0 as unset (warnings, no division), so 0 is accepted; negative, non-finite or non-number
// values are refused with 400. The limits are the hangar's own errors (src/features/hangar/model.ts
// validateAircraft) where it has them, and generous plausibility limits elsewhere.
import type {
  CompassCard, Envelope, Equipment, FuelGrade, FuelSpec, FuelType, LandingTable, MassBalance, PerformanceFactors, PerformanceTables,
  SeatPosition, Station, StationKind, TakeoffTable, TakeoffTableRow, WbCategory,
} from '../../src/shared/types.js';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, type AttachmentRef, type AttachmentType } from '../../src/shared/types.js';
import { FUEL_TYPES, normalizeFuelSpec } from '../../src/shared/fuel.js';
import { badRequest } from './http.js';
import { arr, obj } from './rows.js';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function num(v: unknown, field: string, min: number, max: number): number {
  if (!isNum(v) || v < min || v > max) throw badRequest(`${field} must be a number in [${min}, ${max}]`);
  return v;
}
function optNumber(v: unknown, field: string, min: number, max: number): number | null {
  return v === null || v === undefined ? null : num(v, field, min, max);
}
function text(v: unknown, field: string, max = 500): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
  if (v.length > max) throw badRequest(`${field} is too long`);
  return v;
}
function bool(v: unknown, field: string): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'boolean') throw badRequest(`${field} must be true or false`);
  return v;
}
function isoDate(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z'))) throw badRequest(`${field} must be YYYY-MM-DD`);
  return v;
}
function list<T>(v: unknown, field: string, max: number): T[] {
  const a = arr<T>(v, field);
  if (a.length > max) throw badRequest(`${field} has too many entries`);
  return a;
}
const numbers = (v: unknown, field: string, min: number, max: number, maxLen = 50) =>
  list<unknown>(v, field, maxLen).map((x, i) => num(x, `${field}[${i}]`, min, max));
const texts = (v: unknown, field: string, maxLen = 50) =>
  v === undefined || v === null ? [] : list<unknown>(v, field, maxLen).map((x, i) => text(x, `${field}[${i}]`, 2000));
/** [a, b] with each in its range. */
function pair(v: unknown, field: string, a: [number, number], b: [number, number]): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw badRequest(`${field} must be a pair of numbers`);
  return [num(v[0], `${field}[0]`, a[0], a[1]), num(v[1], `${field}[1]`, b[0], b[1])];
}

/** Plausibility limits (SI units of the hangar: kg, m, L, kt, ft). */
export const AIRCRAFT_LIMITS = {
  tasKt: [0, 1000] as [number, number],
  massKg: [0, 100000] as [number, number],
  armM: [-5, 30] as [number, number],
  momentKgM: [-3e6, 3e6] as [number, number],
  litres: [0, 100000] as [number, number],
  densityKgPerL: [0.5, 1] as [number, number],
  burnLph: [0, 500] as [number, number],
  taxiAllowanceL: [0, 1000] as [number, number],
  altitudeFt: [-2000, 30000] as [number, number],
  tempC: [-60, 60] as [number, number],
  distanceM: [0, 20000] as [number, number],
  windKt: [0, 100] as [number, number],
  fraction: [0, 2] as [number, number],
  factor: [1, 5] as [number, number],
  crosswindKt: [0, 200] as [number, number],
  iasKt: [0, 500] as [number, number],
};
const L = AIRCRAFT_LIMITS;

// ---------------------------------------------------------------- fuel

const FUEL_TYPE_SET = new Set<FuelType>(FUEL_TYPES);

export function checkFuel(v: unknown): FuelSpec {
  // an old client may still send one {type, densityKgPerL}
  const f = normalizeFuelSpec(obj<FuelSpec>(v, 'fuel'));
  const raw = list<FuelGrade>(f.types, 'fuel.types', FUEL_TYPES.length);
  if (!raw.length) throw badRequest('fuel.types needs at least one fuel');
  const seen = new Set<FuelType>();
  const types = raw.map((g, i): FuelGrade => {
    obj(g, `fuel.types[${i}]`);
    if (!FUEL_TYPE_SET.has(g.type)) throw badRequest(`fuel.types[${i}].type must be AVGAS, MOGAS or JET A-1`);
    if (seen.has(g.type)) throw badRequest(`fuel.types lists ${g.type} twice`);
    seen.add(g.type);
    return { type: g.type, densityKgPerL: num(g.densityKgPerL, `fuel.types[${i}].densityKgPerL`, ...L.densityKgPerL) };
  });
  return {
    types,
    totalL: num(f.totalL, 'fuel.totalL', ...L.litres),
    usableL: num(f.usableL, 'fuel.usableL', ...L.litres),
    unusableL: num(f.unusableL, 'fuel.unusableL', ...L.litres),
    unusableIncludedInEmptyMass: bool(f.unusableIncludedInEmptyMass, 'fuel.unusableIncludedInEmptyMass'),
    tanks: text(f.tanks, 'fuel.tanks', 100),
    burnLph: num(f.burnLph, 'fuel.burnLph', ...L.burnLph),
    taxiAllowanceL: num(f.taxiAllowanceL, 'fuel.taxiAllowanceL', ...L.taxiAllowanceL),
  };
}

// ---------------------------------------------------------------- mass & balance

const STATION_KINDS = new Set<StationKind>(['seat', 'baggage', 'fuel']);
export const MAX_STATIONS = 30;
export const MAX_POLYGON_POINTS = 100;

function checkStations(v: unknown): Station[] {
  const ids = new Set<string>();
  const seatIds = new Set<string>();
  return list<Station>(v, 'massBalance.stations', MAX_STATIONS).map((s, i) => {
    const p = `massBalance.stations[${i}]`;
    obj(s, p);
    const id = text(s.id, `${p}.id`, 40).trim();
    if (!id) throw badRequest(`${p}.id is required`);
    if (ids.has(id)) throw badRequest(`two stations have the id ${id}`);
    ids.add(id);
    if (!STATION_KINDS.has(s.kind)) throw badRequest(`${p}.kind must be seat, baggage or fuel`);
    let seats: SeatPosition[] | null = null;
    if (s.kind === 'seat' || (s.seats !== undefined && s.seats !== null)) {
      seats = list<SeatPosition>(s.seats, `${p}.seats`, 20).map((q, j) => {
        obj(q, `${p}.seats[${j}]`);
        const sid = text(q.id, `${p}.seats[${j}].id`, 40).trim();
        if (!sid) throw badRequest(`${p}.seats[${j}].id is required`);
        if (seatIds.has(sid)) throw badRequest(`seat id ${sid} is used twice`);
        seatIds.add(sid);
        return { id: sid, label: text(q.label, `${p}.seats[${j}].label`, 100) };
      });
    }
    let armRangeM: [number, number] | null = null;
    if (s.armRangeM !== undefined && s.armRangeM !== null) {
      armRangeM = pair(s.armRangeM, `${p}.armRangeM`, L.armM, L.armM);
      if (!(armRangeM[0] < armRangeM[1])) throw badRequest(`${p}.armRangeM must go from lower to higher arm`);
    }
    return {
      id,
      name: text(s.name, `${p}.name`, 100),
      kind: s.kind,
      armM: num(s.armM, `${p}.armM`, ...L.armM),
      armRangeM,
      maxKg: optNumber(s.maxKg, `${p}.maxKg`, ...L.massKg),
      seats,
    };
  });
}

function checkEnvelope(v: unknown, category: WbCategory): Envelope {
  const p = `massBalance.envelopes.${category}`;
  const e = obj<Envelope>(v, p);
  if (e.category !== undefined && e.category !== category) throw badRequest(`${p}.category must be ${category}`);
  const out: Envelope = {
    category,
    maxKg: num(e.maxKg, `${p}.maxKg`, ...L.massKg),
    polygon: list<unknown>(e.polygon, `${p}.polygon`, MAX_POLYGON_POINTS).map((q, i) => pair(q, `${p}.polygon[${i}]`, L.armM, L.massKg)),
    momentPolygon: e.momentPolygon === undefined || e.momentPolygon === null ? null
      : list<unknown>(e.momentPolygon, `${p}.momentPolygon`, MAX_POLYGON_POINTS).map((q, i) => pair(q, `${p}.momentPolygon[${i}]`, L.momentKgM, L.massKg)),
  };
  if (e.notes !== undefined) out.notes = text(e.notes, `${p}.notes`, 2000);
  return out;
}

export function checkMassBalance(v: unknown): MassBalance {
  const m = obj<MassBalance>(v, 'massBalance');
  const stations = checkStations(m.stations);
  const stationIds = new Set(stations.map((s) => s.id));
  const combinedLimits = (m.combinedLimits === undefined || m.combinedLimits === null ? [] : list<MassBalance['combinedLimits'][number]>(m.combinedLimits, 'massBalance.combinedLimits', 20))
    .map((c, i) => {
      const p = `massBalance.combinedLimits[${i}]`;
      obj(c, p);
      const ids = list<unknown>(c.stations, `${p}.stations`, MAX_STATIONS).map((x, j) => text(x, `${p}.stations[${j}]`, 40));
      const unknown = ids.filter((x) => !stationIds.has(x));
      if (unknown.length) throw badRequest(`${p} refers to unknown station ${unknown.join(', ')}`);
      return { stations: ids, maxKg: num(c.maxKg, `${p}.maxKg`, ...L.massKg) };
    });
  const env = obj<MassBalance['envelopes']>(m.envelopes, 'massBalance.envelopes');
  return {
    datum: text(m.datum, 'massBalance.datum', 200),
    emptyMassKg: num(m.emptyMassKg, 'massBalance.emptyMassKg', ...L.massKg),
    emptyArmM: num(m.emptyArmM, 'massBalance.emptyArmM', ...L.armM),
    emptyMomentKgM: num(m.emptyMomentKgM, 'massBalance.emptyMomentKgM', ...L.momentKgM),
    weighingDate: m.weighingDate === null || m.weighingDate === undefined || m.weighingDate === '' ? null : isoDate(m.weighingDate, 'massBalance.weighingDate'),
    weighingSource: text(m.weighingSource, 'massBalance.weighingSource', 500),
    includesOil: bool(m.includesOil, 'massBalance.includesOil'),
    mtowKg: num(m.mtowKg, 'massBalance.mtowKg', ...L.massKg),
    mlwKg: optNumber(m.mlwKg, 'massBalance.mlwKg', ...L.massKg),
    stations,
    combinedLimits,
    envelopes: {
      normal: checkEnvelope(env.normal, 'normal'),
      utility: env.utility === null || env.utility === undefined ? null : checkEnvelope(env.utility, 'utility'),
    },
  };
}

// ---------------------------------------------------------------- performance

const distancePair = (v: unknown, field: string) => pair(v, field, L.distanceM, L.distanceM);

function checkTakeoff(v: unknown): TakeoffTable {
  const p = 'performance.takeoff';
  const t = obj<TakeoffTable>(v, p);
  const altitudesFt = numbers(t.altitudesFt, `${p}.altitudesFt`, ...L.altitudeFt, 20);
  const standardTempC = numbers(t.standardTempC, `${p}.standardTempC`, ...L.tempC, 20);
  if (standardTempC.length !== altitudesFt.length) throw badRequest(`${p}.standardTempC must have one value per altitude`);
  const rows = list<TakeoffTableRow>(t.rows, `${p}.rows`, 20).map((r, i): TakeoffTableRow => {
    const q = `${p}.rows[${i}]`;
    obj(r, q);
    const headwindKt = numbers(r.headwindKt, `${q}.headwindKt`, ...L.windKt, 10);
    const distances = list<unknown>(r.distances, `${q}.distances`, 10).map((byAlt, h) =>
      list<unknown>(byAlt, `${q}.distances[${h}]`, 20).map((d, a) => distancePair(d, `${q}.distances[${h}][${a}]`)));
    if (distances.length !== headwindKt.length) throw badRequest(`${q}.distances must have one row per headwind`);
    if (distances.some((d) => d.length !== altitudesFt.length)) throw badRequest(`${q}.distances must have one pair per altitude`);
    return { massKg: num(r.massKg, `${q}.massKg`, ...L.massKg), liftoffIas: text(r.liftoffIas, `${q}.liftoffIas`, 100), headwindKt, distances };
  });
  return {
    source: text(t.source, `${p}.source`, 2000),
    flaps: text(t.flaps, `${p}.flaps`, 50),
    altitudesFt,
    standardTempC,
    rows,
    tempIncreasePer15C: num(t.tempIncreasePer15C, `${p}.tempIncreasePer15C`, ...L.fraction),
    grassAddFractionOfTotal: num(t.grassAddFractionOfTotal, `${p}.grassAddFractionOfTotal`, ...L.fraction),
    notes: texts(t.notes, `${p}.notes`),
  };
}

function checkLanding(v: unknown): LandingTable {
  const p = 'performance.landing';
  const t = obj<LandingTable>(v, p);
  const altitudesFt = numbers(t.altitudesFt, `${p}.altitudesFt`, ...L.altitudeFt, 20);
  const standardTempC = numbers(t.standardTempC, `${p}.standardTempC`, ...L.tempC, 20);
  if (standardTempC.length !== altitudesFt.length) throw badRequest(`${p}.standardTempC must have one value per altitude`);
  const distances = list<unknown>(t.distances, `${p}.distances`, 20).map((d, a) => distancePair(d, `${p}.distances[${a}]`));
  if (distances.length !== altitudesFt.length) throw badRequest(`${p}.distances must have one pair per altitude`);
  return {
    source: text(t.source, `${p}.source`, 2000),
    flaps: text(t.flaps, `${p}.flaps`, 50),
    massKg: num(t.massKg, `${p}.massKg`, ...L.massKg),
    approachIas: text(t.approachIas, `${p}.approachIas`, 100),
    altitudesFt,
    standardTempC,
    distances,
    headwindDecreasePer5Kt: num(t.headwindDecreasePer5Kt, `${p}.headwindDecreasePer5Kt`, ...L.fraction),
    tempIncreasePer15C: num(t.tempIncreasePer15C, `${p}.tempIncreasePer15C`, ...L.fraction),
    grassAddFractionOfTotal: num(t.grassAddFractionOfTotal, `${p}.grassAddFractionOfTotal`, ...L.fraction),
    notes: texts(t.notes, `${p}.notes`),
  };
}

function checkFactors(v: unknown): PerformanceFactors {
  const p = 'performance.factors';
  const f = obj<PerformanceFactors>(v, p);
  const rc = obj<Record<string, unknown>>(f.runwayCondition ?? {}, `${p}.runwayCondition`);
  const keys = Object.keys(rc);
  if (keys.length > 30) throw badRequest(`${p}.runwayCondition has too many entries`);
  const runwayCondition: Record<string, number> = {};
  for (const k of keys) {
    if (!k.trim() || k.length > 100 || k === '__proto__') throw badRequest(`${p}.runwayCondition has an invalid surface name`);
    runwayCondition[k] = num(rc[k], `${p}.runwayCondition.${k}`, ...L.factor);
  }
  const xw = obj<PerformanceFactors['maxCrosswindKt']>(f.maxCrosswindKt, `${p}.maxCrosswindKt`);
  return {
    source: text(f.source, `${p}.source`, 2000),
    safetyFactorTakeoff: num(f.safetyFactorTakeoff, `${p}.safetyFactorTakeoff`, ...L.factor),
    safetyFactorLanding: num(f.safetyFactorLanding, `${p}.safetyFactorLanding`, ...L.factor),
    runwayCondition,
    slopeFactorPer2Pct: num(f.slopeFactorPer2Pct, `${p}.slopeFactorPer2Pct`, ...L.factor),
    maxCrosswindKt: {
      takeoff: num(xw.takeoff, `${p}.maxCrosswindKt.takeoff`, ...L.crosswindKt),
      landing: num(xw.landing, `${p}.maxCrosswindKt.landing`, ...L.crosswindKt),
    },
    notes: texts(f.notes, `${p}.notes`),
  };
}

export function checkPerformance(v: unknown): PerformanceTables {
  const t = obj<PerformanceTables>(v, 'performance');
  let stallIasKt: PerformanceTables['stallIasKt'] = null;
  if (t.stallIasKt !== null && t.stallIasKt !== undefined) {
    const s = obj<NonNullable<PerformanceTables['stallIasKt']>>(t.stallIasKt, 'performance.stallIasKt');
    stallIasKt = {
      flapsUp: numbers(s.flapsUp, 'performance.stallIasKt.flapsUp', ...L.iasKt, 10),
      flaps10: numbers(s.flaps10, 'performance.stallIasKt.flaps10', ...L.iasKt, 10),
      flaps40: numbers(s.flaps40, 'performance.stallIasKt.flaps40', ...L.iasKt, 10),
    };
  }
  return { takeoff: checkTakeoff(t.takeoff), landing: checkLanding(t.landing), factors: checkFactors(t.factors), stallIasKt };
}

// ---------------------------------------------------------------- equipment (FPL items 10, 18, 19)

function flags<K extends string>(v: unknown, field: string, keys: readonly K[]): Record<K, boolean> {
  const o = v === undefined || v === null ? {} : obj<Record<string, unknown>>(v, field);
  return Object.fromEntries(keys.map((k) => [k, bool(o[k], `${field}.${k}`)])) as Record<K, boolean>;
}

export function checkEquipment(v: unknown): Equipment {
  const e = obj<Equipment>(v, 'equipment');
  const fplText = (x: unknown, field: string, max: number) => text(x, field, max);
  let dinghies: Equipment['dinghies'] = null;
  if (e.dinghies !== null && e.dinghies !== undefined) {
    const d = obj<NonNullable<Equipment['dinghies']>>(e.dinghies, 'equipment.dinghies');
    const int = (x: unknown, f: string) => { const n = num(x, f, 1, 99); if (!Number.isInteger(n)) throw badRequest(`${f} must be a whole number`); return n; };
    dinghies = {
      number: int(d.number, 'equipment.dinghies.number'),
      capacity: int(d.capacity, 'equipment.dinghies.capacity'),
      covered: bool(d.covered, 'equipment.dinghies.covered'),
      colour: fplText(d.colour, 'equipment.dinghies.colour', 50),
    };
  }
  return {
    item10a: fplText(e.item10a, 'equipment.item10a', 40),
    item10b: fplText(e.item10b, 'equipment.item10b', 40),
    pbn: fplText(e.pbn, 'equipment.pbn', 40),
    item18Extras: fplText(e.item18Extras, 'equipment.item18Extras', 500),
    emergencyRadio: flags(e.emergencyRadio, 'equipment.emergencyRadio', ['uhf', 'vhf', 'elt'] as const),
    survival: flags(e.survival, 'equipment.survival', ['polar', 'desert', 'maritime', 'jungle'] as const),
    jackets: flags(e.jackets, 'equipment.jackets', ['present', 'light', 'fluorescein', 'uhf', 'vhf'] as const),
    dinghies,
    remarks: fplText(e.remarks, 'equipment.remarks', 500),
  };
}

// ---------------------------------------------------------------- compass cards

export function checkCompassCards(v: unknown): CompassCard[] {
  return list<CompassCard>(v, 'compassCards', 10).map((c, i) => {
    const p = `compassCards[${i}]`;
    obj(c, p);
    const points = list<unknown>(c.points, `${p}.points`, 72).map((q, j) => {
      const [fo, st] = pair(q, `${p}.points[${j}]`, [0, 360], [0, 360]);
      if (fo >= 360 || st >= 360) throw badRequest(`${p}.points[${j}]: headings must be 0–359°`);
      return [fo, st] as [number, number];
    });
    return {
      name: text(c.name, `${p}.name`, 100),
      swung: isoDate(c.swung, `${p}.swung`),
      expires: isoDate(c.expires, `${p}.expires`),
      source: text(c.source, `${p}.source`, 500),
      points,
      ...withReport(attachmentRef((c as { report?: unknown }).report, `${p}.report`)),
    };
  });
}

const withReport = (r: AttachmentRef | null) => (r ? { report: r } : {});

/** CompassCard.report: a reference to a file of /aircraft/:id/attachments (content checked on upload). */
function attachmentRef(v: unknown, p: string): AttachmentRef | null {
  if (v === undefined || v === null) return null;
  const r = obj<Record<string, unknown>>(v, p);
  if (typeof r.id !== 'string' || !/^file_[\w-]{1,40}$/.test(r.id)) throw badRequest(`${p}.id is not a file id`);
  if (!(ATTACHMENT_TYPES as readonly unknown[]).includes(r.mime)) throw badRequest(`${p}.mime must be one of ${ATTACHMENT_TYPES.join(', ')}`);
  return {
    id: r.id,
    name: text(r.name, `${p}.name`, 200),
    mime: r.mime as AttachmentType,
    size: num(r.size, `${p}.size`, 0, ATTACHMENT_MAX_BYTES),
    uploaded: num(r.uploaded, `${p}.uploaded`, 0, 1e14),
  };
}
