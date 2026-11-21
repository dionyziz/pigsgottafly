// Loads /api/session. Google mode without a session → the sign-in screen (Google Identity
// Services button, as in v2). Local mode → straight in as the local pilot.
//
// The session pilot is the 'pilot' entity (src/data/entities.ts): a profile change anywhere (this
// page, another page, another tab) or a window focus refreshes it, so usePilot() is never stale.
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { api, ApiRequestError, clearGetCache } from '../data/api';
import { clearEntities, getEntity, putEntity, subscribeEntity } from '../data/entities';
import { clearAsyncCache } from '../data/useAsync';
import type { Pilot, SessionResponse } from '../shared';
import { Loading } from '../ui';
import { APP_LOGIN_PATH, handBackToApp } from './appLogin';
import { SessionContext, type SessionValue } from './session';
import { SignIn } from './SignIn';

/** Another pilot (or none): nothing the last one loaded may show. */
function forgetAll() {
  clearEntities();
  clearAsyncCache();
  clearGetCache();
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.session();
      // another pilot (or none): nothing cached belongs to them
      if (getEntity<Pilot>('pilot').data?.id !== s.pilot?.id) forgetAll();
      if (s.authed && s.pilot) putEntity('pilot', s.pilot);
      setSession(s);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiRequestError && e.offline ? 'You are offline.' : 'The server is not responding.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // any 401 from the API (session expired) brings the sign-in screen back
  useEffect(() => {
    const onUnauthorized = () => setSession((s) => (s ? { ...s, authed: false, pilot: null } : s));
    window.addEventListener('pgf:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pgf:unauthorized', onUnauthorized);
  }, []);

  // the session pilot follows the 'pilot' entity (refetched when changed here or in another tab)
  useEffect(
    () =>
      subscribeEntity('pilot', () => {
        const p = getEntity<Pilot>('pilot').data;
        if (p)
          setSession((s) =>
            s && s.authed && s.pilot && s.pilot.id === p.id && s.pilot !== p ? { ...s, pilot: p } : s,
          );
      }),
    [],
  );

  const signedIn = !!session?.authed && !!session.pilot;
  const value = useMemo(
    (): SessionValue | null =>
      session && signedIn
        ? {
            session,
            pilot: session.pilot!,
            // functional: never writes back a session captured before another change; every tab follows
            setPilot: (p: Pilot) => putEntity('pilot', p, { broadcast: true }),
            signOut: async () => {
              await api.logout().catch(() => {});
              try {
                window.google?.accounts.id.disableAutoSelect();
              } catch {
                /* ignore */
              }
              forgetAll();
              await load();
            },
            signOutEverywhere: async () => {
              await api.revokeAllSessions().catch(() => {});
              try {
                window.google?.accounts.id.disableAutoSelect();
              } catch {
                /* ignore */
              }
              forgetAll();
              await load();
            },
          }
        : null,
    [session, signedIn, load],
  );

  if (error)
    return (
      <div className="center-screen">
        <div className="stack" style={{ alignItems: 'center' }}>
          <p>{error}</p>
          <button onClick={load}>Try again</button>
        </div>
      </div>
    );
  if (!session) return <Loading variant="screen" />;
  if (!value)
    return <SignIn clientId={session.googleClientId} appleClientId={session.appleClientId ?? null} onSignedIn={load} />;
  // the iOS app's sign-in sheet, signed in: hand the sign-in back to the app
  if (location.pathname === APP_LOGIN_PATH) return <AppHandoff />;
  return <SessionContext value={value}>{children}</SessionContext>;
}

/** /app-login once signed in: a one-time code for the app, which closes this sheet. */
function AppHandoff() {
  const [error, setError] = useState(false);
  useEffect(() => {
    handBackToApp().catch(() => setError(true));
  }, []);
  return error ? (
    <div className="center-screen">
      <p className="form-error" role="alert">
        Could not return to the app. Close this window and try again.
      </p>
    </div>
  ) : (
    <Loading variant="screen" />
  );
}
