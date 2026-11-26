// The website sells through Stripe (api/_lib/billing/stripe.ts) instead of Paddle, which never went live: no
// 'paddle' rows exist.
const sql = `
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_source_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_source_check CHECK (source IN ('stripe', 'apple'));
`;
export default sql;
