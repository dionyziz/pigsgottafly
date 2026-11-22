// The fax services a faxed flight plan goes out through (fax.ts), one per deployment (FAX_PROVIDER):
//
//   sinch    Sinch Fax API v3, ex-Phaxio (the default; ARCHITECTURE.md "Filing backends" has the comparison)
//            POST https://fax.api.sinch.com/v3/projects/<project>/faxes  multipart: to, file, [from, serviceId],
//                 callbackUrl, callbackUrlContentType=application/json (HTTP Basic: key id, key secret)
//                 → { id, status }
//            GET  …/faxes/<id> → { status, errorMessage, numberOfPages }
//            status: QUEUED | IN_PROGRESS | COMPLETED | FAILURE; one FAX_COMPLETED callback per fax.
//            Sinch does not sign callbacks, so each fax's callback URL carries its log id and our
//            HMAC-SHA256 of that id under FAX_WEBHOOK_SECRET (compared in constant time; wrong or no
//            secret: 404), and the reported fax must be the one that log row sent.
//   telnyx   Telnyx Programmable Fax
//            POST https://api.telnyx.com/v2/faxes   multipart: connection_id, from, to, contents (PDF)
//                                                  → 202 { data: { id, status } }
//            GET  https://api.telnyx.com/v2/faxes/<id>  → { data: { status, failure_reason, page_count } }
//            status: queued | media.processed | originated | sending | delivered | failed
//            webhooks (set on the Fax App: <origin>/api/filing/fax/webhook/telnyx): fax.queued,
//            fax.media.processed, fax.sending.started, fax.delivered, fax.failed; signed with the
//            account's Ed25519 key over "<telnyx-timestamp>|<raw body>" (header telnyx-signature-ed25519,
//            base64), refused when the timestamp is more than 5 minutes off.
//   dry-run  FAX_DRY_RUN=1: nothing is sent; the PDF is printed, logged (and written to
//            FAX_DRY_RUN_DIR when set) and reported delivered at once.
// Nothing here is ever reached from tests: fetch is injected (tests/setup/noExternalApis.ts refuses
// the real hosts).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type FaxState = 'sending' | 'delivered' | 'failed';
export type FaxProviderId = 'telnyx' | 'sinch' | 'dry-run';

export interface FaxReport {
  faxId: string;
  state: FaxState;
  /** Why it failed (the service's reason code or text). */
  error?: string;
  pages?: number | null;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  raw: Buffer;
  query: URLSearchParams;
}

export interface FaxProvider {
  id: FaxProviderId;
  /** `ref`: the fax's log id, `callbackUrl`: where the service reports (null: polled only). */
  send: (i: { to: string; pdf: Buffer; ref: string; callbackUrl: string | null }) => Promise<FaxReport>;
  get: (faxId: string) => Promise<FaxReport>;
  /**
   * The delivery report a webhook carries, once its signature checks out; null for an event that
   * reports nothing new. Throws FaxSignatureError when the request is not the service's.
   * `ref`: the log id the callback URL named (sinch), so the caller can match it.
   */
  webhook: (r: WebhookRequest) => (FaxReport & { ref?: string }) | null;
}

export class FaxProviderError extends Error {
  constructor(
    message: string,
    /** The service is down or refused for its own reasons (worth another backend). */
    public transient: boolean,
  ) {
    super(message);
  }
}
export class FaxSignatureError extends Error {}

export interface FaxSettings {
  provider: FaxProviderId;
  /** Telnyx API v2 key, or Sinch key id. */
  apiKey: string;
  /** Sinch key secret. */
  apiSecret: string;
  /** Telnyx Fax App (connection) id. */
  connectionId: string;
  /** The number the faxes come from (E.164): Telnyx's required, Sinch's optional (its default otherwise). */
  from: string;
  /** Sinch project id. */
  projectId: string;
  /** Sinch fax service id (optional: the project's default service otherwise). */
  serviceId: string;
  /** Telnyx: the account's Ed25519 public key (base64, 32 bytes). */
  webhookPublicKey: string;
  /** Sinch: the secret our callback URLs are signed with. */
  webhookSecret: string;
  dryRunDir: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

const TIMEOUT_MS = 30_000;
const SKEW_MS = 5 * 60e3;
const header = (h: WebhookRequest['headers'], name: string) => {
  const v = h[name];
  return (Array.isArray(v) ? v[0] : v || '').trim();
};

/** Settings from the environment, or null when no fax service is configured. Never logs the values. */
export function faxFromEnv(env: NodeJS.ProcessEnv = process.env): FaxSettings | null {
  const base: FaxSettings = {
    provider: 'sinch',
    apiKey: (env.FAX_API_KEY || '').trim(),
    apiSecret: (env.FAX_API_SECRET || '').trim(),
    connectionId: (env.FAX_CONNECTION_ID || '').trim(),
    from: (env.FAX_FROM || '').replace(/[\s()-]/g, ''),
    projectId: (env.FAX_PROJECT_ID || '').trim(),
    serviceId: (env.FAX_SERVICE_ID || '').trim(),
    webhookPublicKey: (env.FAX_WEBHOOK_PUBLIC_KEY || '').trim(),
    webhookSecret: env.FAX_WEBHOOK_SECRET || '',
    dryRunDir: (env.FAX_DRY_RUN_DIR || '').trim(),
  };
  if (env.FAX_DRY_RUN === '1') return { ...base, provider: 'dry-run' };
  const p = (env.FAX_PROVIDER || 'sinch').trim().toLowerCase();
  if (p === 'sinch' && base.apiKey && base.apiSecret && base.projectId) return base;
  if (p === 'telnyx' && base.apiKey && base.connectionId && base.from) return { ...base, provider: 'telnyx' };
  return null;
}

async function request(
  doFetch: typeof fetch,
  what: string,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new FaxProviderError(`${what} could not be reached: ${(e as Error)?.message ?? e}`, true);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* an error page */
  }
  if (!res.ok) {
    const errs = (body.errors as { title?: string; detail?: string }[] | undefined) ?? [];
    const msg =
      errs.map((e) => e.detail || e.title).find(Boolean) ||
      (typeof body.message === 'string' ? body.message : '') ||
      (typeof body.errorMessage === 'string' ? body.errorMessage : '') ||
      `HTTP ${res.status}`;
    // the service's own trouble, or its rate limit: another backend may do better
    throw new FaxProviderError(`${what} refused the fax: ${msg}`, res.status >= 500 || res.status === 429);
  }
  return body;
}

// ------------------------------------------------------------------------------------------ Telnyx

const TELNYX_BASE = 'https://api.telnyx.com/v2';
const telnyxState = (s: unknown): FaxState => (s === 'delivered' ? 'delivered' : s === 'failed' ? 'failed' : 'sending');
/** DER prefix of an Ed25519 SubjectPublicKeyInfo: the raw 32-byte key follows. */
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyTelnyx(r: WebhookRequest, publicKey: string, now: number): void {
  const sig = header(r.headers, 'telnyx-signature-ed25519');
  const ts = header(r.headers, 'telnyx-timestamp');
  if (!publicKey) throw new FaxSignatureError('no webhook public key configured');
  if (!sig || !/^\d{9,11}$/.test(ts)) throw new FaxSignatureError('unsigned');
  if (Math.abs(now - Number(ts) * 1000) > SKEW_MS) throw new FaxSignatureError('stale timestamp');
  const ok = (() => {
    try {
      const raw = Buffer.from(publicKey, 'base64');
      const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: 'der', type: 'spki' });
      return crypto.verify(null, Buffer.concat([Buffer.from(`${ts}|`), r.raw]), key, Buffer.from(sig, 'base64'));
    } catch {
      return false;
    }
  })();
  if (!ok) throw new FaxSignatureError('bad signature');
}

function telnyx(s: FaxSettings): FaxProvider {
  const doFetch = s.fetch || fetch;
  const now = s.now || Date.now;
  const auth = { Authorization: `Bearer ${s.apiKey}`, Accept: 'application/json' };
  const report = (d: Record<string, unknown>): FaxReport => ({
    faxId: String(d.id ?? d.fax_id ?? ''),
    state: telnyxState(d.status),
    error: typeof d.failure_reason === 'string' && d.failure_reason ? d.failure_reason : undefined,
    pages: Number.isFinite(d.page_count) ? Number(d.page_count) : null,
  });
  return {
    id: 'telnyx',
    async send({ to, pdf }) {
      const form = new FormData();
      form.set('connection_id', s.connectionId);
      form.set('from', s.from);
      form.set('to', to);
      // the form's 1 mm character boxes stay legible at the fine resolution
      form.set('quality', 'high');
      form.set('contents', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'flight-plan.pdf');
      const body = await request(doFetch, 'Telnyx', `${TELNYX_BASE}/faxes`, {
        method: 'POST',
        headers: auth,
        body: form,
      });
      const r = report((body.data ?? {}) as Record<string, unknown>);
      if (!r.faxId) throw new FaxProviderError('Telnyx gave no fax id', true);
      return r;
    },
    async get(faxId) {
      const body = await request(doFetch, 'Telnyx', `${TELNYX_BASE}/faxes/${encodeURIComponent(faxId)}`, {
        headers: auth,
      });
      return report((body.data ?? {}) as Record<string, unknown>);
    },
    webhook(r) {
      verifyTelnyx(r, s.webhookPublicKey, now());
      const ev = (
        JSON.parse(r.raw.toString('utf8')) as { data?: { event_type?: string; payload?: Record<string, unknown> } }
      ).data;
      if (!ev?.payload || !String(ev.event_type || '').startsWith('fax.')) return null;
      const p = ev.payload;
      if (p.direction && p.direction !== 'outbound') return null;
      return report({ ...p, id: p.fax_id });
    },
  };
}

// ------------------------------------------------------------------------------------------- Sinch

const sinchState = (s: unknown): FaxState => (s === 'COMPLETED' ? 'delivered' : s === 'FAILURE' ? 'failed' : 'sending');

/** The token our Sinch callback URLs carry for a fax log id. */
export const sinchToken = (secret: string, ref: string) =>
  crypto.createHmac('sha256', secret).update(`fax:${ref}`).digest('base64url');

function sinch(s: FaxSettings): FaxProvider {
  const doFetch = s.fetch || fetch;
  const base = `https://fax.api.sinch.com/v3/projects/${encodeURIComponent(s.projectId)}/faxes`;
  const auth = {
    Authorization: `Basic ${Buffer.from(`${s.apiKey}:${s.apiSecret}`).toString('base64')}`,
    Accept: 'application/json',
  };
  const report = (d: Record<string, unknown>): FaxReport => ({
    faxId: String(d.id ?? ''),
    state: sinchState(d.status),
    error: typeof d.errorMessage === 'string' && d.errorMessage ? d.errorMessage : undefined,
    pages: Number.isFinite(d.numberOfPages) ? Number(d.numberOfPages) : null,
  });
  return {
    id: 'sinch',
    async send({ to, pdf, ref, callbackUrl }) {
      const form = new FormData();
      form.set('to', to);
      form.set('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'flight-plan.pdf');
      if (s.from) form.set('from', s.from);
      if (s.serviceId) form.set('serviceId', s.serviceId);
      if (callbackUrl && s.webhookSecret) {
        const u = new URL(callbackUrl);
        u.searchParams.set('ref', ref);
        u.searchParams.set('token', sinchToken(s.webhookSecret, ref));
        form.set('callbackUrl', u.href);
        form.set('callbackUrlContentType', 'application/json');
      }
      const r = report(await request(doFetch, 'Sinch', base, { method: 'POST', headers: auth, body: form }));
      if (!r.faxId) throw new FaxProviderError('Sinch gave no fax id', true);
      return r;
    },
    async get(faxId) {
      return report(await request(doFetch, 'Sinch', `${base}/${encodeURIComponent(faxId)}`, { headers: auth }));
    },
    webhook(r) {
      const ref = r.query.get('ref') || '';
      const token = r.query.get('token') || '';
      const want = s.webhookSecret ? sinchToken(s.webhookSecret, ref) : '';
      if (
        !want ||
        !ref ||
        token.length !== want.length ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(want))
      )
        throw new FaxSignatureError('bad callback token');
      const body = JSON.parse(r.raw.toString('utf8')) as { event?: string; fax?: Record<string, unknown> };
      if (!body.fax) return null;
      return { ...report(body.fax), ref };
    },
  };
}

// ----------------------------------------------------------------------------------------- dry run

function dryRun(s: FaxSettings): FaxProvider {
  return {
    id: 'dry-run',
    async send({ to, pdf, ref }) {
      if (s.dryRunDir) {
        fs.mkdirSync(s.dryRunDir, { recursive: true });
        fs.writeFileSync(path.join(s.dryRunDir, `${ref}.pdf`), pdf);
      }
      console.info(`fax (dry run): ${pdf.length} bytes to ${to} (${ref})`);
      return { faxId: `dry-${ref}`, state: 'delivered', pages: null };
    },
    async get(faxId) {
      return { faxId, state: 'delivered' };
    },
    webhook() {
      throw new FaxSignatureError('the dry run takes no webhooks');
    },
  };
}

export function faxProvider(s: FaxSettings): FaxProvider {
  return s.provider === 'dry-run' ? dryRun(s) : s.provider === 'telnyx' ? telnyx(s) : sinch(s);
}
