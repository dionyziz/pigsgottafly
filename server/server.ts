// Pig's Gotta Fly local server: the API (api/_lib/app.ts) plus the built client (dist/), with SPA
// fallback to index.html for client routes. In production Vercel serves dist/ and runs api/index.ts.
//
//   npm start                      → build, then http://127.0.0.1:8765/ with PGlite data in server/pgdata
//   npm run serve                  → same without building
//   DATABASE_URL=postgres://… …    → a Postgres server instead (never the production database!)
//   GOOGLE_CLIENT_ID=… [ALLOWED_EMAILS=a@x,b@y] → Google sign-in; without it: local mode, no sign-in
//   Local mode against a postgres:// database is refused (it would create an open 'local' pilot in
//   whatever database DATABASE_URL names, e.g. production from .env.local) unless LOCAL_MODE_ON_POSTGRES=1.
//   Built-client responses carry the same security headers as production (vercel.json).
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
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

const PROD_HEADERS_SKIP = new Set(['cache-control']);

/**
 * The security headers vercel.json sets on every path in production (CSP, framing, sniffing,
 * referrer), so the built client is served locally (and in e2e) under the same policy.
 */
export function productionSecurityHeaders(vercelJson = path.join(ROOT, 'vercel.json')): Record<string, string> {
  const cfg = JSON.parse(fs.readFileSync(vercelJson, 'utf8')) as { headers?: { source: string; headers: { key: string; value: string }[] }[] };
  const all = (cfg.headers || []).find((h) => h.source === '/(.*)');
  const out: Record<string, string> = {};
  for (const { key, value } of all?.headers || []) if (!PROD_HEADERS_SKIP.has(key.toLowerCase())) out[key] = value;
  return out;
}

const isPostgresUrl = (where: string) => /^postgres(ql)?:\/\//i.test(where.trim());

/**
 * Refuses local mode (no sign-in) on a Postgres database unless explicitly allowed: local mode
 * serves everyone as one 'local' pilot, which must never happen on a shared or production database.
 */
export function checkLocalMode(where: string, googleClientId: string | undefined, allowLocalOnPostgres: boolean): void {
  if (googleClientId || !isPostgresUrl(where) || allowLocalOnPostgres) return;
  throw new Error('Refusing local mode (no sign-in) on a postgres:// DATABASE_URL: set GOOGLE_CLIENT_ID, '
    + 'unset DATABASE_URL to use PGlite, or set LOCAL_MODE_ON_POSTGRES=1 for a disposable local Postgres.');
}

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

/** Serves files from dir; unknown paths without an extension get index.html (client routes). */
export function staticHandler(dir: string, securityHeaders: Record<string, string> = productionSecurityHeaders()): Handler {
  return (req, res) => {
    for (const [k, v] of Object.entries(securityHeaders)) res.setHeader(k, v);
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
  /** Allow local mode (no GOOGLE_CLIENT_ID) on a postgres:// database (LOCAL_MODE_ON_POSTGRES=1). */
  allowLocalOnPostgres?: boolean;
}

export function createServer({ db: where = path.join(ROOT, 'server', 'pgdata'), client, allowLocalOnPostgres = false, ...opts }: ServerOptions = {}) {
  checkLocalMode(where, opts.googleClientId, allowLocalOnPostgres); // before openDb: no migrations, no 'local' pilot
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
  const server = createServer({ db: process.env.DATABASE_URL || undefined, ...cfg, client, allowLocalOnPostgres: process.env.LOCAL_MODE_ON_POSTGRES === '1' });
  if (!cfg.googleClientId && !/^(127\.|::1$|localhost$)/.test(host)) {
    console.warn(`Warning: local mode (no sign-in) listening on ${host}: anyone who can reach this port acts as the local pilot.`);
  }
  return server.ready.then(() => new Promise<void>((r) => server.listen(port, host, () => {
    console.log(`Pig's Gotta Fly: http://${host}:${port}/${cfg.googleClientId ? ' (Google sign-in)' : ' (local mode, no sign-in)'}`);
    r();
  })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await listenFromEnv();
}
