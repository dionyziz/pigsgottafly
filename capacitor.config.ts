// The iOS/iPad app (ios/): a native shell around the web app (Capacitor). It loads the live site, so
// every web deploy updates the app too; the built web app (dist/) is bundled as the start-up fallback.
//   CAP_SERVER_URL=http://<mac>:5173 npm run ios:sync   points a development build at a local server.
// Native parts: ios/App/App/PgfNativePlugin.swift (sign-in sheet, AirPrint); the web side is
// src/app/native.ts.
import type { CapacitorConfig } from '@capacitor/cli';

const url = process.env.CAP_SERVER_URL || 'https://pigsgottafly.com';

const config: CapacitorConfig = {
  appId: 'com.pigsgottafly.app',
  appName: "Pig's Gotta Fly",
  webDir: 'dist',
  server: {
    url,
    cleartext: url.startsWith('http://'),
    // the AIP, chart and map tile hosts open in Safari; everything else stays in the app
    allowNavigation: [new URL(url).host],
  },
  ios: {
    scheme: "Pig's Gotta Fly",
    contentInset: 'never',
    backgroundColor: '#ffffff',
  },
};

export default config;
