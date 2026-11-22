// What a paid source returned, kept per location and UTC-day window (notam_source_cache, migration
// 057) for its cacheTtlMs, shared by every server instance: the FIR (LGGG, most of the NOTAMs and
// most of the requests) is fetched once per window for every flight. The window queried is widened to
// whole UTC days so that flights on the same days share it; the briefing filters by its own window.
// refresh=1 skips the stored rows (and stores what it fetches).
import type { Db } from '../db.js';
import type { NotamQuery, NotamSourceDriver, RawNotam } from './types.js';

const DAY = 86400e3;

/** The window widened to whole UTC days, and its key. */
export function dayBucket(w: { from: number; to: number }): { from: number; to: number; key: string } {
  const from = Math.floor(w.from / DAY) * DAY;
  const to = Math.max(from + DAY, Math.ceil(w.to / DAY) * DAY);
  const d = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from, to, key: `${d(from)}..${d(to - 1)}` };
}

export interface NotamCacheStore {
  /** Fresh rows (fetched after `since`) of these locations. */
  get: (source: string, bucket: string, locations: string[], since: number) => Promise<Map<string, RawNotam[]>>;
  put: (source: string, bucket: string, rows: Map<string, RawNotam[]>, fetched: number) => Promise<void>;
}

export function dbNotamCache(db: Db): NotamCacheStore {
  return {
    async get(source, bucket, locations, since) {
      const rows = await db.query<{ loc: string; notams: RawNotam[] }>(
        `SELECT loc, notams FROM notam_source_cache
          WHERE source = $1 AND bucket = $2 AND loc IN (SELECT jsonb_array_elements_text($3::jsonb)) AND fetched > $4`,
        [source, bucket, JSON.stringify(locations), since],
      );
      return new Map(rows.map((r) => [r.loc, Array.isArray(r.notams) ? r.notams : []]));
    },
    async put(source, bucket, rows, fetched) {
      for (const [loc, notams] of rows)
        await db.query(
          `INSERT INTO notam_source_cache (source, loc, bucket, fetched, notams) VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (source, loc, bucket) DO UPDATE SET fetched = EXCLUDED.fetched, notams = EXCLUDED.notams`,
          [source, loc, bucket, fetched, JSON.stringify(notams)],
        );
      // rows of past days are never read again
      await db.query('DELETE FROM notam_source_cache WHERE fetched < $1', [fetched - 2 * DAY]);
    },
  };
}

/**
 * The driver with its results cached per location (when it has a cacheTtlMs). A NOTAM is filed under
 * the queried locations it names (item A, FIR, or the location the source returned it for), or
 * under all of them when it names none.
 */
export function cached(
  d: NotamSourceDriver,
  store: NotamCacheStore,
  opts: { refresh?: boolean; now?: () => number } = {},
): NotamSourceDriver {
  const ttl = d.cacheTtlMs ?? 0;
  if (!ttl) return d;
  const now = opts.now ?? Date.now;
  return {
    ...d,
    async fetch(q: NotamQuery): Promise<RawNotam[]> {
      const bucket = dayBucket(q.window);
      const locations = [...new Set(q.locations)];
      const hit = opts.refresh
        ? new Map<string, RawNotam[]>()
        : await store.get(d.id, bucket.key, locations, now() - ttl).catch(() => new Map<string, RawNotam[]>());
      const missing = locations.filter((l) => !hit.has(l));
      const out = [...hit.values()].flat();
      if (!missing.length) return out;
      const got = await d.fetch({ ...q, locations: missing, window: { from: bucket.from, to: bucket.to } });
      const per = new Map<string, RawNotam[]>(missing.map((l) => [l, []]));
      for (const n of got) {
        const named = [...n.itemA, n.fir, n.location].filter((l): l is string => !!l && per.has(l));
        for (const l of named.length ? [...new Set(named)] : missing) per.get(l)!.push(n);
      }
      await store.put(d.id, bucket.key, per, now()).catch((e) => console.warn('notam cache:', String(e?.message || e)));
      return [...out, ...got];
    },
  };
}
