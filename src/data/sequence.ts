// Request sequencing for async effects: only the newest request may set state.
//
//   const seq = useSequencer();
//   useEffect(() => {
//     const current = seq.next();                 // supersedes every earlier request
//     fetchX(key).then((x) => { if (current()) setX(x); }, () => { if (current()) setX(null); });
//   }, [key]);
//
// Unlike a per-effect `let live = true` flag, this also drops answers of requests started outside
// the effect (refresh buttons, timers) once a newer one starts, and everything after unmount.
import { useEffect, useMemo } from 'react';

export interface Sequencer {
  /** Starts a request: returns its "still current?" check. */
  next: () => () => boolean;
  /** Makes every request started so far stale (e.g. on unmount, or when the input is cleared). */
  cancel: () => void;
}

export function sequencer(): Sequencer {
  let n = 0;
  return {
    next() {
      const my = ++n;
      return () => my === n;
    },
    cancel() {
      n++;
    },
  };
}

/**
 * Runs `fn` for the newest call only: an older call's promise settles with the newest call's result
 * instead of its own (so callers never see out-of-order answers).
 */
export function latestOnly<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  let n = 0;
  let newest: Promise<R> | null = null;
  return (...a: A) => {
    const my = ++n;
    const p: Promise<R> = fn(...a).then(
      (r) => (my === n ? r : newest!),
      (e: unknown) => {
        if (my === n) throw e;
        return newest!;
      },
    );
    newest = p;
    return p;
  };
}

/** A sequencer for the component's lifetime; unmounting cancels whatever is in flight. */
export function useSequencer(): Sequencer {
  const s = useMemo(sequencer, []);
  useEffect(() => () => s.cancel(), [s]);
  return s;
}
