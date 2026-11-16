// Passenger list CRUD: /passengers, /passengers/:id. Scoped to the session pilot.
// Deleting a passenger keeps the flights' manifest snapshots (passengerId becomes null), and their
// Form 731 signatures and signing links, which are keyed by the passenger id, move to the key the
// forms use for a passenger without a record ('seat:<seat>', src/shared/forms.ts crewKey).
import type { Route } from '../http.js';
import { newId, notFound, reply } from '../http.js';
import { checkCount } from '../limits.js';
import { passengerInput, toPassenger } from '../rows.js';
import { EMPTY_PERSON } from '../../../src/shared/constants.js';
import type { PassengerInput, Pilot } from '../../../src/shared/types.js';
import type { Queryable } from '../db.js';
import { form731Hash, personHash } from './forms.js';

async function get(db: Queryable, pilotId: string, id: string) {
  const [r] = await db.query('SELECT * FROM passengers WHERE id = $1 AND pilot_id = $2', [id, pilotId]);
  if (!r) throw notFound('no such passenger');
  return toPassenger(r);
}
/**
 * Deletes a passenger. First, on each of the pilot's flights that has them on the manifest, their
 * Form 731 signature and signing link are re-keyed from the passenger id to 'seat:<seat>', the key the
 * forms give them once the manifest entry has no passenger id, so a signature already given and a
 * link already sent keep working. A link is bound to its holder (personHash): a seat-keyed holder is
 * their name and ID number as on the form, from the manifest snapshot.
 */
async function deleteKeepingForms(q: Queryable, pilot: Pilot, passengerId: string) {
  const pilotId = pilot.id;
  const rows = await q.query('SELECT flight_id, seat, snapshot FROM flight_crew WHERE pilot_id = $1 AND passenger_id = $2', [pilotId, passengerId]);
  const before = new Map<string, string>();
  for (const r of rows) before.set(r.flight_id, await form731Hash(q, pilot, r.flight_id));
  for (const r of rows) {
    const key = `seat:${r.seat}`;
    const s = r.snapshot ?? {};
    const hash = personHash({ key, name: String(s.fullName ?? '').trim(), idPassport: String(s.idNumber ?? '').trim() });
    // a seat-keyed row left by whoever sat there before is not this person's
    await q.query('DELETE FROM form_signatures WHERE flight_id = $1 AND pilot_id = $2 AND person_key = $3', [r.flight_id, pilotId, key]);
    await q.query('UPDATE form_signatures SET person_key = $4 WHERE flight_id = $1 AND pilot_id = $2 AND person_key = $3', [r.flight_id, pilotId, passengerId, key]);
    await q.query('UPDATE form_links SET revoked = TRUE WHERE flight_id = $1 AND pilot_id = $2 AND person_key = $3', [r.flight_id, pilotId, key]);
    await q.query('UPDATE form_links SET person_key = $4, person_hash = $5 WHERE flight_id = $1 AND pilot_id = $2 AND person_key = $3',
      [r.flight_id, pilotId, passengerId, key, hash]);
  }
  const del = await q.query('DELETE FROM passengers WHERE id = $1 AND pilot_id = $2 RETURNING id', [passengerId, pilotId]);
  if (!del.length) throw notFound('no such passenger');
  // The form's text names each person by key, so re-keying alone makes a new version: signatures of
  // the version before the deletion still count when nothing else on the form changed.
  for (const [flightId, old] of before) {
    const now = await form731Hash(q, pilot, flightId);
    if (now !== old) await q.query('UPDATE form_signatures SET text_hash = $4 WHERE flight_id = $1 AND pilot_id = $2 AND text_hash = $3', [flightId, pilotId, old, now]);
  }
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
      await checkCount(db, pilot.id, 'passengers');
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
      if (!r) throw notFound('no such passenger'); // deleted meanwhile
      return toPassenger(r);
    },
  },
  {
    method: 'DELETE', path: '/passengers/:id',
    async handler({ db, pilot, params }) {
      await db.transaction((tx) => deleteKeepingForms(tx, pilot, params.id));
      return undefined;
    },
  },
];
