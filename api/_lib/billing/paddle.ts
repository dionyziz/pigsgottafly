// Paddle Billing (the website's checkout). Paddle is the merchant of record: it charges the pilot, collects
// and files the VAT, and tells us about each subscription through signed webhooks.
//   https://developer.paddle.com/webhooks/signature-verification
//   https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session
import crypto from 'node:crypto';

import type { Queryable } from '../db.js';
import { HttpError } from '../http.js';
import { saveSubscription } from './entitlement.js';

export interface PaddleSettings {
  apiKey: string;
  webhookSecret: string;
  /** Paddle.js client-side token (public: the browser opens the checkout with it). */
  clientToken: string;
  priceId: string;
  environment: 'sandbox' | 'production';
  fetch?: typeof fetch;
}

export function paddleFromEnv(env: NodeJS.ProcessEnv): PaddleSettings | null {
  const { PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_CLIENT_TOKEN, PADDLE_PRICE_ID } = env;
  if (!PADDLE_API_KEY || !PADDLE_WEBHOOK_SECRET || !PADDLE_CLIENT_TOKEN || !PADDLE_PRICE_ID) return null;
  return {
    apiKey: PADDLE_API_KEY,
    webhookSecret: PADDLE_WEBHOOK_SECRET,
    clientToken: PADDLE_CLIENT_TOKEN,
    priceId: PADDLE_PRICE_ID,
    environment: env.PADDLE_ENV === 'production' ? 'production' : 'sandbox',
  };
}

const apiBase = (s: PaddleSettings) =>
  s.environment === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';

/** Paddle signs `${ts}:${body}`; a stale timestamp is refused so a captured request cannot be replayed later. */
const SIGNATURE_TOLERANCE_S = 300;

export function verifyPaddleSignature(header: string, raw: Buffer, secret: string, nowS = Date.now() / 1000): boolean {
  const parts = Object.fromEntries(
    header.split(';').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const ts = Number(parts.ts);
  if (!parts.h1 || !Number.isFinite(ts) || Math.abs(nowS - ts) > SIGNATURE_TOLERANCE_S) return false;
  const want = crypto.createHmac('sha256', secret).update(`${parts.ts}:`).update(raw).digest();
  const got = Buffer.from(parts.h1, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

interface PaddleSubscription {
  id: string;
  status: string;
  customer_id?: string;
  custom_data?: { pilotId?: unknown } | null;
  current_billing_period?: { starts_at: string; ends_at: string } | null;
  scheduled_change?: { action: string; effective_at: string } | null;
}

/** Applies a webhook event; returns false for events we do not act on. */
export async function applyPaddleEvent(
  db: Queryable,
  event: { event_type?: string; occurred_at?: string; data?: unknown },
): Promise<boolean> {
  if (!event.event_type?.startsWith('subscription.')) return false;
  const sub = event.data as PaddleSubscription;
  if (!sub?.id) throw new HttpError(400, 'no subscription');
  const claimed = typeof sub.custom_data?.pilotId === 'string' ? sub.custom_data.pilotId : null;
  const [known] = await db.query(`SELECT pilot_id FROM subscriptions WHERE source = 'paddle' AND external_id = $1`, [
    sub.id,
  ]);
  const pilotId = known?.pilot_id ?? claimed;
  const [pilot] = pilotId ? await db.query('SELECT id FROM pilots WHERE id = $1', [pilotId]) : [];
  // a checkout opened by a deleted account, or a subscription made by hand in Paddle's dashboard
  if (!pilot) throw new HttpError(422, 'unknown pilot');
  // active, trialing and past_due (Paddle still retrying the card) keep the period; paused and canceled end it
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);
  const end = sub.current_billing_period ? Date.parse(sub.current_billing_period.ends_at) : 0;
  await saveSubscription(db, {
    source: 'paddle',
    externalId: sub.id,
    pilotId: pilot.id,
    status: sub.status,
    periodEnd: live ? end : 0,
    autoRenew: live && sub.scheduled_change?.action !== 'cancel',
    eventAt: Date.parse(event.occurred_at || '') || Date.now(),
    data: sub,
  });
  return true;
}

/** A one-time link to Paddle's customer portal (cancel, change card, invoices) for the pilot's subscription. */
export async function paddlePortalUrl(s: PaddleSettings, customerId: string, subscriptionId: string): Promise<string> {
  const r = await (s.fetch ?? fetch)(`${apiBase(s)}/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription_ids: [subscriptionId] }),
  });
  if (!r.ok) throw new HttpError(502, `Paddle refused the portal session (${r.status})`);
  const j = (await r.json()) as { data?: { urls?: { general?: { overview?: string } } } };
  const url = j.data?.urls?.general?.overview;
  if (!url) throw new HttpError(502, 'Paddle sent no portal link');
  return url;
}

/** Ends a subscription at once (the account is being deleted). */
export async function paddleCancel(s: PaddleSettings, subscriptionId: string): Promise<void> {
  const r = await (s.fetch ?? fetch)(`${apiBase(s)}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ effective_from: 'immediately' }),
  });
  if (!r.ok) throw new HttpError(502, `Paddle refused to cancel the subscription (${r.status}); try again`);
}
