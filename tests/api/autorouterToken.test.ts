import { describe, expect, test } from 'vitest';

import { AutorouterClient, type AutorouterToken, REFUSED_WAIT_MS, type TokenStore } from '../../api/_lib/autorouter';

/** autorouter's token and NOTAM endpoints: counts the tokens it hands out; refuses the ones it revoked. */
function server() {
  const s = { issued: 0, revoked: new Set<string>(), full: false, asked: 0 };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^\/v1\.0/, '');
    if (path === '/oauth2/token') {
      s.asked++;
      if (s.full)
        return json(403, {
          error: 'invalid_client',
          error_description: 'You have too many active access tokens (limit 20). Please reuse an existing token.',
        });
      return json(200, { access_token: `tok${++s.issued}`, expires_in: 3600 });
    }
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    if (s.revoked.has(auth.slice(7))) return json(401, { error: 'invalid token' });
    return json(200, { total: 0, rows: [] });
  }) as typeof globalThis.fetch;
  return { s, fetch };
}

function memoryStore(): TokenStore & { t: AutorouterToken | null; until: number } {
  const st = {
    t: null as AutorouterToken | null,
    until: 0,
    refusedUntil: async () => st.until,
    refuse: async (u: number) => {
      st.until = u;
    },
    get: async () => st.t,
    set: async (t: AutorouterToken) => {
      st.t = t;
    },
    drop: async (v: string) => {
      if (st.t?.value === v) st.t = null;
    },
  };
  return st;
}

describe('autorouter token', () => {
  const settings = (fetch: typeof globalThis.fetch, now: () => number) => ({
    email: 'app@example.com',
    password: 'x',
    filing: false,
    fetch,
    now,
  });
  test('shared by every instance through the store: a cold start reuses it', async () => {
    const { s, fetch } = server();
    const store = memoryStore();
    let now = 1_000_000;
    const a = new AutorouterClient(
      settings(fetch, () => now),
      store,
    );
    const b = new AutorouterClient(
      settings(fetch, () => now),
      store,
    );
    await a.notams(['LGGG'], 0, 1);
    await b.notams(['LGGG'], 0, 1);
    await b.notams(['LGGG'], 0, 1);
    expect(s.issued).toBe(1);
    expect(store.t?.value).toBe('tok1');
    // close to expiry: a new one, stored for the others
    now += 3600e3 - 30e3;
    await b.notams(['LGGG'], 0, 1);
    expect(s.issued).toBe(2);
    await a.notams(['LGGG'], 0, 1);
    expect(s.issued).toBe(2);
    expect(store.t?.value).toBe('tok2');
  });
  test('a refused token is dropped from the store and replaced once', async () => {
    const { s, fetch } = server();
    const store = memoryStore();
    const a = new AutorouterClient(
      settings(fetch, () => 1e6),
      store,
    );
    await a.notams(['LGGG'], 0, 1);
    s.revoked.add('tok1');
    await a.notams(['LGGG'], 0, 1);
    expect(s.issued).toBe(2);
    expect(store.t?.value).toBe('tok2');
  });
  test('refused for too many tokens: no instance asks again for REFUSED_WAIT_MS', async () => {
    const { s, fetch } = server();
    const store = memoryStore();
    let now = 1_000_000;
    s.full = true;
    const a = new AutorouterClient(
      settings(fetch, () => now),
      store,
    );
    const b = new AutorouterClient(
      settings(fetch, () => now),
      store,
    );
    await expect(a.notams(['LGGG'], 0, 1)).rejects.toThrow(/too many active access tokens/);
    expect(store.until).toBe(now + REFUSED_WAIT_MS);
    await expect(b.notams(['LGGG'], 0, 1)).rejects.toThrow(/not retrying before/);
    await expect(a.notams(['LGGG'], 0, 1)).rejects.toThrow(/not retrying before/);
    expect(s.asked).toBe(1);
    // after the wait: asked again, and a token when autorouter allows one
    s.full = false;
    now += REFUSED_WAIT_MS + 1;
    await b.notams(['LGGG'], 0, 1);
    expect(s.asked).toBe(2);
    expect(store.t?.value).toBe('tok1');
  });
});
