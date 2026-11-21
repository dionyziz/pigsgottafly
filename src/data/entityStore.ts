// The entity cache and its invalidation bus (no React, no fetch: src/data/entities.ts registers the
// fetchers and the hooks; src/data/api.ts invalidates after every mutation).
//
// - A hidden tab defers its refetches until it is visible again; focusing the window or showing
//   the tab revalidates what is on screen (onRevalidate).
// - Each entry keeps a request sequence: only the newest request's answer is stored, so a slow
//   answer can never overwrite a newer one (or a value set with putEntity after it started).

export type EntityKey = 'pilot' | 'passengers' | 'aircraft' | 'operators' | 'waypoints' | 'flights';
export const ENTITY_KEYS: readonly EntityKey[] = [
  'pilot',
  'passengers',
  'aircraft',
  'operators',
  'waypoints',
  'flights',
];

export const CHANNEL_NAME = 'pgf';
/** A focus or tab switch refetches data older than this. */
export const FOCUS_REVALIDATE_MS = 5000;

export interface EntitySnapshot<T> {
  data: T | undefined;
  error: Error | null;
  /** A request is in flight (first load or a background refetch). */
  fetching: boolean;
  /** When `data` was stored, epoch ms (0 = never). */
  at: number;
  stale: boolean;
}

interface Entry {
  snap: EntitySnapshot<unknown>;
  seq: number;
  inflight: Promise<unknown> | null;
  subs: Set<() => void>;
}

type Fetcher = () => Promise<unknown>;
type BusMessage =
  | { v: 1; type: 'invalidate'; keys: EntityKey[]; from: string }
  /** A value one tab stored (putEntity with broadcast): the others store it too, without a request (also while hidden). */
  | { v: 1; type: 'put'; key: EntityKey; data: unknown; from: string };

const entries = new Map<EntityKey, Entry>();
const fetchers = new Map<EntityKey, Fetcher>();
const invalidationListeners = new Map<EntityKey, Set<(key: EntityKey) => void>>();
const revalidateListeners = new Set<() => void>();
const deferred = new Set<EntityKey>();
const tabId = Math.random().toString(36).slice(2);
let now = () => Date.now();

function entry(key: EntityKey): Entry {
  let e = entries.get(key);
  if (!e) {
    e = {
      snap: { data: undefined, error: null, fetching: false, at: 0, stale: true },
      seq: 0,
      inflight: null,
      subs: new Set(),
    };
    entries.set(key, e);
  }
  return e;
}
function emit(e: Entry, patch: Partial<EntitySnapshot<unknown>>) {
  e.snap = { ...e.snap, ...patch };
  for (const fn of [...e.subs]) fn();
}

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function registerFetcher(key: EntityKey, fetch: Fetcher) {
  fetchers.set(key, fetch);
}

/** The cached state of `key` (a new object after every change: safe for useSyncExternalStore). */
export function getEntity<T>(key: EntityKey): EntitySnapshot<T> {
  return entry(key).snap as EntitySnapshot<T>;
}

/** Calls `fn` after every change of `key`'s cached state. A subscribed key is refetched when invalidated. */
export function subscribeEntity(key: EntityKey, fn: () => void): () => void {
  const e = entry(key);
  e.subs.add(fn);
  return () => {
    e.subs.delete(fn);
  };
}

/**
 * Fetches `key` unless a request is already in flight (`force` starts a new one, and the older one's
 * answer is then dropped). Resolves with the stored data; rejects only when nothing is cached.
 */
export function loadEntity<T>(key: EntityKey, opts: { force?: boolean } = {}): Promise<T> {
  const e = entry(key);
  const fetch = fetchers.get(key);
  if (!fetch) return Promise.reject(new Error(`no fetcher for ${key}`));
  if (e.inflight && !opts.force) return e.inflight as Promise<T>;
  const my = ++e.seq;
  const p = fetch().then(
    (data) => {
      if (my === e.seq) {
        e.inflight = null;
        emit(e, { data, error: null, fetching: false, at: now(), stale: false });
      }
      return (my === e.seq ? data : e.snap.data) as T;
    },
    (err: unknown) => {
      if (my === e.seq) {
        e.inflight = null;
        emit(e, { error: err instanceof Error ? err : new Error(String(err)), fetching: false });
      }
      if (e.snap.data !== undefined) return e.snap.data as T;
      throw err;
    },
  );
  e.inflight = p;
  if (!e.snap.fetching) emit(e, { fetching: true });
  return p;
}

/**
 * Stores a value the app already has (a mutation's answer, a value from the session) as fresh.
 * A request in flight is superseded. With `broadcast`, the other tabs store the same value (a value
 * that cannot be posted, e.g. not cloneable, makes them refetch instead).
 */
export function putEntity<T>(key: EntityKey, data: T, opts: { broadcast?: boolean } = {}) {
  const e = entry(key);
  if (e.snap.data === data && !e.snap.stale) return;
  e.seq++;
  e.inflight = null;
  emit(e, { data, error: null, fetching: false, at: now(), stale: false });
  if (opts.broadcast && !postValue(key, data)) post([key]);
}

/** Forgets every cached value (sign-in as someone else, sign-out). */
export function clearEntities() {
  for (const e of entries.values()) {
    e.seq++;
    e.inflight = null;
    emit(e, { data: undefined, error: null, fetching: false, at: 0, stale: true });
  }
}

function refetchIfUsed(key: EntityKey) {
  const e = entries.get(key);
  if (e && e.subs.size && fetchers.has(key)) void loadEntity(key, { force: true }).catch(() => {});
}

function applyInvalidation(keys: EntityKey[]) {
  for (const key of keys) {
    const e = entries.get(key);
    if (e && !e.snap.stale) emit(e, { stale: true });
  }
  if (hidden()) {
    for (const k of keys) deferred.add(k);
    return;
  }
  for (const key of keys) {
    refetchIfUsed(key);
    for (const fn of [...(invalidationListeners.get(key) ?? [])]) fn(key);
  }
}

/**
 * Something changed `keys` (on the server, in this tab or another): stale copies are refetched by
 * whatever shows them. Broadcasts to the other tabs unless `broadcast: false`.
 */
export function invalidate(keys: EntityKey | EntityKey[], opts: { broadcast?: boolean } = {}) {
  const list = [...new Set(Array.isArray(keys) ? keys : [keys])];
  if (!list.length) return;
  applyInvalidation(list);
  if (opts.broadcast !== false) post(list);
}

/** Calls `fn` whenever one of `keys` is invalidated (here or in another tab). Returns the unsubscribe. */
export function onInvalidate(keys: EntityKey | EntityKey[], fn: (key: EntityKey) => void): () => void {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) {
    let s = invalidationListeners.get(k);
    if (!s) invalidationListeners.set(k, (s = new Set()));
    s.add(fn);
  }
  return () => {
    for (const k of list) invalidationListeners.get(k)?.delete(fn);
  };
}

/** Calls `fn` when the window regains focus or the tab becomes visible (refetch-on-focus). */
export function onRevalidate(fn: () => void): () => void {
  revalidateListeners.add(fn);
  return () => {
    revalidateListeners.delete(fn);
  };
}

/** The window got focus or the tab became visible: deferred invalidations, then stale-by-age refetches. */
export function revalidate() {
  if (hidden()) return;
  if (deferred.size) {
    const keys = [...deferred];
    deferred.clear();
    applyInvalidation(keys);
  }
  for (const [key, e] of entries) {
    if (e.subs.size && !e.inflight && now() - e.snap.at >= FOCUS_REVALIDATE_MS) refetchIfUsed(key);
  }
  for (const fn of [...revalidateListeners]) fn();
}

let channel: BroadcastChannel | null = null;
function post(keys: EntityKey[]) {
  try {
    channel?.postMessage({ v: 1, type: 'invalidate', keys, from: tabId } satisfies BusMessage);
  } catch {
    /* closed */
  }
}
/** Posts a stored value to the other tabs; false when it could not be posted. */
function postValue(key: EntityKey, data: unknown): boolean {
  if (!channel) return true; // no other tabs to tell
  try {
    channel.postMessage({ v: 1, type: 'put', key, data, from: tabId } satisfies BusMessage);
    return true;
  } catch {
    return false;
  }
}
function onMessage(ev: MessageEvent) {
  const m = ev.data as (Partial<BusMessage> & { keys?: unknown; key?: unknown; data?: unknown }) | null;
  if (!m || m.v !== 1 || m.from === tabId) return;
  const known = (k: unknown): k is EntityKey => (ENTITY_KEYS as readonly string[]).includes(k as string);
  if (m.type === 'put' && known(m.key) && m.data !== undefined) {
    putEntity(m.key, m.data);
    return;
  }
  if (m.type !== 'invalidate' || !Array.isArray(m.keys)) return;
  const keys = m.keys.filter(known);
  if (keys.length) invalidate(keys, { broadcast: false });
}

let started = false;
let windowListening = false;
/** Listens to the other tabs, window focus and tab visibility (once; called on import in the browser). */
export function startEntityBus() {
  if (started) return;
  started = true;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = onMessage;
    } catch {
      channel = null;
    }
  }
  if (!windowListening && typeof window !== 'undefined' && typeof document !== 'undefined') {
    windowListening = true;
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', () => {
      if (!hidden()) revalidate();
    });
  }
}
if (typeof window !== 'undefined') startEntityBus();

/** Tests only: a fresh store, its own channel, and a fake clock. */
export function __resetEntityStoreForTests(opts: { now?: () => number; channel?: boolean } = {}) {
  entries.clear();
  fetchers.clear();
  invalidationListeners.clear();
  revalidateListeners.clear();
  deferred.clear();
  now = opts.now ?? (() => Date.now());
  channel?.close();
  channel = null;
  started = false;
  if (opts.channel) startEntityBus();
}
