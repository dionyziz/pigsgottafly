// Linking a pilot's own autorouter account (api/_lib/autorouterLinks.ts):
//   GET  /autorouter                    AutorouterLinkStatus (src/shared/api.ts)
//   GET  /autorouter/connect?return=…   (signed in, top-level navigation) → autorouter's authorize page
//   POST /autorouter/app-connect        (the iOS app) { url }: opened in the app's sign-in sheet, which
//                                       has Safari's cookies, not the app's session
//   GET  /autorouter/app-connect?ticket → autorouter's authorize page; back as pigsgottafly://autorouter?result=…
//   GET  /autorouter/callback           autorouter's redirect (the URI registered with autorouter)
//   POST /autorouter/disconnect         forgets the tokens (autorouter has no revocation)
// The pilot comes back to the page they left with ?autorouter=connected|denied|failed.
import {
  APP_RETURN,
  appTicket,
  type AutorouterOAuthSettings,
  beginLink,
  checkState,
  checkTicket,
  deleteLink,
  exchangeCode,
  linkStatus,
  NONCE_COOKIE,
  readLink,
  type ReturnTo,
  saveLink,
} from '../autorouterLinks.js';
import type { Route } from '../http.js';
import { appOrigin, type Ctx, notFound, Reply } from '../http.js';
import { rateLimit } from '../rateLimit.js';

const settings = (ctx: Ctx): AutorouterOAuthSettings => {
  const s = ctx.config.autorouterOAuth;
  if (!s) throw notFound();
  return s;
};

const redirectUri = (ctx: Ctx, s: AutorouterOAuthSettings) =>
  s.redirectUri || `${appOrigin(ctx.req, ctx.config.secureCookie)}/api/autorouter/callback`;

/** A path on this site only: anything else could send the pilot to another site after linking. */
export function returnPath(v: string | null): ReturnTo {
  return v && v.length <= 500 && /^\/(?![/\\])/.test(v) && !/[\s\\]/.test(v) ? v : '/profile';
}

const nonceCookie = (ctx: Ctx, value: string, maxAge: number) =>
  `${NONCE_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/api/autorouter; Max-Age=${maxAge}${ctx.config.secureCookie ? '; Secure' : ''}`;

function begin(ctx: Ctx, pilotId: string, ret: ReturnTo): Reply {
  const s = settings(ctx);
  const { url, nonce } = beginLink(s, pilotId, ret, redirectUri(ctx, s));
  return new Reply(302, null, { Location: url, 'Set-Cookie': nonceCookie(ctx, nonce, 600) });
}

type Result = 'connected' | 'denied' | 'failed';
function back(ret: ReturnTo, result: Result): string {
  if (ret === APP_RETURN) return `pigsgottafly://autorouter?result=${result}`;
  const [path, hash] = ret.split('#', 2);
  return `${path}${path.includes('?') ? '&' : '?'}autorouter=${result}${hash !== undefined ? `#${hash}` : ''}`;
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/autorouter',
    async handler({ db, pilot, config }) {
      return linkStatus(config.autorouterOAuth, config.autorouterOAuth ? await readLink(db, pilot.id) : null);
    },
  },
  {
    method: 'GET',
    path: '/autorouter/connect',
    async handler(ctx) {
      return begin(ctx, ctx.pilot.id, returnPath(ctx.query.get('return')));
    },
  },
  {
    method: 'POST',
    path: '/autorouter/app-connect',
    async handler(ctx) {
      const s = settings(ctx);
      const origin = appOrigin(ctx.req, ctx.config.secureCookie);
      return { url: `${origin}/api/autorouter/app-connect?ticket=${encodeURIComponent(appTicket(s, ctx.pilot.id))}` };
    },
  },
  {
    method: 'GET',
    path: '/autorouter/app-connect',
    auth: false,
    async handler(ctx) {
      const s = settings(ctx);
      await rateLimit(ctx.db, 'login', { req: ctx.req });
      const pilotId = checkTicket(s, ctx.query.get('ticket'));
      if (!pilotId) return new Reply(302, null, { Location: back(APP_RETURN, 'failed') });
      return begin(ctx, pilotId, APP_RETURN);
    },
  },
  {
    method: 'GET',
    path: '/autorouter/callback',
    auth: false,
    async handler(ctx) {
      const s = settings(ctx);
      const { db, query, req } = ctx;
      await rateLimit(db, 'login', { req });
      const cookie = new RegExp(`(?:^|;\\s*)${NONCE_COOKIE}=([\\w-]+)`).exec(req.headers.cookie || '')?.[1] ?? null;
      const st = checkState(s, query.get('state'), cookie);
      const done = (ret: ReturnTo, result: Result) =>
        new Reply(302, null, { Location: back(ret, result), 'Set-Cookie': nonceCookie(ctx, '', 0) });
      if (!st) return done('/profile', 'failed');
      const error = query.get('error');
      if (error) return done(st.ret, error === 'access_denied' ? 'denied' : 'failed');
      const code = query.get('code');
      if (!code) return done(st.ret, 'failed');
      const r = await exchangeCode(s, code, redirectUri(ctx, s));
      if (!r.ok) {
        console.warn('autorouter: linking refused:', r.error);
        return done(st.ret, 'failed');
      }
      try {
        await saveLink(db, s, st.pilotId, r.token);
      } catch (e) {
        // the pilot's account was deleted meanwhile
        console.warn('autorouter: link not stored:', String((e as Error)?.message || e));
        return done(st.ret, 'failed');
      }
      return done(st.ret, 'connected');
    },
  },
  {
    method: 'POST',
    path: '/autorouter/disconnect',
    async handler({ db, pilot, config }) {
      if (!config.autorouterOAuth) throw notFound();
      await deleteLink(db, pilot.id);
      return linkStatus(config.autorouterOAuth, null);
    },
  },
];
