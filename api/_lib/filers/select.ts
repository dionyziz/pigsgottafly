// Which backend files a flight: FILERS names them in order ('autorouter,fax' by default); the first
// one available for the pilot and the flight files it. A transient failure (the service down, timed
// out, its own refusal) falls through to the next available one; a refusal of the plan itself (it
// does not parse, the caps) does not, since another backend would send the same plan. The pilot may
// also pick one (FileRequest.via): then only that one is tried.
import type { FilerId, FilerInfo } from '../../../src/shared/briefing.js';
import type { Pilot } from '../../../src/shared/types.js';
import { type Filer, FilerError } from './types.js';

export const FILER_IDS: FilerId[] = ['autorouter', 'fax'];

/** FILERS as a list of known ids, in order, without repeats; unset or empty: autorouter, then fax. */
export function filerOrder(v: string | undefined): FilerId[] {
  const ids = (v || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is FilerId => (FILER_IDS as string[]).includes(s));
  return ids.length ? [...new Set(ids)] : FILER_IDS;
}

export function filerInfos(filers: Filer[], pilot: Pilot, adep: string): FilerInfo[] {
  return filers.map((f) => ({
    id: f.id,
    label: f.labelFor(adep),
    capabilities: f.capabilities,
    ...f.availableFor(pilot, { adep }),
  }));
}

export interface Attempt {
  filer: Filer;
  error: FilerError;
}

/**
 * Runs `fn` with the first available backend, falling through on transient failures. Every failed
 * attempt is reported to `failed` (the route logs it). Throws the last failure, or a 503 FilerError
 * when no backend is available (with the first one's reason).
 */
export async function withFallback<T>(
  filers: Filer[],
  pilot: Pilot,
  adep: string,
  fn: (f: Filer) => Promise<T>,
  failed: (a: Attempt) => Promise<void>,
): Promise<{ filer: Filer; result: T }> {
  const open = filers.filter((f) => f.availableFor(pilot, { adep }).available);
  if (!open.length) {
    const reason = filers.map((f) => f.availableFor(pilot, { adep }).reason).find(Boolean);
    throw new FilerError(reason || 'Filing is not available on this server.', 503, false);
  }
  let last: FilerError | null = null;
  for (const f of open) {
    try {
      return { filer: f, result: await fn(f) };
    } catch (e) {
      const error = e instanceof FilerError ? e : new FilerError(String((e as Error)?.message || e), 502);
      await failed({ filer: f, error });
      last = error;
      if (!error.transient) break;
    }
  }
  throw last!;
}
