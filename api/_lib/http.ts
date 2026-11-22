// HTTP plumbing shared by the route modules: the route type, errors, JSON helpers.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FilerId } from '../../src/shared/briefing.js';
import type { Pilot } from '../../src/shared/types.js';
import type { AutorouterClient, AutorouterSettings } from './autorouter.js';
import type { Db } from './db.js';
import type { FaxProvider, FaxSettings } from './filers/faxProviders.js';
import type { Filer } from './filers/types.js';
import type { WeatherProxyOptions } from './routes/weather.js';
import type { WeatherGridOptions } from './routes/weatherGrid.js';
import type { FaxPdfRenderer, NavlogPdfRenderer, SheetPdfRenderer } from './sheetPdf.js';

/** Node request, possibly with a body pre-parsed by Vercel. */
export type Req = IncomingMessage & { body?: unknown };
export type Res = ServerResponse;

const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;
const firstHeader = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? '')).split(',')[0].trim();
/** The app's origin as the pilot's browser reached it (for links in e-mails). */
export function appOrigin(req: Req, secure: boolean): string {
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host);
  const fwd = firstHeader(req.headers['x-forwarded-proto']);
  const proto = fwd === 'https' || fwd === 'http' ? fwd : secure ? 'https' : 'http';
  return HOST_RE.test(host) ? `${proto}://${host}` : 'https://pigsgottafly.com';
}

export interface ApiConfig {
  /** Google OAuth client id; '' = local mode (no sign-in, one 'local' pilot). */
  googleClientId: string;
  /** Lower-cased; empty = anyone with a Google account. */
  allowedEmails: string[];
  /** Fetches Google's signing keys (JWKs); injectable for tests. */
  googleKeys: () => Promise<JsonWebKey[]>;
  /** Sign in with Apple Services ID (APPLE_CLIENT_ID); '' = no Apple sign-in. Needs Google mode. */
  appleClientId?: string;
  /** Fetches Apple's signing keys (JWKs); injectable for tests. */
  appleKeys?: () => Promise<JsonWebKey[]>;
  secureCookie: boolean;
  /** autorouter account (NOTAMs, filing); null/undefined = not configured. Tests inject a mocked fetch. */
  autorouter?: AutorouterSettings | null;
  /**
   * Lower-cased e-mails of the pilots who may use the autorouter account (NOTAMs, filing). The
   * account is the deployment's own, and filing sends real ATC messages, so in Google mode an empty
   * list means NOBODY (never "anyone"). Default: allowedEmails. Local mode: the local pilot.
   */
  autorouterPilots?: string[];
  /**
   * Lower-cased e-mails of the admins (ADMIN_EMAILS): they see /admin (every pilot) and get an
   * e-mail for each new signup. Empty (the default) = no admin.
   */
  adminEmails?: string[];
  /** Open-Meteo through GET /weather/grid: upstream fetch (tests, local synthetic data) and the daily budget. */
  openMeteo?: WeatherGridOptions;
  /**
   * Prints the W&B and performance sheets e-mailed to an operator, as the website prints them
   * (sheetPdf.ts: headless Chromium; configFromEnv sets it up). null/undefined: the server's own PDF
   * writer (declarationPdf.ts), which is also the fallback when the print fails.
   */
  sheetPdf?: SheetPdfRenderer | null;
  /**
   * Prints the navlog e-mailed to the pilot, as the website prints it (sheetPdf.ts; configFromEnv sets
   * it up). null/undefined: the navlog cannot be e-mailed (there is no other writer for it).
   */
  navlogPdf?: NavlogPdfRenderer | null;
  /** aviationweather.gov through GET /weather/metar: upstream fetch (tests). */
  aviationWeather?: WeatherProxyOptions;
  /** The filing backends in the order they are tried (FILERS; default autorouter, then fax). */
  filers?: FilerId[];
  /** The fax service plans are faxed through (FAX_PROVIDER …, faxProviders.ts); null: no filing by fax. */
  fax?: FaxSettings | null;
  /**
   * Lower-cased e-mails of the pilots who may file by fax (FAX_PILOTS; '*' = all). Faxes cost the
   * deployment money and reach ATS in the pilot's name: as for autorouter, an empty list in Google
   * mode means nobody. Default: allowedEmails.
   */
  faxPilots?: string[];
  /** Prints a faxed flight plan (sheetPdf.ts); null/undefined: no filing by fax. */
  faxPdf?: FaxPdfRenderer | null;
  /** The origin fax delivery callbacks go to (FAX_WEBHOOK_BASE); default: the origin the pilot used. */
  faxWebhookBase?: string;
}

/**
 * A request's JSON object as the client sent it. Every handler validates or normalises the fields it
 * reads (rows.ts, the *Of normalisers), so this stays loose.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted input, checked field by field
export type JsonBody = Record<string, any>;

export interface Ctx {
  req: Req;
  db: Db;
  config: ApiConfig;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The session's pilot; always set for routes with auth !== false. */
  pilot: Pilot;
  /** Parsed JSON body ({} when empty); always a plain object (400 otherwise, 415 if not application/json). */
  body: () => Promise<JsonBody>;
  /** Extra response headers (e.g. Set-Cookie). */
  headers: Record<string, string>;
  /** The autorouter client of this API instance, or null when not configured or not for this pilot. */
  autorouter: AutorouterClient | null;
  /** True when autorouter is configured but this pilot is not on the autorouter allow-list. */
  autorouterDenied: boolean;
  /** The filing backends for this pilot, in the order they are tried (filers/select.ts). */
  filers: Filer[];
  /** The fax service (its delivery webhooks); null when not configured. */
  faxProvider: FaxProvider | null;
  /** The request body as sent (webhooks check its signature); never parsed by the platform first. */
  rawBody: () => Promise<Buffer>;
  /** True when this pilot may not send forms by e-mail (no e-mail address to cc). */
  formsMailDenied: boolean;
  isAdmin: boolean;
}

/** A handler returns the JSON body (status 200), a Reply (other status/headers), or undefined (204). */
export class Reply {
  constructor(
    public status: number,
    public body?: unknown,
    public headers?: Record<string, string>,
  ) {}
}
export type Handler = (ctx: Ctx) => Promise<unknown>;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path below /api, e.g. '/flights/:id/restore'. */
  path: string;
  /** Default true: requires a signed-in pilot. */
  auth?: boolean;
  /**
   * A service's callback (auth: false): not a browser's request, so the cross-site checks (JSON
   * only, same origin) do not apply; the handler checks the service's signature on rawBody instead.
   */
  webhook?: boolean;
  handler: Handler;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (what = 'not found') => new HttpError(404, what);
export const conflict = (msg: string, body?: unknown) => new HttpError(409, msg, body);

export const reply = (status: number, body?: unknown, headers?: Record<string, string>): Reply =>
  new Reply(status, body, headers);

export function send(res: Res, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

/** Content types accepted for request bodies: JSON only (application/json or +json, any charset). */
export function isJsonContentType(ct: string | string[] | undefined): boolean {
  const v = (Array.isArray(ct) ? ct[0] : ct || '').split(';')[0].trim().toLowerCase();
  return v === 'application/json' || /^application\/[\w.+-]+\+json$/.test(v);
}

/**
 * The request body as parsed JSON ({} when empty). A non-empty body must be sent as
 * application/json (415 otherwise): HTML forms can only post text/plain, urlencoded or multipart,
 * so this keeps cross-site form posts (login CSRF) out, without relying on CORS or SameSite.
 */
export async function readJson(req: Req): Promise<unknown> {
  let raw: unknown;
  let pre: unknown;
  try {
    pre = req.body; // Vercel: a lazy getter that throws on malformed JSON
  } catch {
    throw badRequest('invalid JSON');
  }
  if (pre !== undefined && pre !== null) {
    raw = pre;
  } else {
    let s = '';
    for await (const c of req) {
      s += c;
      if (s.length > 5e6) throw new HttpError(413, 'too large');
    }
    raw = s;
  }
  const empty = raw === '' || (Buffer.isBuffer(raw) && raw.length === 0);
  if (empty) return {};
  if (!isJsonContentType(req.headers['content-type'])) throw new HttpError(415, 'send the body as application/json');
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    } catch {
      throw badRequest('invalid JSON');
    }
  }
  return raw; // pre-parsed by the platform (Vercel parses application/json bodies)
}

/** The body's bytes as sent (at most 1 MB). */
export async function readRaw(req: Req): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    n += b.length;
    if (n > 1e6) throw new HttpError(413, 'too large');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** readJson, and the body must be a JSON object (every route takes one): null, arrays and scalars are 400. */
export async function readJsonObject(req: Req): Promise<JsonBody> {
  const v = await readJson(req);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('the request body must be a JSON object');
  return v;
}

export function compilePath(p: string): (path: string) => Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp(
    '^' +
      p
        .replace(/\/:(\w+)/g, (_, n) => {
          names.push(n);
          return '/([^/]+)';
        })
        .replace(/\/$/, '') +
      '/?$',
  );
  return (path) => {
    const m = re.exec(path);
    if (!m) return null;
    const out: Record<string, string> = {};
    names.forEach((n, i) => {
      try {
        out[n] = decodeURIComponent(m[i + 1]);
      } catch {
        throw badRequest('malformed path');
      }
    });
    return out;
  };
}

/** New random id for database rows, e.g. newId('ps') → 'ps_Xk3…'. */
export async function newId(prefix: string, bytes = 9): Promise<string> {
  const { randomBytes } = await import('node:crypto');
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}
