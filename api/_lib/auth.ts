// Sign-in: Google Identity Services ID tokens, verified here (RS256 against Google's JWKs), then a
// random session token in an HttpOnly cookie; the database keeps only its SHA-256 hash.
// Without a Google client id (local mode) every request is the one 'local' pilot.
import crypto from 'node:crypto';
import type { Queryable } from './db.js';
import type { ApiConfig, Req } from './http.js';

export const COOKIE = 'pgf_session';
/** A session ends after 90 days without use (sliding: renewed when older than SESSION_RENEW_MS). */
export const SESSION_MS = 90 * 24 * 3600e3;
export const SESSION_RENEW_MS = 7 * 24 * 3600e3;

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google's signing keys are refetched after this long. */
const GOOGLE_CERTS_TTL_MS = 3600e3;
let certCache: { at: number; keys: JsonWebKey[] } = { at: 0, keys: [] };
export async function googleKeys(): Promise<JsonWebKey[]> {
  if (Date.now() - certCache.at < GOOGLE_CERTS_TTL_MS && certCache.keys.length) return certCache.keys;
  const r = await fetch(GOOGLE_CERTS);
  certCache = { at: Date.now(), keys: ((await r.json()) as { keys: JsonWebKey[] }).keys };
  return certCache.keys;
}

export interface GoogleClaims {
  sub?: string;
  email: string;
  email_verified: boolean | string;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
  exp: number;
}

/** Verify a Google ID token (JWT, RS256) and return its claims, or throw. */
export async function verifyGoogleToken(
  token: string,
  clientId: string,
  getKeys: () => Promise<JsonWebKey[]> = googleKeys,
): Promise<GoogleClaims> {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, sig] = parts;
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as GoogleClaims;
  if (header.alg !== 'RS256') throw new Error('unexpected algorithm');
  const jwk = (await getKeys()).find((k) => (k as any).kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    crypto.createPublicKey({ key: jwk as any, format: 'jwk' }),
    Buffer.from(sig, 'base64url'),
  );
  if (!ok) throw new Error('bad signature');
  if (claims.aud !== clientId) throw new Error('wrong audience');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('wrong issuer');
  if (!(claims.exp * 1000 > Date.now())) throw new Error('expired');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('email not verified');
  return claims;
}

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('base64url');

export function sessionCookie(value: string, maxAgeSec: number, secure: boolean): string {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function tokenFrom(req: Req): string | undefined {
  return (new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)`).exec(req.headers.cookie || '') || [])[1];
}

/** Creates a session for a pilot; returns the raw token for the cookie. */
export async function createSession(q: Queryable, pilotId: string): Promise<string> {
  const tok = crypto.randomBytes(24).toString('base64url');
  await q.query('INSERT INTO sessions (token_hash, pilot_id, created) VALUES ($1, $2, $3)', [
    hashToken(tok),
    pilotId,
    Date.now(),
  ]);
  return tok;
}

/**
 * The pilot row of a valid session, or null. With an allow-list, a pilot whose email is no longer on
 * it is signed out everywhere (all their sessions are deleted), not just refused at the next login.
 */
export async function sessionPilotRow(
  q: Queryable,
  req: Req,
  allowedEmails: string[] = [],
  onRenew?: (token: string) => void,
): Promise<Record<string, any> | null> {
  const t = tokenFrom(req);
  if (!t) return null;
  const now = Date.now();
  const [row] = await q.query(
    `SELECT p.*, s.created AS session_created FROM sessions s JOIN pilots p ON p.id = s.pilot_id WHERE s.token_hash = $1 AND s.created > $2`,
    [hashToken(t), now - SESSION_MS],
  );
  if (!row) return null;
  if (!emailAllowed(row.email, allowedEmails)) {
    await q.query('DELETE FROM sessions WHERE pilot_id = $1', [row.id]);
    return null;
  }
  // sliding expiry: a session in use is renewed once a week (the cookie with it)
  if (Number(row.session_created) < now - SESSION_RENEW_MS) {
    await q.query('UPDATE sessions SET created = $2 WHERE token_hash = $1', [hashToken(t), now]);
    onRenew?.(t);
  }
  delete row.session_created;
  return row;
}

/** Deletes the expired sessions of every pilot (on sign-in: cheap, and often enough). */
export async function purgeExpiredSessions(q: Queryable): Promise<void> {
  await q.query('DELETE FROM sessions WHERE created < $1', [Date.now() - SESSION_MS]);
}

/** True when the allow-list is empty (anyone) or contains the email (case-insensitive). */
export function emailAllowed(email: unknown, allowedEmails: string[]): boolean {
  return (
    !allowedEmails.length ||
    allowedEmails.includes(
      String(email || '')
        .trim()
        .toLowerCase(),
    )
  );
}

/** Local mode: the single 'local' pilot, created on first use (empty profile, empty hangar). */
export async function localPilotRow(q: Queryable): Promise<Record<string, any>> {
  const now = Date.now();
  await q.query(
    `INSERT INTO pilots (id, email, name, created, last_login, seeded_at) VALUES ('local', '', '', $1, $1, $1) ON CONFLICT (id) DO NOTHING`,
    [now],
  );
  const [row] = await q.query(`SELECT * FROM pilots WHERE id = 'local'`);
  return row;
}

/** An admin: a signed-in pilot whose e-mail is in adminEmails (nobody when the list is empty). */
export function isAdmin(config: Pick<ApiConfig, 'adminEmails'>, p: { email?: string | null } | null): boolean {
  const email = String(p?.email || '')
    .trim()
    .toLowerCase();
  return !!email && (config.adminEmails ?? []).includes(email);
}
