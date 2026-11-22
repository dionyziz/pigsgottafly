// Sharing an aircraft with other pilots: /aircraft/:id/shares[/:key] (src/shared/sharing.ts).
// Anyone with access sees who else has it; the owner and editors add people by e-mail, change their
// role and remove them; anyone can remove their own access. The owner is not a share row and cannot
// be changed or removed here. A new share e-mails the person (shareMail.ts). An address no account
// uses is invited to the app with this aircraft (invitations.ts): the open invitations sharing it are
// listed as pending, keyed by the address, and removing one cancels this aircraft only.
import type { AircraftRole, AircraftSharing, ShareRole } from '../../../src/shared/sharing.js';
import { aircraftFor, personName } from '../access.js';
import type { Queryable, Row } from '../db.js';
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, notFound, reply } from '../http.js';
import { rateLimit } from '../rateLimit.js';
import { notifyShare } from '../shareMail.js';
import { accountFor, inviteeEmail, noAccount, openInvitation, sendInvitation } from './invitations.js';

function shareRole(v: unknown): ShareRole {
  if (v !== 'view' && v !== 'edit') throw badRequest("role must be 'view' or 'edit'");
  return v;
}

const isAddress = (key: string) => key.includes('@');

/** The open invitations to `email` that share the aircraft (any inviter). */
const PENDING = `SELECT id FROM pilot_invitations WHERE email = $2 AND accepted_at IS NULL`;

async function sharing(db: Queryable, ac: Row): Promise<AircraftSharing> {
  const [owner] = await db.query('SELECT id, email, full_name, name FROM pilots WHERE id = $1', [ac.pilot_id]);
  const rows = await db.query(
    `SELECT s.pilot_id, s.role, s.created, p.email, p.full_name, p.name FROM aircraft_shares s JOIN pilots p ON p.id = s.pilot_id
     WHERE s.aircraft_id = $1 ORDER BY lower(COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), p.email)), s.created`,
    [ac.id],
  );
  // one row per address, though several pilots may have invited it with this aircraft
  const invites = await db.query(
    `SELECT DISTINCT ON (i.email) i.email, ia.role, ia.created FROM pilot_invitation_aircraft ia
     JOIN pilot_invitations i ON i.id = ia.invitation_id
     WHERE ia.aircraft_id = $1 AND i.accepted_at IS NULL
     ORDER BY i.email, (ia.role = 'edit') DESC, ia.created`,
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
      ...invites.map((r: Row) => ({
        pilotId: r.email as string,
        name: '',
        email: r.email as string,
        role: r.role as ShareRole,
        added: Number(r.created),
        pending: true,
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
    async handler({ db, pilot, params, body, req, config }) {
      const ac = await aircraftFor(db, pilot.id, params.id, 'edit');
      await rateLimit(db, 'share', { pilotId: pilot.id });
      const input = await body();
      const role = shareRole(input.role);
      const email = inviteeEmail(input.email);
      const p = await accountFor(db, email);
      if (p?.id === pilot.id || email.toLowerCase() === (pilot.email ?? '').toLowerCase())
        throw badRequest('You cannot share an aircraft with yourself.');
      if (!p && !config.googleClientId) throw notFound(noAccount(email));
      if (!p) {
        const inv = await openInvitation(db, pilot.id, email, '', [{ id: ac.id, role }]);
        if (!inv.added.length) throw conflict(`${email} is already invited with this aircraft.`);
        await sendInvitation(db, { req, config, pilot }, inv.id, email);
        return reply(201, await sharing(db, ac));
      }
      if (p.id === ac.pilot_id) throw badRequest(`${email} owns this aircraft.`);
      const ins = await db.query(
        `INSERT INTO aircraft_shares (aircraft_id, pilot_id, role, created, created_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (aircraft_id, pilot_id) DO NOTHING RETURNING pilot_id`,
        [ac.id, p.id, role, Date.now(), pilot.id],
      );
      if (!ins.length) throw conflict(`${email} already has access to this aircraft.`);
      await notifyShare(
        db,
        { req, config, pilot },
        {
          kind: 'aircraft',
          id: ac.id,
          name: ac.registration,
          detail: [ac.make_model, ac.icao_type].filter(Boolean).join(', '),
          role,
          to: p.email || email,
        },
      );
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
      const r = isAddress(params.pilotId)
        ? await db.query(
            `UPDATE pilot_invitation_aircraft SET role = $3 WHERE aircraft_id = $1 AND invitation_id IN (${PENDING}) RETURNING aircraft_id`,
            [ac.id, params.pilotId.toLowerCase(), role],
          )
        : await db.query(
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
      if (isAddress(params.pilotId)) {
        const r = await db.query(
          `DELETE FROM pilot_invitation_aircraft WHERE aircraft_id = $1 AND invitation_id IN (${PENDING}) RETURNING aircraft_id`,
          [ac.id, params.pilotId.toLowerCase()],
        );
        if (!r.length) throw notFound('this address is not invited with the aircraft');
        return undefined;
      }
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
