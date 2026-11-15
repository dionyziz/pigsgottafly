// Pig's Gotta Fly local server: serves the app and the flights API (api/_lib/api.mjs).
// In production the same API runs as a Vercel function (api/index.mjs) and Vercel serves the files.
//
//   npm start                                   → http://127.0.0.1:8765/, flights in server/pgdata (PGlite)
//   DATABASE_URL=postgres://… npm start         → use a Postgres server instead (e.g. Neon)
//   GOOGLE_CLIENT_ID=….apps.googleusercontent.com [ALLOWED_EMAILS=a@x,b@y] npm start   → Google sign-in, one account per pilot
//   (PORT=8765, HOST=127.0.0.1)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../api/_lib/db.mjs';
import { createApi, configFromEnv } from '../api/_lib/api.mjs';
export { verifyGoogleToken } from '../api/_lib/api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const STATIC = new Set(['index.html', 'css', 'js', 'data', 'fonts', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.webmanifest']);

// db: a postgres:// URL, a PGlite data directory, or 'memory://'.
export function createServer({ db: where = path.join(ROOT, 'server', 'pgdata'), ...opts } = {}) {
  const ready = openDb(where).then((db) => ({ db, api: createApi({ db, ...opts }) }));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) return (await ready).api(req, res);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const p = path.join(ROOT, rel);
      if (!STATIC.has(rel.split('/')[0]) || !p.startsWith(ROOT + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(p).pipe(res);
    } catch (e) {
      res.writeHead(400); res.end(String(e.message || e));
    }
  });
  server.ready = ready;
  server.on('close', () => ready.then(({ db }) => db.close()));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +(process.env.PORT || 8765);
  const host = process.env.HOST || '127.0.0.1';
  const cfg = configFromEnv();
  const server = createServer({ db: process.env.DATABASE_URL || undefined, ...cfg });
  await server.ready;
  server.listen(port, host, () => console.log(`Pig's Gotta Fly: http://${host}:${port}/${cfg.googleClientId ? ' (Google sign-in)' : ''}`));
}
