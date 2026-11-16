// Client error reporting: uncaught errors, unhandled promise rejections, ErrorBoundary catches and API
// calls answered with a 5xx are POSTed to /api/client-errors (api/_lib/routes/monitoring.ts), which
// groups them and alerts the admins. Only the page's path is sent (no query, hash or origin; ids
// masked), never request bodies. A stale-chunk error after a deploy is expected (staleBuild.ts) and
// not reported. Each distinct error is sent at most once per DEDUPE_MS, and a page sends at most
// MAX_PER_PAGE reports, so an error in a render loop cannot flood the server.
import { CLIENT_REPORT_MAX_BYTES, type ClientErrorReport, scrubText, scrubUrl } from '../shared/monitoring';
import { isChunkLoadError } from './staleBuild';

export const DEDUPE_MS = 10 * 60 * 1000;
export const MAX_PER_PAGE = 20;

/** Noise from the browser or extensions, not from the app. */
export function isIgnorable(message: string, stack?: string): boolean {
  if (isChunkLoadError(message)) return true;
  if (/^Script error\.?$/i.test(message.trim())) return true; // cross-origin, no details
  if (/ResizeObserver loop/i.test(message)) return true;
  if (/(chrome|moz|safari(-web)?)-extension:\/\//i.test(stack || '')) return true;
  if (/^AbortError|The (operation|user) aborted|signal is aborted/i.test(message)) return true;
  // errors raised entirely inside third-party scripts (e.g. Google's sign-in client): every stack
  // frame is on another origin, so there's nothing of ours to fix
  const frames = (stack || '')
    .split('\n')
    .map((l) => /(https?:\/\/[^/\s)]+)/.exec(l)?.[1])
    .filter((o): o is string => !!o);
  const own = typeof location !== 'undefined' ? location.origin : '';
  if (frames.length && frames.every((o) => o !== own)) return true;
  return false;
}

/** The dedupe/sampling gate: pure, so it can be tested without a browser. */
export function createReporter(
  send: (r: ClientErrorReport) => void,
  opts: { now?: () => number; dedupeMs?: number; max?: number } = {},
) {
  const now = opts.now ?? Date.now;
  const dedupeMs = opts.dedupeMs ?? DEDUPE_MS;
  const max = opts.max ?? MAX_PER_PAGE;
  const seen = new Map<string, number>();
  let sent = 0;
  return function report(r: ClientErrorReport): boolean {
    if (sent >= max) return false;
    if (r.source !== 'api' && isIgnorable(r.message, r.stack)) return false;
    const key = [
      r.source,
      r.message.slice(0, 200),
      r.apiPath ?? '',
      r.status ?? '',
      (r.stack || '').split('\n')[1] ?? '',
    ].join('|');
    const t = now();
    const last = seen.get(key);
    if (last !== undefined && t - last < dedupeMs) return false;
    seen.set(key, t);
    sent++;
    const clean: ClientErrorReport = {
      ...r,
      message: scrubText(r.message).slice(0, 1000),
      stack: r.stack ? scrubText(r.stack.split('\n').slice(0, 30).join('\n')).slice(0, 6000) : undefined,
      url: scrubUrl(r.url) ?? undefined,
      apiPath: r.apiPath ? (scrubUrl(r.apiPath) ?? undefined) : undefined,
    };
    try {
      send(clean);
    } catch {
      /* never throw from the reporter */
    }
    return true;
  };
}

function post(r: ClientErrorReport): void {
  const body = JSON.stringify(r);
  if (body.length > CLIENT_REPORT_MAX_BYTES) return;
  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => {
    /* offline: drop it */
  });
}

const reporter = createReporter((r) => post(r));
const page = () => (typeof window !== 'undefined' ? window.location.pathname : undefined);

function describe(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error)
    return { message: `${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${e.message || String(e)}`, stack: e.stack };
  if (typeof e === 'string') return { message: e };
  try {
    return { message: JSON.stringify(e)?.slice(0, 500) ?? String(e) };
  } catch {
    return { message: String(e) };
  }
}

/** An error caught by a React ErrorBoundary (stale-chunk errors are skipped). */
export function reportError(e: unknown, source: ClientErrorReport['source'] = 'react', componentStack?: string): void {
  const d = describe(e);
  const stack =
    [d.stack, componentStack ? 'React component stack:' + componentStack : ''].filter(Boolean).join('\n') || undefined;
  reporter({ source, message: d.message, stack, url: page() });
}

/** An API call answered with a 5xx (src/data/api.ts). */
export function reportApiFailure(method: string, path: string, status: number, error: string): void {
  if (status < 500 || path.startsWith('client-errors')) return;
  reporter({
    source: 'api',
    message: error || `HTTP ${status}`,
    method,
    status,
    apiPath: '/api/' + path.split('?')[0],
    url: page(),
  });
}

let installed = false;
/** window.onerror + unhandledrejection (src/main.tsx). */
export function installErrorReporting(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => {
    // resource load errors (img/script) have no ev.error and are not app errors
    if (!ev.error && !ev.message) return;
    const d = ev.error
      ? describe(ev.error)
      : { message: String(ev.message), stack: ev.filename ? `at ${ev.filename}:${ev.lineno}:${ev.colno}` : undefined };
    reporter({ source: 'error', message: d.message, stack: d.stack, url: page() });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    // a failed API call: a 5xx is reported by api.ts already, offline/4xx are not app errors
    if ((ev.reason as Error | undefined)?.name === 'ApiRequestError') return;
    const d = describe(ev.reason);
    reporter({ source: 'rejection', message: d.message, stack: d.stack, url: page() });
  });
}
