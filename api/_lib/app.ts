// The API dispatcher, shared by the local server (server/server.ts) and the Vercel function
// (api/index.ts). Matches /api/<path> against the route registry, resolves the session pilot,
// and turns handler results/errors into JSON responses.
import path from 'node:path';

import type { Pilot } from '../../src/shared/types.js';
import { appleKeys, googleKeys, isAdmin, localPilotRow, SESSION_MS, sessionCookie, sessionPilotRow } from './auth.js';
import { AutorouterClient, autorouterFromEnv, type TokenStore } from './autorouter.js';
import type { Db } from './db.js';
import type { ApiConfig, Ctx, JsonBody, Req, Res, Route } from './http.js';
import { compilePath, HttpError, isJsonContentType, readJsonObject, Reply, send } from './http.js';
import { recordError } from './monitor.js';
import { isConstraintViolation } from './pgErrors.js';
import { ROUTES } from './routes/index.js';
import { toPilot } from './rows.js';
import { chromiumSheetPdf } from './sheetPdf.js';

/** The `error` text of a thrown { error } object, if any. */
const errorField = (e: unknown): string | null =>
  e && typeof e === 'object' && 'error' in e && typeof e.error === 'string' ? e.error : null;

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
  if (header(req, 'sec-fetch-site').toLowerCase() === 'cross-site')
    return { status: 403, error: 'cross-site request refused' };
  const origin = header(req, 'origin');
  if (origin) {
    const host = (header(req, 'x-forwarded-host') || header(req, 'host')).split(',')[0].trim().toLowerCase();
    let originHost = '';
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      /* 'null' or garbage */
    }
    if (!originHost || originHost !== host) return { status: 403, error: 'cross-site request refused' };
  }
  if (!isJsonContentType(req.headers['content-type']))
    return { status: 415, error: 'send the request as application/json' };
  return null;
}

const emailList = (v: string | undefined) =>
  (v || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Omit<ApiConfig, 'googleKeys' | 'appleKeys' | 'secureCookie'> {
  return {
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    appleClientId: env.APPLE_CLIENT_ID || '',
    allowedEmails: emailList(env.ALLOWED_EMAILS),
    autorouter: autorouterFromEnv(env),
    adminEmails: emailList(env.ADMIN_EMAILS),
    ...(env.OPEN_METEO_DAILY_BUDGET
      ? { openMeteo: { dailyBudget: Math.max(0, Number(env.OPEN_METEO_DAILY_BUDGET) || 0) } }
      : {}),
    // AUTOROUTER_PILOTS limits the autorouter account to some of the pilots ('*': every signed-in
    // pilot); unset → ALLOWED_EMAILS.
    ...(env.AUTOROUTER_PILOTS !== undefined ? { autorouterPilots: emailList(env.AUTOROUTER_PILOTS) } : {}),
    // the operator's W&B and performance PDF, printed by headless Chromium from the built client
    // (dist/: on Vercel shipped with the function, vercel.json); SHEET_PDF=off: the server's own writer
    sheetPdf:
      env.SHEET_PDF === 'off'
        ? null
        : chromiumSheetPdf({ distDir: path.resolve(env.SHEET_PDF_DIST || path.join(process.cwd(), 'dist')) }),
  };
}

/** The autorouter token in the database, shared by every server instance (one row). */
function tokenStore(db: Db): TokenStore {
  return {
    async get() {
      const [r] = await db.query('SELECT token, expires FROM autorouter_token WHERE id = 1');
      return r?.token ? { value: r.token, expires: Number(r.expires) } : null;
    },
    async refusedUntil() {
      const [r] = await db.query('SELECT refused_until FROM autorouter_token WHERE id = 1');
      return Number(r?.refused_until) || 0;
    },
    async refuse(until) {
      await db.query(
        `INSERT INTO autorouter_token (id, refused_until) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET refused_until = EXCLUDED.refused_until`,
        [until],
      );
    },
    async set(t) {
      await db.query(
        `INSERT INTO autorouter_token (id, token, expires) VALUES (1, $1, $2)
         ON CONFLICT (id) DO UPDATE SET token = EXCLUDED.token, expires = EXCLUDED.expires`,
        [t.value, t.expires],
      );
    },
    async drop(value) {
      await db.query('DELETE FROM autorouter_token WHERE id = 1 AND token = $1', [value]);
    },
  };
}

export function createApi(
  opts: { db: Db } & Partial<ApiConfig>,
  routes: Route[] = ROUTES,
): (req: Req, res: Res) => Promise<void> {
  const allowedEmails = (opts.allowedEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const config: ApiConfig = {
    googleClientId: opts.googleClientId || '',
    allowedEmails,
    autorouterPilots: (opts.autorouterPilots ?? allowedEmails).map((e) => e.trim().toLowerCase()).filter(Boolean),
    googleKeys: opts.googleKeys || googleKeys,
    // Apple sign-in only next to Google's (sessions exist only in Google mode)
    appleClientId: opts.googleClientId ? opts.appleClientId || '' : '',
    appleKeys: opts.appleKeys || appleKeys,
    secureCookie: !!opts.secureCookie,
    autorouter: opts.autorouter ?? null,
    adminEmails: (opts.adminEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean),
    openMeteo: opts.openMeteo,
    aviationWeather: opts.aviationWeather,
    sheetPdf: opts.sheetPdf ?? null,
  };
  const autorouter = config.autorouter ? new AutorouterClient(config.autorouter, tokenStore(opts.db)) : null;
  if (autorouter && config.googleClientId && !config.autorouterPilots!.length) {
    console.warn(
      'autorouter: neither AUTOROUTER_PILOTS nor ALLOWED_EMAILS is set; NOTAMs and filing are disabled for every pilot',
    );
  }
  const listed = (list: string[], p: Pilot | null): boolean =>
    !!p &&
    (!config.googleClientId ||
      list.includes(
        String(p.email || '')
          .trim()
          .toLowerCase(),
      ));
  /** The shared autorouter account is for the listed pilots ('*': all of them; local mode: the local pilot). */
  const autorouterFor = (p: Pilot | null): boolean =>
    config.autorouterPilots!.includes('*') ? !!p : listed(config.autorouterPilots!, p);
  /** Any signed-in pilot may e-mail forms; the pilot is cc'd, so an e-mail address is needed. */
  const formsMailFor = (p: Pilot | null): boolean => !!p && !!String(p.email || '').trim();
  const db = opts.db;
  const compiled = routes.map((r) => ({ ...r, match: compilePath(r.path) }));

  /** Records a 5xx answer (or the unhandled error behind it) in app_errors; never throws. */
  const monitor = (req: Req, status: number, e: unknown, route: string | null, pilot: Pilot | null) =>
    recordError(
      db,
      {
        kind: 'server',
        message: e instanceof Error ? e.message : (errorField(e) ?? `HTTP ${status}`),
        stack: e instanceof Error && !(e instanceof HttpError) ? e.stack : null,
        route,
        method: req.method || null,
        status,
        pilotId: pilot?.id ?? null,
        userAgent: String(req.headers['user-agent'] || '') || null,
      },
      { adminEmails: config.adminEmails },
    );

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
            ? await sessionPilotRow(db, req, config.allowedEmails, (tok) => {
                renewed = sessionCookie(tok, SESSION_MS / 1000, config.secureCookie);
              })
            : await localPilotRow(db);
          if (!row) return send(res, 401, { error: 'sign in' });
          pilot = toPilot(row);
        }
        let bodyP: Promise<JsonBody> | null = null;
        const arOk = autorouterFor(pilot);
        const ctx: Ctx = {
          req,
          db,
          config,
          params,
          query: url.searchParams,
          pilot: pilot!,
          headers: renewed ? { 'Set-Cookie': renewed } : {},
          autorouter: arOk ? autorouter : null,
          autorouterDenied: !!autorouter && !arOk,
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
      // constraint violations from bad references are client errors
      if (isConstraintViolation(e)) return send(res, 400, { error: 'invalid reference' });
      console.error(e);
      await monitor(req, 500, e, route, pilot);
      return send(res, 500, { error: 'server error' });
    }
  };
}
