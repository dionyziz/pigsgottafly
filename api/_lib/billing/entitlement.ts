// Whether a pilot may plan, brief and file (the €50/year subscription). Decided from the pilot row alone,
// so the dispatcher needs no extra query: paid_until is kept up to date by the stores' notifications
// (stripe.ts, apple.ts → refreshPaidUntil).
import type { Entitlement } from '../../../src/shared/api.js';
import type { Queryable, Row } from '../db.js';

export const TRIAL_DAYS = 30;
/** A renewal the store has not confirmed yet (a card declined, Apple's billing retry) keeps access this long. */
export const GRACE_MS = 3 * 24 * 3600e3;
const DAY = 24 * 3600e3;

export function entitlementOf(row: Row, now = Date.now()): Entitlement {
  if (row.id === 'local' || row.founder) return { active: true, reason: 'founder', until: null };
  const paid = Number(row.paid_until) || 0;
  if (paid > now) return { active: true, reason: 'paid', until: paid, renews: !!row.paid_renews };
  const free = Number(row.free_until) || 0;
  if (free > now) return { active: true, reason: 'granted', until: free };
  const trial = Number(row.created) + TRIAL_DAYS * DAY;
  if (trial > now) return { active: true, reason: 'trial', until: trial };
  return { active: false, reason: 'expired', until: Math.max(paid, free, trial) };
}

/**
 * Recomputes pilots.paid_until / paid_renews from every subscription the pilot holds in either store:
 * a pilot may have bought on the website and in the app, and the later end wins.
 */
export async function refreshPaidUntil(db: Queryable, pilotId: string): Promise<void> {
  await db.query(
    `UPDATE pilots SET
       paid_until = (SELECT max(period_end) + $2 FROM subscriptions WHERE pilot_id = $1 AND period_end IS NOT NULL),
       paid_renews = COALESCE((SELECT bool_or(auto_renew) FROM subscriptions
                               WHERE pilot_id = $1 AND period_end > $3), false)
     WHERE id = $1`,
    [pilotId, GRACE_MS, Date.now()],
  );
}

export interface SubscriptionRecord {
  source: 'stripe' | 'apple';
  externalId: string;
  pilotId: string;
  status: string;
  /** Epoch ms the paid period ends; 0 when the subscription ended early (cancelled now, refunded, revoked). */
  periodEnd: number;
  autoRenew: boolean;
  /** The store's event time: an older event never overwrites a newer one (stores retry and reorder). */
  eventAt: number;
  data: unknown;
}

export async function saveSubscription(db: Queryable, s: SubscriptionRecord): Promise<void> {
  await db.query(
    `INSERT INTO subscriptions (source, external_id, pilot_id, status, period_end, auto_renew, event_at, updated, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (source, external_id) DO UPDATE SET
       pilot_id = EXCLUDED.pilot_id, status = EXCLUDED.status, period_end = EXCLUDED.period_end,
       auto_renew = EXCLUDED.auto_renew, event_at = EXCLUDED.event_at, updated = EXCLUDED.updated, data = EXCLUDED.data
     WHERE subscriptions.event_at <= EXCLUDED.event_at`,
    [
      s.source,
      s.externalId,
      s.pilotId,
      s.status,
      s.periodEnd,
      s.autoRenew,
      s.eventAt,
      Date.now(),
      JSON.stringify(s.data),
    ],
  );
  await refreshPaidUntil(db, s.pilotId);
}
