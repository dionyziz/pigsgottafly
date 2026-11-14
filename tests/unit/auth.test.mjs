import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyGoogleToken } from '../../server/server.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const keys = async () => [jwk];
const CID = 'test-client.apps.googleusercontent.com';
export function sign(claims, key = privateKey, kid = 'k1') {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
const good = () => ({ iss: 'https://accounts.google.com', aud: CID, email: 'pilot@example.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 });

test('accepts a valid Google ID token', async () => {
  const c = await verifyGoogleToken(sign(good()), CID, keys);
  assert.equal(c.email, 'pilot@example.com');
});
test('rejects forged, foreign, expired and unverified tokens', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verifyGoogleToken(sign(good(), other), CID, keys), /bad signature/);
  await assert.rejects(verifyGoogleToken(sign({ ...good(), aud: 'someone-else' }), CID, keys), /audience/);
  await assert.rejects(verifyGoogleToken(sign({ ...good(), iss: 'evil.example' }), CID, keys), /issuer/);
  await assert.rejects(verifyGoogleToken(sign({ ...good(), exp: 100 }), CID, keys), /expired/);
  await assert.rejects(verifyGoogleToken(sign({ ...good(), email_verified: false }), CID, keys), /not verified/);
  await assert.rejects(verifyGoogleToken(sign(good(), privateKey, 'nope'), CID, keys), /unknown signing key/);
  await assert.rejects(verifyGoogleToken('a.b', CID, keys), /malformed/);
  const t = sign(good()).split('.');
  t[1] = Buffer.from(JSON.stringify({ ...good(), email: 'intruder@example.com' })).toString('base64url');
  await assert.rejects(verifyGoogleToken(t.join('.'), CID, keys), /bad signature/);
});
