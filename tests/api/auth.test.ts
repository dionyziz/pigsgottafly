import crypto from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { verifyGoogleToken } from '../../api/_lib/auth';
import { CID, googleClaims, JWK, signToken } from './helpers';

const keys = async () => [JWK];
const good = () => googleClaims('s1', 'pilot@example.com');

describe('verifyGoogleToken', () => {
  test('accepts a valid Google ID token', async () => {
    expect((await verifyGoogleToken(signToken(good()), CID, keys)).email).toBe('pilot@example.com');
  });
  test('rejects forged, foreign, expired and unverified tokens', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyGoogleToken(signToken(good(), other), CID, keys)).rejects.toThrow(/bad signature/);
    await expect(verifyGoogleToken(signToken({ ...good(), aud: 'someone-else' }), CID, keys)).rejects.toThrow(
      /audience/,
    );
    await expect(verifyGoogleToken(signToken({ ...good(), iss: 'evil.example' }), CID, keys)).rejects.toThrow(/issuer/);
    await expect(verifyGoogleToken(signToken({ ...good(), exp: 100 }), CID, keys)).rejects.toThrow(/expired/);
    await expect(verifyGoogleToken(signToken({ ...good(), email_verified: false }), CID, keys)).rejects.toThrow(
      /not verified/,
    );
    const fresh = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyGoogleToken(signToken(good(), fresh, 'nope'), CID, keys)).rejects.toThrow(/unknown signing key/);
    await expect(verifyGoogleToken('a.b', CID, keys)).rejects.toThrow(/malformed/);
    const t = signToken(good()).split('.');
    t[1] = Buffer.from(JSON.stringify({ ...good(), email: 'intruder@example.com' })).toString('base64url');
    await expect(verifyGoogleToken(t.join('.'), CID, keys)).rejects.toThrow(/bad signature/);
  });
});
