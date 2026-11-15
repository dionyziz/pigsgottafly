// Vercel function: every /api/… request is rewritten here (vercel.json: /api/:path* → /api?__path=:path*).
// Environment: DATABASE_URL (Neon Postgres), GOOGLE_CLIENT_ID (required), optional ALLOWED_EMAILS
// (checked at sign-in and on every request), optional AUTOROUTER_EMAIL / AUTOROUTER_PASSWORD (NOTAM
// briefing) and AUTOROUTER_FILING=1 (flight-plan filing, once autorouter grants API access).
// The autorouter account is used only for the pilots on AUTOROUTER_PILOTS (default ALLOWED_EMAILS;
// both empty = nobody).
// Pending migrations run on cold start, before the first request is served.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { openDb } from './_lib/db.js';
import { configFromEnv, createApi } from './_lib/app.js';

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
    await (await handler)(req, res);
  } catch (e) {
    handler = null;
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'server error' }));
  }
}
