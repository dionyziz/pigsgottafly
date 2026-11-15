// Sign in with Google (Google Identity Services); the server verifies the ID token.
import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from '../data/api';

declare global {
  interface Window { google?: any }
}

export function SignIn({ clientId, onSignedIn }: { clientId: string | null; onSignedIn: () => void }) {
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    const init = () => {
      window.google.accounts.id.initialize({
        client_id: clientId,
        auto_select: true,
        callback: async ({ credential }: { credential: string }) => {
          try {
            await api.login(credential);
            onSignedIn();
          } catch (e) {
            setError(e instanceof ApiRequestError && e.status === 403 ? 'This Google account can’t use this planner.' : 'Sign-in failed. Try again.');
          }
        },
      });
      if (button.current) window.google.accounts.id.renderButton(button.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
      window.google.accounts.id.prompt();
    };
    if (window.google?.accounts?.id) { init(); return; }
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true;
    sc.onload = init;
    document.head.appendChild(sc);
  }, [clientId, onSignedIn]);

  return (
    <div className="center-screen">
      <div className="card stack" style={{ padding: 40, alignItems: 'center', width: 380, textAlign: 'center' }}>
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>Pig's Gotta Fly</h1>
        <p className="muted" style={{ margin: 0 }}>VFR flight planning for the Athinai FIR.</p>
        <div ref={button} style={{ minHeight: 44 }} />
        {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      </div>
    </div>
  );
}
