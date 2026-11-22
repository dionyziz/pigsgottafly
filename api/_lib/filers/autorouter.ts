// autorouter behind the filing driver interface (types.ts): the client (../autorouter.ts) files over
// AFTN and reports ATC's status, so every capability is there. Only for the pilots on
// AUTOROUTER_PILOTS (the client is null for anyone else, app.ts) and with AUTOROUTER_FILING=1.
import { type AutorouterClient, AutorouterError } from '../autorouter.js';
import { toStatus } from './status.js';
import type { Filer } from './types.js';
import { FilerError } from './types.js';

/** autorouter's own refusal keeps its status and text; anything else (network, timeout) is transient. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AutorouterError) throw new FilerError(e.message, e.status);
    console.warn('filing:', String((e as Error)?.message || e));
    throw new FilerError('autorouter request failed', 502);
  }
}

export function autorouterFiler(ar: AutorouterClient | null, denied: boolean): Filer {
  return {
    id: 'autorouter',
    labelFor: () => 'autorouter',
    capabilities: { file: true, delay: true, cancel: true, status: true, ackRej: true },
    availableFor() {
      if (denied) return { available: false, reason: 'Filing is not available for this account.' };
      if (!ar) return { available: false, reason: 'Filing is not available on this server.' };
      if (!ar.filingEnabled) return { available: false, reason: 'Filing is not enabled on this server.' };
      return { available: true, reason: null };
    },
    async file(_db, plan) {
      const r = await call(() => ar!.file(plan.fpl, plan.addresses));
      return {
        providerId: r.providerId,
        status: r.queued ? 'manual_correction' : 'filed',
        message: '',
        logText: r.queued ? `queued for manual correction (id ${r.providerId})` : `filed (id ${r.providerId})`,
      };
    },
    async delay(_db, ref, eobt) {
      await call(() => ar!.delay(ref.providerId, eobt));
      return { message: '', logText: `delayed to ${new Date(eobt).toISOString().slice(11, 16)}Z` };
    },
    async cancel(_db, ref, reason) {
      await call(() => ar!.cancel(ref.providerId, reason));
      return { status: 'cancelled', message: reason, logText: 'cancelled' };
    },
    async status(_db, ref) {
      const s = await call(() => ar!.status(ref.providerId));
      return { status: toStatus(s.status), eobt: s.eobt, logText: `status ${s.status}` };
    },
    transmitted: (ref) => ar!.aftnOut(ref.providerId).catch(() => []),
  };
}
