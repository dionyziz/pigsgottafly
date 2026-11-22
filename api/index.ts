// Vercel function: every /api/… request is rewritten here (vercel.json: /api/:path* → /api?__path=:path*).
// Environment: DATABASE_URL (Neon Postgres), GOOGLE_CLIENT_ID (required), optional APPLE_CLIENT_ID (Sign in
// with Apple Services ID), optional ALLOWED_EMAILS
// (checked at sign-in and on every request), optional AUTOROUTER_EMAIL / AUTOROUTER_PASSWORD (NOTAM
// briefing) and AUTOROUTER_FILING=1 (flight-plan filing).
// The autorouter account is used only for the pilots on AUTOROUTER_PILOTS ('*' = every pilot; default ALLOWED_EMAILS;
// both empty = nobody).
// Optional NOTAMIFY_API_KEY (NOTAMIFY_MAX_CREDITS): Notamify, a NOTAM source for every pilot; NOTAM_SOURCES
// orders the sources (api/_lib/notamSources/).
// Optional FAX_PROVIDER / FAX_API_KEY / … (or FAX_DRY_RUN=1): filing by fax, for the pilots on FAX_PILOTS;
// FILERS orders the filing backends (ARCHITECTURE.md "Filing backends").
// Optional RESEND_API_KEY / FORMS_FROM e-mail forms to HCAA for any signed-in pilot, who is cc'd.
// Pending migrations run on cold start, before the first request is served. A failed migration is
// recorded in app_errors and e-mailed to ADMIN_EMAILS (api/_lib/monitor.ts); every request then
// answers 500 (GET /api/health: 503) and retries the start-up, until it succeeds.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { configFromEnv, createApi } from './_lib/app.js';
import { openDb } from './_lib/db.js';

let handler: Promise<(req: IncomingMessage, res: ServerResponse) => Promise<void>> | null = null;

async function init() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set; refusing to serve an open API');
  const db = await openDb(process.env.DATABASE_URL);
  return createApi({ db, ...configFromEnv(), secureCookie: true });
}

export default async function vercelHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const u = new URL(req.url || '/', 'http://x');
    const sub = u.searchParams.get('__path');
    if (sub !== null) {
      u.searchParams.delete('__path');
      req.url = `/api/${sub}${u.search}`;
    }
    handler ||= init();
    await (
      await handler
    )(req, res);
  } catch (e) {
    handler = null;
    // the dispatcher answers every error itself: this is a failed start-up (env, database, migration)
    console.error('[pgf-startup-failed]', e);
    if (res.headersSent) return;
    const health = /^\/api\/health\/?(\?|$)/.test(req.url || '');
    res.statusCode = health ? 503 : 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify(
        health ? { ok: false, error: 'start-up failed (see the [pgf-startup-failed] log)' } : { error: 'server error' },
      ),
    );
  }
}
