// Sharing an aircraft with other pilots: /aircraft/:id/shares[/:pilotId] (src/shared/sharing.ts).
// Anyone with access sees who else has it; the owner and editors add people by the e-mail of their
// account, change their role and remove them; anyone can remove their own access. The owner is not
// a share row and cannot be changed or removed here.
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, notFound, reply } from '../http.js';
import type { Queryable } from '../db.js';
import { rateLimit } from '../rateLimit.js';
import { aircraftFor, personName } from '../access.js';
import type { AircraftRole, AircraftSharing, ShareRole } from '../../../src/shared/sharing.js';

type Row = Record<string, any>;

function shareRole(v: unknown): ShareRole {
  if (v !== 'view' && v !== 'edit') throw badRequest("role must be 'view' or 'edit'");
  return v;
}

async function sharing(db: Queryable, ac: Row): Promise<AircraftSharing> {
  const [owner] = await db.query('SELECT id, email, full_name, name FROM pilots WHERE id = $1', [ac.pilot_id]);
  const rows = await db.query(
    `SELECT s.pilot_id, s.role, s.created, p.email, p.full_name, p.name FROM aircraft_shares s JOIN pilots p ON p.id = s.pilot_id
     WHERE s.aircraft_id = $1 ORDER BY lower(COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), p.email)), s.created`,
    [ac.id],
  );
  const role = ac.access_role as AircraftRole;
  return {
    aircraftId: ac.id,
    registration: ac.registration,
    role,
    canManage: role !== 'view',
    people: [
      {
        pilotId: owner.id,
        name: personName(owner.full_name, owner.name),
        email: owner.email ?? '',
        role: 'owner',
        added: null,
      },
      ...rows.map((r: Row) => ({
        pilotId: r.pilot_id,
        name: personName(r.full_name, r.name),
        email: r.email ?? '',
        role: r.role as ShareRole,
        added: Number(r.created),
      })),
    ],
  };
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/aircraft/:id/shares',
    handler: async ({ db, pilot, params }) => sharing(db, await aircraftFor(db, pilot.id, params.id)),
  },
  {
    method: 'POST',
    path: '/aircraft/:id/shares',
    async handler({ db, pilot, params, body }) {
      const ac = await aircraftFor(db, pilot.id, params.id, 'edit');
      await rateLimit(db, 'share', { pilotId: pilot.id });
      const input = await body();
      const role = shareRole(input.role);
      const email = typeof input.email === 'string' ? input.email.trim() : '';
      if (!email) throw badRequest('email is required');
      if (email.length > 320) throw badRequest('email is too long');
      // the account that signed in most recently with this address (an address is normally one account)
      const [p] = await db.query(
        'SELECT id FROM pilots WHERE lower(email) = lower($1) ORDER BY last_login DESC LIMIT 1',
        [email],
      );
      if (!p)
        throw notFound(
          `No Pig’s Gotta Fly account uses ${email}. They need to sign in once before you can share with them.`,
        );
      if (p.id === pilot.id) throw badRequest('You cannot share an aircraft with yourself.');
      if (p.id === ac.pilot_id) throw badRequest(`${email} owns this aircraft.`);
      const ins = await db.query(
        `INSERT INTO aircraft_shares (aircraft_id, pilot_id, role, created, created_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (aircraft_id, pilot_id) DO NOTHING RETURNING pilot_id`,
        [ac.id, p.id, role, Date.now(), pilot.id],
      );
      if (!ins.length) throw conflict(`${email} already has access to this aircraft.`);
      return reply(201, await sharing(db, ac));
    },
  },
  {
    method: 'PUT',
    path: '/aircraft/:id/shares/:pilotId',
    async handler({ db, pilot, params, body }) {
      const ac = await aircraftFor(db, pilot.id, params.id, 'edit');
      const role = shareRole((await body()).role);
      if (params.pilotId === ac.pilot_id) throw badRequest('The owner’s access cannot change.');
      const r = await db.query(
        'UPDATE aircraft_shares SET role = $3 WHERE aircraft_id = $1 AND pilot_id = $2 RETURNING pilot_id',
        [ac.id, params.pilotId, role],
      );
      if (!r.length) throw notFound('this person has no access to the aircraft');
      // an editor who made themselves a viewer still sees the list
      return sharing(db, await aircraftFor(db, pilot.id, params.id));
    },
  },
  {
    method: 'DELETE',
    path: '/aircraft/:id/shares/:pilotId',
    async handler({ db, pilot, params }) {
      const ac = await aircraftFor(db, pilot.id, params.id);
      const self = params.pilotId === pilot.id;
      if (params.pilotId === ac.pilot_id)
        throw badRequest(self ? 'You own this aircraft: delete it instead.' : 'The owner cannot be removed.');
      if (!self && ac.access_role === 'view') throw new HttpError(403, 'viewers cannot change the sharing');
      const r = await db.query(
        'DELETE FROM aircraft_shares WHERE aircraft_id = $1 AND pilot_id = $2 RETURNING pilot_id',
        [ac.id, params.pilotId],
      );
      if (!r.length) throw notFound('this person has no access to the aircraft');
      // Their flights keep the aircraft (shown as unavailable); a default they can no longer use is cleared.
      await db.query('UPDATE pilots SET default_aircraft_id = NULL WHERE id = $1 AND default_aircraft_id = $2', [
        params.pilotId,
        ac.id,
      ]);
      return undefined;
    },
  },
];
