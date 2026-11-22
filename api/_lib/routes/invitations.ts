// Inviting pilots to the app: /invitations[/:id[/aircraft/:aircraftId]] (src/shared/sharing.ts,
// migration 055). An address no account uses gets an invitation, with the aircraft the inviter
// chose to share (each one they own or edit, as aircraft shares require); an address an account
// already uses gets those aircraft shared at once, as sharing a flight with it would. The aircraft
// share dialog invites the same way (shares.ts). On every sign-in, acceptInvitations turns the open
// invitations to the verified address into aircraft shares. The invitee is e-mailed (shareMail.ts).
import { isEmail } from '../../../src/shared/operators.js';
import type { InviteResponse, PilotInvitation, ShareRole } from '../../../src/shared/sharing.js';
import type { Pilot } from '../../../src/shared/types.js';
import { aircraftFor } from '../access.js';
import { logEvent } from '../aircraftLog.js';
import type { Queryable, Row } from '../db.js';
import type { ApiConfig, Req, Route } from '../http.js';
import { badRequest, conflict, newId, notFound, reply } from '../http.js';
import { mailAvailability, sendSystemMail } from '../mail.js';
import { rateLimit } from '../rateLimit.js';
import { notifyInvite } from '../shareMail.js';

const MAX_AIRCRAFT = 50;
const MAX_MESSAGE = 500;

function shareRole(v: unknown): ShareRole {
  if (v !== 'view' && v !== 'edit') throw badRequest("role must be 'view' or 'edit'");
  return v;
}

/** The trimmed address, or 400. */
export function inviteeEmail(v: unknown): string {
  const email = typeof v === 'string' ? v.trim() : '';
  if (!email) throw badRequest('email is required');
  if (email.length > 320) throw badRequest('email is too long');
  if (!isEmail(email)) throw badRequest(`${email} is not an e-mail address`);
  return email;
}

/** Local mode has one pilot and no sign-in: nobody could accept an invitation. */
export const noAccount = (email: string) => `No Pig’s Gotta Fly account uses ${email}.`;

/** The account that signed in most recently with this address (an address is normally one account). */
export async function accountFor(db: Queryable, email: string): Promise<Row | undefined> {
  const [p] = await db.query(
    'SELECT id, email FROM pilots WHERE lower(email) = lower($1) ORDER BY last_login DESC LIMIT 1',
    [email],
  );
  return p;
}

/**
 * Opens (or reuses) the pilot's invitation to `email` and adds the aircraft to it. `added` lists the
 * aircraft ids new to it; `created` is true for a new (or reopened) invitation.
 */
export async function openInvitation(
  db: Queryable,
  pilotId: string,
  email: string,
  message: string,
  aircraft: { id: string; role: ShareRole }[],
): Promise<{ id: string; created: boolean; added: string[] }> {
  const now = Date.now();
  // an accepted invitation whose address has no account any more (it changed) opens again
  const [inv] = await db.query(
    `INSERT INTO pilot_invitations (id, pilot_id, email, message, created) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (pilot_id, email) DO UPDATE SET
       message = CASE WHEN EXCLUDED.message <> '' THEN EXCLUDED.message ELSE pilot_invitations.message END,
       created = CASE WHEN pilot_invitations.accepted_at IS NULL THEN pilot_invitations.created ELSE EXCLUDED.created END,
       accepted_at = NULL
     RETURNING id, (xmax = 0) AS inserted, created = $5 AS fresh`,
    [await newId('inv'), pilotId, email.toLowerCase(), message, now],
  );
  const added: string[] = [];
  for (const a of aircraft) {
    const r = await db.query(
      `INSERT INTO pilot_invitation_aircraft (invitation_id, aircraft_id, role, created) VALUES ($1, $2, $3, $4)
       ON CONFLICT (invitation_id, aircraft_id) DO NOTHING RETURNING aircraft_id`,
      [inv.id, a.id, a.role, now],
    );
    if (r.length) added.push(a.id);
  }
  return { id: inv.id, created: inv.inserted === true || inv.fresh === true, added };
}

const detail = (r: Row) => [r.make_model, r.icao_type].filter(Boolean).join(', ');

/** E-mails the invitee the invitation with every aircraft it shares so far. */
export async function sendInvitation(
  db: Queryable,
  ctx: { req: Req; config: ApiConfig; pilot: Pilot },
  invitationId: string,
  to: string,
): Promise<void> {
  const [inv] = await db.query('SELECT message FROM pilot_invitations WHERE id = $1', [invitationId]);
  const rows = await db.query(
    `SELECT a.registration, a.make_model, a.icao_type, ia.role FROM pilot_invitation_aircraft ia
     JOIN aircraft a ON a.id = ia.aircraft_id WHERE ia.invitation_id = $1 ORDER BY a.registration`,
    [invitationId],
  );
  await notifyInvite(db, ctx, {
    to,
    message: String(inv?.message ?? ''),
    aircraft: rows.map((r: Row) => ({ registration: r.registration, detail: detail(r), role: r.role as ShareRole })),
  });
}

/** The pilot's open invitations, newest first, each with its aircraft by registration. */
export async function listInvitations(db: Queryable, pilotId: string): Promise<PilotInvitation[]> {
  const rows = await db.query(
    `SELECT i.id, i.email, i.message, i.created, ia.aircraft_id, ia.role, a.registration
     FROM pilot_invitations i
     LEFT JOIN pilot_invitation_aircraft ia ON ia.invitation_id = i.id
     LEFT JOIN aircraft a ON a.id = ia.aircraft_id
     WHERE i.pilot_id = $1 AND i.accepted_at IS NULL
     ORDER BY i.created DESC, i.email, a.registration`,
    [pilotId],
  );
  const out: PilotInvitation[] = [];
  for (const r of rows) {
    let inv = out.at(-1);
    if (!inv || inv.id !== r.id) {
      inv = { id: r.id, email: r.email, message: r.message, created: Number(r.created), aircraft: [] };
      out.push(inv);
    }
    if (r.aircraft_id)
      inv.aircraft.push({ aircraftId: r.aircraft_id, registration: r.registration, role: r.role as ShareRole });
  }
  return out;
}

/**
 * Accepts every open invitation to `email` (a verified address the pilot just signed in with; exact
 * match, case-insensitive) and shares its aircraft with the pilot, as long as the inviter may still
 * share them (owner or editor). An aircraft the pilot owns or already has keeps its access (the
 * higher role wins).
 */
export async function acceptInvitations(db: Queryable, pilotId: string, email: string): Promise<number> {
  const addr = email.trim().toLowerCase();
  if (!addr) return 0;
  const accepted = await db.query(
    `UPDATE pilot_invitations SET accepted_at = $2 WHERE email = $1 AND accepted_at IS NULL AND pilot_id <> $3 RETURNING id`,
    [addr, Date.now(), pilotId],
  );
  if (!accepted.length) return 0;
  const ids = accepted.map((r: Row) => r.id as string);
  // read before the pending rows go: each inviter is told who joined and what they now share
  const told = await db.query(
    `SELECT i.id, p.email AS inviter_email,
            COALESCE(array_agg(a.registration ORDER BY a.registration) FILTER (WHERE a.id IS NOT NULL), '{}') AS regs
     FROM pilot_invitations i
     JOIN pilots p ON p.id = i.pilot_id
     LEFT JOIN pilot_invitation_aircraft ia ON ia.invitation_id = i.id
     LEFT JOIN aircraft a ON a.id = ia.aircraft_id
     WHERE i.id = ANY($1::text[])
     GROUP BY i.id, p.email`,
    [ids],
  );
  // one row per aircraft (two inviters may have shared the same one): the higher role first
  await db.query(
    `INSERT INTO aircraft_shares (aircraft_id, pilot_id, role, created, created_by)
     SELECT DISTINCT ON (ia.aircraft_id) ia.aircraft_id, $2, ia.role, ia.created, i.pilot_id
     FROM pilot_invitation_aircraft ia
     JOIN pilot_invitations i ON i.id = ia.invitation_id
     JOIN aircraft a ON a.id = ia.aircraft_id
     WHERE ia.invitation_id = ANY($1::text[]) AND a.pilot_id <> $2
       AND (a.pilot_id = i.pilot_id OR EXISTS (
         SELECT 1 FROM aircraft_shares s WHERE s.aircraft_id = a.id AND s.pilot_id = i.pilot_id AND s.role = 'edit'))
     ORDER BY ia.aircraft_id, (ia.role = 'edit') DESC, ia.created
     ON CONFLICT (aircraft_id, pilot_id) DO UPDATE SET role = CASE WHEN aircraft_shares.role = 'edit' THEN 'edit' ELSE EXCLUDED.role END`,
    [ids, pilotId],
  );
  await db.query('DELETE FROM pilot_invitation_aircraft WHERE invitation_id = ANY($1::text[])', [ids]);
  if (mailAvailability().enabled)
    for (const t of told) {
      const to = String(t.inviter_email || '').trim();
      if (!to) continue;
      const { subject, text } = inviteAcceptedMail(addr, t.regs as string[]);
      // never blocks or fails the new pilot's sign-in
      await sendSystemMail({ to: [to], subject, text }).catch((e) =>
        console.warn('invitation accepted mail:', String((e as Error)?.message || e)),
      );
    }
  return accepted.length;
}

/** The inviter's notice that the invited address has signed up. */
export function inviteAcceptedMail(email: string, registrations: string[]): { subject: string; text: string } {
  return {
    subject: `${email} joined Pig's Gotta Fly`,
    text: [
      `${email}, whom you invited, has signed up to Pig's Gotta Fly.`,
      registrations.length ? `They now share: ${registrations.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/invitations',
    handler: ({ db, pilot }) => listInvitations(db, pilot.id),
  },
  {
    method: 'POST',
    path: '/invitations',
    async handler({ db, pilot, body, req, config }) {
      await rateLimit(db, 'share', { pilotId: pilot.id });
      const input = await body();
      const email = inviteeEmail(input.email);
      const message = typeof input.message === 'string' ? input.message.trim() : '';
      if (message.length > MAX_MESSAGE) throw badRequest(`the note is longer than ${MAX_MESSAGE} characters`);
      if (input.aircraft != null && !Array.isArray(input.aircraft)) throw badRequest('aircraft must be a list');
      const wanted = new Map<string, ShareRole>();
      for (const a of (input.aircraft ?? []) as unknown[]) {
        const id = (a as { aircraftId?: unknown })?.aircraftId;
        if (typeof id !== 'string' || !id) throw badRequest('aircraftId is required');
        wanted.set(id, shareRole((a as { role?: unknown }).role ?? 'view'));
      }
      if (wanted.size > MAX_AIRCRAFT) throw badRequest(`at most ${MAX_AIRCRAFT} aircraft`);
      const aircraft: { ac: Row; role: ShareRole }[] = [];
      for (const [id, role] of wanted) aircraft.push({ ac: await aircraftFor(db, pilot.id, id, 'edit'), role });
      if (email.toLowerCase() === (pilot.email ?? '').toLowerCase()) throw badRequest('You cannot invite yourself.');
      const p = await accountFor(db, email);
      if (p?.id === pilot.id) throw badRequest('You cannot invite yourself.');
      if (!p && !config.googleClientId) throw notFound(noAccount(email));
      const ctx = { req, config, pilot };

      if (p) {
        if (!aircraft.length) throw conflict(`${email} already uses Pig’s Gotta Fly.`);
        const shared: Row[] = [];
        for (const { ac, role } of aircraft) {
          if (ac.pilot_id === p.id) continue;
          const ins = await db.query(
            `INSERT INTO aircraft_shares (aircraft_id, pilot_id, role, created, created_by) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (aircraft_id, pilot_id) DO NOTHING RETURNING aircraft_id`,
            [ac.id, p.id, role, Date.now(), pilot.id],
          );
          if (ins.length) {
            shared.push({ ...ac, role });
            await logEvent(db, ac.id, pilot.id, { kind: 'share-add', role, subjectId: p.id });
          }
        }
        if (!shared.length)
          throw conflict(
            `${email} already uses Pig’s Gotta Fly and has ${aircraft.length > 1 ? 'these' : 'this'} aircraft.`,
          );
        shared.sort((a, b) => String(a.registration).localeCompare(String(b.registration)));
        await notifyInvite(db, ctx, {
          to: p.email || email,
          message,
          existing: true,
          aircraft: shared.map((r) => ({ registration: r.registration, detail: detail(r), role: r.role })),
        });
        const out: InviteResponse = {
          existing: true,
          shared: shared.map((r) => r.registration as string),
          invitations: await listInvitations(db, pilot.id),
        };
        return reply(201, out);
      }

      const inv = await openInvitation(
        db,
        pilot.id,
        email,
        message,
        aircraft.map(({ ac, role }) => ({ id: ac.id, role })),
      );
      if (!inv.created && !inv.added.length) throw conflict(`${email} is already invited.`);
      for (const { ac, role } of aircraft)
        if (inv.added.includes(ac.id))
          await logEvent(db, ac.id, pilot.id, { kind: 'share-add', role, subjectEmail: email });
      await sendInvitation(db, ctx, inv.id, email);
      const out: InviteResponse = { existing: false, shared: [], invitations: await listInvitations(db, pilot.id) };
      return reply(201, out);
    },
  },
  {
    method: 'DELETE',
    path: '/invitations/:id',
    async handler({ db, pilot, params }) {
      const shared = await db.query(
        `SELECT ia.aircraft_id, i.email FROM pilot_invitation_aircraft ia JOIN pilot_invitations i ON i.id = ia.invitation_id
         WHERE i.id = $1 AND i.pilot_id = $2 AND i.accepted_at IS NULL`,
        [params.id, pilot.id],
      );
      const r = await db.query(
        'DELETE FROM pilot_invitations WHERE id = $1 AND pilot_id = $2 AND accepted_at IS NULL RETURNING id',
        [params.id, pilot.id],
      );
      if (!r.length) throw notFound('no such invitation');
      for (const s of shared)
        await logEvent(db, s.aircraft_id, pilot.id, { kind: 'share-remove', subjectEmail: s.email });
      return undefined;
    },
  },
  {
    method: 'DELETE',
    path: '/invitations/:id/aircraft/:aircraftId',
    async handler({ db, pilot, params }) {
      const r = await db.query(
        `DELETE FROM pilot_invitation_aircraft ia USING pilot_invitations i
         WHERE ia.invitation_id = i.id AND i.id = $1 AND i.pilot_id = $2 AND i.accepted_at IS NULL AND ia.aircraft_id = $3
         RETURNING ia.aircraft_id, i.email`,
        [params.id, pilot.id, params.aircraftId],
      );
      if (!r.length) throw notFound('no such aircraft in this invitation');
      await logEvent(db, params.aircraftId, pilot.id, { kind: 'share-remove', subjectEmail: r[0].email });
      return undefined;
    },
  },
];
