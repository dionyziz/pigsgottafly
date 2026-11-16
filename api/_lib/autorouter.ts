// Server-side autorouter API client (https://www.autorouter.aero/wiki/api/). The app's own account
// (AUTOROUTER_EMAIL / AUTOROUTER_PASSWORD) authenticates with OAuth 2.0 client credentials; the
// bearer token (valid one hour) is reused until it expires or is refused, as the API asks (it caps
// the number of live tokens per account). Used for the NOTAM briefing and for filing flight plans.
// Credentials never leave this module except in the token request to autorouter.
//
// Endpoints (wiki: authentication, notams, flightplan):
//   POST /oauth2/token                    grant_type=client_credentials, client_id=email, client_secret=password
//   GET  /notam?itemas=[…]&offset&limit&startvalidity&endvalidity
//   POST /flightplan/file                 { fpl, addresses, skipdefaultaddresses, briefing } → { flightid, queued } | { error }
//   GET  /flightplan/file/<id>            → { status, eobt, … }
//   POST /flightplan/file/<id>/delay      { neweobt }  → { status: 'success' } | { error }
//   POST /flightplan/file/<id>/cancel     { reason }   → { status: 'success' } | { error }
// The wiki documents filing against a stored route (/flightplan/file/<routeid>); filing an ad-hoc
// ICAO message without a route id is assumed to work at /flightplan/file and must be confirmed once
// API access is granted (filing is disabled until then: AUTOROUTER_FILING=1).

export const AUTOROUTER_BASE = 'https://api.autorouter.aero/v1.0';
const TIMEOUT_MS = 15000;
/** NOTAM rows per request (autorouter pages its results). */
const NOTAM_PAGE_ROWS = 100;

export interface AutorouterSettings {
  email: string;
  password: string;
  /** Filing enabled (API access granted and tested). NOTAMs only need the credentials. */
  filing: boolean;
  /** Injectable for tests (nothing is ever sent to autorouter in tests). */
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
}

export class AutorouterError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

/** One NOTAM row as returned by GET /notam (lat/lon in Garmin units: × 90 / 2^30 → degrees). */
export interface AutorouterNotamRow {
  id?: number;
  series?: string;
  number?: number;
  year?: number;
  type?: string;
  referredseries?: string | null;
  referrednumber?: number | null;
  referredyear?: number | null;
  fir?: string;
  code23?: string;
  code45?: string;
  traffic?: string;
  purpose?: string;
  scope?: string;
  lower?: number;
  upper?: number;
  lat?: number;
  lon?: number;
  radius?: number;
  itema?: string[];
  startvalidity?: number;
  endvalidity?: number | null;
  estimation?: string | null;
  itemd?: string | null;
  iteme?: string;
  itemf?: string | null;
  itemg?: string | null;
}

export interface FiledPlan { providerId: string; queued: boolean }

export class AutorouterClient {
  private token: { value: string; expires: number } | null = null;
  private tokenP: Promise<string> | null = null;
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly s: AutorouterSettings) {
    this.base = (s.baseUrl || AUTOROUTER_BASE).replace(/\/+$/, '');
    this.doFetch = s.fetch || fetch;
    this.now = s.now || Date.now;
  }

  get filingEnabled(): boolean {
    return this.s.filing;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expires > this.now() + 60e3) return this.token.value;
    this.tokenP ||= (async () => {
      try {
        const res = await this.doFetch(`${this.base}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.s.email, client_secret: this.s.password }).toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
        if (!res.ok || !body.access_token) {
          // never echo the credentials; autorouter's error text is safe to show
          throw new AutorouterError(`autorouter sign-in failed: ${body.error_description || body.error || `HTTP ${res.status}`}`);
        }
        this.token = { value: body.access_token, expires: this.now() + (Number(body.expires_in) || 3600) * 1000 };
        return this.token.value;
      } finally {
        this.tokenP = null;
      }
    })();
    return this.tokenP;
  }

  /** An authorised request; a 401/403 drops the token and retries once with a new one. */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const tok = await this.getToken();
      const res = await this.doFetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        this.token = null;
        continue;
      }
      const out = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new AutorouterError(`autorouter: ${out?.error || `HTTP ${res.status}`}`, res.status >= 500 ? 502 : 400);
      if (out && typeof out === 'object' && typeof out.error === 'string' && out.error) throw new AutorouterError(`autorouter: ${out.error}`, 400);
      return out as T;
    }
  }

  /** NOTAMs whose item A is one of `itemas`, valid at some time in [from, to] (ms). Pages through all results. */
  async notams(itemas: string[], from: number, to: number, maxRows = 1000): Promise<AutorouterNotamRow[]> {
    const rows: AutorouterNotamRow[] = [];
    for (let offset = 0; offset < maxRows; offset += NOTAM_PAGE_ROWS) {
      const q = new URLSearchParams({
        itemas: JSON.stringify(itemas), offset: String(offset), limit: String(NOTAM_PAGE_ROWS),
        startvalidity: String(Math.floor(from / 1000)), endvalidity: String(Math.ceil(to / 1000)),
      });
      const page = await this.call<{ total?: number; rows?: AutorouterNotamRow[] }>('GET', `/notam?${q}`);
      const got = Array.isArray(page?.rows) ? page.rows : [];
      rows.push(...got);
      if (got.length < NOTAM_PAGE_ROWS || rows.length >= (Number(page?.total) || 0)) break;
    }
    return rows;
  }

  async file(fpl: string, addresses: string[]): Promise<FiledPlan> {
    const r = await this.call<{ flightid?: number | string; queued?: boolean }>('POST', '/flightplan/file', {
      fpl, addresses, skipdefaultaddresses: false, gfs: false, force: false, briefing: { requested: [] },
    });
    if (r?.flightid === undefined || r?.flightid === null) throw new AutorouterError('autorouter: no flight plan id in the answer');
    return { providerId: String(r.flightid), queued: !!r.queued };
  }

  async status(providerId: string): Promise<{ status: string; eobt: number | null }> {
    const r = await this.call<{ status?: string; eobt?: number }>('GET', `/flightplan/file/${encodeURIComponent(providerId)}`);
    return { status: String(r?.status || 'unknown'), eobt: Number.isFinite(r?.eobt) ? Number(r.eobt) * 1000 : null };
  }

  async delay(providerId: string, eobt: number): Promise<void> {
    await this.call('POST', `/flightplan/file/${encodeURIComponent(providerId)}/delay`, { neweobt: Math.floor(eobt / 1000) });
  }

  async cancel(providerId: string, reason: string): Promise<void> {
    await this.call('POST', `/flightplan/file/${encodeURIComponent(providerId)}/cancel`, { reason });
  }
}

/** Settings from the environment, or null without credentials. Never logs the values. */
export function autorouterFromEnv(env: NodeJS.ProcessEnv = process.env): AutorouterSettings | null {
  const email = (env.AUTOROUTER_EMAIL || '').trim();
  const password = env.AUTOROUTER_PASSWORD || '';
  if (!email || !password) return null;
  return { email, password, filing: env.AUTOROUTER_FILING === '1' };
}
