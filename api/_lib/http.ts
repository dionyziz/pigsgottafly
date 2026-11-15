// HTTP plumbing shared by the route modules: the route type, errors, JSON helpers.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from './db.js';
import type { Pilot } from '../../src/shared/types.js';
import type { AutorouterClient, AutorouterSettings } from './autorouter.js';

/** Node request, possibly with a body pre-parsed by Vercel. */
export type Req = IncomingMessage & { body?: unknown };
export type Res = ServerResponse;

export interface ApiConfig {
  /** Google OAuth client id; '' = local mode (no sign-in, one 'local' pilot). */
  googleClientId: string;
  /** Lower-cased; empty = anyone with a Google account. */
  allowedEmails: string[];
  /** Fetches Google's signing keys (JWKs); injectable for tests. */
  googleKeys: () => Promise<JsonWebKey[]>;
  secureCookie: boolean;
  /** autorouter account (NOTAMs, filing); null/undefined = not configured. Tests inject a mocked fetch. */
  autorouter?: AutorouterSettings | null;
  /**
   * Lower-cased e-mails of the pilots who may use the autorouter account (NOTAMs, filing). The
   * account is the deployment's own, and filing sends real ATC messages, so in Google mode an empty
   * list means NOBODY (never "anyone"). Default: allowedEmails. Local mode: the local pilot.
   */
  autorouterPilots?: string[];
}

export interface Ctx {
  req: Req;
  db: Db;
  config: ApiConfig;
  /** Path parameters (':id' → params.id). */
  params: Record<string, string>;
  query: URLSearchParams;
  /** The session's pilot; always set for routes with auth !== false. */
  pilot: Pilot;
  /** Parsed JSON body ({} when empty); always a plain object (400 otherwise, 415 if not application/json). */
  body(): Promise<any>;
  /** Extra response headers (e.g. Set-Cookie). */
  headers: Record<string, string>;
  /** The autorouter client of this API instance, or null when not configured or not for this pilot. */
  autorouter: AutorouterClient | null;
  /** True when autorouter is configured but this pilot is not on the autorouter allow-list. */
  autorouterDenied: boolean;
}

/** A handler returns the JSON body (status 200), a Reply (other status/headers), or undefined (204). */
export class Reply {
  constructor(public status: number, public body?: unknown, public headers?: Record<string, string>) {}
}
export type Handler = (ctx: Ctx) => Promise<unknown | Reply | undefined>;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path below /api, e.g. '/flights/:id/restore'. */
  path: string;
  /** Default true: requires a signed-in pilot. */
  auth?: boolean;
  handler: Handler;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (what = 'not found') => new HttpError(404, what);
export const conflict = (msg: string, body?: unknown) => new HttpError(409, msg, body);

export const reply = (status: number, body?: unknown, headers?: Record<string, string>): Reply => new Reply(status, body, headers);

export function send(res: Res, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
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
export async function readJson(req: Req): Promise<any> {
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

/** readJson, and the body must be a JSON object (every route takes one): null, arrays and scalars are 400. */
export async function readJsonObject(req: Req): Promise<Record<string, any>> {
  const v = await readJson(req);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('the request body must be a JSON object');
  return v;
}

/** Compiles '/flights/:id/restore' to a matcher. */
export function compilePath(p: string): (path: string) => Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp(
    '^' + p.replace(/\/:(\w+)/g, (_, n) => { names.push(n); return '/([^/]+)'; }).replace(/\/$/, '') + '/?$',
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
