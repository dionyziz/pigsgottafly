// Notamify (Skymerse) as a NOTAM source: https://skymerse.gitbook.io/notamify-api (API v2).
//   GET https://api.notamify.com/api/v2/notams/raw
//       ?location=LGAV&location=LGGG…   (at most 5 per request; aerodromes and FIRs)
//       &starts_at=…Z&ends_at=…Z        (validity overlap; starts_at no earlier than 1 day ago)
//       &page=1&per_page=30             (30 at most)
//   Authorization: Bearer <NOTAMIFY_API_KEY>
//   → { notams: [{ id, notam_number, notam_type, referenced_notam_number, location, icao_code, qcode,
//                  starts_at, ends_at, is_estimated, is_permanent, message, icao_message, … }],
//       total_count, page, per_page }
// The raw endpoint is the active one without Notamify's AI interpretation, which the app does not use;
// both cost 1 credit per page. The rate limit is 20 requests a minute. The fields come from the ICAO
// text (icao_message, parsed here) where it is given, else from the record's own fields.
// The key is the app's (Notamify Pro + an API credit package), so the source serves every pilot.
import { parseIcaoNotam } from './icao.js';
import {
  blankNotam,
  type NotamQuery,
  type NotamSourceDriver,
  NotamSourceError,
  parseNotamId,
  type RawNotam,
} from './types.js';

export const NOTAMIFY_BASE = 'https://api.notamify.com/api/v2';
/** Locations per request (the API's limit). */
export const NOTAMIFY_MAX_LOCATIONS = 5;
/** NOTAMs per page (the API's limit); each page costs a credit. */
const PER_PAGE = 30;
const REQUEST_TIMEOUT_MS = 15_000;
/** The API refuses a start earlier than one day ago. */
const MAX_PAST_MS = 23 * 3600e3;
/** A 429 asking to wait longer than this fails the request instead. */
const MAX_RETRY_WAIT_MS = 5_000;

export interface NotamifySettings {
  apiKey: string;
  /** Credits one briefing may spend at most (pages over all its location batches). */
  maxCredits: number;
  baseUrl?: string;
  /** Injectable for tests (nothing is ever sent to Notamify in tests). */
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Settings from the environment, or null without NOTAMIFY_API_KEY. Never logs the key. */
export function notamifyFromEnv(env: NodeJS.ProcessEnv = process.env): NotamifySettings | null {
  const apiKey = (env.NOTAMIFY_API_KEY || '').trim();
  if (!apiKey) return null;
  const max = Number(env.NOTAMIFY_MAX_CREDITS);
  return { apiKey, maxCredits: Number.isFinite(max) && max > 0 ? Math.floor(max) : 40 };
}

/** One NOTAM as the API returns it (the fields the app reads). */
export interface NotamifyNotam {
  id?: string;
  notam_number?: string;
  notam_type?: string | null;
  referenced_notam_number?: string | null;
  location?: string;
  icao_code?: string | null;
  qcode?: string | null;
  starts_at?: string;
  ends_at?: string | null;
  is_estimated?: boolean;
  is_permanent?: boolean;
  message?: string;
  icao_message?: string | null;
}

/** ISO date-time → epoch ms; a time without a zone is UTC. */
function isoMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : null;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const TYPES: Record<string, RawNotam['type']> = {
  N: 'N',
  NEW: 'N',
  R: 'R',
  REPLACE: 'R',
  REPLACEMENT: 'R',
  C: 'C',
  CANCEL: 'C',
  CANCELLATION: 'C',
};

/** A Notamify NOTAM → RawNotam: the ICAO text's fields first, the record's own where the text is silent. */
export function fromNotamify(n: NotamifyNotam): RawNotam {
  const text = n.icao_message || (/\bQ\)/.test(n.message ?? '') ? n.message! : null);
  const p = parseIcaoNotam(text);
  const id = parseNotamId(n.notam_number);
  const type =
    p.type ??
    TYPES[
      String(n.notam_type ?? '')
        .toUpperCase()
        .replace(/^NOTAM/, '')
    ] ??
    'N';
  const q = /^Q?([A-Z]{2})([A-Z]{2})$/.exec(
    String(n.qcode ?? '')
      .toUpperCase()
      .trim(),
  );
  const loc = String(n.icao_code || n.location || '')
    .toUpperCase()
    .trim();
  const permanent = n.is_permanent === true;
  return {
    ...blankNotam('notamify'),
    ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
    sourceId: n.id ?? null,
    series: p.series ?? id?.series ?? null,
    number: p.number ?? id?.number ?? null,
    year: p.year ?? id?.year ?? null,
    type,
    refers: type === 'N' ? null : (p.refers ?? parseNotamId(n.referenced_notam_number)),
    code23: p.code23 ?? q?.[1] ?? null,
    code45: p.code45 ?? q?.[2] ?? null,
    itemA: p.itemA?.length ? p.itemA : /^[A-Z]{4}$/.test(loc) ? [loc] : [],
    from: p.from ?? isoMs(n.starts_at),
    to: p.to !== undefined ? p.to : permanent ? null : isoMs(n.ends_at),
    estimated: p.estimated ?? n.is_estimated === true,
    itemE: p.itemE ?? (text ? null : (n.message ?? '').trim() || null),
    raw: text?.trim() || null,
    location: /^[A-Z]{4}$/.test(loc) ? loc : null,
  };
}

interface Page {
  notams?: NotamifyNotam[];
  total_count?: number;
  page?: number;
  per_page?: number;
}

export class NotamifyClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Pages fetched (= credits spent) by this client. */
  credits = 0;

  constructor(private readonly s: NotamifySettings) {
    this.base = (s.baseUrl || NOTAMIFY_BASE).replace(/\/+$/, '');
    this.doFetch = s.fetch || fetch;
    this.now = s.now || Date.now;
    this.sleep = s.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async page(params: URLSearchParams, signal?: AbortSignal): Promise<Page> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.doFetch(`${this.base}/notams/raw?${params}`, {
        headers: { Authorization: `Bearer ${this.s.apiKey}`, Accept: 'application/json' },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as (Page & { message?: unknown; detail?: unknown }) | null;
      if (res.ok) {
        this.credits++;
        return body ?? {};
      }
      if (res.status === 429 && attempt === 0) {
        const wait = (Number(res.headers.get('retry-after')) || 1) * 1000;
        if (wait <= MAX_RETRY_WAIT_MS) {
          await this.sleep(wait);
          continue;
        }
      }
      const said =
        typeof body?.message === 'string' ? body.message : typeof body?.detail === 'string' ? body.detail : '';
      // never echo the key; Notamify's own message is safe to show
      throw new NotamSourceError(
        res.status === 401
          ? 'Notamify refused the API key'
          : res.status === 429
            ? 'Notamify: too many requests, try again in a minute'
            : `Notamify answered HTTP ${res.status}${said ? `: ${said}` : ''}`,
      );
    }
  }

  /** NOTAMs of these locations valid at some time in the window, every page, batched by 5 locations. */
  async notams(locations: string[], from: number, to: number, signal?: AbortSignal): Promise<RawNotam[]> {
    const start = Math.max(from, this.now() - MAX_PAST_MS);
    if (to <= start) return [];
    const out: RawNotam[] = [];
    let budget = this.s.maxCredits;
    const locs = [...new Set(locations.map((l) => l.toUpperCase()))];
    for (let i = 0; i < locs.length; i += NOTAMIFY_MAX_LOCATIONS) {
      const batch = locs.slice(i, i + NOTAMIFY_MAX_LOCATIONS);
      for (let page = 1; ; page++) {
        if (budget-- <= 0)
          throw new NotamSourceError(`Notamify: more NOTAMs than ${this.s.maxCredits} pages; not all were fetched`);
        const q = new URLSearchParams();
        for (const l of batch) q.append('location', l);
        q.set('starts_at', iso(start));
        q.set('ends_at', iso(to));
        q.set('page', String(page));
        q.set('per_page', String(PER_PAGE));
        const r = await this.page(q, signal);
        const got = Array.isArray(r.notams) ? r.notams : [];
        out.push(...got.map(fromNotamify));
        const total = Number(r.total_count) || 0;
        if (got.length < PER_PAGE || page * PER_PAGE >= total) break;
      }
    }
    return out;
  }
}

export function notamifyNotamSource(s: NotamifySettings): NotamSourceDriver {
  const client = new NotamifyClient(s);
  return {
    id: 'notamify',
    label: 'Notamify',
    timeoutMs: 25_000,
    cacheTtlMs: 15 * 60e3,
    availableFor: () => true,
    fetch: ({ locations, window, signal }: NotamQuery) => client.notams(locations, window.from, window.to, signal),
  };
}
