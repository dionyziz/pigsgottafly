// Who may do what with an aircraft or a flight. The owner is aircraft.pilot_id (flights.pilot_id);
// aircraft_shares (flight_shares) gives other pilots 'view' or 'edit' (migrations 013 and 054,
// src/shared/sharing.ts). Every aircraft and flight read or write in the API goes through here: no
// access answers 404 (it does not exist for that pilot), too little access answers 403.
import type { AircraftAccess, AircraftRole, FlightRole, HangarAircraft } from '../../src/shared/sharing.js';
import type { Pilot } from '../../src/shared/types.js';
import type { Queryable, Row } from './db.js';
import { HttpError, notFound } from './http.js';
import { photoJsonSql, toFile } from './routes/files.js';
import { toAircraft, toPilot } from './rows.js';

/** SQL condition: aircraft `alias` is accessible to the pilot id in `param` (e.g. accessibleSql('a', '$2')). */
export const accessibleSql = (alias: string, param: string) =>
  `(${alias}.pilot_id = ${param} OR EXISTS (SELECT 1 FROM aircraft_shares s_ WHERE s_.aircraft_id = ${alias}.id AND s_.pilot_id = ${param}))`;

const SELECT = `SELECT a.*, CASE WHEN a.pilot_id = $1 THEN 'owner' ELSE s.role END AS access_role,
    o.email AS owner_email, o.full_name AS owner_full_name, o.name AS owner_name, ${photoJsonSql('a')} AS photo_file, op.name AS operator_name
  FROM aircraft a JOIN pilots o ON o.id = a.pilot_id
  LEFT JOIN operators op ON op.id = a.operator_id
  LEFT JOIN aircraft_shares s ON s.aircraft_id = a.id AND s.pilot_id = $1
  WHERE (a.pilot_id = $1 OR s.pilot_id IS NOT NULL)`;

export const personName = (fullName: unknown, name: unknown) => String(fullName || '') || String(name || '');

function access(r: Row): AircraftAccess {
  return {
    role: r.access_role as AircraftRole,
    owner: { pilotId: r.pilot_id, name: personName(r.owner_full_name, r.owner_name), email: r.owner_email ?? '' },
  };
}

export const toHangarAircraft = (r: Row): HangarAircraft => ({
  ...toAircraft(r),
  access: access(r),
  photo: r.photo_file ? toFile(r.photo_file) : null,
  placeholder: Number(r.placeholder) || 1,
});

/** Every aircraft the pilot owns or that is shared with them, by registration (own first on a tie). */
export async function listAircraft(db: Queryable, pilotId: string): Promise<HangarAircraft[]> {
  const rows = await db.query(`${SELECT} ORDER BY a.registration, (a.pilot_id = $1) DESC, a.created`, [pilotId]);
  return rows.map(toHangarAircraft);
}

const RANK: Record<AircraftRole, number> = { view: 1, edit: 2, owner: 3 };

/**
 * The aircraft row (with access_role, owner_*) when the pilot has at least `need`.
 * 404 without access, 403 with less than `need`.
 */
export async function aircraftFor(
  db: Queryable,
  pilotId: string,
  id: string,
  need: AircraftRole = 'view',
): Promise<Row> {
  const [r] = await db.query(`${SELECT} AND a.id = $2`, [pilotId, id]);
  if (!r) throw notFound('no such aircraft');
  if (RANK[r.access_role as AircraftRole] < RANK[need]) {
    throw new HttpError(
      403,
      need === 'owner' ? 'only the owner can do this' : 'you can view this aircraft but not change it',
    );
  }
  return r;
}

/**
 * A flight's aircraft as the flight's owner sees it, for a pilot the flight is shared with (role
 * 'view' for them whatever the owner's is); null when the owner has no access to it. Only this
 * aircraft: the owner's others stay out of reach.
 */
export async function flightAircraft(
  db: Queryable,
  ownerId: string,
  aircraftId: string,
): Promise<HangarAircraft | null> {
  const [r] = await db.query(`${SELECT} AND a.id = $2`, [ownerId, aircraftId]);
  if (!r) return null;
  const ac = toHangarAircraft(r);
  return { ...ac, access: { ...ac.access, role: 'view' } };
}

/** SQL select list + join for toAircraft(): the aircraft `a` with its operator's name (operator_name). */
export const AIRCRAFT_FROM = `SELECT a.*, op.name AS operator_name FROM aircraft a LEFT JOIN operators op ON op.id = a.operator_id`;

/** True when the pilot owns the aircraft or it is shared with them. */
export async function canUseAircraft(db: Queryable, pilotId: string, id: string): Promise<boolean> {
  const rows = await db.query(`SELECT 1 FROM aircraft a WHERE a.id = $2 AND ${accessibleSql('a', '$1')}`, [
    pilotId,
    id,
  ]);
  return rows.length > 0;
}

// ---------------------------------------------------------------- flights

/** A flight the session pilot may use, with their role and the flight's owner. */
export interface FlightGrant {
  id: string;
  role: FlightRole;
  /** The owner: rows kept per pilot for the flight (manifest, filing, NOTAMs, forms) use their id. */
  owner: Pilot;
}

/**
 * The session pilot's access to a flight when it is at least `need`: 404 without access (or a shared
 * flight in its owner's trash), 403 with less than `need`.
 */
export async function flightFor(
  db: Queryable,
  pilot: Pilot,
  id: string,
  need: FlightRole = 'view',
): Promise<FlightGrant> {
  const [r] = await db.query(
    `SELECT f.id, f.pilot_id, CASE WHEN f.pilot_id = $2 THEN 'owner' ELSE s.role END AS access_role
     FROM flights f LEFT JOIN flight_shares s ON s.flight_id = f.id AND s.pilot_id = $2
     WHERE f.id = $1 AND (f.pilot_id = $2 OR (s.pilot_id IS NOT NULL AND NOT f.deleted))`,
    [id, pilot.id],
  );
  if (!r) throw notFound('no such flight');
  const role = r.access_role as FlightRole;
  if (RANK[role] < RANK[need]) {
    throw new HttpError(
      403,
      need === 'owner' ? 'only the flight’s owner can do this' : 'you can view this flight but not change it',
    );
  }
  if (role === 'owner') return { id: r.id, role, owner: pilot };
  const [o] = await db.query('SELECT * FROM pilots WHERE id = $1', [r.pilot_id]);
  return { id: r.id, role, owner: toPilot(o) };
}
