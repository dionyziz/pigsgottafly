// Sharing a flight: /flights/:id/shares[/:key] (src/shared/sharing.ts), like an aircraft's
// (shares.ts) but also with people who have no account yet. Anyone with access sees who else has it;
// the owner and editors add people by e-mail, change their role and remove them; anyone can remove
// their own access. An address an account uses (case-insensitive) gets a share at once; any other
// address gets an invite (flight_invites), which becomes a share when someone signs in with that
// verified address (claimInvites, called by every sign-in). Either way the person is e-mailed
// (shareMail.ts). The owner is not a share row and cannot be changed or removed here.
import { isEmail } from '../../../src/shared/operators.js';
import type { FlightSharing, ShareRole } from '../../../src/shared/sharing.js';
import { flightFor, type FlightGrant, personName } from '../access.js';
import type { Queryable, Row } from '../db.js';
import type { Route } from '../http.js';
import { badRequest, conflict, HttpError, notFound, reply } from '../http.js';
import { rateLimit } from '../rateLimit.js';
import { notifyShare } from '../shareMail.js';

function shareRole(v: unknown): ShareRole {
  if (v !== 'view' && v !== 'edit') throw badRequest("role must be 'view' or 'edit'");
  return v;
}

const isAddress = (key: string) => key.includes('@');

async function sharing(db: Queryable, g: FlightGrant): Promise<FlightSharing> {
  const [f] = await db.query('SELECT title, summary FROM flights WHERE id = $1', [g.id]);
  const rows = await db.query(
    `SELECT s.pilot_id, s.role, s.created, p.email, p.full_name, p.name FROM flight_shares s JOIN pilots p ON p.id = s.pilot_id
     WHERE s.flight_id = $1 ORDER BY lower(COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), p.email)), s.created`,
    [g.id],
  );
  const invites = await db.query(
    'SELECT email, role, created FROM flight_invites WHERE flight_id = $1 ORDER BY email',
    [g.id],
  );
  return {
    flightId: g.id,
    title: String(f?.title || f?.summary?.title || ''),
    role: g.role,
    canManage: g.role !== 'view',
    people: [
      {
        pilotId: g.owner.id,
        name: personName(g.owner.fullName, g.owner.name),
        email: g.owner.email ?? '',
        role: 'owner',
        added: null,
      },
      ...rows.map((r: Row) => ({
        pilotId: r.pilot_id as string,
        name: personName(r.full_name, r.name),
        email: (r.email ?? '') as string,
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

/**
 * Turns every invite to `email` (a verified address the pilot just signed in with) into a share of
 * that pilot and deletes the invites. Exact address match (case-insensitive): an Apple Hide My Email
 * relay address claims only invites sent to that relay address. A flight the pilot owns or already
 * has keeps its access (the higher role wins).
 */
export async function claimInvites(db: Queryable, pilotId: string, email: string): Promise<number> {
  const addr = email.trim().toLowerCase();
  if (!addr) return 0;
  const claimed = await db.query(
    `DELETE FROM flight_invites WHERE email = $1 RETURNING flight_id, role, created, created_by`,
    [addr],
  );
  for (const r of claimed) {
    await db.query(
      `INSERT INTO flight_shares (flight_id, pilot_id, role, created, created_by)
       SELECT $1, $2, $3, $4, $5 FROM flights f WHERE f.id = $1 AND f.pilot_id <> $2
       ON CONFLICT (flight_id, pilot_id) DO UPDATE SET role = CASE WHEN flight_shares.role = 'edit' THEN 'edit' ELSE EXCLUDED.role END`,
      [r.flight_id, pilotId, r.role, Number(r.created), r.created_by],
    );
  }
  return claimed.length;
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/flights/:id/shares',
    handler: async ({ db, pilot, params }) => sharing(db, await flightFor(db, pilot, params.id)),
  },
  {
    method: 'POST',
    path: '/flights/:id/shares',
    async handler({ db, pilot, params, body, req, config }) {
      const g = await flightFor(db, pilot, params.id, 'edit');
      await rateLimit(db, 'share', { pilotId: pilot.id });
      const input = await body();
      const role = shareRole(input.role);
      const email = typeof input.email === 'string' ? input.email.trim() : '';
      if (!email) throw badRequest('email is required');
      if (email.length > 320) throw badRequest('email is too long');
      if (!isEmail(email)) throw badRequest(`${email} is not an e-mail address`);
      // the account that signed in most recently with this address (an address is normally one account)
      const [p] = await db.query(
        'SELECT id, email FROM pilots WHERE lower(email) = lower($1) ORDER BY last_login DESC LIMIT 1',
        [email],
      );
      if (p?.id === pilot.id || email.toLowerCase() === (pilot.email ?? '').toLowerCase())
        throw badRequest('You cannot share a flight with yourself.');
      if (p?.id === g.owner.id || email.toLowerCase() === (g.owner.email ?? '').toLowerCase())
        throw badRequest(`${email} owns this flight.`);
      const now = Date.now();
      const ins = p
        ? await db.query(
            `INSERT INTO flight_shares (flight_id, pilot_id, role, created, created_by) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (flight_id, pilot_id) DO NOTHING RETURNING pilot_id`,
            [g.id, p.id, role, now, pilot.id],
          )
        : await db.query(
            `INSERT INTO flight_invites (flight_id, email, role, created, created_by) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (flight_id, email) DO NOTHING RETURNING email`,
            [g.id, email.toLowerCase(), role, now, pilot.id],
          );
      if (!ins.length)
        throw conflict(
          p ? `${email} already has access to this flight.` : `${email} is already invited to this flight.`,
        );
      const [f] = await db.query('SELECT title, date, summary FROM flights WHERE id = $1', [g.id]);
      const s = f?.summary ?? {};
      const route = [s.from, s.to].filter(Boolean).join(' → ');
      await notifyShare(
        db,
        { req, config, pilot },
        {
          kind: 'flight',
          id: g.id,
          name: String(f?.title || s.title || 'a flight'),
          detail: [route, f?.date, s.aircraft].filter(Boolean).join(', '),
          role,
          to: p?.email || email,
          invite: !p,
        },
      );
      return reply(201, await sharing(db, g));
    },
  },
  {
    method: 'PUT',
    path: '/flights/:id/shares/:key',
    async handler({ db, pilot, params, body }) {
      const g = await flightFor(db, pilot, params.id, 'edit');
      const role = shareRole((await body()).role);
      if (params.key === g.owner.id) throw badRequest('The owner’s access cannot change.');
      const r = isAddress(params.key)
        ? await db.query('UPDATE flight_invites SET role = $3 WHERE flight_id = $1 AND email = $2 RETURNING email', [
            g.id,
            params.key.toLowerCase(),
            role,
          ])
        : await db.query(
            'UPDATE flight_shares SET role = $3 WHERE flight_id = $1 AND pilot_id = $2 RETURNING pilot_id',
            [g.id, params.key, role],
          );
      if (!r.length) throw notFound('this person has no access to the flight');
      // an editor who made themselves a viewer still sees the list
      return sharing(db, await flightFor(db, pilot, params.id));
    },
  },
  {
    method: 'DELETE',
    path: '/flights/:id/shares/:key',
    async handler({ db, pilot, params }) {
      const g = await flightFor(db, pilot, params.id);
      const self = params.key === pilot.id;
      if (params.key === g.owner.id)
        throw badRequest(self ? 'You own this flight: move it to the trash instead.' : 'The owner cannot be removed.');
      if (!self && g.role === 'view') throw new HttpError(403, 'viewers cannot change the sharing');
      const r = isAddress(params.key)
        ? await db.query('DELETE FROM flight_invites WHERE flight_id = $1 AND email = $2 RETURNING email', [
            g.id,
            params.key.toLowerCase(),
          ])
        : await db.query('DELETE FROM flight_shares WHERE flight_id = $1 AND pilot_id = $2 RETURNING pilot_id', [
            g.id,
            params.key,
          ]);
      if (!r.length) throw notFound('this person has no access to the flight');
      return undefined;
    },
  },
];
