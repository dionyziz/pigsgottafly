// Sign in with Google (Google Identity Services); the server verifies the ID token. In the iOS app,
// the button opens Apple's sign-in sheet instead (src/app/native.ts), where Google sign-in works.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { api, ApiRequestError } from '../data/api';
import { isNativeApp, nativeSignIn } from './native';

/** The part of Google Identity Services (accounts.google.com/gsi/client) this app uses. */
interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (o: {
        client_id: string;
        auto_select: boolean;
        callback: (r: { credential: string }) => void;
      }) => void;
      renderButton: (el: HTMLElement, o: Record<string, string | number>) => void;
      prompt: () => void;
      disableAutoSelect: () => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

export function SignIn({ clientId, onSignedIn }: { clientId: string | null; onSignedIn: () => void }) {
  const button = useRef<HTMLDivElement>(null);
  const app = isNativeApp();
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('signin') === 'failed' ? 'Sign-in failed. Try again.' : null,
  );
  const appSignIn = () => {
    setError(null);
    nativeSignIn().catch((e: { code?: string }) => {
      if (e?.code !== 'cancelled') setError('Sign-in failed. Try again.');
    });
  };

  useEffect(() => {
    if (!clientId || app) return;
    const signIn = async (credential: string) => {
      try {
        await api.login(credential);
        onSignedIn();
      } catch (e) {
        setError(
          e instanceof ApiRequestError && e.status === 403
            ? 'This Google account can’t use this planner.'
            : 'Sign-in failed. Try again.',
        );
      }
    };
    const init = () => {
      const gsi = window.google?.accounts.id;
      if (!gsi) return;
      gsi.initialize({
        client_id: clientId,
        auto_select: true,
        callback: ({ credential }) => void signIn(credential),
      });
      if (button.current)
        gsi.renderButton(button.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          width: 260,
        });
      gsi.prompt();
    };
    if (window.google?.accounts?.id) {
      init();
      return;
    }
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true;
    sc.onload = init;
    document.head.appendChild(sc);
  }, [clientId, onSignedIn, app]);

  return (
    <div className="center-screen">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          className="card stack"
          style={{ padding: '40px 24px', alignItems: 'center', width: 380, maxWidth: '100%', textAlign: 'center' }}
        >
          <img src="/icon.svg" alt="" width={56} height={56} />
          <h1>Pig's Gotta Fly</h1>
          <p className="muted" style={{ margin: 0 }}>
            VFR flight planning for the Athinai FIR.
          </p>
          {app ? (
            <button type="button" className="primary" onClick={appSignIn} data-testid="app-signin">
              Sign in with Google
            </button>
          ) : (
            <div ref={button} style={{ minHeight: 44 }} />
          )}
          <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-xs)' }} data-testid="signin-consent">
            By signing in you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer
          className="muted"
          style={{ marginTop: 16, fontSize: 'var(--fs-sm)', textAlign: 'center' }}
          data-testid="signin-footer"
        >
          <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
        </footer>
      </div>
    </div>
  );
}
