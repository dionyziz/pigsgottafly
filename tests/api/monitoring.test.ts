// Error monitoring (api/_lib/monitor.ts, api/_lib/routes/monitoring.ts): server errors and 5xx answers
// are recorded and grouped, client reports are rate-limited and size-capped, alerts are throttled (mail
// transport MOCKED), failed migrations are recorded and e-mailed, /api/health, and the admin guard.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { createApi } from '../../api/_lib/app';
import { connect, type Db, openDb } from '../../api/_lib/db';
import { HttpError, reply, type Route } from '../../api/_lib/http';
import { type SentMail, setMailTransport } from '../../api/_lib/mail';
import { migrate, MIGRATIONS } from '../../api/_lib/migrate';
import {
  BURST_COUNT,
  CLIENT_REPORTS_PER_WINDOW,
  DAILY_ALERT_CAP,
  migrateReporting,
  recordError,
} from '../../api/_lib/monitor';
import { ROUTES } from '../../api/_lib/routes/index';
import type { AppErrorDetail, AppErrorGroup, HealthResponse } from '../../src/shared/monitoring';
import { CID, type Client, client, JWK } from './helpers';

const BOSS = 'boss@example.com';
const sent: SentMail[] = [];
const mock = () =>
  setMailTransport(async (m) => {
    sent.push(m);
    return { id: `m-${sent.length}` };
  });
afterEach(() => setMailTransport(null));

const boom: Route[] = [
  {
    method: 'GET',
    path: '/boom/:id',
    auth: false,
    handler: async ({ params }) => {
      throw new Error(`kaput for item ${params.id} of pilot@example.com`);
    },
  },
  {
    method: 'GET',
    path: '/boom-auth',
    handler: async () => {
      throw new TypeError('cannot read properties of undefined');
    },
  },
  {
    method: 'GET',
    path: '/bad-gateway',
    auth: false,
    handler: async () => {
      throw new HttpError(502, 'upstream down');
    },
  },
  { method: 'GET', path: '/unavailable', auth: false, handler: async () => reply(503, { error: 'not today' }) },
  {
    method: 'GET',
    path: '/teapot',
    auth: false,
    handler: async () => {
      throw new HttpError(418, 'teapot');
    },
  },
];

let db: Db;
let server: http.Server;
let base: string;
beforeAll(async () => {
  db = await openDb('memory://');
  const api = createApi({ db, googleClientId: CID, googleKeys: async () => [JWK], adminEmails: [BOSS] }, [
    ...ROUTES,
    ...boom,
  ]);
  server = http.createServer((req, res) => void api(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.close();
});

const groups = async () => db.query(`SELECT * FROM app_errors ORDER BY first_seen`);
const group = async (like: string) => (await db.query(`SELECT * FROM app_errors WHERE message LIKE $1`, [like]))[0];

describe('server errors', () => {
  test('an unhandled error answers 500, is recorded with its route pattern and grouped across ids', async () => {
    mock();
    const anon = client(base);
    const n = sent.length;
    expect((await anon.call('GET', 'boom/fl_AAAAAAAAA')).status).toBe(500);
    expect((await anon.call('GET', 'boom/fl_BBBBBBBBB')).status).toBe(500);
    const g = await group('kaput%');
    expect(g).toMatchObject({
      kind: 'server',
      route: '/api/boom/:id',
      method: 'GET',
      status: 500,
      count: 2,
      release: 'dev',
    });
    expect(g.message).not.toMatch(/pilot@example\.com/);
    expect(g.message).toMatch(/<email>/);
    expect(g.stack).toMatch(/kaput/);
    expect(Number(g.first_seen)).toBeLessThanOrEqual(Number(g.last_seen));
    // one alert for the new group, none for its second occurrence
    expect(sent.length).toBe(n + 1);
    expect(sent[n].to).toEqual([BOSS]);
    expect(sent[n].subject).toMatch(/New error \(server\): kaput/);
    expect(sent[n].text).toMatch(/Where: GET \/api\/boom\/:id → 500/);
  });

  test('the signed-in pilot is attached; 5xx HttpErrors and replies are recorded; 4xx are not', async () => {
    const c: Client = client(base);
    expect((await c.login('sub-mon', 'mon@example.com')).status).toBe(200);
    expect((await c.call('GET', 'boom-auth')).status).toBe(500);
    const g = await group('cannot read properties%');
    const [p] = await db.query(`SELECT id FROM pilots WHERE email = 'mon@example.com'`);
    expect(g.pilot_id).toBe(p.id);
    expect((await c.call('GET', 'bad-gateway')).status).toBe(502);
    expect(await group('upstream down')).toMatchObject({ status: 502, route: '/api/bad-gateway' });
    expect((await c.call('GET', 'unavailable')).status).toBe(503);
    expect(await group('not today')).toMatchObject({ status: 503 });
    expect((await c.call('GET', 'teapot')).status).toBe(418);
    expect(await group('teapot')).toBeUndefined();
  });

  test('a failing mail provider never breaks the request', async () => {
    setMailTransport(async () => {
      throw new Error('provider down');
    });
    const r = await client(base).call('GET', 'boom/unlucky');
    expect(r).toEqual({ status: 500, body: { error: 'server error' } });
  });
});

describe('alert throttling', () => {
  // each test on its own stretch of (fake) time, so the 24 h cap of one does not reach the next
  let day = 0;
  const T = () => Date.UTC(2020, 0, 1) + (day += 10) * 86400e3;
  const H = 3600e3;
  const rec = (message: string, now: number, kind: 'server' | 'migration' = 'server', admins = [BOSS]) =>
    recordError(db, { kind, message, route: '/api/x' }, { adminEmails: admins, now });
  const alerts = (message: string) => sent.filter((m) => m.subject.includes(message));

  test('new, then quiet: no alert until it recurs after 24 h without an occurrence', async () => {
    mock();
    const t = T();
    expect((await rec('throttle A', t))?.alert).toBe('new');
    expect((await rec('throttle A', t + 2 * H))?.alert).toBeNull();
    expect((await rec('throttle A', t + 20 * H))?.alert).toBeNull();
    expect((await rec('throttle A', t + 45 * H))?.alert).toBe('recurred');
    expect(alerts('throttle A')).toHaveLength(2);
  });

  test('a burst alerts once; not when it bursts right after the first alert', async () => {
    mock();
    const t = T();
    await rec('burst B', t);
    for (let i = 1; i <= BURST_COUNT + 5; i++) await rec('burst B', t + i * 1000);
    expect(alerts('burst B')).toHaveLength(1); // only "new": within the hour
    const t2 = t + 3 * H;
    const out = [];
    for (let i = 0; i <= BURST_COUNT + 5; i++) out.push((await rec('burst B', t2 + i * 1000))?.alert);
    expect(out.filter(Boolean)).toEqual(['burst']);
    expect(out.indexOf('burst')).toBe(BURST_COUNT);
    expect(alerts('burst B').map((m) => m.subject)).toEqual([
      expect.stringMatching(/New error/),
      expect.stringMatching(/Error burst/),
    ]);
  });

  test('a resolved group that recurs alerts again, even within the hour', async () => {
    mock();
    const t = T();
    const r = await rec('regress C', t);
    await db.query('UPDATE app_errors SET resolved_at = $2 WHERE fingerprint = $1', [r!.fingerprint, t + 1000]);
    expect((await rec('regress C', t + 2000))?.alert).toBe('regression');
    expect((await group('regress C')).resolved_at).toBeNull();
    expect((await rec('regress C', t + 3000))?.alert).toBeNull();
  });

  test('migration failures alert on every occurrence, at most once an hour', async () => {
    mock();
    const t = T();
    expect((await rec('migration 999 failed', t, 'migration'))?.alert).toBe('migration');
    expect((await rec('migration 999 failed', t + 10 * 60e3, 'migration'))?.alert).toBeNull();
    expect((await rec('migration 999 failed', t + 61 * 60e3, 'migration'))?.alert).toBe('migration');
  });

  test(`at most ${DAILY_ALERT_CAP} alerts a day overall; no admins, no alerts`, async () => {
    mock();
    const t = T();
    const n = sent.length;
    for (let i = 0; i < DAILY_ALERT_CAP + 5; i++) await rec(`capped group ${String.fromCharCode(97 + i)}`, t + i);
    expect(sent.length - n).toBe(DAILY_ALERT_CAP);
    // the next day the cap has room again
    expect((await rec('capped group next day', t + 25 * H))?.alert).toBe('new');
    expect((await rec('nobody to tell', T(), 'server', []))?.alert).toBeNull();
  });
});

describe('client errors', () => {
  const post = (body: unknown, ip: string, headers: Record<string, string> = {}) =>
    fetch(base + 'client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  test('recorded as kind client, without query strings, tokens or e-mails; the session pilot attached', async () => {
    const r = await post(
      {
        source: 'error',
        message: 'x is not a function (cl@example.com)',
        stack: 'TypeError\n    at f (https://pigsgottafly.com/assets/index-AbCdEf12.js:1:2)',
        url: 'https://pigsgottafly.com/sign/AbCdEfGhIjKlMnOpQrStUvWxYz123456?x=secret#h',
      },
      '10.0.0.1',
    );
    expect(r.status).toBe(204);
    const g = await group('x is not a function%');
    expect(g).toMatchObject({ kind: 'client', route: '/sign/:id', pilot_id: null });
    expect(g.message).toBe('x is not a function (<email>)');
    expect(g.user_agent).toBeTruthy();
    // a failed API call from a signed-in pilot
    const signedIn = await fetch(base + 'client-errors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '10.0.0.2',
        cookie: await sessionCookie('sub-cl2', 'cl2@example.com'),
      },
      body: JSON.stringify({
        source: 'api',
        message: 'server error',
        method: 'put',
        status: 500,
        apiPath: '/api/flights/fl_XXXXXXXX?v=1',
        url: '/flights/fl_XXXXXXXX',
      }),
    });
    expect(signedIn.status).toBe(204);
    const a = await group('API PUT%');
    expect(a.message).toBe('API PUT /api/flights/:id failed: server error');
    expect(a).toMatchObject({ route: '/flights/:id', status: 500, method: 'PUT' });
    const [p] = await db.query(`SELECT id FROM pilots WHERE email = 'cl2@example.com'`);
    expect(a.pilot_id).toBe(p.id);
  });

  test('no sign-in needed, but the CSRF checks apply: same origin, application/json', async () => {
    const report = { source: 'error', message: 'csrf probe' };
    expect((await post(report, '10.0.2.1', { Origin: base.replace(/\/api\/$/, '') })).status).toBe(204);
    expect((await post(report, '10.0.2.2', { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(report, '10.0.2.3', { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await post(report, '10.0.2.4', { 'Content-Type': 'text/plain' })).status).toBe(415);
  });

  test('validated and size-capped', async () => {
    expect((await post({ message: 'no source' }, '10.0.1.1')).status).toBe(400);
    expect((await post({ source: 'error', message: 'x'.repeat(20000) }, '10.0.1.2')).status).toBe(413);
    expect((await post('not json', '10.0.1.3')).status).toBe(400);
  });

  test(`rate-limited to ${CLIENT_REPORTS_PER_WINDOW} reports per IP per window`, async () => {
    const codes: number[] = [];
    for (let i = 0; i < CLIENT_REPORTS_PER_WINDOW + 3; i++)
      codes.push((await post({ source: 'rejection', message: `flood ${i}` }, '10.9.9.9')).status);
    expect(codes.slice(0, CLIENT_REPORTS_PER_WINDOW).every((c) => c === 204)).toBe(true);
    expect(codes.slice(CLIENT_REPORTS_PER_WINDOW)).toEqual([429, 429, 429]);
    // another IP is not affected
    expect((await post({ source: 'rejection', message: 'flood other' }, '10.9.9.8')).status).toBe(204);
    // same message with different numbers: one group
    expect(Number((await db.query("SELECT count FROM app_errors WHERE message ~ '^flood [0-9]+$'"))[0].count)).toBe(
      CLIENT_REPORTS_PER_WINDOW,
    );
  });
});

async function sessionCookie(sub: string, email: string): Promise<string> {
  const { signToken, googleClaims } = await import('./helpers');
  const r = await fetch(base + 'login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: signToken(googleClaims(sub, email)) }),
  });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

describe('health', () => {
  test('200 with the checks; no secrets', async () => {
    const r = await fetch(base + 'health');
    expect(r.status).toBe(200);
    const h = (await r.json()) as HealthResponse;
    expect(h).toMatchObject({
      ok: true,
      release: 'dev',
      checks: {
        db: { ok: true },
        migrations: { ok: true, pending: [], expected: MIGRATIONS.length, applied: MIGRATIONS.length },
      },
    });
    expect(h.checks.airac.id).toBeTruthy();
    expect(typeof h.checks.mail.ok).toBe('boolean');
    expect(JSON.stringify(h)).not.toMatch(/postgres|RESEND|key|secret/i);
  });

  test('503 when a migration is pending', async () => {
    await db.query(`DELETE FROM schema_migrations WHERE name = '040_app_errors'`);
    try {
      const r = await fetch(base + 'health');
      expect(r.status).toBe(503);
      const h = (await r.json()) as HealthResponse;
      expect(h.ok).toBe(false);
      expect(h.checks.migrations.pending).toEqual(['040_app_errors']);
      expect(h.error).toMatch(/migrations pending: 040_app_errors/);
    } finally {
      await db.query(`INSERT INTO schema_migrations (name, applied) VALUES ('040_app_errors', 1)`);
    }
  });

  test('an expired AIRAC is a warning (200) recorded once as a cron error', async () => {
    mock();
    const [a] = await db.query('SELECT id, effective FROM ref_airac WHERE current');
    await db.query('UPDATE ref_airac SET effective = $2 WHERE id = $1', [a.id, '2020-01-02']);
    try {
      const n = sent.length;
      for (let i = 0; i < 2; i++) {
        const r = await fetch(base + 'health');
        expect(r.status).toBe(200);
        expect(((await r.json()) as HealthResponse).checks.airac).toMatchObject({ ok: false, expires: '2020-01-30' });
      }
      expect(await group(`AIRAC ${a.id} is out of date%`)).toMatchObject({ kind: 'cron', count: 2 });
      expect(sent.length).toBe(n + 1);
    } finally {
      await db.query('UPDATE ref_airac SET effective = $2 WHERE id = $1', [a.id, a.effective]);
    }
  });
});

describe('failed migrations', () => {
  test('recorded (creating the monitor tables when 040 has not run) and e-mailed, then rethrown', async () => {
    mock();
    const fresh = await connect('memory://');
    try {
      const n = sent.length;
      await expect(
        migrateReporting(fresh, [{ name: '001_bad', sql: 'SELECT * FROM no_such_table' }], { adminEmails: [BOSS] }),
      ).rejects.toThrow(/migration 001_bad failed/);
      const [g] = await fresh.query('SELECT * FROM app_errors');
      expect(g).toMatchObject({ kind: 'migration', count: 1 });
      expect(g.message).toMatch(/001_bad.*no_such_table/);
      expect(sent.length).toBe(n + 1);
      expect(sent[n].subject).toMatch(/MIGRATION FAILED/);
      expect(sent[n].text).toMatch(/no_such_table/);
      // 040 still applies over the tables the monitor created
      expect(
        await migrate(
          fresh,
          MIGRATIONS.filter((m) => m.name === '040_app_errors'),
        ),
      ).toEqual(['040_app_errors']);
    } finally {
      await fresh.close();
    }
  });

  test('a failing migration on an up-to-date database is recorded there', async () => {
    mock();
    await expect(
      migrateReporting(db, [...MIGRATIONS, { name: '999_broken', sql: 'ALTER TABLE nope ADD COLUMN x INT' }], {
        adminEmails: [BOSS],
      }),
    ).rejects.toThrow(/999_broken/);
    expect(await group('migration 999_broken failed%')).toMatchObject({ kind: 'migration' });
    expect(sent.at(-1)!.subject).toMatch(/MIGRATION FAILED \(migration\): migration 999_broken failed/);
    expect((await db.query(`SELECT 1 FROM schema_migrations WHERE name = '999_broken'`)).length).toBe(0);
  });
});

describe('admin errors API', () => {
  let boss: Client, pilot: Client;
  beforeAll(async () => {
    boss = client(base);
    pilot = client(base);
    await boss.login('sub-boss', 'Boss@Example.com');
    await pilot.login('sub-plain', 'plain@example.com');
  });

  test('admins only', async () => {
    expect((await client(base).call('GET', 'admin/errors')).status).toBe(401);
    expect((await pilot.call('GET', 'admin/errors')).status).toBe(403);
    expect((await pilot.call('GET', `admin/errors/x`)).status).toBe(403);
    expect((await pilot.call('POST', `admin/errors/x/resolve`)).status).toBe(403);
    expect((await boss.call('GET', 'admin/errors')).status).toBe(200);
  });

  test('list, detail with stack, resolve', async () => {
    const list = (await boss.call<AppErrorGroup[]>('GET', 'admin/errors')).body;
    const g = list.find((x) => x.message.startsWith('kaput for item fl_'))!;
    expect(g).toMatchObject({ kind: 'server', route: '/api/boom/:id', count: expect.any(Number), resolvedAt: null });
    expect(list.every((x, i) => i === 0 || list[i - 1].lastSeen >= x.lastSeen)).toBe(true);
    const d = (await boss.call<AppErrorDetail>('GET', `admin/errors/${g.fingerprint}`)).body;
    expect(d.stack).toMatch(/kaput/);
    expect((await boss.call('GET', 'admin/errors/nope')).status).toBe(404);
    expect((await boss.call('POST', `admin/errors/${g.fingerprint}/resolve`)).status).toBe(200);
    expect(
      (await boss.call<AppErrorGroup[]>('GET', 'admin/errors')).body.some((x) => x.fingerprint === g.fingerprint),
    ).toBe(false);
    expect(
      (await boss.call<AppErrorGroup[]>('GET', 'admin/errors?status=resolved')).body.find(
        (x) => x.fingerprint === g.fingerprint,
      )!.resolvedAt,
    ).toBeGreaterThan(0);
    // it happens again: open again, and the admins are told
    mock();
    const n = sent.length;
    await client(base).call('GET', 'boom/fl_CCCCCCCCC');
    expect(
      (await boss.call<AppErrorGroup[]>('GET', 'admin/errors')).body.some((x) => x.fingerprint === g.fingerprint),
    ).toBe(true);
    expect(sent.slice(n).map((m) => m.subject)).toEqual([expect.stringMatching(/Resolved error is back/)]);
  });
});

test('all groups so far are PII-light', async () => {
  for (const g of await groups()) {
    expect(String(g.message) + String(g.stack) + String(g.route)).not.toMatch(/@example\.com|secret/);
  }
});
