// Sign-in for the native iPhone/iPad app (native/ios, NATIVE.md "Account"). The app opens /app-login in
// Apple's sign-in sheet (ASWebAuthenticationSession, Safari's cookies), where the pilot signs in as on
// the website (Google or Apple ID); this page then hands a one-time code back to the app, which
// exchanges it for its own session (api/_lib/routes/appLogin.ts).
import { api } from '../data/api';

/** The scheme /app-login hands the code back on (the app's ASWebAuthenticationSession callback). */
const APP_SCHEME = 'pigsgottafly';
/** The page the app's sign-in sheet opens. */
export const APP_LOGIN_PATH = '/app-login';

/** On /app-login (in the sign-in sheet, signed in): hands a one-time code back to the app. */
export async function handBackToApp(): Promise<void> {
  const { code } = await api.appCode();
  location.assign(`${APP_SCHEME}://signed-in?code=${encodeURIComponent(code)}`);
}
