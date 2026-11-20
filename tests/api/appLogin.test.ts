// Sign-in for the iOS app: a one-time code minted where the pilot is signed in (Apple's sign-in
// sheet), used up in the app's web view for a session of its own.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { client, startApi } from './helpers';

describe('iOS app sign-in handoff', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  beforeAll(async () => {
    api = await startApi();
  });
  afterAll(() => api.close());

  /** GET /app-session as the app's web view does: no cookie, the redirect not followed. */
  const useCode = (code: string) =>
    fetch(`${api.base}app-session?code=${encodeURIComponent(code)}`, { redirect: 'manual' });

  test('a code from a signed-in browser gives the app its own session, once', async () => {
    const browser = client(api.base);
    await browser.login('app-1', 'app@example.com');
    const { status, body } = await browser.call('POST', 'app-code');
    expect(status).toBe(200);
    expect(body.code).toMatch(/^[\w-]{30,}$/);

    const r = await useCode(body.code);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toMatch(/^pgf_session=[\w-]+$/);
    const session = await (await fetch(`${api.base}session`, { headers: { cookie } })).json();
    expect(session).toMatchObject({ authed: true, pilot: { email: 'app@example.com' } });

    // used up: a second use signs nobody in
    const again = await useCode(body.code);
    expect(again.headers.get('location')).toBe('/?signin=failed');
    expect(again.headers.get('set-cookie')).toBeNull();
  });

  test('no code, a made-up one, or minting without signing in: refused', async () => {
    expect((await useCode('')).headers.get('location')).toBe('/?signin=failed');
    expect((await useCode('x'.repeat(32))).headers.get('location')).toBe('/?signin=failed');
    expect((await client(api.base).call('POST', 'app-code')).status).toBe(401);
  });
});
