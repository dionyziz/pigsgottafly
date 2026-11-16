// Abuse limits: storage quota and uploads (api/_lib/limits.ts), per-pilot counts, file magic bytes,
// the CSRF checks of the dispatcher (api/_lib/app.ts crossSiteRefusal), rate limits
// (api/_lib/rateLimit.ts), the reference bundle's ETag, and sessions (90-day sliding expiry, sign out
// everywhere).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { SESSION_MS } from '../../api/_lib/auth';
import type { Db } from '../../api/_lib/db';
import { LIMITS, MAX_OPEN_UPLOADS } from '../../api/_lib/limits';
import { RATES } from '../../api/_lib/rateLimit';
import { type Client, client, googleClaims, signToken, startApi } from './helpers';

let api: Awaited<ReturnType<typeof startApi>>;
let db: Db;
let n = 0;
beforeAll(async () => {
  api = await startApi();
  db = (await api.server.ready).db;
});
afterAll(() => api.close());

async function pilot(): Promise<{ c: Client; id: string }> {
  const c = client(api.base);
  n++;
  expect((await c.login(`sub-lim-${n}`, `lim-${n}@example.com`)).status).toBe(200);
  return { c, id: (await c.call('GET', 'me')).body.id };
}
const PDF = (size: number) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size - 9, 0x20)]);

describe('storage', () => {
  test('a per-pilot quota over the files of their aircraft and operators, unfinished uploads included', async () => {
    const prev = process.env.STORAGE_QUOTA_MB;
    process.env.STORAGE_QUOTA_MB = '5';
    try {
      const { c } = await pilot();
      const ac = (await c.call('POST', 'aircraft', { registration: 'SX-QTA' })).body;
      const op = (await c.call('POST', 'operators', { name: 'Quota Club' })).body;
      const start = (size: number, where = `aircraft/${ac.id}`) =>
        c.call('POST', `${where}/files`, { kind: 'document', mime: 'application/pdf', size, name: 'x.pdf' });
      expect((await start(3 * 1048576)).status).toBe(201);
      const r = await start(3 * 1048576, `operators/${op.id}`);
      expect(r.status).toBe(413);
      expect(r.body.error).toMatch(
        /Not enough storage: the files of your aircraft and operators use 3 MB of 5 MB, and this file needs 3 MB/,
      );
      expect((await start(1048576, `operators/${op.id}`)).status).toBe(201);
    } finally {
      if (prev === undefined) delete process.env.STORAGE_QUOTA_MB;
      else process.env.STORAGE_QUOTA_MB = prev;
    }
  });

  test(`at most ${MAX_OPEN_UPLOADS} unfinished uploads; those over an hour old are swept`, async () => {
    const { c, id } = await pilot();
    const ac = (await c.call('POST', 'aircraft', { registration: 'SX-OPN' })).body;
    const start = () =>
      c.call('POST', `aircraft/${ac.id}/files`, {
        kind: 'document',
        mime: 'application/pdf',
        size: 1000,
        name: 'x.pdf',
      });
    for (let i = 0; i < MAX_OPEN_UPLOADS; i++) expect((await start()).status).toBe(201);
    const r = await start();
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/At most 3 uploads at a time/);
    await db.query('UPDATE aircraft_attachments SET created = created - 3700000 WHERE pilot_id = $1', [id]);
    expect((await start()).status).toBe(201);
    const [{ k }] = await db.query('SELECT count(*)::int AS k FROM aircraft_attachments WHERE pilot_id = $1', [id]);
    expect(k).toBe(1);
  });

  test('content must match the declared type (magic bytes)', async () => {
    const { c } = await pilot();
    const ac = (await c.call('POST', 'aircraft', { registration: 'SX-MAG' })).body;
    const html = Buffer.from('<html><script>alert(1)</script>'.padEnd(40));
    const f = (
      await c.call('POST', `aircraft/${ac.id}/files`, {
        kind: 'document',
        mime: 'application/pdf',
        size: 40,
        name: 'a.pdf',
      })
    ).body;
    const bad = await c.call('PUT', `aircraft/${ac.id}/files/${f.id}/chunks/0`, { data: html.toString('base64') });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('the file is not a PDF');
    expect(
      (await c.call('PUT', `aircraft/${ac.id}/files/${f.id}/chunks/0`, { data: PDF(40).toString('base64') })).status,
    ).toBe(204);
    const p = (
      await c.call('POST', `aircraft/${ac.id}/files`, { kind: 'photo', mime: 'image/png', size: 40, name: 'a.png' })
    ).body;
    expect(
      (await c.call('PUT', `aircraft/${ac.id}/files/${p.id}/chunks/0`, { data: PDF(40).toString('base64') })).status,
    ).toBe(400);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    expect(
      (await c.call('PUT', `aircraft/${ac.id}/files/${p.id}/chunks/0`, { data: png.toString('base64') })).status,
    ).toBe(204);
    const webp = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP', 'latin1'), Buffer.alloc(28)]);
    const w = (
      await c.call('POST', `aircraft/${ac.id}/files`, { kind: 'photo', mime: 'image/webp', size: 40, name: 'a.webp' })
    ).body;
    expect(
      (await c.call('PUT', `aircraft/${ac.id}/files/${w.id}/chunks/0`, { data: webp.toString('base64') })).status,
    ).toBe(204);
    // compass swing reports (one-request attachments) too
    expect(
      (
        await c.call('POST', `aircraft/${ac.id}/attachments`, {
          name: 's.pdf',
          mime: 'application/pdf',
          data: html.toString('base64'),
        })
      ).status,
    ).toBe(400);
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    expect(
      (
        await c.call('POST', `aircraft/${ac.id}/attachments`, {
          name: 's.jpg',
          mime: 'image/jpeg',
          data: jpg.toString('base64'),
        })
      ).status,
    ).toBe(201);
  });
});

describe('counts', () => {
  test('aircraft, operators, flights (trash included), passengers, waypoints, files per aircraft', async () => {
    const { c, id } = await pilot();
    const now = Date.now();
    const fill = async (sql: string, k: number) => db.query(sql, [id, k, now]);
    await fill(
      `INSERT INTO aircraft (id, pilot_id, registration, cruise_tas_kt, pattern_tas_kt, fuel, mass_balance, performance, equipment, created, updated)
      SELECT 'acl' || g || $1, $1, 'SX-L' || g, 95, 80, '{}', '{}', '{}', '{}', $3, $3 FROM generate_series(1, $2) g`,
      LIMITS.aircraft,
    );
    await fill(
      `INSERT INTO operators (id, pilot_id, name, created, updated) SELECT 'opl' || g || $1, $1, 'Op ' || g, $3, $3 FROM generate_series(1, $2) g`,
      LIMITS.operators,
    );
    await fill(
      `INSERT INTO flights (id, pilot_id, date, created, updated, deleted) SELECT 'fll' || g || $1, $1, '2026-12-01', $3, $3, g % 2 = 0 FROM generate_series(1, $2) g`,
      LIMITS.flights,
    );
    await fill(
      `INSERT INTO passengers (id, pilot_id, full_name, created, updated) SELECT 'psl' || g || $1, $1, 'P ' || g, $3, $3 FROM generate_series(1, $2) g`,
      LIMITS.passengers,
    );
    await fill(
      `INSERT INTO waypoints (id, pilot_id, name, lat, lon, created, updated) SELECT 'wpl' || g || $1, $1, 'W' || g, 38, 23, $3, $3 FROM generate_series(1, $2) g`,
      LIMITS.waypoints,
    );
    const refused = async (path: string, body: unknown, re: RegExp) => {
      const r = await c.call('POST', path, body);
      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(re);
    };
    await refused('aircraft', { registration: 'SX-ONE' }, /limit of 50 aircraft/);
    await refused('operators', { name: 'One more' }, /limit of 20 operators/);
    await refused('flights', {}, /limit of 2000 flights \(the trash included/);
    await refused(`flights/fll1${id}/copy`, {}, /limit of 2000 flights/);
    await refused('passengers', { fullName: 'One More' }, /limit of 500 passengers/);
    await refused('waypoints', { name: 'ONEMORE', lat: 38, lon: 23 }, /limit of 1000 waypoints/);
    // files per aircraft
    const acId = `acl1${id}`;
    await db.query(
      `INSERT INTO aircraft_attachments (id, pilot_id, aircraft_id, name, mime, size, data, created, kind, chunks, complete)
      SELECT 'fil' || g || $1, $1, $2, 'f.pdf', 'application/pdf', 10, '', $3, 'document', 1, TRUE FROM generate_series(1, $4) g`,
      [id, acId, now, LIMITS.filesPerParent],
    );
    const r = await c.call('POST', `aircraft/${acId}/files`, {
      kind: 'document',
      mime: 'application/pdf',
      size: 10,
      name: 'x.pdf',
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/At most 50 files each/);
  });
});

describe('cross-site requests (CSRF)', () => {
  test('a foreign Origin or Sec-Fetch-Site: cross-site is refused; JSON is required, even with no body', async () => {
    const cookie = (
      await fetch(api.base + 'login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: signToken(googleClaims('sub-csrf', 'csrf@example.com')) }),
      })
    ).headers
      .get('set-cookie')!
      .split(';')[0];
    const f = await (
      await fetch(api.base + 'flights', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).json();
    const host = new URL(api.base).host;
    const post = (path: string, headers: Record<string, string>) =>
      fetch(api.base + path, { method: 'POST', headers: { cookie, ...headers } });
    expect((await post(`flights/${f.id}/copy`, { 'Content-Type': 'application/x-www-form-urlencoded' })).status).toBe(
      415,
    );
    expect((await post(`flights/${f.id}/copy`, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await post(`flights/${f.id}/copy`, {})).status).toBe(415);
    expect(
      (await post(`flights/${f.id}/copy`, { 'Content-Type': 'application/json', Origin: 'https://attacker.example' }))
        .status,
    ).toBe(403);
    expect(
      (await post(`flights/${f.id}/copy`, { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }))
        .status,
    ).toBe(403);
    expect((await post(`flights/${f.id}/copy`, { 'Content-Type': 'application/json', Origin: 'null' })).status).toBe(
      403,
    );
    expect(
      (
        await fetch(api.base + `flights/${f.id}`, {
          method: 'DELETE',
          headers: { cookie, Origin: 'https://attacker.example' },
        })
      ).status,
    ).toBe(403);
    // the app itself: same origin, JSON, empty body
    expect(
      (
        await post(`flights/${f.id}/copy`, {
          'Content-Type': 'application/json',
          Origin: `http://${host}`,
          'Sec-Fetch-Site': 'same-origin',
        })
      ).status,
    ).toBe(201);
    // reads are not affected
    expect(
      (await fetch(api.base + 'flights', { headers: { cookie, Origin: 'https://attacker.example' } })).status,
    ).toBe(200);
  });
});

describe('rate limits', () => {
  test('sharing: 30 a day per pilot', async () => {
    const { c } = await pilot();
    const ac = (await c.call('POST', 'aircraft', { registration: 'SX-SHR' })).body;
    for (let i = 0; i < RATES.share.burst; i++) {
      expect(
        (await c.call('POST', `aircraft/${ac.id}/shares`, { email: `nobody${i}@example.com`, role: 'view' })).status,
      ).toBe(404);
    }
    const r = await c.call('POST', `aircraft/${ac.id}/shares`, { email: 'nobody@example.com', role: 'view' });
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/Too many requests/);
  });

  test('METAR: at most 6 aerodromes per request, and a per-pilot bucket', async () => {
    const { c, id } = await pilot();
    expect((await c.call('GET', 'weather/metar?ids=LGAV,LGTT,LGIR,LGKR,LGRP,LGSA,LGMK')).status).toBe(400);
    await db.query(
      `INSERT INTO rate_limits (bucket, subject, pilot_id, tokens, updated) VALUES ('metar', $1, $2, 0, $3)`,
      [`p:${id}`, id, Date.now()],
    );
    const r = await c.call('GET', 'weather/metar?ids=LGAV');
    expect(r.status).toBe(429);
    expect(r.body.retryAfter).toBeGreaterThan(0);
  });

  test('sign-in attempts per IP address', async () => {
    await db.query(
      `INSERT INTO rate_limits (bucket, subject, tokens, updated) VALUES ('login', 'ip:127.0.0.1', 0, $1), ('login', 'ip:::ffff:127.0.0.1', 0, $1)
      ON CONFLICT (bucket, subject) DO UPDATE SET tokens = 0, updated = EXCLUDED.updated`,
      [Date.now()],
    );
    try {
      expect((await client(api.base).login('sub-rl', 'rl@example.com')).status).toBe(429);
    } finally {
      await db.query(`DELETE FROM rate_limits WHERE bucket = 'login'`);
    }
    expect((await client(api.base).login('sub-rl', 'rl@example.com')).status).toBe(200);
  });

  test('the reference bundle: ETag by AIRAC, cached a day, 304 when unchanged', async () => {
    const { c } = await pilot();
    void c;
    const cookie = (
      await fetch(api.base + 'login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: signToken(googleClaims('sub-ref', 'ref@example.com')) }),
      })
    ).headers
      .get('set-cookie')!
      .split(';')[0];
    const r = await fetch(api.base + 'ref/bundle', { headers: { cookie } });
    expect(r.status).toBe(200);
    const etag = r.headers.get('etag')!;
    expect(etag).toMatch(/^"ref-\d+-\d+"$/);
    expect(r.headers.get('cache-control')).toBe('private, max-age=86400');
    expect((await fetch(api.base + 'ref/bundle', { headers: { cookie, 'If-None-Match': etag } })).status).toBe(304);
  });
});

describe('sessions', () => {
  const cookieOf = (r: Response) => (r.headers.get('set-cookie') || '').split(';')[0];
  const login = (sub: string) =>
    fetch(api.base + 'login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: signToken(googleClaims(sub, `${sub}@example.com`)) }),
    });

  test('90 days without use end a session; a session in use is renewed weekly', async () => {
    const r = await login('sub-sess');
    expect(r.headers.get('set-cookie')).toMatch(new RegExp(`Max-Age=${SESSION_MS / 1000}`));
    const cookie = cookieOf(r);
    const me = await (await fetch(api.base + 'me', { headers: { cookie } })).json();
    // 8 days old: still valid, renewed (new cookie lifetime, created = now)
    await db.query('UPDATE sessions SET created = $2 WHERE pilot_id = $1', [me.id, Date.now() - 8 * 86400e3]);
    const r2 = await fetch(api.base + 'me', { headers: { cookie } });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('set-cookie')).toMatch(/Max-Age=7776000/);
    const [s] = await db.query('SELECT created FROM sessions WHERE pilot_id = $1', [me.id]);
    expect(Number(s.created)).toBeGreaterThan(Date.now() - 60e3);
    // 91 days without use: gone, and purged at the next sign-in of anyone
    await db.query('UPDATE sessions SET created = $2 WHERE pilot_id = $1', [me.id, Date.now() - 91 * 86400e3]);
    expect((await fetch(api.base + 'me', { headers: { cookie } })).status).toBe(401);
    await login('sub-other-sess');
    expect(await db.query('SELECT 1 FROM sessions WHERE pilot_id = $1', [me.id])).toEqual([]);
  });

  test('sign out everywhere ends every session of the account', async () => {
    const a = cookieOf(await login('sub-all'));
    const b = cookieOf(await login('sub-all'));
    expect((await fetch(api.base + 'me', { headers: { cookie: b } })).status).toBe(200);
    const r = await fetch(api.base + 'session/revoke-all', {
      method: 'POST',
      headers: { cookie: a, 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/pgf_session=;.*Max-Age=0/);
    expect((await fetch(api.base + 'me', { headers: { cookie: a } })).status).toBe(401);
    expect((await fetch(api.base + 'me', { headers: { cookie: b } })).status).toBe(401);
  });
});
