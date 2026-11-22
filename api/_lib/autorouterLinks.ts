// Pilots' own autorouter accounts (autorouter_links, migration 060). autorouter's licence forbids passing
// its NOTAMs on, so every pilot files and is briefed with an account of their own, linked to this site by
// OAuth 2.0 authorization code (wiki: authentication). Dormant until autorouter registers the app:
// AUTOROUTER_CLIENT_ID and AUTOROUTER_CLIENT_SECRET.
//   GET  https://www.autorouter.aero/authorize   client_id, redirect_uri, response_type=code, state
//   POST /oauth2/token                           grant_type=authorization_code, code (valid 30 s), redirect_uri
//                                                grant_type=refresh_token, when autorouter issued one
// autorouter documents no revocation and no way to read the account's name: disconnecting forgets the
// token here, and the account is shown only when the token answer names it.
// Tokens are sealed at rest (AES-256-GCM, AUTOROUTER_TOKEN_KEY, else a key derived from the client
// secret). One token per pilot is reused by every server instance (autorouter caps the live tokens per
// account) until it is refused; then it is renewed with the refresh token, or the link is marked broken
// and the pilot reconnects.
import crypto from 'node:crypto';

import type { AutorouterLinkStatus } from '../../src/shared/api.js';
import { AUTOROUTER_BASE, AutorouterClient, AutorouterError, type BearerSource } from './autorouter.js';
import type { Queryable } from './db.js';

export const AUTHORIZE_URL = 'https://www.autorouter.aero/authorize';
/** How long a pilot has to approve on autorouter's page. */
const STATE_MS = 10 * 60e3;
/** The app's ticket only opens the flow in the sign-in sheet, right away. */
const TICKET_MS = 2 * 60e3;
const TIMEOUT_MS = 15000;
/** A token this close to its expiry is renewed first. */
const MARGIN_MS = 60e3;
/** Binds the flow to the browser that started it: an attacker's callback link fails in the victim's browser. */
export const NONCE_COOKIE = 'pgf_ar_oauth';

export interface AutorouterOAuthSettings {
  clientId: string;
  clientSecret: string;
  /** AUTOROUTER_TOKEN_KEY; '' → derived from the client secret (a new secret then needs every pilot to reconnect). */
  tokenKey: string;
  /** AUTOROUTER_REDIRECT_URI; '' → <origin>/api/autorouter/callback. Must equal the URI registered with autorouter. */
  redirectUri: string;
  /** Filing through linked accounts (AUTOROUTER_FILING=0 turns it off). */
  filing: boolean;
  /** Injectable for tests (nothing is ever sent to autorouter in tests). */
  authorizeUrl?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function autorouterOAuthFromEnv(env: NodeJS.ProcessEnv = process.env): AutorouterOAuthSettings | null {
  const clientId = (env.AUTOROUTER_CLIENT_ID || '').trim();
  const clientSecret = env.AUTOROUTER_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    tokenKey: env.AUTOROUTER_TOKEN_KEY || '',
    redirectUri: (env.AUTOROUTER_REDIRECT_URI || '').trim(),
    filing: env.AUTOROUTER_FILING !== '0',
  };
}

// ---- keys, sealing, signed tokens

interface Keys {
  seal: Buffer;
  sign: Buffer;
}
const keyCache = new WeakMap<AutorouterOAuthSettings, Keys>();
function keys(s: AutorouterOAuthSettings): Keys {
  let k = keyCache.get(s);
  if (!k) {
    const root = s.tokenKey
      ? crypto.createHash('sha256').update(s.tokenKey).digest()
      : Buffer.from(crypto.hkdfSync('sha256', s.clientSecret, 'pigsgottafly', 'autorouter-link-root', 32));
    const sub = (info: string) => Buffer.from(crypto.hkdfSync('sha256', root, '', info, 32));
    k = { seal: sub('autorouter-tokens'), sign: sub('autorouter-state') };
    keyCache.set(s, k);
  }
  return k;
}

export function seal(s: AutorouterOAuthSettings, text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keys(s).seal, iv);
  const out = Buffer.concat([c.update(text, 'utf8'), c.final(), c.getAuthTag()]);
  return `v1.${iv.toString('base64url')}.${out.toString('base64url')}`;
}

/** null when it does not open (another key, tampered). */
export function unseal(s: AutorouterOAuthSettings, sealed: string | null): string | null {
  const m = /^v1\.([\w-]+)\.([\w-]+)$/.exec(sealed || '');
  if (!m) return null;
  try {
    const iv = Buffer.from(m[1], 'base64url');
    const data = Buffer.from(m[2], 'base64url');
    if (iv.length !== 12 || data.length < 17) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', keys(s).seal, iv);
    d.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const mac = (s: AutorouterOAuthSettings, body: string) =>
  crypto.createHmac('sha256', keys(s).sign).update(body).digest('base64url');

function signed(s: AutorouterOAuthSettings, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(s, body)}`;
}

function verified<T extends { k: string; e: number }>(
  s: AutorouterOAuthSettings,
  token: string | null,
  kind: T['k'],
  now: number,
): T | null {
  const [body, sig, extra] = String(token || '').split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(s, body));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    return p && p.k === kind && Number(p.e) > now ? p : null;
  } catch {
    return null;
  }
}

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('base64url');

/** Where the pilot returns: a path on this site, or the iOS app. */
export type ReturnTo = string;
export const APP_RETURN = 'app';

interface StatePayload {
  k: 'state';
  /** The pilot. */
  p: string;
  r: ReturnTo;
  /** Hash of the nonce cookie set in the browser that started. */
  n: string;
  e: number;
}

/** The authorize URL and the nonce cookie's value, for the pilot who starts the flow. */
export function beginLink(
  s: AutorouterOAuthSettings,
  pilotId: string,
  ret: ReturnTo,
  redirectUri: string,
): { url: string; nonce: string } {
  const now = (s.now || Date.now)();
  const nonce = crypto.randomBytes(18).toString('base64url');
  const state = signed(s, { k: 'state', p: pilotId, r: ret, n: sha(nonce), e: now + STATE_MS } satisfies StatePayload);
  const url = new URL(s.authorizeUrl || AUTHORIZE_URL);
  url.searchParams.set('client_id', s.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return { url: url.toString(), nonce };
}

/** The state autorouter handed back, checked against the browser's nonce: the pilot and where to return, or null. */
export function checkState(
  s: AutorouterOAuthSettings,
  state: string | null,
  nonce: string | null,
): { pilotId: string; ret: ReturnTo } | null {
  const p = verified<StatePayload>(s, state, 'state', (s.now || Date.now)());
  if (!p || !nonce) return null;
  const a = Buffer.from(sha(nonce));
  const b = Buffer.from(String(p.n));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? { pilotId: p.p, ret: p.r } : null;
}

/** The iOS app's ticket: opens the flow in the sign-in sheet, which does not share the app's session. */
export const appTicket = (s: AutorouterOAuthSettings, pilotId: string): string =>
  signed(s, { k: 'ticket', p: pilotId, e: (s.now || Date.now)() + TICKET_MS });
export const checkTicket = (s: AutorouterOAuthSettings, t: string | null): string | null =>
  verified<{ k: 'ticket'; p: string; e: number }>(s, t, 'ticket', (s.now || Date.now)())?.p ?? null;

// ---- the token endpoint

interface TokenSet {
  access: string;
  refresh: string | null;
  expires: number | null;
  account: string | null;
}
type TokenAnswer = { ok: true; token: TokenSet } | { ok: false; error: string; definitive: boolean };

async function tokenRequest(s: AutorouterOAuthSettings, params: Record<string, string>): Promise<TokenAnswer> {
  const base = (s.baseUrl || AUTOROUTER_BASE).replace(/\/+$/, '');
  const now = (s.now || Date.now)();
  let res: Response;
  try {
    res = await (s.fetch || fetch)(`${base}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ ...params, client_id: s.clientId, client_secret: s.clientSecret }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e), definitive: false };
  }
  const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const access = str(b.access_token);
  if (!res.ok || !access) {
    // autorouter's error text is safe to show; the request's secrets are never echoed
    const error = str(b.error_description) || str(b.error) || `HTTP ${res.status}`;
    return { ok: false, error, definitive: res.status < 500 };
  }
  const ttl = Number(b.expires_in);
  return {
    ok: true,
    token: {
      access,
      refresh: str(b.refresh_token),
      expires: ttl > 0 ? now + ttl * 1000 : null,
      account: str(b.email) || str(b.username) || str(b.user),
    },
  };
}

export async function exchangeCode(
  s: AutorouterOAuthSettings,
  code: string,
  redirectUri: string,
): Promise<TokenAnswer> {
  return tokenRequest(s, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

// ---- the table

export interface LinkRow {
  pilot_id: string;
  account: string | null;
  access_token: string;
  refresh_token: string | null;
  expires: string | number | null;
  linked_at: string | number;
  broken_at: string | number | null;
  last_error: string | null;
}

export async function readLink(db: Queryable, pilotId: string): Promise<LinkRow | null> {
  const [r] = await db.query<LinkRow>('SELECT * FROM autorouter_links WHERE pilot_id = $1', [pilotId]);
  return r ?? null;
}

export async function saveLink(db: Queryable, s: AutorouterOAuthSettings, pilotId: string, t: TokenSet) {
  const now = (s.now || Date.now)();
  await db.query(
    `INSERT INTO autorouter_links (pilot_id, account, access_token, refresh_token, expires, linked_at, updated)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (pilot_id) DO UPDATE SET account = EXCLUDED.account, access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token, expires = EXCLUDED.expires, linked_at = EXCLUDED.linked_at,
       updated = EXCLUDED.updated, broken_at = NULL, last_error = NULL`,
    [pilotId, t.account, seal(s, t.access), t.refresh ? seal(s, t.refresh) : null, t.expires, now],
  );
}

export async function deleteLink(db: Queryable, pilotId: string): Promise<void> {
  await db.query('DELETE FROM autorouter_links WHERE pilot_id = $1', [pilotId]);
}

export function linkStatus(s: AutorouterOAuthSettings | null | undefined, r: LinkRow | null): AutorouterLinkStatus {
  return {
    enabled: !!s,
    connected: !!s && !!r && !r.broken_at,
    broken: !!s && !!r && !!r.broken_at,
    account: s && r ? r.account : null,
    linkedAt: s && r ? Number(r.linked_at) : null,
  };
}

// ---- a linked account's client

const brokenError = () =>
  new AutorouterError('autorouter refused your connection: reconnect autorouter on your profile', 502);

/**
 * The bearer token of a pilot's link, read once per request (the row the request resolved), renewed
 * when it expires or autorouter refuses it. Two instances may renew at once: a refresh refused after
 * another instance already stored a new token adopts that one instead of breaking the link.
 */
export function linkedBearer(db: Queryable, s: AutorouterOAuthSettings, row: LinkRow): BearerSource {
  const now = s.now || Date.now;
  const pilotId = row.pilot_id;
  let sealed = row.access_token;
  let access = unseal(s, row.access_token);
  let expires = row.expires == null ? null : Number(row.expires);
  let renewing: Promise<void> | null = null;
  const stale = (exp: number | null) => exp !== null && exp < now() + MARGIN_MS;

  const markBroken = async (why: string) => {
    await db.query('UPDATE autorouter_links SET broken_at = $2, last_error = $3, updated = $2 WHERE pilot_id = $1', [
      pilotId,
      now(),
      why.slice(0, 300),
    ]);
  };
  /** Takes a newer token another instance stored, if there is a usable one. */
  const adopt = (r: LinkRow | null): boolean => {
    if (!r || r.broken_at || r.access_token === sealed) return false;
    const a = unseal(s, r.access_token);
    const exp = r.expires == null ? null : Number(r.expires);
    if (!a || stale(exp)) return false;
    sealed = r.access_token;
    access = a;
    expires = exp;
    return true;
  };

  const renew = async (): Promise<void> => {
    const cur = await readLink(db, pilotId);
    if (!cur || cur.broken_at) throw brokenError();
    if (adopt(cur)) return;
    const refresh = unseal(s, cur.refresh_token);
    if (!refresh) {
      await markBroken(access ? 'autorouter refused the token' : 'the stored token could not be read');
      throw brokenError();
    }
    const r = await tokenRequest(s, { grant_type: 'refresh_token', refresh_token: refresh });
    if (!r.ok) {
      if (!r.definitive) throw new AutorouterError(`autorouter did not renew the connection: ${r.error}`, 502);
      if (adopt(await readLink(db, pilotId))) return;
      await markBroken(r.error);
      throw brokenError();
    }
    const t = r.token;
    const next = seal(s, t.access);
    await db.query(
      `UPDATE autorouter_links SET access_token = $2, refresh_token = COALESCE($3, refresh_token), expires = $4,
         updated = $5, account = COALESCE($6, account) WHERE pilot_id = $1`,
      [pilotId, next, t.refresh ? seal(s, t.refresh) : null, t.expires, now(), t.account],
    );
    sealed = next;
    access = t.access;
    expires = t.expires;
  };
  const once = () => (renewing ||= renew().finally(() => (renewing = null)));

  return {
    async get() {
      if (!access || stale(expires)) await once();
      return access!;
    },
    async refused() {
      await once();
    },
  };
}

/** A client that acts as the pilot's own account. */
export function linkedClient(db: Queryable, s: AutorouterOAuthSettings, row: LinkRow): AutorouterClient {
  return new AutorouterClient(
    { email: '', password: '', filing: s.filing, fetch: s.fetch, baseUrl: s.baseUrl, now: s.now, sleep: s.sleep },
    null,
    linkedBearer(db, s, row),
  );
}
