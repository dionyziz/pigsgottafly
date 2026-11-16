// Flights: /flights (list, create), /flights/:id (get, versioned PUT with 409, DELETE = trash),
// /flights/:id/restore, /flights/:id/copy, /flights/:id/opened. Manifest rows (flight_crew) are part
// of the flight document and replaced atomically with it. Everything is scoped to the session pilot.
// A flight may use the pilot's own aircraft or one shared with them (access.ts). When that access
// ends, the flight keeps the aircraft id and the editor shows the aircraft as unavailable; saving
// such a flight keeps that id (without the seat checks) until the pilot picks another aircraft.
import { aerodromePoint } from '../../../src/shared/aerodrome.js';
import type { FlightCreateRequest, FlightListItem, FlightUpdateRequest } from '../../../src/shared/api.js';
import {
  autoTitle,
  DEFAULT_FLIGHT_OPTIONS,
  EMPTY_PERSON,
  EMPTY_SUMMARY,
  emptyFlightDoc,
  FALLBACK_SEATS,
  PERSON_KEYS,
  picSeat,
  seatLayout,
  validateCrew,
} from '../../../src/shared/constants.js';
import { mapLayersOf } from '../../../src/shared/mapLayers.js';
import type { FlightCrew, FlightDoc, Pilot } from '../../../src/shared/types.js';
import { accessibleSql, canUseAircraft } from '../access.js';
import type { Queryable, Row } from '../db.js';
import { checkAtc, checkBaggage, checkLegOverrides, checkOptions, checkRoute, checkSummary } from '../flightDoc.js';
import type { Route } from '../http.js';
import { badRequest, HttpError, newId, notFound, reply } from '../http.js';
import { checkCount } from '../limits.js';
import { arr, obj, optDate, optNum, personColumns, str, toFlight } from '../rows.js';
import { findAerodrome } from './ref.js';

async function load(db: Queryable, pilotId: string, id: string) {
  const [r] = await db.query('SELECT * FROM flights WHERE id = $1 AND pilot_id = $2', [id, pilotId]);
  if (!r) throw notFound('no such flight');
  const crew = await db.query('SELECT * FROM flight_crew WHERE flight_id = $1 AND pilot_id = $2', [id, pilotId]);
  return toFlight(r, crew);
}

/**
 * Seat ids of an aircraft the pilot owns or that is shared with them (null when it has no seat
 * stations). Throws 400 when the pilot has no access to it. Tolerates a malformed stored seat layout (rows written before the
 * aircraft documents were validated): anything that is not a station with a seats array is skipped.
 */
async function aircraftSeats(db: Queryable, pilotId: string, aircraftId: string): Promise<string[] | null> {
  const [ac] = await db.query(`SELECT a.mass_balance FROM aircraft a WHERE a.id = $2 AND ${accessibleSql('a', '$1')}`, [
    pilotId,
    aircraftId,
  ]);
  if (!ac) throw badRequest('no such aircraft');
  const raw = ac.mass_balance?.stations;
  const stations = (Array.isArray(raw) ? raw : [])
    .filter((s) => s && typeof s === 'object' && Array.isArray(s.seats))
    .map((s) => ({ ...s, seats: (s.seats as Row[]).filter((q) => q && typeof q.id === 'string' && q.id) }));
  const seats = seatLayout(stations).map((s) => s.id);
  return seats.length ? seats : null;
}

/**
 * Validates and normalises a full FlightDoc (merged over `base`). `storedAircraftId` is the saved
 * flight's aircraft: kept even when the pilot no longer has access to it (shown as unavailable).
 */
async function checkDoc(
  db: Queryable,
  pilotId: string,
  input: Partial<FlightDoc>,
  base: FlightDoc,
  storedAircraftId: string | null = null,
): Promise<FlightDoc> {
  const d: FlightDoc = { ...base };
  if ('title' in input) d.title = str(input.title, 'title', 200);
  if ('date' in input) d.date = optDate(input.date, 'date') ?? base.date;
  if ('blockOff' in input) {
    d.blockOff = str(input.blockOff, 'blockOff', 5);
    if (d.blockOff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.blockOff)) throw badRequest('blockOff must be HH:MM (UTC)');
  }
  if ('aircraftId' in input) d.aircraftId = input.aircraftId || null;
  if ('taxiOutMin' in input) d.taxiOutMin = optNum(input.taxiOutMin, 'taxiOutMin', 0, 600);
  if ('taxiInMin' in input) d.taxiInMin = optNum(input.taxiInMin, 'taxiInMin', 0, 600);
  if ('fobL' in input) d.fobL = optNum(input.fobL, 'fobL', 0, 10000);
  if ('route' in input) d.route = checkRoute(input.route);
  if ('legOverrides' in input) d.legOverrides = checkLegOverrides(input.legOverrides);
  if ('atc' in input) d.atc = checkAtc(input.atc);
  if ('crew' in input) d.crew = arr<FlightCrew>(input.crew, 'crew');
  if ('baggageKg' in input) d.baggageKg = checkBaggage(input.baggageKg);
  if ('options' in input) {
    d.options = checkOptions(input.options, DEFAULT_FLIGHT_OPTIONS);
    // The General Declaration override belongs to POST /flights/:id/forms/gendec/handled (the export page):
    // an editor's copy of the flight never changes it.
    if (base.options?.genDecHandled != null) d.options.genDecHandled = base.options.genDecHandled;
  }
  if ('summary' in input) d.summary = checkSummary(input.summary);

  if (d.aircraftId !== null && typeof d.aircraftId !== 'string') throw badRequest('aircraftId must be a string');
  const unavailable =
    !!d.aircraftId && d.aircraftId === storedAircraftId && !(await canUseAircraft(db, pilotId, d.aircraftId));
  const seats = d.aircraftId && !unavailable ? await aircraftSeats(db, pilotId, d.aircraftId) : null;
  if (d.crew.length > 50) throw badRequest('crew has too many entries');
  d.crew = d.crew.map((c, i) => {
    obj(c, `crew[${i}]`);
    if (c.role !== 'PIC' && c.role !== 'PAX') throw badRequest(`crew[${i}].role must be PIC or PAX`);
    if (c.role === 'PIC' && c.passengerId) throw badRequest('the PIC is the pilot, not a passenger');
    if (c.passengerId != null && typeof c.passengerId !== 'string')
      throw badRequest(`crew[${i}].passengerId must be a string`);
    if (typeof c.seat !== 'string' || c.seat.length > 40) throw badRequest(`crew[${i}].seat must be a seat id`);
    // the snapshot feeds W&B (weight) and the forms: same checks as a passenger record
    const snapshot = personColumns(obj(c.snapshot, `crew[${i}].snapshot`), EMPTY_PERSON);
    if (c.overrides != null && !Array.isArray(c.overrides)) throw badRequest(`crew[${i}].overrides must be an array`);
    const overrides = PERSON_KEYS.filter((k) => c.overrides?.includes(k));
    return { role: c.role, passengerId: c.passengerId || null, seat: c.seat, snapshot, overrides };
  });
  const errs = validateCrew(d.crew, seats);
  if (errs.length) throw badRequest(errs.join('; '));
  const paxIds = d.crew.map((c) => c.passengerId).filter((x): x is string => !!x);
  if (paxIds.length) {
    // A passenger link that is not (or no longer) one of the pilot's passengers is dropped, the
    // snapshot stays: an editor still holding a passenger deleted meanwhile saves without error,
    // exactly as the database left the flight (flight_crew.passenger_id ON DELETE SET NULL).
    const own = new Set(
      (await db.query('SELECT id FROM passengers WHERE pilot_id = $1 AND id = ANY($2::text[])', [pilotId, paxIds])).map(
        (r) => r.id as string,
      ),
    );
    if (own.size !== paxIds.length)
      d.crew = d.crew.map((c) => (c.passengerId && !own.has(c.passengerId) ? { ...c, passengerId: null } : c));
  }
  return d;
}

function picSnapshot(p: Pilot) {
  return {
    fullName: p.fullName,
    phone: p.phone,
    dateOfBirth: p.dateOfBirth,
    weightKg: p.weightKg,
    idNumber: p.idNumber,
    idType: p.idType,
    nationality: p.nationality,
    relation: p.relation,
  };
}

async function writeCrew(q: Queryable, pilotId: string, flightId: string, crew: FlightCrew[]) {
  await q.query('DELETE FROM flight_crew WHERE flight_id = $1 AND pilot_id = $2', [flightId, pilotId]);
  for (const [i, c] of crew.entries()) {
    await q.query(
      'INSERT INTO flight_crew (flight_id, pilot_id, position, role, passenger_id, seat, snapshot, overrides) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)',
      [
        flightId,
        pilotId,
        i,
        c.role,
        c.passengerId || null,
        c.seat,
        JSON.stringify(c.snapshot),
        JSON.stringify(c.overrides ?? []),
      ],
    );
  }
}

const docParams = (d: FlightDoc) => [
  d.title,
  d.date,
  d.blockOff,
  d.aircraftId,
  d.taxiOutMin === null ? null : Math.round(d.taxiOutMin),
  d.taxiInMin === null ? null : Math.round(d.taxiInMin),
  d.fobL,
  JSON.stringify(d.route),
  JSON.stringify(d.legOverrides),
  d.atc === null ? null : JSON.stringify(d.atc),
  JSON.stringify(d.baggageKg),
  JSON.stringify(d.options),
  JSON.stringify(d.summary),
];

async function insertFlight(
  db: Parameters<Route['handler']>[0]['db'],
  pilotId: string,
  d: FlightDoc,
  wanted?: string,
): Promise<string> {
  await checkCount(db, pilotId, 'flights');
  const now = Date.now();
  return db.transaction(async (tx) => {
    const ins = (id: string) =>
      tx.query(
        `INSERT INTO flights (id, pilot_id, title, date, block_off, aircraft_id, taxi_out_min, taxi_in_min, fob_l, route, leg_overrides, atc,
         baggage_kg, options, summary, version, created, updated, opened)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,1,$16,$16,$16)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
        [id, pilotId, ...docParams(d), now],
      );
    let rows = typeof wanted === 'string' && /^[\w-]{6,24}$/.test(wanted) ? await ins(wanted) : [];
    while (!rows.length) rows = await ins(await newId('fl', 6));
    await writeCrew(tx, pilotId, rows[0].id, d.crew);
    return rows[0].id as string;
  });
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/flights',
    async handler({ db, pilot, query }): Promise<FlightListItem[]> {
      const trash = query.get('trash') === '1';
      const rows = await db.query(
        `SELECT id, summary, route, date, aircraft_id, version, created, updated, opened, deleted FROM flights
         WHERE pilot_id = $1 AND deleted = $2 ORDER BY GREATEST(updated, opened) DESC`,
        [pilot.id, trash],
      );
      const names = (route: unknown): string[] =>
        Array.isArray(route) ? route.map((p) => (p && typeof p.name === 'string' ? p.name : '')).filter(Boolean) : [];
      return rows.map((r) => ({
        id: r.id,
        summary: { ...EMPTY_SUMMARY, ...r.summary },
        points: names(r.route),
        date: r.date,
        aircraftId: r.aircraft_id ?? null,
        version: Number(r.version),
        created: Number(r.created),
        updated: Number(r.updated),
        opened: Number(r.opened),
        deleted: !!r.deleted,
      }));
    },
  },
  {
    method: 'POST',
    path: '/flights',
    async handler({ db, pilot, body }) {
      const input = (await body()) as FlightCreateRequest;
      const today = new Date().toISOString().slice(0, 10);
      const base = emptyFlightDoc(today);
      base.taxiOutMin = pilot.settings.taxiOutMin;
      base.taxiInMin = pilot.settings.taxiInMin;
      base.aircraftId =
        pilot.defaultAircraftId && (await canUseAircraft(db, pilot.id, pilot.defaultAircraftId))
          ? pilot.defaultAircraftId
          : null;
      base.options = { ...base.options, windModel: pilot.settings.windModel };
      // the profile's map layers for new flights
      const layers = mapLayersOf(pilot.settings.mapLayers);
      if (layers) base.options.mapLayers = layers;
      // PIC in the PIC seat of the aircraft the flight starts with (front left, else its first seat),
      // the same rule as the editor's picSeat(): a hangar-built aircraft may have no 'front-left'.
      const acId = 'aircraftId' in input ? input.aircraftId : base.aircraftId;
      const seats = typeof acId === 'string' && acId ? await aircraftSeats(db, pilot.id, acId) : null;
      base.crew = [
        { role: 'PIC', passengerId: null, seat: picSeat(seats ?? FALLBACK_SEATS), snapshot: picSnapshot(pilot) },
      ];
      const home = pilot.homeAerodrome ? await findAerodrome(db, pilot.homeAerodrome) : null;
      if (home) {
        base.route = [aerodromePoint(home), aerodromePoint(home)];
      }
      const d = await checkDoc(db, pilot.id, input, base);
      // the profile's alternate (FPL item 16), unless the request gave alternates or the flight ends there
      const givenAlternates = !!input.options && typeof input.options === 'object' && 'alternates' in input.options;
      const altn =
        pilot.settings.defaultAlternate && !givenAlternates && !d.options.alternates.length
          ? await findAerodrome(db, pilot.settings.defaultAlternate)
          : null;
      const dest = d.route.length > 1 ? d.route[d.route.length - 1] : null;
      if (altn && !(dest && dest.kind === 'aerodrome' && dest.refId === altn.id))
        d.options = { ...d.options, alternates: [altn.icao || altn.id] };
      if (!('summary' in input)) {
        const [ac] = d.aircraftId
          ? await db.query('SELECT registration FROM aircraft WHERE id = $1', [d.aircraftId])
          : [];
        d.summary = {
          ...EMPTY_SUMMARY,
          title: d.title || autoTitle(d.route),
          date: d.date,
          blockOff: d.blockOff,
          aircraft: ac?.registration ?? '',
          route: d.route.map((p) => [+p.lat.toFixed(3), +p.lon.toFixed(3)] as [number, number]),
          from: d.route[0]?.name ?? '',
          to: d.route.length > 1 ? d.route[d.route.length - 1].name : '',
        };
      }
      const id = await insertFlight(db, pilot.id, d, input.id);
      return reply(201, await load(db, pilot.id, id));
    },
  },
  { method: 'GET', path: '/flights/:id', handler: async ({ db, pilot, params }) => load(db, pilot.id, params.id) },
  {
    method: 'PUT',
    path: '/flights/:id',
    async handler({ db, pilot, params, body }) {
      const cur = await load(db, pilot.id, params.id);
      const { flight, version } = (await body()) as FlightUpdateRequest;
      if (!Number.isInteger(version)) throw badRequest('version is required');
      const { id: _i, version: _v, created: _c, updated: _u, opened: _o, deleted: _d, ...base } = cur;
      const d = await checkDoc(db, pilot.id, obj(flight, 'flight'), base, cur.aircraftId);
      const now = Date.now();
      const out = await db.transaction(async (tx) => {
        const r = await tx.query(
          `UPDATE flights SET title=$3, date=$4, block_off=$5, aircraft_id=$6, taxi_out_min=$7, taxi_in_min=$8, fob_l=$9, route=$10::jsonb,
             leg_overrides=$11::jsonb, atc=$12::jsonb, baggage_kg=$13::jsonb, options=$14::jsonb, summary=$15::jsonb,
             version = version + 1, updated = $16
           WHERE id = $1 AND pilot_id = $2 AND version = $17 RETURNING version, updated`,
          [params.id, pilot.id, ...docParams(d), now, version],
        );
        if (r.length) await writeCrew(tx, pilot.id, params.id, d.crew);
        return r;
      });
      if (!out.length) throw new HttpError(409, 'edited elsewhere', await load(db, pilot.id, params.id));
      return { version: Number(out[0].version), updated: Number(out[0].updated) };
    },
  },
  {
    method: 'DELETE',
    path: '/flights/:id',
    async handler({ db, pilot, params }) {
      const r = await db.query('UPDATE flights SET deleted = TRUE WHERE id = $1 AND pilot_id = $2 RETURNING id', [
        params.id,
        pilot.id,
      ]);
      if (!r.length) throw notFound('no such flight');
      return undefined;
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/restore',
    async handler({ db, pilot, params }) {
      const r = await db.query('UPDATE flights SET deleted = FALSE WHERE id = $1 AND pilot_id = $2 RETURNING id', [
        params.id,
        pilot.id,
      ]);
      if (!r.length) throw notFound('no such flight');
      return load(db, pilot.id, params.id);
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/opened',
    async handler({ db, pilot, params }) {
      const r = await db.query('UPDATE flights SET opened = $3 WHERE id = $1 AND pilot_id = $2 RETURNING id', [
        params.id,
        pilot.id,
        Date.now(),
      ]);
      if (!r.length) throw notFound('no such flight');
      return undefined;
    },
  },
  {
    method: 'POST',
    path: '/flights/:id/copy',
    async handler({ db, pilot, params, body }) {
      const cur = await load(db, pilot.id, params.id);
      const { title } = await body();
      const { id: _i, version: _v, created: _c, updated: _u, opened: _o, deleted: _d, ...doc } = cur;
      const name =
        typeof title === 'string' && title.trim()
          ? title.trim()
          : `Copy of ${cur.title || cur.summary.title || 'flight'}`;
      const d: FlightDoc = { ...doc, title: name, summary: { ...doc.summary, title: name } };
      const id = await insertFlight(db, pilot.id, d);
      return reply(201, await load(db, pilot.id, id));
    },
  },
];
