// Small data-loading hook: const { data, error, loading, reload, setData } = useAsync(() => api.flights.list(), []);
//
// Only the newest request's answer is kept (a slow answer for old deps never overwrites a newer
// one). Options:
//   refetchOnFocus: refetch when the window regains focus or the tab becomes visible;
//   invalidatedBy:  refetch when these entities change (src/data/entityStore.ts), here or in another tab;
//   cache:          a key naming what is loaded ('flight:fl_1'): the answer is kept for the session, so
//                   coming back shows it at once (no loading state) while it is fetched again quietly.
// Those refetches run in the background: `loading` stays false and the current data stays shown;
// a failed background refetch keeps the data and is not reported.
// For the pilot's passengers, aircraft, waypoints and profile, prefer useEntity (src/data/entities.ts).
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';

import { type EntityKey, onInvalidate, onRevalidate } from './entityStore';

export interface UseAsyncOptions {
  refetchOnFocus?: boolean;
  invalidatedBy?: EntityKey | EntityKey[];
  cache?: string;
}

/** The last answer per cache key, for the session (most recent last; the oldest go beyond CACHE_MAX). */
const CACHE = new Map<string, unknown>();
const CACHE_MAX = 200;
function remember(key: string, v: unknown) {
  CACHE.delete(key);
  CACHE.set(key, v);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
}
/** Forgets every cached answer (sign-out: the next pilot must not see them). */
export function clearAsyncCache(): void {
  CACHE.clear();
}

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, opts: UseAsyncOptions = {}) {
  const key = opts.cache;
  const [data, setState] = useState<T | undefined>(() => (key ? (CACHE.get(key) as T | undefined) : undefined));
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(() => !(key && CACHE.has(key)));
  const keyRef = useRef(key);
  keyRef.current = key;
  /** Sets the data (and the cache: an edit shown here is what coming back shows). */
  const setData = useCallback((v: T | undefined | ((old: T | undefined) => T | undefined)) => {
    setState((old) => {
      const next = typeof v === 'function' ? (v as (o: T | undefined) => T | undefined)(old) : v;
      if (keyRef.current && next !== undefined) remember(keyRef.current, next);
      return next;
    });
  }, []);
  const seq = useRef(0);
  const hasData = useRef(false);
  // the callers' deps are checked where they call useAsync (exhaustive-deps additionalHooks)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  // reload() always fetches with the CURRENT fn: a reload captured before the deps changed (e.g. the
  // lobby switching to the trash view while a trash request is in flight) must not load stale data.
  const runRef = useRef(run);
  runRef.current = run;
  const load = useCallback(async (background: boolean) => {
    const n = ++seq.current;
    const quiet = background && hasData.current;
    if (!quiet) setLoading(true);
    try {
      const v = await runRef.current();
      if (n === seq.current) {
        hasData.current = true;
        if (keyRef.current) remember(keyRef.current, v);
        setState(v);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current && !quiet) setError(e as Error);
    } finally {
      if (n === seq.current && !quiet) setLoading(false);
    }
  }, []);
  const reload = useCallback(() => load(false), [load]);
  // new deps: a foreground load (its answer replaces whatever the old deps loaded), or, with a cached
  // answer for them, that answer at once and a quiet refetch
  useEffect(() => {
    const k = keyRef.current;
    if (k && CACHE.has(k)) {
      hasData.current = true;
      setState(CACHE.get(k) as T);
      setError(null);
      setLoading(false);
      void load(true);
      return;
    }
    hasData.current = false;
    void load(false);
  }, [run, load]);
  // unmounted: drop whatever is still in flight
  useEffect(
    () => () => {
      seq.current++;
    },
    [],
  );

  const keys = opts.invalidatedBy === undefined ? '' : ([] as EntityKey[]).concat(opts.invalidatedBy).join(',');
  useEffect(() => {
    if (!keys) return;
    return onInvalidate(keys.split(',') as EntityKey[], () => {
      void load(true);
    });
  }, [keys, load]);
  const onFocus = !!opts.refetchOnFocus;
  useEffect(() => {
    if (!onFocus) return;
    return onRevalidate(() => {
      void load(true);
    });
  }, [onFocus, load]);

  return { data, error, loading, reload, setData };
}
