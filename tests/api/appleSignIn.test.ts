// Sign in with Apple: POST /login/apple with Apple's identity token (faked here with the test key).
import crypto from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { isAppleRelay, verifyAppleToken } from '../../api/_lib/auth';
import { APPLE_CID, appleClaims, client, JWK, signToken, startApi } from './helpers';

/** POST /login/apple as Apple's JS hands it over (the name only on the first sign-in). */
const appleLogin = (c: ReturnType<typeof client>, claims: Record<string, unknown>, name?: unknown) =>
  c.call('POST', 'login/apple', { idToken: signToken(claims), ...(name === undefined ? {} : { name }) });

describe('Sign in with Apple', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  beforeAll(async () => {
    api = await startApi({ apple: true });
  });
  afterAll(() => api.close());

  test('GET /session offers Apple next to Google', async () => {
    const s = (await client(api.base).call('GET', 'session')).body;
    expect(s).toMatchObject({ authed: false, mode: 'google', appleClientId: APPLE_CID });
  });

  test('a valid token creates a pilot and a session; the next sign-in finds it by sub', async () => {
    const c = client(api.base);
    const r = await appleLogin(c, appleClaims('apple-1', 'new.pilot@example.com'), {
      firstName: 'Nea',
      lastName: 'Pilotos',
    });
    expect(r.status).toBe(200);
    expect(r.body.pilot.email).toBe('new.pilot@example.com');
    const s = (await c.call('GET', 'session')).body;
    expect(s).toMatchObject({ authed: true, pilot: { email: 'new.pilot@example.com' } });
    const id = s.pilot.id;
    expect((await c.call('GET', 'aircraft')).body).toEqual([]);

    // later sign-ins: no name from Apple, the same pilot (a new e-mail from Apple follows)
    const c2 = client(api.base);
    const again = await appleLogin(c2, appleClaims('apple-1', 'renamed@example.com'));
    expect(again.status).toBe(200);
    expect(again.body.pilot.id).toBe(id);
    expect(again.body.pilot.email).toBe('renamed@example.com');
    const x = (await c2.call('GET', 'me/export')).body;
    expect(x.account).toMatchObject({ id, googleSubject: null, appleSubject: 'apple-1', googleName: 'Nea Pilotos' });
  });

  test('a verified e-mail of an existing Google pilot links that pilot', async () => {
    const g = client(api.base);
    const gp = (await g.login('google-link', 'Linked.Pilot@example.com')).body.pilot;
    const c = client(api.base);
    const r = await appleLogin(c, appleClaims('apple-link', 'linked.pilot@EXAMPLE.com'));
    expect(r.status).toBe(200);
    expect(r.body.pilot.id).toBe(gp.id);
    expect(r.body.pilot.email).toBe('Linked.Pilot@example.com');
    // both sign-ins keep working, onto the one pilot
    expect((await client(api.base).login('google-link', 'Linked.Pilot@example.com')).body.pilot.id).toBe(gp.id);
    expect((await appleLogin(client(api.base), appleClaims('apple-link', 'x@example.com'))).body.pilot.id).toBe(gp.id);
    // the Google sign-in still owns the e-mail
    expect((await c.call('GET', 'me')).body.email).toBe('Linked.Pilot@example.com');
  });

  test('a Hide My Email relay address never links another pilot', async () => {
    const relay = 'abc123@privaterelay.appleid.com';
    const g = client(api.base);
    const gp = (await g.login('google-relay', relay)).body.pilot;
    const r = await appleLogin(client(api.base), appleClaims('apple-relay', relay, { is_private_email: 'true' }));
    expect(r.status).toBe(200);
    expect(r.body.pilot.id).not.toBe(gp.id);
    // by the domain alone too
    const r2 = await appleLogin(client(api.base), appleClaims('apple-relay-2', relay));
    expect(r2.body.pilot.id).not.toBe(gp.id);
    expect(r2.body.pilot.id).not.toBe(r.body.pilot.id);
  });

  test('wrong audience, wrong issuer, expired, unverified or forged tokens: 401', async () => {
    const c = client(api.base);
    const good = () => appleClaims('apple-bad', 'bad@example.com');
    for (const claims of [
      { ...good(), aud: 'someone.else' },
      { ...good(), iss: 'https://accounts.google.com' },
      { ...good(), exp: 100 },
      { ...good(), email_verified: false },
      { ...good(), email_verified: undefined },
      { ...good(), email: undefined },
    ])
      expect((await appleLogin(c, claims)).status).toBe(401);
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect((await c.call('POST', 'login/apple', { idToken: signToken(good(), other) })).status).toBe(401);
    expect((await c.call('POST', 'login/apple', { idToken: 'a.b' })).status).toBe(401);
    expect((await c.call('POST', 'login/apple', {})).status).toBe(400);
    expect((await c.call('GET', 'session')).body.authed).toBe(false);
  });
});

describe('Sign in with Apple: configuration and access', () => {
  test('APPLE_CLIENT_ID unset: 404, and no Apple button', async () => {
    const s = await startApi();
    try {
      const c = client(s.base);
      expect((await c.call('GET', 'session')).body.appleClientId).toBeNull();
      expect((await appleLogin(c, appleClaims('apple-off', 'off@example.com'))).status).toBe(404);
    } finally {
      await s.close();
    }
  });

  test('ALLOWED_EMAILS limits who can sign in with Apple', async () => {
    const s = await startApi({ apple: true, allowedEmails: ['pilot@example.com'] });
    try {
      expect((await appleLogin(client(s.base), appleClaims('a-x', 'other@example.com'))).status).toBe(403);
      expect((await appleLogin(client(s.base), appleClaims('a-y', 'Pilot@example.com'))).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});

describe('verifyAppleToken', () => {
  const keys = async () => [JWK];
  test('accepts a valid identity token (boolean or string email_verified)', async () => {
    expect((await verifyAppleToken(signToken(appleClaims('s', 'p@example.com')), APPLE_CID, keys)).sub).toBe('s');
    const t = signToken(appleClaims('s', 'p@example.com', { email_verified: true }));
    expect((await verifyAppleToken(t, APPLE_CID, keys)).email).toBe('p@example.com');
  });
  test('an empty client id accepts nothing', async () => {
    await expect(verifyAppleToken(signToken(appleClaims('s', 'p@example.com', { aud: '' })), '', keys)).rejects.toThrow(
      /audience/,
    );
  });
  test('relay addresses', () => {
    expect(isAppleRelay({ email: 'x@privaterelay.appleid.com' })).toBe(true);
    expect(isAppleRelay({ email: 'x@example.com', is_private_email: true })).toBe(true);
    expect(isAppleRelay({ email: 'x@example.com', is_private_email: 'false' })).toBe(false);
  });
});
