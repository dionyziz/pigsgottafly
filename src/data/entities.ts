// The pilot's own records, cached and kept fresh across pages and tabs (src/data/entityStore.ts).
//
//   const { data, error, loading, reload } = useEntity('passengers');   // Passenger[]
//   useEntity('aircraft')    → HangarAircraft[]  (own and shared)
//   useEntity('operators')   → OperatorItem[] (own, shared, and those of the pilot's aircraft)
//   useEntity('waypoints')   → Waypoint[]
//   useEntity('pilot')       → Pilot              (the session pilot; usePilot() reads the same value)
//
// Every page that shows one of these sees the same copy. It refetches when:
//   - an api.* mutation changes it (src/data/api.ts invalidates after create/update/remove), here or
//     in another tab (BroadcastChannel 'pgf');
//   - the window regains focus or the tab becomes visible and the copy is older than 5 s;
//   - something calls invalidate(key) (e.g. after a change the API layer cannot see).
// Pages keep showing the cached copy while it refetches (no loading flash).
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { OperatorItem, Passenger, Pilot, Waypoint } from '../shared';
import type { HangarAircraft } from '../shared/sharing';
import { api } from './api';
import { type EntitySnapshot, getEntity, loadEntity, putEntity, registerFetcher, subscribeEntity } from './entityStore';

export {
  clearEntities,
  type EntityKey,
  type EntitySnapshot,
  getEntity,
  invalidate,
  loadEntity,
  onInvalidate,
  onRevalidate,
  putEntity,
  subscribeEntity,
} from './entityStore';

export interface Entities {
  pilot: Pilot;
  passengers: Passenger[];
  aircraft: HangarAircraft[];
  operators: OperatorItem[];
  waypoints: Waypoint[];
}
export type CachedEntityKey = keyof Entities;

registerFetcher('pilot', () => api.me.get());
registerFetcher('passengers', () => api.passengers.list());
registerFetcher('aircraft', () => api.aircraft.list());
registerFetcher('operators', () => api.operators.list());
registerFetcher('waypoints', () => api.waypoints.list());

export interface EntityState<T> {
  data: T | undefined;
  error: Error | null;
  /** Nothing to show yet (first load). */
  loading: boolean;
  /** A background refetch is running (data is shown meanwhile). */
  refreshing: boolean;
  /** Refetch now; resolves when done. */
  reload: () => Promise<void>;
  /** Replace the cached copy locally (e.g. an optimistic removal), for every component showing it. */
  setData: (next: T | ((prev: T | undefined) => T)) => void;
}

/** One of the pilot's record lists (or the pilot), cached, shared, and refetched when it changes. */
export function useEntity<K extends CachedEntityKey>(key: K): EntityState<Entities[K]> {
  const subscribe = useCallback((fn: () => void) => subscribeEntity(key, fn), [key]);
  const snap = useSyncExternalStore(subscribe, () => getEntity<Entities[K]>(key)) as EntitySnapshot<Entities[K]>;
  useEffect(() => {
    const s = getEntity(key);
    if (s.data === undefined || s.stale) void loadEntity(key).catch(() => {});
  }, [key]);
  const reload = useCallback(async () => {
    await loadEntity(key, { force: true }).catch(() => {});
  }, [key]);
  const setData = useCallback(
    (next: Entities[K] | ((prev: Entities[K] | undefined) => Entities[K])) => {
      const prev = getEntity<Entities[K]>(key).data;
      putEntity(key, typeof next === 'function' ? next(prev) : next);
    },
    [key],
  );
  return {
    data: snap.data,
    error: snap.data === undefined ? snap.error : null,
    loading: snap.data === undefined && !snap.error,
    refreshing: snap.fetching && snap.data !== undefined,
    reload,
    setData,
  };
}
