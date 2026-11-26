// The FAA NOTAM Management Service API (NMS-API) as a NOTAM source, shown to pilots as the
// "International NOTAM feed": its terms allow redistribution but not characterizing the data as FAA
// data, so the label, messages and pages never name the provider.
//   POST {NMS_BASE}/v1/auth/token   grant_type=client_credentials, HTTP Basic client id:secret
//        → { access_token, expires_in: "1799" (s) }
//   GET  {NMS_BASE}/nmsapi/v1/notams?location=LGAV   (one location a request)
//        Authorization: Bearer <token>, nmsResponseFormat: GEOJSON
//        → { status, data: { geojson: Feature[] } }; a location with nothing: { status, data: {} }
// Each Feature's properties.coreNOTAMData has notam (series, number 'A3399/26', type, issued,
// affectedFir, selectionCode = Q code, traffic, purpose, scope, minimumFl, maximumFl, icaoLocation,
// effectiveStart, effectiveEnd ('PERM'), estimated, schedule, text = item E, lowerLimit, upperLimit,
// coordinates, radius) and notamTranslation[type ICAO].formattedText, the full ICAO text: read first
// (icao.ts), the record's fields filling what it does not state. The location filter returns the
// NOTAMs active now and later; the window is applied here. The rate limit is undocumented but real: a burst
// of one-location requests gets HTTP 429 (26 Nov 2026, a briefing left with autorouter's NOTAMs only), so
// at most NMS_CONCURRENCY locations are asked at a time and a 429 is waited out (Retry-After, else backing
// off) instead of failing the whole source. The source is cached too (cache.ts).
// Hosts: pre-production https://api-staging.cgifederal-aim.com, production https://api-nms.aim.faa.gov.
import { setTimeout as wait } from 'node:timers/promises';

import { parseIcaoNotam } from './icao.js';
import {
  blankNotam,
  type NotamQuery,
  type NotamSourceDriver,
  NotamSourceError,
  parseNotamId,
  type RawNotam,
} from './types.js';

export const NMS_LABEL = 'International NOTAM feed';
/** Locations asked at once. */
export const NMS_CONCURRENCY = 2;
/** 429s waited out per location before the source fails; the waits stay well inside the source's 25 s limit. */
export const NMS_RATE_RETRIES = 4;
const RATE_WAIT_MAX_MS = 4_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** A token this close to expiring is renewed first. */
const TOKEN_MARGIN_MS = 60e3;

export interface NmsSettings {
  /** e.g. https://api-staging.cgifederal-aim.com (no /nmsapi). */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Injectable for tests (nothing is ever sent to the service in tests). */
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => wait(ms, undefined, { signal });

/** How long to wait after a 429: the Retry-After seconds when given, else 0.5 s, 1 s, 2 s, 4 s. */
export function rateWaitMs(retryAfter: string | null, attempt: number): number {
  const s = Number(retryAfter);
  const ms = retryAfter !== null && Number.isFinite(s) && s >= 0 ? s * 1000 : 500 * 2 ** attempt;
  return Math.min(RATE_WAIT_MAX_MS, ms);
}

/** Settings from the environment, or null without NMS_BASE, NMS_CLIENT_ID and NMS_CLIENT_SECRET. */
export function nmsFromEnv(env: NodeJS.ProcessEnv = process.env): NmsSettings | null {
  const baseUrl = (env.NMS_BASE || '').trim().replace(/\/+$/, '');
  const clientId = (env.NMS_CLIENT_ID || '').trim();
  const clientSecret = (env.NMS_CLIENT_SECRET || '').trim();
  return baseUrl && clientId && clientSecret ? { baseUrl, clientId, clientSecret } : null;
}

/** One NOTAM record (the fields the app reads; all strings as the API writes them). */
export interface NmsNotam {
  id?: string;
  series?: string;
  number?: string;
  year?: string;
  type?: string;
  issued?: string;
  affectedFir?: string;
  selectionCode?: string;
  traffic?: string;
  purpose?: string;
  scope?: string;
  minimumFl?: string;
  maximumFl?: string;
  location?: string;
  icaoLocation?: string;
  effectiveStart?: string;
  effectiveEnd?: string;
  estimated?: string | boolean;
  schedule?: string;
  text?: string;
  lowerLimit?: string;
  upperLimit?: string;
  coordinates?: string;
  radius?: string;
}

export interface NmsFeature {
  type?: string;
  properties?: {
    coreNOTAMData?: {
      notam?: NmsNotam;
      notamTranslation?: { type?: string; formattedText?: string; simpleText?: string }[];
    };
  };
  geometry?: { type?: string; geometries?: { type?: string; coordinates?: unknown }[]; coordinates?: unknown };
}

const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

function isoMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : null;
}

const fl = (v: unknown) => (/^\d{1,3}$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : null);

/** '3756N02357E' → degrees. */
function coords(s: string | null): { lat: number; lon: number } | null {
  const m = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/.exec(s ?? '');
  if (!m) return null;
  const lat = (+m[1] + +m[2] / 60) * (m[3] === 'S' ? -1 : 1);
  const lon = (+m[4] + +m[5] / 60) * (m[6] === 'W' ? -1 : 1);
  return { lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
}

/** The first Point of the geometry ([lon, lat]). */
function point(g: NmsFeature['geometry']): { lat: number; lon: number } | null {
  const pts = [g, ...(g?.geometries ?? [])].filter((x) => x?.type === 'Point');
  const c = pts[0]?.coordinates;
  if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return { lat: +Number(c[1]).toFixed(5), lon: +Number(c[0]).toFixed(5) };
}

/** A GeoJSON feature → RawNotam (null when it carries no NOTAM); `location`: the one it was asked for. */
export function fromNms(f: NmsFeature, location: string | null = null): RawNotam | null {
  const core = f?.properties?.coreNOTAMData;
  const n = core?.notam;
  if (!n || typeof n !== 'object') return null;
  const formatted = core?.notamTranslation?.find((t) => t?.type === 'ICAO')?.formattedText;
  // a NOTAMC's text is sometimes the whole ICAO message
  const text = str(formatted) ?? (/^\s*[A-Z]\s?\d{1,5}\/\d{2}\s+NOTAM[NRC]/.test(n.text ?? '') ? str(n.text) : null);
  const p = parseIcaoNotam(text);
  const id = parseNotamId(n.number) ?? parseNotamId(`${n.series ?? ''}${n.number ?? ''}`);
  const type = p.type ?? ((['N', 'R', 'C'].includes(String(n.type)) ? n.type : 'N') as RawNotam['type']);
  const q = /^Q([A-Z]{2})([A-Z]{2})$/.exec(String(n.selectionCode ?? '').trim());
  const loc = String(n.icaoLocation || n.location || '')
    .toUpperCase()
    .trim();
  const end = str(n.effectiveEnd);
  const radius = Number(str(n.radius));
  const center = p.center ?? coords(str(n.coordinates)) ?? point(f.geometry);
  return {
    ...blankNotam('nms'),
    ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
    sourceId: str(n.id),
    series: p.series ?? id?.series ?? null,
    number: p.number ?? id?.number ?? null,
    year: p.year ?? id?.year ?? null,
    type,
    refers: type === 'N' ? null : (p.refers ?? null),
    fir: p.fir ?? str(n.affectedFir)?.toUpperCase() ?? null,
    code23: p.code23 ?? q?.[1] ?? null,
    code45: p.code45 ?? q?.[2] ?? null,
    traffic: p.traffic?.trim() || str(n.traffic),
    purpose: p.purpose?.trim() || str(n.purpose),
    scope: p.scope?.trim() || str(n.scope),
    lowerFl: p.lowerFl ?? fl(n.minimumFl),
    upperFl: p.upperFl ?? fl(n.maximumFl),
    center,
    radiusNm: p.radiusNm ?? (center && Number.isFinite(radius) && str(n.radius) ? radius : null),
    itemA: p.itemA?.length ? p.itemA : /^[A-Z]{4}$/.test(loc) ? [loc] : [],
    from: p.from ?? isoMs(n.effectiveStart),
    to: p.to !== undefined ? p.to : !end || /^PERM/i.test(end) ? null : isoMs(end),
    estimated: p.estimated ?? /^true$/i.test(String(n.estimated ?? '')),
    itemD: p.itemD ?? str(n.schedule),
    itemE: p.itemE ?? (text ? null : str(n.text)),
    itemF: p.itemF ?? str(n.lowerLimit),
    itemG: p.itemG ?? str(n.upperLimit),
    raw: text,
    location: location ?? (/^[A-Z]{4}$/.test(loc) ? loc : null),
    issued: isoMs(n.issued),
  };
}

/** One client per settings object, so its token serves every request on this server instance. */
const clients = new WeakMap<NmsSettings, NmsClient>();

export class NmsClient {
  private token: { value: string; expires: number } | null = null;
  private tokenP: Promise<string> | null = null;
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly s: NmsSettings) {
    this.base = s.baseUrl.replace(/\/+$/, '');
    this.doFetch = s.fetch || fetch;
    this.now = s.now || Date.now;
  }

  /** The client of these settings (one per settings object, so its token outlives a request). */
  static for(s: NmsSettings): NmsClient {
    let c = clients.get(s);
    if (!c) clients.set(s, (c = new NmsClient(s)));
    return c;
  }

  private async newToken(): Promise<string> {
    const res = await this.doFetch(`${this.base}/v1/auth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.s.clientId}:${this.s.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: string | number } | null;
    if (!res.ok || !body?.access_token)
      throw new NotamSourceError(
        res.status === 401 || res.status === 403
          ? `${NMS_LABEL}: sign-in refused`
          : `${NMS_LABEL}: sign-in failed (HTTP ${res.status})`,
      );
    const secs = Number(body.expires_in);
    this.token = {
      value: body.access_token,
      expires: this.now() + (Number.isFinite(secs) && secs > 0 ? secs : 1799) * 1000,
    };
    return this.token.value;
  }

  /** A valid token: the one held while it has a minute left, else a new one (one request at a time). */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expires - TOKEN_MARGIN_MS > this.now()) return this.token.value;
    this.tokenP ||= this.newToken().finally(() => (this.tokenP = null));
    return this.tokenP;
  }

  /** The features of one location; a 401 renews the token once; a 429 is waited out NMS_RATE_RETRIES times. */
  async location(loc: string, signal?: AbortSignal): Promise<NmsFeature[]> {
    let renewed = false;
    for (let limited = 0; ;) {
      const token = await this.accessToken();
      const res = await this.doFetch(`${this.base}/nmsapi/v1/notams?location=${encodeURIComponent(loc)}`, {
        headers: { Authorization: `Bearer ${token}`, nmsResponseFormat: 'GEOJSON', Accept: 'application/json' },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 401 && !renewed) {
        renewed = true;
        if (this.token?.value === token) this.token = null;
        continue;
      }
      if (res.status === 429 && limited < NMS_RATE_RETRIES) {
        await (this.s.sleep ?? sleep)(rateWaitMs(res.headers.get('retry-after'), limited++), signal);
        continue;
      }
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        message?: string;
        data?: { geojson?: unknown };
      } | null;
      if (!res.ok)
        throw new NotamSourceError(
          `${NMS_LABEL} answered HTTP ${res.status}${typeof body?.message === 'string' && body.message ? `: ${body.message}` : ''}`,
        );
      const g = body?.data?.geojson;
      return Array.isArray(g) ? (g as NmsFeature[]) : [];
    }
  }

  /** NOTAMs of these locations valid at some time in the window, NMS_CONCURRENCY locations at a time. */
  async notams(locations: string[], from: number, to: number, signal?: AbortSignal): Promise<RawNotam[]> {
    const locs = [...new Set(locations.map((l) => l.toUpperCase()))];
    const out: RawNotam[][] = locs.map(() => []);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < locs.length; i = next++)
        out[i] = (await this.location(locs[i], signal))
          .map((f) => fromNms(f, locs[i]))
          .filter((n): n is RawNotam => !!n);
    };
    await Promise.all(Array.from({ length: Math.min(NMS_CONCURRENCY, locs.length) }, worker));
    return out.flat().filter((n) => (n.from === null || n.from <= to) && (n.to === null || n.to >= from));
  }
}

export function nmsNotamSource(s: NmsSettings): NotamSourceDriver {
  const client = NmsClient.for(s);
  return {
    id: 'nms',
    label: NMS_LABEL,
    timeoutMs: 25_000,
    // free, but asked politely: once per location and day every 15 minutes
    cacheTtlMs: 15 * 60e3,
    // its terms allow redistribution to every pilot
    availableFor: () => true,
    fetch: ({ locations, window, signal }: NotamQuery) => client.notams(locations, window.from, window.to, signal),
  };
}
