// The flights API, shared by the local server (server/server.mjs) and the Vercel function (api/index.mjs).
//
// Accounts: with a Google client ID, anyone who signs in with Google gets their own flights
// (or only ALLOWED_EMAILS, when that list is set). Sessions are an HttpOnly cookie that lasts a year;
// the database keeps only a hash of each session token.
// Without a Google client ID the API is open and every flight belongs to one 'local' user,
// for running on your own computer.
import crypto from 'node:crypto';

const COOKIE = 'pgf_session';
const SESSION_MS = 365 * 24 * 3600e3;

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

const hash = (t) => crypto.createHash('sha256').update(t).digest('base64url');
const newId = (n = 6) => crypto.randomBytes(n).toString('base64url');
const flight = (r) => r && { id: r.id, data: r.data, summary: r.summary, version: r.version, created: Number(r.created), updated: Number(r.updated), deleted: r.deleted };

// db: from openDb(). Returns handle(req, res) for /api/… requests (Node req/res).
export function createApi({ db, googleClientId = '', allowedEmails = [], googleKeys: getKeys = googleKeys, secureCookie = false }) {
  const allowed = new Set(allowedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const q = db.query;
  let localUser = null;
  async function local() {
    if (!localUser) {
      const now = Date.now();
      await q(`INSERT INTO users (id, email, name, created, last_login) VALUES ('local', '', '', $1, $1) ON CONFLICT (id) DO NOTHING`, [now]);
      localUser = { id: 'local' };
    }
    return localUser;
  }

  const cookie = (v, maxAge) => `${COOKIE}=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  const token = (req) => (new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)`).exec(req.headers.cookie || '') || [])[1];
  async function sessionUser(req) {
    const t = token(req);
    if (!t) return null;
    const [u] = await q(`SELECT u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id
                         WHERE s.token_hash = $1 AND s.created > $2`, [hash(t), Date.now() - SESSION_MS]);
    return u || null;
  }
  const currentUser = (req) => (googleClientId ? sessionUser(req) : local());

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  async function readJson(req) {
    if (req.body !== undefined && req.body !== null) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;   // pre-parsed (Vercel)
    let s = '';
    for await (const c of req) { s += c; if (s.length > 5e6) throw new Error('too large'); }
    return s ? JSON.parse(s) : {};
  }

  async function route(req, res, parts) {
    if (parts[0] === 'session' && req.method === 'GET') {
      const u = await currentUser(req);
      return send(res, 200, { authed: !!u, googleClientId: googleClientId || null,
        user: googleClientId && u ? { name: u.name, email: u.email, picture: u.picture } : null });
    }
    if (parts[0] === 'logout' && req.method === 'POST') {
      const t = token(req); if (t) await q('DELETE FROM sessions WHERE token_hash = $1', [hash(t)]);
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
    }
    if (parts[0] === 'login' && req.method === 'POST' && googleClientId) {
      const { credential } = await readJson(req);
      let claims;
      try { claims = await verifyGoogleToken(credential, googleClientId, getKeys); } catch (e) { return send(res, 401, { error: 'sign-in failed' }); }
      const email = String(claims.email);
      if (allowed.size && !allowed.has(email.toLowerCase())) return send(res, 403, { error: `${email} is not allowed` });
      const sub = claims.sub ? String(claims.sub) : `email:${email.toLowerCase()}`;
      const now = Date.now();
      const user = { name: claims.name || '', email, picture: claims.picture || '' };
      const [u] = await q(`INSERT INTO users (id, google_sub, email, name, picture, created, last_login) VALUES ($1, $2, $3, $4, $5, $6, $6)
                           ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, last_login = EXCLUDED.last_login
                           RETURNING id`, [newId(9), sub, email, user.name, user.picture, now]);
      const tok = crypto.randomBytes(24).toString('base64url');
      await q('INSERT INTO sessions (token_hash, user_id, created) VALUES ($1, $2, $3)', [hash(tok), u.id, now]);
      return send(res, 200, { ok: true, user }, { 'Set-Cookie': cookie(tok, SESSION_MS / 1000) });
    }
    const me = await currentUser(req);
    if (!me) return send(res, 401, { error: 'sign in' });
    if (parts[0] !== 'flights') return send(res, 404, { error: 'not found' });
    const id = parts[1];
    const get = async (fid) => flight((await q('SELECT * FROM flights WHERE id = $1 AND owner = $2', [fid, me.id]))[0]);
    if (!id) {
      if (req.method === 'GET') {
        const rows = await q(`SELECT id, summary, version, created, updated, opened FROM flights
                              WHERE owner = $1 AND NOT deleted ORDER BY GREATEST(updated, opened) DESC`, [me.id]);
        return send(res, 200, rows.map((r) => ({ id: r.id, summary: r.summary, version: r.version, created: Number(r.created), updated: Number(r.updated), opened: Number(r.opened) })));
      }
      if (req.method === 'POST') {
        const { data = {}, summary = {}, id: wanted } = await readJson(req);
        const now = Date.now();
        const insert = (fid) => q(`INSERT INTO flights (id, owner, data, summary, created, updated, opened) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $5, $5)
                                   ON CONFLICT (id) DO NOTHING RETURNING id`, [fid, me.id, JSON.stringify(data), JSON.stringify(summary), now]);
        let rows = typeof wanted === 'string' && /^[\w-]{6,24}$/.test(wanted) ? await insert(wanted) : [];
        while (!rows.length) rows = await insert(newId());
        return send(res, 201, await get(rows[0].id));
      }
      return send(res, 405, { error: 'method' });
    }
    const r = await get(id);
    if (!r) return send(res, 404, { error: 'no such flight' });
    if (parts[2] === 'restore' && req.method === 'POST') {
      await q('UPDATE flights SET deleted = FALSE WHERE id = $1 AND owner = $2', [id, me.id]);
      return send(res, 200, await get(id));
    }
    if (parts[2] === 'opened' && req.method === 'POST') {
      await q('UPDATE flights SET opened = $1 WHERE id = $2 AND owner = $3', [Date.now(), id, me.id]);
      return send(res, 204);
    }
    if (req.method === 'GET') return send(res, 200, r);
    if (req.method === 'PUT') {
      const { data, summary = {}, version } = await readJson(req);
      const out = await q(`UPDATE flights SET data = $1::jsonb, summary = $2::jsonb, version = version + 1, updated = $3
                           WHERE id = $4 AND owner = $5 AND version = $6 RETURNING version`, [JSON.stringify(data), JSON.stringify(summary), Date.now(), id, me.id, version]);
      if (!out.length) return send(res, 409, await get(id));    // edited elsewhere meanwhile
      return send(res, 200, { version: out[0].version });
    }
    if (req.method === 'DELETE') {
      await q('UPDATE flights SET deleted = TRUE WHERE id = $1 AND owner = $2', [id, me.id]);
      return send(res, 204);
    }
    return send(res, 405, { error: 'method' });
  }

  return async function handle(req, res) {
    try {
      const parts = new URL(req.url, 'http://x').pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
      await route(req, res, parts);
    } catch (e) {
      if (!res.headersSent) send(res, 400, { error: String(e.message || e) });
    }
  };
}

export function configFromEnv(env = process.env) {
  return {
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    allowedEmails: (env.ALLOWED_EMAILS || '').split(','),
  };
}
