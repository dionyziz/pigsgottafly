// The API dispatcher, shared by the local server (server/server.ts) and the Vercel function
// (api/index.ts). Matches /api/<path> against the route registry, resolves the session pilot,
// and turns handler results/errors into JSON responses.
import type { Db } from './db.js';
import type { ApiConfig, Ctx, Req, Res, Route } from './http.js';
import { compilePath, HttpError, readJsonObject, Reply, send } from './http.js';
import { googleKeys, localPilotRow, sessionPilotRow } from './auth.js';
import { toPilot } from './rows.js';
import { ROUTES } from './routes/index.js';
import { AutorouterClient, autorouterFromEnv } from './autorouter.js';

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Omit<ApiConfig, 'googleKeys' | 'secureCookie'> {
  return {
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    allowedEmails: (env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    autorouter: autorouterFromEnv(env),
  };
}

export function createApi(opts: { db: Db } & Partial<ApiConfig>, routes: Route[] = ROUTES): (req: Req, res: Res) => Promise<void> {
  const config: ApiConfig = {
    googleClientId: opts.googleClientId || '',
    allowedEmails: (opts.allowedEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean),
    googleKeys: opts.googleKeys || googleKeys,
    secureCookie: !!opts.secureCookie,
    autorouter: opts.autorouter ?? null,
  };
  const autorouter = config.autorouter ? new AutorouterClient(config.autorouter) : null;
  const db = opts.db;
  const compiled = routes.map((r) => ({ ...r, match: compilePath(r.path) }));

  return async function handle(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://x');
      const path = '/' + url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
      let pathMatched = false;
      for (const r of compiled) {
        const params = r.match(path);
        if (!params) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        let pilot = null;
        if (r.auth !== false) {
          const row = config.googleClientId ? await sessionPilotRow(db, req, config.allowedEmails) : await localPilotRow(db);
          if (!row) return send(res, 401, { error: 'sign in' });
          pilot = toPilot(row);
        }
        let bodyP: Promise<any> | null = null;
        const ctx: Ctx = { req, db, config, params, query: url.searchParams, pilot: pilot!, headers: {}, autorouter, body: () => (bodyP ||= readJsonObject(req)) };
        const out = await r.handler(ctx);
        if (out instanceof Reply) return send(res, out.status, out.body, { ...ctx.headers, ...out.headers });
        if (out === undefined) return send(res, 204, undefined, ctx.headers);
        return send(res, 200, out, ctx.headers);
      }
      return send(res, pathMatched ? 405 : 404, { error: pathMatched ? 'method not allowed' : 'not found' });
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof HttpError) {
        // 409 carries the current record as the body (optimistic concurrency)
        return send(res, e.status, e.body !== undefined ? e.body : { error: e.message });
      }
      const msg = String((e as Error)?.message || e);
      // constraint violations from bad references are client errors
      if (/violates (foreign key|check|unique) constraint/.test(msg)) return send(res, 400, { error: 'invalid reference' });
      console.error(e);
      return send(res, 500, { error: 'server error' });
    }
  };
}
