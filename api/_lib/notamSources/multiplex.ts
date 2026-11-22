// Querying several NOTAM sources for one briefing: all at once, each with its own time limit, so one
// failing or slow source costs the briefing that source's NOTAMs only. What they return is merged
// (merge.ts) and each source's outcome is reported with the briefing.
import type { NotamSourceStatus } from '../../../src/shared/briefing.js';
import { type MergedNotam, mergeNotams } from './merge.js';
import { notamKey, type NotamQuery, type NotamSourceDriver, NotamSourceError, type RawNotam } from './types.js';

export const DEFAULT_SOURCE_TIMEOUT_MS = 25_000;

class Timeout extends Error {}

export interface Gathered {
  notams: MergedNotam[];
  statuses: NotamSourceStatus[];
}

async function one(d: NotamSourceDriver, q: Omit<NotamQuery, 'signal'>): Promise<RawNotam[]> {
  const ctl = new AbortController();
  const ms = d.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new Timeout(`no answer in ${Math.ceil(ms / 1000)} s`));
    }, ms);
  });
  try {
    return await Promise.race([d.fetch({ ...q, signal: ctl.signal }), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How current a source's answer is: its latest issue time, and its highest NOTAM number (year, then
 * number) of the busiest series among the NOTAMs of the queried FIRs, so that a source lagging behind
 * the others shows.
 */
export function freshness(
  notams: RawNotam[],
  locations: string[],
): { newestIssued: number | null; newestNotam: string | null } {
  const issued = notams.map((n) => n.issued).filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  const own = notams.filter(
    (n) => n.fir && locations.includes(n.fir) && n.series && n.number !== null && n.year !== null,
  );
  const per = new Map<string, number>();
  for (const n of own) per.set(n.series!, (per.get(n.series!) ?? 0) + 1);
  const series = [...per].sort((a, b) => b[1] - a[1])[0]?.[0];
  let best: RawNotam | null = null;
  for (const n of own)
    if (n.series === series && (!best || n.year! * 1e6 + n.number! > best.year! * 1e6 + best.number!)) best = n;
  return {
    newestIssued: issued.length ? Math.max(...issued) : null,
    newestNotam: best ? notamKey({ series: best.series!, number: best.number!, year: best.year! }) : null,
  };
}

/** Queries `sources` (in priority order) together and merges what they return. */
export async function gatherNotams(sources: NotamSourceDriver[], q: Omit<NotamQuery, 'signal'>): Promise<Gathered> {
  const results = await Promise.allSettled(sources.map((d) => one(d, q)));
  const statuses: NotamSourceStatus[] = [];
  const all: RawNotam[] = [];
  results.forEach((r, i) => {
    const d = sources[i];
    if (r.status === 'fulfilled') {
      // a source's NOTAMs are labelled as its own, whatever it wrote
      all.push(...r.value.map((n) => ({ ...n, source: d.id })));
      statuses.push({
        id: d.id,
        label: d.label,
        status: 'ok',
        count: r.value.length,
        message: null,
        ...freshness(r.value, q.locations),
      });
      return;
    }
    const e = r.reason;
    if (!(e instanceof NotamSourceError) && !(e instanceof Timeout))
      console.warn(`notams (${d.id}):`, String((e as Error)?.message || e));
    statuses.push({
      id: d.id,
      label: d.label,
      status: e instanceof Timeout ? 'timeout' : 'error',
      count: 0,
      message: e instanceof NotamSourceError || e instanceof Timeout ? e.message : 'the NOTAM source failed',
    });
  });
  return {
    notams: mergeNotams(
      all,
      sources.map((d) => d.id),
    ),
    statuses,
  };
}
