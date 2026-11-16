// Hangar CRUD: /aircraft, /aircraft/:id. The session pilot's own aircraft and those shared with them
// (access.ts): viewers read, editors also write, only the owner deletes. Writes keep the owner's pilot_id.
import type { Route } from '../http.js';
import { HttpError, newId, notFound, reply } from '../http.js';
import { aircraftInput, toAircraft } from '../rows.js';
import { aircraftFor, listAircraft, toHangarAircraft } from '../access.js';
import { blankAircraft } from '../../../src/shared/templates.js';
import type { AircraftInput } from '../../../src/shared/types.js';
import type { Queryable } from '../db.js';
import { isUniqueViolation } from '../pgErrors.js';
import { checkCount } from '../limits.js';
import { checkReports, deleteAttachments } from './attachments.js';
import { operatorFor } from '../operators.js';

async function write(db: Queryable, pilotId: string, id: string, a: AircraftInput, insert: boolean) {
  const now = Date.now();
  const vals = [id, pilotId, a.registration, a.makeModel, a.icaoType, a.wake, a.serial, a.operator, a.homeBase, a.colours,
    a.cruiseTasKt, a.patternTasKt, a.climbTasKt, JSON.stringify(a.fuel), JSON.stringify(a.massBalance), JSON.stringify(a.performance),
    JSON.stringify(a.equipment), JSON.stringify(a.compassCards), a.notes, now, a.operatorId];
  try {
    const rows = insert
      ? await db.query(`INSERT INTO aircraft (id, pilot_id, registration, make_model, icao_type, wake, serial, operator, home_base, colours,
          cruise_tas_kt, pattern_tas_kt, climb_tas_kt, fuel, mass_balance, performance, equipment, compass_cards, notes, created, updated, operator_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$20,$21) RETURNING *`, vals)
      : await db.query(`UPDATE aircraft SET registration=$3, make_model=$4, icao_type=$5, wake=$6, serial=$7, operator=$8, home_base=$9, colours=$10,
          cruise_tas_kt=$11, pattern_tas_kt=$12, climb_tas_kt=$13, fuel=$14::jsonb, mass_balance=$15::jsonb, performance=$16::jsonb,
          equipment=$17::jsonb, compass_cards=$18::jsonb, notes=$19, updated=$20, operator_id=$21 WHERE id=$1 AND pilot_id=$2 RETURNING *`, vals);
    if (!rows.length) throw notFound('no such aircraft');
    return toAircraft(rows[0]);
  } catch (e) {
    // the only unique key a write can break is (pilot_id, registration)
    if (isUniqueViolation(e)) throw new HttpError(409, `${a.registration} is already in the hangar`);
    throw e;
  }
}

/**
 * Checks the aircraft's operator: assigning one needs edit access to it (assigning shares it, as a
 * viewer, with everyone who has the aircraft); keeping the current one needs nothing. The free-text
 * operator becomes the operator's name, so it stays a sensible fallback.
 */
async function checkOperator(db: Queryable, pilotId: string, a: AircraftInput, current: string | null): Promise<void> {
  if (!a.operatorId) { a.operatorId = null; return; }
  const op = a.operatorId === current ? await operatorFor(db, pilotId, a.operatorId).catch(() => null) : await operatorFor(db, pilotId, a.operatorId, 'edit');
  if (op) a.operator = op.name;
}

export const routes: Route[] = [
  { method: 'GET', path: '/aircraft', handler: async ({ db, pilot }) => listAircraft(db, pilot.id) },
  {
    method: 'POST', path: '/aircraft',
    async handler({ db, pilot, body }) {
      const a = aircraftInput(await body(), blankAircraft());
      // a new aircraft has no files yet: references copied from another aircraft are dropped
      a.compassCards = a.compassCards.map(({ report: _r, ...c }) => c);
      await checkOperator(db, pilot.id, a, null);
      await checkCount(db, pilot.id, 'aircraft');
      const created = await write(db, pilot.id, await newId('ac'), a, true);
      // A pilot without a default aircraft (an empty hangar, or the default was deleted) gets this one,
      // so new flights open with an aircraft. An existing default is never replaced.
      await db.query('UPDATE pilots SET default_aircraft_id = $1 WHERE id = $2 AND default_aircraft_id IS NULL', [created.id, pilot.id]);
      return reply(201, toHangarAircraft(await aircraftFor(db, pilot.id, created.id)));
    },
  },
  { method: 'GET', path: '/aircraft/:id', handler: async ({ db, pilot, params }) => toHangarAircraft(await aircraftFor(db, pilot.id, params.id)) },
  {
    method: 'PUT', path: '/aircraft/:id',
    async handler({ db, pilot, params, body }) {
      const row = await aircraftFor(db, pilot.id, params.id, 'edit');
      const ownerId: string = row.pilot_id;
      const { id: _i, created: _c, updated: _u, ...cur } = toAircraft(row);
      const a = aircraftInput(await body(), cur);
      await checkOperator(db, pilot.id, a, cur.operatorId);
      const { cards, unused } = await checkReports(db, ownerId, params.id, a.compassCards);
      a.compassCards = cards;
      await write(db, ownerId, params.id, a, false);
      // swing reports no card refers to any more (replaced, removed, or uploaded and never saved)
      await deleteAttachments(db, ownerId, unused);
      return toHangarAircraft(await aircraftFor(db, pilot.id, params.id));
    },
  },
  {
    method: 'DELETE', path: '/aircraft/:id',
    async handler({ db, pilot, params }) {
      await aircraftFor(db, pilot.id, params.id, 'owner');
      const r = await db.query('DELETE FROM aircraft WHERE id = $1 AND pilot_id = $2 RETURNING id', [params.id, pilot.id]);
      if (!r.length) throw notFound('no such aircraft');
      return undefined;
    },
  },
];
