// Error monitoring (api/_lib/monitor.ts): server, client, migration and health-check ("cron") errors,
// grouped by fingerprint (one row per group, upserted), with the alert state of each group.
//   app_error_alerts    one row per alert e-mail sent (the daily cap across groups)
//   app_error_reporters per-IP rate limit of POST /api/client-errors (the IP is stored hashed)
// IF NOT EXISTS throughout: when an earlier migration fails, the monitor creates these tables itself
// (MONITOR_SCHEMA) to record that failure, and this migration must then still apply.
export const MONITOR_SCHEMA = `
CREATE TABLE IF NOT EXISTS app_errors (
  fingerprint TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('server', 'client', 'migration', 'cron')),
  message TEXT NOT NULL,
  stack TEXT,
  route TEXT,
  method TEXT,
  status INTEGER,
  pilot_id TEXT,
  user_agent TEXT,
  release TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  prev_seen BIGINT,
  window_start BIGINT NOT NULL,
  window_count INTEGER NOT NULL DEFAULT 1,
  resolved_at BIGINT,
  regressed BOOLEAN NOT NULL DEFAULT FALSE,
  last_alerted BIGINT,
  alerts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS app_errors_last_seen ON app_errors (last_seen DESC);
CREATE TABLE IF NOT EXISTS app_error_alerts (
  sent BIGINT NOT NULL,
  fingerprint TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS app_error_alerts_sent ON app_error_alerts (sent);
CREATE TABLE IF NOT EXISTS app_error_reporters (
  ip_hash TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count INTEGER NOT NULL
);
`;

export default MONITOR_SCHEMA;
