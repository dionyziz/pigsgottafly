// GET /session, POST /login, POST /logout
import type { Route } from '../http.js';
import { HttpError, reply } from '../http.js';
import { createSession, emailAllowed, hashToken, localPilotRow, sessionCookie, sessionPilotRow, SESSION_MS, tokenFrom, verifyGoogleToken } from '../auth.js';
import { toPilot } from '../rows.js';
import type { LoginResponse, SessionResponse } from '../../../src/shared/api.js';
import { randomBytes } from 'node:crypto';
import { isAdmin } from '../auth.js';
import { mailAvailability, sendSystemMail } from '../mail.js';

/** Longest a sign-in waits for the signup notice (it is sent before the response, as a serverless
 * function may be stopped once it has answered). */
const NOTIFY_WAIT_MS = 4000;

/** E-mails the admins (ADMIN_EMAILS) that a pilot signed up. Errors are logged, never thrown. */
export async function notifySignup(admins: string[], p: { name: string; email: string; at: number }): Promise<void> {
  if (!admins.length || !mailAvailability().enabled) return;
  const when = new Date(p.at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const send = sendSystemMail({
    to: admins,
    subject: `New pilot: ${p.name || p.email}`,
    text: [`A new pilot signed up to Pig's Gotta Fly.`, '', `Name: ${p.name || '(none)'}`, `E-mail: ${p.email}`, `Time: ${when}`].join('\n'),
  }).then(() => undefined, (e) => { console.warn('signup notice:', String((e as Error)?.message || e)); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([send, new Promise<void>((r) => { timer = setTimeout(r, NOTIFY_WAIT_MS); })]);
  clearTimeout(timer);
}

export const routes: Route[] = [
  {
    method: 'GET', path: '/session', auth: false,
    async handler({ db, config, req }): Promise<SessionResponse> {
      const google = !!config.googleClientId;
      const row = google ? await sessionPilotRow(db, req, config.allowedEmails) : await localPilotRow(db);
      return { authed: !!row, mode: google ? 'google' : 'local', googleClientId: config.googleClientId || null, pilot: row ? toPilot(row) : null, admin: isAdmin(config, row) };
    },
  },
  {
    method: 'POST', path: '/login', auth: false,
    async handler({ db, config, body }) {
      if (!config.googleClientId) throw new HttpError(404, 'sign-in is not enabled');
      const { credential } = await body();
      if (typeof credential !== 'string' || !credential) throw new HttpError(400, 'credential is required');
      let claims;
      try {
        claims = await verifyGoogleToken(credential, config.googleClientId, config.googleKeys);
      } catch {
        throw new HttpError(401, 'sign-in failed');
      }
      const email = String(claims.email);
      if (!emailAllowed(email, config.allowedEmails)) throw new HttpError(403, `${email} is not allowed`);
      const sub = claims.sub ? String(claims.sub) : `email:${email.toLowerCase()}`;
      const now = Date.now();
      // New pilots start with an empty profile and hangar (seeded_at set: no one-time migration data).
      const [row] = await db.query(
        `INSERT INTO pilots (id, google_sub, email, name, picture, created, last_login, seeded_at) VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
         ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, last_login = EXCLUDED.last_login
         RETURNING *, (xmax = 0) AS inserted`,
        [`pl_${randomBytes(9).toString('base64url')}`, sub, email, claims.name || '', claims.picture || '', now],
      );
      // a new account: tell the admins (never blocks or fails the sign-in)
      if (row.inserted === true) await notifySignup(config.adminEmails ?? [], { name: claims.name || '', email, at: now });
      const tok = await createSession(db, row.id);
      const out: LoginResponse = { ok: true, pilot: toPilot(row) };
      return reply(200, out, { 'Set-Cookie': sessionCookie(tok, SESSION_MS / 1000, config.secureCookie) });
    },
  },
  {
    method: 'POST', path: '/logout', auth: false,
    async handler({ db, req, config }) {
      const t = tokenFrom(req);
      if (t) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(t)]);
      return reply(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0, config.secureCookie) });
    },
  },
];
