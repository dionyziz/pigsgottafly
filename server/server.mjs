// Navlog server: serves the app and a small flights API backed by SQLite (node:sqlite, no dependencies).
//
//   GOOGLE_CLIENT_ID=....apps.googleusercontent.com NAVLOG_ALLOWED_EMAILS=you@gmail.com node server/server.mjs
//   (PORT=8765, HOST=127.0.0.1, NAVLOG_DB=server/navlog.db)
//
// Sign in with Google: when GOOGLE_CLIENT_ID is set, the API requires a Google sign-in by one of
// NAVLOG_ALLOWED_EMAILS, once per browser (an HttpOnly session cookie that lasts a year).
// Without it the API is open, for use on your own computer.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const STATIC = new Set(['index.html', 'css', 'js', 'data', 'fonts', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.webmanifest']);

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
let certCache = { at: 0, keys: [] };
async function googleKeys() {
  if (Date.now() - certCache.at < 3600e3 && certCache.keys.length) return certCache.keys;
  const r = await fetch(GOOGLE_CERTS);
  certCache = { at: Date.now(), keys: (await r.json()).keys };
  return certCache.keys;
}
// Verify a Google ID token (JWT, RS256) and return its claims, or throw.
export async function verifyGoogleToken(token, clientId, getKeys = googleKeys) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, sig] = parts;
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  if (header.alg !== 'RS256') throw new Error('unexpected algorithm');
  const jwk = (await getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('bad signature');
  if (claims.aud !== clientId) throw new Error('wrong audience');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('wrong issuer');
  if (!(claims.exp * 1000 > Date.now())) throw new Error('expired');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('email not verified');
  return claims;
}

export function createServer({ db: dbPath = path.join(ROOT, 'server', 'navlog.db'), googleClientId = '', allowedEmails = [], googleKeys: getKeys } = {}) {
  const allowed = new Set(allowedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS flights (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, updated INTEGER NOT NULL,
      opened INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created INTEGER NOT NULL);`);
  try { db.exec('ALTER TABLE sessions ADD COLUMN user TEXT'); } catch (e) { /* already there */ }
  const q = {
    list: db.prepare('SELECT id, summary, version, created, updated, opened FROM flights WHERE deleted = 0 ORDER BY MAX(updated, opened) DESC'),
    get: db.prepare('SELECT * FROM flights WHERE id = ?'),
    insert: db.prepare('INSERT INTO flights (id, data, summary, created, updated, opened) VALUES (?, ?, ?, ?, ?, ?)'),
    update: db.prepare('UPDATE flights SET data = ?, summary = ?, version = version + 1, updated = ? WHERE id = ? AND version = ?'),
    opened: db.prepare('UPDATE flights SET opened = ? WHERE id = ?'),
    del: db.prepare('UPDATE flights SET deleted = ? WHERE id = ?'),
    session: db.prepare('SELECT token, user FROM sessions WHERE token = ?'),
    newSession: db.prepare('INSERT INTO sessions (token, created, user) VALUES (?, ?, ?)'),
    endSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  };
  const newId = () => crypto.randomBytes(6).toString('base64url');
  const row = (r) => r && { id: r.id, data: JSON.parse(r.data), summary: JSON.parse(r.summary), version: r.version, created: r.created, updated: r.updated, deleted: !!r.deleted };

  const token = (req) => (/(?:^|;\s*)navlog_session=([\w-]+)/.exec(req.headers.cookie || '') || [])[1];
  function session(req) { const t = token(req); return t ? q.session.get(t) : null; }
  function authed(req) { return !googleClientId || !!session(req); }
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  async function readJson(req) {
    let s = '';
    for await (const c of req) { s += c; if (s.length > 5e6) throw new Error('too large'); }
    return s ? JSON.parse(s) : {};
  }

  async function api(req, res, parts) {
    if (parts[0] === 'session' && req.method === 'GET') {
      const s = googleClientId ? session(req) : null;
      return send(res, 200, { authed: authed(req), googleClientId: googleClientId || null, user: s && s.user ? JSON.parse(s.user) : null });
    }
    if (parts[0] === 'logout' && req.method === 'POST') {
      const t = token(req); if (t) q.endSession.run(t);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'navlog_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }
    if (parts[0] === 'login' && req.method === 'POST' && googleClientId) {
      const { credential } = await readJson(req);
      let claims;
      try { claims = await verifyGoogleToken(credential, googleClientId, getKeys); } catch (e) { return send(res, 401, { error: 'sign-in failed' }); }
      if (!allowed.has(String(claims.email).toLowerCase())) return send(res, 403, { error: `${claims.email} is not allowed` });
      const tok = crypto.randomBytes(24).toString('base64url');
      const user = { name: claims.name || '', email: claims.email, picture: claims.picture || '' };
      q.newSession.run(tok, Date.now(), JSON.stringify(user));
      return send(res, 200, { ok: true, user }, { 'Set-Cookie': `navlog_session=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000` });
    }
    if (!authed(req)) return send(res, 401, { error: 'sign in' });
    if (parts[0] !== 'flights') return send(res, 404, { error: 'not found' });
    const id = parts[1];
    if (!id) {
      if (req.method === 'GET') return send(res, 200, q.list.all().map((r) => ({ id: r.id, summary: JSON.parse(r.summary), version: r.version, created: r.created, updated: r.updated, opened: r.opened })));
      if (req.method === 'POST') {
        const { data = {}, summary = {}, id: wanted } = await readJson(req);
        const fid = typeof wanted === 'string' && /^[\w-]{6,24}$/.test(wanted) && !q.get.get(wanted) ? wanted : newId();
        const now = Date.now();
        q.insert.run(fid, JSON.stringify(data), JSON.stringify(summary), now, now, now);
        return send(res, 201, row(q.get.get(fid)));
      }
      return send(res, 405, { error: 'method' });
    }
    const r = q.get.get(id);
    if (!r) return send(res, 404, { error: 'no such flight' });
    if (parts[2] === 'restore' && req.method === 'POST') { q.del.run(0, id); return send(res, 200, row(q.get.get(id))); }
    if (parts[2] === 'opened' && req.method === 'POST') { q.opened.run(Date.now(), id); return send(res, 204); }
    if (req.method === 'GET') return send(res, 200, row(r));
    if (req.method === 'PUT') {
      const { data, summary = {}, version } = await readJson(req);
      const out = q.update.run(JSON.stringify(data), JSON.stringify(summary), Date.now(), id, version);
      if (!out.changes) return send(res, 409, row(q.get.get(id)));    // edited elsewhere meanwhile
      return send(res, 200, { version: version + 1 });
    }
    if (req.method === 'DELETE') { q.del.run(1, id); return send(res, 204); }
    return send(res, 405, { error: 'method' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname.slice(5).split('/').filter(Boolean));
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const p = path.join(ROOT, rel);
      if (!STATIC.has(rel.split('/')[0]) || !p.startsWith(ROOT + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(p).pipe(res);
    } catch (e) {
      send(res, 400, { error: String(e.message || e) });
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +(process.env.PORT || 8765);
  const host = process.env.HOST || '127.0.0.1';
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const allowedEmails = (process.env.NAVLOG_ALLOWED_EMAILS || '').split(',');
  if (googleClientId && !allowedEmails.join('').trim()) { console.error('Set NAVLOG_ALLOWED_EMAILS to the Google account(s) allowed to sign in.'); process.exit(1); }
  createServer({ db: process.env.NAVLOG_DB || undefined, googleClientId, allowedEmails })
    .listen(port, host, () => console.log(`Navlog: http://${host}:${port}/${googleClientId ? ' (Google sign-in)' : ''}`));
}
