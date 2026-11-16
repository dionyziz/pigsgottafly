// Saved custom waypoints CRUD: /waypoints, /waypoints/:id. Scoped to the session pilot.
import type { Route } from '../http.js';
import { newId, notFound, reply } from '../http.js';
import { toWaypoint, waypointInput } from '../rows.js';
import { checkCount } from '../limits.js';
import type { Queryable } from '../db.js';

async function get(db: Queryable, pilotId: string, id: string) {
  const [r] = await db.query('SELECT * FROM waypoints WHERE id = $1 AND pilot_id = $2', [id, pilotId]);
  if (!r) throw notFound('no such waypoint');
  return toWaypoint(r);
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/waypoints',
    handler: async ({ db, pilot }) =>
      (await db.query('SELECT * FROM waypoints WHERE pilot_id = $1 ORDER BY name', [pilot.id])).map(toWaypoint),
  },
  {
    method: 'POST',
    path: '/waypoints',
    async handler({ db, pilot, body }) {
      const w = waypointInput(await body(), { name: '', lat: NaN, lon: NaN, notes: '' });
      await checkCount(db, pilot.id, 'waypoints');
      const now = Date.now();
      const [r] = await db.query(
        'INSERT INTO waypoints (id, pilot_id, name, lat, lon, notes, created, updated) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *',
        [await newId('wp'), pilot.id, w.name, w.lat, w.lon, w.notes, now],
      );
      return reply(201, toWaypoint(r));
    },
  },
  { method: 'GET', path: '/waypoints/:id', handler: async ({ db, pilot, params }) => get(db, pilot.id, params.id) },
  {
    method: 'PUT',
    path: '/waypoints/:id',
    async handler({ db, pilot, params, body }) {
      const { id: _i, created: _c, updated: _u, ...cur } = await get(db, pilot.id, params.id);
      const w = waypointInput(await body(), cur);
      const [r] = await db.query(
        'UPDATE waypoints SET name=$3, lat=$4, lon=$5, notes=$6, updated=$7 WHERE id=$1 AND pilot_id=$2 RETURNING *',
        [params.id, pilot.id, w.name, w.lat, w.lon, w.notes, Date.now()],
      );
      if (!r) throw notFound('no such waypoint'); // deleted meanwhile
      return toWaypoint(r);
    },
  },
  {
    method: 'DELETE',
    path: '/waypoints/:id',
    async handler({ db, pilot, params }) {
      const r = await db.query('DELETE FROM waypoints WHERE id = $1 AND pilot_id = $2 RETURNING id', [
        params.id,
        pilot.id,
      ]);
      if (!r.length) throw notFound('no such waypoint');
      return undefined;
    },
  },
];
