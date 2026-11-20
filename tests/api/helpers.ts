// Test helpers: an API server on in-memory PGlite with Google (and Apple) sign-in faked by a local RSA key.
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createServer } from '../../server/server';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
export const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' } as JsonWebKey;
export const CID = 'test-client.apps.googleusercontent.com';

export function signToken(claims: Record<string, unknown>, key: crypto.KeyObject = privateKey, kid = 'k1'): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
export const googleClaims = (sub: string, email: string) => ({
  iss: 'https://accounts.google.com',
  aud: CID,
  sub,
  email,
  name: email.split('@')[0],
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 600,
});

/** The Sign in with Apple Services ID of the test server (startApi({ apple: true })). */
export const APPLE_CID = 'com.example.pigsgottafly.web';
export const appleClaims = (sub: string, email: string, extra: Record<string, unknown> = {}) => ({
  iss: 'https://appleid.apple.com',
  aud: APPLE_CID,
  sub,
  email,
  email_verified: 'true',
  exp: Math.floor(Date.now() / 1000) + 600,
  ...extra,
});

export async function startApi(
  opts: { google?: boolean; apple?: boolean; allowedEmails?: string[]; adminEmails?: string[]; db?: string } = {},
) {
  const google = opts.google ?? true;
  const s = createServer({
    db: opts.db ?? 'memory://',
    googleClientId: google ? CID : '',
    googleKeys: async () => [JWK],
    appleClientId: opts.apple ? APPLE_CID : '',
    appleKeys: async () => [JWK],
    allowedEmails: opts.allowedEmails,
    adminEmails: opts.adminEmails,
    client: (_req, res) => {
      res.writeHead(404);
      res.end();
    },
  });
  await s.ready;
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/`;
  return { base, close: () => new Promise<void>((r) => s.close(() => r())), server: s };
}

export interface Client {
  call: <T = any>(method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
  login: (sub: string, email: string) => Promise<{ status: number; body: any }>;
}
export function client(base: string): Client {
  let cookie = '';
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(base + p, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  return { call, login: (sub, email) => call('POST', 'login', { credential: signToken(googleClaims(sub, email)) }) };
}
