// Pig's Gotta Fly local server: the API (api/_lib/app.ts) plus the built client (dist/), with SPA
// fallback to index.html for client routes. In production Vercel serves dist/ and runs api/index.ts.
//
//   npm start                      → build, then http://127.0.0.1:8765/ with PGlite data in server/pgdata
//   npm run serve                  → same without building
//   DATABASE_URL=postgres://… …    → a Postgres server instead (never the production database!)
//   GOOGLE_CLIENT_ID=… [ALLOWED_EMAILS=a@x,b@y] → Google sign-in; without it: local mode, no sign-in
//   (PORT=8765, HOST=127.0.0.1)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../api/_lib/db.js';
import { configFromEnv, createApi } from '../api/_lib/app.js';
import type { ApiConfig } from '../api/_lib/http.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

/** Serves files from dir; unknown paths without an extension get index.html (client routes). */
export function staticHandler(dir: string): Handler {
  return (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let p = path.join(dir, rel);
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      if (path.extname(rel)) { res.writeHead(404); res.end('not found'); return; }
      rel = 'index.html';
      p = path.join(dir, rel);
    }
    if (!fs.existsSync(p)) { res.writeHead(500); res.end('client not built: run npm run build'); return; }
    const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': cache });
    fs.createReadStream(p).pipe(res);
  };
}

export interface ServerOptions extends Partial<ApiConfig> {
  /** postgres:// URL, a PGlite data directory, or 'memory://'. */
  db?: string;
  /** Client handler for non-API requests (default: static dist/). */
  client?: Handler;
}

export function createServer({ db: where = path.join(ROOT, 'server', 'pgdata'), client, ...opts }: ServerOptions = {}) {
  const ready: Promise<{ db: Db; api: Handler }> = openDb(where).then((db) => ({ db, api: createApi({ db, ...opts }) }));
  const serveClient = client || staticHandler(path.join(ROOT, 'dist'));
  const server = http.createServer(async (req, res) => {
    try {
      if ((req.url || '').startsWith('/api/') || req.url === '/api') return await (await ready).api(req, res);
      await serveClient(req, res);
    } catch (e) {
      if (!res.headersSent) { res.writeHead(500); res.end(String((e as Error).message || e)); }
    }
  });
  (server as any).ready = ready;
  server.on('close', () => { ready.then(({ db }) => db.close()).catch(() => {}); });
  return server as http.Server & { ready: typeof ready };
}

export function listenFromEnv(client?: Handler) {
  const port = +(process.env.PORT || 8765);
  const host = process.env.HOST || '127.0.0.1';
  const cfg = configFromEnv();
  const server = createServer({ db: process.env.DATABASE_URL || undefined, ...cfg, client });
  return server.ready.then(() => new Promise<void>((r) => server.listen(port, host, () => {
    console.log(`Pig's Gotta Fly: http://${host}:${port}/${cfg.googleClientId ? ' (Google sign-in)' : ' (local mode, no sign-in)'}`);
    r();
  })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await listenFromEnv();
}
