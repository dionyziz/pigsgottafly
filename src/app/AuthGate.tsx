// Loads /api/session. Google mode without a session → the sign-in screen (Google Identity
// Services button, as in v2). Local mode → straight in as the local pilot.
//
// The signed-in pilot is ONE copy for the whole app (useSession / usePilot), and it must not go
// stale: a profile edit (setPilot) is posted to the app's other tabs (BroadcastChannel), and a tab
// re-reads GET /api/me when it comes back to the foreground (an edit made on another device, or in
// a browser without BroadcastChannel). Exports open in a new tab, and fixing a "missing details"
// warning there used to leave the editor's tab with the old details until reloaded.
import { Loading } from './Loading';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiRequestError } from '../data/api';
import type { Pilot, SessionResponse } from '../shared';
import { SessionContext } from './session';
import { SignIn } from './SignIn';

const PILOT_CHANNEL = 'pgf-pilot';

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

  // the same pilot in every tab, and a fresh copy when the tab comes back to the foreground
  const applyPilot = useCallback((p: Pilot) => {
    setSession((s) => (s?.authed && s.pilot && s.pilot.id === p.id && JSON.stringify(s.pilot) !== JSON.stringify(p) ? { ...s, pilot: p } : s));
  }, []);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(PILOT_CHANNEL);
    ch.onmessage = (e: MessageEvent<Pilot>) => { if (e.data && typeof e.data === 'object') applyPilot(e.data); };
    channel.current = ch;
    return () => { ch.close(); channel.current = null; };
  }, [applyPilot]);
  const authed = !!session?.authed;
  useEffect(() => {
    if (!authed) return;
    const refresh = () => { if (document.visibilityState === 'visible') api.me.get().then(applyPilot, () => {}); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [authed, applyPilot]);

  // any 401 from the API (session expired) brings the sign-in screen back
  useEffect(() => {
    const onUnauthorized = () => setSession((s) => (s ? { ...s, authed: false, pilot: null } : s));
    window.addEventListener('pgf:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pgf:unauthorized', onUnauthorized);
  }, []);

  if (error) return <div className="center-screen"><div className="stack" style={{ alignItems: 'center' }}><p>{error}</p><button onClick={load}>Try again</button></div></div>;
  if (!session) return <Loading screen />;
  if (!session.authed || !session.pilot) return <SignIn clientId={session.googleClientId} onSignedIn={load} />;

  const value = {
    session,
    pilot: session.pilot,
    setPilot: (p: Pilot) => {
      setSession((s) => (s ? { ...s, pilot: p } : s));
      try { channel.current?.postMessage(p); } catch { /* closed */ }
    },
    signOut: async () => {
      await api.logout().catch(() => {});
      try { (window as any).google?.accounts?.id?.disableAutoSelect?.(); } catch { /* ignore */ }
      await load();
    },
    signOutEverywhere: async () => {
      await api.revokeAllSessions().catch(() => {});
      try { (window as any).google?.accounts?.id?.disableAutoSelect?.(); } catch { /* ignore */ }
      await load();
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
