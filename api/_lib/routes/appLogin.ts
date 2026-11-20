// Sign-in for the iOS app (ios/, Capacitor). Google refuses sign-in inside an app's web view, so the
// app opens /app-login in Apple's sign-in sheet (ASWebAuthenticationSession, Safari's cookies), where
// the web app signs the pilot in as usual and then:
//   POST /app-code               (signed in) a one-time code, valid APP_CODE_MS, stored hashed;
//                                the page hands it to the app as pigsgottafly://signed-in?code=…
//   GET  /app-session?code=…     (in the app's web view) uses up the code: a session cookie for that
//                                web view and a redirect to the flights; a bad or used code → /.
import { randomBytes } from 'node:crypto';

import { createSession, hashToken, SESSION_MS, sessionCookie } from '../auth.js';
import type { Route } from '../http.js';
import { Reply } from '../http.js';
import { rateLimit } from '../rateLimit.js';

/** How long a code may wait for the app to use it. */
export const APP_CODE_MS = 2 * 60e3;

export const routes: Route[] = [
  {
    method: 'POST',
    path: '/app-code',
    async handler({ db, pilot }) {
      await rateLimit(db, 'login', { pilotId: pilot.id });
      const code = randomBytes(24).toString('base64url');
      const now = Date.now();
      await db.query('DELETE FROM app_login_codes WHERE expires < $1', [now]);
      await db.query('INSERT INTO app_login_codes (code_hash, pilot_id, expires) VALUES ($1, $2, $3)', [
        hashToken(code),
        pilot.id,
        now + APP_CODE_MS,
      ]);
      return { code };
    },
  },
  {
    method: 'GET',
    path: '/app-session',
    auth: false,
    async handler({ db, query, req, config }) {
      await rateLimit(db, 'login', { req });
      const code = query.get('code') || '';
      const [row] = code
        ? await db.query('DELETE FROM app_login_codes WHERE code_hash = $1 AND expires >= $2 RETURNING pilot_id', [
            hashToken(code),
            Date.now(),
          ])
        : [];
      if (!row) return new Reply(302, null, { Location: '/?signin=failed' });
      const tok = await createSession(db, row.pilot_id);
      return new Reply(302, null, {
        Location: '/',
        'Set-Cookie': sessionCookie(tok, SESSION_MS / 1000, config.secureCookie),
      });
    },
  },
];
