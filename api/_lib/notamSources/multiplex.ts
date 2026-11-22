// Querying several NOTAM sources for one briefing: all at once, each with its own time limit, so one
// failing or slow source costs the briefing that source's NOTAMs only. What they return is merged
// (merge.ts) and each source's outcome is reported with the briefing.
import type { NotamSourceStatus } from '../../../src/shared/briefing.js';
import { type MergedNotam, mergeNotams } from './merge.js';
import { type NotamQuery, type NotamSourceDriver, NotamSourceError, type RawNotam } from './types.js';

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
      statuses.push({ id: d.id, label: d.label, status: 'ok', count: r.value.length, message: null });
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
