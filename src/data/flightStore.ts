// Flight storage with offline tolerance (port of the v2 js/store.js): every open flight is kept in
// localStorage; edits are saved locally at once and sent to the server debounced. Edits made
// offline are sent when the connection returns. On a 409 (edited on another device) our version
// wins on top of theirs (last writer wins), as in v2.
//
//   const f = await flightStore.load(id)          // server copy, or the local one when offline
//   flightStore.save(id, doc)                     // debounced PUT; status 'saving' | 'saved' | 'offline'
//   flightStore.onStatus(cb)
import type { Flight, FlightDoc } from '../shared';
import { api, ApiRequestError } from './api';

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'error';

interface Cached {
  id: string;
  doc: FlightDoc;
  version: number;
  dirty: boolean;
  /** Bumped on every local edit, to detect edits made while a PUT was in flight. */
  rev: number;
}

const key = (id: string) => `pgf.flight.${id}`;
const PENDING = 'pgf.pending';
const LS = {
  get<T>(k: string): T | null {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* full or blocked */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

/** The editable part of a Flight. */
export function docOf(f: Flight): FlightDoc {
  const { id: _i, version: _v, created: _c, updated: _u, opened: _o, deleted: _d, ...doc } = f;
  return doc;
}

let status: SaveStatus = 'saved';
const listeners = new Set<(s: SaveStatus) => void>();
const setStatus = (s: SaveStatus) => {
  status = s;
  listeners.forEach((f) => f(s));
};
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function queue(id: string, delay = 700) {
  const p = new Set(LS.get<string[]>(PENDING) || []);
  p.add(id);
  LS.set(PENDING, [...p]);
  setStatus('saving');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), delay);
}
const drop = (id: string) =>
  LS.set(
    PENDING,
    (LS.get<string[]>(PENDING) || []).filter((x) => x !== id),
  );

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  let failed = false;
  try {
    for (const id of LS.get<string[]>(PENDING) || []) {
      const c = LS.get<Cached>(key(id));
      if (!c || !c.dirty) {
        drop(id);
        continue;
      }
      try {
        const r = await api.flights.update(id, c.doc, c.version);
        const now = LS.get<Cached>(key(id))!;
        LS.set(key(id), { ...now, version: r.version, dirty: now.rev !== c.rev });
        if (now.rev === c.rev) drop(id);
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 409 && e.body) {
          const now = LS.get<Cached>(key(id))!;
          LS.set(key(id), { ...now, version: (e.body as Flight).version });
        } else if (e instanceof ApiRequestError && (e.status === 404 || e.status === 400)) {
          // gone or rejected: retrying will not help, and the rejected copy must not shadow the
          // server's on the next load (load() prefers a dirty local copy of the same version)
          drop(id);
          const now = LS.get<Cached>(key(id));
          if (now) LS.set(key(id), { ...now, dirty: false });
          setStatus('error');
          console.error('save failed', e);
        } else failed = true;
      }
    }
  } finally {
    flushing = false;
  }
  const left = (LS.get<string[]>(PENDING) || []).length;
  if (status !== 'error' || left) setStatus(left ? (failed ? 'offline' : 'saving') : 'saved');
  if (left) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), failed ? 5000 : 300);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flush();
  });
  window.addEventListener('beforeunload', () => {
    if ((LS.get<string[]>(PENDING) || []).length) void flush();
  });
  if ((LS.get<string[]>(PENDING) || []).length) setTimeout(() => void flush(), 500);
}

export const flightStore = {
  get status() {
    return status;
  },
  onStatus(f: (s: SaveStatus) => void) {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },

  /** Loads a flight: the server copy, unless we hold unsent edits of the same version. Null if missing. */
  async load(id: string): Promise<{ flight: Flight; doc: FlightDoc } | null> {
    const cached = LS.get<Cached>(key(id));
    try {
      const f = await api.flights.get(id);
      api.flights.opened(id).catch(() => {});
      if (cached && cached.dirty && cached.version === f.version) return { flight: f, doc: cached.doc };
      LS.set(key(id), { id, doc: docOf(f), version: f.version, dirty: false, rev: 0 } satisfies Cached);
      return { flight: f, doc: docOf(f) };
    } catch (e) {
      if (e instanceof ApiRequestError && e.auth) throw e;
      if (e instanceof ApiRequestError && e.status === 404) {
        LS.del(key(id));
        return null;
      }
      if (!cached) throw e;
      return {
        flight: { ...cached.doc, id, version: cached.version, created: 0, updated: 0, opened: 0, deleted: false },
        doc: cached.doc,
      };
    }
  },

  /** Saves locally now and to the server soon. */
  save(id: string, doc: FlightDoc) {
    const c = LS.get<Cached>(key(id));
    LS.set(key(id), { id, doc, version: c?.version ?? 1, dirty: true, rev: (c?.rev ?? 0) + 1 } satisfies Cached);
    queue(id);
  },

  /** Sends pending edits now. */
  flushNow: () => flush(),
};
