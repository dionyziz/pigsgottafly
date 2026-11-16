// Database rows ↔ API entities, and input sanitising for writes.
import { DEFAULT_FLIGHT_OPTIONS, DEFAULT_SETTINGS, EMPTY_SUMMARY } from '../../src/shared/constants.js';
import { normalizeFuelSpec } from '../../src/shared/fuel.js';
import type {
  Aircraft,
  AircraftInput,
  Flight,
  FlightCrew,
  Passenger,
  PassengerInput,
  PersonDetails,
  Pilot,
  PilotSettings,
  Waypoint,
  WaypointInput,
} from '../../src/shared/types.js';
import { checkCompassCards, checkEquipment, checkFuel, checkMassBalance, checkPerformance } from './aircraftDoc.js';
import type { Row } from './db.js';
import { badRequest } from './http.js';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function toPilot(r: Row): Pilot {
  return {
    id: r.id,
    email: r.email ?? '',
    name: r.name ?? '',
    picture: r.picture ?? '',
    fullName: r.full_name ?? '',
    phone: r.phone ?? '',
    dateOfBirth: r.date_of_birth ?? null,
    weightKg: num(r.weight_kg),
    idNumber: r.id_number ?? '',
    idType: r.id_type ?? '',
    nationality: r.nationality ?? '',
    relation: r.relation ?? '',
    licenceNo: r.licence_no ?? '',
    homeAerodrome: r.home_aerodrome || null,
    defaultAircraftId: r.default_aircraft_id ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(r.settings || {}) } as PilotSettings,
    created: Number(r.created),
    lastLogin: Number(r.last_login),
  };
}

export function toAircraft(r: Row): Aircraft {
  return {
    id: r.id,
    registration: r.registration,
    makeModel: r.make_model,
    icaoType: r.icao_type,
    wake: r.wake,
    serial: r.serial,
    // the linked operator's name (queries join it as operator_name), else the free text
    operator: r.operator_name ?? r.operator,
    operatorId: r.operator_id ?? null,
    homeBase: r.home_base,
    colours: r.colours,
    cruiseTasKt: Number(r.cruise_tas_kt),
    patternTasKt: Number(r.pattern_tas_kt),
    climbTasKt: num(r.climb_tas_kt),
    fuel: normalizeFuelSpec(r.fuel),
    massBalance: r.mass_balance,
    performance: r.performance,
    equipment: r.equipment,
    compassCards: r.compass_cards ?? [],
    notes: r.notes ?? '',
    created: Number(r.created),
    updated: Number(r.updated),
  };
}

export function toPassenger(r: Row): Passenger {
  return {
    id: r.id,
    fullName: r.full_name,
    phone: r.phone,
    dateOfBirth: r.date_of_birth ?? null,
    weightKg: num(r.weight_kg),
    idNumber: r.id_number,
    idType: r.id_type,
    nationality: r.nationality,
    relation: r.relation,
    notes: r.notes,
    created: Number(r.created),
    updated: Number(r.updated),
  };
}

export function toWaypoint(r: Row): Waypoint {
  return {
    id: r.id,
    name: r.name,
    lat: Number(r.lat),
    lon: Number(r.lon),
    notes: r.notes,
    created: Number(r.created),
    updated: Number(r.updated),
  };
}

export function toFlight(r: Row, crewRows: Row[]): Flight {
  return {
    id: r.id,
    title: r.title,
    date: r.date,
    blockOff: r.block_off,
    aircraftId: r.aircraft_id ?? null,
    taxiOutMin: num(r.taxi_out_min),
    taxiInMin: num(r.taxi_in_min),
    fobL: num(r.fob_l),
    route: r.route ?? [],
    legOverrides: r.leg_overrides ?? {},
    atc: r.atc ?? null,
    crew: crewRows
      .sort((a, b) => a.position - b.position)
      .map((c): FlightCrew => ({
        role: c.role,
        passengerId: c.passenger_id ?? null,
        seat: c.seat,
        snapshot: c.snapshot,
        overrides: c.overrides ?? [],
      })),
    baggageKg: r.baggage_kg ?? {},
    options: { ...DEFAULT_FLIGHT_OPTIONS, ...(r.options || {}) },
    summary: { ...EMPTY_SUMMARY, ...(r.summary || {}) },
    version: Number(r.version),
    created: Number(r.created),
    updated: Number(r.updated),
    opened: Number(r.opened),
    deleted: !!r.deleted,
  };
}

// ---------------------------------------------------------------- input checks

export function str(v: unknown, field: string, max = 500): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
  if (v.length > max) throw badRequest(`${field} is too long`);
  return v.trim();
}
export function optNum(v: unknown, field: string, min = -Infinity, max = Infinity): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n) || n < min || n > max) throw badRequest(`${field} must be a number in [${min}, ${max}]`);
  return n;
}
export function reqNum(v: unknown, field: string, min = -Infinity, max = Infinity): number {
  const n = optNum(v, field, min, max);
  if (n === null) throw badRequest(`${field} is required`);
  return n;
}
export function optDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z')))
    throw badRequest(`${field} must be YYYY-MM-DD`);
  return v;
}
export function obj<T>(v: unknown, field: string): T {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${field} must be an object`);
  return v as T;
}
export function arr<T>(v: unknown, field: string): T[] {
  if (!Array.isArray(v)) throw badRequest(`${field} must be an array`);
  return v as T[];
}
export function idType(v: unknown): PersonDetails['idType'] {
  if (v === undefined || v === null || v === '') return '';
  if (v === 'ID' || v === 'PASSPORT') return v;
  throw badRequest('idType must be ID, PASSPORT or empty');
}

/** Person fields (merged over `base`) → column values. */
export function personColumns(input: Partial<PersonDetails>, base: PersonDetails) {
  const p = { ...base };
  if ('fullName' in input) p.fullName = str(input.fullName, 'fullName', 200);
  if ('phone' in input) p.phone = str(input.phone, 'phone', 50);
  if ('dateOfBirth' in input) p.dateOfBirth = optDate(input.dateOfBirth, 'dateOfBirth');
  if ('weightKg' in input) p.weightKg = optNum(input.weightKg, 'weightKg', 0, 300);
  if ('idNumber' in input) p.idNumber = str(input.idNumber, 'idNumber', 50);
  if ('idType' in input) p.idType = idType(input.idType);
  if ('nationality' in input) p.nationality = str(input.nationality, 'nationality', 50);
  if ('relation' in input) p.relation = str(input.relation, 'relation', 100);
  return p;
}

export function passengerInput(input: Partial<PassengerInput>, base: PassengerInput): PassengerInput {
  const p = { ...base, ...personColumns(input, base) };
  if ('notes' in input) p.notes = str(input.notes, 'notes', 2000);
  if (!p.fullName) throw badRequest('fullName is required');
  return p;
}

export function waypointInput(input: Partial<WaypointInput>, base: WaypointInput): WaypointInput {
  const w = { ...base };
  if ('name' in input) w.name = str(input.name, 'name', 40).toUpperCase();
  if ('lat' in input) w.lat = reqNum(input.lat, 'lat', -90, 90);
  if ('lon' in input) w.lon = reqNum(input.lon, 'lon', -180, 180);
  if ('notes' in input) w.notes = str(input.notes, 'notes', 2000);
  if (!w.name) throw badRequest('name is required');
  if (!isFinite(w.lat) || !isFinite(w.lon)) throw badRequest('lat and lon are required');
  return w;
}

export function aircraftInput(input: Partial<AircraftInput>, base: AircraftInput): AircraftInput {
  const a = { ...base };
  if ('registration' in input) a.registration = str(input.registration, 'registration', 20).toUpperCase();
  for (const k of ['makeModel', 'icaoType', 'serial', 'operator', 'homeBase', 'colours', 'notes'] as const) {
    if (k in input) a[k] = str(input[k], k, k === 'notes' ? 5000 : 200);
  }
  if ('operatorId' in input) {
    if (input.operatorId != null && (typeof input.operatorId !== 'string' || input.operatorId.length > 64))
      throw badRequest('operatorId must be an operator id or null');
    a.operatorId = input.operatorId || null;
  }
  if ('icaoType' in input) a.icaoType = a.icaoType.toUpperCase();
  if ('homeBase' in input) a.homeBase = a.homeBase.toUpperCase();
  if ('wake' in input) {
    if (!['L', 'M', 'H', 'J'].includes(input.wake as string)) throw badRequest('wake must be L, M, H or J');
    a.wake = input.wake!;
  }
  // speeds: JSON numbers only (no string coercion); 0 = not set yet (see aircraftDoc.ts)
  const tas = (v: unknown, f: string) => {
    if (typeof v !== 'number') throw badRequest(`${f} must be a number in [0, 1000]`);
    return reqNum(v, f, 0, 1000);
  };
  if ('cruiseTasKt' in input) a.cruiseTasKt = tas(input.cruiseTasKt, 'cruiseTasKt');
  if ('patternTasKt' in input) a.patternTasKt = tas(input.patternTasKt, 'patternTasKt');
  if ('climbTasKt' in input) a.climbTasKt = input.climbTasKt == null ? null : tas(input.climbTasKt, 'climbTasKt');
  if ('fuel' in input) a.fuel = checkFuel(input.fuel);
  if ('massBalance' in input) a.massBalance = checkMassBalance(input.massBalance);
  if ('performance' in input) a.performance = checkPerformance(input.performance);
  if ('equipment' in input) a.equipment = checkEquipment(input.equipment);
  if ('compassCards' in input) a.compassCards = checkCompassCards(input.compassCards);
  if (!a.registration) throw badRequest('registration is required');
  return a;
}
