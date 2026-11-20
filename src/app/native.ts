// The web app inside the iOS/iPad app (ios/, Capacitor): what differs from a browser.
//   - Printing: iOS web views ignore window.print(), so it goes to AirPrint (PgfNativePlugin.print).
//   - Links that open a new tab (the exports) open in place; swiping right comes back.
//   - Sign-in: Google refuses sign-in inside the app's web view, so it happens in Apple's sign-in
//     sheet on /app-login, which hands a one-time code back (api/_lib/routes/appLogin.ts).
// In a browser every function here is a no-op or false.
import { Capacitor, registerPlugin } from '@capacitor/core';

import { api } from '../data/api';

interface PgfNative {
  signIn: (o: { url: string }) => Promise<{ url: string }>;
  print: (o: { title?: string }) => Promise<{ printed: boolean }>;
}
const native = registerPlugin<PgfNative>('PgfNative');

/** The scheme /app-login hands the code back on (PgfNativePlugin.callbackScheme). */
export const APP_SCHEME = 'pigsgottafly';
/** The page the app's sign-in sheet opens. */
export const APP_LOGIN_PATH = '/app-login';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** Sets up the app's differences from a browser (once, before the first render). */
export function installNativeShell(): void {
  if (!isNativeApp()) return;
  document.documentElement.classList.add('native-app');
  window.print = () => void native.print({ title: document.title }).catch(() => undefined);
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[target=_blank]') as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || new URL(a.href, location.href).origin !== location.origin) return;
      e.preventDefault();
      location.assign(a.href);
    },
    true,
  );
}

/** Signs in through Apple's sign-in sheet, then gives this web view its own session (it reloads). */
export async function nativeSignIn(): Promise<void> {
  const { url } = await native.signIn({ url: location.origin + APP_LOGIN_PATH });
  const code = new URL(url).searchParams.get('code');
  if (!code) throw new Error('no sign-in code');
  location.assign('/api/app-session?code=' + encodeURIComponent(code));
}

/** On /app-login (in the sign-in sheet, signed in): hands a one-time code back to the app. */
export async function handBackToApp(): Promise<void> {
  const { code } = await api.appCode();
  location.assign(`${APP_SCHEME}://signed-in?code=${encodeURIComponent(code)}`);
}
