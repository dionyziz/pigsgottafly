// Passenger list CRUD: /passengers, /passengers/:id. Scoped to the session pilot.
// Deleting a passenger keeps the flights' manifest snapshots (passengerId becomes null).
import type { Route } from '../http.js';
import { newId, notFound, reply } from '../http.js';
import { passengerInput, toPassenger } from '../rows.js';
import { EMPTY_PERSON } from '../../../src/shared/constants.js';
import type { PassengerInput } from '../../../src/shared/types.js';
import type { Queryable } from '../db.js';

async function get(db: Queryable, pilotId: string, id: string) {
  const [r] = await db.query('SELECT * FROM passengers WHERE id = $1 AND pilot_id = $2', [id, pilotId]);
  if (!r) throw notFound('no such passenger');
  return toPassenger(r);
}
const cols = (p: PassengerInput) => [p.fullName, p.phone, p.dateOfBirth, p.weightKg, p.idNumber, p.idType, p.nationality, p.relation, p.notes];

export const routes: Route[] = [
  {
    method: 'GET', path: '/passengers',
    handler: async ({ db, pilot }) => (await db.query('SELECT * FROM passengers WHERE pilot_id = $1 ORDER BY lower(full_name)', [pilot.id])).map(toPassenger),
  },
  {
    method: 'POST', path: '/passengers',
    async handler({ db, pilot, body }) {
      const p = passengerInput(await body(), { ...EMPTY_PERSON, notes: '' });
      const now = Date.now();
      const [r] = await db.query(
        `INSERT INTO passengers (id, pilot_id, full_name, phone, date_of_birth, weight_kg, id_number, id_type, nationality, relation, notes, created, updated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
        [await newId('ps'), pilot.id, ...cols(p), now],
      );
      return reply(201, toPassenger(r));
    },
  },
  { method: 'GET', path: '/passengers/:id', handler: async ({ db, pilot, params }) => get(db, pilot.id, params.id) },
  {
    method: 'PUT', path: '/passengers/:id',
    async handler({ db, pilot, params, body }) {
      const { id: _i, created: _c, updated: _u, ...cur } = await get(db, pilot.id, params.id);
      const p = passengerInput(await body(), cur);
      const [r] = await db.query(
        `UPDATE passengers SET full_name=$3, phone=$4, date_of_birth=$5, weight_kg=$6, id_number=$7, id_type=$8, nationality=$9, relation=$10, notes=$11, updated=$12
         WHERE id=$1 AND pilot_id=$2 RETURNING *`,
        [params.id, pilot.id, ...cols(p), Date.now()],
      );
      return toPassenger(r);
    },
  },
  {
    method: 'DELETE', path: '/passengers/:id',
    async handler({ db, pilot, params }) {
      const r = await db.query('DELETE FROM passengers WHERE id = $1 AND pilot_id = $2 RETURNING id', [params.id, pilot.id]);
      if (!r.length) throw notFound('no such passenger');
      return undefined;
    },
  },
];
