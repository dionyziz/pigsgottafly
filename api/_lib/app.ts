// The API dispatcher, shared by the local server (server/server.ts) and the Vercel function
// (api/index.ts). Matches /api/<path> against the route registry, resolves the session pilot,
// and turns handler results/errors into JSON responses.
import type { Db } from './db.js';
import type { ApiConfig, Ctx, Req, Res, Route } from './http.js';
import { compilePath, HttpError, isJsonContentType, readJsonObject, Reply, send } from './http.js';
import { googleKeys, isAdmin, localPilotRow, sessionCookie, sessionPilotRow, SESSION_MS } from './auth.js';
import type { Pilot } from '../../src/shared/types.js';
import { toPilot } from './rows.js';
import { ROUTES } from './routes/index.js';
import { AutorouterClient, autorouterFromEnv } from './autorouter.js';
import { recordError } from './monitor.js';

const header = (req: Req, name: string): string => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v || '').trim();
};

/**
 * CSRF defence in depth (besides the SameSite=Lax cookie): a state-changing request (anything but
 * GET/HEAD) is refused when the browser says it comes from another site (Sec-Fetch-Site: cross-site,
 * or an Origin that is not this host), and it must be declared application/json, even with an empty
 * body (HTML forms cannot send that type without CORS).
 */
export function crossSiteRefusal(req: Req): { status: number; error: string } | null {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (header(req, 'sec-fetch-site').toLowerCase() === 'cross-site') return { status: 403, error: 'cross-site request refused' };
  const origin = header(req, 'origin');
  if (origin) {
    const host = (header(req, 'x-forwarded-host') || header(req, 'host')).split(',')[0].trim().toLowerCase();
    let originHost = '';
    try { originHost = new URL(origin).host.toLowerCase(); } catch { /* 'null' or garbage */ }
    if (!originHost || originHost !== host) return { status: 403, error: 'cross-site request refused' };
  }
  if (!isJsonContentType(req.headers['content-type'])) return { status: 415, error: 'send the request as application/json' };
  return null;
}

const emailList = (v: string | undefined) => (v || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Omit<ApiConfig, 'googleKeys' | 'secureCookie'> {
  return {
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    allowedEmails: emailList(env.ALLOWED_EMAILS),
    autorouter: autorouterFromEnv(env),
    adminEmails: emailList(env.ADMIN_EMAILS),
    // AUTOROUTER_PILOTS limits the autorouter account to some of the pilots; unset → ALLOWED_EMAILS.
    ...(env.AUTOROUTER_PILOTS !== undefined ? { autorouterPilots: emailList(env.AUTOROUTER_PILOTS) } : {}),
  };
}

export function createApi(opts: { db: Db } & Partial<ApiConfig>, routes: Route[] = ROUTES): (req: Req, res: Res) => Promise<void> {
  const allowedEmails = (opts.allowedEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const config: ApiConfig = {
    googleClientId: opts.googleClientId || '',
    allowedEmails,
    autorouterPilots: (opts.autorouterPilots ?? allowedEmails).map((e) => e.trim().toLowerCase()).filter(Boolean),
    googleKeys: opts.googleKeys || googleKeys,
    secureCookie: !!opts.secureCookie,
    autorouter: opts.autorouter ?? null,
    adminEmails: (opts.adminEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean),
  };
  const autorouter = config.autorouter ? new AutorouterClient(config.autorouter) : null;
  if (autorouter && config.googleClientId && !config.autorouterPilots!.length) {
    console.warn('autorouter: neither AUTOROUTER_PILOTS nor ALLOWED_EMAILS is set; NOTAMs and filing are disabled for every pilot');
  }
  const listed = (list: string[], p: Pilot | null): boolean =>
    !!p && (!config.googleClientId || list.includes(String(p.email || '').trim().toLowerCase()));
  /** The shared autorouter account is for the listed pilots only (local mode: the local pilot). */
  const autorouterFor = (p: Pilot | null): boolean => listed(config.autorouterPilots!, p);
  /** Any signed-in pilot may e-mail forms; the pilot is cc'd, so an e-mail address is needed. */
  const formsMailFor = (p: Pilot | null): boolean => !!p && !!String(p.email || '').trim();
  const db = opts.db;
  const compiled = routes.map((r) => ({ ...r, match: compilePath(r.path) }));

  /** Records a 5xx answer (or the unhandled error behind it) in app_errors; never throws. */
  const monitor = (req: Req, status: number, e: unknown, route: string | null, pilot: Pilot | null) =>
    recordError(db, {
      kind: 'server',
      message: e instanceof Error ? e.message : typeof (e as any)?.error === 'string' ? (e as any).error : `HTTP ${status}`,
      stack: e instanceof Error && !(e instanceof HttpError) ? e.stack : null,
      route, method: req.method || null, status, pilotId: pilot?.id ?? null,
      userAgent: String(req.headers['user-agent'] || '') || null,
    }, { adminEmails: config.adminEmails });

  return async function handle(req, res) {
    let route: string | null = null;
    let pilot: Pilot | null = null;
    try {
      const refused = crossSiteRefusal(req);
      if (refused) return send(res, refused.status, { error: refused.error });
      const url = new URL(req.url || '/', 'http://x');
      const path = '/' + url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
      route = '/api' + path; // until a route matches: scrubbed by the monitor
      let pathMatched = false;
      for (const r of compiled) {
        const params = r.match(path);
        if (!params) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        route = '/api' + r.path;
        let renewed: string | null = null;
        if (r.auth !== false) {
          const row = config.googleClientId
            ? await sessionPilotRow(db, req, config.allowedEmails, (tok) => { renewed = sessionCookie(tok, SESSION_MS / 1000, config.secureCookie); })
            : await localPilotRow(db);
          if (!row) return send(res, 401, { error: 'sign in' });
          pilot = toPilot(row);
        }
        let bodyP: Promise<any> | null = null;
        const arOk = autorouterFor(pilot);
        const ctx: Ctx = {
          req, db, config, params, query: url.searchParams, pilot: pilot!, headers: renewed ? { 'Set-Cookie': renewed } : {},
          autorouter: arOk ? autorouter : null, autorouterDenied: !!autorouter && !arOk,
          formsMailDenied: !formsMailFor(pilot),
          isAdmin: isAdmin(config, pilot),
          body: () => (bodyP ||= readJsonObject(req)),
        };
        const out = await r.handler(ctx);
        if (out instanceof Reply) {
          if (out.status >= 500) await monitor(req, out.status, out.body, route, pilot);
          return send(res, out.status, out.body, { ...ctx.headers, ...out.headers });
        }
        if (out === undefined) return send(res, 204, undefined, ctx.headers);
        return send(res, 200, out, ctx.headers);
      }
      return send(res, pathMatched ? 405 : 404, { error: pathMatched ? 'method not allowed' : 'not found' });
    } catch (e) {
      if (res.headersSent) {
        if (!(e instanceof HttpError) || e.status >= 500) await monitor(req, 500, e, route, pilot);
        return;
      }
      if (e instanceof HttpError) {
        if (e.status >= 500) await monitor(req, e.status, e, route, pilot);
        // 409 carries the current record as the body (optimistic concurrency)
        return send(res, e.status, e.body !== undefined ? e.body : { error: e.message });
      }
      const msg = String((e as Error)?.message || e);
      // constraint violations from bad references are client errors
      if (/violates (foreign key|check|unique) constraint/.test(msg)) return send(res, 400, { error: 'invalid reference' });
      console.error(e);
      await monitor(req, 500, e, route, pilot);
      return send(res, 500, { error: 'server error' });
    }
  };
}
