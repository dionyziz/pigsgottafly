// The €50/year subscription (api/_lib/billing). Every pilot who signed up before it is a founder: free for life.
//   pilots.paid_until, paid_renews   derived from subscriptions (refreshPaidUntil), so a request needs no join
//   pilots.free_until                free time an admin granted
//   pilots.apple_account_token       the UUID the iOS app sets as appAccountToken on its purchases
//   subscriptions                    one row per store subscription (Paddle subscription id, App Store
//                                    originalTransactionId); event_at orders the stores' retried notifications
const sql = `
ALTER TABLE pilots
  ADD COLUMN founder BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN paid_until BIGINT,
  ADD COLUMN paid_renews BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN free_until BIGINT,
  ADD COLUMN apple_account_token TEXT UNIQUE;
UPDATE pilots SET founder = true;
CREATE TABLE subscriptions (
  source TEXT NOT NULL CHECK (source IN ('paddle', 'apple')),
  external_id TEXT NOT NULL,
  pilot_id TEXT NOT NULL REFERENCES pilots(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  period_end BIGINT,
  auto_renew BOOLEAN NOT NULL DEFAULT false,
  event_at BIGINT NOT NULL,
  updated BIGINT NOT NULL,
  data JSONB,
  PRIMARY KEY (source, external_id)
);
CREATE INDEX subscriptions_pilot ON subscriptions (pilot_id);
`;
export default sql;
