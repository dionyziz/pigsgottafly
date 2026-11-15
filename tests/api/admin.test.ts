// The admin page's API (ADMIN_EMAILS only) and the e-mail to the admins on each new signup
// (mail transport MOCKED; a failing transport never blocks the sign-in).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { client, startApi, type Client } from './helpers';
import { setMailTransport, type SentMail } from '../../api/_lib/mail';
import type { AdminPilot, SessionResponse } from '../../src/shared';

let api: Awaited<ReturnType<typeof startApi>>;
const sent: SentMail[] = [];
afterEach(() => setMailTransport(null));
const mock = () => setMailTransport(async (m) => { sent.push(m); return { id: `m-${sent.length}` }; });

beforeAll(async () => { api = await startApi({ adminEmails: ['boss@example.com'] }); });
afterAll(() => api.close());

describe('signup notice', () => {
  test('a new account e-mails the admins (no cc); signing in again does not', async () => {
    mock();
    const c = client(api.base);
    const n = sent.length;
    expect((await c.login('sub-new', 'newbie@example.com')).status).toBe(200);
    expect(sent.length).toBe(n + 1);
    const m = sent[sent.length - 1];
    expect(m.to).toEqual(['boss@example.com']);
    expect(m.cc ?? []).toEqual([]);
    expect(m.replyTo).toBeUndefined();
    expect(m.from).toMatch(/noreply@pigsgottafly\.com/);
    expect(m.subject).toBe('New pilot: newbie');
    expect(m.text).toMatch(/Name: newbie\nE-mail: newbie@example\.com\nTime: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    expect((await c.login('sub-new', 'newbie@example.com')).status).toBe(200);
    expect(sent.length).toBe(n + 1);
  });

  test('a failing mail provider does not block the sign-in', async () => {
    setMailTransport(async () => { throw new Error('provider down'); });
    expect((await client(api.base).login('sub-unlucky', 'unlucky@example.com')).status).toBe(200);
  });

  test('without admins nobody is told', async () => {
    const other = await startApi();
    try {
      mock();
      const n = sent.length;
      expect((await client(other.base).login('sub-x', 'x@example.com')).status).toBe(200);
      expect(sent.length).toBe(n);
    } finally { await other.close(); }
  });
});

describe('admin page', () => {
  let boss: Client, pilot: Client;
  beforeAll(async () => {
    boss = client(api.base);
    pilot = client(api.base);
    expect((await boss.login('sub-boss', 'Boss@Example.com')).status).toBe(200);
    expect((await pilot.login('sub-pilot', 'pilot@example.com')).status).toBe(200);
  });

  test('only admins see every pilot', async () => {
    expect((await pilot.call('GET', 'admin/pilots')).status).toBe(403);
    expect((await pilot.call<SessionResponse>('GET', 'session')).body.admin).toBe(false);
    expect((await boss.call<SessionResponse>('GET', 'session')).body.admin).toBe(true);
    expect((await client(api.base).call('GET', 'admin/pilots')).status).toBe(401);
  });

  test('pilots with their counts and shares', async () => {
    await pilot.call('PUT', 'me', { fullName: 'Pat Pilot' });
    await pilot.call('POST', 'passengers', { fullName: 'A Passenger' });
    await pilot.call('POST', 'flights', {});
    const op = (await pilot.call('POST', 'operators', { name: 'Pat Club' })).body;
    expect((await pilot.call('POST', `operators/${op.id}/shares`, { email: 'boss@example.com', role: 'view' })).status).toBe(201);
    const list = (await boss.call<AdminPilot[]>('GET', 'admin/pilots')).body;
    const p = list.find((x) => x.email === 'pilot@example.com')!;
    expect(p).toMatchObject({ name: 'Pat Pilot', flights: 1, passengers: 1, operators: 1, aircraft: 0 });
    expect(p.created).toBeGreaterThan(0);
    expect(p.lastLogin).toBeGreaterThan(0);
    expect(p.sharedByThem).toEqual([{ kind: 'operator', name: 'Pat Club', role: 'view', pilot: 'Boss' }]);
    expect(list.find((x) => x.email === 'Boss@Example.com')!.sharedWithThem).toEqual([{ kind: 'operator', name: 'Pat Club', role: 'view', pilot: 'Pat Pilot' }]);
  });
});
