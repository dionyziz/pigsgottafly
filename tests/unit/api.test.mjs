// Flights API on Postgres (in-memory PGlite): accounts, isolation between pilots, versions, trash.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from '../../server/server.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const CID = 'test-client.apps.googleusercontent.com';
const sign = (sub, email) => {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CID, sub, email, name: email.split('@')[0], email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
};

let server, base;
async function start(opts) {
  const s = createServer({ db: 'memory://', googleClientId: CID, googleKeys: async () => [jwk], ...opts });
  await s.ready;
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
}
before(async () => { server = await start(); base = `http://127.0.0.1:${server.address().port}/api/`; });
after(() => server.close());

function client(url = base) {
  let cookie = '';
  const call = async (method, p, body) => {
    const r = await fetch(url + p, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  return { call, login: (sub, email) => call('POST', 'login', { credential: sign(sub, email) }), get cookie() { return cookie; } };
}

test('each pilot sees only their own flights', async () => {
  const a = client(), b = client();
  assert.equal((await a.call('GET', 'flights')).status, 401);
  assert.equal((await a.login('sub-a', 'a@example.com')).status, 200);
  assert.equal((await b.login('sub-b', 'b@example.com')).status, 200);
  const f = (await a.call('POST', 'flights', { data: { route: 'LGMG-LGEL' }, summary: { title: 'Megara' } })).body;
  assert.equal(f.version, 1);
  assert.deepEqual(f.data, { route: 'LGMG-LGEL' });
  assert.equal((await a.call('GET', 'flights')).body.length, 1);
  assert.equal((await b.call('GET', 'flights')).body.length, 0);
  assert.equal((await b.call('GET', `flights/${f.id}`)).status, 404);
  assert.equal((await b.call('PUT', `flights/${f.id}`, { data: {}, version: 1 })).status, 404);
  assert.equal((await b.call('DELETE', `flights/${f.id}`)).status, 404);
  // B cannot claim A's id either: gets a fresh one
  const g = (await b.call('POST', 'flights', { id: f.id, data: {} })).body;
  assert.notEqual(g.id, f.id);
  assert.deepEqual((await a.call('GET', `flights/${f.id}`)).body.data, { route: 'LGMG-LGEL' });
});

test('versions, conflicts, trash and restore', async () => {
  const a = client();
  await a.login('sub-c', 'c@example.com');
  const f = (await a.call('POST', 'flights', { id: 'myflight1', data: { n: 1 } })).body;
  assert.equal(f.id, 'myflight1');
  assert.deepEqual((await a.call('PUT', 'flights/myflight1', { data: { n: 2 }, summary: {}, version: 1 })).body, { version: 2 });
  const stale = await a.call('PUT', 'flights/myflight1', { data: { n: 3 }, version: 1 });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.data, { n: 2 });
  assert.equal((await a.call('DELETE', 'flights/myflight1')).status, 204);
  assert.equal((await a.call('GET', 'flights')).body.length, 0);
  assert.equal((await a.call('POST', 'flights/myflight1/restore')).body.deleted, false);
  assert.equal((await a.call('GET', 'flights')).body.length, 1);
});

test('signing in again keeps the same account; sign-out ends the session', async () => {
  const a = client();
  await a.login('sub-d', 'd@example.com');
  await a.call('POST', 'flights', { data: {} });
  const again = client();
  await again.login('sub-d', 'd.new@example.com');
  assert.equal((await again.call('GET', 'flights')).body.length, 1);
  assert.equal((await again.call('GET', 'session')).body.user.email, 'd.new@example.com');
  await again.call('POST', 'logout');
  assert.equal((await again.call('GET', 'flights')).status, 401);
  assert.equal((await a.call('GET', 'flights')).status, 200, 'other sessions stay signed in');
});

test('ALLOWED_EMAILS limits who can sign in', async () => {
  const s = await start({ allowedEmails: ['pilot@example.com'] });
  try {
    const url = `http://127.0.0.1:${s.address().port}/api/`;
    assert.equal((await client(url).login('x', 'other@example.com')).status, 403);
    assert.equal((await client(url).login('y', 'Pilot@example.com')).status, 200);
  } finally { s.close(); }
});
