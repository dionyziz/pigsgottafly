// Autosave of a form value: `delay` ms after the last change (edits in between coalesce into one
// save), at once on flush() (blur, Ctrl+S, leaving the page), and with fetch keepalive when the tab
// closes. One save at a time: changes made while one is in flight go in the next. A failed save waits
// for the next edit, retry() or the browser coming back online. The value as last sent counts as
// saved: the server's normalized copy never replaces what is being typed. Every editor of an existing
// record uses it (aircraft, operator, profile, passengers, waypoints), with <SaveStatus>.
import { useCallback, useEffect, useRef, useState } from 'react';

const SAVE_TIMEOUT_MS = 20000;

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';

export interface Autosave {
  status: AutosaveStatus;
  error: unknown;
  /** True while the value differs from the last saved one. */
  dirty: boolean;
  /** Saves now (if there is anything to save). */
  flush: () => void;
  retry: () => void;
  /** Saves now and waits: true once everything is saved (false: invalid, or the save failed). */
  settle: () => Promise<boolean>;
  /** The form takes a newer copy from elsewhere (another tab): it counts as saved, not as an edit. */
  adopt: (value: unknown) => void;
}

export function useAutosave<T>({
  value,
  enabled,
  save,
  keepalive,
  delay = 800,
}: {
  value: T;
  /** False while the value must not be saved (validation errors, read-only). */
  enabled: boolean;
  save: (v: T) => Promise<void>;
  /** Best-effort save when the page goes away (fetch keepalive). */
  keepalive?: (v: T) => void;
  delay?: number;
}): Autosave {
  const json = JSON.stringify(value);
  const savedJson = useRef(json);
  const latest = useRef({ value, json, enabled, save, keepalive });
  latest.current = { value, json, enabled, save, keepalive };
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const cur = latest.current;
    if (cur.json === savedJson.current) return true;
    if (inFlight.current || !cur.enabled) return false;
    setStatus('saving');
    let ok = false;
    // a request that never answers must not leave the form "Saving…" for good
    let giveUp: number | undefined;
    const p = Promise.race([
      cur.save(cur.value),
      new Promise<never>((_, reject) => {
        giveUp = window.setTimeout(() => reject(new Error('The server did not answer')), SAVE_TIMEOUT_MS);
      }),
    ]).finally(() => window.clearTimeout(giveUp));
    inFlight.current = p.catch(() => undefined);
    try {
      await p;
      savedJson.current = cur.json;
      setError(null);
      ok = true;
    } catch (e) {
      setError(e);
      setStatus('failed');
    } finally {
      inFlight.current = null;
    }
    if (!ok) return false;
    // edits made while saving go in the next save
    if (latest.current.json !== savedJson.current) {
      setStatus('pending');
      if (latest.current.enabled) timer.current = window.setTimeout(() => void run(), delay);
    } else {
      setStatus('saved');
    }
    return true;
  }, [delay]);

  // every change (re)starts the countdown
  useEffect(() => {
    if (json === savedJson.current) return;
    setStatus((s) => (s === 'saving' ? s : 'pending'));
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (enabled && !inFlight.current) timer.current = window.setTimeout(() => void run(), delay);
  }, [json, enabled, delay, run]);

  // back online: try again
  useEffect(() => {
    const online = () => {
      if (latest.current.json !== savedJson.current) void run();
    };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [run]);

  // closing the tab: keepalive save; with unsaveable changes (errors), the browser asks first
  useEffect(() => {
    const dirty = () => latest.current.json !== savedJson.current;
    const hide = () => {
      const cur = latest.current;
      if (!dirty() || !cur.enabled || !cur.keepalive) return;
      cur.keepalive(cur.value);
      savedJson.current = cur.json;
    };
    const before = (e: BeforeUnloadEvent) => {
      if (dirty() && !latest.current.enabled) e.preventDefault();
      else hide();
    };
    window.addEventListener('beforeunload', before);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('pagehide', hide);
    };
  }, []);

  // leaving the page inside the app: save what is pending
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      const cur = latest.current;
      if (!cur.enabled || cur.json === savedJson.current) return;
      // after the save in flight, if any, so that the newer copy lands last
      void (inFlight.current ?? Promise.resolve()).then(() => cur.save(cur.value)).catch(() => undefined);
    },
    [],
  );

  const flush = useCallback(() => {
    void run();
  }, [run]);
  const settle = useCallback(async () => {
    // edits made during a save need another one
    for (let i = 0; i < 3; i++) {
      while (inFlight.current) await inFlight.current;
      if (!(await run())) return false;
      if (latest.current.json === savedJson.current) return true;
    }
    return false;
  }, [run]);
  const adopt = useCallback((v: unknown) => {
    savedJson.current = JSON.stringify(v);
  }, []);
  return { status, error, dirty: json !== savedJson.current, flush, retry: flush, settle, adopt };
}
