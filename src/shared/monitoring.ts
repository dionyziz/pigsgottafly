// Error monitoring contract (api/_lib/monitor.ts, api/_lib/routes/monitoring.ts, src/app/errorReporter.ts):
// what the client reports, the grouped errors the admin page lists, the health check, and the
// scrubbing both sides apply so that no query string, token or e-mail address is stored.

export type AppErrorKind = 'server' | 'client' | 'migration' | 'cron';

/** POST /api/client-errors (no sign-in; rate-limited per IP; at most CLIENT_REPORT_MAX_BYTES). */
export interface ClientErrorReport {
  /** What caught it. */
  source: 'error' | 'rejection' | 'react' | 'api';
  message: string;
  stack?: string;
  /** The page's path (no origin, query or hash). */
  url?: string;
  /** source 'api': the failed request. */
  method?: string;
  status?: number;
  /** The API path of a failed request (source 'api'), without its query. */
  apiPath?: string;
}
export const CLIENT_REPORT_MAX_BYTES = 16 * 1024;

/** One group of errors (GET /api/admin/errors). */
export interface AppErrorGroup {
  fingerprint: string;
  kind: AppErrorKind;
  message: string;
  route: string | null;
  method: string | null;
  status: number | null;
  release: string | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
  resolvedAt: number | null;
  lastAlerted: number | null;
}
/** GET /api/admin/errors/:fingerprint */
export interface AppErrorDetail extends AppErrorGroup {
  stack: string | null;
  userAgent: string | null;
  pilotId: string | null;
}

/** GET /api/health: 200 when ok, 503 otherwise. airac and mail are warnings and do not fail it. */
export interface HealthResponse {
  ok: boolean;
  /** What failed, when not ok. */
  error?: string;
  release: string;
  time: number;
  checks: {
    db: { ok: boolean };
    migrations: { ok: boolean; expected: number; applied: number; pending: string[] };
    /** The AIRAC in effect, the next one when loaded ahead, and when the loaded data runs out. */
    airac: { ok: boolean; id: string | null; effective: string | null; expires: string | null; next?: string | null };
    mail: { ok: boolean };
  };
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

/** Masks e-mail addresses and long opaque tokens in free text (messages, stacks). */
export function scrubText(s: string): string {
  return s
    .replace(EMAIL, '<email>')
    .replace(/\b(Bearer\s+|token=|key=)[\w.~+/-]+=*/gi, '$1<redacted>')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, '<token>');
}

/** A path segment that is an id or a token rather than a word of the route. */
const isIdSegment = (seg: string): boolean =>
  /^[a-z]{1,4}_[\w-]{5,}$/i.test(seg) || // fl_Xk3…, pl_…, ac_…
  /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || // uuid
  seg.length >= 20 || // signing tokens and the like
  (seg.length >= 8 && /\d/.test(seg) && /[A-Z]/.test(seg) && /[a-z]/.test(seg)) || // base64-ish
  /^\d+$/.test(seg) ||
  /@/.test(seg);

/** Path only: no origin, query or hash; ids and tokens become ':id'. */
export function scrubUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  let p = String(u).trim();
  p = p.replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, '');
  p = p.split(/[?#]/)[0] || '/';
  if (!p.startsWith('/')) p = '/' + p;
  const segs = p.split('/').map((s) => {
    let d = s;
    try {
      d = decodeURIComponent(s);
    } catch {
      /* keep raw */
    }
    return d && isIdSegment(d) ? ':id' : s;
  });
  return segs.join('/').slice(0, 200);
}
