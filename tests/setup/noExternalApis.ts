// Tests never call the real weather and NOTAM services: Open-Meteo (its free tier is a daily
// request limit per IP, shared with the pilot's own planning), aviationweather.gov and autorouter.
// This wraps the process's global fetch so that any such call fails loudly and is recorded; tests
// inject mocks instead. Loaded by vitest (setupFiles) and by the e2e harness (the API server runs in
// the test process there).
export const FORBIDDEN_HOSTS = /(^|\.)(open-meteo\.com|aviationweather\.gov|autorouter\.aero)$/i;

const g = globalThis as typeof globalThis & { __pgfNoExternal?: boolean; __pgfExternalCalls?: string[] };
/** Every refused call (a test can assert this stays empty). */
export const externalCalls: string[] = (g.__pgfExternalCalls ||= []);
if (!g.__pgfNoExternal) {
  g.__pgfNoExternal = true;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let host = '';
    try { host = new URL(url).hostname; } catch { /* relative: not external */ }
    if (FORBIDDEN_HOSTS.test(host)) {
      externalCalls.push(url);
      throw new Error(`test called a real external API: ${url.slice(0, 120)}`);
    }
    return real(input, init);
  }) as typeof fetch;
}
