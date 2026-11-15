// Small data-loading hook: const { data, error, loading, reload, setData } = useAsync(() => api.passengers.list(), []);
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  // reload() always fetches with the CURRENT fn: a reload captured before the deps changed (e.g. the
  // lobby switching to the trash view while a trash request is in flight) must not load stale data.
  const runRef = useRef(run);
  runRef.current = run;
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const v = await runRef.current();
      if (n === seq.current) { setData(v); setError(null); }
    } catch (e) {
      if (n === seq.current) setError(e as Error);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}
