// Vercel function: every /api/… request is rewritten here (vercel.json). Static files are served by Vercel.
// Environment: DATABASE_URL (Neon Postgres), GOOGLE_CLIENT_ID, optional ALLOWED_EMAILS.
import { openDb } from './_lib/db.mjs';
import { createApi, configFromEnv } from './_lib/api.mjs';

let handler;
async function init() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set; refusing to serve an open API');
  const db = await openDb(process.env.DATABASE_URL);
  return createApi({ db, ...configFromEnv(), secureCookie: true });
}

export default async function (req, res) {
  try {
    // vercel.json rewrites /api/<path> to /api?__path=<path>; restore the original path
    const u = new URL(req.url, 'http://x');
    const sub = u.searchParams.get('__path');
    if (sub !== null) { u.searchParams.delete('__path'); req.url = `/api/${sub}${u.search}`; }
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
