// The subscription (api/_lib/billing):
//   GET  /billing                          the pilot's entitlement and how to buy or manage it
//   POST /billing/portal                   a link to Paddle's customer portal (website subscriptions)
//   POST /billing/apple/transaction        the iOS app's purchase or restore (a signed StoreKit transaction)
//   POST /billing/paddle/webhook           Paddle's subscription events (signed; no session)
//   POST /billing/apple/notifications      App Store Server Notifications V2 (signed; no session)
//   POST /admin/pilots/:id/grant           an admin gives a pilot free days ({ days }), or takes them back (0)
import crypto from 'node:crypto';

import type { BillingResponse, Entitlement } from '../../../src/shared/api.js';
import { applyAppleNotification, applyAppTransaction } from '../billing/apple.js';
import { entitlementOf } from '../billing/entitlement.js';
import { applyPaddleEvent, paddlePortalUrl, verifyPaddleSignature } from '../billing/paddle.js';
import type { Queryable } from '../db.js';
import type { Route } from '../http.js';
import { badRequest, HttpError, reply } from '../http.js';

export const PRICE_LABEL = '€50 / year';

async function appleToken(db: Queryable, pilotId: string): Promise<string> {
  const [r] = await db.query(
    `UPDATE pilots SET apple_account_token = COALESCE(apple_account_token, $2) WHERE id = $1 RETURNING apple_account_token`,
    [pilotId, crypto.randomUUID()],
  );
  return r.apple_account_token;
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
      const p = config.paddle;
      return {
        entitlement: await entitlementFor(db, pilot.id),
        store: sub?.source ?? null,
        paddle: p ? { clientToken: p.clientToken, priceId: p.priceId, environment: p.environment } : null,
        appleAccountToken: await appleToken(db, pilot.id),
        price: PRICE_LABEL,
      };
    },
  },
  {
    method: 'POST',
    path: '/billing/portal',
    paid: false,
    async handler({ db, pilot, config }) {
      if (!config.paddle) throw new HttpError(404, 'not available');
      const [sub] = await db.query(
        `SELECT external_id, data->>'customer_id' AS customer FROM subscriptions
         WHERE pilot_id = $1 AND source = 'paddle' ORDER BY updated DESC LIMIT 1`,
        [pilot.id],
      );
      if (!sub?.customer) throw new HttpError(404, 'no subscription bought on the website');
      return { url: await paddlePortalUrl(config.paddle, sub.customer, sub.external_id) };
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
    path: '/billing/paddle/webhook',
    auth: false,
    webhook: true,
    async handler({ db, req, rawBody, config }) {
      if (!config.paddle) return reply(404, { error: 'not found' });
      const raw = await rawBody();
      const sig = String(req.headers['paddle-signature'] || '');
      if (!verifyPaddleSignature(sig, raw, config.paddle.webhookSecret)) return reply(401, { error: 'bad signature' });
      let event;
      try {
        event = JSON.parse(raw.toString('utf8'));
      } catch {
        throw badRequest('invalid JSON');
      }
      await applyPaddleEvent(db, event);
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
