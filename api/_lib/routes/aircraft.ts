// Hangar CRUD: /aircraft, /aircraft/:id. Scoped to the session pilot.
import type { Route } from '../http.js';
import { HttpError, newId, notFound, reply } from '../http.js';
import { aircraftInput, toAircraft } from '../rows.js';
import { blankAircraft } from '../../../src/shared/templates.js';
import type { AircraftInput } from '../../../src/shared/types.js';
import type { Queryable } from '../db.js';

async function get(db: Queryable, pilotId: string, id: string) {
  const [r] = await db.query('SELECT * FROM aircraft WHERE id = $1 AND pilot_id = $2', [id, pilotId]);
  if (!r) throw notFound('no such aircraft');
  return toAircraft(r);
}

async function write(db: Queryable, pilotId: string, id: string, a: AircraftInput, insert: boolean) {
  const now = Date.now();
  const vals = [id, pilotId, a.registration, a.makeModel, a.icaoType, a.wake, a.serial, a.operator, a.homeBase, a.colours,
    a.cruiseTasKt, a.patternTasKt, a.climbTasKt, JSON.stringify(a.fuel), JSON.stringify(a.massBalance), JSON.stringify(a.performance),
    JSON.stringify(a.equipment), JSON.stringify(a.compassCards), a.notes, now];
  try {
    const rows = insert
      ? await db.query(`INSERT INTO aircraft (id, pilot_id, registration, make_model, icao_type, wake, serial, operator, home_base, colours,
          cruise_tas_kt, pattern_tas_kt, climb_tas_kt, fuel, mass_balance, performance, equipment, compass_cards, notes, created, updated)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$20) RETURNING *`, vals)
      : await db.query(`UPDATE aircraft SET registration=$3, make_model=$4, icao_type=$5, wake=$6, serial=$7, operator=$8, home_base=$9, colours=$10,
          cruise_tas_kt=$11, pattern_tas_kt=$12, climb_tas_kt=$13, fuel=$14::jsonb, mass_balance=$15::jsonb, performance=$16::jsonb,
          equipment=$17::jsonb, compass_cards=$18::jsonb, notes=$19, updated=$20 WHERE id=$1 AND pilot_id=$2 RETURNING *`, vals);
    if (!rows.length) throw notFound('no such aircraft');
    return toAircraft(rows[0]);
  } catch (e: any) {
    if (/aircraft_pilot_id_registration_key|duplicate key/.test(String(e?.message))) throw new HttpError(409, `${a.registration} is already in the hangar`);
    throw e;
  }
}

export const routes: Route[] = [
  {
    method: 'GET', path: '/aircraft',
    handler: async ({ db, pilot }) => (await db.query('SELECT * FROM aircraft WHERE pilot_id = $1 ORDER BY registration', [pilot.id])).map(toAircraft),
  },
  {
    method: 'POST', path: '/aircraft',
    async handler({ db, pilot, body }) {
      const a = aircraftInput(await body(), blankAircraft());
      return reply(201, await write(db, pilot.id, await newId('ac'), a, true));
    },
  },
  { method: 'GET', path: '/aircraft/:id', handler: async ({ db, pilot, params }) => get(db, pilot.id, params.id) },
  {
    method: 'PUT', path: '/aircraft/:id',
    async handler({ db, pilot, params, body }) {
      const { id: _i, created: _c, updated: _u, ...cur } = await get(db, pilot.id, params.id);
      return write(db, pilot.id, params.id, aircraftInput(await body(), cur), false);
    },
  },
  {
    method: 'DELETE', path: '/aircraft/:id',
    async handler({ db, pilot, params }) {
      const r = await db.query('DELETE FROM aircraft WHERE id = $1 AND pilot_id = $2 RETURNING id', [params.id, pilot.id]);
      if (!r.length) throw notFound('no such aircraft');
      return undefined;
    },
  },
];
