// Rate limits: DB-backed token buckets (rate_limits, migration 032), so they hold across serverless
// instances. A bucket allows `burst` requests at once and refills `burst` per `windowMs`; beyond it
// the request is refused with 429 and a Retry-After. Keyed by the pilot when signed in, else by the
// client's IP address (the first X-Forwarded-For entry on Vercel, else the socket's address).
import type { Queryable } from './db.js';
import type { Req } from './http.js';
import { HttpError } from './http.js';

export interface Rate { burst: number; windowMs: number }

const MIN = 60e3;
const HOUR = 3600e3;
export const RATES = {
  /** POST /login, per IP */
  login: { burst: 60, windowMs: 10 * MIN },
  /** GET /weather/metar, per pilot */
  metar: { burst: 120, windowMs: 10 * MIN },
  /** GET /flights/:id/notams (autorouter), per pilot */
  notams: { burst: 30, windowMs: 10 * MIN },
  /** GET /ref/bundle (and /ref/:kind), per pilot or IP */
  ref: { burst: 60, windowMs: HOUR },
  /** POST /aircraft/:id/shares and /operators/:id/shares, per pilot */
  share: { burst: 30, windowMs: 24 * HOUR },
} satisfies Record<string, Rate>;

export function clientIp(req: Req): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || String((req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress || 'unknown');
}

/** Takes one token from the bucket of (name, subject); 429 when it is empty. */
export async function rateLimit(db: Queryable, name: keyof typeof RATES, who: { pilotId?: string | null; req?: Req }, rate: Rate = RATES[name]): Promise<void> {
  const pilotId = who.pilotId || null;
  const subject = pilotId ? `p:${pilotId}` : `ip:${who.req ? clientIp(who.req) : 'unknown'}`;
  const now = Date.now();
  const perMs = rate.burst / rate.windowMs;
  const [r] = await db.query(
    `INSERT INTO rate_limits (bucket, subject, pilot_id, tokens, updated, ok) VALUES ($1, $2, $3, $4::float8 - 1, $5, TRUE)
     ON CONFLICT (bucket, subject) DO UPDATE SET
       tokens = CASE WHEN LEAST($4::float8, rate_limits.tokens + ($5 - rate_limits.updated) * $6::float8) >= 1
                     THEN LEAST($4::float8, rate_limits.tokens + ($5 - rate_limits.updated) * $6::float8) - 1
                     ELSE LEAST($4::float8, rate_limits.tokens + ($5 - rate_limits.updated) * $6::float8) END,
       ok = LEAST($4::float8, rate_limits.tokens + ($5 - rate_limits.updated) * $6::float8) >= 1,
       updated = $5
     RETURNING tokens, ok`,
    [name, subject, pilotId, rate.burst, now, perMs]);
  // now and then, forget buckets idle for a day (full again by then)
  if (Math.random() < 0.01) await db.query('DELETE FROM rate_limits WHERE updated < $1', [now - 24 * HOUR - rate.windowMs]);
  if (!r.ok) {
    const retryAfter = Math.max(1, Math.ceil((1 - Number(r.tokens)) / perMs / 1000));
    const error = `Too many requests: try again in ${retryAfter < 120 ? `${retryAfter} seconds` : `${Math.ceil(retryAfter / 60)} minutes`}.`;
    throw new HttpError(429, error, { error, retryAfter });
  }
}
