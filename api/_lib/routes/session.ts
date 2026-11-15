// GET /session, POST /login, POST /logout
import type { Route } from '../http.js';
import { HttpError, reply } from '../http.js';
import { createSession, hashToken, localPilotRow, sessionCookie, sessionPilotRow, SESSION_MS, tokenFrom, verifyGoogleToken } from '../auth.js';
import { toPilot } from '../rows.js';
import type { LoginResponse, SessionResponse } from '../../../src/shared/api.js';
import { randomBytes } from 'node:crypto';

export const routes: Route[] = [
  {
    method: 'GET', path: '/session', auth: false,
    async handler({ db, config, req }): Promise<SessionResponse> {
      const google = !!config.googleClientId;
      const row = google ? await sessionPilotRow(db, req) : await localPilotRow(db);
      return { authed: !!row, mode: google ? 'google' : 'local', googleClientId: config.googleClientId || null, pilot: row ? toPilot(row) : null };
    },
  },
  {
    method: 'POST', path: '/login', auth: false,
    async handler({ db, config, body }) {
      if (!config.googleClientId) throw new HttpError(404, 'sign-in is not enabled');
      const { credential } = await body();
      let claims;
      try {
        claims = await verifyGoogleToken(credential, config.googleClientId, config.googleKeys);
      } catch {
        throw new HttpError(401, 'sign-in failed');
      }
      const email = String(claims.email);
      if (config.allowedEmails.length && !config.allowedEmails.includes(email.toLowerCase())) throw new HttpError(403, `${email} is not allowed`);
      const sub = claims.sub ? String(claims.sub) : `email:${email.toLowerCase()}`;
      const now = Date.now();
      // New pilots start with an empty profile and hangar (seeded_at set: no one-time migration data).
      const [row] = await db.query(
        `INSERT INTO pilots (id, google_sub, email, name, picture, created, last_login, seeded_at) VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
         ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, last_login = EXCLUDED.last_login
         RETURNING *`,
        [`pl_${randomBytes(9).toString('base64url')}`, sub, email, claims.name || '', claims.picture || '', now],
      );
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
