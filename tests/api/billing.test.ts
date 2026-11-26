// The subscription: entitlement rules, the 402 paywall (BILLING_ENFORCE), Stripe's checkout and signed webhooks and the
// App Store's signed transactions and notifications (a test chain in tests/fixtures/billing with Apple's
// marker extensions), admin grants, and account deletion cancelling a website subscription.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { APPLE_BUNDLE_ID, APPLE_PRODUCT_ID, verifyAppleJws } from '../../api/_lib/billing/apple';
import { entitlementOf, GRACE_MS, TRIAL_DAYS } from '../../api/_lib/billing/entitlement';
import type { StripeSettings } from '../../api/_lib/billing/stripe';
import { verifyStripeSignature } from '../../api/_lib/billing/stripe';
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

const SECRET = 'whsec_test';
const stripeCalls: { method: string; url: string; body: Record<string, string> }[] = [];
const STRIPE: StripeSettings = {
  secretKey: 'sk_test_key',
  webhookSecret: SECRET,
  priceId: 'price_test',
  fetch: (async (url: string, init: RequestInit) => {
    stripeCalls.push({
      method: String(init.method),
      url,
      body: Object.fromEntries(new URLSearchParams(String(init.body))),
    });
    const link = url.endsWith('checkout/sessions') ? 'https://checkout.test/x' : 'https://portal.test/x';
    return new Response(JSON.stringify({ url: link }));
  }) as typeof fetch,
};
function stripeSign(body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;
}

let api: Awaited<ReturnType<typeof startApi>>;
let db: Db;
let n = 0;
beforeAll(async () => {
  api = await startApi({ billingEnforce: true, stripe: STRIPE, appleTrust: TRUST, adminEmails: ['admin@example.com'] });
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
function stripeEvent(
  pilotId: string,
  o: Record<string, unknown> = {},
  at = Date.now(),
  type = 'customer.subscription.created',
) {
  return JSON.stringify({
    type,
    created: Math.floor(at / 1000),
    data: {
      object: {
        id: `sub_${pilotId}`,
        status: 'active',
        customer: `cus_${pilotId}`,
        metadata: { pilotId },
        cancel_at_period_end: false,
        items: { data: [{ current_period_end: Math.floor((Date.now() + 365 * DAY) / 1000) }] },
        ...o,
      },
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

describe('Stripe', () => {
  const hook = (body: string, sig = stripeSign(body)) =>
    postRaw('billing/stripe/webhook', body, { 'Stripe-Signature': sig });

  test('signature: right secret and fresh timestamp only; any v1 of a secret roll', () => {
    const body = Buffer.from('{"a":1}');
    const now = 1_800_000_000;
    const v1 = (k: string) => crypto.createHmac('sha256', k).update(`${now}.{"a":1}`).digest('hex');
    expect(verifyStripeSignature(`t=${now},v1=${v1('s')}`, body, 's', now)).toBe(true);
    expect(verifyStripeSignature(`t=${now},v1=${v1('old')},v1=${v1('s')}`, body, 's', now)).toBe(true);
    expect(verifyStripeSignature(`t=${now},v1=${v1('s')}`, body, 'other', now)).toBe(false);
    expect(verifyStripeSignature(`t=${now},v1=${v1('s')}`, Buffer.from('{"a":2}'), 's', now)).toBe(false);
    expect(verifyStripeSignature(`t=${now},v1=${v1('s')}`, body, 's', now + 301)).toBe(false);
    expect(verifyStripeSignature('garbage', body, 's', now)).toBe(false);
  });

  test('checkout: the pilot in metadata, VAT by country, back to /subscription', async () => {
    const { c, id } = await pilot({ expired: true });
    stripeCalls.length = 0;
    expect((await c.call('POST', 'billing/checkout')).body.url).toBe('https://checkout.test/x');
    expect(stripeCalls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(stripeCalls[0].body).toMatchObject({
      mode: 'subscription',
      'line_items[0][price]': 'price_test',
      client_reference_id: id,
      'subscription_data[metadata][pilotId]': id,
      'automatic_tax[enabled]': 'true',
      customer_email: `bill-${n}@example.com`,
    });
    expect(stripeCalls[0].body.success_url).toMatch(/\/subscription\?checkout=done$/);
    expect((await c.call('GET', 'billing')).body.web).toBe(true);
  });

  test('a subscription unlocks; a late older event does not undo a newer one; cancelling ends it', async () => {
    const { c, id } = await pilot({ expired: true });
    expect((await c.call('POST', 'flights', {})).status).toBe(402);
    const body = stripeEvent(id);
    expect((await hook(body, 't=1,v1=00')).status).toBe(401);
    expect((await hook(body)).status).toBe(200);
    const b = (await c.call('GET', 'billing')).body;
    expect(b.entitlement.reason).toBe('paid');
    expect(b.entitlement.renews).toBe(true);
    expect(b.store).toBe('stripe');
    expect((await c.call('POST', 'flights', {})).status).toBe(201);
    expect((await c.call('POST', 'billing/checkout')).status).toBe(409);

    const ending = stripeEvent(id, { cancel_at_period_end: true }, Date.now() + 1000, 'customer.subscription.updated');
    await hook(ending);
    expect((await c.call('GET', 'billing')).body.entitlement).toMatchObject({ reason: 'paid', renews: false });
    const deleted = stripeEvent(id, { status: 'canceled' }, Date.now() + 2000, 'customer.subscription.deleted');
    const stale = stripeEvent(id, {}, Date.now() - 60e3);
    await hook(deleted);
    await hook(stale);
    const after = (await c.call('GET', 'billing')).body.entitlement;
    expect(after.active).toBe(false);
    const [row] = await db.query('SELECT paid_until FROM pilots WHERE id = $1', [id]);
    expect(Number(row.paid_until)).toBeLessThanOrEqual(GRACE_MS);
  });

  test('a subscription from before API version 2025-03-31 (the period on the subscription)', async () => {
    const { c, id } = await pilot({ expired: true });
    const until = Math.floor((Date.now() + 30 * DAY) / 1000);
    await hook(stripeEvent(id, { items: { data: [{}] }, current_period_end: until }));
    expect((await c.call('GET', 'billing')).body.entitlement.until).toBe(until * 1000 + GRACE_MS);
  });

  test('portal link and cancellation on account deletion', async () => {
    const { c, id } = await pilot();
    await hook(stripeEvent(id));
    stripeCalls.length = 0;
    expect((await c.call('POST', 'billing/portal')).body.url).toBe('https://portal.test/x');
    expect(stripeCalls[0]).toMatchObject({
      url: 'https://api.stripe.com/v1/billing_portal/sessions',
      body: { customer: `cus_${id}` },
    });
    expect((await c.call('DELETE', 'me', { confirm: `bill-${n}@example.com` })).status).toBe(200);
    expect(stripeCalls[1]).toMatchObject({
      method: 'DELETE',
      url: `https://api.stripe.com/v1/subscriptions/sub_${id}`,
    });
  });

  test('an event for an unknown pilot is refused (Stripe retries it); other events are ignored', async () => {
    expect((await hook(stripeEvent('nobody'))).status).toBe(422);
    expect((await hook(JSON.stringify({ type: 'invoice.paid', created: 1, data: { object: {} } }))).status).toBe(200);
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
