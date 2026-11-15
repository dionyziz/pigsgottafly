// Session context: the signed-in pilot (or the local pilot), refreshed after profile edits.
import { createContext, useContext } from 'react';
import type { Pilot, SessionResponse } from '../shared';

export interface SessionValue {
  session: SessionResponse;
  pilot: Pilot;
  /** Replace the pilot after a profile update (PUT /api/me result). */
  setPilot(p: Pilot): void;
  signOut(): Promise<void>;
  /** Ends every session of the account (all devices), then this one shows the sign-in screen. */
  signOutEverywhere(): Promise<void>;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside <AuthGate>');
  return v;
}
/** The current pilot. */
export const usePilot = () => useSession().pilot;
