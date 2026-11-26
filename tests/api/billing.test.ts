// The subscription: entitlement rules, the 402 paywall (BILLING_ENFORCE), Paddle's signed webhooks and the
// App Store's signed transactions and notifications (a test chain in tests/fixtures/billing with Apple's
// marker extensions), admin grants, and account deletion cancelling a website subscription.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { APPLE_BUNDLE_ID, APPLE_PRODUCT_ID, verifyAppleJws } from '../../api/_lib/billing/apple';
import { entitlementOf, GRACE_MS, TRIAL_DAYS } from '../../api/_lib/billing/entitlement';
import type { PaddleSettings } from '../../api/_lib/billing/paddle';
import { verifyPaddleSignature } from '../../api/_lib/billing/paddle';
import type { Db } from '../../api/_lib/db';
import { type Client, client, startApi } from './helpers';

const DAY = 24 * 3600e3;
const FIX = path.join(__dirname, '..', 'fixtures', 'billing');
const pem = (n: string) => fs.readFileSync(path.join(FIX, n), 'utf8');
const der = (p: string) => new crypto.X509Certificate(p).raw.toString('base64');
const CHAIN = [der(pem('leaf.pem')), der(pem('mid.pem')), der(pem('root.pem'))];
const LEAF_KEY = crypto.createPrivateKey(pem('leaf.p8.pem'));
const TRUST = { rootSha256: new crypto.X509Certificate(pem('root.pem')).fingerprint256 };

function appleJws(payload: unknown, x5c = CHAIN, key = LEAF_KEY): string {
  const h = Buffer.from(JSON.stringify({ alg: 'ES256', x5c })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${sig.toString('base64url')}`;
}
const transaction = (o: Record<string, unknown> = {}) => ({
  originalTransactionId: 'otx-1',
  transactionId: 'tx-1',
  bundleId: APPLE_BUNDLE_ID,
  productId: APPLE_PRODUCT_ID,
  expiresDate: Date.now() + 365 * DAY,
  environment: 'Production',
  signedDate: Date.now(),
  ...o,
});

const SECRET = 'pdl_ntfset_test';
const paddleCalls: { url: string; body: unknown }[] = [];
const PADDLE: PaddleSettings = {
  apiKey: 'pdl_test_key',
  webhookSecret: SECRET,
  clientToken: 'test_client_token',
  priceId: 'pri_test',
  environment: 'sandbox',
  fetch: (async (url: string, init: RequestInit) => {
    paddleCalls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ data: { urls: { general: { overview: 'https://portal.test/x' } } } }));
  }) as typeof fetch,
};
function paddleSign(body: string, ts = Math.floor(Date.now() / 1000)): string {
  return `ts=${ts};h1=${crypto.createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex')}`;
}

let api: Awaited<ReturnType<typeof startApi>>;
let db: Db;
let n = 0;
beforeAll(async () => {
  api = await startApi({ billingEnforce: true, paddle: PADDLE, appleTrust: TRUST, adminEmails: ['admin@example.com'] });
  db = (await api.server.ready).db;
});
afterAll(() => api.close());

async function pilot(opts: { expired?: boolean } = {}): Promise<{ c: Client; id: string }> {
  const c = client(api.base);
  n++;
  expect((await c.login(`sub-bill-${n}`, `bill-${n}@example.com`)).status).toBe(200);
  const id = (await c.call('GET', 'me')).body.id;
  if (opts.expired) await db.query('UPDATE pilots SET created = $2 WHERE id = $1', [id, Date.now() - 40 * DAY]);
  return { c, id };
}
async function postRaw(p: string, body: string, headers: Record<string, string> = {}) {
  const r = await fetch(api.base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
function paddleEvent(pilotId: string, o: Record<string, unknown> = {}, at = new Date()) {
  const ends = new Date(Date.now() + 365 * DAY).toISOString();
  return JSON.stringify({
    event_type: 'subscription.created',
    occurred_at: at.toISOString(),
    data: {
      id: `sub_${pilotId}`,
      status: 'active',
      customer_id: `ctm_${pilotId}`,
      custom_data: { pilotId },
      current_billing_period: { starts_at: new Date().toISOString(), ends_at: ends },
      scheduled_change: null,
      ...o,
    },
  });
}

describe('entitlement rules', () => {
  const now = Date.parse('2027-01-01T00:00:00Z');
  test('founder, paid, granted, trial, then expired', () => {
    expect(entitlementOf({ id: 'p', founder: true, created: 0 }, now).reason).toBe('founder');
    expect(entitlementOf({ id: 'local', created: 0 }, now).reason).toBe('founder');
    expect(entitlementOf({ id: 'p', created: 0, paid_until: now + 1, paid_renews: true }, now)).toEqual({
      active: true,
      reason: 'paid',
      until: now + 1,
      renews: true,
    });
    expect(entitlementOf({ id: 'p', created: 0, free_until: now + 1 }, now).reason).toBe('granted');
    expect(entitlementOf({ id: 'p', created: now - (TRIAL_DAYS - 1) * DAY }, now).reason).toBe('trial');
    const e = entitlementOf({ id: 'p', created: now - (TRIAL_DAYS + 1) * DAY, paid_until: now - 5 }, now);
    expect(e).toEqual({ active: false, reason: 'expired', until: now - 5 });
  });
});

describe('paywall', () => {
  test('a new pilot is on the trial and may plan', async () => {
    const { c } = await pilot();
    const s = (await c.call('GET', 'session')).body;
    expect(s.entitlement.reason).toBe('trial');
    expect(s.billingEnforced).toBe(true);
    expect((await c.call('POST', 'flights', {})).status).toBe(201);
  });

  test('after the trial: reads, deletes, profile and export stay; writes and NOTAMs get 402', async () => {
    const { c, id } = await pilot();
    const f = (await c.call('POST', 'flights', {})).body;
    await db.query('UPDATE pilots SET created = $2 WHERE id = $1', [id, Date.now() - 40 * DAY]);
    const blocked = await c.call('POST', 'flights', {});
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toBe('subscription_required');
    expect(blocked.body.entitlement.reason).toBe('expired');
    expect((await c.call('PUT', `flights/${f.id}`, { doc: {} })).status).toBe(402);
    expect((await c.call('POST', 'aircraft', { registration: 'SX-PAY' })).status).toBe(402);
    expect((await c.call('GET', `flights/${f.id}/notams`)).status).toBe(402);
    expect((await c.call('GET', 'flights')).status).toBe(200);
    expect((await c.call('GET', `flights/${f.id}`)).status).toBe(200);
    expect((await c.call('GET', 'me/export')).status).toBe(200);
    expect((await c.call('PUT', 'me', { phone: '+30 210 0000000' })).status).toBe(200);
    expect((await c.call('DELETE', `flights/${f.id}`)).status).toBe(204);
    expect((await c.call('GET', 'billing')).status).toBe(200);
  });

  test('a founder keeps everything', async () => {
    const { c, id } = await pilot({ expired: true });
    await db.query('UPDATE pilots SET founder = true WHERE id = $1', [id]);
    expect((await c.call('POST', 'flights', {})).status).toBe(201);
  });

  test('without BILLING_ENFORCE nobody is refused', async () => {
    const other = await startApi();
    try {
      const odb = (await other.server.ready).db;
      const c = client(other.base);
      await c.login('sub-free', 'free@example.com');
      await odb.query(`UPDATE pilots SET created = $1 WHERE email = 'free@example.com'`, [Date.now() - 40 * DAY]);
      expect((await c.call('POST', 'flights', {})).status).toBe(201);
      expect((await c.call('GET', 'session')).body.billingEnforced).toBe(false);
    } finally {
      await other.close();
    }
  });
});

describe('Paddle', () => {
  test('signature: right secret and fresh timestamp only', () => {
    const body = Buffer.from('{"a":1}');
    const now = 1_800_000_000;
    const h = `ts=${now};h1=${crypto.createHmac('sha256', 's').update(`${now}:{"a":1}`).digest('hex')}`;
    expect(verifyPaddleSignature(h, body, 's', now)).toBe(true);
    expect(verifyPaddleSignature(h, body, 'other', now)).toBe(false);
    expect(verifyPaddleSignature(h, Buffer.from('{"a":2}'), 's', now)).toBe(false);
    expect(verifyPaddleSignature(h, body, 's', now + 301)).toBe(false);
    expect(verifyPaddleSignature('garbage', body, 's', now)).toBe(false);
  });

  test('a subscription unlocks; a late older event does not undo a newer one; cancelling ends it', async () => {
    const { c, id } = await pilot({ expired: true });
    expect((await c.call('POST', 'flights', {})).status).toBe(402);
    const body = paddleEvent(id);
    expect((await postRaw('billing/paddle/webhook', body, { 'Paddle-Signature': 'ts=1;h1=00' })).status).toBe(401);
    expect((await postRaw('billing/paddle/webhook', body, { 'Paddle-Signature': paddleSign(body) })).status).toBe(200);
    const b = (await c.call('GET', 'billing')).body;
    expect(b.entitlement.reason).toBe('paid');
    expect(b.entitlement.renews).toBe(true);
    expect(b.store).toBe('paddle');
    expect(b.paddle).toEqual({ clientToken: 'test_client_token', priceId: 'pri_test', environment: 'sandbox' });
    expect((await c.call('POST', 'flights', {})).status).toBe(201);

    const cancelled = paddleEvent(id, { event_type: 'x', status: 'canceled' }, new Date(Date.now() + 1000));
    const canc = JSON.stringify({ ...JSON.parse(cancelled), event_type: 'subscription.canceled' });
    const stale = paddleEvent(id, {}, new Date(Date.now() - 60e3));
    await postRaw('billing/paddle/webhook', canc, { 'Paddle-Signature': paddleSign(canc) });
    await postRaw('billing/paddle/webhook', stale, { 'Paddle-Signature': paddleSign(stale) });
    const after = (await c.call('GET', 'billing')).body.entitlement;
    expect(after.active).toBe(false);
    const [row] = await db.query('SELECT paid_until FROM pilots WHERE id = $1', [id]);
    expect(Number(row.paid_until)).toBeLessThanOrEqual(GRACE_MS);
  });

  test('portal link and cancellation on account deletion', async () => {
    const { c, id } = await pilot();
    const body = paddleEvent(id);
    await postRaw('billing/paddle/webhook', body, { 'Paddle-Signature': paddleSign(body) });
    paddleCalls.length = 0;
    expect((await c.call('POST', 'billing/portal')).body.url).toBe('https://portal.test/x');
    expect(paddleCalls[0].url).toBe(`https://sandbox-api.paddle.com/customers/ctm_${id}/portal-sessions`);
    expect((await c.call('DELETE', 'me', { confirm: `bill-${n}@example.com` })).status).toBe(200);
    expect(paddleCalls[1]).toEqual({
      url: `https://sandbox-api.paddle.com/subscriptions/sub_${id}/cancel`,
      body: { effective_from: 'immediately' },
    });
  });

  test('an event for an unknown pilot is refused (Paddle retries it)', async () => {
    const body = paddleEvent('nobody');
    expect((await postRaw('billing/paddle/webhook', body, { 'Paddle-Signature': paddleSign(body) })).status).toBe(422);
  });
});

describe('App Store', () => {
  test('JWS: our test chain verifies; a foreign root, a broken chain or a tampered payload do not', () => {
    const jws = appleJws({ hello: 1 });
    expect(verifyAppleJws(jws, TRUST)).toEqual({ hello: 1 });
    expect(() => verifyAppleJws(jws)).toThrow('untrusted root'); // the real Apple root
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(() => verifyAppleJws(appleJws({ hello: 1 }, CHAIN, other), TRUST)).toThrow('bad signature');
    expect(() => verifyAppleJws(appleJws({ hello: 1 }, [CHAIN[0], CHAIN[2], CHAIN[2]]), TRUST)).toThrow();
    const [h, , s] = jws.split('.');
    expect(() => verifyAppleJws(`${h}.${Buffer.from('{"hello":2}').toString('base64url')}.${s}`, TRUST)).toThrow();
  });

  test('a purchase from the app unlocks, tied to the account by appAccountToken', async () => {
    const { c, id } = await pilot({ expired: true });
    const token = (await c.call('GET', 'billing')).body.appleAccountToken;
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect((await c.call('GET', 'billing')).body.appleAccountToken).toBe(token);
    const jws = appleJws(transaction({ originalTransactionId: `otx-${id}`, appAccountToken: token.toUpperCase() }));
    const e = (await c.call('POST', 'billing/apple/transaction', { jws })).body;
    expect(e.reason).toBe('paid');
    expect((await c.call('GET', 'billing')).body.store).toBe('apple');
    expect((await c.call('POST', 'flights', {})).status).toBe(201);
    expect((await c.call('POST', 'billing/apple/transaction', { jws: 'x.y.z' })).status).toBe(400);
  });

  test('notifications: renewal turned off, then a refund ends access', async () => {
    const { c, id } = await pilot({ expired: true });
    const token = (await c.call('GET', 'billing')).body.appleAccountToken;
    const otx = `otx-n-${id}`;
    const notify = (t: Record<string, unknown>, renew: number, at: number) =>
      postRaw(
        'billing/apple/notifications',
        JSON.stringify({
          signedPayload: appleJws({
            notificationType: 'X',
            signedDate: at,
            data: {
              bundleId: APPLE_BUNDLE_ID,
              signedTransactionInfo: appleJws(
                transaction({ originalTransactionId: otx, appAccountToken: token, ...t }),
              ),
              signedRenewalInfo: appleJws({ autoRenewStatus: renew }),
            },
          }),
        }),
      );
    expect((await notify({}, 0, Date.now())).status).toBe(200);
    let e = (await c.call('GET', 'billing')).body.entitlement;
    expect(e.reason).toBe('paid');
    expect(e.renews).toBe(false);
    await notify({ revocationDate: Date.now() }, 0, Date.now() + 1000);
    e = (await c.call('GET', 'billing')).body.entitlement;
    expect(e.active).toBe(false);
    expect((await postRaw('billing/apple/notifications', JSON.stringify({ signedPayload: 'a.b.c' }))).status).toBe(400);
  });

  test('another app’s transaction is refused', async () => {
    const { c } = await pilot();
    const jws = appleJws(transaction({ bundleId: 'com.example.other' }));
    expect((await c.call('POST', 'billing/apple/transaction', { jws })).status).toBe(400);
  });
});

describe('admin grant', () => {
  test('an admin gives free days; others may not', async () => {
    const { c, id } = await pilot({ expired: true });
    const admin = client(api.base);
    await admin.login('sub-bill-admin', 'admin@example.com');
    expect((await c.call('POST', `admin/pilots/${id}/grant`, { days: 365 })).status).toBe(403);
    const e = (await admin.call('POST', `admin/pilots/${id}/grant`, { days: 365 })).body;
    expect(e.reason).toBe('granted');
    expect((await c.call('POST', 'flights', {})).status).toBe(201);
    expect((await admin.call('POST', `admin/pilots/${id}/grant`, { days: 0 })).body.active).toBe(false);
  });
});
