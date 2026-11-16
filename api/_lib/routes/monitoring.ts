// Monitoring (api/_lib/monitor.ts):
//   GET  /health                           no sign-in: 200/503 JSON (database, migrations; AIRAC and
//                                          e-mail as warnings). Polled by .github/workflows/uptime.yml.
//   POST /client-errors                    no sign-in: a ClientErrorReport from src/app/errorReporter.ts;
//                                          rate-limited per IP, size-capped; the session's pilot if any
//   GET  /admin/errors?status=open|resolved|all   the grouped errors (ADMIN_EMAILS only, 403 otherwise)
//   GET  /admin/errors/:fingerprint        one group with its last stack
//   POST /admin/errors/:fingerprint/resolve  marks it resolved; a recurrence alerts again
import {
  type AppErrorDetail,
  type AppErrorGroup,
  CLIENT_REPORT_MAX_BYTES,
  type ClientErrorReport,
  type HealthResponse,
  scrubUrl,
} from '../../../src/shared/monitoring.js';
import { localPilotRow, sessionPilotRow } from '../auth.js';
import type { Route } from '../http.js';
import { HttpError, notFound, reply } from '../http.js';
import { mailAvailability } from '../mail.js';
import { MIGRATIONS } from '../migrate.js';
import { recordError, release } from '../monitor.js';
import { rateLimit } from '../rateLimit.js';

type Row = Record<string, any>;
const num = (v: unknown): number | null => (v == null ? null : Number(v));

const AIRAC_CYCLE_DAYS = 28;

const SOURCES = new Set<ClientErrorReport['source']>(['error', 'rejection', 'react', 'api']);
const str = (v: unknown, n: number): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, n) : null);

function toGroup(r: Row): AppErrorGroup {
  return {
    fingerprint: r.fingerprint,
    kind: r.kind,
    message: r.message,
    route: r.route,
    method: r.method,
    status: num(r.status),
    release: r.release,
    count: Number(r.count),
    firstSeen: Number(r.first_seen),
    lastSeen: Number(r.last_seen),
    resolvedAt: num(r.resolved_at),
    lastAlerted: num(r.last_alerted),
  };
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/health',
    auth: false,
    async handler({ db, config }) {
      const out: HealthResponse = {
        ok: false,
        release: release(),
        time: Date.now(),
        checks: {
          db: { ok: false },
          migrations: { ok: false, expected: MIGRATIONS.length, applied: 0, pending: [] },
          airac: { ok: false, id: null, effective: null, expires: null },
          mail: { ok: mailAvailability().enabled },
        },
      };
      const problems: string[] = [];
      try {
        await db.query('SELECT 1');
        out.checks.db.ok = true;
      } catch {
        problems.push('database unreachable');
      }
      if (out.checks.db.ok) {
        try {
          const done = new Set(
            (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name),
          );
          const pending = MIGRATIONS.filter((m) => !done.has(m.name)).map((m) => m.name);
          out.checks.migrations = {
            ok: !pending.length,
            expected: MIGRATIONS.length,
            applied: MIGRATIONS.length - pending.length,
            pending,
          };
          if (pending.length) problems.push(`migrations pending: ${pending.join(', ')}`);
        } catch {
          problems.push('migrations unknown');
        }
        try {
          const [a] = await db.query('SELECT id, effective FROM ref_airac WHERE current LIMIT 1');
          if (a) {
            const expires = new Date(Date.parse(a.effective + 'T00:00:00Z') + AIRAC_CYCLE_DAYS * 86400e3)
              .toISOString()
              .slice(0, 10);
            const ok = new Date().toISOString().slice(0, 10) < expires;
            out.checks.airac = { ok, id: a.id, effective: a.effective, expires };
            // a warning, not a failure: e-mailed once (a new group) by the monitor, listed on /admin/errors
            if (!ok)
              await recordError(
                db,
                {
                  kind: 'cron',
                  message: `AIRAC ${a.id} is out of date since ${expires}: load the new AIRAC (AIP-UPDATE.md)`,
                  route: '/api/health',
                },
                { adminEmails: config.adminEmails },
              );
          }
        } catch {
          /* reported as not ok */
        }
      }
      out.ok = out.checks.db.ok && out.checks.migrations.ok;
      if (out.ok) return out;
      out.error = problems.join('; ') || 'unhealthy';
      return reply(503, out);
    },
  },
  {
    method: 'POST',
    path: '/client-errors',
    auth: false,
    async handler({ db, req, config, body }) {
      if (Number(req.headers['content-length'] || 0) > CLIENT_REPORT_MAX_BYTES) throw new HttpError(413, 'too large');
      await rateLimit(db, 'clientErrors', { req }); // per IP, signed in or not
      const b = (await body()) as Partial<ClientErrorReport>;
      if (JSON.stringify(b).length > CLIENT_REPORT_MAX_BYTES) throw new HttpError(413, 'too large');
      const source = SOURCES.has(b.source as any) ? b.source! : null;
      const message = str(b.message, 1000);
      if (!source || !message) throw new HttpError(400, 'source and message are required');
      let pilotId: string | null = null;
      try {
        const row = config.googleClientId
          ? await sessionPilotRow(db, req, config.allowedEmails)
          : await localPilotRow(db);
        pilotId = row?.id ?? null;
      } catch {
        /* anonymous */
      }
      const status = Number.isInteger(b.status) && b.status! >= 100 && b.status! < 600 ? b.status! : null;
      const method = str(b.method, 10)?.toUpperCase() ?? null;
      const apiPath = scrubUrl(str(b.apiPath, 300));
      await recordError(
        db,
        {
          kind: 'client',
          group: source,
          message: source === 'api' ? `API ${method ?? '?'} ${apiPath ?? '?'} failed: ${message}` : message,
          stack: str(b.stack, 8000),
          route: str(b.url, 300),
          method,
          status,
          pilotId,
          userAgent: str(req.headers['user-agent'], 300),
        },
        { adminEmails: config.adminEmails },
      );
      return undefined;
    },
  },
  {
    method: 'GET',
    path: '/admin/errors',
    async handler({ db, isAdmin, query }): Promise<AppErrorGroup[]> {
      if (!isAdmin) throw new HttpError(403, 'admins only');
      const status = query.get('status') || 'open';
      const where =
        status === 'resolved' ? 'WHERE resolved_at IS NOT NULL' : status === 'all' ? '' : 'WHERE resolved_at IS NULL';
      return (await db.query(`SELECT * FROM app_errors ${where} ORDER BY last_seen DESC LIMIT 300`)).map(toGroup);
    },
  },
  {
    method: 'GET',
    path: '/admin/errors/:fingerprint',
    async handler({ db, isAdmin, params }): Promise<AppErrorDetail> {
      if (!isAdmin) throw new HttpError(403, 'admins only');
      const [r] = await db.query('SELECT * FROM app_errors WHERE fingerprint = $1', [params.fingerprint]);
      if (!r) throw notFound();
      return { ...toGroup(r), stack: r.stack, userAgent: r.user_agent, pilotId: r.pilot_id };
    },
  },
  {
    method: 'POST',
    path: '/admin/errors/:fingerprint/resolve',
    async handler({ db, isAdmin, params }) {
      if (!isAdmin) throw new HttpError(403, 'admins only');
      const r = await db.query('UPDATE app_errors SET resolved_at = $2 WHERE fingerprint = $1 RETURNING fingerprint', [
        params.fingerprint,
        Date.now(),
      ]);
      if (!r.length) throw notFound();
      return { ok: true };
    },
  },
];
