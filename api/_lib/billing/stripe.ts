// Stripe Billing (the website's checkout), sold by Common Prefix OÜ: Stripe's hosted Checkout charges the
// pilot, Stripe Tax adds the VAT of the pilot's country (Common Prefix OÜ files it), and signed webhooks tell us
// about each subscription. No SDK: a handful of form-encoded REST calls.
//   https://docs.stripe.com/webhooks#verify-manually
//   https://docs.stripe.com/api/checkout/sessions/create
//   https://docs.stripe.com/api/customer_portal/sessions/create
import crypto from 'node:crypto';

import type { Queryable } from '../db.js';
import { HttpError } from '../http.js';
import { saveSubscription } from './entitlement.js';

export interface StripeSettings {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  fetch?: typeof fetch;
}

export function stripeFromEnv(env: NodeJS.ProcessEnv): StripeSettings | null {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID } = env;
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !STRIPE_PRICE_ID) return null;
  return { secretKey: STRIPE_SECRET_KEY, webhookSecret: STRIPE_WEBHOOK_SECRET, priceId: STRIPE_PRICE_ID };
}

/** Stripe signs `${t}.${body}`; a stale timestamp is refused so a captured request cannot be replayed later. */
const SIGNATURE_TOLERANCE_S = 300;

export function verifyStripeSignature(header: string, raw: Buffer, secret: string, nowS = Date.now() / 1000): boolean {
  let t = NaN;
  const v1: Buffer[] = [];
  for (const kv of header.split(',')) {
    const i = kv.indexOf('=');
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1).trim();
    if (k === 't') t = Number(v);
    // during a secret roll Stripe sends one v1 per secret
    else if (k === 'v1') v1.push(Buffer.from(v, 'hex'));
  }
  if (!v1.length || !Number.isFinite(t) || Math.abs(nowS - t) > SIGNATURE_TOLERANCE_S) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  return v1.some((got) => got.length === want.length && crypto.timingSafeEqual(got, want));
}

async function call<T>(s: StripeSettings, method: 'POST' | 'DELETE', path: string, form: Record<string, string>) {
  const r = await (s.fetch ?? fetch)(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${s.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new HttpError(502, `Stripe refused the request (${r.status}): ${j.error?.message ?? 'no reason'}`);
  return j;
}

/** A hosted Checkout page for the yearly subscription, tied to the pilot by metadata. */
export async function stripeCheckoutUrl(
  s: StripeSettings,
  o: { pilotId: string; email: string | null; customerId: string | null; returnUrl: string },
): Promise<string> {
  const form: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': s.priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: o.pilotId,
    'subscription_data[metadata][pilotId]': o.pilotId,
    // VAT by the buyer's country (EU B2C rules); a business may give its VAT number (reverse charge)
    'automatic_tax[enabled]': 'true',
    'tax_id_collection[enabled]': 'true',
    billing_address_collection: 'required',
    success_url: `${o.returnUrl}?checkout=done`,
    cancel_url: o.returnUrl,
  };
  if (o.customerId) {
    form.customer = o.customerId;
    // the tax id and address Checkout collects go on the existing customer
    form['customer_update[address]'] = 'auto';
    form['customer_update[name]'] = 'auto';
  } else if (o.email) form.customer_email = o.email;
  const j = await call<{ url?: string }>(s, 'POST', 'checkout/sessions', form);
  if (!j.url) throw new HttpError(502, 'Stripe sent no checkout link');
  return j.url;
}

interface StripeSubscription {
  id: string;
  status: string;
  customer?: string;
  metadata?: { pilotId?: unknown } | null;
  cancel_at_period_end?: boolean;
  /** Before API version 2025-03-31 the period is on the subscription, since then on each item. */
  current_period_end?: number;
  items?: { data?: { current_period_end?: number }[] };
}

/** Applies a webhook event; returns false for events we do not act on. */
export async function applyStripeEvent(
  db: Queryable,
  event: { type?: string; created?: number; data?: { object?: unknown } },
): Promise<boolean> {
  if (!event.type?.startsWith('customer.subscription.')) return false;
  const sub = event.data?.object as StripeSubscription;
  if (!sub?.id) throw new HttpError(400, 'no subscription');
  const claimed = typeof sub.metadata?.pilotId === 'string' ? sub.metadata.pilotId : null;
  const [known] = await db.query(`SELECT pilot_id FROM subscriptions WHERE source = 'stripe' AND external_id = $1`, [
    sub.id,
  ]);
  const pilotId = known?.pilot_id ?? claimed;
  const [pilot] = pilotId ? await db.query('SELECT id FROM pilots WHERE id = $1', [pilotId]) : [];
  // a checkout opened by a deleted account, or a subscription made by hand in Stripe's dashboard
  if (!pilot) throw new HttpError(422, 'unknown pilot');
  // active, trialing and past_due (Stripe still retrying the card) keep the period; the others end it
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);
  const endS = sub.current_period_end ?? Math.max(0, ...(sub.items?.data ?? []).map((i) => i.current_period_end ?? 0));
  await saveSubscription(db, {
    source: 'stripe',
    externalId: sub.id,
    pilotId: pilot.id,
    status: sub.status,
    periodEnd: live ? endS * 1000 : 0,
    autoRenew: live && !sub.cancel_at_period_end,
    eventAt: (event.created ?? 0) * 1000 || Date.now(),
    data: sub,
  });
  return true;
}

/** A one-time link to Stripe's customer portal (cancel, change card, invoices). */
export async function stripePortalUrl(s: StripeSettings, customerId: string, returnUrl: string): Promise<string> {
  const j = await call<{ url?: string }>(s, 'POST', 'billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
  });
  if (!j.url) throw new HttpError(502, 'Stripe sent no portal link');
  return j.url;
}

/** Ends a subscription at once (the account is being deleted). */
export async function stripeCancel(s: StripeSettings, subscriptionId: string): Promise<void> {
  await call(s, 'DELETE', `subscriptions/${encodeURIComponent(subscriptionId)}`, {});
}
