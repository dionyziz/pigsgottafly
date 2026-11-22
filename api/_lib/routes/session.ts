// GET /session, POST /login (Google), POST /login/apple (Sign in with Apple), POST /logout, POST /session/revoke-all (sign out everywhere)
import { randomBytes } from 'node:crypto';

import type { LoginResponse, SessionResponse } from '../../../src/shared/api.js';
import {
  admitted,
  createSession,
  hashToken,
  isAppleRelay,
  localPilotRow,
  purgeExpiredSessions,
  SESSION_MS,
  sessionCookie,
  sessionPilotRow,
  tokenFrom,
  verifyAppleToken,
  verifyGoogleToken,
} from '../auth.js';
import { isAdmin } from '../auth.js';
import type { Queryable, Row } from '../db.js';
import type { ApiConfig, Route } from '../http.js';
import { HttpError, newId, reply } from '../http.js';
import { mailAvailability, sendSystemMail } from '../mail.js';
import { rateLimit } from '../rateLimit.js';
import { toPilot } from '../rows.js';
import { sendLogged } from '../sendCaps.js';
import { claimInvites } from './flightShares.js';
import { acceptInvitations } from './invitations.js';

/** Longest a sign-in waits for the signup notice (it is sent before the response, as a serverless
 * function may be stopped once it has answered). */
const NOTIFY_WAIT_MS = 4000;

/** Signup notices per rolling 24 hours; after them, one "more signups today" note, then nothing. */
export const SIGNUP_NOTICE_CAP = 20;

/**
 * E-mails the admins (ADMIN_EMAILS) that a pilot signed up: a fixed subject (no name: a Google name
 * is chosen by whoever signs up), the name and e-mail only in the body. Logged in mail_log (kind
 * 'signup', the new pilot's id); errors are logged, never thrown.
 */
export async function notifySignup(
  db: Queryable,
  admins: string[],
  p: { pilotId: string; name: string; email: string; at: number },
): Promise<void> {
  if (!admins.length || !mailAvailability().enabled) return;
  const [c] = await db.query(
    `SELECT count(*) FILTER (WHERE form = 'signup')::int AS n, count(*) FILTER (WHERE form = 'signup-more')::int AS more
    FROM mail_log WHERE form IN ('signup', 'signup-more') AND at > $1 AND result IN ('pending', 'sent')`,
    [p.at - 24 * 3600e3],
  );
  const when = new Date(p.at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const to = admins.join(', ');
  let mail: { kind: string; subject: string; text: string } | null;
  if (c.n < SIGNUP_NOTICE_CAP) {
    mail = {
      kind: 'signup',
      subject: 'New pilot signed up',
      text: [
        `A new pilot signed up to Pig's Gotta Fly.`,
        '',
        `Name: ${p.name.replace(/[\r\n]+/g, ' ').slice(0, 100) || '(none)'}`,
        `E-mail: ${p.email}`,
        `Time: ${when}`,
      ].join('\n'),
    };
  } else if (!c.more) {
    mail = {
      kind: 'signup-more',
      subject: 'More pilots signed up today',
      text: `More than ${SIGNUP_NOTICE_CAP} pilots signed up to Pig's Gotta Fly in the last 24 hours. No more notices are sent until the count drops; the admin page lists every pilot.`,
    };
  } else {
    mail = null;
  }
  if (!mail) {
    await db.query(
      `INSERT INTO mail_log (id, pilot_id, flight_id, form, at, recipient, subject, result, error) VALUES ($1,$2,NULL,'signup',$3,$4,'New pilot signed up','capped','daily signup notice cap')`,
      [await newId('ml'), p.pilotId, p.at, to],
    );
    return;
  }
  const m = mail;
  const send = sendLogged(
    db,
    {
      pilotId: m.kind === 'signup' ? p.pilotId : null,
      flightId: null,
      form: m.kind,
      recipient: to,
      subject: m.subject,
    },
    () => sendSystemMail({ to: admins, subject: m.subject, text: m.text }),
  ).then(
    () => undefined,
    (e) => {
      console.warn('signup notice:', String((e as Error)?.message || e));
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    send,
    new Promise<void>((r) => {
      timer = setTimeout(r, NOTIFY_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
}

const newPilotId = () => `pl_${randomBytes(9).toString('base64url')}`;

/**
 * After a sign-in: the flights shared with the verified address the pilot signed in with become theirs
 * to open (flightShares.ts claimInvites), the invitations to it are accepted and their aircraft shared
 * (invitations.ts acceptInvitations), the admins hear about a new pilot, and the answer carries a new
 * session cookie.
 */
async function signedIn(db: Queryable, config: ApiConfig, row: Row, isNew: boolean, at: number, email: string) {
  await claimInvites(db, row.id, email);
  await acceptInvitations(db, row.id, email);
  // a new account: tell the admins (never blocks or fails the sign-in)
  if (isNew)
    await notifySignup(db, config.adminEmails ?? [], { pilotId: row.id, name: row.name || '', email: row.email, at });
  await purgeExpiredSessions(db);
  const tok = await createSession(db, row.id);
  const out: LoginResponse = { ok: true, pilot: toPilot(row) };
  return reply(200, out, { 'Set-Cookie': sessionCookie(tok, SESSION_MS / 1000, config.secureCookie) });
}

/** The name Apple gives on the first sign-in only: a string, or Apple JS's { firstName, lastName }. */
function appleName(v: unknown): string {
  const n =
    typeof v === 'string'
      ? v
      : v && typeof v === 'object'
        ? [(v as { firstName?: unknown }).firstName, (v as { lastName?: unknown }).lastName]
            .filter((x) => typeof x === 'string')
            .join(' ')
        : '';
  return n.replace(/\s+/g, ' ').trim().slice(0, 100);
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/session',
    auth: false,
    async handler({ db, config, req }): Promise<SessionResponse> {
      const google = !!config.googleClientId;
      const row = google ? await sessionPilotRow(db, req, config.allowedEmails) : await localPilotRow(db);
      return {
        authed: !!row,
        mode: google ? 'google' : 'local',
        googleClientId: config.googleClientId || null,
        appleClientId: (google && config.appleClientId) || null,
        pilot: row ? toPilot(row) : null,
        admin: isAdmin(config, row),
      };
    },
  },
  {
    method: 'POST',
    path: '/login',
    auth: false,
    async handler({ db, config, body, req }) {
      if (!config.googleClientId) throw new HttpError(404, 'sign-in is not enabled');
      await rateLimit(db, 'login', { req });
      const { credential } = await body();
      if (typeof credential !== 'string' || !credential) throw new HttpError(400, 'credential is required');
      let claims;
      try {
        claims = await verifyGoogleToken(credential, config.googleClientId, config.googleKeys);
      } catch {
        throw new HttpError(401, 'sign-in failed');
      }
      const email = String(claims.email);
      if (!(await admitted(db, email, config.allowedEmails))) throw new HttpError(403, `${email} is not allowed`);
      const sub = claims.sub ? String(claims.sub) : `email:${email.toLowerCase()}`;
      const now = Date.now();
      // New pilots start with an empty profile and hangar (seeded_at set: no one-time migration data).
      const [row] = await db.query(
        `INSERT INTO pilots (id, google_sub, email, name, picture, created, last_login, seeded_at) VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
         ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, last_login = EXCLUDED.last_login
         RETURNING *, (xmax = 0) AS inserted`,
        [newPilotId(), sub, email, claims.name || '', claims.picture || '', now],
      );
      return signedIn(db, config, row, row.inserted === true, now, email);
    },
  },
  {
    // Sign in with Apple (JS, popup): the identity token, and the name on the very first sign-in only.
    // The pilot is found by Apple's sub; else a pilot with the same verified e-mail (never a Hide My
    // Email relay address) gets this Apple ID linked; else a new pilot.
    method: 'POST',
    path: '/login/apple',
    auth: false,
    async handler({ db, config, body, req }) {
      if (!config.appleClientId) throw new HttpError(404, 'Sign in with Apple is not enabled');
      await rateLimit(db, 'login', { req });
      const { idToken, name } = await body();
      if (typeof idToken !== 'string' || !idToken) throw new HttpError(400, 'idToken is required');
      let claims;
      try {
        claims = await verifyAppleToken(idToken, config.appleClientId, config.appleKeys);
      } catch {
        throw new HttpError(401, 'sign-in failed');
      }
      const email = String(claims.email).trim();
      if (!(await admitted(db, email, config.allowedEmails))) throw new HttpError(403, `${email} is not allowed`);
      const now = Date.now();
      // known Apple ID: the e-mail follows Apple's unless Google's sign-in keeps it
      const [known] = await db.query(
        `UPDATE pilots SET last_login = $2, email = CASE WHEN google_sub IS NULL THEN $3 ELSE email END,
           name = CASE WHEN name = '' THEN $4 ELSE name END
         WHERE apple_sub = $1 RETURNING *`,
        [claims.sub, now, email, appleName(name)],
      );
      if (known) return signedIn(db, config, known, false, now, email);
      if (!isAppleRelay(claims)) {
        const [linked] = await db.query(
          `UPDATE pilots SET apple_sub = $1, last_login = $2
           WHERE id = (SELECT id FROM pilots WHERE apple_sub IS NULL AND id <> 'local' AND email <> '' AND lower(email) = lower($3)
                       ORDER BY (google_sub IS NULL), created LIMIT 1)
           RETURNING *`,
          [claims.sub, now, email],
        );
        if (linked) return signedIn(db, config, linked, false, now, email);
      }
      // a new pilot (a race with another sign-in of the same Apple ID finds that one)
      const [row] = await db.query(
        `INSERT INTO pilots (id, apple_sub, email, name, picture, created, last_login, seeded_at) VALUES ($1, $2, $3, $4, '', $5, $5, $5)
         ON CONFLICT (apple_sub) DO UPDATE SET last_login = EXCLUDED.last_login
         RETURNING *, (xmax = 0) AS inserted`,
        [newPilotId(), claims.sub, email, appleName(name), now],
      );
      return signedIn(db, config, row, row.inserted === true, now, email);
    },
  },
  {
    // "Sign out everywhere": every session of the pilot ends, this one included
    method: 'POST',
    path: '/session/revoke-all',
    async handler({ db, pilot, config }) {
      await db.query('DELETE FROM sessions WHERE pilot_id = $1', [pilot.id]);
      return reply(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0, config.secureCookie) });
    },
  },
  {
    method: 'POST',
    path: '/logout',
    auth: false,
    async handler({ db, req, config }) {
      const t = tokenFrom(req);
      if (t) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(t)]);
      return reply(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0, config.secureCookie) });
    },
  },
];
