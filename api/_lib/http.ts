// HTTP plumbing shared by the route modules: the route type, errors, JSON helpers.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from './db.js';
import type { Pilot } from '../../src/shared/types.js';

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
  /** Parsed JSON body ({} when empty). */
  body(): Promise<any>;
  /** Extra response headers (e.g. Set-Cookie). */
  headers: Record<string, string>;
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

export async function readJson(req: Req): Promise<any> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
    return req.body;
  }
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 5e6) throw new HttpError(413, 'too large');
  }
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    throw badRequest('invalid JSON');
  }
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
    names.forEach((n, i) => { out[n] = decodeURIComponent(m[i + 1]); });
    return out;
  };
}

/** New random id for database rows, e.g. newId('ps') → 'ps_Xk3…'. */
export async function newId(prefix: string, bytes = 9): Promise<string> {
  const { randomBytes } = await import('node:crypto');
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}
