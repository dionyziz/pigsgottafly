// Rate limits: DB-backed token buckets (rate_limits, migration 032), so they hold across serverless
// instances. A bucket allows `burst` requests at once and refills `burst` per `windowMs`; beyond it
// the request is refused with 429 and a Retry-After. Keyed by the pilot when signed in, else by the
// client's IP address (the first X-Forwarded-For entry on Vercel, else the socket's address).
import type { Queryable } from './db.js';
import type { Req } from './http.js';
import { HttpError } from './http.js';

export interface Rate {
  burst: number;
  windowMs: number;
}

const MIN = 60e3;
const HOUR = 3600e3;
export const RATES = {
  /** POST /login and POST /login/apple, per IP */
  login: { burst: 60, windowMs: 10 * MIN },
  /** GET /weather/metar, per pilot */
  metar: { burst: 120, windowMs: 10 * MIN },
  /** GET /weather/grid, per pilot (most answers come from the browser's or the server's cache) */
  weather: { burst: 200, windowMs: 10 * MIN },
  /** Open-Meteo calls (weighted as Open-Meteo counts them) made for one pilot, per day */
  weatherFetch: { burst: 2000, windowMs: 24 * HOUR },
  /** GET /flights/:id/notams (autorouter), per pilot */
  notams: { burst: 30, windowMs: 10 * MIN },
  /** GET /ref/bundle (and /ref/:kind), per pilot or IP */
  ref: { burst: 60, windowMs: HOUR },
  /** POST /aircraft/:id/shares, /operators/:id/shares and /flights/:id/shares, per pilot */
  share: { burst: 30, windowMs: 24 * HOUR },
  /** POST /client-errors (unauthenticated error reports), per IP */
  clientErrors: { burst: 30, windowMs: 10 * MIN },
} satisfies Record<string, Rate>;

export function clientIp(req: Req): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || String((req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress || 'unknown');
}

/**
 * Takes `cost` tokens from the bucket of (name, subject); false (and nothing taken) when it holds
 * fewer. Returns the tokens left and the refill rate for the Retry-After.
 */
export async function takeTokens(
  db: Queryable,
  name: keyof typeof RATES,
  who: { pilotId?: string | null; req?: Req },
  cost = 1,
  rate: Rate = RATES[name],
): Promise<{ ok: boolean; tokens: number; perMs: number }> {
  const pilotId = who.pilotId || null;
  const subject = pilotId ? `p:${pilotId}` : `ip:${who.req ? clientIp(who.req) : 'unknown'}`;
  const now = Date.now();
  const perMs = rate.burst / rate.windowMs;
  const [r] = await db.query(
    `INSERT INTO rate_limits (bucket, subject, pilot_id, tokens, updated, ok) VALUES ($1, $2, $3, CASE WHEN $4::float8 >= $7::float8 THEN $4::float8 - $7::float8 ELSE $4::float8 END, $5, $4::float8 >= $7::float8)
     ON CONFLICT (bucket, subject) DO UPDATE SET
       tokens = CASE WHEN LEAST($4::float8, rate_limits.tokens + ($5 - rate_limits.updated) * $6::float8) >= $7::float8
                     THEN LEAST($4::float8, rate_limits.tokens + ($5 - rate_limits.updated) * $6::float8) - $7::float8
                     ELSE LEAST($4::float8, rate_limits.tokens + ($5 - rate_limits.updated) * $6::float8) END,
       ok = LEAST($4::float8, rate_limits.tokens + ($5 - rate_limits.updated) * $6::float8) >= $7::float8,
       updated = $5
     RETURNING tokens, ok`,
    [name, subject, pilotId, rate.burst, now, perMs, cost],
  );
  // now and then, forget buckets idle for a day (full again by then)
  if (Math.random() < 0.01)
    await db.query('DELETE FROM rate_limits WHERE updated < $1', [now - 24 * HOUR - rate.windowMs]);
  return { ok: !!r.ok, tokens: Number(r.tokens), perMs };
}

export async function rateLimit(
  db: Queryable,
  name: keyof typeof RATES,
  who: { pilotId?: string | null; req?: Req },
  rate: Rate = RATES[name],
): Promise<void> {
  const r = await takeTokens(db, name, who, 1, rate);
  if (!r.ok) {
    const retryAfter = Math.max(1, Math.ceil((1 - r.tokens) / r.perMs / 1000));
    const error = `Too many requests: try again in ${retryAfter < 120 ? `${retryAfter} seconds` : `${Math.ceil(retryAfter / 60)} minutes`}.`;
    throw new HttpError(429, error, { error, retryAfter });
  }
}
