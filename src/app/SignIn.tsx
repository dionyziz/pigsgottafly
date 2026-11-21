// Sign in with Google (Google Identity Services) or with Apple (Sign in with Apple JS, in a popup);
// the server verifies the token. The native app signs in through this page too, on /app-login in
// Apple's sign-in sheet (src/app/appLogin.ts).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { api, ApiRequestError } from '../data/api';

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

/** The part of Sign in with Apple JS (appleid.auth.js) this app uses. */
interface AppleIdAuth {
  auth: {
    init: (o: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }) => void;
    signIn: () => Promise<{
      authorization: { id_token: string };
      user?: { email?: string; name?: { firstName?: string; lastName?: string } };
    }>;
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
    AppleID?: AppleIdAuth;
  }
}

const APPLE_JS = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

/** Loads a script once (later calls wait for the same load). */
const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = src;
      sc.async = true;
      sc.onload = () => resolve();
      sc.onerror = () => {
        scripts.delete(src);
        reject(new Error('script failed'));
      };
      document.head.appendChild(sc);
    });
    scripts.set(src, p);
  }
  return p;
}

/** Apple's logo for the Sign in with Apple button. */
function AppleLogo() {
  return (
    <svg width="16" height="19" viewBox="0 0 17 20" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M14.2 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 1.9 5.8 1 7.5c-1.9 3.2-.5 8 1.3 10.6.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.9 3.4-.9s2 .9 3.4.8c1.4 0 2.3-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.8-1.1-2.8-4.4zM11.6 3c.7-.9 1.2-2.1 1.1-3.3-1 .1-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.5z" />
    </svg>
  );
}

/** Sign in with Apple (JS, popup), styled to Apple's guidelines: black, Apple's logo and wording. */
function AppleButton({ clientId, onToken }: { clientId: string; onToken: (idToken: string, name?: string) => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    (window.AppleID ? Promise.resolve() : loadScript(APPLE_JS))
      .then(() => {
        window.AppleID?.auth.init({
          clientId,
          scope: 'name email',
          redirectURI: location.origin + '/',
          usePopup: true,
        });
        if (live) setReady(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [clientId]);
  const signIn = () => {
    window.AppleID?.auth.signIn().then(
      (r) => {
        const n = r.user?.name;
        const name = n ? [n.firstName, n.lastName].filter(Boolean).join(' ') : '';
        onToken(r.authorization.id_token, name || undefined);
      },
      () => undefined, // closed or cancelled
    );
  };
  return (
    <button
      type="button"
      className="apple-signin"
      onClick={signIn}
      disabled={!ready}
      data-testid="apple-signin"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: 260,
        height: 40,
        padding: '0 16px',
        border: 'none',
        borderRadius: 20,
        background: '#000',
        color: '#fff',
        font: '500 15px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
        cursor: 'pointer',
      }}
    >
      <AppleLogo />
      Sign in with Apple
    </button>
  );
}

export function SignIn({
  clientId,
  appleClientId = null,
  onSignedIn,
}: {
  clientId: string | null;
  appleClientId?: string | null;
  onSignedIn: () => void;
}) {
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('signin') === 'failed' ? 'Sign-in failed. Try again.' : null,
  );

  const appleSignIn = async (idToken: string, name?: string) => {
    setError(null);
    try {
      await api.loginApple({ idToken, ...(name ? { name } : {}) });
      onSignedIn();
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 403
          ? 'This Apple ID can’t use this planner.'
          : 'Sign-in failed. Try again.',
      );
    }
  };

  useEffect(() => {
    if (!clientId) return;
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
    loadScript('https://accounts.google.com/gsi/client').then(init, () => undefined);
  }, [clientId, onSignedIn]);

  return (
    <div className="center-screen">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: 380 }}>
        <div
          className="card stack"
          style={{
            padding: '40px 24px',
            alignItems: 'center',
            width: '100%',
            boxSizing: 'border-box',
            textAlign: 'center',
          }}
        >
          <img src="/icon.svg" alt="" width={56} height={56} />
          <h1>Pig's Gotta Fly</h1>
          <p className="muted" style={{ margin: 0 }}>
            VFR flight planning for the Athinai FIR.
          </p>
          <div ref={button} style={{ minHeight: 44 }} />
          {appleClientId && <AppleButton clientId={appleClientId} onToken={(t, n) => void appleSignIn(t, n)} />}
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
