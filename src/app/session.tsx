// Session context: the signed-in pilot (or the local pilot). Kept fresh by AuthGate through the
// 'pilot' entity (src/data/entities.ts): profile edits here or in another tab, and window focus.
import { createContext, use } from 'react';

import type { Entitlement, Pilot, SessionResponse } from '../shared';

export interface SessionValue {
  session: SessionResponse;
  pilot: Pilot;
  /** Replace the pilot (e.g. an optimistic change); every page and tab follows. api.me.update already does this. */
  setPilot: (p: Pilot) => void;
  signOut: () => Promise<void>;
  /** Ends every session of the account (all devices), then this one shows the sign-in screen. */
  signOutEverywhere: () => Promise<void>;
  /** The subscription changed (bought, or a 402 said it ended). */
  setEntitlement: (e: Entitlement) => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = use(SessionContext);
  if (!v) throw new Error('useSession outside <AuthGate>');
  return v;
}
export const usePilot = () => useSession().pilot;
