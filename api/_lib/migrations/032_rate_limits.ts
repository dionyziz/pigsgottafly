// Rate limits (api/_lib/rateLimit.ts): one token bucket per (bucket, subject), where the subject is a
// pilot ('p:' + id, the row also carries pilot_id so that it goes with the account) or an IP address
// ('ip:' + address) for requests without a session. Rows are tiny and rewritten in place; buckets
// idle for a day are purged now and then.
// Also: partial indexes for the sweep of unfinished uploads (api/_lib/limits.ts, every upload start).
const sql = `
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  subject TEXT NOT NULL,
  pilot_id TEXT REFERENCES pilots(id) ON DELETE CASCADE,
  tokens DOUBLE PRECISION NOT NULL,
  updated BIGINT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (bucket, subject)
);
CREATE INDEX rate_limits_updated ON rate_limits (updated);
CREATE INDEX aircraft_attachments_incomplete ON aircraft_attachments (created) WHERE NOT complete;
CREATE INDEX operator_files_incomplete ON operator_files (created) WHERE NOT complete;
`;
export default sql;
