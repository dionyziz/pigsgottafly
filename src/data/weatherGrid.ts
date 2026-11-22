// Forecast data from GET /api/weather/grid (api/_lib/routes/weatherGrid.ts; the server holds the
// cache shared by every pilot and calls Open-Meteo). Here: an in-memory cache per location, kept for
// the model run it came from until the server says a newer run may be out (recheckMs); concurrent
// and repeated requests for a location share one answer, and only the locations not cached go to the
// server, a few requests at most per call.
import type { IsoDate, WindModel } from '../shared';
import {
  GRID_MAX_LOCATIONS,
  GRID_MAX_POINTS,
  type ModelRun,
  type OpenMeteoEndpoint,
  type OpenMeteoLocation,
  type WeatherGridKind,
  type WeatherGridResponse,
} from '../shared/weatherGrid';
import { request } from './api';

/** GET path → parsed body; rejects with the server's error. Tests inject one that calls the route. */
export type GridGet = (path: string) => Promise<unknown>;
const defaultGet: GridGet = (path) => request<WeatherGridResponse>('GET', path);

interface Answer {
  loc: OpenMeteoLocation | null;
  endpoint: OpenMeteoEndpoint;
  run: ModelRun | null;
  message?: string;
  synthetic?: boolean;
}
interface Entry {
  p: Promise<Answer>;
  until: number;
  runMs: number | null;
  endpoint: OpenMeteoEndpoint | null;
}

const cache = new Map<string, Entry>();
/** The newest run seen per model and endpoint: entries of older runs are not used. */
const latestRun = new Map<string, number>();
export const clearGridCache = () => {
  cache.clear();
  latestRun.clear();
};

export interface GridRequest {
  kind: WeatherGridKind;
  model: WindModel;
  from: IsoDate;
  to: IsoDate;
  /** Keys from nodeKey / pointKey (src/shared/weatherGrid.ts). */
  locs: string[];
  /** Ask the server again (the pilot's refresh), even for cached locations. */
  force?: boolean;
  get?: GridGet;
  now?: () => number;
}

export interface GridResult {
  locations: Map<string, OpenMeteoLocation | null>;
  endpoint: OpenMeteoEndpoint | null;
  run: ModelRun | null;
  /** Why some locations have no data (from the server). */
  message?: string;
  synthetic?: boolean;
}

/** While a request is out, its entries count as fresh for this long. */
const PENDING_MS = 60 * 1000;

/** Hourly data per location. Rejects only when every request failed (with the server's reason). */
export async function fetchGrid(req: GridRequest): Promise<GridResult> {
  const now = (req.now || Date.now)();
  const get = req.get || defaultGet;
  const base = `${req.kind}|${req.model}|${req.from}|${req.to}|`;
  const runKey = (e: OpenMeteoEndpoint) => `${req.model}|${e}`;
  const locs = [...new Set(req.locs)];
  const usable = (e: Entry | undefined): e is Entry => {
    if (!e || req.force || now >= e.until) return false;
    if (e.runMs === null || !e.endpoint) return true;
    const newest = latestRun.get(runKey(e.endpoint));
    return newest === undefined || newest <= e.runMs;
  };
  const missing = locs.filter((k) => !usable(cache.get(base + k)));
  for (const { path, locs: chunk } of gridRequests({ ...req, locs: missing })) {
    const all = get(path).then((b) => b as WeatherGridResponse);
    for (const k of chunk) {
      const p = all.then((r) => answerOf(r, k));
      const entry: Entry = { p, until: now + PENDING_MS, runMs: null, endpoint: null };
      cache.set(base + k, entry);
      p.then(
        (a) => {
          if (a.run) {
            const rk = runKey(a.endpoint);
            if ((latestRun.get(rk) ?? -Infinity) < a.run.runMs) latestRun.set(rk, a.run.runMs);
          }
          entry.runMs = a.run ? a.run.runMs : null;
          entry.endpoint = a.endpoint;
          // an answer without data is not kept (the next call asks again)
          if (!a.loc) {
            if (cache.get(base + k) === entry) cache.delete(base + k);
            return;
          }
          void all.then((r) => {
            entry.until = r.recheckMs;
          });
        },
        () => {
          if (cache.get(base + k) === entry) cache.delete(base + k);
        },
      );
    }
  }
  const settled = await Promise.allSettled(locs.map((k) => cache.get(base + k)!.p));
  return mergeGrid(locs, settled);
}

/**
 * The GET requests (paths under /api/) that fetch these locations: nodes and points together, at
 * most GRID_MAX_LOCATIONS (GRID_MAX_POINTS points) per request.
 */
export function gridRequests(
  req: Pick<GridRequest, 'kind' | 'model' | 'from' | 'to' | 'locs' | 'force'>,
): { path: string; locs: string[] }[] {
  const chunks: string[][] = [];
  let cur: string[] = [],
    points = 0;
  for (const k of [...new Set(req.locs)]) {
    const point = k.startsWith('p:');
    if (cur.length >= GRID_MAX_LOCATIONS || (point && points >= GRID_MAX_POINTS)) {
      chunks.push(cur);
      cur = [];
      points = 0;
    }
    cur.push(k);
    if (point) points++;
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((chunk) => {
    const q: [string, string][] = [
      ['kind', req.kind],
      ['model', req.model],
      ['from', req.from],
      ['to', req.to],
      ['locs', chunk.join(';')],
    ];
    if (req.force) q.push(['fresh', '1']);
    return { path: `weather/grid?${formQuery(q)}`, locs: chunk };
  });
}

/**
 * A query string exactly as URLSearchParams writes it (application/x-www-form-urlencoded), without
 * URLSearchParams: the native app's JavaScriptCore has no URL API (src/native/core/).
 */
export function formQuery(params: [string, string][]): string {
  const enc = (s: string) =>
    encodeURIComponent(s)
      .replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
      .replace(/%20/g, '+');
  return params.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}

/** One location's answer: from a server response (see answerOf), or the request's failure. */
export type GridAnswer = PromiseSettledResult<Answer>;

/** A location's answer in a server response. */
export const answerOf = (r: WeatherGridResponse, k: string): Answer => ({
  loc: r.locations?.[k] ?? null,
  endpoint: r.endpoint,
  run: r.run,
  message: r.message,
  synthetic: r.synthetic,
});

/** The result of a grid request from each location's answer. Throws when every request failed. */
export function mergeGrid(locs: string[], settled: GridAnswer[]): GridResult {
  const locations = new Map<string, OpenMeteoLocation | null>();
  let first: Answer | null = null,
    failure: unknown = null;
  const messages = new Set<string>();
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      locations.set(locs[i], s.value.loc);
      if (!first || (!first.run && s.value.run)) first = s.value;
      if (!s.value.loc && s.value.message) messages.add(s.value.message);
    } else {
      locations.set(locs[i], null);
      failure ||= s.reason;
    }
  });
  const failed = failure instanceof Error ? failure : failure ? new Error(String(failure)) : null;
  if (!first && failed) throw failed;
  const f = first as Answer | null;
  if (failed) messages.add(failed.message);
  return {
    locations,
    endpoint: f?.endpoint ?? null,
    run: f?.run ?? null,
    ...(messages.size ? { message: [...messages].join('; ') } : {}),
    ...(f?.synthetic ? { synthetic: true } : {}),
  };
}
