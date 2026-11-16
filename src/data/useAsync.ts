// Small data-loading hook: const { data, error, loading, reload, setData } = useAsync(() => api.flights.list(), []);
//
// Only the newest request's answer is kept (a slow answer for old deps never overwrites a newer
// one). Options:
//   refetchOnFocus: refetch when the window regains focus or the tab becomes visible;
//   invalidatedBy:  refetch when these entities change (src/data/entityStore.ts), here or in another tab.
// Those refetches run in the background: `loading` stays false and the current data stays shown;
// a failed background refetch keeps the data and is not reported.
// For the pilot's passengers, aircraft, waypoints and profile, prefer useEntity (src/data/entities.ts).
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';

import { type EntityKey, onInvalidate, onRevalidate } from './entityStore';

export interface UseAsyncOptions {
  refetchOnFocus?: boolean;
  invalidatedBy?: EntityKey | EntityKey[];
}

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, opts: UseAsyncOptions = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const hasData = useRef(false);
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
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current && !quiet) setError(e as Error);
    } finally {
      if (n === seq.current && !quiet) setLoading(false);
    }
  }, []);
  const reload = useCallback(() => load(false), [load]);
  // new deps: a foreground load (its answer replaces whatever the old deps loaded)
  useEffect(() => {
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
