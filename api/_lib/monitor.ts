// In-house error monitoring: every server error (unhandled, or a 5xx answer), client error (POST
// /api/client-errors), failed migration and failed health check is recorded in app_errors (migration
// 040), grouped by a fingerprint (one row per group: count, first/last seen, last route, release),
// and the admins (ADMIN_EMAILS) get an e-mail (sendSystemMail) when
//   - a group is new,
//   - it recurs after RECUR_QUIET_MS without an occurrence, or after it was resolved on /admin/errors,
//   - it bursts (more than BURST_COUNT occurrences within BURST_WINDOW_MS),
//   - it is a migration failure (any occurrence),
// at most once per group per ALERT_GAP_MS (a resolved group that recurs is exempt) and at most
// DAILY_ALERT_CAP e-mails per 24 h overall. Recording and alerting never throw: a broken monitor (or
// mail provider) must not break the request it watches. Every recorded error is also logged with the
// marker "[pgf-error]" (migration failures "[pgf-migration-failed]") for the Vercel logs.
// No request bodies are stored; messages and stacks are scrubbed of e-mail addresses and tokens, and
// routes are path patterns (ids replaced), so a group holds no personal data beyond a pilot id.
import crypto from 'node:crypto';
import type { Db, Queryable } from './db.js';
import { mailAvailability, sendSystemMail } from './mail.js';
import { migrate, MIGRATIONS, type Migration } from './migrate.js';
import { MONITOR_SCHEMA } from './migrations/040_app_errors.js';
import { RATES } from './rateLimit.js';
import { scrubText, scrubUrl, type AppErrorKind } from '../../src/shared/monitoring.js';

export const ALERT_GAP_MS = 60 * 60 * 1000;
export const DAILY_ALERT_CAP = 20;
export const RECUR_QUIET_MS = 24 * 60 * 60 * 1000;
export const BURST_WINDOW_MS = 10 * 60 * 1000;
export const BURST_COUNT = 20;
/** Longest an error path waits for the alert e-mail (it is sent before answering: a serverless
 * function may be frozen once it has answered). */
const MAIL_WAIT_MS = 4000;
/** No new client-error groups beyond this many groups in all (a flood of distinct messages). */
export const MAX_GROUPS = 2000;
const ADMIN_URL = 'https://pigsgottafly.com/admin/errors';

export interface ErrorEvent {
  kind: AppErrorKind;
  message: string;
  stack?: string | null;
  /** A route pattern ('/flights/:id') or a page path; scrubbed again here. */
  route?: string | null;
  method?: string | null;
  status?: number | null;
  pilotId?: string | null;
  userAgent?: string | null;
  /** Extra grouping key (e.g. the client's source: error | rejection | react | api). */
  group?: string;
}

export interface MonitorOptions {
  /** Who gets the alerts (lower-cased e-mails); empty = nobody. */
  adminEmails?: string[];
  /** Clock (tests). */
  now?: number;
}

export type AlertReason = 'new' | 'migration' | 'regression' | 'recurred' | 'burst';

/** The deployed commit (Vercel sets VERCEL_GIT_COMMIT_SHA), else 'dev'. */
export function release(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || 'dev';
}

export const adminEmailsFromEnv = (env: NodeJS.ProcessEnv = process.env): string[] =>
  (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const cut = (s: string | null | undefined, n: number): string | null => (s == null || s === '' ? null : String(s).slice(0, n));

/** At most 30 lines / 4000 characters, scrubbed. */
export function trimStack(stack: string | null | undefined): string | null {
  if (!stack) return null;
  return scrubText(String(stack).split('\n').slice(0, 30).join('\n')).slice(0, 4000);
}

/** The message with its variable parts (numbers, quoted values, ids) blanked, for grouping. */
export function normalizeMessage(m: string): string {
  return scrubText(m)
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '"…"')
    .replace(/\b[a-z]{1,4}_[\w-]{5,}\b/gi, ':id')
    .replace(/\b0x[0-9a-f]+\b/gi, 'N')
    .replace(/\d+(\.\d+)?/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** The first stack frame without line/column numbers and build hashes. */
export function topFrame(stack: string | null | undefined): string {
  const line = String(stack || '').split('\n').map((l) => l.trim()).find((l) => /^at\s|^[^\s@]*@\S+:\d+(:\d+)?$/.test(l)) || ''; // V8 "at f (…)", Firefox/Safari "f@url:1:2"
  return line
    .replace(/\?[^:)\s]*/g, '')
    .replace(/:\d+(:\d+)?/g, '')
    .replace(/-[A-Za-z0-9_]{8}(\.m?js)/g, '$1')
    .slice(0, 200);
}

export function fingerprint(ev: ErrorEvent): string {
  const key = [ev.kind, ev.group || '', normalizeMessage(ev.message || ''), scrubUrl(ev.route) || '',
    // minified client function names change with every build: server stacks only
    ev.kind === 'client' ? '' : topFrame(ev.stack)].join('|');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

const missingTable = (e: unknown) => /app_error\w* ".*does not exist|relation "app_error/i.test(String((e as Error)?.message || e));

/** Runs q; when the monitor's tables are missing (a migration before 040 failed), creates them and retries. */
async function withSchema<T>(db: Queryable, q: () => Promise<T>): Promise<T> {
  try {
    return await q();
  } catch (e) {
    if (!missingTable(e)) throw e;
    await db.exec(MONITOR_SCHEMA);
    return q();
  }
}

type Row = Record<string, any>;

/** Pure: why this occurrence should alert (before throttling), or null. */
export function alertReason(row: Row, now: number): AlertReason | null {
  if (row.inserted === true) return row.kind === 'migration' ? 'migration' : 'new';
  if (row.kind === 'migration') return 'migration';
  if (row.regressed === true) return 'regression';
  if (row.prev_seen != null && now - Number(row.prev_seen) > RECUR_QUIET_MS) return 'recurred';
  if (Number(row.window_count) > BURST_COUNT && (row.last_alerted == null || Number(row.last_alerted) < Number(row.window_start))) return 'burst';
  return null;
}

/**
 * Records one error and alerts the admins if due. Never throws; returns the group's fingerprint and
 * the alert sent (null: none), or null when nothing could be recorded.
 */
export async function recordError(db: Queryable, ev: ErrorEvent, opts: MonitorOptions = {}): Promise<{ fingerprint: string; alert: AlertReason | null } | null> {
  const now = opts.now ?? Date.now();
  const message = scrubText(String(ev.message || 'unknown error')).slice(0, 1000);
  const stack = trimStack(ev.stack);
  const route = scrubUrl(ev.route);
  const fp = fingerprint(ev);
  console.error(ev.kind === 'migration' ? '[pgf-migration-failed]' : '[pgf-error]', JSON.stringify({ kind: ev.kind, fingerprint: fp, route, status: ev.status ?? null, message }));
  if (stack) console.error(stack);
  let row: Row;
  try {
    if (ev.kind === 'client') {
      const [known] = await withSchema(db, () => db.query('SELECT 1 FROM app_errors WHERE fingerprint = $1', [fp]));
      if (!known) {
        const [{ n }] = await db.query('SELECT count(*)::int AS n FROM app_errors');
        if (n >= MAX_GROUPS) return null;
      }
    }
    [row] = await withSchema(db, () => db.query(
      `INSERT INTO app_errors (fingerprint, kind, message, stack, route, method, status, pilot_id, user_agent, release,
          count, first_seen, last_seen, window_start, window_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $11, $11, 1)
       ON CONFLICT (fingerprint) DO UPDATE SET
         message = EXCLUDED.message, stack = COALESCE(EXCLUDED.stack, app_errors.stack), route = EXCLUDED.route,
         method = EXCLUDED.method, status = EXCLUDED.status, pilot_id = COALESCE(EXCLUDED.pilot_id, app_errors.pilot_id),
         user_agent = EXCLUDED.user_agent, release = EXCLUDED.release,
         count = app_errors.count + 1,
         prev_seen = app_errors.last_seen,
         last_seen = GREATEST(app_errors.last_seen, EXCLUDED.last_seen),
         window_start = CASE WHEN app_errors.window_start < EXCLUDED.last_seen - ${BURST_WINDOW_MS} THEN EXCLUDED.last_seen ELSE app_errors.window_start END,
         window_count = CASE WHEN app_errors.window_start < EXCLUDED.last_seen - ${BURST_WINDOW_MS} THEN 1 ELSE app_errors.window_count + 1 END,
         regressed = (app_errors.resolved_at IS NOT NULL),
         resolved_at = NULL
       RETURNING *, (xmax = 0) AS inserted`,
      [fp, ev.kind, message, stack, route, cut(ev.method, 10), ev.status ?? null, cut(ev.pilotId, 64), cut(ev.userAgent, 300), release(), now],
    ));
  } catch (e) {
    console.error('[pgf-monitor] could not record an error:', String((e as Error)?.message || e));
    return null;
  }
  let alert: AlertReason | null = null;
  try {
    alert = await maybeAlert(db, row, now, opts.adminEmails ?? []);
  } catch (e) {
    console.error('[pgf-monitor] alert failed:', String((e as Error)?.message || e));
  }
  return { fingerprint: fp, alert };
}

async function maybeAlert(db: Queryable, row: Row, now: number, admins: string[]): Promise<AlertReason | null> {
  const reason = alertReason(row, now);
  if (!reason || !admins.length || !mailAvailability().enabled) return null;
  const [{ n }] = await db.query('SELECT count(*)::int AS n FROM app_error_alerts WHERE sent > $1::bigint AND sent <= $2::bigint', [now - 24 * 3600 * 1000, now]);
  if (n >= DAILY_ALERT_CAP) return null;
  // claim the alert (concurrent occurrences: only one wins); a recurrence after "resolve" is exempt from the gap
  const claimed = await db.query(
    `UPDATE app_errors SET last_alerted = $2::bigint, alerts = alerts + 1
     WHERE fingerprint = $1 AND ($3::boolean OR last_alerted IS NULL OR last_alerted <= $2::bigint - ${ALERT_GAP_MS}) RETURNING fingerprint`,
    [row.fingerprint, now, reason === 'regression']);
  if (!claimed.length) return null;
  await db.query('INSERT INTO app_error_alerts (sent, fingerprint, reason) VALUES ($1, $2, $3)', [now, row.fingerprint, reason]);
  await sendWithin(alertMail(row, reason), admins);
  return reason;
}

const TITLE: Record<AlertReason, string> = {
  new: 'New error', migration: 'MIGRATION FAILED', regression: 'Resolved error is back', recurred: 'Error recurred after a quiet day', burst: 'Error burst',
};
const iso = (ms: unknown) => (ms == null ? '—' : new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) + ' UTC');

function alertMail(row: Row, reason: AlertReason): { subject: string; text: string } {
  const where = [row.method, row.route].filter(Boolean).join(' ');
  return {
    subject: `[Pig's Gotta Fly] ${TITLE[reason]} (${row.kind}): ${String(row.message).slice(0, 90)}`,
    text: [
      `${TITLE[reason]} on Pig's Gotta Fly.`,
      '',
      `Kind: ${row.kind}`,
      `Message: ${row.message}`,
      where ? `Where: ${where}${row.status ? ` → ${row.status}` : ''}` : null,
      `Count: ${row.count}${reason === 'burst' ? ` (${row.window_count} in the last ${BURST_WINDOW_MS / 60000} min)` : ''}`,
      `First seen: ${iso(row.first_seen)}`,
      `Last seen: ${iso(row.last_seen)}`,
      `Release: ${row.release || '—'}`,
      `Fingerprint: ${row.fingerprint}`,
      '',
      row.stack ? String(row.stack).split('\n').slice(0, 15).join('\n') : null,
      '',
      `All errors: ${ADMIN_URL}`,
    ].filter((l) => l !== null).join('\n'),
  };
}

async function sendWithin(m: { subject: string; text: string }, to: string[]): Promise<void> {
  const send = sendSystemMail({ to, ...m }).then(() => undefined, (e) => { console.error('[pgf-monitor] alert e-mail failed:', String((e as Error)?.message || e)); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([send, new Promise<void>((r) => { timer = setTimeout(r, MAIL_WAIT_MS); })]);
  clearTimeout(timer);
}

let unrecordedMigrationMailed = 0;

/**
 * migrate(), and when a migration fails: log it with a clear marker, record it (creating the monitor's
 * tables if 040 has not run yet) and alert the admins, then rethrow, as the app cannot serve.
 */
export async function migrateReporting(db: Db, list: Migration[] = MIGRATIONS, opts: MonitorOptions = {}): Promise<string[]> {
  try {
    return await migrate(db, list);
  } catch (e) {
    const err = e as Error;
    const admins = opts.adminEmails ?? adminEmailsFromEnv();
    const out = await recordError(db, { kind: 'migration', message: String(err?.message || e), stack: err?.stack }, { ...opts, adminEmails: admins });
    // the database cannot even record it: still tell the admins (once per instance and hour)
    const now = opts.now ?? Date.now();
    if (!out && admins.length && mailAvailability().enabled && now - unrecordedMigrationMailed > ALERT_GAP_MS) {
      unrecordedMigrationMailed = now;
      await sendWithin({ subject: `[Pig's Gotta Fly] MIGRATION FAILED (not recorded)`, text: `${String(err?.message || e)}\n\nRelease: ${release()}\nThe error could not be recorded in app_errors either.` }, admins);
    }
    throw e;
  }
}

// ------------------------------------------------------------------ client report rate limit

/** POST /api/client-errors: a token bucket per IP in rate_limits (api/_lib/rateLimit.ts, RATES.clientErrors). */
export const CLIENT_REPORTS_PER_WINDOW = RATES.clientErrors.burst;
