// The subscription (api/_lib/billing):
//   GET  /billing                          the pilot's entitlement and how to buy or manage it
//   POST /billing/checkout                 a link to Stripe's hosted Checkout (the website's purchase)
//   POST /billing/portal                   a link to Stripe's customer portal (website subscriptions)
//   POST /billing/apple/transaction        the iOS app's purchase or restore (a signed StoreKit transaction)
//   POST /billing/stripe/webhook           Stripe's subscription events (signed; no session)
//   POST /billing/apple/notifications      App Store Server Notifications V2 (signed; no session)
//   POST /admin/pilots/:id/grant           an admin gives a pilot free days ({ days }), or takes them back (0)
import crypto from 'node:crypto';

import type { BillingResponse, Entitlement } from '../../../src/shared/api.js';
import { applyAppleNotification, applyAppTransaction } from '../billing/apple.js';
import { entitlementOf } from '../billing/entitlement.js';
import { applyStripeEvent, stripeCheckoutUrl, stripePortalUrl, verifyStripeSignature } from '../billing/stripe.js';
import type { Queryable } from '../db.js';
import type { Route } from '../http.js';
import { appOrigin, badRequest, HttpError, reply } from '../http.js';

export const PRICE_LABEL = '€50 / year';

async function appleToken(db: Queryable, pilotId: string): Promise<string> {
  const [r] = await db.query(
    `UPDATE pilots SET apple_account_token = COALESCE(apple_account_token, $2) WHERE id = $1 RETURNING apple_account_token`,
    [pilotId, crypto.randomUUID()],
  );
  return r.apple_account_token;
}

/** The pilot's Stripe customer, from their latest website subscription (null: never bought on the website). */
async function stripeCustomer(db: Queryable, pilotId: string): Promise<string | null> {
  const [sub] = await db.query(
    `SELECT data->>'customer' AS customer FROM subscriptions
     WHERE pilot_id = $1 AND source = 'stripe' ORDER BY updated DESC LIMIT 1`,
    [pilotId],
  );
  return sub?.customer ?? null;
}

async function entitlementFor(db: Queryable, pilotId: string): Promise<Entitlement> {
  const [row] = await db.query('SELECT * FROM pilots WHERE id = $1', [pilotId]);
  return entitlementOf(row);
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/billing',
    async handler({ db, pilot, config }): Promise<BillingResponse> {
      const [sub] = await db.query(
        `SELECT source FROM subscriptions WHERE pilot_id = $1 AND period_end > $2 ORDER BY period_end DESC LIMIT 1`,
        [pilot.id, Date.now()],
      );
      return {
        entitlement: await entitlementFor(db, pilot.id),
        store: sub?.source ?? null,
        web: !!config.stripe,
        appleAccountToken: await appleToken(db, pilot.id),
        price: PRICE_LABEL,
      };
    },
  },
  {
    method: 'POST',
    path: '/billing/checkout',
    paid: false,
    async handler({ db, pilot, config, req }) {
      if (!config.stripe) throw new HttpError(404, 'not available');
      const e = await entitlementFor(db, pilot.id);
      if (e.reason === 'paid' || e.reason === 'founder') throw new HttpError(409, 'you already have a subscription');
      const url = await stripeCheckoutUrl(config.stripe, {
        pilotId: pilot.id,
        email: pilot.email || null,
        customerId: await stripeCustomer(db, pilot.id),
        returnUrl: `${appOrigin(req, config.secureCookie)}/subscription`,
      });
      return { url };
    },
  },
  {
    method: 'POST',
    path: '/billing/portal',
    paid: false,
    async handler({ db, pilot, config, req }) {
      if (!config.stripe) throw new HttpError(404, 'not available');
      const customer = await stripeCustomer(db, pilot.id);
      if (!customer) throw new HttpError(404, 'no subscription bought on the website');
      return {
        url: await stripePortalUrl(config.stripe, customer, `${appOrigin(req, config.secureCookie)}/subscription`),
      };
    },
  },
  {
    method: 'POST',
    path: '/billing/apple/transaction',
    paid: false,
    async handler({ db, pilot, body, config }): Promise<Entitlement> {
      const { jws } = await body();
      if (typeof jws !== 'string' || !jws) throw badRequest('jws is required');
      await applyAppTransaction(db, jws, pilot.id, config.appleTrust);
      return entitlementFor(db, pilot.id);
    },
  },
  {
    method: 'POST',
    path: '/billing/stripe/webhook',
    auth: false,
    webhook: true,
    async handler({ db, req, rawBody, config }) {
      if (!config.stripe) return reply(404, { error: 'not found' });
      const raw = await rawBody();
      const sig = String(req.headers['stripe-signature'] || '');
      if (!verifyStripeSignature(sig, raw, config.stripe.webhookSecret)) return reply(401, { error: 'bad signature' });
      let event;
      try {
        event = JSON.parse(raw.toString('utf8'));
      } catch {
        throw badRequest('invalid JSON');
      }
      await applyStripeEvent(db, event);
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: '/billing/apple/notifications',
    auth: false,
    webhook: true,
    async handler({ db, rawBody, config }) {
      let payload: unknown;
      try {
        payload = JSON.parse((await rawBody()).toString('utf8'));
      } catch {
        throw badRequest('invalid JSON');
      }
      const signed = (payload as { signedPayload?: unknown })?.signedPayload;
      if (typeof signed !== 'string') throw badRequest('signedPayload is required');
      await applyAppleNotification(db, signed, config.appleTrust);
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: '/admin/pilots/:id/grant',
    paid: false,
    async handler({ db, isAdmin, params, body }): Promise<Entitlement> {
      if (!isAdmin) throw new HttpError(403, 'admins only');
      const { days } = await body();
      if (!Number.isInteger(days) || days < 0 || days > 3650) throw badRequest('days: 0 to 3650');
      const until = days ? Date.now() + days * 24 * 3600e3 : null;
      const [r] = await db.query('UPDATE pilots SET free_until = $2 WHERE id = $1 RETURNING id', [params.id, until]);
      if (!r) throw new HttpError(404, 'no such pilot');
      return entitlementFor(db, params.id);
    },
  },
];
