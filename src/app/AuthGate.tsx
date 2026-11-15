// Loads /api/session. Google mode without a session → the sign-in screen (Google Identity
// Services button, as in v2). Local mode → straight in as the local pilot.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiRequestError } from '../data/api';
import type { Pilot, SessionResponse } from '../shared';
import { SessionContext } from './session';
import { SignIn } from './SignIn';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSession(await api.session());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiRequestError && e.offline ? 'You are offline.' : 'The server is not responding.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // any 401 from the API (session expired) brings the sign-in screen back
  useEffect(() => {
    const onUnauthorized = () => setSession((s) => (s ? { ...s, authed: false, pilot: null } : s));
    window.addEventListener('pgf:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pgf:unauthorized', onUnauthorized);
  }, []);

  if (error) return <div className="center-screen"><div className="stack" style={{ alignItems: 'center' }}><p>{error}</p><button onClick={load}>Try again</button></div></div>;
  if (!session) return <div className="loading-screen">Loading…</div>;
  if (!session.authed || !session.pilot) return <SignIn clientId={session.googleClientId} onSignedIn={load} />;

  const value = {
    session,
    pilot: session.pilot,
    setPilot: (p: Pilot) => setSession({ ...session, pilot: p }),
    signOut: async () => {
      await api.logout().catch(() => {});
      try { (window as any).google?.accounts?.id?.disableAutoSelect?.(); } catch { /* ignore */ }
      await load();
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
