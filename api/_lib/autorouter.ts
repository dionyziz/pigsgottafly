// Server-side autorouter API client (https://www.autorouter.aero/wiki/api/). The app's own account
// (AUTOROUTER_EMAIL / AUTOROUTER_PASSWORD) authenticates with OAuth 2.0 client credentials; the
// bearer token (valid one hour) is reused until it expires or is refused, as the API asks (it caps
// the live tokens per account at 20): kept in memory and in a TokenStore shared by every server
// instance (autorouter_token, api/_lib/app.ts), so a cold start reuses the token instead of taking a new one. Used for the NOTAM briefing and for filing flight plans.
// Credentials never leave this module except in the token request to autorouter.
//
// Endpoints (wiki: authentication, notams, flightplan):
//   POST /oauth2/token                    grant_type=client_credentials, client_id=email, client_secret=password
//   GET  /notam?itemas=[…]&offset&limit&startvalidity&endvalidity
//   POST /router                          { aircraftid: 0, fpl } → route id (plain text): the plan stored as a route,
//                                         no route search (wiki: routes, "Use external route")
//   POST /flightplan/file/<route id>      { fpl, addresses, skipdefaultaddresses, briefing } → { flightid, queued } | { error }
//   GET  /flightplan/file/<id>            → { status, eobt, … }
//   POST /flightplan/file/<id>/delay      { neweobt }  → { status: 'success' } | { error }
//   POST /flightplan/file/<id>/cancel     { reason }   → { status: 'success' } | { error }
//   GET  /message?limit&timeout=0         the account's message queue (wiki: message-queue), e.g.
//                                         { id, type: 'fplan_aftn_out', message: { fplid, message, priority, recipients } }
//   POST /message/acknowledge             [ids]: removes them from the queue
// Filing goes through a route: the plan is stored as one, then filed against it with the same plan
// (the fpl given when filing is what is sent, not the route's copy with the built-in aircraft's
// details). Filing is enabled with AUTOROUTER_FILING=1.

/** A JSON body, or the text itself (the route id comes back as plain text). */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Per-item parse errors (data.error2[].text), as autorouter reports a plan it cannot read. */
function details(out: unknown): string[] {
  const list = (out as { data?: { error2?: unknown } } | null)?.data?.error2;
  return Array.isArray(list)
    ? list.map((e: { text?: unknown }) => (typeof e?.text === 'string' ? e.text : '')).filter(Boolean)
    : [];
}
const hasDetails = (out: unknown) => details(out).length > 0;

/** The error an answer carries, with its details, or ''. */
function errorText(out: unknown): string {
  const e = out && typeof out === 'object' && 'error' in out ? out.error : null;
  if (typeof e !== 'string' || !e) return '';
  const d = details(out);
  return d.length ? `${e}: ${d.join('; ')}` : e;
}

export const AUTOROUTER_BASE = 'https://api.autorouter.aero/v1.0';
const TIMEOUT_MS = 15000;
/** NOTAM rows per request (autorouter pages its results). */
const NOTAM_PAGE_ROWS = 100;

export interface AutorouterSettings {
  email: string;
  password: string;
  /** Filing enabled (AUTOROUTER_FILING=1). NOTAMs only need the credentials. */
  filing: boolean;
  /** Injectable for tests (nothing is ever sent to autorouter in tests). */
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
  /** Waits between message-queue polls (tests: instant). */
  sleep?: (ms: number) => Promise<void>;
}

export interface AutorouterToken {
  value: string;
  /** Epoch ms. */
  expires: number;
}

/** Where the token is kept for every server instance. */
export interface TokenStore {
  get: () => Promise<AutorouterToken | null>;
  set: (t: AutorouterToken) => Promise<void>;
  /** Forgets the token if it is still this one (refused by autorouter). */
  drop: (value: string) => Promise<void>;
}

/** A token this close to expiring is not used. */
const TOKEN_MARGIN_MS = 60e3;

/** An AFTN message autorouter sent for a plan (FPL, DLA, CNL), as transmitted. */
export interface AftnMessage {
  text: string;
  /** 'FF', 'DD', … */
  priority: string;
  recipients: string[];
}

/** How long to wait for a plan's AFTN messages to reach the queue (they come within a second or two). */
const AFTN_WAIT_MS = 5000;
const AFTN_POLL_MS = 1000;

export class AutorouterError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
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

export interface FiledPlan {
  providerId: string;
  queued: boolean;
}

export class AutorouterClient {
  private token: { value: string; expires: number } | null = null;
  private tokenP: Promise<string> | null = null;
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly s: AutorouterSettings,
    private readonly store: TokenStore | null = null,
  ) {
    this.base = (s.baseUrl || AUTOROUTER_BASE).replace(/\/+$/, '');
    this.doFetch = s.fetch || fetch;
    this.now = s.now || Date.now;
    this.sleep = s.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get filingEnabled(): boolean {
    return this.s.filing;
  }

  private fresh = (t: AutorouterToken | null): t is AutorouterToken => !!t && t.expires > this.now() + TOKEN_MARGIN_MS;

  private async getToken(): Promise<string> {
    if (this.fresh(this.token)) return this.token.value;
    this.tokenP ||= (async () => {
      try {
        const stored = await this.store?.get().catch(() => null);
        if (this.fresh(stored ?? null)) {
          this.token = stored!;
          return stored!.value;
        }
        const res = await this.doFetch(`${this.base}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.s.email,
            client_secret: this.s.password,
          }).toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = (await res.json().catch(() => ({}))) as {
          access_token?: string;
          expires_in?: number;
          error?: string;
          error_description?: string;
        };
        if (!res.ok || !body.access_token) {
          // never echo the credentials; autorouter's error text is safe to show
          throw new AutorouterError(
            `autorouter sign-in failed: ${body.error_description || body.error || `HTTP ${res.status}`}`,
          );
        }
        this.token = { value: body.access_token, expires: this.now() + (Number(body.expires_in) || 3600) * 1000 };
        await this.store?.set(this.token).catch(() => {});
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
        headers: {
          Authorization: `Bearer ${tok}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        this.token = null;
        await this.store?.drop(tok).catch(() => {});
        continue;
      }
      const out = parseBody(await res.text());
      const error = errorText(out);
      // A plan autorouter cannot parse comes back as a 5xx with the reasons: the pilot's to fix.
      if (!res.ok)
        throw new AutorouterError(
          `autorouter: ${error || `HTTP ${res.status}`}`,
          res.status >= 500 && !hasDetails(out) ? 502 : 400,
        );
      if (error) throw new AutorouterError(`autorouter: ${error}`, 400);
      return out as T;
    }
  }

  /** NOTAMs whose item A is one of `itemas`, valid at some time in [from, to] (ms). Pages through all results. */
  async notams(itemas: string[], from: number, to: number, maxRows = 1000): Promise<AutorouterNotamRow[]> {
    const rows: AutorouterNotamRow[] = [];
    for (let offset = 0; offset < maxRows; offset += NOTAM_PAGE_ROWS) {
      const q = new URLSearchParams({
        itemas: JSON.stringify(itemas),
        offset: String(offset),
        limit: String(NOTAM_PAGE_ROWS),
        startvalidity: String(Math.floor(from / 1000)),
        endvalidity: String(Math.ceil(to / 1000)),
      });
      const page = await this.call<{ total?: number; rows?: AutorouterNotamRow[] }>('GET', `/notam?${q}`);
      const got = Array.isArray(page?.rows) ? page.rows : [];
      rows.push(...got);
      if (got.length < NOTAM_PAGE_ROWS || rows.length >= (Number(page?.total) || 0)) break;
    }
    return rows;
  }

  async file(fpl: string, addresses: string[]): Promise<FiledPlan> {
    const routeId = await this.call<unknown>('POST', '/router', { aircraftid: 0, fpl });
    if (typeof routeId !== 'string' || !routeId.trim())
      throw new AutorouterError('autorouter: no route id in the answer');
    const path = `/flightplan/file/${encodeURIComponent(routeId.trim())}`;
    const r = await this.call<{ flightid?: number | string; queued?: boolean }>('POST', path, {
      fpl,
      addresses,
      skipdefaultaddresses: false,
      gfs: false,
      force: false,
      briefing: { requested: [] },
    });
    if (r?.flightid === undefined || r?.flightid === null)
      throw new AutorouterError('autorouter: no flight plan id in the answer');
    return { providerId: String(r.flightid), queued: !!r.queued };
  }

  async status(providerId: string): Promise<{ status: string; eobt: number | null }> {
    const r = await this.call<{ status?: string; eobt?: number }>(
      'GET',
      `/flightplan/file/${encodeURIComponent(providerId)}`,
    );
    return { status: String(r?.status || 'unknown'), eobt: Number.isFinite(r?.eobt) ? Number(r.eobt) * 1000 : null };
  }

  async delay(providerId: string, eobt: number): Promise<void> {
    await this.call('POST', `/flightplan/file/${encodeURIComponent(providerId)}/delay`, {
      neweobt: Math.floor(eobt / 1000),
    });
  }

  async cancel(providerId: string, reason: string): Promise<void> {
    await this.call('POST', `/flightplan/file/${encodeURIComponent(providerId)}/cancel`, { reason });
  }

  /**
   * The AFTN messages autorouter has just sent for a plan, from the message queue: waits up to
   * AFTN_WAIT_MS for the first, then one more poll for the rest of the batch. Everything read is
   * acknowledged (the app polls plan status itself and reads the queue for nothing else).
   */
  async aftnOut(providerId: string, waitMs = AFTN_WAIT_MS): Promise<AftnMessage[]> {
    const out: AftnMessage[] = [];
    const until = this.now() + waitMs;
    for (let settled = false; ;) {
      const rows = await this.call<unknown>('GET', '/message?limit=100&timeout=0');
      const list = (Array.isArray(rows) ? rows : []) as {
        id?: number;
        type?: string;
        message?: { fplid?: unknown; message?: unknown; priority?: unknown; recipients?: unknown };
      }[];
      const ids = list.map((m) => m.id).filter((id) => id != null);
      if (ids.length) await this.call('POST', '/message/acknowledge', ids);
      for (const m of list) {
        const b = m.message;
        if (m.type !== 'fplan_aftn_out' || String(b?.fplid) !== providerId || typeof b?.message !== 'string') continue;
        out.push({
          text: b.message,
          priority: typeof b.priority === 'string' ? b.priority : 'FF',
          recipients: Array.isArray(b.recipients) ? b.recipients.map(String) : [],
        });
      }
      if (out.length ? settled : this.now() >= until) return out;
      if (out.length) settled = true;
      await this.sleep(AFTN_POLL_MS);
    }
  }
}

/** Settings from the environment, or null without credentials. Never logs the values. */
export function autorouterFromEnv(env: NodeJS.ProcessEnv = process.env): AutorouterSettings | null {
  const email = (env.AUTOROUTER_EMAIL || '').trim();
  const password = env.AUTOROUTER_PASSWORD || '';
  if (!email || !password) return null;
  return { email, password, filing: env.AUTOROUTER_FILING === '1' };
}
